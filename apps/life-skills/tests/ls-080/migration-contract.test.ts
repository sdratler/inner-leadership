import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(new URL("../../migrations/0080_ls_context_updates_20260911.sql", import.meta.url), "utf8");

describe("LS-080 migration contract", () => {
  it("declares every table column exactly once", () => {
    const blocks = [...sql.matchAll(/CREATE TABLE IF NOT EXISTS\s+([a-z_.]+)\s*\(([\s\S]*?)\n\);/g)];
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) {
      const names = block[2]!.split("\n").map(line => /^\s*([a-z][a-z0-9_]*)\s+(?:uuid|text|timestamptz|boolean|integer)\b/.exec(line)?.[1]).filter((name): name is string => Boolean(name));
      expect(new Set(names).size, `duplicate column in ${block[1]}`).toBe(names.length);
    }
  });

  it("requires a published immutable LS-040 version snapshot", () => {
    expect(sql).toContain("pv.state='published'");
    expect(sql).toContain("pv.immutable_snapshot_digest=NEW.practice_snapshot_digest");
    expect(sql).toContain("pv.published_at=NEW.practice_published_at");
  });

  it("enforces parent attribution and an explicit full family audience", () => {
    expect(sql).toContain("a.role='parent'");
    expect(sql).toContain("au.visibility='family_full'");
    expect(sql).toContain("aa.revoked_at IS NULL");
    expect(sql).toContain("g.revoked_at IS NULL");
  });

  it("keeps parent report evidence immutable while allowing monotonic review metadata", () => {
    expect(sql).toContain("LS_UPDATES_IMMUTABLE_REPORT");
    expect(sql).toContain("LS_UPDATES_REVIEW_HISTORY_REQUIRED");
    expect(sql).toContain("OLD.review_state='adapted'");
  });

  it("keeps published replies and adaptation receipts immutable", () => {
    expect(sql).toContain("OLD.state='published'");
    expect(sql).toContain("protect_adaptation_receipt");
  });

  it("contains no grading, rating, attendance or clinical-verification columns", () => {
    const declarations = sql.split("CREATE OR REPLACE FUNCTION")[0]!.toLowerCase();
    for (const term of [" rating ", " grade ", " score ", " attendance ", " witnessed ", " clinically_verified "]) {
      expect(declarations).not.toContain(term);
    }
  });

  it("records adaptation as an unpublished draft only", () => {
    expect(sql).toContain("state text NOT NULL CHECK(state='draft')");
    expect(sql).toContain("newv.state='draft'");
  });
});
