import { describe, expect, it, vi } from "vitest";
import { AppError } from "../../src/lib/errors.ts";
import { asId } from "../../src/lib/ids.ts";
import { seal } from "../../src/features/identity/crypto.ts";
import type { IdentityConfig } from "../../src/features/identity/config.ts";
import type { PracticeVersionReader, PracticeVersionReference } from "../../src/features/identity/interfaces.ts";
import type { IdentityStore, SqlSession } from "../../src/features/identity/store.ts";
import type { Actor, IdentityClock } from "../../src/features/identity/types.ts";
import { unavailablePracticeAdaptationPort } from "../../src/features/updates/adaptation.ts";
import { UpdateService } from "../../src/features/updates/service.ts";
import type { PracticeAdaptationPort } from "../../src/features/updates/types.ts";

const uuid = (n: number) => `80000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ids = {
  workspace: asId(uuid(1), "workspace"), practitioner: asId(uuid(2), "account"), parent: asId(uuid(3), "account"),
  outsider: asId(uuid(4), "account"), person: asId(uuid(5), "person"), case: asId(uuid(6), "case"),
  audience: asId(uuid(7), "audience"), assignment: asId(uuid(8), "practice_assignment"),
  version: asId(uuid(9), "practice_version"), newVersion: asId(uuid(10), "practice_version"),
  report: asId(uuid(11), "parent_report"), reply: asId(uuid(12), "update_reply"), receipt: asId(uuid(13), "adaptation_receipt"),
};
const now = new Date("2026-09-11T14:40:00.000Z");
const clock: IdentityClock = { now: () => now };
const config: IdentityConfig = {
  enabled: true, origin: "https://app.example.test", workspaceId: ids.workspace,
  csrfKey: Buffer.alloc(32, 1), lookupKey: Buffer.alloc(32, 2), rateLimitKey: "3".repeat(64),
  keyring: { activeKeyId: "test", keys: { test: Buffer.alloc(32, 4) } }, sessionSeconds: 28_800,
};

function actor(role: Actor["role"], id = role === "practitioner" ? ids.practitioner : ids.parent): Actor {
  return { id, workspaceId: ids.workspace, personId: ids.person, role, state: "active", locale: "en", sessionDigest: "a".repeat(64), expiresAt: now.getTime() + 60_000 };
}

const reference = {
  workspaceId: ids.workspace, caseId: ids.case, assignmentId: ids.assignment, versionId: ids.version,
  audienceId: ids.audience, visibility: "family_full" as const, publishedAt: "2026-09-10T10:00:00.000Z",
  immutableSnapshotDigest: "b".repeat(64),
};

type Query = { sql: string; values: readonly unknown[] };
function fixtureStore(current: Actor, options: { reviewState?: "new" | "reviewed" | "replied" | "adapted"; visibility?: "family_full" | "family_title_completion"; replies?: "draft" | "published"; existingReceipt?: boolean } = {}) {
  const queries: Query[] = [];
  let receiptInserted = false;
  const reportCiphertext = seal("Synthetic family context", `update-report:${ids.workspace}:${ids.report}`, config.keyring);
  const replyCiphertext = seal("Synthetic practitioner reply", `update-reply:${ids.workspace}:${ids.reply}`, config.keyring);
  const report = {
    id: ids.report, workspaceId: ids.workspace, caseId: ids.case, audienceId: ids.audience, authorAccountId: ids.parent,
    bodyCiphertext: reportCiphertext, bodyDigest: "c".repeat(64), eventAt: null, submittedAt: now,
    reviewState: options.reviewState ?? "reviewed", reviewedByAccountId: ids.practitioner, reviewedAt: now,
    practiceAssignmentId: ids.assignment, practiceVersionId: ids.version, practicePublishedAt: new Date(reference.publishedAt),
    practiceSnapshotDigest: reference.immutableSnapshotDigest,
  };
  const tx: SqlSession = {
    async query<T extends object>(sql: string, values: readonly unknown[] = []): Promise<T[]> {
      queries.push({ sql, values });
      if (sql.includes("INSERT INTO ls_updates.adaptation_receipts")) receiptInserted = true;
      if (sql.includes("FROM ls_identity.workspaces")) return [{ id: ids.workspace }] as T[];
      if (sql.includes("FROM ls_identity.sessions s JOIN ls_identity.accounts a")) return [{ id: current.id }] as T[];
      if (sql.includes("FROM ls_identity.accounts a JOIN ls_identity.account_subjects")) return [{ ...current, emailBlind: "d".repeat(64), emailCiphertext: "sealed", emailVerifiedAt: now, passwordHash: "hash", phoneCiphertext: null, phoneVerifiedAt: null }] as T[];
      if (sql.includes("FROM ls_cases.cases c JOIN ls_cases.clients")) return [{ id: ids.case, workspaceId: ids.workspace, clientPersonId: ids.person, practitionerAccountId: ids.practitioner, kind: "minor", state: "active" }] as T[];
      if (sql.includes("FROM ls_cases.case_guardians")) return [{ workspaceId: ids.workspace, caseId: ids.case, accountId: ids.parent, revoked: false }] as T[];
      if (sql.includes("FROM ls_cases.audiences")) return [{ id: ids.audience, workspaceId: ids.workspace, caseId: ids.case, visibility: options.visibility ?? "family_full", published: true }] as T[];
      if (sql.includes("FROM ls_cases.audience_accounts")) return [{ accountId: ids.parent }] as T[];
      if (sql.includes("FROM ls_updates.parent_reports") && sql.includes("author_account_id=$2 AND idempotency_key=$3")) return [];
      if (sql.includes("FROM ls_updates.parent_reports")) return [report] as T[];
      if (sql.includes("FROM ls_updates.practitioner_replies") && sql.includes("author_account_id=$2 AND idempotency_key=$3")) return [];
      if (sql.includes("FROM ls_updates.practitioner_replies")) return [{ id: ids.reply, reportId: ids.report, authorAccountId: ids.practitioner, bodyCiphertext: replyCiphertext, bodyDigest: "e".repeat(64), state: options.replies ?? "published", createdAt: now, publishedAt: options.replies === "draft" ? null : now, supersedesReplyId: null }] as T[];
      if (sql.includes("FROM ls_updates.adaptation_receipts") && (options.existingReceipt || receiptInserted)) return [{ id: ids.receipt, reportId: ids.report, assignmentId: ids.assignment, previousVersionId: ids.version, newVersionId: ids.newVersion, state: "draft", createdAt: now }] as T[];
      return [];
    },
  };
  const store: IdentityStore = { transaction: work => work(tx) };
  return { store, queries };
}

function reader(value: PracticeVersionReference | null = reference): PracticeVersionReader {
  return { getAuthorizedVersion: vi.fn(async () => value) };
}

describe("LS-080 service", () => {
  it("saves a parent report immediately, attributes the server actor, encrypts text and snapshots I-013", async () => {
    const parent = actor("parent"); const fixture = fixtureStore(parent);
    const result = await new UpdateService(fixture.store, config, clock, reader(), unavailablePracticeAdaptationPort).submitParentReport(parent, {
      caseId: ids.case, audienceId: ids.audience, practiceVersionId: ids.version,
      body: "Synthetic family context", idempotencyKey: uuid(20),
    }, uuid(21));
    expect(result.reviewState).toBe("new");
    expect(result.authorAccountId).toBe(ids.parent);
    expect(result.practice.immutableSnapshotDigest).toBe(reference.immutableSnapshotDigest);
    const insert = fixture.queries.find(query => query.sql.includes("INSERT INTO ls_updates.parent_reports"));
    expect(insert?.values).not.toContain("Synthetic family context");
    expect(insert?.values).toContain(ids.parent);
    expect(insert?.values).toContain(reference.immutableSnapshotDigest);
  });

  it("fails closed when I-013 returns no authorized published version", async () => {
    const parent = actor("parent"); const fixture = fixtureStore(parent);
    await expect(new UpdateService(fixture.store, config, clock, reader(null), unavailablePracticeAdaptationPort).submitParentReport(parent, {
      caseId: ids.case, audienceId: ids.audience, practiceVersionId: ids.version, body: "Synthetic", idempotencyKey: uuid(22),
    }, uuid(23))).rejects.toEqual(new AppError("NOT_FOUND"));
    expect(fixture.queries).toHaveLength(0);
  });

  it("rejects a title-only family audience for contextual text", async () => {
    const parent = actor("parent"); const fixture = fixtureStore(parent, { visibility: "family_title_completion" });
    await expect(new UpdateService(fixture.store, config, clock, reader({ ...reference, visibility: "family_title_completion" }), unavailablePracticeAdaptationPort).submitParentReport(parent, {
      caseId: ids.case, audienceId: ids.audience, practiceVersionId: ids.version, body: "Synthetic", idempotencyKey: uuid(24),
    }, uuid(25))).rejects.toEqual(new AppError("NOT_FOUND"));
  });

  it("marks a report reviewed without changing its author or encrypted body", async () => {
    const practitioner = actor("practitioner"); const fixture = fixtureStore(practitioner, { reviewState: "new" });
    const result = await new UpdateService(fixture.store, config, clock, reader(), unavailablePracticeAdaptationPort).review(practitioner, ids.report, uuid(26));
    expect(result.reviewState).toBe("reviewed");
    expect(result.authorAccountId).toBe(ids.parent);
    expect(result.body).toBe("Synthetic family context");
    const update = fixture.queries.find(query => query.sql.includes("SET review_state='reviewed'"));
    expect(update?.sql).not.toMatch(/body_|author_account_id/);
  });

  it("stores practitioner replies encrypted and keeps draft state explicit", async () => {
    const practitioner = actor("practitioner"); const fixture = fixtureStore(practitioner);
    const result = await new UpdateService(fixture.store, config, clock, reader(), unavailablePracticeAdaptationPort).replyToReport(practitioner, {
      reportId: ids.report, body: "A synthetic response", publish: false, idempotencyKey: uuid(27),
    }, uuid(28));
    expect(result.state).toBe("draft");
    const insert = fixture.queries.find(query => query.sql.includes("INSERT INTO ls_updates.practitioner_replies"));
    expect(insert?.values).not.toContain("A synthetic response");
    expect(insert?.values).toContain("draft");
    expect(fixture.queries.some(query => query.sql.includes("review_state='replied'"))).toBe(false);
  });

  it("filters parent list queries to published replies", async () => {
    const parent = actor("parent"); const fixture = fixtureStore(parent);
    const threads = await new UpdateService(fixture.store, config, clock, reader(), unavailablePracticeAdaptationPort).list(parent, ids.case, ids.audience);
    expect(threads[0]?.report.body).toBe("Synthetic family context");
    expect(fixture.queries.some(query => query.sql.includes("AND state='published'"))).toBe(true);
  });

  it("fails closed when the LS-040 adaptation port is not centrally wired", async () => {
    const practitioner = actor("practitioner"); const fixture = fixtureStore(practitioner);
    await expect(new UpdateService(fixture.store, config, clock, reader(), unavailablePracticeAdaptationPort).adapt(practitioner, {
      reportId: ids.report, adaptedInstructions: "Use the synthetic alternate step.", idempotencyKey: uuid(29),
    }, uuid(30))).rejects.toEqual(new AppError("UNAVAILABLE"));
  });

  it("passes the exact report and immutable version to the LS-040 adaptation port and stores a draft receipt", async () => {
    const practitioner = actor("practitioner"); const fixture = fixtureStore(practitioner);
    const createDraftFromReport = vi.fn(async () => ({ assignmentId: ids.assignment, previousVersionId: ids.version, newVersionId: ids.newVersion, state: "draft" as const }));
    const port: PracticeAdaptationPort = { createDraftFromReport };
    const result = await new UpdateService(fixture.store, config, clock, reader(), port).adapt(practitioner, {
      reportId: ids.report, adaptedInstructions: "Use the synthetic alternate step.", idempotencyKey: uuid(31),
    }, uuid(32));
    expect(result.newVersionId).toBe(ids.newVersion);
    expect(createDraftFromReport).toHaveBeenCalledWith(expect.objectContaining({ sourceReportId: ids.report, currentVersion: expect.objectContaining({ versionId: ids.version, immutableSnapshotDigest: reference.immutableSnapshotDigest }), practitionerAccountId: ids.practitioner }));
    expect(fixture.queries.some(query => query.sql.includes("INSERT INTO ls_updates.adaptation_receipts"))).toBe(true);
  });

  it("does not allow adaptation before practitioner review", async () => {
    const practitioner = actor("practitioner"); const fixture = fixtureStore(practitioner, { reviewState: "new" });
    const port: PracticeAdaptationPort = { createDraftFromReport: vi.fn() };
    await expect(new UpdateService(fixture.store, config, clock, reader(), port).adapt(practitioner, {
      reportId: ids.report, adaptedInstructions: "Synthetic", idempotencyKey: uuid(33),
    }, uuid(34))).rejects.toEqual(new AppError("CONFLICT"));
    expect(port.createDraftFromReport).not.toHaveBeenCalled();
  });
});
