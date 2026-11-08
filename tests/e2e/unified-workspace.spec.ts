import { randomBytes, randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "better-auth/crypto";
import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

function reviewDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  const appUrl = process.env.PLAYWRIGHT_BASE_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  if (process.env.RUN_INTEGRATION_TESTS !== "true" || !databaseUrl || !appUrl ||
      !new URL(databaseUrl).pathname.toLowerCase().includes("test") ||
      [databaseUrl, appUrl].some(value => !["127.0.0.1", "localhost"].includes(new URL(value).hostname))) {
    throw new Error("Unified workspace tests require explicit disposable loopback services.");
  }
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
}

test.beforeEach(async ({ page }) => {
  const bytes = randomBytes(2);
  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": `198.18.${bytes[0]}.${bytes[1]}` });
});

test("one account starts testing, activates publishing explicitly and remembers the workspace", async ({ page, baseURL }, testInfo) => {
  test.setTimeout(120_000);
  const prisma = reviewDatabase();
  const id = randomUUID();
  const email = `unified-${id}@example.test`;
  const password = `Unified-${id}`;
  const user = await prisma.user.create({ data: { name: "Unified workspace test", email, emailVerified: true } });
  await prisma.account.create({ data: { userId: user.id, accountId: user.id, providerId: "credential", password: await hashPassword(password) } });
  try {
    await page.goto("/sign-in");
    await page.getByRole("button", { name: "Use a password instead" }).click();
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("heading", { name: "One account. Both sides of a beta." })).toBeVisible();
    expect(await prisma.builderProfile.findUnique({ where: { userId: user.id } })).toBeNull();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath("welcome-desktop.png") });
    await page.getByRole("button", { name: "Open my testing library" }).click();
    await expect(page).toHaveURL(/\/tester$/);
    await expect(page.getByRole("heading", { name: "No apps yet" })).toBeVisible();
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/tester$/);
    await page.getByRole("button", { name: "Publishing", exact: true }).filter({ visible: true }).click();
    await expect(page).toHaveURL(/\/builder\/onboarding/);
    expect(await prisma.builderProfile.findUnique({ where: { userId: user.id } })).toBeNull();
    await page.getByRole("button", { name: "Activate publishing" }).click();
    await expect(page).toHaveURL(/\/builder$/);
    expect(await prisma.builderProfile.count({ where: { userId: user.id } })).toBe(1);
    // Next can stream this redirect as a 200; assert the actual browser destination.
    await page.goto(`/builder/onboarding?returnTo=${encodeURIComponent("/\t/outside.invalid")}`);
    await expect(page).toHaveURL(new URL("/builder", baseURL!).toString());
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/builder$/);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Testing", exact: true }).filter({ visible: true }).click();
    await expect(page).toHaveURL(/\/tester$/);
    await expect(page.getByRole("heading", { name: "My apps", exact: true, level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "No apps yet" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath("testing-switch-mobile.png") });
    await page.goto("/");
    await page.getByRole("link", { name: "Open dashboard", exact: true }).first().click();
    await expect(page).toHaveURL(/\/tester$/);
    const session = await page.request.get("/api/auth/get-session");
    expect((await session.json()).user.id).toBe(user.id);
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.$disconnect();
  }
});

test("guest cannot publish and a wallet-only account adds email without another registration", async ({ page }) => {
  const prisma = reviewDatabase();
  let userId: string | undefined;
  try {
    const guest = await page.request.post("/api/auth/sign-in/anonymous", { data: {} });
    expect(guest.ok()).toBe(true);
    userId = (await guest.json()).user.id;
    await page.goto("/builder");
    await expect(page).toHaveURL(/\/sign-in\?returnTo=%2Fbuilder$/);
    expect(await prisma.builderProfile.count({ where: { userId } })).toBe(0);
    // Seed the already authenticated wallet-account state; wallet signatures have separate E2E coverage.
    await prisma.user.update({ where: { id: userId }, data: { isAnonymous: false, email: `wallet-${randomUUID()}@seekerhub.local` } });
    await page.goto("/builder");
    await expect(page).toHaveURL(/\/builder\/onboarding/);
    await expect(page.getByRole("heading", { name: "Add your publishing email" })).toBeVisible();
    await expect(page.getByLabel("Account email", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Activate publishing" })).toHaveCount(0);
    expect(await prisma.builderProfile.count({ where: { userId } })).toBe(0);
    const denied = await page.request.post("/api/uploads/releases", { data: {} });
    expect(denied.status()).toBe(403);
    expect((await denied.json()).code).toBe("EMAIL_NOT_VERIFIED");
  } finally {
    if (userId) await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  }
});
