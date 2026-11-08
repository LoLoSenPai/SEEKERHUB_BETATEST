import { test, expect } from "@playwright/test";

test("homepage explains the product without a role-selection gate", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Good apps are.*built together/);
  await expect(page.getByRole("link", { name: "Get started", exact: true }).first()).toHaveAttribute("href", "/sign-in?returnTo=%2Fdashboard");
  await expect(page.getByRole("link", { name: "Sign in", exact: true })).toHaveAttribute("href", "/sign-in");
  await expect(page.getByRole("link", { name: /I'm a tester|Publish an app/ })).toHaveCount(0);
  await page.getByRole("link", { name: "How it works", exact: true }).first().click();
  await expect(page).toHaveURL(/#how-it-works$/);
  for (const name of ["Upload", "Share", "Improve"]) await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
});

test("legacy intents open the same account entry instead of role tabs", async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  for (const intent of ["builder", "tester"]) {
    await page.goto(`/sign-in?intent=${intent}`);
    await expect(page.getByRole("button", { name: "Send magic link" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^(Connect wallet|Use installed wallet)$/ })).toHaveCount(1);
    await expect(page.getByRole("link", { name: /^(Builder|Tester)$/ })).toHaveCount(0);
  }
  expect(pageErrors).toEqual([]);
});

test("mobile landing keeps the primary actions visible", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await expect(page.getByRole("link", { name: "Get started", exact: true }).first()).toBeInViewport();
  await expect(page.getByRole("button", { name: /theme/i })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    const artwork = await page.locator(".home-hero-art").boundingBox();
    expect(artwork).not.toBeNull();
    expect(Math.abs(artwork!.width - artwork!.height)).toBeLessThan(1);
  }
});
