import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DatabaseAttendanceReader, unavailableAttendanceReader, unavailableParentReportReader } from "../../src/features/progress/sources.ts";
import { asId } from "../../src/lib/ids.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const migration = readFileSync(`${root}migrations/0050_forms_resources_qualitative_reviews_20260911.sql`, "utf8");
const reviewTable = migration.match(/CREATE TABLE IF NOT EXISTS ls_progress\.qualitative_reviews \(([\s\S]*?)\n\);/)?.[1] ?? "";

describe("LS-050 isolation and database contract", () => {
  it("fails closed while calendar and parent-report adapters are unavailable", async () => {
    const scope = { workspaceId: asId("10000000-0000-4000-8000-000000000001", "workspace"), accountId: asId("10000000-0000-4000-8000-000000000002", "account"), caseId: asId("10000000-0000-4000-8000-000000000003", "case") };
    await expect(unavailableAttendanceReader.countActuallyAttended(scope, { workspaceId: scope.workspaceId, caseId: scope.caseId, periodStart: "2026-01-01", periodEnd: "2026-01-29" })).rejects.toMatchObject({ code: "UNAVAILABLE" });
    await expect(unavailableParentReportReader.getAuthorizedReport(scope, asId("10000000-0000-4000-8000-000000000004", "parent_report"))).rejects.toMatchObject({ code: "UNAVAILABLE" });
  });

  it("counts only LS-030 attended individual sessions in the exact Jerusalem period", async () => {
    const calls: Array<{ statement: string; values: readonly unknown[] }> = [];
    const reader = new DatabaseAttendanceReader({ async transaction(work) { return work({ async query(statement, values = []) { calls.push({ statement, values }); return [{ count: 3 }] as never; } }); } });
    const scope = { workspaceId: asId("10000000-0000-4000-8000-000000000001", "workspace"), accountId: asId("10000000-0000-4000-8000-000000000002", "account"), caseId: asId("10000000-0000-4000-8000-000000000003", "case") };
    await expect(reader.countActuallyAttended(scope, { workspaceId: scope.workspaceId, caseId: scope.caseId, periodStart: "2026-01-01", periodEnd: "2026-01-29" })).resolves.toBe(3);
    expect(calls[0]!.statement).toContain("a.kind='individual'");
    expect(calls[0]!.statement).toContain("r.state IN ('present','late')");
    expect(calls[0]!.statement).toContain("AT TIME ZONE 'Asia/Jerusalem'");
    expect(calls[0]!.statement).not.toContain("credit");
    expect(calls[0]!.values).toEqual([scope.workspaceId, scope.caseId, "2026-01-01", "2026-01-29"]);
  });

  it("defines the six exact resource types and exact 28-day review check", () => {
    expect(migration).toContain("CHECK(type IN ('audio','pdf','video','link','text','digital_form'))");
    expect(reviewTable).toContain("CHECK(period_end=period_start+28)");
  });

  it("stores protected form answers and review narratives as ciphertext", () => {
    expect(migration).toContain("answers_ciphertext text NOT NULL");
    expect(reviewTable).toContain("narrative_ciphertext text NOT NULL");
    expect(migration).toMatch(/ls_progress\.contextual_targets[\s\S]*?detail_ciphertext text NOT NULL/);
    expect(migration).not.toMatch(/\n\s*(?:behavior|setting) text NOT NULL/);
    expect(migration).toContain("FORM_SUBMISSION_IMMUTABLE");
    expect(migration).toContain("PUBLISHED_QUALITATIVE_REVIEW_IMMUTABLE");
  });

  it("has no numeric growth, rating, grade, rank or score columns", () => {
    const columns = reviewTable.split(/\r?\n/).map((line) => line.trim().split(/\s+/)[0]).filter(Boolean);
    expect(columns).not.toEqual(expect.arrayContaining(["score", "rating", "grade", "rank", "growth", "improvement"]));
    expect(reviewTable).toContain("attended_session_count integer");
  });

  it("preserves attribution without declaring reports witnessed or verified", () => {
    expect(migration).toContain("review_parent_reports");
    expect(migration).toContain("author_account_id uuid NOT NULL");
    expect(migration).toContain("source_type text NOT NULL CHECK(source_type='parent_report')");
    expect(migration).not.toContain("witnessed boolean");
    expect(migration).not.toContain("verified boolean");
  });

  it("does not create a calendar, appointment, attendance or credit table", () => {
    expect(migration).not.toMatch(/CREATE TABLE IF NOT EXISTS ls_(?:forms|resources|progress)\.(?:calendar|appointments|attendance|credits)\b/);
  });
});
