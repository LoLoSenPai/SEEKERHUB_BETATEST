import { createHash, randomBytes, randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import bs58 from "bs58";
import nacl from "tweetnacl";

// Requires explicitly enabled, disposable loopback services (review wrapper or CI).
// Local review: wait for the parent's server-ready notification, then use:
// REVIEW_REUSE_SERVER=true node scripts/with-review-env.mjs node_modules/@playwright/test/cli.js test tests/e2e/wallet-journey.spec.ts
function reviewEnvironment() {
  const databaseUrl = process.env.DATABASE_URL;
  const baseUrl = process.env.PLAYWRIGHT_BASE_URL || process.env.NEXT_PUBLIC_APP_URL;
  const bucket = process.env.S3_BUCKET;
  if (!databaseUrl || !baseUrl || !bucket || !process.env.S3_ENDPOINT ||
      !process.env.BETTER_AUTH_URL || !process.env.NEXT_PUBLIC_APP_URL ||
      process.env.RUN_INTEGRATION_TESTS !== "true") {
    throw new Error("An explicitly enabled local integration environment is required.");
  }
  const database = new URL(databaseUrl);
  const server = new URL(baseUrl);
  const auth = new URL(process.env.BETTER_AUTH_URL);
  const app = new URL(process.env.NEXT_PUBLIC_APP_URL);
  const storage = new URL(process.env.S3_ENDPOINT);
  const isLoopback = (url: URL) => ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  const isAppOrigin = (url: URL) => url.protocol === "http:" && isLoopback(url) &&
    url.pathname === "/" && !url.search && !url.hash && !url.username && !url.password;
  if (!["postgres:", "postgresql:"].includes(database.protocol) || !isLoopback(database) ||
      !database.pathname.toLowerCase().includes("test") ||
      ![server, auth, app].every(isAppOrigin) || server.origin !== auth.origin || server.origin !== app.origin ||
      !isLoopback(storage) || !["http:", "https:"].includes(storage.protocol) || storage.username || storage.password) {
    throw new Error("Wallet E2E requires a loopback test database, matching app/auth URLs and local storage.");
  }
  return { databaseUrl, baseUrl: server.origin, bucket };
}

const walletName = "Review Journey Wallet";
const connectWalletLabel = /^(Connect wallet|Use installed wallet)$/;
const combinedSignInLabel = "Continue with wallet + check SGT";
// A deliberately untrusted UA hint, not a Seeker Connect wallet or an SGT proof.
const hintedUserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Seeker";

function isolatedReviewHeaders() {
  // One stable client IP per loopback-only test, not a fresh identity per request.
  // Repeated suites must not share the entire machine's invitation/auth buckets.
  const octets = randomBytes(2);
  return { "x-forwarded-for": `198.18.${octets[0]}.${octets[1]}` };
}

async function installWallet(context: BrowserContext, keypair: nacl.SignKeyPair, name = walletName) {
  const signedMessages: Uint8Array[] = [];
  const address = bs58.encode(keypair.publicKey);
  const bridgeName = `__reviewSignWalletMessage_${address}`;
  const requests: Array<{ path: string; body: unknown }> = [];
  context.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (request.method() === "POST" && (path.startsWith("/api/wallet/") || path.startsWith("/api/auth/"))) {
      requests.push({ path, body: request.postDataJSON() });
    }
  });
  // Only message bytes cross the bridge. The ephemeral secret key stays in Node.
  await context.exposeFunction(bridgeName, (bytes: number[]) => {
    const message = Uint8Array.from(bytes);
    signedMessages.push(message);
    return Array.from(nacl.sign.detached(message, keypair.secretKey));
  });
  await context.addInitScript(({ address, publicKey, name, bridgeName }) => {
    // Context init scripts also run in opaque about:blank documents.
    if (!["http:", "https:"].includes(window.location.protocol)) return;
    const listeners = new Set<(properties: { accounts: typeof account[] }) => void>();
    const account = Object.freeze({
      address, publicKey: Uint8Array.from(publicKey),
      chains: ["solana:mainnet"], features: ["solana:signMessage", "solana:signTransaction"],
    });
    const connectionKey = `__reviewWalletConnected:${address}`;
    let connected = sessionStorage.getItem(connectionKey) === address;
    const accounts = () => connected ? [account] : [];
    const notify = () => listeners.forEach((listener) => listener({ accounts: accounts() }));
    // Ordinary Wallet Standard only: no Seeker Connect feature or SGT attestation.
    const wallet = {
      version: "1.0.0", name,
      icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMiIgaGVpZ2h0PSIzMiI+PHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiBmaWxsPSIjMDA4ODg4Ii8+PC9zdmc+",
      chains: ["solana:mainnet"],
      get accounts() { return accounts(); },
      features: {
        "standard:connect": { version: "1.0.0", connect: async (options?: { silent?: boolean }) => {
          if (!options?.silent) {
            connected = true;
            sessionStorage.setItem(connectionKey, address);
            notify();
          }
          return { accounts: accounts() };
        } },
        "standard:disconnect": { version: "1.0.0", disconnect: async () => {
          connected = false;
          sessionStorage.removeItem(connectionKey);
          notify();
        } },
        "standard:events": { version: "1.0.0", on: (event: string, listener: (properties: { accounts: typeof account[] }) => void) => {
          if (event !== "change") throw new Error(`Unexpected wallet event: ${event}`);
          listeners.add(listener);
          return () => { listeners.delete(listener); };
        } },
        // Required for adapter compatibility, but transactions are forbidden here.
        "solana:signTransaction": { version: "1.0.0", supportedTransactionVersions: ["legacy", 0],
          signTransaction: async () => { throw new Error("Wallet journey must never sign transactions."); } },
        "solana:signMessage": { version: "1.0.0", signMessage: async (...inputs: Array<{ message: Uint8Array; account: { address: string } }>) => {
          if (!connected) throw new Error("Wallet not connected.");
          const bridge = window as unknown as Record<string, (bytes: number[]) => Promise<number[]>>;
          return Promise.all(inputs.map(async (input) => {
            if (input.account.address !== address) throw new Error("Unexpected signing account.");
            const signature = await bridge[bridgeName](Array.from(input.message));
            return { signedMessage: input.message, signature: Uint8Array.from(signature), signatureType: "ed25519" };
          }));
        } },
      },
    };
    type Registry = { register: (candidate: typeof wallet) => unknown };
    const register = (registry: Registry) => { registry.register(wallet); };
    window.addEventListener("wallet-standard:app-ready", (event) => register((event as CustomEvent<Registry>).detail));
    window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: register }));
  }, { address, publicKey: Array.from(keypair.publicKey), name, bridgeName });
  return { signedMessages, requests };
}

async function connectWallet(page: Page) {
  await page.getByRole("button", { name: connectWalletLabel }).click();
  // The installed adapter adds an icon alt text and a "Detected" badge.
  await page.getByRole("button", { name: new RegExp(walletName) }).click();
  await expect(page.getByRole("button", { name: combinedSignInLabel, exact: true })).toBeEnabled();
}

async function sessionUser(context: BrowserContext, baseUrl: string) {
  const response = await context.request.get(`${baseUrl}/api/auth/get-session`);
  expect(response.ok()).toBe(true);
  const payload = await response.json();
  return payload?.user ?? null;
}

async function continueWithWallet(page: Page) {
  const invitePath = new URL(page.url()).pathname;
  const claimed = page.waitForResponse((response) =>
    new URL(response.url()).pathname === `/api${invitePath.replace("/invite/", "/invites/")}/claim` &&
    response.request().method() === "POST").catch(() => null);
  const signedIn = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/auth/sign-in/solana-wallet" && response.request().method() === "POST");
  await page.getByRole("button", { name: combinedSignInLabel, exact: true }).click();
  const response = await signedIn;
  expect(response.status()).toBe(200);
  const result = await response.json();
  expect(result.success).toBe(true);
  // Real local backend response: an unavailable chain check must not undo authentication.
  expect(result.sgt).toMatchObject({ status: "unavailable", verified: false, code: "SGT_RPC_UNAVAILABLE",
    mintAddress: null, expiresAt: null });
  const claim = await claimed;
  expect(claim, "Explicit sign-in must be followed by an invitation claim").not.toBeNull();
  expect(claim!.status(), `Invitation claim after successful authentication: ${await claim!.text()}`).toBe(200);
  return result.user as { id: string; isAnonymous: boolean };
}

test("one explicit combined signature retains login on RPC outage and recovers one tester across browsers", async ({ browser }, testInfo) => {
  test.setTimeout(120_000);
  const { databaseUrl, baseUrl, bucket } = reviewEnvironment();
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const keypair = nacl.sign.keyPair();
  const address = bs58.encode(keypair.publicKey);
  const id = randomUUID();
  const clientHeaders = isolatedReviewHeaders();
  const token = `wallet-journey-${id}`;
  const contexts: BrowserContext[] = [];
  const pageErrors: string[] = [];
  let ownerId: string | undefined;
  let projectId: string | undefined;
  let testerId: string | undefined;
  try {
    const owner = await prisma.user.create({ data: { name: "Wallet journey fixture owner", email: `wallet-owner-${id}@example.test` } });
    ownerId = owner.id;
    const project = await prisma.appProject.create({ data: { ownerId, slug: `wallet-journey-${id}`, name: `Wallet journey ${id}` } });
    projectId = project.id;
    const release = await prisma.release.create({ data: {
      projectId, createdById: ownerId, status: "PUBLISHED", publishedAt: new Date(),
      versionName: "1.0.0", versionCode: 1, changelog: "Local wallet journey fixture, not a chain verification.",
      accessPolicy: { create: { requireInviteAcceptance: true, requireLinkedWallet: true, requireVerifiedSeeker: true } },
      buildAsset: { create: { storageKey: `wallet-journey/${id}/fixture.apk`, bucket,
        originalFileName: "fixture.apk", contentType: "application/vnd.android.package-archive",
        fileSizeBytes: 1, sha256Checksum: "fixture-only", validatedAt: new Date() } },
    } });
    const invite = await prisma.inviteLink.create({ data: {
      projectId, releaseId: release.id, createdById: ownerId, label: "Wallet journey fixture", maxUses: 1,
      tokenHash: createHash("sha256").update(token).digest("hex"),
    } });
    const inviteUrl = `${baseUrl}/invite/${token}`;
    const testerUrl = `${baseUrl}/tester/releases/${release.id}`;

    async function newWalletBrowser() {
      const context = await browser.newContext({ userAgent: hintedUserAgent, viewport: { width: 390, height: 844 }, extraHTTPHeaders: clientHeaders });
      contexts.push(context);
      context.on("page", (page) => page.on("pageerror", (error) => pageErrors.push(error.message)));
      const mock = await installWallet(context, keypair);
      const page = await context.newPage();
      await page.goto(inviteUrl);
      await expect(page.getByRole("button", { name: connectWalletLabel })).toBeVisible();
      await expect(page.getByRole("button", { name: /guest/i })).toHaveCount(0);
      expect(await sessionUser(context, baseUrl)).toBeNull();
      expect((await context.cookies()).filter((cookie) => /session_token/.test(cookie.name))).toHaveLength(0);
      await connectWallet(page);
      expect(await sessionUser(context, baseUrl)).toBeNull();
      expect(mock.requests).toEqual([]);
      expect(mock.signedMessages).toHaveLength(0);
      return { context, page, mock };
    }

    const first = await newWalletBrowser();
    expect(await prisma.walletChallenge.count({ where: { address } })).toBe(0);
    expect(await prisma.inviteClaim.count({ where: { inviteLinkId: invite.id } })).toBe(0);
    // Exercise the mock's disconnect/change events as well as connect.
    await first.page.getByRole("button", { name: "Disconnect wallet", exact: true }).click();
    await expect(first.page.getByRole("button", { name: connectWalletLabel })).toBeVisible();
    await connectWallet(first.page);
    expect(first.mock.requests).toEqual([]);
    expect(first.mock.signedMessages).toHaveLength(0);

    const user = await continueWithWallet(first.page);
    testerId = user.id;
    expect(user.isAnonymous).toBe(false);
    await expect(first.page).toHaveURL(testerUrl);
    expect((await sessionUser(first.context, baseUrl)).id).toBe(testerId);
    expect((await first.context.cookies()).some((cookie) => /session_token/.test(cookie.name) && cookie.httpOnly)).toBe(true);
    expect(await prisma.session.count({ where: { userId: testerId } })).toBeGreaterThan(0);
    expect(await prisma.builderProfile.findUnique({ where: { userId: testerId } })).toBeNull();
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { address } });
    expect(wallet.userId).toBe(testerId);
    expect(wallet.seekerGenesisVerifiedAt).toBeNull();
    expect(wallet.seekerGenesisVerificationExpiresAt).toBeNull();
    // The real backend recorded the hint, but it must not promote wallet trust.
    const hintedProfile = await prisma.deviceProfile.findFirstOrThrow({ where: { userId: testerId }, orderBy: { capturedAt: "desc" } });
    expect(hintedProfile).toMatchObject({ isSeeker: true, recognitionSource: "USER_AGENT" });
    const pendingClaim = await prisma.inviteClaim.findUniqueOrThrow({ where: { inviteLinkId_userId: { inviteLinkId: invite.id, userId: testerId } } });
    expect(pendingClaim.grantedAt).toBeNull();
    expect(pendingClaim.revokedAt).toBeNull();
    await expect(first.page.getByRole("link", { name: "Download APK", exact: true })).toHaveCount(0);
    const blocked = await first.context.request.get(`${baseUrl}/api/downloads/${release.id}`, { maxRedirects: 0 });
    expect(blocked.status()).toBe(403);
    expect(await prisma.downloadEvent.count({ where: { releaseId: release.id } })).toBe(0);
    const firstChallenge = await prisma.walletChallenge.findFirstOrThrow({ where: { address } });
    expect(firstChallenge.purpose).toBe("SIGN_IN_AND_VERIFY_SGT");
    expect(firstChallenge.usedAt).not.toBeNull();
    expect(firstChallenge.message).toContain("Sign in to SeekerHub and authorize a fresh on-chain Seeker Genesis Token ownership check for this wallet");
    expect(firstChallenge.message).toContain(`SGT access context: invite:${invite.id};release:${release.id}`);
    expect(firstChallenge.message).not.toContain(token);
    expect(firstChallenge.message).toContain("does not prove that the current device is a Seeker");
    expect(first.mock.signedMessages).toHaveLength(1);
    expect(Buffer.from(first.mock.signedMessages[0]).toString("utf8")).toBe(firstChallenge.message);
    await first.page.screenshot({ path: testInfo.outputPath("wallet-sgt-pending-390.png"), fullPage: true });

    await test.step("inject an explicit local SGT fixture, NOT real chain verification", async () => {
      await prisma.wallet.update({ where: { address }, data: {
        seekerGenesisVerifiedAt: new Date(),
        seekerGenesisVerificationExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      } });
    });
    const cachedFixture = await prisma.wallet.findUniqueOrThrow({ where: { address } });
    // Reopen the invite through the UI: normal reconciliation, not a DB seat grant.
    await first.page.goto(inviteUrl);
    await first.page.getByRole("button", { name: "Open beta access", exact: true }).click();
    await expect(first.page).toHaveURL(testerUrl);
    expect((await sessionUser(first.context, baseUrl)).id).toBe(testerId);
    expect(first.mock.signedMessages).toHaveLength(1);
    await expect(first.page.getByRole("link", { name: "Download APK", exact: true })).toBeVisible();
    const granted = await prisma.inviteClaim.findUniqueOrThrow({ where: { id: pendingClaim.id } });
    expect(granted.grantedAt).not.toBeNull();
    const viewsBeforeRecovery = await prisma.releaseViewEvent.findMany({ where: { releaseId: release.id }, orderBy: { id: "asc" } });
    expect(viewsBeforeRecovery.length).toBeGreaterThan(0);
    expect(viewsBeforeRecovery.every((view) => view.userId === testerId)).toBe(true);

    // No cookies/localStorage transferred: only the same public wallet identity.
    const second = await newWalletBrowser();
    expect((await continueWithWallet(second.page)).id).toBe(testerId);
    await expect(second.page).toHaveURL(testerUrl);
    await expect(second.page.getByRole("link", { name: "Download APK", exact: true })).toBeVisible();
    await second.page.screenshot({ path: testInfo.outputPath("wallet-recovered-390.png"), fullPage: true });
    expect((await sessionUser(second.context, baseUrl)).id).toBe(testerId);
    expect(await prisma.wallet.count({ where: { address } })).toBe(1);
    const recoveredWallet = await prisma.wallet.findUniqueOrThrow({ where: { address } });
    expect(recoveredWallet.seekerGenesisVerifiedAt).toEqual(cachedFixture.seekerGenesisVerifiedAt);
    expect(recoveredWallet.seekerGenesisVerificationExpiresAt).toEqual(cachedFixture.seekerGenesisVerificationExpiresAt);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: testerId } })).toMatchObject({ isAnonymous: false });
    expect(await prisma.builderProfile.findUnique({ where: { userId: testerId } })).toBeNull();
    expect(await prisma.testerAccess.count({ where: { projectId } })).toBe(1);
    expect(await prisma.inviteClaim.findMany({ where: { inviteLinkId: invite.id } })).toEqual([granted]);
    expect(await prisma.inviteClaim.count({ where: { inviteLinkId: invite.id, grantedAt: { not: null } } })).toBe(1);
    const viewsAfterRecovery = await prisma.releaseViewEvent.findMany({ where: { releaseId: release.id } });
    expect(viewsAfterRecovery.every((view) => view.userId === testerId)).toBe(true);
    expect(new Set(viewsAfterRecovery.map((view) => view.userId)).size).toBe(1);
    expect(viewsAfterRecovery).toEqual(expect.arrayContaining(viewsBeforeRecovery));

    for (const mock of [first.mock, second.mock]) {
      const challenges = mock.requests.filter(({ path }) => path === "/api/wallet/challenge");
      expect(challenges).toHaveLength(mock.signedMessages.length);
      for (const { body } of challenges) expect(body).toEqual({ address, purpose: "SIGN_IN_AND_VERIFY_SGT", sgtContext: { inviteToken: token } });
      expect(mock.requests.filter(({ path }) => path === "/api/auth/sign-in/solana-wallet"))
        .toHaveLength(mock.signedMessages.length);
      expect(mock.requests.map(({ path }) => path)).not.toContain("/api/auth/sign-in/anonymous");
      expect(mock.requests.map(({ path }) => path)).not.toContain("/api/wallet/verify-seeker");
    }
    expect(first.mock.signedMessages).toHaveLength(1);
    expect(second.mock.signedMessages).toHaveLength(1);
    expect(await prisma.walletChallenge.count({ where: { address, purpose: "SIGN_IN_AND_VERIFY_SGT", usedAt: { not: null } } })).toBe(2);
  } finally {
    await testInfo.attach("wallet-page-errors", { body: JSON.stringify(pageErrors, null, 2), contentType: "application/json" });
    await Promise.all(contexts.map((context) => context.close()));
    try {
      // Targeted cleanup only for this test's random fixture IDs and wallet.
      if (projectId) await prisma.appProject.deleteMany({ where: { id: projectId } });
      await prisma.walletChallenge.deleteMany({ where: { address } });
      const walletUserId = testerId ?? (await prisma.wallet.findUnique({ where: { address }, select: { userId: true } }))?.userId;
      if (walletUserId) await prisma.user.deleteMany({ where: { id: walletUserId } });
      if (ownerId) await prisma.user.deleteMany({ where: { id: ownerId } });
    } finally {
      await prisma.$disconnect();
    }
    expect.soft(pageErrors, "Unexpected browser page errors").toEqual([]);
  }
});

test("Android combines sign-in explicitly and keeps linked-wallet SGT verification a separate action", async ({ browser }, testInfo) => {
  test.setTimeout(90_000);
  const { databaseUrl, baseUrl, bucket } = reviewEnvironment();
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const keypair = nacl.sign.keyPair();
  const address = bs58.encode(keypair.publicKey);
  const id = randomUUID();
  const clientHeaders = isolatedReviewHeaders();
  const token = `android-selector-${id}`;
  const pageErrors: string[] = [];
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, extraHTTPHeaders: clientHeaders,
    userAgent: "Mozilla/5.0 (Linux; Android 15; Seeker) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36" });
  let ownerId: string | undefined;
  let projectId: string | undefined;
  let testerId: string | undefined;
  try {
    context.on("page", (page) => page.on("pageerror", (error) => pageErrors.push(error.message)));
    // Registry names exercise UI selection only. This is NOT the native SDK,
    // Android App Link association, a relay connection, or an SGT attestation.
    const mobile = await installWallet(context, keypair, "Mobile Wallet Adapter");
    const owner = await prisma.user.create({ data: { name: "Android selector fixture owner", email: `android-owner-${id}@example.test` } });
    ownerId = owner.id;
    const project = await prisma.appProject.create({ data: { ownerId, slug: `android-selector-${id}`, name: "Android SGT selector fixture" } });
    projectId = project.id;
    const release = await prisma.release.create({ data: {
      projectId, createdById: ownerId, status: "PUBLISHED", versionName: "1.0.0", versionCode: 1,
      changelog: "Generic Wallet Standard registry fixture, not native Seeker verification.",
      accessPolicy: { create: { requireInviteAcceptance: true, requireLinkedWallet: true, requireVerifiedSeeker: true } },
      buildAsset: { create: { storageKey: `android-selector/${id}/fixture.apk`, bucket,
        originalFileName: "fixture.apk", contentType: "application/vnd.android.package-archive",
        fileSizeBytes: 1, sha256Checksum: "fixture-only", validatedAt: new Date() } },
    } });
    const invite = await prisma.inviteLink.create({ data: {
      projectId, releaseId: release.id, createdById: ownerId, label: "Android selector fixture", maxUses: 1,
      tokenHash: createHash("sha256").update(token).digest("hex"),
    } });
    const page = await context.newPage();
    const noOverflow = async () => {
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        { message: "Android wallet UI must fit the 390px viewport" }).toBe(true);
    };
    const noImplicitAuth = async () => {
      expect(mobile.signedMessages).toHaveLength(0);
      expect(mobile.requests).toEqual([]);
      expect(await sessionUser(context, baseUrl)).toBeNull();
      expect(await prisma.walletChallenge.count({ where: { address } })).toBe(0);
      expect(await prisma.inviteClaim.count({ where: { inviteLinkId: invite.id } })).toBe(0);
    };

    await page.goto(`${baseUrl}/invite/${token}`);
    await expect(page.getByRole("button", { name: "Connect wallet", exact: true })).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Use Seeker Connect", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /guest/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Choose another wallet", exact: true })).toHaveCount(0);
    await noOverflow();
    await page.getByRole("button", { name: "Connect wallet", exact: true }).click();
    await expect(page.getByRole("button", { name: "Disconnect wallet", exact: true })).toBeEnabled();
    await expect(page.getByRole("button", { name: combinedSignInLabel, exact: true })).toBeEnabled();
    await expect(page.getByText("One signature authorizes both", { exact: false })).toBeVisible();
    await noImplicitAuth();
    await noOverflow();
    await expect(page.locator(".wallet-adapter-modal")).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("android-wallet-connected-390.png"), fullPage: true });

    // Disconnect/reconnect stays on the site and never signs a message implicitly.
    await page.getByRole("button", { name: "Disconnect wallet", exact: true }).click();
    await expect(page.getByRole("button", { name: "Connect wallet", exact: true })).toBeEnabled();
    await expect(page.getByRole("button", { name: combinedSignInLabel, exact: true })).toHaveCount(0);
    await noImplicitAuth();
    await page.getByRole("button", { name: "Connect wallet", exact: true }).click();
    await expect(page.getByRole("button", { name: combinedSignInLabel, exact: true })).toBeEnabled();
    await expect(page).toHaveURL(`${baseUrl}/invite/${token}`);
    await noImplicitAuth();

    const user = await continueWithWallet(page);
    testerId = user.id;
    await expect(page).toHaveURL(`${baseUrl}/tester/releases/${release.id}`);
    expect(user.isAnonymous).toBe(false);
    expect((await sessionUser(context, baseUrl)).id).toBe(testerId);
    expect(mobile.signedMessages).toHaveLength(1);
    expect(await prisma.wallet.findUniqueOrThrow({ where: { address } })).toMatchObject({ userId: testerId,
      seekerGenesisVerifiedAt: null, seekerGenesisVerificationExpiresAt: null });
    expect(await prisma.builderProfile.findUnique({ where: { userId: testerId } })).toBeNull();
    const claim = await prisma.inviteClaim.findUniqueOrThrow({ where: { inviteLinkId_userId: { inviteLinkId: invite.id, userId: testerId } } });
    expect(claim).toMatchObject({ grantedAt: null, revokedAt: null });
    await expect(page.getByRole("link", { name: "Download APK", exact: true })).toHaveCount(0);
    expect((await context.request.get(`${baseUrl}/api/downloads/${release.id}`, { maxRedirects: 0 })).status()).toBe(403);
    expect(await prisma.inviteClaim.count({ where: { inviteLinkId: invite.id, grantedAt: { not: null } } })).toBe(0);
    // Display-name reads after authentication are not proof requests.
    expect(mobile.requests.filter(({ path }) => path !== "/api/wallet/domain").map(({ path }) => path))
      .toEqual(["/api/wallet/challenge", "/api/auth/sign-in/solana-wallet"]);
    expect(mobile.requests[0].body).toEqual({ address, purpose: "SIGN_IN_AND_VERIFY_SGT", sgtContext: { inviteToken: token } });
    expect(mobile.requests.find(({ path }) => path === "/api/auth/sign-in/solana-wallet")?.body)
      .toMatchObject({ address, purpose: "SIGN_IN_AND_VERIFY_SGT" });
    const combinedChallenge = await prisma.walletChallenge.findFirstOrThrow({ where: { address, purpose: "SIGN_IN_AND_VERIFY_SGT" } });
    expect(combinedChallenge.usedAt).not.toBeNull();
    expect(Buffer.from(mobile.signedMessages[0]).toString("utf8")).toBe(combinedChallenge.message);
    expect(combinedChallenge.message).toContain(`SGT access context: invite:${invite.id};release:${release.id}`);
    await expect(page.getByRole("button", { name: "Verify Seeker Genesis Token", exact: true })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Continue with wallet", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: combinedSignInLabel, exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Choose another wallet", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Use Seeker Connect", exact: true })).toHaveCount(0);
    await noOverflow();
    await page.screenshot({ path: testInfo.outputPath("android-signin-not-sgt-390.png"), fullPage: true });

    // No automatic second prompt: a linked wallet explicitly requests its own fresh SGT proof.
    expect(mobile.signedMessages).toHaveLength(1);
    expect(mobile.requests.filter(({ path }) => path === "/api/wallet/verify-seeker")).toHaveLength(0);
    const verified = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/wallet/verify-seeker" &&
      response.request().method() === "POST");
    await page.getByRole("button", { name: "Verify Seeker Genesis Token", exact: true }).click();
    const verificationResponse = await verified;
    expect(verificationResponse.status()).toBe(503);
    expect(await verificationResponse.json()).toMatchObject({ code: "SGT_RPC_UNAVAILABLE" });
    await expect(page.getByRole("alert").filter({ hasText: "temporarily unavailable" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Verify Seeker Genesis Token", exact: true })).toBeEnabled();
    expect(mobile.signedMessages).toHaveLength(2);
    const separateChallenge = await prisma.walletChallenge.findFirstOrThrow({ where: { address, purpose: "VERIFY_SGT" } });
    expect(separateChallenge.id).not.toBe(combinedChallenge.id);
    expect(separateChallenge.nonce).not.toBe(combinedChallenge.nonce);
    expect(separateChallenge.usedAt).not.toBeNull();
    expect(Buffer.from(mobile.signedMessages[1]).toString("utf8")).toBe(separateChallenge.message);
    expect(separateChallenge.message).toContain("Verify Seeker Genesis Token ownership");
    expect(mobile.requests.filter(({ path }) => path === "/api/wallet/challenge").map(({ body }) => body)).toEqual([
      { address, purpose: "SIGN_IN_AND_VERIFY_SGT", sgtContext: { inviteToken: token } }, { address, purpose: "VERIFY_SGT" },
    ]);
    expect(mobile.requests.filter(({ path }) => path === "/api/auth/sign-in/solana-wallet")).toHaveLength(1);
    expect(mobile.requests.filter(({ path }) => path === "/api/wallet/verify-seeker")).toHaveLength(1);
    expect((await sessionUser(context, baseUrl)).id).toBe(testerId);
    expect(await prisma.wallet.findUniqueOrThrow({ where: { address } })).toMatchObject({ userId: testerId,
      seekerGenesisVerifiedAt: null, seekerGenesisVerificationExpiresAt: null });
    expect(await prisma.inviteClaim.findMany({ where: { inviteLinkId: invite.id } })).toEqual([claim]);
    expect(await prisma.testerAccess.count({ where: { projectId } })).toBe(1);
    expect((await context.request.get(`${baseUrl}/api/downloads/${release.id}`, { maxRedirects: 0 })).status()).toBe(403);
    await noOverflow();
  } finally {
    await testInfo.attach("android-wallet-page-errors", { body: JSON.stringify(pageErrors, null, 2), contentType: "application/json" });
    await context.close();
    try {
      if (projectId) await prisma.appProject.deleteMany({ where: { id: projectId } });
      await prisma.walletChallenge.deleteMany({ where: { address } });
      const walletUserId = testerId ?? (await prisma.wallet.findUnique({ where: { address }, select: { userId: true } }))?.userId;
      if (walletUserId) await prisma.user.deleteMany({ where: { id: walletUserId } });
      if (ownerId) await prisma.user.deleteMany({ where: { id: ownerId } });
    } finally {
      await prisma.$disconnect();
    }
    expect.soft(pageErrors, "Unexpected Android browser page errors").toEqual([]);
  }
});
