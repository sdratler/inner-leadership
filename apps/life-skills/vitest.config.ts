import { defineConfig } from "vitest/config";
export default defineConfig({ test: { environment: "node", include: ["tests/unit/**/*.test.ts","tests/unit/academy-pricing.test.tsx","tests/unit/academy-website-design.test.tsx","tests/unit/academy-registration-accessibility.test.tsx","tests/unit/inquiry-email-setup-summary.test.tsx"], restoreMocks: true, clearMocks: true } });
