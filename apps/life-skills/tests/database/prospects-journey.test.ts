import { afterAll, expect, test, vi } from "vitest";
import { safeTestUrl } from "./calendar/fixture.ts";

vi.mock("server-only", () => ({}));

import { closeDatabase } from "../../src/db/client.ts";
import { drizzleIdentityStore } from "../../src/features/identity/drizzle-store.ts";
import { readProspectJourneys } from "../../src/features/prospects/journey-read.ts";

afterAll(async () => { await closeDatabase(); });

test("CRM journey read uses the production Drizzle adapter against native PostgreSQL", async () => {
  const previousUrl = process.env.LS_DATABASE_URL;
  const previousTls = process.env.LS_DATABASE_TLS;
  try {
    process.env.LS_DATABASE_URL = safeTestUrl();
    process.env.LS_DATABASE_TLS = "disable";
    const result = await readProspectJourneys(
      drizzleIdentityStore,
      "00000000-0000-4000-8000-000000000001",
      ["LS-LEAD-synthetic", "LS-LEAD-synthetic-two"],
    );
    expect([...result.entries()]).toEqual([]);
  } finally {
    await closeDatabase();
    if (previousUrl === undefined) delete process.env.LS_DATABASE_URL;
    else process.env.LS_DATABASE_URL = previousUrl;
    if (previousTls === undefined) delete process.env.LS_DATABASE_TLS;
    else process.env.LS_DATABASE_TLS = previousTls;
  }
});
