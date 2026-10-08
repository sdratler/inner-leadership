import { defineConfig } from "@playwright/test";

const baseURL = process.env.PAGE_UI_BASE_URL;
if (!baseURL) throw new Error("PAGE_UI_BASE_URL is required");

export default defineConfig({
  testDir: ".",
  testMatch: "page-ui.spec.ts",
  timeout: 120_000,
  workers: 1,
  fullyParallel: false,
  reporter: "line",
  use: { baseURL, browserName: "chromium", locale: "en-GB", timezoneId: "Asia/Jerusalem" },
});
