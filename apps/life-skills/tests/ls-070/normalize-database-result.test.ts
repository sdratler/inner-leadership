import { describe, expect, it } from "vitest";
import { normalizeDatabaseRows } from "../../src/features/integration/normalize-database-result.ts";

describe("LS-070 database result normalization", () => {
  it("converts only PostgreSQL timestamptz fields to Date values", () => {
    const rows = normalizeDatabaseRows([
      { occurredAt: "2026-09-11 23:06:51.109892+03", dueOn: "2026-09-11", label: "unchanged" },
    ], [
      { name: "occurredAt", dataTypeID: 1184 },
      { name: "dueOn", dataTypeID: 1082 },
      { name: "label", dataTypeID: 25 },
    ]);
    expect(rows[0]?.occurredAt).toEqual(new Date("2026-09-11T20:06:51.109Z"));
    expect(rows[0]?.dueOn).toBe("2026-09-11");
    expect(rows[0]?.label).toBe("unchanged");
  });

  it("preserves null and already-normalized timestamptz values", () => {
    const existing = new Date("2026-09-11T20:06:51.109Z");
    const rows = normalizeDatabaseRows([{ a: null, b: existing }], [
      { name: "a", dataTypeID: 1184 }, { name: "b", dataTypeID: 1184 },
    ]);
    expect(rows[0]).toEqual({ a: null, b: existing });
  });

  it("fails closed when a timestamptz field cannot be normalized", () => {
    expect(() => normalizeDatabaseRows([{ occurredAt: "not-a-timestamp" }], [
      { name: "occurredAt", dataTypeID: 1184 },
    ])).toThrow("DATABASE_TIMESTAMP_INVALID");
  });
});
