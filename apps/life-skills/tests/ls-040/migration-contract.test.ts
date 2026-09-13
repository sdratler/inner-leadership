import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(new URL("../../migrations/0040_ls_home_practice_20260911.sql", import.meta.url), "utf8");

describe("LS-040 migration contract", () => {
  it.each([
    "ls_practice.goals", "ls_practice.commitments", "ls_practice.practice_assignments",
    "ls_practice.practice_assignment_versions", "ls_practice.task_coordination_versions",
    "ls_practice.practice_occurrences", "ls_practice.completion_reports", "ls_practice.action_history",
  ])("creates %s", table => expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${table}`));
  it("uses the only admitted 0040 migration name", () => expect(new URL("../../migrations/0040_ls_home_practice_20260911.sql", import.meta.url).pathname).toContain("0040_ls_home_practice_20260911.sql"));
  it("never stores clinical instructions in plaintext", () => {
    expect(sql).toContain("instructions_ciphertext text NOT NULL");
    expect(sql).not.toMatch(/instructions\s+text/i);
  });
  it("protects published versions as immutable history", () => {
    expect(sql).toContain("protect_published_practice_version");
    expect(sql).toContain("WHEN (OLD.state='published')");
  });
  it("protects coordination and completion history from update/delete", () => {
    expect(sql).toContain("protect_coordination_version");
    expect(sql).toContain("protect_completion_report");
  });
  it("models morning and evening independently", () => {
    expect(sql).toContain("period text NOT NULL CHECK(period IN ('morning','evening'))");
    expect(sql).toContain("UNIQUE(workspace_id,assignment_id,occurs_on,period)");
  });
  it("models unreported as absence instead of a false status", () => {
    expect(sql).not.toMatch(/status[^\n]*unreported/i);
    expect(sql).toContain("Absence of a row is unreported");
  });
  it("enforces idempotency independently for each reporting parent", () => expect(sql).toContain("UNIQUE(workspace_id,author_account_id,idempotency_key)"));
  it("keeps reminder routing separate from completion mode", () => {
    expect(sql).toContain("reminder_candidate_account_ids uuid[]");
    expect(sql).toContain("Delivery must still recheck each account preference and I-014 authorization");
  });
  it("contains no scoring or gamification storage", () => expect(sql).not.toMatch(/\b(points|score|streak|badge|ranking|penalt)/i));
  it("contains no fixture data or live provider actions", () => expect(sql).not.toMatch(/INSERT\s+INTO\s+ls_(identity|cases|practice)\.(accounts|people|goals|commitments|practice_assignments)/i));
  it("pins the audience on every published hierarchy level", () => {
    expect(sql.match(/audience_id uuid NOT NULL/g)?.length).toBeGreaterThanOrEqual(4);
    expect(sql).toContain("REFERENCES ls_cases.audiences(workspace_id,case_id,id)");
  });
  it("constrains coordination to one or two unique parent assignees", () => {
    expect(sql).toContain("cardinality(assignee_account_ids) BETWEEN 1 AND 2");
    expect(sql).toContain("uuid_array_is_unique(assignee_account_ids)");
    expect(sql).toContain("LS_PRACTICE_PARENT_REQUIRED");
  });
  it("requires each_assignee to name both parents", () => expect(sql).toContain("completion_mode<>'each_assignee' OR cardinality(assignee_account_ids)=2"));
  it("does not grant database roles or activate providers", () => expect(sql).not.toMatch(/\b(GRANT|CREATE\s+ROLE|ALTER\s+ROLE|provider_id)\b/i));
});

