import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { hashPassword } from "better-auth/crypto";
import sharp from "sharp";

async function waitForWorkspaceAppearance(page: Page) {
  await test.step(`Workspace readiness: ${new URL(page.url()).pathname}`, async () => {
    try {
      await page.waitForFunction(() => {
        // Read computed styles before checking fonts: layout can trigger font loading.
        const revealed = [...document.querySelectorAll(".workspace-enter")].every(element => {
          const style = getComputedStyle(element);
          return style.opacity === "1" && (style.transform === "none" || style.transform === "matrix(1, 0, 0, 1, 0, 0)");
        });
        const moving = document.getAnimations().some(animation =>
          Number.isFinite(animation.effect?.getComputedTiming().endTime) &&
          animation.playState !== "finished" && animation.playState !== "idle",
        );
        return document.fonts.status === "loaded" && revealed && !moving;
      }, undefined, { timeout: 5_000, polling: "raf" });
    } catch (cause) {
      const diagnostics = await bounded(page.evaluate(() => ({
        url: location.href,
        fontsStatus: document.fonts.status,
        fonts: [...document.fonts].map(font => ({ family: font.family, status: font.status })),
        workspaces: [...document.querySelectorAll(".workspace-enter")].map(element => ({
          opacity: getComputedStyle(element).opacity, transform: getComputedStyle(element).transform,
        })),
        animations: document.getAnimations().map(animation => ({
          name: animation instanceof CSSAnimation ? animation.animationName : animation.id,
          playState: animation.playState, playbackRate: animation.playbackRate,
          currentTime: String(animation.currentTime),
          endTime: String(animation.effect?.getComputedTiming().endTime),
        })),
      })), 1_000, "readiness diagnostics").catch(error => ({ unavailable: String(error) }));
      throw new Error(`Workspace did not settle within 5000ms: ${JSON.stringify(diagnostics)}`, { cause });
    }
  });
}

async function bounded<T>(operation: Promise<T>, timeout: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} exceeded ${timeout}ms`)), timeout);
    })]);
  } finally {
    clearTimeout(timer);
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
  const contexts = [["builder", builder], ["tester", tester], ["outsider", outsider]] as const;
  const traced = new Set<string>();
  let primaryFailure = false;
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
    for (const [name, context] of contexts) {
      await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
      traced.add(name);
    }
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
    await test.step("Screenshot: builder fallback", () => page.screenshot({ path: testInfo.outputPath("builder-fallback-desktop.png"), fullPage: false, caret: "initial", timeout: 5_000 }));
    const asset = await readFile("public/images/workspace-atmosphere.png");
    const image = await sharp(asset).resize(1200, 600).png().toBuffer();
    const screenshot = await sharp(asset).resize(1080, 1920).png().toBuffer();
    const manager = page.getByRole("region", { name: "Project images" });
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const theme of ["light", "dark"]) {
        if (await page.locator("html").getAttribute("data-theme") !== theme) {
          await page.getByRole("button", { name: "Account and appearance", exact: true }).click();
          await page.getByRole("button", { name: `Switch to ${theme} theme`, exact: true }).click();
          await page.keyboard.press("Escape");
        }
        await manager.scrollIntoViewIfNeeded();
        await page.mouse.move(0, 0);
        await waitForWorkspaceAppearance(page);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await expect(manager.locator('input[type="file"]:visible')).toHaveCount(0);
        await test.step(`Axe: empty media ${theme} ${width}`, async () => {
          expect((await new AxeBuilder({ page }).include("#images").analyze()).violations).toEqual([]);
        }, { timeout: 15_000 });
        await test.step(`Screenshots: empty media ${theme} ${width}`, async () => {
          await page.screenshot({ path: testInfo.outputPath(`media-picker-empty-${theme}-${width}.png`), fullPage: false, caret: "initial", timeout: 5_000 });
          await manager.screenshot({ path: testInfo.outputPath(`media-picker-card-${theme}-${width}.png`), timeout: 5_000 });
        });
      }
    }
    let releaseUpload!: () => void;
    const uploadGate = new Promise<void>(resolve => { releaseUpload = resolve; });
    await page.route("**/api/project-media?**", async route => {
      if (route.request().method() === "POST") await uploadGate;
      await route.continue();
    });
    for (const [label, kind] of [["Add app icon", "ICON"], ["Add app banner", "BANNER"], ["Add screenshot", "SCREENSHOT"]]) {
      await expect(manager.getByRole("button", { name: label, exact: true })).toBeEnabled();
      const picker = manager.getByRole("button", { name: label, exact: false });
      await picker.focus();
      const fileChooserPromise = page.waitForEvent("filechooser");
      await picker.press("Enter");
      const fileChooser = await fileChooserPromise;
      await fileChooser.setFiles({ name: "qa-image.png", mimeType: "image/png", buffer: kind === "SCREENSHOT" ? screenshot : image });
      if (kind === "ICON") {
        await expect(manager.getByRole("img", { name: "app icon", exact: true })).toHaveAttribute("src", /^blob:/);
        await expect(manager.getByText("Saving...", { exact: true })).toBeVisible();
        expect(await prisma.projectMedia.count({ where: { projectId: project.id } })).toBe(0);
        await expect(manager.getByRole("button", { name: "Replace app icon", exact: true })).toBeDisabled();
        releaseUpload();
      }
      await expect(manager.getByRole("status")).toHaveText(/saved\./);
      await expect.poll(() => prisma.projectMedia.count({ where: { projectId: project.id, kind: kind as "ICON" | "BANNER" | "SCREENSHOT", status: "READY" } })).toBe(1);
    }
    await page.unroute("**/api/project-media?**");
    expect(await prisma.projectMedia.findFirst({ where: { projectId: project.id, kind: "BANNER", status: "READY" }, select: { width: true, height: true } })).toEqual({ width: 1200, height: 600 });
    await manager.getByRole("button", { name: "Replace app banner", exact: true }).focus();
    const replacementChooserPromise = page.waitForEvent("filechooser");
    await page.keyboard.press("Enter");
    await (await replacementChooserPromise).setFiles({ name: "replacement.png", mimeType: "image/png", buffer: image });
    await expect(manager.getByRole("status")).toHaveText("App banner saved.");
    await manager.locator('input[type="file"][aria-label="Add screenshot"]').setInputFiles({ name: "second.png", mimeType: "image/png", buffer: screenshot });
    await expect(manager.getByRole("status")).toHaveText("Screenshot saved.");
    const previousOrder = await prisma.projectMedia.findMany({ where: { projectId: project.id, kind: "SCREENSHOT", status: "READY" }, orderBy: { position: "asc" }, select: { id: true } });
    const secondGrip = manager.getByRole("button", { name: "Move screenshot 2", exact: true });
    await secondGrip.focus();
    await page.keyboard.press("Space");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Space");
    await expect(manager.getByRole("status")).toHaveText("Screenshot order saved.");
    expect((await prisma.projectMedia.findMany({ where: { projectId: project.id, kind: "SCREENSHOT", status: "READY" }, orderBy: { position: "asc" }, select: { id: true } })).map(row => row.id)).toEqual(previousOrder.map(row => row.id).reverse());
    await expect(manager.getByRole("button", { name: "Move screenshot 1", exact: true })).toBeEnabled();
    await waitForWorkspaceAppearance(page);
    await manager.getByRole("button", { name: "Move screenshot 1", exact: true }).scrollIntoViewIfNeeded();
    const grip = await manager.getByRole("button", { name: "Move screenshot 1", exact: true }).boundingBox();
    const destination = await manager.locator("[data-media-id]").nth(1).boundingBox();
    expect(grip).not.toBeNull(); expect(destination).not.toBeNull();
    await page.mouse.move(grip!.x + grip!.width / 2, grip!.y + grip!.height / 2);
    await page.mouse.down();
    await page.mouse.move(grip!.x + grip!.width / 2 + 15, grip!.y + grip!.height / 2, { steps: 5 });
    await page.mouse.move(destination!.x + destination!.width / 2, destination!.y + destination!.height / 2, { steps: 15 });
    await page.mouse.up();
    await expect.poll(async () => (await prisma.projectMedia.findMany({ where: { projectId: project.id, kind: "SCREENSHOT", status: "READY" }, orderBy: { position: "asc" }, select: { id: true } })).map(row => row.id)).toEqual(previousOrder.map(row => row.id));
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await manager.scrollIntoViewIfNeeded(); await page.mouse.move(0, 0);
      await waitForWorkspaceAppearance(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect((await new AxeBuilder({ page }).include("#images").analyze()).violations).toEqual([]);
      await manager.screenshot({ path: testInfo.outputPath(`media-populated-${width}.png`), timeout: 5_000 });
    }
    const originalIcon = await manager.getByRole("img", { name: "app icon", exact: true }).getAttribute("src");
    await page.route("**/api/project-media?**", async route => route.request().method() === "POST"
      ? route.fulfill({ status: 422, contentType: "application/json", body: JSON.stringify({ error: "The test image was rejected." }) }) : route.continue());
    await manager.locator('input[type="file"][aria-label="Replace app icon"]').setInputFiles({ name: "rejected.png", mimeType: "image/png", buffer: image });
    await expect(manager.getByRole("alert")).toContainText("Your previous images are unchanged");
    await expect(manager.getByRole("img", { name: "app icon", exact: true })).toHaveAttribute("src", originalIcon!);
    await page.unroute("**/api/project-media?**");
    await manager.getByRole("button", { name: "Retry upload", exact: true }).click();
    await expect(manager.getByRole("status")).toHaveText("App icon saved.");
    await expect(manager.getByRole("alert")).toHaveCount(0);
    await page.route("**/api/project-media?**", async route => {
      if (route.request().method() !== "POST") { await route.continue(); return; }
      await route.fetch();
      await route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: "Response lost after save." }) });
    });
    await manager.locator('input[type="file"][aria-label="Replace app icon"]').setInputFiles({ name: "lost-response.png", mimeType: "image/png", buffer: image });
    await expect(manager.getByRole("alert")).toContainText("could not confirm the save");
    await expect(manager.getByRole("button", { name: "Retry upload", exact: true })).toHaveCount(0);
    await page.unroute("**/api/project-media?**");
    await manager.getByRole("button", { name: "Refresh images", exact: true }).click();
    await expect(manager.getByRole("status")).toHaveText("Images refreshed.");
    expect(await prisma.projectMedia.count({ where: { projectId: project.id, kind: "ICON", status: "READY" } })).toBe(1);
    await manager.getByRole("button", { name: "Remove screenshot 2", exact: true }).click();
    await expect(manager.getByRole("status")).toHaveText("Image removed.");
    await page.goto(`${baseUrl}/builder/apps/${project.slug}`);
    await expect(page.getByRole("img", { name: "Orbit Notes icon" }).first()).toBeVisible();
    await expect.poll(() => page.locator("img").evaluateAll(images => images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
    await waitForWorkspaceAppearance(page);
    await test.step("Axe: builder with saved media", async () => {
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    }, { timeout: 15_000 });
    await test.step("Screenshot: builder with saved media", () => page.screenshot({ path: testInfo.outputPath("builder-media-desktop.png"), fullPage: false, caret: "initial", timeout: 5_000 }));
    const rows = await prisma.projectMedia.findMany({ where: { projectId: project.id, status: "READY" } });
    const profile = await prisma.builderProfile.findUniqueOrThrow({ where: { userId: owner.id } });
    const retained = await prisma.projectMedia.findMany({ where: { projectId: project.id } });
    expect(profile.usedStorageBytes).toBe(retained.reduce((sum, row) => sum + row.fileSizeBytes, 0n));
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
    await test.step("Axe: tester with saved media", async () => {
      expect((await new AxeBuilder({ page: guest }).analyze()).violations).toEqual([]);
    }, { timeout: 15_000 });
    await test.step("Screenshot: tester with saved media", () => guest.screenshot({ path: testInfo.outputPath("tester-media-mobile.png"), fullPage: false, caret: "initial", timeout: 5_000 }));
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
  } catch (error) {
    primaryFailure = true;
    throw error;
  } finally {
    const failed = primaryFailure || testInfo.status !== testInfo.expectedStatus;
    // Disconnect independently; trace/close failures must not replace the test failure.
    const cleanup = await Promise.allSettled([
      bounded(prisma.$disconnect(), 5_000, "Prisma disconnect"),
      ...contexts.map(async ([name, context]) => {
        try {
          if (traced.has(name)) {
            const path = failed ? testInfo.outputPath(`${name}-failure-trace.zip`) : undefined;
            await bounded(context.tracing.stop({ path }), 5_000, `${name} trace stop`);
            if (path) await testInfo.attach(`${name}-failure-trace`, { path, contentType: "application/zip" });
          }
        } finally {
          await bounded(context.close(), 5_000, `${name} context close`);
        }
      }),
    ]);
    const errors = cleanup.filter(result => result.status === "rejected").map(result => result.reason);
    if (errors.length) {
      if (!failed) throw new AggregateError(errors, "Project media cleanup failed");
      await testInfo.attach("cleanup-errors", { body: errors.map(String).join("\n"), contentType: "text/plain" }).catch(() => undefined);
    }
  }
});
