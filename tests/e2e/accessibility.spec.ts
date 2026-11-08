import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

for (const route of ["/", "/sign-in", "/sign-in?method=password&returnTo=%2Ftester", "/sign-up"]) {
  test(`has no automated accessibility violations on ${route}`, async ({ page }) => {
    await page.goto(route);
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
}

for (const width of [320, 390, 1440]) {
  test(`public pages have no overflow or accessibility violations at ${width}px in both themes`, async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 900 });
    for (const route of ["/", "/sign-in", "/sign-up"]) {
      await page.goto(route);
      for (const theme of ["light", "dark"]) {
        if (await page.locator("html").getAttribute("data-theme") !== theme) await page.getByRole("button", { name: `Switch to ${theme} theme` }).click();
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        await page.mouse.move(0, 0);
        // Measure settled colors, not an intermediate frame of the theme transition.
        await page.evaluate(async () => {
          await document.fonts.ready;
          await Promise.all(document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})));
        });
        await page.waitForTimeout(350);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        expect((await new AxeBuilder({ page }).analyze()).violations, `${route} ${theme} ${width}`).toEqual([]);
        await page.screenshot({ path: testInfo.outputPath(`${route.replaceAll("/", "") || "homepage"}-${theme}-${width}.png`), fullPage: route === "/" });
        if (route === "/") await page.screenshot({ path: testInfo.outputPath(`homepage-hero-${theme}-${width}.png`), fullPage: false });
      }
    }
  });
}
