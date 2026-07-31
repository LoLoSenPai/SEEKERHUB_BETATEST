import { test, expect } from "@playwright/test";

test("landing page exposes only the two primary intents", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("link", { name: /Publish an app/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /I'm a tester/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/sign-in?intent=builder");
});

test("builder and tester intents open distinct authentication flows", async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  await page.goto("/");
  await page.getByRole("link", { name: /Publish an app/ }).click();
  await expect(page).toHaveURL(/\/sign-up\?intent=builder/);
  await expect(page.getByRole("heading", { name: "Create account" })).toBeVisible();

  await page.goto("/sign-in?intent=tester&returnTo=%2Ftester");
  await expect(page.getByRole("heading", { name: "Email me a sign-in link" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send magic link" })).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("mobile landing keeps the primary actions visible", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await expect(page.getByRole("link", { name: /Publish an app/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /I'm a tester/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /theme/i })).toBeVisible();
});
