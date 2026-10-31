import { randomBytes, randomUUID } from "node:crypto";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildWalletChallengeMessage } from "@/src/lib/solana/wallet";

// Run only via scripts/with-review-env.mjs, after the disposable DB is migrated.
const integration = process.env.RUN_INTEGRATION_TESTS === "true" ? describe : describe.skip;
const runId = randomUUID();
const userIds = new Set<string>();
const addresses = new Set<string>();
const challengeIds = new Set<string>();
const authPaths = new Set<string>();
const testIp = `198.18.${randomBytes(1)[0]}.${randomBytes(1)[0]}`;
let safeEnvironment = false;
let origin: string;
let prisma: typeof import("@/src/lib/db").prisma;
let auth: typeof import("@/src/lib/auth").auth;
let continueWalletAccount: typeof import("@/src/lib/solana/wallet-account").continueWalletAccount;
let queries: typeof import("@/src/features/projects/queries");
let reconcilePendingInviteGrants: typeof import("@/src/lib/invite-access").reconcilePendingInviteGrants;
let issueChallenge: typeof import("@/app/api/wallet/challenge/route").POST;
let download: typeof import("@/app/api/downloads/[releaseId]/route").GET;
let hashRateLimitIdentity: typeof import("@/src/lib/rate-limit").hashRateLimitIdentity;

function assertDisposableEnvironment() {
  if (process.env.NODE_ENV === "production") throw new Error("Never run wallet recovery tests in production.");
  for (const name of ["DATABASE_URL", "DIRECT_DATABASE_URL", "BETTER_AUTH_URL", "NEXT_PUBLIC_APP_URL", "S3_ENDPOINT", "SOLANA_RPC_URL", "NEXT_PUBLIC_SOLANA_RPC_URL"]) {
    const url = new URL(process.env[name] ?? "http://missing.invalid");
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
      throw new Error(`${name} must explicitly point to loopback; use scripts/with-review-env.mjs.`);
    }
    if (name.includes("DATABASE_URL") && (!/^postgres(ql)?:$/.test(url.protocol) || !url.pathname.toLowerCase().includes("test"))) {
      throw new Error(`${name} must name a disposable PostgreSQL test database.`);
    }
  }
  origin = new URL(process.env.BETTER_AUTH_URL!).origin;
}

function walletIdentity() {
  const key = nacl.sign.keyPair();
  const address = bs58.encode(key.publicKey);
  addresses.add(address);
  return { key, address };
}
type Identity = ReturnType<typeof walletIdentity>;
type Purpose = "SIGN_IN" | "LINK" | "VERIFY_SGT";

async function user(isAnonymous = true) {
  const result = await prisma.user.create({ data: {
    name: "Wallet recovery regression", email: `wallet-recovery-${randomUUID()}-${runId}@example.test`, isAnonymous,
  } });
  userIds.add(result.id);
  return result;
}

async function proof(identity: Identity, currentUserId: string | null = null, options: {
  purpose?: Purpose; expiresAt?: Date; message?: (message: string) => string;
} = {}) {
  const nonce = randomUUID();
  const expiresAt = options.expiresAt ?? new Date(Date.now() + 600_000);
  const purpose = options.purpose ?? "SIGN_IN";
  const message = buildWalletChallengeMessage({ address: identity.address, nonce, appUrl: origin, purpose, expiresAt });
  const challenge = await prisma.walletChallenge.create({ data: {
    address: identity.address, userId: currentUserId, nonce, expiresAt, purpose,
    message: options.message ? options.message(message) : message,
  } });
  challengeIds.add(challenge.id);
  return { challengeId: challenge.id, address: identity.address, currentUserId,
    signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(challenge.message), identity.key.secretKey)) };
}

async function continueAccount(input: Parameters<typeof continueWalletAccount>[0]) {
  const result = await continueWalletAccount(input);
  userIds.add(result.id);
  return result;
}

class CookieJar {
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

type AuthBody = { user?: { id: string; isAnonymous: boolean }; session?: { id: string; userId: string }; code?: string; success?: boolean } | null;
async function authRequest(path: string, jar: CookieJar, body?: unknown) {
  authPaths.add(path);
  const response = await auth.handler(new Request(`${origin}/api/auth${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { origin, "content-type": "application/json", cookie: jar.header(), "x-forwarded-for": testIp },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }));
  jar.accept(response);
  const text = await response.text();
  const data = JSON.parse(text) as AuthBody;
  if (data?.user?.id) userIds.add(data.user.id);
  return { response, data, text };
}

async function anonymous(jar: CookieJar) {
  const result = await authRequest("/sign-in/anonymous", jar, {});
  expect(result.response.status, result.text).toBe(200);
  expect(result.data?.user?.isAnonymous).toBe(true);
  expect(jar.header()).toContain("session_token=");
  return result.data!.user!.id;
}

async function httpProof(identity: Identity, jar: CookieJar) {
  const response = await issueChallenge(new Request(`${origin}/api/wallet/challenge`, {
    method: "POST", headers: { origin, "content-type": "application/json", cookie: jar.header(), "x-forwarded-for": testIp },
    body: JSON.stringify({ address: identity.address, purpose: "SIGN_IN" }),
  }));
  const text = await response.text();
  expect(response.status, text).toBe(200);
  const data = JSON.parse(text) as { challengeId: string; message: string };
  challengeIds.add(data.challengeId);
  const stored = await prisma.walletChallenge.findUniqueOrThrow({ where: { id: data.challengeId } });
  expect(data.message).toContain(`Nonce: ${stored.nonce}\n`);
  expect(stored.nonce).not.toBe("");
  expect(stored.usedAt).toBeNull();
  return { challengeId: data.challengeId, address: identity.address,
    signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(data.message), identity.key.secretKey)) };
}

async function assertCookieUser(jar: CookieJar, expectedId: string) {
  const result = await authRequest("/get-session", jar);
  expect(result.response.status, result.text).toBe(200);
  expect(result.data?.user).toMatchObject({ id: expectedId, isAnonymous: false });
  const session = await prisma.session.findUniqueOrThrow({ where: { id: result.data!.session!.id } });
  expect(session.userId).toBe(expectedId);
  expect(await prisma.builderProfile.count({ where: { userId: expectedId } })).toBe(0);
}

async function fixture() {
  const owner = await user(false);
  const project = await prisma.appProject.create({ data: { ownerId: owner.id, name: "Wallet recovery test", slug: `wallet-recovery-${randomUUID()}` } });
  const group = await prisma.testerGroup.create({ data: { projectId: project.id, name: "Recovery QA" } });
  const release = await prisma.release.create({ data: {
    projectId: project.id, createdById: owner.id, versionName: "1.0", versionCode: 1, changelog: "Recovery regression", status: "PUBLISHED",
    accessPolicy: { create: { requireInviteAcceptance: true, testerGroupId: group.id } },
    // Only the real download authorization/event/URL-signing boundary is exercised, not APK bytes.
    buildAsset: { create: { storageKey: `wallet-recovery/${runId}/${randomUUID()}.apk`, bucket: process.env.S3_BUCKET!,
      originalFileName: "recovery.apk", contentType: "application/vnd.android.package-archive", fileSizeBytes: 1n,
      sha256Checksum: "0".repeat(64), validatedAt: new Date(), hasApkSignature: true } },
  } });
  const invite = await prisma.inviteLink.create({ data: {
    projectId: project.id, releaseId: release.id, testerGroupId: group.id, createdById: owner.id,
    label: "One recovery seat", tokenHash: randomUUID(), maxUses: 1,
  } });
  return { owner, project, group, release, invite };
}

async function downloadWithCookie(releaseId: string, jar: CookieJar) {
  const response = await download(new Request(`${origin}/api/downloads/${releaseId}`, {
    headers: { cookie: jar.header() },
  }), { params: Promise.resolve({ releaseId }) });
  expect(response.status, await response.clone().text()).toBe(307);
  const location = new URL(response.headers.get("location")!);
  expect(location.origin).toBe(new URL(process.env.S3_ENDPOINT!).origin);
  expect(location.searchParams.has("X-Amz-Signature")).toBe(true);
}

integration("wallet account recovery on disposable PostgreSQL", () => {
  beforeAll(async () => {
    // No backend module (and hence no env/client initialization) is imported before this guard.
    assertDisposableEnvironment();
    safeEnvironment = true;
    ({ prisma } = await import("@/src/lib/db"));
    ({ auth } = await import("@/src/lib/auth"));
    ({ continueWalletAccount } = await import("@/src/lib/solana/wallet-account"));
    queries = await import("@/src/features/projects/queries");
    ({ reconcilePendingInviteGrants } = await import("@/src/lib/invite-access"));
    ({ POST: issueChallenge } = await import("@/app/api/wallet/challenge/route"));
    ({ GET: download } = await import("@/app/api/downloads/[releaseId]/route"));
    ({ hashRateLimitIdentity } = await import("@/src/lib/rate-limit"));
  });

  afterAll(async () => {
    if (!safeEnvironment || !prisma) return;
    // Find committed wallet users even if an HTTP posthook failed before returning their ID.
    const owned = await prisma.user.findMany({ where: { OR: [
      { id: { in: [...userIds] } }, { wallets: { some: { address: { in: [...addresses] } } } },
      { email: { endsWith: `-${runId}@example.test` } },
    ] }, select: { id: true } });
    owned.forEach(({ id }) => userIds.add(id));
    await prisma.walletChallenge.deleteMany({ where: { id: { in: [...challengeIds] } } });
    await prisma.auditLog.deleteMany({ where: { OR: [
      { actorUserId: { in: [...userIds] } }, { targetType: "User", targetId: { in: [...userIds] } },
    ] } });
    await prisma.user.deleteMany({ where: { id: { in: [...userIds] } } });
    if (hashRateLimitIdentity) {
      await prisma.rateLimit.deleteMany({ where: { key: { in: [...authPaths].map((path) => hashRateLimitIdentity(`better-auth:${testIp}|${path}`)) } } });
      await prisma.rateLimitBucket.deleteMany({ where: { action: "wallet.challenge", keyHash: { in: [
        hashRateLimitIdentity(`ip:${testIp}:global`), ...[...userIds].map((id) => hashRateLimitIdentity(`user:${id}:global`)),
      ] } } });
    }
  });

  it("creates a durable wallet tester without a session or builder and consumes the real proof once", async () => {
    const identity = walletIdentity();
    const input = await proof(identity);
    const result = await continueAccount(input);
    expect(result).toMatchObject({ isAnonymous: false, emailVerified: false });
    expect(await prisma.wallet.findUnique({ where: { address: identity.address } })).toMatchObject({ userId: result.id, isPrimary: true });
    expect(await prisma.wallet.count({ where: { userId: result.id } })).toBe(1);
    expect(await prisma.builderProfile.count({ where: { userId: result.id } })).toBe(0);
    expect(await prisma.session.count({ where: { userId: result.id } })).toBe(0);
    expect(await prisma.account.count({ where: { userId: result.id } })).toBe(0);
    expect((await prisma.walletChallenge.findUniqueOrThrow({ where: { id: input.challengeId } })).usedAt).not.toBeNull();
    await expect(continueAccount(input)).rejects.toMatchObject({ status: 400, code: "CHALLENGE_USED" });
    expect(await prisma.auditLog.count({ where: { actorUserId: result.id, action: "tester.account_upgraded_wallet" } })).toBe(1);
    const recovered = await continueAccount(await proof(identity));
    expect(recovered.id).toBe(result.id);
    expect(await prisma.wallet.count({ where: { address: identity.address } })).toBe(1);
  });

  it("survives BetterAuth anonymous posthooks for same-user upgrade and deleted-guest cookie recovery without splitting history or seats", async () => {
    const identity = walletIdentity();
    const jar = new CookieJar();
    const originalId = await anonymous(jar);
    const { owner, project, group, release, invite } = await fixture();
    const originalClaim = await prisma.inviteClaim.create({ data: { inviteLinkId: invite.id, userId: originalId } });
    await reconcilePendingInviteGrants(originalId, project.id);
    const grantedAt = (await prisma.inviteClaim.findUniqueOrThrow({ where: { id: originalClaim.id } })).grantedAt;
    expect(grantedAt).not.toBeNull();
    await prisma.testerAccess.create({ data: { projectId: project.id, userId: originalId } });
    const device = await prisma.deviceProfile.create({ data: { userId: originalId, platformLabel: "Original test device" } });
    const feedback = await prisma.feedbackReport.create({ data: {
      releaseId: release.id, userId: originalId, deviceProfileId: device.id,
      title: "Original feedback", description: "Must survive wallet recovery", severity: "MEDIUM",
    } });
    const view = await prisma.releaseViewEvent.create({ data: { releaseId: release.id, userId: originalId, deviceProfileId: device.id } });
    await downloadWithCookie(release.id, jar);
    const firstDownload = await prisma.downloadEvent.findFirstOrThrow({ where: { releaseId: release.id } });
    expect((await queries.getBuilderDashboard(owner.id)).stats).toMatchObject({
      claims: 1, grantedPlaces: 1, occupiedPlaces: 1, viewers: { accounts: 0, guests: 1, total: 1 }, downloads: 1,
    });

    const upgradeProof = await httpProof(identity, jar);
    const upgrade = await authRequest("/sign-in/solana-wallet", jar, upgradeProof);
    expect(upgrade.response.status, upgrade.text).toBe(200);
    expect(upgrade.data?.user?.id).toBe(originalId);
    await assertCookieUser(jar, originalId);
    const replay = await authRequest("/sign-in/solana-wallet", jar, upgradeProof);
    expect(replay.response.status, replay.text).toBe(400);
    expect(replay.data?.code).toBe("CHALLENGE_USED");
    await assertCookieUser(jar, originalId);

    const signedInCookie = jar.header();
    const logout = await authRequest("/sign-out", jar, {});
    expect(logout.response.status, logout.text).toBe(200);
    expect(jar.header()).not.toContain("session_token=");
    expect((await authRequest("/get-session", jar)).data).toBeNull();
    const oldSession = await auth.handler(new Request(`${origin}/api/auth/get-session`, { headers: { cookie: signedInCookie, "x-forwarded-for": testIp } }));
    expect(await oldSession.json()).toBeNull();

    const guestId = await anonymous(jar);
    expect(guestId).not.toBe(originalId);
    const guestCookie = jar.header();
    await prisma.inviteClaim.create({ data: { inviteLinkId: invite.id, userId: guestId } });
    await prisma.testerMembership.create({ data: { projectId: project.id, testerGroupId: group.id, userId: guestId, inviteLinkId: invite.id } });
    await prisma.testerAccess.create({ data: { projectId: project.id, userId: guestId } });
    const guestDevice = await prisma.deviceProfile.create({ data: { userId: guestId, platformLabel: "Recovery test device" } });
    const guestView = await prisma.releaseViewEvent.create({ data: { releaseId: release.id, userId: guestId, deviceProfileId: guestDevice.id } });
    const guestFeedback = await prisma.feedbackReport.create({ data: {
      releaseId: release.id, userId: guestId, deviceProfileId: guestDevice.id,
      title: "Guest feedback", description: "Must move to the original tester", severity: "LOW",
    } });
    const recoveryProof = await httpProof(identity, jar);
    const recovery = await authRequest("/sign-in/solana-wallet", jar, recoveryProof);
    expect(recovery.response.status, recovery.text).toBe(200);
    expect(recovery.data?.user?.id).toBe(originalId);
    await assertCookieUser(jar, originalId);
    expect(await prisma.user.findUnique({ where: { id: guestId } })).toBeNull();
    expect(await prisma.session.count({ where: { userId: guestId } })).toBe(0);
    expect(await prisma.walletChallenge.findUnique({ where: { id: recoveryProof.challengeId } })).toBeNull();
    const staleGuest = await auth.handler(new Request(`${origin}/api/auth/get-session`, { headers: { cookie: guestCookie, "x-forwarded-for": testIp } }));
    expect(await staleGuest.json()).toBeNull();
    // A fourth sign-in HTTP request would test BetterAuth's burst limit instead of proof consumption.
    await expect(continueAccount({ ...recoveryProof, currentUserId: guestId })).rejects.toMatchObject({
      status: 400, code: "CHALLENGE_NOT_FOUND",
    });

    await downloadWithCookie(release.id, jar);
    const downloads = await prisma.downloadEvent.findMany({ where: { releaseId: release.id } });
    expect(downloads).toHaveLength(2);
    expect(new Set(downloads.map(({ id }) => id)).size).toBe(2);
    expect(downloads.every(({ userId }) => userId === originalId)).toBe(true);
    expect(downloads).toContainEqual(firstDownload);
    expect(await prisma.feedbackReport.findUnique({ where: { id: feedback.id } })).toEqual(feedback);
    expect(await prisma.feedbackReport.findUnique({ where: { id: guestFeedback.id } })).toMatchObject({ userId: originalId, deviceProfileId: guestDevice.id });
    expect(await prisma.deviceProfile.findUnique({ where: { id: guestDevice.id } })).toMatchObject({ userId: originalId });
    expect(await prisma.releaseViewEvent.findMany({ where: { releaseId: release.id } })).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: view.id, userId: originalId }), expect.objectContaining({ id: guestView.id, userId: originalId }),
    ]));
    expect(await prisma.inviteClaim.findMany({ where: { inviteLinkId: invite.id } })).toEqual([
      expect.objectContaining({ id: originalClaim.id, userId: originalId, grantedAt, revokedAt: null }),
    ]);
    expect(await prisma.testerMembership.count({ where: { projectId: project.id, testerGroupId: group.id } })).toBe(1);
    expect(await prisma.testerAccess.count({ where: { projectId: project.id } })).toBe(1);
    const outsider = await user();
    const outsiderClaim = await prisma.inviteClaim.create({ data: { inviteLinkId: invite.id, userId: outsider.id } });
    await reconcilePendingInviteGrants(outsider.id, project.id);
    await reconcilePendingInviteGrants(originalId, project.id);
    expect((await prisma.inviteClaim.findUniqueOrThrow({ where: { id: outsiderClaim.id } })).grantedAt).toBeNull();
    expect((await queries.getBuilderDashboard(owner.id)).stats).toMatchObject({
      claims: 2, pendingClaims: 1, grantedPlaces: 1, occupiedPlaces: 1, uniqueTesters: 1,
      uniqueViews: 1, viewers: { accounts: 1, guests: 0, total: 1 }, downloads: 2,
      uniqueDownloaders: 1, downloaders: { accounts: 1, guests: 0, total: 1 }, feedback: 2,
    });
    expect((await queries.getReleaseForOwner(project.slug, release.id, owner.id))?.analytics).toMatchObject({
      grantedPlaces: 1, occupiedPlaces: 1, viewers: { accounts: 1, guests: 0, total: 1 }, downloaders: { accounts: 1, guests: 0, total: 1 },
    });
  });

  it.each([
    ["claim", "durable"], ["claim", "guest"], ["membership", "durable"],
    ["membership", "guest"], ["access", "durable"], ["access", "guest"],
  ] as const)("preserves %s revocation from the %s side of a guest merge", async (kind, side) => {
    const identity = walletIdentity();
    const durable = await continueAccount(await proof(identity));
    const guest = await user();
    const { project, group, release, invite } = await fixture();
    const revokedAt = new Date(Date.now() - 60_000);
    for (const account of [durable, guest]) {
      const revoked = (side === "durable" ? durable.id : guest.id) === account.id;
      await prisma.inviteClaim.create({ data: { inviteLinkId: invite.id, userId: account.id,
        grantedAt: account.id === durable.id ? new Date() : null, revokedAt: revoked && kind === "claim" ? revokedAt : null } });
      await prisma.testerMembership.create({ data: { projectId: project.id, testerGroupId: group.id, userId: account.id,
        inviteLinkId: invite.id, revokedAt: revoked && kind === "membership" ? revokedAt : null } });
      await prisma.testerAccess.create({ data: { projectId: project.id, userId: account.id, revokedAt: revoked && kind === "access" ? revokedAt : null } });
    }
    expect((await continueAccount(await proof(identity, guest.id))).id).toBe(durable.id);
    expect(await prisma.user.findUnique({ where: { id: guest.id } })).toBeNull();
    await reconcilePendingInviteGrants(durable.id, project.id);
    const claims = await prisma.inviteClaim.findMany({ where: { inviteLinkId: invite.id } });
    const memberships = await prisma.testerMembership.findMany({ where: { projectId: project.id } });
    const accesses = await prisma.testerAccess.findMany({ where: { projectId: project.id } });
    expect(claims).toHaveLength(1);
    expect(memberships).toHaveLength(1);
    expect(accesses).toHaveLength(1);
    expect(claims[0].grantedAt).not.toBeNull();
    expect((kind === "claim" ? claims[0] : kind === "membership" ? memberships[0] : accesses[0]).revokedAt).toEqual(revokedAt);
    const decision = (await queries.getTesterRelease(release.id, durable.id))!.decision;
    expect(decision.canDownload).toBe(false);
    expect(decision.canSubmitFeedback).toBe(false);
    expect(await prisma.inviteClaim.count({ where: { inviteLinkId: invite.id, grantedAt: { not: null } } })).toBe(1);
  });

  it("returns 409 rather than merging two established accounts and leaves the proof unconsumed", async () => {
    const identity = walletIdentity();
    const durable = await continueAccount(await proof(identity));
    const established = await user(false);
    const builder = await prisma.builderProfile.create({ data: { userId: established.id } });
    const input = await proof(identity, established.id);
    await expect(continueAccount(input)).rejects.toMatchObject({ status: 409, code: "ACCOUNT_SWITCH_REQUIRED" });
    expect(await prisma.user.findUnique({ where: { id: durable.id } })).toEqual(durable);
    expect(await prisma.user.findUnique({ where: { id: established.id } })).toEqual(established);
    expect(await prisma.builderProfile.findUnique({ where: { userId: established.id } })).toEqual(builder);
    expect(await prisma.wallet.findUnique({ where: { address: identity.address } })).toMatchObject({ userId: durable.id });
    expect((await prisma.walletChallenge.findUniqueOrThrow({ where: { id: input.challengeId } })).usedAt).toBeNull();
    expect(await prisma.auditLog.count({ where: { actorUserId: established.id } })).toBe(0);
  });

  it.each(["malformed-base58", "wrong-length", "wrong-key", "wrong-message", "wrong-address", "purpose-link", "purpose-sgt", "wrong-host", "wrong-uri", "expired"])(
    "rejects %s without consuming the challenge or creating a wallet", async (condition) => {
      const identity = walletIdentity();
      const input = await proof(identity, null, {
        purpose: condition === "purpose-link" ? "LINK" : condition === "purpose-sgt" ? "VERIFY_SGT" : "SIGN_IN",
        ...(condition === "expired" ? { expiresAt: new Date(Date.now() - 60_000) } : {}),
        ...(condition === "wrong-host" ? { message: (message: string) => message.replace(new URL(origin).host, "other.example.test") } : {}),
        ...(condition === "wrong-uri" ? { message: (message: string) => message.replace(`URI: ${origin}\n`, "URI: https://other.example.test\n") } : {}),
      });
      if (condition === "malformed-base58") input.signature = "0".repeat(88);
      if (condition === "wrong-length") input.signature = bs58.encode(randomBytes(32));
      if (condition === "wrong-key") {
        const challenge = await prisma.walletChallenge.findUniqueOrThrow({ where: { id: input.challengeId } });
        input.signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(challenge.message), nacl.sign.keyPair().secretKey));
      }
      if (condition === "wrong-message") input.signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode("Different nonce and message"), identity.key.secretKey));
      if (condition === "wrong-address") input.address = walletIdentity().address;
      const code = condition.startsWith("purpose-") || condition === "wrong-address" ? "CHALLENGE_NOT_FOUND"
        : condition === "expired" ? "CHALLENGE_USED" : "INVALID_WALLET_SIGNATURE";
      await expect(continueAccount(input)).rejects.toMatchObject({ status: 400, code });
      expect((await prisma.walletChallenge.findUniqueOrThrow({ where: { id: input.challengeId } })).usedAt).toBeNull();
      expect(await prisma.wallet.count({ where: { address: { in: [identity.address, input.address] } } })).toBe(0);
    },
  );

  it.each(["guest-to-none", "guest-to-other", "none-to-guest"])("rejects session drift (%s) even with a valid signature", async (condition) => {
    const identity = walletIdentity();
    const guest = await user();
    const input = await proof(identity, condition === "none-to-guest" ? null : guest.id);
    input.currentUserId = condition === "guest-to-none" ? null : condition === "guest-to-other" ? (await user()).id : guest.id;
    await expect(continueAccount(input)).rejects.toMatchObject({ status: 409, code: "SESSION_CHANGED" });
    expect((await prisma.walletChallenge.findUniqueOrThrow({ where: { id: input.challengeId } })).usedAt).toBeNull();
    expect(await prisma.wallet.count({ where: { address: identity.address } })).toBe(0);
    expect(await prisma.user.findUnique({ where: { id: guest.id } })).toEqual(guest);
  });

  it("converges concurrent first sign-ins with independent guest/no-session proofs to one durable wallet user", async () => {
    const identity = walletIdentity();
    const first = await user();
    const second = await user();
    const inputs = [await proof(identity), await proof(identity, first.id), await proof(identity, second.id)];
    const results = await Promise.allSettled(inputs.map(continueAccount));
    expect(results.filter((result) => result.status === "rejected")).toEqual([]);
    const successes = results.filter((result) => result.status === "fulfilled").map((result) => result.value);
    expect(successes).toHaveLength(3);
    expect(new Set(successes.map(({ id }) => id)).size).toBe(1);
    const targetId = successes[0].id;
    expect(await prisma.wallet.findMany({ where: { address: identity.address } })).toEqual([expect.objectContaining({ userId: targetId })]);
    expect(await prisma.user.count({ where: { id: { in: [...new Set([first.id, second.id, targetId])] } } })).toBe(1);
    expect(await prisma.user.findUnique({ where: { id: targetId } })).toMatchObject({ isAnonymous: false });
    expect(await prisma.builderProfile.count({ where: { userId: targetId } })).toBe(0);
    expect(await prisma.walletChallenge.count({ where: { id: { in: inputs.map(({ challengeId }) => challengeId) }, usedAt: null } })).toBe(0);
  });

  it.each(["fresh", "merged-guest"])("allows only one success for concurrent use of the same %s proof", async (condition) => {
    const identity = walletIdentity();
    const durable = condition === "merged-guest" ? await continueAccount(await proof(identity)) : null;
    const guest = condition === "merged-guest" ? await user() : null;
    const input = await proof(identity, guest?.id ?? null);
    const results = await Promise.allSettled([continueAccount(input), continueAccount(input)]);
    const successes = results.filter((result) => result.status === "fulfilled");
    expect(successes).toHaveLength(1);
    const failed = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
    expect(failed.reason).toMatchObject({ status: 400, code: condition === "fresh" ? "CHALLENGE_USED" : "CHALLENGE_NOT_FOUND" });
    const targetId = successes[0].value.id;
    if (durable) expect(targetId).toBe(durable.id);
    if (guest) expect(await prisma.user.findUnique({ where: { id: guest.id } })).toBeNull();
    expect(await prisma.wallet.count({ where: { address: identity.address } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { actorUserId: targetId,
      action: condition === "fresh" ? "tester.account_upgraded_wallet" : "tester.account_recovered_wallet" } })).toBe(1);
  });
});
