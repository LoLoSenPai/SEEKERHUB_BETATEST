import { test, expect } from "@playwright/test";

test("landing page renders primary CTA", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Create builder account" })).toBeVisible();
});
