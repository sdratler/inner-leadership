import { describe, expect, it } from "vitest";
import { asId } from "../../src/lib/ids.ts";
import { AppError } from "../../src/lib/errors.ts";
import { seal } from "../../src/features/identity/crypto.ts";
import type { IdentityConfig } from "../../src/features/identity/config.ts";
import type { IdentityStore, SqlSession } from "../../src/features/identity/store.ts";
import type { Actor, IdentityClock } from "../../src/features/identity/types.ts";
import { GoalService } from "../../src/features/goals/service.ts";
import { HomePracticeService } from "../../src/features/home-practice/service.ts";
import { CheckInService } from "../../src/features/checkins/service.ts";

const uuid = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ids = {
  workspace: asId(uuid(1), "workspace"), practitioner: asId(uuid(2), "account"), parentA: asId(uuid(3), "account"),
  parentB: asId(uuid(4), "account"), outsider: asId(uuid(5), "account"), person: asId(uuid(6), "person"),
  case: asId(uuid(7), "case"), audience: asId(uuid(8), "audience"), goal: asId(uuid(9), "goal"),
  assignment: asId(uuid(10), "practice_assignment"), version: asId(uuid(11), "practice_version"),
  coordination: asId(uuid(12), "coordination_version"), occurrence: asId(uuid(13), "occurrence"),
};
const now = new Date("2026-09-11T14:00:00.000Z");
const clock: IdentityClock = { now: () => now };
const config: IdentityConfig = {
  enabled: true, origin: "https://app.example.test", workspaceId: ids.workspace,
  csrfKey: Buffer.alloc(32, 1), lookupKey: Buffer.alloc(32, 2), rateLimitKey: "3".repeat(64),
  keyring: { activeKeyId: "test", keys: { test: Buffer.alloc(32, 4) } }, sessionSeconds: 28_800,
};

function actor(role: Actor["role"], id = role === "practitioner" ? ids.practitioner : ids.parentA): Actor {
  return { id, workspaceId: ids.workspace, personId: ids.person, role, state: "active", locale: "en", sessionDigest: "a".repeat(64), expiresAt: now.getTime() + 60_000 };
}

type Query = { sql: string; values: readonly unknown[] };
function fixtureStore(current: Actor, overrides: Partial<{ existingIdempotency: object[]; occurrenceState: "open" | "closed"; reported: object[] }> = {}) {
  const queries: Query[] = [];
  const instructionsCiphertext = seal("Keep the morning instruction", `practice-version:${ids.workspace}:${ids.version}`, config.keyring);
  const tx: SqlSession = {
    async query<T extends object>(sql: string, values: readonly unknown[] = []): Promise<T[]> {
      queries.push({ sql, values });
      if (sql.includes("FROM ls_identity.workspaces")) return [{ id: ids.workspace }] as T[];
      if (sql.includes("FROM ls_identity.sessions s JOIN ls_identity.accounts a")) return [{ id: current.id }] as T[];
      if (sql.includes("FROM ls_identity.accounts a JOIN ls_identity.account_subjects")) return [{ ...current, emailBlind: "b".repeat(64), emailCiphertext: "sealed", emailVerifiedAt: now, passwordHash: "hash", phoneCiphertext: null, phoneVerifiedAt: null }] as T[];
      if (sql.includes("FROM ls_cases.cases c JOIN ls_cases.clients")) return [{ id: ids.case, workspaceId: ids.workspace, clientPersonId: ids.person, practitionerAccountId: ids.practitioner, kind: "minor", state: "active" }] as T[];
      if (sql.includes("FROM ls_cases.case_guardians")) return [
        { workspaceId: ids.workspace, caseId: ids.case, accountId: ids.parentA, revoked: false },
        { workspaceId: ids.workspace, caseId: ids.case, accountId: ids.parentB, revoked: false },
      ] as T[];
      if (sql.includes("FROM ls_cases.audiences")) return [{ id: ids.audience, workspaceId: ids.workspace, caseId: ids.case, visibility: "family_full", published: true }] as T[];
      if (sql.includes("FROM ls_cases.audience_accounts")) return [{ accountId: ids.parentA }, { accountId: ids.parentB }] as T[];
      if (sql.includes("COALESCE(MAX(c.version)")) return [{ caseId: ids.case, audienceId: ids.audience, nextVersion: 2 }] as T[];
      if (sql.includes("FROM ls_practice.practice_occurrences o JOIN")) return [{ occurrenceId: ids.occurrence, caseId: ids.case, audienceId: ids.audience, coordinationVersionId: ids.coordination, state: overrides.occurrenceState ?? "open", assigneeAccountIds: [ids.parentA, ids.parentB], completionMode: "any_assignee", effectiveFrom: now, changedByAccountId: ids.parentA }] as T[];
      if (sql.includes("author_account_id=$2 AND idempotency_key=$3")) return (overrides.existingIdempotency ?? []) as T[];
      if (sql.includes("SELECT DISTINCT ON (author_account_id)")) return (overrides.reported ?? [{ authorAccountId: current.id }]) as T[];
      if (sql.includes("FROM ls_practice.practice_assignments a JOIN ls_practice.practice_assignment_versions v")) return [{ workspaceId: ids.workspace, caseId: ids.case, assignmentId: ids.assignment, versionId: ids.version, version: 1, audienceId: ids.audience, goalId: null, commitmentId: null, templateKey: "W01", templateVersion: "Program2.1", instructionsCiphertext, startsOn: "2026-09-12", endsOn: null, publishedAt: null, immutableSnapshotDigest: null }] as T[];
      return [];
    },
  };
  const store: IdentityStore = { transaction: work => work(tx) };
  return { store, queries };
}

describe("LS-040 services", () => {
  it("creates an encrypted practitioner goal and records feature-owned history", async () => {
    const fixture = fixtureStore(actor("practitioner"));
    const result = await new GoalService(fixture.store, config, clock).create(actor("practitioner"), { caseId: ids.case, audienceId: ids.audience, title: "Calmer mornings" }, uuid(30));
    expect(result.title).toBe("Calmer mornings");
    const insert = fixture.queries.find(query => query.sql.includes("INSERT INTO ls_practice.goals"));
    expect(insert?.values).not.toContain("Calmer mornings");
    expect(fixture.queries.some(query => query.sql.includes("INSERT INTO ls_practice.action_history"))).toBe(true);
  });
  it("denies parent-authored clinical goals without revealing the case", async () => {
    const parent = actor("parent"); const fixture = fixtureStore(parent);
    await expect(new GoalService(fixture.store, config, clock).create(parent, { caseId: ids.case, audienceId: ids.audience, title: "Changed goal" }, uuid(31))).rejects.toEqual(new AppError("NOT_FOUND"));
    expect(fixture.queries.some(query => query.sql.includes("INSERT INTO ls_practice.goals"))).toBe(false);
  });
  it("creates a draft with encrypted customized instructions", async () => {
    const practitioner = actor("practitioner"); const fixture = fixtureStore(practitioner);
    const result = await new HomePracticeService(fixture.store, config, clock).createDraft(practitioner, { caseId: ids.case, audienceId: ids.audience, templateKey: "W01", templateVersion: "Program2.1", instructions: "Pause, breathe, then name one feeling.", startsOn: "2026-09-12" }, uuid(32));
    expect(result.assignmentId).toMatch(/^[0-9a-f-]{36}$/);
    const insert = fixture.queries.find(query => query.sql.includes("INSERT INTO ls_practice.practice_assignment_versions"));
    expect(insert?.values).not.toContain("Pause, breathe, then name one feeling.");
  });
  it("rejects a backwards assignment date range", async () => {
    const practitioner = actor("practitioner"); const fixture = fixtureStore(practitioner);
    await expect(new HomePracticeService(fixture.store, config, clock).createDraft(practitioner, { caseId: ids.case, audienceId: ids.audience, templateKey: "W01", templateVersion: "Program2.1", instructions: "Practice", startsOn: "2026-09-13", endsOn: "2026-09-12" }, uuid(33))).rejects.toEqual(new AppError("INVALID_REQUEST"));
    expect(fixture.queries).toHaveLength(0);
  });
  it("publishes the exact immutable ciphertext digest", async () => {
    const practitioner = actor("practitioner"); const fixture = fixtureStore(practitioner);
    const result = await new HomePracticeService(fixture.store, config, clock).publish(practitioner, ids.assignment, ids.version, uuid(34));
    expect(result.immutableSnapshotDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(fixture.queries.find(query => query.sql.startsWith("UPDATE ls_practice.practice_assignment_versions"))?.values.at(-1)).toBe(result.immutableSnapshotDigest);
  });
  it("lets an authorized parent set prospective any-assignee logistics", async () => {
    const parent = actor("parent"); const fixture = fixtureStore(parent);
    const result = await new HomePracticeService(fixture.store, config, clock).coordinate(parent, { assignmentId: ids.assignment, assigneeAccountIds: [ids.parentA, ids.parentB], completionMode: "any_assignee", reminderCandidateAccountIds: [ids.parentA], effectiveFrom: "2026-09-11T14:00:01.000Z" }, uuid(35));
    expect(result.assigneeAccountIds).toEqual([ids.parentA, ids.parentB]);
    expect(result.completionMode).toBe("any_assignee");
  });
  it("rejects retroactive coordination", async () => {
    const parent = actor("parent"); const fixture = fixtureStore(parent);
    await expect(new HomePracticeService(fixture.store, config, clock).coordinate(parent, { assignmentId: ids.assignment, assigneeAccountIds: [ids.parentA], completionMode: "any_assignee", reminderCandidateAccountIds: [], effectiveFrom: "2026-09-11T13:59:59.000Z" }, uuid(36))).rejects.toEqual(new AppError("INVALID_REQUEST"));
    expect(fixture.queries).toHaveLength(0);
  });
  it("rejects reminder candidates outside the assignee set", async () => {
    const parent = actor("parent"); const fixture = fixtureStore(parent);
    await expect(new HomePracticeService(fixture.store, config, clock).coordinate(parent, { assignmentId: ids.assignment, assigneeAccountIds: [ids.parentA], completionMode: "any_assignee", reminderCandidateAccountIds: [ids.parentB], effectiveFrom: "2026-09-11T14:00:01.000Z" }, uuid(37))).rejects.toEqual(new AppError("INVALID_REQUEST"));
  });
  it("atomically closes any-assignee occurrence after the first report", async () => {
    const parent = actor("parent"); const fixture = fixtureStore(parent);
    const result = await new CheckInService(fixture.store, clock).submit(parent, { occurrenceId: ids.occurrence, status: "partly_done", idempotencyKey: uuid(40) }, uuid(41));
    expect(result.status).toBe("partly_done");
    expect(fixture.queries.some(query => query.sql.includes("SET state='closed'"))).toBe(true);
  });
  it("returns the original report for the same idempotency key", async () => {
    const parent = actor("parent");
    const fixture = fixtureStore(parent, { existingIdempotency: [{ reportId: asId(uuid(42), "completion_report"), occurrenceId: ids.occurrence, authorAccountId: ids.parentA, status: "done", revision: 1, reportedAt: now, idempotencyKey: uuid(43), correctsReportId: null }] });
    const result = await new CheckInService(fixture.store, clock).submit(parent, { occurrenceId: ids.occurrence, status: "done", idempotencyKey: uuid(43) }, uuid(44));
    expect(result.reportedAt).toBe(now.toISOString());
    expect(fixture.queries.some(query => query.sql.includes("INSERT INTO ls_practice.completion_reports"))).toBe(false);
  });
});
