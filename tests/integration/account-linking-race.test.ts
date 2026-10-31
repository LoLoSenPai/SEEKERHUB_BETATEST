import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const integration = process.env.RUN_INTEGRATION_TESTS === "true" ? describe : describe.skip;
let prisma: typeof import("@/src/lib/db").prisma;
let transferAnonymousAccount: typeof import("@/src/lib/account-linking").transferAnonymousAccount;
let continueWalletAccount: typeof import("@/src/lib/solana/wallet-account").continueWalletAccount;
let buildWalletChallengeMessage: typeof import("@/src/lib/solana/wallet").buildWalletChallengeMessage;
const userIds: string[] = [];
const walletAddresses: string[] = [];

function disposableDatabaseOnly() {
  // No backend/env initialization is allowed before this guard. Do not reject CI's NODE_ENV.
  for (const name of ["DATABASE_URL", "DIRECT_DATABASE_URL"]) {
    const value = process.env[name];
    if (!value && name === "DIRECT_DATABASE_URL") continue;
    const url = new URL(value ?? "http://missing.invalid");
    if (!/^postgres(ql)?:$/.test(url.protocol) || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
        !url.pathname.toLowerCase().includes("test")) {
      throw new Error(`${name} must point to an explicitly enabled loopback test database.`);
    }
  }
}

function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

async function bounded<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), 4000);
    })]);
  } finally { clearTimeout(timer); }
}

async function user(isAnonymous: boolean) {
  const result = await prisma.user.create({ data: {
    name: "Account race regression", email: `account-race-${randomUUID()}@example.test`, isAnonymous,
  } });
  userIds.push(result.id);
  return result;
}

integration("account linking races on disposable PostgreSQL", () => {
  beforeAll(async () => {
    disposableDatabaseOnly();
    ({ prisma } = await import("@/src/lib/db"));
    ({ transferAnonymousAccount } = await import("@/src/lib/account-linking"));
    ({ continueWalletAccount } = await import("@/src/lib/solana/wallet-account"));
    ({ buildWalletChallengeMessage } = await import("@/src/lib/solana/wallet"));
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    if (!prisma) return;
    const walletUsers = await prisma.wallet.findMany({ where: { address: { in: walletAddresses } }, select: { userId: true } });
    const ids = [...new Set([...userIds, ...walletUsers.map(({ userId }) => userId)])];
    await prisma.auditLog.deleteMany({ where: { OR: [{ actorUserId: { in: ids } }, { targetType: "User", targetId: { in: ids } }] } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  });

  it("retries a real serialization conflict and retains revocation committed after the merge read", async () => {
    const guest = await user(true);
    const durable = await user(false);
    const owner = await user(false);
    const project = await prisma.appProject.create({ data: { ownerId: owner.id, name: "Revocation race", slug: `race-${randomUUID()}` } });
    const source = await prisma.testerAccess.create({ data: { projectId: project.id, userId: guest.id } });
    const destination = await prisma.testerAccess.create({ data: { projectId: project.id, userId: durable.id } });
    const read = barrier();
    const revoked = barrier();
    const originalTransaction = prisma.$transaction.bind(prisma);
    let attempts = 0;
    let paused = false;
    // Only orchestrate scheduling; every delegate call and transaction uses real PostgreSQL.
    const intercept = async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>, options?: {
      maxWait?: number; timeout?: number; isolationLevel?: Prisma.TransactionIsolationLevel;
    }) => {
      attempts++;
      return originalTransaction(async (tx) => callback(new Proxy(tx, {
        get(target, property, receiver) {
          if (property !== "testerAccess") return Reflect.get(target, property, receiver);
          return new Proxy(target.testerAccess, {
            get(delegate, operation, delegateReceiver) {
              if (operation !== "findUnique") return Reflect.get(delegate, operation, delegateReceiver);
              return async (...args: Parameters<typeof delegate.findUnique>) => {
                const row = await delegate.findUnique(...args);
                if (!paused && row?.id === destination.id) {
                  paused = true;
                  read.release();
                  await bounded(revoked.promise, "concurrent revocation commit");
                }
                return row;
              };
            },
          });
        },
      })), options);
    };
    const spy = vi.spyOn(prisma, "$transaction").mockImplementation(intercept as typeof prisma.$transaction);
    const merging = transferAnonymousAccount(guest.id, durable.id).then(
      () => ({ ok: true as const }), (error: unknown) => ({ ok: false as const, error }),
    );
    const revokedAt = new Date();
    try {
      await bounded(read.promise, "destination access read");
      // Same row mutation performed by builder revocation, outside the merge transaction.
      await bounded(prisma.testerAccess.update({ where: { id: destination.id }, data: { revokedAt } }), "revocation update");
      revoked.release();
      const outcome = await bounded(merging, "merge retry completion");
      if (!outcome.ok) throw outcome.error;
      expect(attempts).toBeGreaterThanOrEqual(2);
      expect(attempts).toBeLessThanOrEqual(4);
      expect(await prisma.testerAccess.findUnique({ where: { id: destination.id } })).toMatchObject({ userId: durable.id, revokedAt });
      expect(await prisma.testerAccess.findUnique({ where: { id: source.id } })).toBeNull();
      expect(await prisma.auditLog.count({ where: { actorUserId: durable.id, action: "tester.account_upgraded" } })).toBe(1);
    } finally {
      revoked.release();
      try { await bounded(merging, "merge cleanup"); } finally { spy.mockRestore(); }
    }
  }, 20_000);

  it("never merges two durable wallet owners when the same guest recovers both concurrently", async () => {
    const guest = await user(true);
    const owners = [await user(false), await user(false)];
    const origin = process.env.BETTER_AUTH_URL!;
    const proofs = [];
    for (const owner of owners) {
      const key = nacl.sign.keyPair();
      const address = bs58.encode(key.publicKey);
      walletAddresses.push(address);
      await prisma.wallet.create({ data: { userId: owner.id, address, verifiedAt: new Date(), isPrimary: true } });
      const nonce = randomUUID();
      const expiresAt = new Date(Date.now() + 60_000);
      const message = buildWalletChallengeMessage({ address, nonce, appUrl: origin, purpose: "SIGN_IN", expiresAt });
      const challenge = await prisma.walletChallenge.create({ data: { address, nonce, userId: guest.id, purpose: "SIGN_IN", expiresAt, message } });
      proofs.push({ challengeId: challenge.id, address, currentUserId: guest.id,
        signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(message), key.secretKey)) });
    }
    const results = await bounded(Promise.allSettled(proofs.map(continueWalletAccount)), "distinct-wallet recoveries");
    const successes = results.filter((result) => result.status === "fulfilled");
    expect(successes).toHaveLength(1);
    const failure = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
    expect(owners.map(({ id }) => id)).toContain(successes[0].value.id);
    expect(await prisma.user.findUnique({ where: { id: guest.id } })).toBeNull();
    for (let index = 0; index < owners.length; index++) {
      expect(await prisma.user.findUnique({ where: { id: owners[index].id } })).toMatchObject({ isAnonymous: false });
      expect(await prisma.wallet.findUnique({ where: { address: proofs[index].address } })).toMatchObject({ userId: owners[index].id });
    }
    // Fail closed is necessary, but a raw PostgreSQL deadlock must not escape as an HTTP 500.
    expect(failure.reason, JSON.stringify({ name: failure.reason?.name, meta: failure.reason?.meta })).toMatchObject({ code: "CHALLENGE_NOT_FOUND" });
  }, 20_000);
});
