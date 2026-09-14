import { describe, expect, it } from "vitest";
import { asId } from "../../src/lib/ids.ts";
import { ProgressService } from "../../src/features/progress/service.ts";
import type { SqlSession } from "../../src/features/identity/store.ts";

const workspaceId = asId("10000000-0000-4000-8000-000000000001", "workspace");
const practitionerId = asId("10000000-0000-4000-8000-000000000002", "account");
const practitionerPersonId = asId("10000000-0000-4000-8000-000000000003", "person");
const caseId = asId("10000000-0000-4000-8000-000000000004", "case");
const childPersonId = asId("10000000-0000-4000-8000-000000000005", "person");
const audienceId = asId("10000000-0000-4000-8000-000000000006", "audience");
const parentId = asId("10000000-0000-4000-8000-000000000007", "account");
const practiceVersionId = asId("10000000-0000-4000-8000-000000000008", "practice_version");
const assignmentId = asId("10000000-0000-4000-8000-000000000009", "practice_assignment");
const reportId = asId("10000000-0000-4000-8000-000000000010", "parent_report");
const actor = Object.freeze({
  id: practitionerId,
  workspaceId,
  personId: practitionerPersonId,
  role: "practitioner" as const,
  state: "active" as const,
  locale: "en" as const,
  sessionDigest: "f".repeat(64),
  expiresAt: Date.parse("2026-02-01T00:00:00.000Z"),
});
const narrative = {
  taughtAndPractised: ["Clear requests"],
  parentReportedExamples: ["Parent described one request at home."],
  practitionerObservations: ["The wording was rehearsed."],
  usefulChanges: ["One concrete request was reported."],
  continuingDifficulty: ["Hurried transitions remain difficult."],
  uncertainty: "Only one context was reported.",
  nextAdjustment: "Practise a shorter prompt.",
  informationLimits: "The report was not witnessed by the practitioner.",
};

function harness(reportAuthor = parentId) {
  const writes: Array<{ statement: string; values: readonly unknown[] }> = [];
  const tx: SqlSession = { async query<T extends object>(statement: string, values: readonly unknown[] = []): Promise<T[]> {
    if (statement.includes("FROM ls_identity.workspaces")) return [{ id: workspaceId }] as T[];
    if (statement.includes("FROM ls_identity.sessions s JOIN")) return [{ id: practitionerId }] as T[];
    if (statement.includes("FROM ls_identity.accounts a JOIN ls_identity.account_subjects s")) return [{
      id: practitionerId, workspaceId, personId: practitionerPersonId, role: "practitioner", state: "active", locale: "en",
      emailBlind: "f".repeat(64), emailCiphertext: "ciphertext", emailVerifiedAt: new Date(), passwordHash: "hash", phoneCiphertext: null, phoneVerifiedAt: null,
    }] as T[];
    if (statement.includes("FROM ls_cases.cases c JOIN")) return [{
      id: caseId, workspaceId, clientPersonId: childPersonId, practitionerAccountId: practitionerId, kind: "minor", state: "active",
    }] as T[];
    if (statement.includes("FROM ls_cases.case_guardians")) return [{ workspaceId, caseId, accountId: parentId, revoked: false }] as T[];
    if (statement.includes("FROM ls_cases.audiences")) return [{ id: audienceId, workspaceId, caseId, visibility: "family_full", published: true }] as T[];
    if (statement.includes("FROM ls_cases.audience_accounts")) return [{ accountId: parentId }] as T[];
    writes.push({ statement, values });
    return [];
  } };
  const service = new ProgressService(
    { async transaction(work) { return work(tx); } },
    {
      enabled: true, origin: "https://app.example.invalid", workspaceId,
      csrfKey: Buffer.alloc(32, 1), lookupKey: Buffer.alloc(32, 2), rateLimitKey: "r".repeat(64),
      keyring: { activeKeyId: "v1", keys: { v1: Buffer.alloc(32, 3) } }, sessionSeconds: 3600,
    },
    { now: () => new Date("2026-01-30T00:00:00.000Z") },
    { async countActuallyAttended() { return 2; } },
    { async getAuthorizedReport() { return { reportId, workspaceId, caseId, audienceId, authorAccountId: reportAuthor, submittedAt: "2026-01-15T10:00:00.000Z", sourceType: "parent_report" }; } },
    { async getAuthorizedVersion() { return { workspaceId, caseId, assignmentId, versionId: practiceVersionId, audienceId, visibility: "family_full", publishedAt: "2026-01-01T10:00:00.000Z", immutableSnapshotDigest: "a".repeat(64) }; } },
  );
  return { service, writes };
}

describe("qualitative review service", () => {
  it("uses trusted attendance and preserves verified source references", async () => {
    const { service, writes } = harness();
    const result = await service.createReview(actor, {
      caseId, audienceId, periodStart: "2026-01-01", periodEnd: "2026-01-29",
      assignmentVersionIds: [practiceVersionId], parentReportIds: [reportId], narrative,
    }, "10000000-0000-4000-8000-000000000011");
    expect(result.attendedSessionCount).toBe(2);
    const reviewInsert = writes.find((write) => write.statement.includes("INSERT INTO ls_progress.qualitative_reviews"));
    expect(reviewInsert?.values).toContain(2);
    expect(writes.some((write) => write.statement.includes("INSERT INTO ls_progress.review_practice_versions"))).toBe(true);
    expect(writes.some((write) => write.statement.includes("INSERT INTO ls_progress.review_parent_reports"))).toBe(true);
  });

  it("rejects a report author who is outside the exact audience", async () => {
    const outsider = asId("10000000-0000-4000-8000-000000000099", "account");
    const { service } = harness(outsider);
    await expect(service.createReview(actor, {
      caseId, audienceId, periodStart: "2026-01-01", periodEnd: "2026-01-29",
      assignmentVersionIds: [practiceVersionId], parentReportIds: [reportId], narrative,
    }, "10000000-0000-4000-8000-000000000011")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
