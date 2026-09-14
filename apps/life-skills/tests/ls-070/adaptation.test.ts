import { describe, expect, it } from "vitest";
import { asId } from "../../src/lib/ids.ts";
import { AppError } from "../../src/lib/errors.ts";
import type { IdentityConfig } from "../../src/features/identity/config.ts";
import type { IdentityStore, SqlSession } from "../../src/features/identity/store.ts";
import type { IdentityClock } from "../../src/features/identity/types.ts";
import type { PracticeVersionReference } from "../../src/features/identity/interfaces.ts";
import { HomePracticeService } from "../../src/features/home-practice/service.ts";

const uuid = (n: number) => `70000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ids = {
  workspace: asId(uuid(1), "workspace"), practitioner: asId(uuid(2), "account"), case: asId(uuid(3), "case"),
  audience: asId(uuid(4), "audience"), assignment: asId(uuid(5), "practice_assignment"),
  version: asId(uuid(6), "practice_version"), report: asId(uuid(7), "parent_report"), request: uuid(8),
};
const now = new Date("2026-09-11T18:00:00.000Z"), publishedAt = new Date("2026-09-01T09:00:00.000Z");
const digest = "a".repeat(64);
const clock: IdentityClock = { now: () => now };
const config: IdentityConfig = {
  enabled: true, origin: "https://app.example.test", workspaceId: ids.workspace,
  csrfKey: Buffer.alloc(32, 1), lookupKey: Buffer.alloc(32, 2), rateLimitKey: "3".repeat(64),
  keyring: { activeKeyId: "test", keys: { test: Buffer.alloc(32, 4) } }, sessionSeconds: 28_800,
};
const currentVersion: PracticeVersionReference = {
  workspaceId: ids.workspace, caseId: ids.case, audienceId: ids.audience, assignmentId: ids.assignment,
  versionId: ids.version, visibility: "family_full", publishedAt: publishedAt.toISOString(), immutableSnapshotDigest: digest,
};

function fixture(options: { revoked?: boolean; conflictingDraft?: boolean } = {}) {
  const queries: { sql: string; values: readonly unknown[] }[] = [];
  let receipt: { assignmentId: string; previousVersionId: string; newVersionId: string; state: "draft"; requestDigest: string } | undefined;
  let createdDraft: string | undefined;
  const tx: SqlSession = { async query<T extends object>(sql: string, values: readonly unknown[] = []): Promise<T[]> {
    queries.push({ sql, values });
    if (sql.includes("FROM ls_identity.workspaces")) return [{ id: ids.workspace }] as T[];
    if (sql.includes("SELECT c.id FROM ls_cases.cases c")) return (options.revoked ? [] : [{ id: ids.case }]) as T[];
    if (sql.includes("FROM ls_updates.parent_reports r JOIN")) return [{ assignmentId: ids.assignment, versionId: ids.version, audienceId: ids.audience, publishedAt, snapshotDigest: digest }] as T[];
    if (sql.includes("FROM ls_integration.practice_adaptation_receipts")) return (receipt ? [receipt] : []) as T[];
    if (sql.includes("state='draft' AND supersedes_version_id")) return (createdDraft ? [{ id: createdDraft }] : []) as T[];
    if (sql.includes("FROM ls_practice.practice_assignments a JOIN ls_practice.practice_assignment_versions v")) return [{
      workspaceId: ids.workspace, caseId: ids.case, assignmentId: ids.assignment, versionId: ids.version,
      version: 1, audienceId: ids.audience, goalId: null, commitmentId: null, templateKey: "W01",
      templateVersion: "Program2.1", instructionsCiphertext: "sealed", startsOn: "2026-09-01", endsOn: "2026-09-28",
      publishedAt, immutableSnapshotDigest: digest,
    }] as T[];
    if (sql.includes("state='draft'") && sql.includes("assignment_id=$2")) return (options.conflictingDraft ? [{ id: uuid(90) }] : []) as T[];
    if (sql.includes("COALESCE(MAX(version),0)+1")) return [{ version: 2 }] as T[];
    if (sql.includes("INSERT INTO ls_practice.practice_assignment_versions")) { createdDraft = String(values[0]); return [] as T[]; }
    if (sql.includes("INSERT INTO ls_integration.practice_adaptation_receipts")) {
      receipt = { assignmentId: String(values[5]), previousVersionId: String(values[6]), newVersionId: String(values[7]), state: "draft", requestDigest: String(values[3]) };
      return [] as T[];
    }
    return [] as T[];
  } };
  const store: IdentityStore = { transaction: work => work(tx) };
  return { service: new HomePracticeService(store, config, clock), queries };
}

const request = (instructions = "Keep the same dates and add one pause before naming the feeling.") => ({
  scope: { workspaceId: ids.workspace, accountId: ids.practitioner, caseId: ids.case }, sourceReportId: ids.report,
  currentVersion, adaptedInstructions: instructions, practitionerAccountId: ids.practitioner, idempotencyKey: ids.request,
});

describe("LS-070 durable practice adaptation", () => {
  it("creates one encrypted draft, preserves dates and never publishes", async () => {
    const f = fixture(), result = await f.service.createDraftFromReport(request());
    expect(result).toMatchObject({ assignmentId: ids.assignment, previousVersionId: ids.version, state: "draft" });
    const insert = f.queries.find(query => query.sql.includes("INSERT INTO ls_practice.practice_assignment_versions"));
    expect(insert?.values[7]).toBe("2026-09-01"); expect(insert?.values[8]).toBe("2026-09-28");
    expect(insert?.values).not.toContain(request().adaptedInstructions);
    expect(f.queries.some(query => /UPDATE\s+ls_practice\.practice_assignments/i.test(query.sql))).toBe(false);
  });

  it("returns the same draft for an exact retry and rejects a divergent retry", async () => {
    const f = fixture(), first = await f.service.createDraftFromReport(request()), second = await f.service.createDraftFromReport(request());
    expect(second).toEqual(first);
    expect(f.queries.filter(query => query.sql.includes("INSERT INTO ls_practice.practice_assignment_versions"))).toHaveLength(1);
    await expect(f.service.createDraftFromReport(request("Different instruction bytes"))).rejects.toEqual(new AppError("CONFLICT"));
  });

  it("fails closed for a revoked practitioner or a pre-existing draft", async () => {
    const revoked = fixture({ revoked: true });
    await expect(revoked.service.createDraftFromReport(request())).rejects.toEqual(new AppError("NOT_FOUND"));
    expect(revoked.queries.some(query => query.sql.includes("INSERT INTO ls_practice.practice_assignment_versions"))).toBe(false);
    const conflict = fixture({ conflictingDraft: true });
    await expect(conflict.service.createDraftFromReport(request())).rejects.toEqual(new AppError("CONFLICT"));
  });
});
