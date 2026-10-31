import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { apkFixture } from "../fixtures/apk";

// These tests deliberately create data only in the named local review environment.
function reviewDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  const baseUrl = process.env.PLAYWRIGHT_BASE_URL || process.env.NEXT_PUBLIC_APP_URL;
  const bucket = process.env.S3_BUCKET;
  if (process.env.RUN_INTEGRATION_TESTS !== "true" || !databaseUrl || !baseUrl || !process.env.S3_ENDPOINT || !bucket) throw new Error("An explicitly enabled local integration environment is required.");
  const db = new URL(databaseUrl);
  const server = new URL(baseUrl);
  const storage = new URL(process.env.S3_ENDPOINT);
  if (!["postgres:", "postgresql:"].includes(db.protocol) || !["localhost", "127.0.0.1"].includes(db.hostname) || !db.pathname.toLowerCase().includes("test") ||
      !["localhost", "127.0.0.1"].includes(server.hostname) || server.protocol !== "http:" || server.pathname !== "/" ||
      !["localhost", "127.0.0.1"].includes(storage.hostname) || !["http:", "https:"].includes(storage.protocol)) {
    throw new Error("Builder/tester E2E requires the isolated local review database, server and storage.");
  }
  return { databaseUrl, baseUrl: server.origin, storageOrigin: storage.origin, bucket };
}

test("uploads a synthetic APK through the UI and serves the exact bytes to a guest", async ({ browser }) => {
  test.setTimeout(120_000);
  const { databaseUrl, baseUrl, storageOrigin } = reviewDatabase();
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const builderContext = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
  const guestContext = await browser.newContext();
  const pageErrors: string[] = [];
  for (const context of [builderContext, guestContext]) context.on("page", (page) => {
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error" && /hydrat(?:ion|ed|e)|server.rendered/i.test(message.text())) pageErrors.push(message.text());
    });
  });
  const id = randomUUID();
  const slug = `e2e-upload-${id}`;
  const email = `e2e-upload-${id}@example.test`;
  const password = `Review-${id}-password`;
  const apk = apkFixture();
  try {
    const builder = await prisma.user.create({ data: { name: "E2E Upload Builder", email, emailVerified: true, builderProfile: { create: { maxApkBytes: 10000, maxStorageBytes: 10000 } } } });
    await prisma.account.create({ data: { userId: builder.id, accountId: builder.id, providerId: "credential", password: await hashPassword(password) } });
    const project = await prisma.appProject.create({ data: { ownerId: builder.id, name: `Upload test ${id}`, slug } });
    const page = await builderContext.newPage();
    const projectUrl = `/builder/apps/${slug}`;
    await page.goto(`${baseUrl}/sign-in?intent=builder&returnTo=${encodeURIComponent(projectUrl)}`);
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/builder/apps/${slug}`), { timeout: 30_000 });
    await page.getByRole("link", { name: "Upload release" }).click();
    await page.getByLabel("Choose a signed Android APK").setInputFiles({ name: "synthetic-fixture.apk", mimeType: "application/vnd.android.package-archive", buffer: apk });
    await page.getByRole("button", { name: "Upload and check APK" }).click();
    await expect(page.getByText("Prepare your release")).toBeVisible({ timeout: 60_000 });
    const draft = await prisma.release.findFirstOrThrow({ where: { projectId: project.id }, include: { buildAsset: true, project: true } });
    expect(draft).toMatchObject({ status: "DRAFT", versionName: "1.2.3", versionCode: 42, project: { androidPackageName: "com.example.beta" } });
    expect(draft.buildAsset?.validatedAt).not.toBeNull();
    expect(draft.buildAsset?.hasApkSignature).toBe(true);
    expect(draft.buildAsset?.fileSizeBytes).toBe(BigInt(apk.length));
    await page.getByLabel(/What should testers try/).fill("Please test the synthetic upload fixture.");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("radio", { name: /Private invite link/ }).check();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { name: "Review before publishing" })).toBeFocused();
    expect((await prisma.release.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe("DRAFT");
    await page.getByRole("button", { name: "Publish and create link" }).click();
    await expect(page.getByText("Your release is published")).toBeVisible();
    await page.getByRole("button", { name: "Copy invite link" }).click();
    await expect(page.getByRole("button", { name: "Invite link copied" })).toBeVisible();
    const inviteUrl = await page.evaluate(() => navigator.clipboard.readText());
    expect(new URL(inviteUrl).origin).toBe(baseUrl);
    const guestPage = await guestContext.newPage();
    await guestPage.goto(inviteUrl);
    await guestPage.getByRole("button", { name: "Open beta access" }).click();
    await expect(guestPage.getByRole("link", { name: "Download APK" })).toBeVisible();
    const downloadPromise = guestPage.waitForEvent("download");
    await guestPage.getByRole("link", { name: "Download APK" }).click();
    const download = await downloadPromise;
    expect([baseUrl, storageOrigin]).toContain(new URL(download.url()).origin);
    expect(await download.failure()).toBeNull();
    const downloadPath = await download.path();
    expect(downloadPath).not.toBeNull();
    expect(await readFile(downloadPath!)).toEqual(apk);
  } finally {
    expect.soft(pageErrors, "Unexpected browser page errors").toEqual([]);
    await builderContext.close();
    await guestContext.close();
    await prisma.$disconnect();
  }
});

async function checkAccessibility(page: Page, darkScreenshot: string) {
  for (const theme of ["light", "dark"] as const) {
    if (theme === "dark") await page.getByRole("button", { name: "Switch to dark theme" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    if (theme === "dark") await page.waitForTimeout(300);
    if (theme === "dark") await page.screenshot({ path: darkScreenshot, fullPage: true });
    const result = await new AxeBuilder({ page }).analyze();
    expect.soft(result.violations, `${theme}: ${JSON.stringify(result.violations, null, 2)}`).toEqual([]);
    expect.soft(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await page.getByRole("button", { name: "Switch to light theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.waitForTimeout(300);
}

test.beforeAll(async () => {
  const { databaseUrl } = reviewDatabase();
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  try {
    await prisma.rateLimit.deleteMany();
  } finally {
    await prisma.$disconnect();
  }
});

for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
  test(`builder publishes and guest tests a scoped release at ${viewport.width}px`, async ({ browser }, testInfo) => {
    test.setTimeout(120_000);
    const { databaseUrl, baseUrl, storageOrigin, bucket } = reviewDatabase();
    const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
    const id = randomUUID();
    const email = `e2e-builder-${id}@example.test`;
    const password = `Review-${id}-password`;
    const slug = `e2e-${id}`;
    const notes = `Please test this release ${id}.`;
    const feedbackTitle = `E2E feedback ${id}`;
    const builderContext = await browser.newContext({ viewport, colorScheme: "light", permissions: ["clipboard-read", "clipboard-write"] });
    const guestContext = await browser.newContext({ viewport, colorScheme: "light" });
    const pageErrors: string[] = [];
    for (const context of [builderContext, guestContext]) {
      context.on("page", (page) => {
        page.on("pageerror", (error) => pageErrors.push(error.message));
        page.on("console", (message) => {
          if (message.type() === "error" && /hydrat(?:ion|ed|e)|server.rendered/i.test(message.text())) pageErrors.push(message.text());
        });
      });
    }

    try {
      const builder = await prisma.user.create({ data: {
        name: "E2E Builder", email, emailVerified: true,
        builderProfile: { create: {} },
      } });
      await prisma.account.create({ data: {
        userId: builder.id, accountId: builder.id, providerId: "credential", password: await hashPassword(password),
      } });
      const project = await prisma.appProject.create({ data: {
        ownerId: builder.id, name: `E2E app ${id}`, slug, androidPackageName: "test.seekerhub.e2e",
      } });
      const release = await prisma.release.create({ data: {
        projectId: project.id, createdById: builder.id, status: "DRAFT", versionName: "1.0.0", versionCode: 1,
        changelog: "Draft release", buildAsset: { create: {
          storageKey: `e2e/${id}/fixture.apk`, bucket, originalFileName: "fixture.apk",
          contentType: "application/vnd.android.package-archive", fileSizeBytes: 1, sha256Checksum: "fixture-only", validatedAt: new Date(),
        } },
      } });
      const draftUrl = `/builder/apps/${slug}/releases/${release.id}`;
      const builderPage = await builderContext.newPage();
      await builderPage.goto(`${baseUrl}/sign-in?intent=builder&returnTo=${encodeURIComponent(draftUrl)}`);
      await builderPage.getByLabel("Email", { exact: true }).fill(email);
      await builderPage.getByLabel("Password", { exact: true }).fill(password);
      await builderPage.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(builderPage).toHaveURL(new RegExp(`/releases/${release.id}`), { timeout: 30_000 });
      await expect(builderPage.getByText("Prepare your release")).toBeVisible();
      await builderPage.screenshot({ path: testInfo.outputPath(`draft-${viewport.width}.png`), fullPage: true });
      await checkAccessibility(builderPage, testInfo.outputPath(`draft-dark-${viewport.width}.png`));

      await builderPage.getByLabel(/What should testers try/).fill(notes);
      await builderPage.getByRole("button", { name: "Continue" }).click();
      await expect(builderPage.getByRole("heading", { name: "Choose who can test" })).toBeFocused();
      await builderPage.getByRole("radio", { name: /Private invite link/ }).check();
      await expect(builderPage.getByLabel(/I confirm this change may give more testers access/)).toHaveCount(0);
      await builderPage.getByLabel("What does this link unlock?").selectOption("release");
      await builderPage.getByLabel("Tester places (optional)").fill("2");
      if (viewport.width === 390) {
        await builderPage.getByLabel("What does this link unlock?").focus();
        await builderPage.keyboard.press("Tab");
        const limit = builderPage.getByLabel("Tester places (optional)");
        await expect(limit).toBeFocused();
        const field = await limit.boundingBox();
        const footer = await builderPage.locator("form div.sticky").boundingBox();
        expect(field).not.toBeNull();
        expect(footer).not.toBeNull();
        expect(field!.y).toBeGreaterThanOrEqual(0);
        expect(field!.y + field!.height).toBeLessThanOrEqual(viewport.height);
        expect(field!.y + field!.height <= footer!.y || field!.y >= footer!.y + footer!.height, "Focused tester limit must not be covered by the sticky footer").toBe(true);
      }
      await builderPage.screenshot({ path: testInfo.outputPath(`audience-${viewport.width}.png`), fullPage: true });
      await checkAccessibility(builderPage, testInfo.outputPath(`audience-dark-${viewport.width}.png`));
      await builderPage.getByRole("button", { name: "Continue" }).click();
      await expect(builderPage.getByRole("heading", { name: "Review before publishing" })).toBeFocused();
      await expect(builderPage.getByRole("region", { name: "Review before publication" })).toContainText("This release only");
      await expect(builderPage.getByRole("region", { name: "Review before publication" })).toContainText(notes);
      await builderPage.screenshot({ path: testInfo.outputPath(`review-${viewport.width}.png`), fullPage: true });
      const publishButton = builderPage.getByRole("button", { name: "Publish and create link" });
      await expect(publishButton).toBeEnabled({ timeout: 5_000 });
      expect((await prisma.release.findUniqueOrThrow({ where: { id: release.id } })).status).toBe("DRAFT");
      await publishButton.click({ timeout: 10_000 });
      await expect(builderPage.getByText("Your release is published")).toBeVisible();
      await builderPage.getByRole("button", { name: "Copy invite link" }).click();
      await expect(builderPage.getByRole("button", { name: "Invite link copied" })).toBeVisible();
      const inviteUrl = await builderPage.evaluate(() => navigator.clipboard.readText());
      const parsedInvite = new URL(inviteUrl);
      expect(parsedInvite.origin).toBe(baseUrl);
      expect(parsedInvite.pathname).toMatch(/^\/invite\/[^/]+$/);

      const savedRelease = await prisma.release.findUniqueOrThrow({ where: { id: release.id }, include: { accessPolicy: true, inviteLinks: true } });
      expect(savedRelease.status).toBe("PUBLISHED");
      expect(savedRelease.changelog).toBe(notes);
      expect(savedRelease.accessPolicy?.requireInviteAcceptance).toBe(true);
      expect(savedRelease.inviteLinks).toHaveLength(1);
      expect(savedRelease.inviteLinks[0]).toMatchObject({ releaseId: release.id, projectId: project.id, maxUses: 2 });

      const guestPage = await guestContext.newPage();
      await guestPage.goto(inviteUrl);
      await guestPage.getByRole("button", { name: "Open beta access" }).click();
      await expect(guestPage).toHaveURL(new RegExp(`/tester/releases/${release.id}|/tester$`));
      if (new URL(guestPage.url()).pathname === "/tester") await guestPage.getByRole("link", { name: new RegExp(`E2E app ${id}`) }).click();
      await expect(guestPage.getByRole("link", { name: "Download APK" })).toBeVisible();
      await guestPage.screenshot({ path: testInfo.outputPath(`tester-${viewport.width}.png`), fullPage: true });
      await checkAccessibility(guestPage, testInfo.outputPath(`tester-dark-${viewport.width}.png`));
      const downloadsBeforeRequest = await prisma.downloadEvent.count({ where: { releaseId: release.id, userId: { not: null } } });
      expect.soft(downloadsBeforeRequest, "Viewing the release must not record a download").toBe(0);
      const download = await guestContext.request.get(`${baseUrl}/api/downloads/${release.id}`, { maxRedirects: 0 });
      expect(download.status()).toBe(307);
      const location = new URL(download.headers().location);
      expect(location.origin).toBe(storageOrigin);
      expect(location.pathname).toContain(`/e2e/${id}/fixture.apk`);

      await guestPage.getByLabel("Title", { exact: true }).fill(feedbackTitle);
      await guestPage.getByLabel("Severity").selectOption("HIGH");
      await guestPage.getByLabel("Description", { exact: true }).fill("The test feature is blocked after opening the app.");
      await guestPage.getByRole("button", { name: "Submit feedback" }).click();
      await expect(guestPage.getByText("Feedback sent to the builder. Thank you.")).toBeVisible();
      const claim = await prisma.inviteClaim.findFirstOrThrow({ where: { inviteLinkId: savedRelease.inviteLinks[0].id }, include: { user: true } });
      expect(claim.grantedAt).not.toBeNull();
      expect(claim.user.isAnonymous).toBe(true);
      expect(await prisma.downloadEvent.count({ where: { releaseId: release.id, userId: claim.userId } })).toBe(downloadsBeforeRequest + 1);
      const feedback = await prisma.feedbackReport.findFirstOrThrow({ where: { releaseId: release.id, userId: claim.userId, title: feedbackTitle } });
      expect(feedback.severity).toBe("HIGH");
      await builderPage.reload();
      await expect(builderPage.getByText(feedbackTitle)).toBeVisible();
    } finally {
      expect.soft(pageErrors, "Unexpected browser page errors").toEqual([]);
      await builderContext.close();
      await guestContext.close();
      await prisma.$disconnect();
    }
  });
}
