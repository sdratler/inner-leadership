import { test, expect } from "@playwright/test";
import { administrativeActionLabel, administrativeStageLabel, linkedInquiryTaskTitle } from "../../src/features/prospects/admin-display.ts";
import { uiCopy } from "../../src/ui/workspace/i18n.ts";

test("browser fixture loads UI messages and preserves safe administrative labels", async ({ page }, info) => {
  const title = "SYNTHETIC-ID · Respond to inbound WhatsApp inquiry";
  const unknown = "SYNTHETIC-ID · constructor";
  expect(uiCopy("he")).toBeTruthy();
  expect(uiCopy("en")).toBeTruthy();
  await page.setContent(`<main lang="he" dir="rtl"><p>${administrativeStageLabel("New inquiry", "he")}</p><p>${linkedInquiryTaskTitle(title, "crm_followup", "he")}</p><p>${linkedInquiryTaskTitle(unknown, "crm_followup", "he")}</p></main><aside lang="en" dir="ltr"><p>${administrativeActionLabel("Respond to inbound WhatsApp inquiry", "en")}</p></aside>`);
  await expect(page.locator('main[lang="he"]')).toContainText("פנייה חדשה");
  await expect(page.locator('main[lang="he"]')).toContainText("SYNTHETIC-ID · מענה לפניית WhatsApp נכנסת");
  await expect(page.locator('main[lang="he"]')).toContainText(unknown);
  await expect(page.locator('aside[lang="en"]')).toContainText("Respond to inbound WhatsApp inquiry");
  await page.screenshot({ path: info.outputPath("admin-display-loader.png"), fullPage: true });
});
