import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 } });

test("public landing presents both paths in the first viewport without horizontal overflow", async ({ page }) => {
  await page.goto("/");
  for (const name of [/Publish an app/, /I'm a tester/]) {
    const link = page.getByRole("link", { name });
    await expect(link).toBeVisible();
    const box = await link.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y + box!.height).toBeLessThanOrEqual(844);
  }
  await expect(page.getByRole("heading", { name: "How testing works" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("tester recovery and account links retain the destination", async ({ page }) => {
  const target = "/tester/releases/example";
  await page.goto(`/sign-in?intent=tester&returnTo=${encodeURIComponent(target)}`);
  await expect(page.getByText(/no public app catalogue/i)).toBeVisible();
  await expect(page.getByRole("link", { name: "Switch to builder sign in" })).toHaveAttribute("href", /returnTo=%2Ftester%2Freleases%2Fexample/);
  await page.getByRole("link", { name: "Switch to builder sign in" }).click();
  await expect(page.getByRole("link", { name: "Create a workspace" })).toHaveAttribute("href", /returnTo=%2Ftester%2Freleases%2Fexample/);
  await page.goto(`/magic-link-sent?email=test%40example.test&returnTo=${encodeURIComponent(target)}`);
  await expect(page.getByRole("link", { name: "Resend or change email" })).toHaveAttribute("href", /returnTo=%2Ftester%2Freleases%2Fexample/);
  await expect(page.getByRole("link", { name: "Return to testing" })).toHaveAttribute("href", target);
});

test("unavailable invitations offer a safe next step", async ({ page }) => {
  // Requires a configured test database; this deliberately uses no real invite.
  await page.goto("/invite/not-a-real-invitation");
  await expect(page.getByRole("heading", { name: "This invitation is unavailable" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Recover tester access" })).toBeVisible();
});
