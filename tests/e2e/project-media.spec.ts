import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { hashPassword } from "better-auth/crypto";
import sharp from "sharp";

async function waitForWorkspaceAppearance(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    // Contrast must be measured after the workspace's opacity reveal finishes.
    await Promise.all(document.getAnimations().filter(animation =>
      Number.isFinite(animation.effect?.getComputedTiming().endTime),
    ).map(animation => animation.finished.catch(() => undefined)));
  });
  for (const workspace of await page.locator(".workspace-enter").all()) {
    await expect(workspace).toHaveCSS("opacity", "1");
  }
}

test("builder adds private app images and an invited tester can return to feedback", async ({ browser }, testInfo) => {
  test.setTimeout(120_000);
  const databaseUrl = process.env.DATABASE_URL;
  const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  const endpoint = process.env.S3_ENDPOINT;
  if (process.env.RUN_INTEGRATION_TESTS !== "true" || !databaseUrl || !baseUrl || !endpoint ||
      !new URL(databaseUrl).pathname.includes("test") ||
      [databaseUrl, baseUrl, endpoint].some(value => !["127.0.0.1", "localhost"].includes(new URL(value).hostname))) {
    throw new Error("Only an explicitly enabled disposable local test environment is allowed.");
  }
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const builder = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
  const tester = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "light" });
  const outsider = await browser.newContext();
  const id = randomUUID();
  const email = `images-${id}@example.test`;
  const password = `Review-${id}`;
  const pageErrors: string[] = [];
  for (const context of [builder, tester]) {
    const octets = randomBytes(2);
    await context.setExtraHTTPHeaders({ "x-forwarded-for": `198.18.${octets[0]}.${octets[1]}` });
    context.on("page", page => page.on("pageerror", error => pageErrors.push(error.message)));
  }
  try {
    const owner = await prisma.user.create({ data: { name: "Media QA builder", email, emailVerified: true, builderProfile: { create: {} } } });
    await prisma.account.create({ data: { userId: owner.id, accountId: owner.id, providerId: "credential", password: await hashPassword(password) } });
    const project = await prisma.appProject.create({ data: { ownerId: owner.id, name: "Orbit Notes", slug: `media-${id}`, description: "A quieter place for everyday ideas. Local QA fixture." } });
    const release = await prisma.release.create({ data: { projectId: project.id, createdById: owner.id, versionName: "0.8.3", versionCode: 83, changelog: "Try saving a note and send us your feedback.", accessPolicy: { create: { requireInviteAcceptance: true } } } });
    const token = randomBytes(24).toString("base64url");
    await prisma.inviteLink.create({ data: { projectId: project.id, releaseId: release.id, createdById: owner.id, tokenHash: createHash("sha256").update(token).digest("hex"), label: "Review testers" } });
    const page = await builder.newPage();
    await page.goto(`${baseUrl}/sign-in?method=password&returnTo=${encodeURIComponent(`/builder/apps/${project.slug}`)}`);
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/builder/apps/${project.slug}`));
    await expect(page.getByRole("heading", { name: "Orbit Notes", exact: true, level: 1 })).toBeVisible();
    await waitForWorkspaceAppearance(page);
    await page.screenshot({ path: testInfo.outputPath("builder-fallback-desktop.png"), fullPage: false, caret: "initial" });
    const asset = await readFile("public/images/workspace-atmosphere.png");
    const image = await sharp(asset).resize(1200, 675).png().toBuffer();
    const manager = page.getByRole("region", { name: "Project images" });
    for (const [label, kind] of [["Add app icon", "ICON"], ["Add app banner", "BANNER"], ["Add screenshot", "SCREENSHOT"]]) {
      await expect(manager.getByLabel(label, { exact: true })).toBeEnabled();
      await manager.getByLabel(label, { exact: true }).setInputFiles({ name: "qa-image.png", mimeType: "image/png", buffer: image });
      await expect(manager.getByRole("status")).toHaveText("Images saved. Removed images free storage after cleanup.");
      await expect.poll(() => prisma.projectMedia.count({ where: { projectId: project.id, kind: kind as "ICON" | "BANNER" | "SCREENSHOT", status: "READY" } })).toBe(1);
    }
    await page.goto(`${baseUrl}/builder/apps/${project.slug}`);
    await expect(page.getByRole("img", { name: "Orbit Notes icon" }).first()).toBeVisible();
    await expect.poll(() => page.locator("img").evaluateAll(images => images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
    await waitForWorkspaceAppearance(page);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath("builder-media-desktop.png"), fullPage: false, caret: "initial" });
    const rows = await prisma.projectMedia.findMany({ where: { projectId: project.id, status: "READY" } });
    const profile = await prisma.builderProfile.findUniqueOrThrow({ where: { userId: owner.id } });
    expect(profile.usedStorageBytes).toBe(rows.reduce((sum, row) => sum + row.fileSizeBytes, 0n));
    expect(profile.reservedStorageBytes).toBe(0n);
    const hidden = await outsider.request.get(`${baseUrl}/api/project-media/${rows[0].id}/url`);
    expect(hidden.status()).toBe(404);
    const guest = await tester.newPage();
    await guest.goto(`${baseUrl}/invite/${token}`);
    await guest.getByRole("button", { name: "Open beta access as guest", exact: true }).click();
    await expect(guest).toHaveURL(new RegExp(`/tester/releases/${release.id}`));
    await expect(guest.getByRole("heading", { name: "Orbit Notes", exact: true })).toBeVisible();
    await waitForWorkspaceAppearance(guest);
    const download = guest.getByRole("link", { name: "Download APK" });
    const box = await download.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y + box!.height).toBeLessThan(760);
    await expect.poll(() => guest.locator("img").evaluateAll(images => images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
    expect(await guest.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await new AxeBuilder({ page: guest }).analyze()).violations).toEqual([]);
    await guest.screenshot({ path: testInfo.outputPath("tester-media-mobile.png"), fullPage: false, caret: "initial" });
    await expect(guest.getByLabel("Title", { exact: true })).toBeHidden();
    await guest.getByText("After your test: leave feedback", { exact: true }).click();
    await guest.getByLabel("Title", { exact: true }).fill("Saved note disappeared");
    await guest.getByLabel("Description", { exact: true }).fill("Reopened the local QA build after saving a note.");
    await guest.getByRole("button", { name: "Submit feedback", exact: true }).click();
    await expect(guest.getByRole("status").filter({ hasText: "Feedback sent to the builder" })).toBeVisible();
    await guest.getByRole("navigation", { name: "Mobile workspace" }).getByRole("link", { name: "Feedback", exact: true }).click();
    await expect(guest.getByRole("heading", { name: "Saved note disappeared" })).toBeVisible();
    await guest.getByRole("navigation", { name: "Mobile workspace" }).getByRole("link", { name: "My apps", exact: true }).click();
    await expect(guest.getByRole("heading", { name: "Orbit Notes", exact: true })).toBeVisible();
    await guest.getByRole("navigation", { name: "Mobile workspace" }).getByRole("link", { name: "Account", exact: true }).click();
    await expect(guest.getByRole("button", { name: "Sign out", exact: true })).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  } finally {
    await builder.close(); await tester.close(); await outsider.close(); await prisma.$disconnect();
  }
});
