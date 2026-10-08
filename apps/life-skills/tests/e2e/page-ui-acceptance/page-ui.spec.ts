import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const configuredEvidenceDir = process.env.PAGE_UI_EVIDENCE_DIR;
test.skip(!configuredEvidenceDir, "development-only Page UI evidence run requires PAGE_UI_EVIDENCE_DIR");
const evidenceDir: string = configuredEvidenceDir ?? process.cwd();
if (configuredEvidenceDir) mkdirSync(evidenceDir, { recursive: true });

type Capture = {
  file: string;
  locale: "en" | "he";
  scenario: "unconfigured" | "unavailable" | "unknown";
  width: number;
  height: number;
  url: string;
  computed: Record<string, string | number | boolean>;
  sha256?: string;
};
const captures: Capture[] = [];

function route(locale: "en" | "he", scenario: Capture["scenario"]) {
  return `/${locale}/dev/ui/workspace?role=practitioner&page=app%2Fmarketing&section=content_calendar&scenario=${scenario}&layout=month&month=2026-10&date=2026-10-08`;
}

async function inspect(page: Page, locale: "en" | "he") {
  await page.evaluate(() => document.fonts.ready);
  const metrics = await page.evaluate(({ locale }) => {
    const root = document.querySelector<HTMLElement>(".lsw.lsu")!;
    const bodyText = document.querySelector<HTMLElement>(".lsr-page-publication-state > p:not(.lsr-page-publication-label):not(.lsr-eyebrow)")!;
    const heading = document.querySelector<HTMLElement>("#facebook-page-publication-title")!;
    const state = document.querySelector<HTMLElement>(".lsr-page-publication-state")!;
    const bodyStyle = getComputedStyle(bodyText), headingStyle = getComputedStyle(heading), stateStyle = getComputedStyle(state);
    return {
      direction: root.dir,
      bodyFont: bodyStyle.fontFamily,
      bodySize: bodyStyle.fontSize,
      headingFont: headingStyle.fontFamily,
      headingSize: headingStyle.fontSize,
      headingWeight: headingStyle.fontWeight,
      fontLoaded: locale === "he" ? document.fonts.check('16px "Heebo"') && document.fonts.check('19px "Frank Ruhl Libre"') : true,
      stateBackground: stateStyle.backgroundColor,
      stateRadius: stateStyle.borderRadius,
      stateInlineStart: locale === "he" ? stateStyle.borderRightWidth : stateStyle.borderLeftWidth,
      documentOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      documentWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    };
  }, { locale });
  expect(metrics.direction).toBe(locale === "he" ? "rtl" : "ltr");
  expect(["16px", "17px"]).toContain(metrics.bodySize);
  expect(metrics.bodyFont.toLowerCase()).toContain(locale === "he" ? "heebo" : "system-ui");
  expect(metrics.headingFont.toLowerCase()).toContain(locale === "he" ? "frank ruhl libre" : "georgia");
  expect(metrics.headingSize).toBe("19px");
  expect(Number(metrics.headingWeight)).toBeGreaterThanOrEqual(700);
  expect(metrics.fontLoaded).toBe(true);
  expect(metrics.stateBackground).toBe("rgba(0, 0, 0, 0)");
  expect(metrics.stateRadius).toBe("0px");
  expect(metrics.stateInlineStart).toBe("4px");
  expect(metrics.documentOverflow).toBe(false);
  return metrics;
}

async function capture(page: Page, locale: "en" | "he", scenario: Capture["scenario"], width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.goto(route(locale, scenario));
  await expect(page.locator("[data-synthetic-scenario] strong")).toBeVisible();
  await expect(page.getByRole("region", { name: locale === "he" ? "יומן תוכן חודשי" : "Monthly content calendar" })).toBeVisible();
  const text = await page.locator("body").innerText();
  expect(text).not.toContain("private-row-id");
  expect(text).not.toContain("FACEBOOK_PAGE_BINDING_UNVERIFIED");
  expect(text).not.toContain("PROVIDER_READBACK_UNAVAILABLE");
  expect(await page.getByRole("button", { name: /publish|retry|approve|פרסם|ניסיון חוזר|אישור/i }).count()).toBe(0);
  const computed = await inspect(page, locale);
  const file = `${locale}-${scenario}-${width}x${height}.png`;
  await page.screenshot({ path: join(evidenceDir, file), fullPage: true });
  captures.push({ file, locale, scenario, width, height, url: page.url(), computed });
}

test("composed owner-only Marketing Page states meet responsive, font, focus and navigation acceptance", async ({ page }) => {
  for (const locale of ["en", "he"] as const) {
    for (const [width, height] of [[340, 800], [390, 844], [768, 1024], [1440, 900]] as const)
      await capture(page, locale, "unconfigured", width, height);
    await capture(page, locale, "unavailable", 390, 844);
    await capture(page, locale, "unknown", 390, 844);
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(route("en", "unknown"));
  await page.locator(".lsr-content-filters").getByText(/Filters:/).click();
  await page.locator('select[name="channel"]').selectOption("facebook_page");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page.locator('[data-synthetic-scenario="unknown"]')).toBeVisible();
  const filteredUrl=new URL(page.url());
  expect(filteredUrl.searchParams.getAll("section")).toEqual(["content_calendar"]);
  expect(filteredUrl.searchParams.get("scenario")).toBe("unknown");
  expect(filteredUrl.searchParams.get("channel")).toBe("facebook_page");

  await page.getByRole("link", { name: "מעבר לעברית" }).click();
  await expect(page.locator('[data-synthetic-scenario="unknown"]')).toBeVisible();
  expect(page.url()).toContain("/he/dev/ui/workspace");expect(page.url()).toContain("scenario=unknown");expect(page.url()).toContain("channel=facebook_page");
  await expect(page.getByRole("heading", { name: "דף Facebook נפרד" })).toBeVisible();
  await page.getByRole("link", { name: "Switch to English" }).click();
  await expect(page.locator('[data-synthetic-scenario="unknown"]')).toBeVisible();
  expect(page.url()).toContain("/en/dev/ui/workspace");

  const month = page.getByRole("link", { name: "Month", exact: true });
  await month.focus();
  const focus = await month.evaluate(node => { const style = getComputedStyle(node); return { color: style.outlineColor, width: style.outlineWidth, offset: style.outlineOffset }; });
  expect(focus).toEqual({ color: "rgb(230, 208, 164)", width: "3px", offset: "4px" });

  await page.getByRole("link", { name: "Week", exact: true }).click();
  await expect(page).toHaveURL(/layout=week/);
  for (const value of ["role=practitioner", "page=app%2Fmarketing", "section=content_calendar", "scenario=unknown"])
    expect(page.url()).toContain(value);
  await expect(page.getByRole("region", { name: "Weekly content calendar" })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("region", { name: "Monthly content calendar" })).toBeVisible();
  await page.getByRole("link", { name: "Agenda", exact: true }).click();
  await expect(page).toHaveURL(/layout=agenda/);
  await expect(page.getByRole("region", { name: "Content agenda" })).toBeVisible();
  await page.goBack();

  const skipPage=await page.context().newPage();
  await skipPage.goto(route("en", "unknown"));
  await skipPage.keyboard.press("Tab");
  await expect(skipPage.getByRole("link", { name: "Skip to content" })).toBeFocused();
  await skipPage.keyboard.press("Enter");
  await expect(skipPage.locator("#lsw-main")).toBeFocused();
  await skipPage.close();

  for (const entry of captures) entry.sha256 = createHash("sha256").update(readFileSync(join(evidenceDir, entry.file))).digest("hex");
  writeFileSync(join(evidenceDir, "evidence.json"), JSON.stringify({ generatedAt: new Date().toISOString(), kind: "development-only composed synthetic route", providerAction: false, captures }, null, 2) + "\n");
});
