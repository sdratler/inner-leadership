import { configDefaults, defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

if (process.env.VITEST_MAX_WORKERS !== undefined) {
  throw new Error("DATABASE_TEST_WORKER_OVERRIDE_FORBIDDEN");
}

// Only these audited, process-local PGlite suites may run together.
// New files and every PostgreSQL suite default to the serial project.
const isolatedMemoryTests = [
  "tests/database/fishing-service-owner-cards-v4.pglite.test.ts",
  "tests/database/fishing-service-owner-history-v4.pglite.test.ts",
  "tests/database/fishing-service-current-card-v4.pglite.test.ts",
  "tests/database/fishing-service-card-events-v4.pglite.test.ts",
  "tests/database/fishing-service-cash-reminders-v4.pglite.test.ts",
  "tests/database/fishing-service-acceptance-v4.pglite.test.ts",
];

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    testTimeout: 15000,
    hookTimeout: 15000,
    maxWorkers: 2,
    projects: [
      {
        extends: true,
        test: {
          name: "isolated-memory",
          include: isolatedMemoryTests,
          fileParallelism: true,
          maxWorkers: 2,
          isolate: true,
          pool: "forks",
          sequence: { groupOrder: 1 },
        },
      },
      {
        extends: true,
        test: {
          name: "serial-database",
          include: ["tests/database/**/*.test.ts"],
          exclude: [...configDefaults.exclude, ...isolatedMemoryTests],
          fileParallelism: false,
          maxWorkers: 1,
          isolate: true,
          sequence: { groupOrder: 2 },
        },
      },
    ],
  },
});
