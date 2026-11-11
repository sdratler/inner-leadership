import { configDefaults, defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

if (process.env.VITEST_MAX_WORKERS !== undefined) {
  throw new Error("DATABASE_TEST_WORKER_OVERRIDE_FORBIDDEN");
}

// Only these audited, process-local PGlite suites may run together.
// New files and every PostgreSQL suite default to the serial project.
const isolatedMemoryTests = [
  "tests/database/fishing-service-acceptance-v4.pglite.test.ts",
  "tests/database/fishing-service-card-events-v4.pglite.test.ts",
  "tests/database/fishing-service-cash-reminders-v4.pglite.test.ts",
  "tests/database/fishing-service-current-card-v4.pglite.test.ts",
  "tests/database/fishing-service-owner-cards-v4.pglite.test.ts",
  "tests/database/fishing-service-owner-history-v4.pglite.test.ts",
  "tests/database/academy-inquiry-email-control-outbox.pglite.test.ts",
  "tests/database/academy-inquiry-email-verification.pglite.test.ts",
  "tests/database/academy-owner-notification.pglite.test.ts",
  "tests/database/academy-owner-scope.pglite.test.ts",
  "tests/database/bna-acknowledgment.pglite.test.ts",
  "tests/database/bna-optional-calendar.pglite.test.ts",
  "tests/database/bna-preferences.pglite.test.ts",
  "tests/database/bna-replies.pglite.test.ts",
  "tests/database/contact-ops/academy-crm-trip390.pglite.test.ts",
  "tests/database/fishing-billing-cards.pglite.test.ts",
  "tests/database/fishing-billing-current-encrypted-outbox-v3.pglite.test.ts",
  "tests/database/fishing-billing-current-reminders-v3.pglite.test.ts",
  "tests/database/fishing-billing-current-sdk-v3.pglite.test.ts",
  "tests/database/fishing-billing-guest-v3.pglite.test.ts",
  "tests/database/fishing-billing-inquiry-family-proposal.pglite.test.ts",
  "tests/database/fishing-billing-reminder-service.pglite.test.ts",
  "tests/database/fishing-billing.pglite.test.ts",
  "tests/database/fishing-fulfillment-readback-v1.pglite.test.ts",
  "tests/database/fishing-fulfillment-v1.pglite.test.ts",
  "tests/database/fishing-group-preparation-owner-http.pglite.test.ts",
  "tests/database/fishing-group-preparation-schema.pglite.test.ts",
  "tests/database/fishing-group-preparation.pglite.test.ts",
  "tests/database/fishing-inquiry-followups.pglite.test.ts",
  "tests/database/fishing-marketing-owner-scope.pglite.test.ts",
  "tests/database/fishing-marketing.pglite.test.ts",
  "tests/database/fishing-owner-identity-scope.pglite.test.ts",
  "tests/database/fishing-owner-sessions.pglite.test.ts",
  "tests/database/fishing-program-source-outcome-v3.pglite.test.ts",
  "tests/database/fishing-program-source-readback-v3.pglite.test.ts",
  "tests/database/fishing-program-source-v3.pglite.test.ts",
  "tests/database/fishing-seat-reservation-v1.pglite.test.ts",
  "tests/database/fishing-service-grant-resolver-v4.pglite.test.ts",
  "tests/database/fishing-service-material-v4-schema.pglite.test.ts",
  "tests/database/fishing-service-owner-http-v4.pglite.test.ts",
  "tests/database/fishing-service-plan-v1.pglite.test.ts",
  "tests/database/group-interest.pglite.test.ts",
  "tests/database/group-placement.pglite.test.ts",
  "tests/database/inquiry-email.pglite.test.ts",
  "tests/database/owner-305-conversations.pglite.test.ts",
  "tests/database/public-group-application.pglite.test.ts",
  "tests/database/trip390-ack-dispatch.pglite.test.ts",
  "tests/database/trip390-reservation-flow.pglite.test.ts",
  "tests/database/fishing-service-card-event-evidence-v4.pglite.test.ts",
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
