import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({ resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } }, test: { environment: "node", include: ["tests/database/**/*.test.ts"], fileParallelism: false, testTimeout: 15000, hookTimeout: 15000 } });
