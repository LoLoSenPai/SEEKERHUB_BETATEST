import { randomBytes, randomUUID } from "node:crypto";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const chain = vi.hoisted(() => ({ verify: vi.fn() }));
vi.mock("@/src/lib/solana/sgt", async (original) => ({
  ...await original<typeof import("@/src/lib/solana/sgt")>(), verifySeekerGenesisOwnership: chain.verify,
}));

const integration = process.env.RUN_INTEGRATION_TESTS === "true" ? describe : describe.skip;
let prisma: typeof import("@/src/lib/db").prisma;
let auth: typeof import("@/src/lib/auth").auth;
let issue: typeof import("@/app/api/wallet/challenge/route").POST;
let hashIdentity: typeof import("@/src/lib/rate-limit").hashRateLimitIdentity;
let origin: string;
const users = new Set<string>();
const addresses = new Set<string>();
const challenges = new Set<string>();
const ips = new Set<string>();

async function http(path: string, body?: object, cookie = "") {
  const ip = `198.19.${randomBytes(1)[0]}.${randomBytes(1)[0]}`;
  ips.add(ip);
  return auth.handler(new Request(`${origin}/api/auth${path}`, { method: body ? "POST" : "GET",
    headers: { origin, cookie, "content-type": "application/json", "x-forwarded-for": ip },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }));
}
function cookieOf(response: Response) {
  return response.headers.getSetCookie().map((c) => c.split(";", 1)[0]).filter((c) => !c.endsWith("=")).join("; ");
}

integration("combined wallet login on disposable PostgreSQL (mocked chain only)", () => {
  beforeAll(async () => {
    if (process.env.NODE_ENV === "production") throw new Error("Never run wallet tests in production.");
    for (const name of ["DATABASE_URL", "DIRECT_DATABASE_URL", "BETTER_AUTH_URL", "NEXT_PUBLIC_APP_URL", "S3_ENDPOINT", "SOLANA_RPC_URL", "NEXT_PUBLIC_SOLANA_RPC_URL"]) {
      const url = new URL(process.env[name] ?? "https://missing.invalid");
      if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error(`${name} must be loopback; use with-review-env.mjs.`);
      if (name.includes("DATABASE_URL") && (!/^postgres(ql)?:$/.test(url.protocol) || !url.pathname.includes("test"))) throw new Error("Disposable test database required.");
    }
    origin = new URL(process.env.BETTER_AUTH_URL!).origin;
    ({ prisma } = await import("@/src/lib/db"));
    ({ auth } = await import("@/src/lib/auth"));
    ({ POST: issue } = await import("@/app/api/wallet/challenge/route"));
    ({ hashRateLimitIdentity: hashIdentity } = await import("@/src/lib/rate-limit"));
  });

  afterAll(async () => {
    if (!prisma) return;
    const owned = await prisma.user.findMany({ where: { OR: [{ id: { in: [...users] } }, { wallets: { some: { address: { in: [...addresses] } } } }] }, select: { id: true } });
    owned.forEach(({ id }) => users.add(id));
    await prisma.walletChallenge.deleteMany({ where: { id: { in: [...challenges] } } });
    await prisma.auditLog.deleteMany({ where: { actorUserId: { in: [...users] } } });
    await prisma.user.deleteMany({ where: { id: { in: [...users] } } });
    await prisma.rateLimitBucket.deleteMany({ where: { action: { in: ["wallet.challenge", "wallet.verify-seeker"] },
      keyHash: { in: [...[...users].map((id) => hashIdentity(`user:${id}:global`)), ...[...ips].map((ip) => hashIdentity(`ip:${ip}:global`))] } } });
    await prisma.rateLimit.deleteMany({ where: { key: { in: [...ips].flatMap((ip) => ["/sign-in/anonymous", "/sign-in/solana-wallet", "/get-session"]
      .map((path) => hashIdentity(`better-auth:${ip}|${path}`))) } } });
  });

  it.each(["verified", "rpc_failure"] as const)("recovers a guest into its linked account with one explicit proof: %s", async (outcome) => {
    chain.verify.mockReset();
    const key = nacl.sign.keyPair();
    const address = bs58.encode(key.publicKey);
    addresses.add(address);
    const owner = await prisma.user.create({ data: { name: "Combined QA", email: `wallet-combo-${randomUUID()}@example.test`, isAnonymous: false } });
    users.add(owner.id);
    const project = await prisma.appProject.create({ data: { ownerId: owner.id, name: "Combined QA", slug: `wallet-combo-${randomUUID()}` } });
    const release = await prisma.release.create({ data: { projectId: project.id, createdById: owner.id, versionName: "1", versionCode: 1,
      changelog: "Combined QA", status: "PUBLISHED", accessPolicy: { create: { requireVerifiedSeeker: true, requireInviteAcceptance: true } } } });
    const wallet = await prisma.wallet.create({ data: { userId: owner.id, address, verifiedAt: new Date(), isPrimary: true,
      seekerGenesisVerifiedAt: new Date(0), seekerGenesisVerificationExpiresAt: new Date(1) } });
    const guestResponse = await http("/sign-in/anonymous", {});
    expect(guestResponse.status).toBe(200);
    const guestCookie = cookieOf(guestResponse);
    const guest = await guestResponse.json();
    users.add(guest.user.id);
    const invite = await prisma.inviteLink.create({ data: { projectId: project.id, releaseId: release.id, createdById: owner.id, label: "QA", tokenHash: randomUUID() } });
    const claim = await prisma.inviteClaim.create({ data: { inviteLinkId: invite.id, userId: guest.user.id } });
    const challengeResponse = await issue(new Request(`${origin}/api/wallet/challenge`, { method: "POST",
      headers: { origin, cookie: guestCookie, "content-type": "application/json" },
      body: JSON.stringify({ address, purpose: "SIGN_IN_AND_VERIFY_SGT", sgtContext: { releaseId: release.id } }),
    }));
    expect(challengeResponse.status).toBe(200);
    const challenge = await challengeResponse.json();
    challenges.add(challenge.challengeId);
    const proof = { challengeId: challenge.challengeId, address, purpose: "SIGN_IN_AND_VERIFY_SGT",
      signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(challenge.message), key.secretKey)) };
    if (outcome === "verified") chain.verify.mockResolvedValue({ verified: true, mintAddress: bs58.encode(nacl.sign.keyPair().publicKey) });
    else {
      const { SeekerVerificationUnavailableError } = await import("@/src/lib/solana/sgt");
      chain.verify.mockRejectedValue(new SeekerVerificationUnavailableError());
    }
    const response = await http("/sign-in/solana-wallet", proof, guestCookie);
    const result = await response.json();
    expect(response.status, JSON.stringify(result)).toBe(200);
    expect(result).toMatchObject({ success: true, user: { id: owner.id }, sgt: { verified: outcome === "verified",
      status: outcome === "verified" ? "verified" : "unavailable" } });
    const authenticatedCookie = cookieOf(response);
    const session = await http("/get-session", undefined, authenticatedCookie);
    expect((await session.json()).user.id).toBe(owner.id);
    expect(await prisma.user.findUnique({ where: { id: guest.user.id } })).toBeNull();
    expect(chain.verify).toHaveBeenCalledExactlyOnceWith(address);
    const freshWallet = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
    const freshClaim = await prisma.inviteClaim.findUniqueOrThrow({ where: { id: claim.id } });
    expect(freshClaim.userId).toBe(owner.id);
    if (outcome === "verified") {
      expect(freshWallet.seekerGenesisVerificationExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 86_000_000);
      expect(freshClaim.grantedAt).not.toBeNull();
    } else {
      expect(freshWallet.seekerGenesisVerificationExpiresAt).toEqual(new Date(1));
      expect(freshClaim.grantedAt).toBeNull();
    }
    expect((await http("/sign-in/solana-wallet", proof, authenticatedCookie)).status).toBe(400);
    expect(chain.verify).toHaveBeenCalledOnce();
  });
});
