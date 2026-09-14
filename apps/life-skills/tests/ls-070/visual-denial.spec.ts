import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

const evidence = process.env.LS070_VISUAL_OUT;
if (!evidence) throw new Error("LS070_VISUAL_OUT required");
mkdirSync(evidence, { recursive: true });

for (const viewport of [{ name: "mobile", width: 390, height: 844 }, { name: "desktop", width: 1440, height: 1000 }]) {
  for (const pageCase of [{ locale: "he", route: "app", dir: "rtl" }, { locale: "en", route: "app", dir: "ltr" }, { locale: "he", route: "family", dir: "rtl" }, { locale: "en", route: "family", dir: "ltr" }] as const) {
    test(`${pageCase.locale} ${pageCase.route} ${viewport.name} denies an unauthenticated viewer cleanly`, async ({ page }) => {
      await page.setViewportSize(viewport);
      const response = await page.goto(`/${pageCase.locale}/${pageCase.route}`, { waitUntil: "networkidle" });
      expect(response?.status()).toBe(200);
      await expect(page.locator("html")).toHaveAttribute("lang", pageCase.locale);
      await expect(page.locator("html")).toHaveAttribute("dir", pageCase.dir);
      await expect(page.getByRole("status")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.keyboard.press("Tab");
      const active = page.locator(":focus");
      await expect(active).toBeVisible();
      expect(await active.evaluate(element => getComputedStyle(element).outlineStyle)).not.toBe("none");
      await page.screenshot({ path: join(evidence, `${pageCase.locale}-${pageCase.route}-${viewport.name}.png`), fullPage: true });
    });
  }
}
