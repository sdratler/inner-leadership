import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "visual-denial.spec.ts",
  reporter: "list",
  fullyParallel: false,
  webServer: {
    command: "npm start",
    url: "http://127.0.0.1:3001/api/health",
    reuseExistingServer: false,
    timeout: 30_000,
    env: { ...process.env, NODE_ENV: "production", LS_APP_MODE: "foundation_preview", LS_APP_ORIGIN: "http://127.0.0.1:3001", LS_PRIVATE_APP_ENABLED: "true" },
  },
  use: { baseURL: "http://127.0.0.1:3001" },
});
