import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 } });

test("public landing presents one starting point without horizontal overflow", async ({ page }) => {
  await page.goto("/");
  for (const name of ["Get started"]) {
    const link = page.getByRole("link", { name, exact: true }).first();
    await expect(link).toBeVisible();
    const box = await link.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y + box!.height).toBeLessThanOrEqual(844);
  }
  await expect(page.getByRole("heading", { name: "Invited to test? Start here." })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("email, password and registration keep the invitation destination", async ({ page }) => {
  const target = "/tester/releases/example";
  await page.goto(`/sign-in?intent=tester&returnTo=${encodeURIComponent(target)}`);
  await expect(page.getByRole("button", { name: "Send magic link" })).toBeVisible();
  await page.getByRole("button", { name: "Use a password instead" }).click();
  await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Create account", exact: true })).toHaveAttribute("href", /returnTo=%2Ftester%2Freleases%2Fexample/);
  await page.getByRole("link", { name: "Create account", exact: true }).click();
  await expect(page).toHaveURL(/\/sign-up\?returnTo=%2Ftester%2Freleases%2Fexample/);
  await expect(page.getByRole("link", { name: "Sign in", exact: true })).toHaveAttribute("href", /returnTo=%2Ftester%2Freleases%2Fexample/);
  await page.goto(`/magic-link-sent?email=test%40example.test&returnTo=${encodeURIComponent(target)}`);
  await expect(page.getByRole("link", { name: "Resend or change email" })).toHaveAttribute("href", /returnTo=%2Ftester%2Freleases%2Fexample/);
  await expect(page.getByRole("link", { name: "Continue to SeekerHub" })).toHaveAttribute("href", target);
});

test("unavailable invitations offer a safe next step", async ({ page }) => {
  // Requires a configured test database; this deliberately uses no real invite.
  await page.goto("/invite/not-a-real-invitation");
  await expect(page.getByRole("heading", { name: "This invitation is unavailable" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Recover tester access" })).toBeVisible();
});
