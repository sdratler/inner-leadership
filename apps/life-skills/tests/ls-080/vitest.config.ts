import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node", include: ["tests/ls-080/**/*.test.ts"], restoreMocks: true, clearMocks: true },
});

