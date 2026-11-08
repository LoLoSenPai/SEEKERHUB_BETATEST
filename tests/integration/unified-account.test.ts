import { randomBytes, randomUUID } from "node:crypto";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi, type MockInstance } from "vitest";
import { buildWalletChallengeMessage } from "@/src/lib/solana/wallet";

type Email = Parameters<typeof import("@/src/lib/email").sendTransactionalEmail>[0];
const { sendTransactionalEmail } = vi.hoisted(() => ({
  sendTransactionalEmail: vi.fn<(input: Email) => Promise<void>>().mockResolvedValue(undefined),
}));
vi.mock("@/src/lib/email", () => ({ sendTransactionalEmail }));

// Run only with the review wrapper, after migrating the disposable database.
const integration = process.env.RUN_INTEGRATION_TESTS === "true" ? describe : describe.skip;
const runId = randomUUID();
const userIds = new Set<string>();
const addresses = new Set<string>();
const challengeIds = new Set<string>();
const rateLimitKeys = new Set<string>();
let origin: string;
let safeEnvironment = false;
let prisma: typeof import("@/src/lib/db").prisma;
let auth: typeof import("@/src/lib/auth").auth;
let hashRateLimitIdentity: typeof import("@/src/lib/rate-limit").hashRateLimitIdentity;
let network: MockInstance<typeof fetch> | undefined;

function assertDisposableEnvironment() {
  if (process.env.NODE_ENV === "production") throw new Error("Never run unified account tests in production.");
  for (const name of ["DATABASE_URL", "DIRECT_DATABASE_URL", "BETTER_AUTH_URL", "NEXT_PUBLIC_APP_URL", "S3_ENDPOINT", "SOLANA_RPC_URL", "NEXT_PUBLIC_SOLANA_RPC_URL"]) {
    const url = new URL(process.env[name] ?? "http://missing.invalid");
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
      throw new Error(`${name} must explicitly point to loopback; use scripts/with-review-env.mjs.`);
    }
    if (name.includes("DATABASE_URL") && (!/^postgres(ql)?:$/.test(url.protocol) || !url.pathname.toLowerCase().includes("test"))) {
      throw new Error(`${name} must name a disposable local PostgreSQL test database.`);
    }
  }
  if (process.env.DATABASE_URL !== process.env.DIRECT_DATABASE_URL) {
    throw new Error("Both database URLs must target the same disposable database.");
  }
  origin = new URL(process.env.BETTER_AUTH_URL!).origin;
}

class CookieJar {
  readonly ip = `198.18.${randomBytes(1)[0]}.${randomBytes(1)[0]}`;
  private cookies = new Map<string, string>();
  header() { return [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; "); }
  accept(response: Response) {
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";", 1)[0];
      const separator = pair.indexOf("=");
      const name = pair.slice(0, separator);
      const value = pair.slice(separator + 1);
      if (!value || /;\s*Max-Age=0(?:;|$)/i.test(cookie)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
}

type AuthBody = {
  user?: { id: string; email: string; emailVerified: boolean; isAnonymous: boolean };
  session?: { id: string; userId: string };
  status?: boolean;
} | null;

async function authRequest(path: string, jar: CookieJar, body?: unknown) {
  const url = new URL(`${origin}/api/auth${path}`);
  rateLimitKeys.add(hashRateLimitIdentity(`better-auth:${jar.ip}|${url.pathname.replace("/api/auth", "")}`));
  const response = await auth.handler(new Request(url, {
    method: body === undefined ? "GET" : "POST",
    headers: { origin, cookie: jar.header(), "content-type": "application/json", "x-forwarded-for": jar.ip },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }));
  jar.accept(response);
  return response;
}

async function jsonRequest(path: string, jar: CookieJar, body?: unknown) {
  const response = await authRequest(path, jar, body);
  const text = await response.text();
  expect(response.status, text).toBe(200);
  return JSON.parse(text) as AuthBody;
}

function emailAddress(label: string) { return `unified-${label}-${randomUUID()}-${runId}@example.test`; }

async function user(emailVerified = true) {
  const id = randomUUID();
  userIds.add(id);
  return prisma.user.create({ data: { id, name: "Unified account regression", email: emailAddress("user"), emailVerified, isAnonymous: false } });
}

function capturedEmail(index: number, to: string, actionLabel: string) {
  expect(sendTransactionalEmail).toHaveBeenCalledTimes(index + 1);
  const email = sendTransactionalEmail.mock.calls[index][0];
  expect(email).toMatchObject({ to, actionLabel });
  const url = new URL(email.actionUrl);
  expect(url.origin).toBe(origin);
  expect(url.searchParams.get("token")).toBeTruthy();
  expect(url.searchParams.get("callbackURL")).toBe("/tester/account");
  return url;
}

async function followLink(url: URL, jar: CookieJar) {
  expect(url.pathname).toMatch(/^\/api\/auth\/(?:verify-email|magic-link\/verify)$/);
  const response = await authRequest(`${url.pathname.slice("/api/auth".length)}${url.search}`, jar);
  expect(response.status, await response.text()).toBe(302);
  expect(new URL(response.headers.get("location")!, origin).href).toBe(`${origin}/tester/account`);
}

async function assertSession(jar: CookieJar, id: string, email: string, emailVerified: boolean) {
  expect(jar.header()).toContain("session_token=");
  const session = await jsonRequest("/get-session", jar);
  expect(session?.user).toMatchObject({ id, email, emailVerified, isAnonymous: false });
  expect(session?.session?.userId).toBe(id);
  expect(await prisma.session.findUnique({ where: { id: session!.session!.id } })).toMatchObject({ userId: id });
}

async function magicSignIn(email: string, jar: CookieJar) {
  const index = sendTransactionalEmail.mock.calls.length;
  expect(await jsonRequest("/sign-in/magic-link", jar, { email, callbackURL: "/tester/account" })).toMatchObject({ status: true });
  const url = capturedEmail(index, email, "Continue to SeekerHub");
  await followLink(url, jar);
}

async function walletAccount() {
  const jar = new CookieJar();
  const key = nacl.sign.keyPair();
  const address = bs58.encode(key.publicKey);
  addresses.add(address);
  const nonce = randomUUID();
  const expiresAt = new Date(Date.now() + 600_000);
  const message = buildWalletChallengeMessage({ address, nonce, expiresAt, appUrl: origin, purpose: "SIGN_IN" });
  const challenge = await prisma.walletChallenge.create({ data: { address, nonce, expiresAt, message, purpose: "SIGN_IN" } });
  challengeIds.add(challenge.id);
  const result = await jsonRequest("/sign-in/solana-wallet", jar, {
    address, challengeId: challenge.id, signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(message), key.secretKey)),
  });
  const id = result!.user!.id;
  userIds.add(id);
  const account = await prisma.user.findUniqueOrThrow({ where: { id } });
  expect(account).toMatchObject({ isAnonymous: false, emailVerified: false });
  expect(account.email).toMatch(/^wallet-.+@seekerhub\.local$/);
  await assertSession(jar, id, account.email, false);
  return { jar, account, wallet: await prisma.wallet.findUniqueOrThrow({ where: { address } }) };
}

async function inviteActivity(userId: string) {
  const owner = await user();
  const project = await prisma.appProject.create({ data: { ownerId: owner.id, name: "Unified account activity", slug: `unified-${randomUUID()}` } });
  const group = await prisma.testerGroup.create({ data: { projectId: project.id, name: "Unified account QA" } });
  const release = await prisma.release.create({ data: { projectId: project.id, createdById: owner.id, versionName: "1.0", versionCode: 1, changelog: "Account regression" } });
  const invite = await prisma.inviteLink.create({ data: {
    projectId: project.id, releaseId: release.id, testerGroupId: group.id, createdById: owner.id, label: "One seat", tokenHash: randomUUID(), maxUses: 1,
  } });
  const claim = await prisma.inviteClaim.create({ data: { inviteLinkId: invite.id, userId, grantedAt: new Date() } });
  const membership = await prisma.testerMembership.create({ data: { projectId: project.id, testerGroupId: group.id, inviteLinkId: invite.id, userId } });
  const access = await prisma.testerAccess.create({ data: { projectId: project.id, userId } });
  const device = await prisma.deviceProfile.create({ data: { userId, platformLabel: "Unified account test device" } });
  const view = await prisma.releaseViewEvent.create({ data: { releaseId: release.id, userId, deviceProfileId: device.id } });
  const download = await prisma.downloadEvent.create({ data: { releaseId: release.id, userId, deviceProfileId: device.id } });
  const feedback = await prisma.feedbackReport.create({ data: {
    releaseId: release.id, userId, deviceProfileId: device.id, title: "Keep this history", description: "Email addition must not split account activity", severity: "LOW",
  } });
  return async () => {
    expect(await prisma.inviteClaim.findMany({ where: { inviteLinkId: invite.id } })).toEqual([claim]);
    expect(await prisma.testerMembership.findMany({ where: { projectId: project.id } })).toEqual([membership]);
    expect(await prisma.testerAccess.findMany({ where: { projectId: project.id } })).toEqual([access]);
    expect(await prisma.deviceProfile.findUnique({ where: { id: device.id } })).toEqual(device);
    expect(await prisma.releaseViewEvent.findMany({ where: { releaseId: release.id } })).toEqual([view]);
    expect(await prisma.downloadEvent.findMany({ where: { releaseId: release.id } })).toEqual([download]);
    expect(await prisma.feedbackReport.findMany({ where: { releaseId: release.id } })).toEqual([feedback]);
  };
}

integration("unified account email addition on disposable PostgreSQL", () => {
  beforeAll(async () => {
    // Guard before importing any backend module that initializes env or database clients.
    assertDisposableEnvironment();
    safeEnvironment = true;
    network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No email, RPC, or external HTTP calls allowed in unified account tests."));
    ({ prisma } = await import("@/src/lib/db"));
    ({ auth } = await import("@/src/lib/auth"));
    ({ hashRateLimitIdentity } = await import("@/src/lib/rate-limit"));
  });

  afterEach(() => {
    if (network) expect(network).not.toHaveBeenCalled();
  });

  afterAll(async () => {
    try {
      if (!safeEnvironment || !prisma) return;
      // Recover IDs if a wallet HTTP posthook failed after committing its account.
      const owned = await prisma.user.findMany({ where: { OR: [
        { id: { in: [...userIds] } }, { wallets: { some: { address: { in: [...addresses] } } } },
      ] }, select: { id: true } });
      owned.forEach(({ id }) => userIds.add(id));
      const identifiers = sendTransactionalEmail.mock.calls.map(([email]) => {
        const url = new URL(email.actionUrl);
        return url.pathname.endsWith("/magic-link/verify") ? `magic-link:${url.searchParams.get("token")}` : null;
      }).filter((identifier): identifier is string => identifier !== null);
      const verifications = await prisma.verification.findMany({ where: { identifier: { in: identifiers } }, select: { id: true } });
      const limits = await prisma.rateLimit.findMany({ where: { key: { in: [...rateLimitKeys] } }, select: { id: true } });
      await prisma.verification.deleteMany({ where: { id: { in: verifications.map(({ id }) => id) } } });
      await prisma.rateLimit.deleteMany({ where: { id: { in: limits.map(({ id }) => id) } } });
      await prisma.walletChallenge.deleteMany({ where: { id: { in: [...challengeIds] } } });
      await prisma.auditLog.deleteMany({ where: { OR: [
        { actorUserId: { in: [...userIds] } }, { targetType: "User", targetId: { in: [...userIds] } },
      ] } });
      await prisma.user.deleteMany({ where: { id: { in: [...userIds] } } });
    } finally {
      network?.mockRestore();
    }
  });

  it("verifies a fresh real email on the same durable wallet account without losing activity or creating a builder", async () => {
    const { jar, account, wallet } = await walletAccount();
    const assertActivity = await inviteActivity(account.id);
    const email = emailAddress("wallet");
    const index = sendTransactionalEmail.mock.calls.length;
    expect(await prisma.builderProfile.count({ where: { userId: account.id } })).toBe(0);
    expect(await jsonRequest("/change-email", jar, { newEmail: email, callbackURL: "/tester/account" })).toMatchObject({ status: true });
    const link = capturedEmail(index, email, "Verify email");
    expect(link.pathname).toBe("/api/auth/verify-email");
    expect(await prisma.user.findUnique({ where: { id: account.id } })).toEqual(account);
    expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
    await assertSession(jar, account.id, account.email, false);
    await assertActivity();

    await followLink(link, jar);
    expect(await prisma.user.findUnique({ where: { email } })).toMatchObject({ id: account.id, emailVerified: true, isAnonymous: false });
    expect(await prisma.user.findUnique({ where: { email: account.email } })).toBeNull();
    await assertSession(jar, account.id, email, true);
    const freshBrowser = new CookieJar();
    await magicSignIn(email, freshBrowser);
    await assertSession(freshBrowser, account.id, email, true);
    expect(await prisma.wallet.findMany({ where: { userId: account.id } })).toEqual([wallet]);
    await assertActivity();
    expect(await prisma.builderProfile.count({ where: { userId: account.id } })).toBe(0);
  });

  it("requires old verified address confirmation before sending and accepting new address verification", async () => {
    const account = await user();
    const jar = new CookieJar();
    await magicSignIn(account.email, jar);
    const email = emailAddress("replacement");
    const index = sendTransactionalEmail.mock.calls.length;
    expect(await jsonRequest("/change-email", jar, { newEmail: email, callbackURL: "/tester/account" })).toMatchObject({ status: true });
    const confirmation = capturedEmail(index, account.email, "Confirm email change");
    expect(await prisma.user.findUnique({ where: { id: account.id } })).toEqual(account);
    await assertSession(jar, account.id, account.email, true);

    await followLink(confirmation, jar);
    const verification = capturedEmail(index + 1, email, "Verify email");
    expect(verification.href).not.toBe(confirmation.href);
    expect(await prisma.user.findUnique({ where: { id: account.id } })).toEqual(account);
    expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
    await assertSession(jar, account.id, account.email, true);

    await followLink(verification, jar);
    await assertSession(jar, account.id, email, true);
    expect(await prisma.user.findUnique({ where: { email } })).toMatchObject({ id: account.id, emailVerified: true });
    expect(await prisma.user.findUnique({ where: { email: account.email } })).toBeNull();
    expect(await prisma.builderProfile.count({ where: { userId: account.id } })).toBe(0);
  });

  it.each([false, true])("does not merge or take over an existing email account (source emailVerified=%s)", async (verified) => {
    const { jar, account, wallet } = await walletAccount();
    if (verified) {
      // A verified source must also be unable to take over an occupied address.
      await prisma.user.update({ where: { id: account.id }, data: { email: emailAddress("verified-source"), emailVerified: true } });
    }
    const source = await prisma.user.findUniqueOrThrow({ where: { id: account.id } });
    const target = await user();
    const profile = await prisma.builderProfile.create({ data: { userId: target.id, maxProjects: 3 } });
    const assertActivity = await inviteActivity(account.id);
    const index = sendTransactionalEmail.mock.calls.length;
    // BetterAuth deliberately returns the same success shape to avoid email enumeration.
    expect(await jsonRequest("/change-email", jar, { newEmail: target.email, callbackURL: "/tester/account" })).toMatchObject({ status: true });
    expect(sendTransactionalEmail).toHaveBeenCalledTimes(index);
    expect(await prisma.user.findUnique({ where: { id: account.id } })).toEqual(source);
    expect(await prisma.user.findUnique({ where: { id: target.id } })).toEqual(target);
    expect(await prisma.wallet.findMany({ where: { userId: account.id } })).toEqual([wallet]);
    expect(await prisma.wallet.count({ where: { userId: target.id } })).toBe(0);
    expect(await prisma.builderProfile.findUnique({ where: { userId: target.id } })).toEqual(profile);
    expect(await prisma.builderProfile.count({ where: { userId: account.id } })).toBe(0);
    await assertActivity();
    await assertSession(jar, account.id, source.email, verified);
    const targetBrowser = new CookieJar();
    await magicSignIn(target.email, targetBrowser);
    await assertSession(targetBrowser, target.id, target.email, true);
    await assertSession(jar, account.id, source.email, verified);
    expect(await prisma.builderProfile.findUnique({ where: { userId: target.id } })).toEqual(profile);
  });

  it("signs an existing builder back into the same ID with its profile unchanged via magic link", async () => {
    const account = await user();
    const profile = await prisma.builderProfile.create({ data: { userId: account.id, maxProjects: 4, maxStoredReleases: 7, usedStorageBytes: 123n } });
    const jar = new CookieJar();
    expect(await jsonRequest("/get-session", jar)).toBeNull();
    await magicSignIn(account.email, jar);
    await assertSession(jar, account.id, account.email, true);
    expect(await prisma.user.findUnique({ where: { email: account.email } })).toEqual(account);
    expect(await prisma.builderProfile.findUnique({ where: { userId: account.id } })).toEqual(profile);
  });

  it("rejects email addition without an authenticated session and sends no email", async () => {
    const email = emailAddress("unauthenticated");
    const index = sendTransactionalEmail.mock.calls.length;
    const response = await authRequest("/change-email", new CookieJar(), { newEmail: email, callbackURL: "/tester/account" });
    expect(response.status, await response.text()).toBe(401);
    expect(sendTransactionalEmail).toHaveBeenCalledTimes(index);
    expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
  });

  it("limits change-email to five requests per fifteen minutes without changing the account", async () => {
    const { jar, account } = await walletAccount();
    const index = sendTransactionalEmail.mock.calls.length;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const email = emailAddress("rate-limit");
      expect(await jsonRequest("/change-email", jar, { newEmail: email, callbackURL: "/tester/account" })).toMatchObject({ status: true });
      capturedEmail(index + attempt, email, "Verify email");
    }
    const response = await authRequest("/change-email", jar, { newEmail: emailAddress("blocked"), callbackURL: "/tester/account" });
    expect(response.status, await response.text()).toBe(429);
    const retryAfter = Number(response.headers.get("x-retry-after"));
    expect(retryAfter).toBeGreaterThan(850);
    expect(retryAfter).toBeLessThanOrEqual(900);
    expect(sendTransactionalEmail).toHaveBeenCalledTimes(index + 5);
    expect(await prisma.user.findUnique({ where: { id: account.id } })).toEqual(account);
    expect(await prisma.builderProfile.count({ where: { userId: account.id } })).toBe(0);
    await assertSession(jar, account.id, account.email, false);
  });
});
