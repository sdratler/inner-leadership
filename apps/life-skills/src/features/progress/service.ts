import { createHmac, randomUUID } from "node:crypto";
import { AppError } from "../../lib/errors.ts";
import { asId, type Id } from "../../lib/ids.ts";
import type { CaseScope } from "../../lib/workspace.ts";
import { loadAudience, loadCase, loadGuardians } from "../cases/data.ts";
import { audienceAccess, caseAccess, requirePractitioner } from "../cases/policy.ts";
import { seal, unseal } from "../identity/crypto.ts";
import { freshActor, lockWorkspace } from "../identity/data.ts";
import type { IdentityConfig } from "../identity/config.ts";
import type { PracticeVersionId, PracticeVersionReader } from "../identity/interfaces.ts";
import type { IdentityStore, SqlSession } from "../identity/store.ts";
import { one } from "../identity/store.ts";
import type { Actor, AudienceId, CaseId, IdentityClock } from "../identity/types.ts";
import { assertFourWeekPeriod, assertSourceHonesty, qualitativeRevisionInputSchema, type QualitativeNarrative } from "./schema.ts";
import type { AttendanceReader, ParentReportId, ParentReportReader, ParentReportReference } from "./sources.ts";
import { recordLs050Action } from "./history.ts";

export type ContextualTargetId = Id<"contextual_target">;
export type QualitativeReviewId = Id<"qualitative_review">;

export interface QualitativeReviewProjection {
  id: QualitativeReviewId;
  caseId: CaseId;
  audienceId: AudienceId;
  periodStart: string;
  periodEnd: string;
  attendedSessionCount: number;
  state: "draft" | "published";
  narrative: QualitativeNarrative;
  parentReports: readonly { reportId: ParentReportId; authorAccountId: Actor["id"]; submittedAt: string; sourceType: "parent_report" }[];
  assignmentVersionIds: readonly PracticeVersionId[];
  publishedAt: string | null;
  revision: number;
}

interface ReviewRow {
  id: QualitativeReviewId;
  caseId: CaseId;
  audienceId: AudienceId;
  periodStart: string;
  periodEnd: string;
  attendedSessionCount: number;
  narrativeCiphertext: string;
  state: "draft" | "published";
  publishedAt: Date | null;
  revision: number;
}

interface RevisionRow {
  revision: number; narrativeCiphertext: string; authorAccountId: Actor["id"];
  savedAt: Date; operationId: string | null; requestDigest: string | null;
}

const unavailablePracticeVersionReader: PracticeVersionReader = Object.freeze({
  async getAuthorizedVersion() { throw new AppError("UNAVAILABLE"); },
});

function validCount(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 100) throw new AppError("UNAVAILABLE");
  return value;
}

export class ProgressService {
  constructor(
    private readonly store: IdentityStore,
    private readonly config: IdentityConfig,
    private readonly clock: IdentityClock,
    private readonly attendance: AttendanceReader,
    private readonly parentReports: ParentReportReader,
    private readonly practiceVersions: PracticeVersionReader = unavailablePracticeVersionReader,
  ) {}

  private async practitionerScope(actor: Actor, caseId: CaseId, audienceId: AudienceId): Promise<CaseScope> {
    return this.store.transaction(async (tx) => {
      const current = await freshActor(tx, actor, this.clock.now());
      requirePractitioner(current);
      const item = await loadCase(tx, actor.workspaceId, caseId);
      const guardians = await loadGuardians(tx, actor.workspaceId, caseId);
      const scope = caseAccess(current, item, guardians, "publish");
      const audience = await loadAudience(tx, actor.workspaceId, caseId, audienceId);
      if (!audience || !audience.published || audience.visibility !== "family_full") throw new AppError("NOT_FOUND");
      audienceAccess(current, item, guardians, audience);
      return scope;
    });
  }

  async createTarget(actor: Actor, input: { caseId: CaseId; audienceId: AudienceId; behavior: string; setting: string; initialDescription: string; relevantExamples: readonly string[]; activeFrom: string; activeUntil: string | null; published: boolean }, requestId: string) {
    const now = this.clock.now();
    return this.store.transaction(async (tx) => {
      await lockWorkspace(tx, actor.workspaceId);
      const current = await freshActor(tx, actor, now);
      requirePractitioner(current);
      const item = await loadCase(tx, actor.workspaceId, input.caseId);
      const guardians = await loadGuardians(tx, actor.workspaceId, input.caseId);
      caseAccess(current, item, guardians, "write");
      const audience = await loadAudience(tx, actor.workspaceId, input.caseId, input.audienceId);
      if (!audience || audience.visibility !== "family_full" || (input.published && !audience.published)) throw new AppError("NOT_FOUND");
      audienceAccess(current, item, guardians, audience);
      const id = asId(randomUUID(), "contextual_target");
      const detail = seal(JSON.stringify({ behavior: input.behavior, setting: input.setting, initialDescription: input.initialDescription, relevantExamples: input.relevantExamples }),
        `contextual-target:${actor.workspaceId}:${id}`, this.config.keyring);
      await tx.query(`INSERT INTO ls_progress.contextual_targets
        (id,workspace_id,case_id,audience_id,detail_ciphertext,active_from,active_until,published,created_by_account_id,created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [id, actor.workspaceId, input.caseId, input.audienceId, detail, input.activeFrom, input.activeUntil, input.published, actor.id, now]);
      await recordLs050Action(tx, { requestId, now }, actor.workspaceId, actor.id, "contextual_target_created");
      return { targetId: id };
    });
  }

  async listTargets(actor: Actor, caseId: CaseId) {
    return this.store.transaction(async (tx) => {
      const current = await freshActor(tx, actor, this.clock.now());
      const item = await loadCase(tx, actor.workspaceId, caseId);
      const guardians = await loadGuardians(tx, actor.workspaceId, caseId);
      caseAccess(current, item, guardians, "read");
      const rows = await tx.query<{ id: ContextualTargetId; audienceId: AudienceId; detailCiphertext: string; activeFrom: string; activeUntil: string | null; published: boolean }>(
        `SELECT id,audience_id AS "audienceId",detail_ciphertext AS "detailCiphertext",active_from::text AS "activeFrom",
        active_until::text AS "activeUntil",published FROM ls_progress.contextual_targets WHERE workspace_id=$1 AND case_id=$2
        AND retired_at IS NULL ORDER BY active_from DESC,id LIMIT 100`, [actor.workspaceId, caseId]);
      const result = [];
      for (const row of rows) {
        const audience = await loadAudience(tx, actor.workspaceId, caseId, row.audienceId);
        if (!audience || (current.role !== "practitioner" && !row.published)) continue;
        try { audienceAccess(current, item, guardians, audience); } catch (error) {
          if (error instanceof AppError && error.code === "NOT_FOUND") continue;
          throw error;
        }
        const detail = JSON.parse(unseal(row.detailCiphertext, `contextual-target:${actor.workspaceId}:${row.id}`, this.config.keyring)) as { behavior: string; setting: string; initialDescription: string; relevantExamples: string[] };
        result.push({ id: row.id, ...detail, activeFrom: row.activeFrom, activeUntil: row.activeUntil, published: row.published });
      }
      return result;
    });
  }

  async createReview(actor: Actor, input: { caseId: CaseId; audienceId: AudienceId; periodStart: string; periodEnd: string; assignmentVersionIds: readonly PracticeVersionId[]; parentReportIds: readonly ParentReportId[]; narrative: QualitativeNarrative }, requestId: string) {
    try { assertFourWeekPeriod(input.periodStart, input.periodEnd); assertSourceHonesty(input.parentReportIds.length, input.narrative); }
    catch { throw new AppError("INVALID_REQUEST"); }
    if (new Set(input.assignmentVersionIds).size !== input.assignmentVersionIds.length || new Set(input.parentReportIds).size !== input.parentReportIds.length) throw new AppError("INVALID_REQUEST");
    const scope = await this.practitionerScope(actor, input.caseId, input.audienceId);
    const attendedSessionCount = validCount(await this.attendance.countActuallyAttended(scope, {
      workspaceId: actor.workspaceId, caseId: input.caseId, periodStart: input.periodStart, periodEnd: input.periodEnd,
    }));
    const practiceReferences: Awaited<ReturnType<PracticeVersionReader["getAuthorizedVersion"]>>[] = [];
    for (const versionId of input.assignmentVersionIds) {
      const reference = await this.practiceVersions.getAuthorizedVersion(scope, versionId);
      if (!reference || reference.workspaceId !== actor.workspaceId || reference.caseId !== input.caseId || reference.audienceId !== input.audienceId) throw new AppError("NOT_FOUND");
      practiceReferences.push(reference);
    }
    const reportReferences: ParentReportReference[] = [];
    for (const reportId of input.parentReportIds) {
      const reference = await this.parentReports.getAuthorizedReport(scope, reportId);
      if (!reference || reference.workspaceId !== actor.workspaceId || reference.caseId !== input.caseId || reference.audienceId !== input.audienceId || reference.sourceType !== "parent_report") throw new AppError("NOT_FOUND");
      reportReferences.push(reference);
    }
    const now = this.clock.now();
    return this.store.transaction(async (tx) => {
      await lockWorkspace(tx, actor.workspaceId);
      const current = await freshActor(tx, actor, now);
      requirePractitioner(current);
      const item = await loadCase(tx, actor.workspaceId, input.caseId);
      const guardians = await loadGuardians(tx, actor.workspaceId, input.caseId);
      caseAccess(current, item, guardians, "publish");
      const audience = await loadAudience(tx, actor.workspaceId, input.caseId, input.audienceId);
      if (!audience || !audience.published || audience.visibility !== "family_full") throw new AppError("NOT_FOUND");
      audienceAccess(current, item, guardians, audience);
      if (reportReferences.some((reference) => !audience.accountIds.includes(reference.authorAccountId))) throw new AppError("NOT_FOUND");
      const id = asId(randomUUID(), "qualitative_review");
      const narrative = seal(JSON.stringify(input.narrative), `qualitative-review:${actor.workspaceId}:${id}`, this.config.keyring);
      const inserted = await tx.query<{id:QualitativeReviewId}>(`INSERT INTO ls_progress.qualitative_reviews
        (id,workspace_id,case_id,audience_id,period_start,period_end,attended_session_count,narrative_ciphertext,state,created_by_account_id,created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'draft',$9,$10)
        ON CONFLICT (workspace_id,case_id,period_start) DO NOTHING RETURNING id`,
      [id, actor.workspaceId, input.caseId, input.audienceId, input.periodStart, input.periodEnd, attendedSessionCount, narrative, actor.id, now]);
      // The existing case/period constraint remains the authority. A duplicate
      // never overwrites a draft/published narrative or appends source/history.
      if(inserted.length===0)throw new AppError('CONFLICT');
      if(inserted.length!==1||inserted[0]?.id!==id)throw new AppError('INTERNAL');
      for (const reference of practiceReferences) {
        if (!reference) throw new AppError("INTERNAL");
        await tx.query(`INSERT INTO ls_progress.review_practice_versions
        (workspace_id,review_id,version_id,immutable_snapshot_digest) VALUES ($1,$2,$3,$4)`,
        [actor.workspaceId, id, reference.versionId, reference.immutableSnapshotDigest]);
      }
      for (const reference of reportReferences) await tx.query(`INSERT INTO ls_progress.review_parent_reports
        (workspace_id,review_id,report_id,author_account_id,submitted_at,source_type) VALUES ($1,$2,$3,$4,$5,'parent_report')`,
      [actor.workspaceId, id, reference.reportId, reference.authorAccountId, reference.submittedAt]);
      await recordLs050Action(tx, { requestId, now }, actor.workspaceId, actor.id, "qualitative_review_drafted");
      return { reviewId: id, attendedSessionCount, revision: 1 };
    });
  }

  /** Private history and mutations always recheck the real case owner and the
   * exact published audience. A family grant never conveys revision access. */
  private async authorizedReview(tx: SqlSession, actor: Actor, reviewId: QualitativeReviewId) {
    const current = await freshActor(tx, actor, this.clock.now());
    requirePractitioner(current);
    const row = await one<ReviewRow>(tx, `SELECT id,case_id AS "caseId",audience_id AS "audienceId",period_start::text AS "periodStart",
      period_end::text AS "periodEnd",attended_session_count AS "attendedSessionCount",narrative_ciphertext AS "narrativeCiphertext",
      state,published_at AS "publishedAt",revision FROM ls_progress.qualitative_reviews WHERE workspace_id=$1 AND id=$2`, [actor.workspaceId, reviewId]);
    if (!row) throw new AppError("NOT_FOUND");
    const item = await loadCase(tx, actor.workspaceId, row.caseId);
    const guardians = await loadGuardians(tx, actor.workspaceId, row.caseId);
    const scope = caseAccess(current, item, guardians, "publish");
    const audience = await loadAudience(tx, actor.workspaceId, row.caseId, row.audienceId);
    if (!audience || !audience.published || audience.visibility !== "family_full") throw new AppError("NOT_FOUND");
    audienceAccess(current, item, guardians, audience);
    return { row, scope, audience };
  }

  async reviseReview(actor: Actor, raw: { reviewId: QualitativeReviewId; expectedRevision: number; operationId: string; narrative: QualitativeNarrative }, requestId: string) {
    const parsed = qualitativeRevisionInputSchema.safeParse(raw);
    if (!parsed.success) throw new AppError("INVALID_REQUEST");
    const input = parsed.data;
    // A keyed digest prevents a database reader from dictionary-testing private
    // narrative text; schema parsing gives a stable field order for retry.
    const digest = createHmac("sha256", this.config.lookupKey).update(JSON.stringify({
      purpose: "qualitative-review-revision", workspaceId: actor.workspaceId, actorId: actor.id, ...input,
    })).digest("hex");
    return this.store.transaction(async tx => {
      await lockWorkspace(tx, actor.workspaceId);
      const { row, scope, audience } = await this.authorizedReview(tx, actor, input.reviewId);
      const sources = await tx.query<{ reportId: ParentReportId; authorAccountId: Actor["id"]; submittedAt: Date }>(
        `SELECT report_id AS "reportId",author_account_id AS "authorAccountId",submitted_at AS "submittedAt"
         FROM ls_progress.review_parent_reports WHERE workspace_id=$1 AND review_id=$2 ORDER BY report_id`, [actor.workspaceId, row.id]);
      try { assertSourceHonesty(sources.length, input.narrative); } catch { throw new AppError("INVALID_REQUEST"); }
      for (const source of sources) {
        const reference = await this.parentReports.getAuthorizedReport(scope, source.reportId);
        if (!reference || reference.workspaceId !== actor.workspaceId || reference.caseId !== row.caseId || reference.audienceId !== row.audienceId ||
          reference.sourceType !== "parent_report" || reference.authorAccountId !== source.authorAccountId ||
          new Date(reference.submittedAt).toISOString() !== new Date(source.submittedAt).toISOString() || !audience.accountIds.includes(source.authorAccountId)) throw new AppError("NOT_FOUND");
      }
      const versions = await tx.query<{ versionId: PracticeVersionId; digest: string }>(
        `SELECT version_id AS "versionId",immutable_snapshot_digest AS digest FROM ls_progress.review_practice_versions
         WHERE workspace_id=$1 AND review_id=$2 ORDER BY version_id`, [actor.workspaceId, row.id]);
      for (const source of versions) {
        const reference = await this.practiceVersions.getAuthorizedVersion(scope, source.versionId);
        if (!reference || reference.workspaceId !== actor.workspaceId || reference.caseId !== row.caseId || reference.audienceId !== row.audienceId ||
          reference.immutableSnapshotDigest !== source.digest) throw new AppError("NOT_FOUND");
      }
      const existing = await one<RevisionRow>(tx, `SELECT revision,narrative_ciphertext AS "narrativeCiphertext",author_account_id AS "authorAccountId",
        saved_at AS "savedAt",operation_id AS "operationId",request_digest AS "requestDigest"
        FROM ls_progress.qualitative_review_revisions WHERE workspace_id=$1 AND review_id=$2 AND operation_id=$3`, [actor.workspaceId, row.id, input.operationId]);
      if (existing) {
        if (existing.requestDigest !== digest || existing.authorAccountId !== actor.id) throw new AppError("CONFLICT");
        return { reviewId: row.id, revision: existing.revision, operationId: input.operationId, savedAt: new Date(existing.savedAt).toISOString(), replayed: true };
      }
      if (row.state !== "draft" || row.revision !== input.expectedRevision) throw new AppError("CONFLICT");
      const revision = row.revision + 1, now = this.clock.now();
      const ciphertext = seal(JSON.stringify(input.narrative), `qualitative-review:${actor.workspaceId}:${row.id}`, this.config.keyring);
      await tx.query(`INSERT INTO ls_progress.qualitative_review_revisions
        (workspace_id,review_id,revision,narrative_ciphertext,author_account_id,saved_at,operation_id,request_digest)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [actor.workspaceId, row.id, revision, ciphertext, actor.id, now, input.operationId, digest]);
      const changed = await tx.query<{ id: QualitativeReviewId }>(`UPDATE ls_progress.qualitative_reviews SET narrative_ciphertext=$3,revision=$4
        WHERE workspace_id=$1 AND id=$2 AND state='draft' AND revision=$5 RETURNING id`, [actor.workspaceId, row.id, ciphertext, revision, input.expectedRevision]);
      if (changed.length !== 1) throw new AppError("CONFLICT");
      await recordLs050Action(tx, { requestId, now }, actor.workspaceId, actor.id, "qualitative_review_revised");
      return { reviewId: row.id, revision, operationId: input.operationId, savedAt: now.toISOString(), replayed: false };
    });
  }

  async listReviewRevisions(actor: Actor, input: { reviewId: QualitativeReviewId; before?: number | undefined; operationId?: string | undefined }) {
    return this.store.transaction(async tx => {
      const { row } = await this.authorizedReview(tx, actor, input.reviewId);
      const rows = await tx.query<RevisionRow>(`SELECT revision,narrative_ciphertext AS "narrativeCiphertext",author_account_id AS "authorAccountId",
        saved_at AS "savedAt",operation_id AS "operationId",request_digest AS "requestDigest"
        FROM ls_progress.qualitative_review_revisions WHERE workspace_id=$1 AND review_id=$2
        AND ($3::integer IS NULL OR revision<$3) AND ($4::uuid IS NULL OR operation_id=$4)
        ORDER BY revision DESC LIMIT 101`, [actor.workspaceId, row.id, input.before ?? null, input.operationId ?? null]);
      const page = rows.slice(0, 100), hasMore = rows.length > 100;
      return { reviewId: row.id, currentRevision: row.revision, state: row.state, hasMore,
        nextBefore: hasMore ? page.at(-1)!.revision : null,
        revisions: page.map(r => ({ revision: r.revision, operationId: r.operationId, authorAccountId: r.authorAccountId,
          savedAt: new Date(r.savedAt).toISOString(), narrative: JSON.parse(unseal(r.narrativeCiphertext,
            `qualitative-review:${actor.workspaceId}:${row.id}`, this.config.keyring)) as QualitativeNarrative })) };
    });
  }

  async publishReview(actor: Actor, reviewId: QualitativeReviewId, requestId: string, expectedRevision?: number) {
    const candidate = await this.store.transaction(async (tx) => {
      const current = await freshActor(tx, actor, this.clock.now());
      requirePractitioner(current);
      const row = await one<ReviewRow>(tx, `SELECT id,case_id AS "caseId",audience_id AS "audienceId",period_start::text AS "periodStart",
        period_end::text AS "periodEnd",attended_session_count AS "attendedSessionCount",narrative_ciphertext AS "narrativeCiphertext",state,published_at AS "publishedAt",revision
        FROM ls_progress.qualitative_reviews WHERE workspace_id=$1 AND id=$2`, [actor.workspaceId, reviewId]);
      if (!row || row.state !== "draft") throw new AppError("NOT_FOUND");
      if (row.revision !== (expectedRevision ?? 1)) throw new AppError("CONFLICT");
      const item = await loadCase(tx, actor.workspaceId, row.caseId);
      const guardians = await loadGuardians(tx, actor.workspaceId, row.caseId);
      const scope = caseAccess(current, item, guardians, "publish");
      const audience = await loadAudience(tx, actor.workspaceId, row.caseId, row.audienceId);
      if (!audience || !audience.published || audience.visibility !== "family_full") throw new AppError("NOT_FOUND");
      audienceAccess(current, item, guardians, audience);
      return { row, scope };
    });
    const attendedSessionCount = validCount(await this.attendance.countActuallyAttended(candidate.scope, {
      workspaceId: actor.workspaceId, caseId: candidate.row.caseId, periodStart: candidate.row.periodStart, periodEnd: candidate.row.periodEnd,
    }));
    const now = this.clock.now();
    await this.store.transaction(async (tx) => {
      await lockWorkspace(tx, actor.workspaceId);
      const current = await freshActor(tx, actor, now);
      requirePractitioner(current);
      const item = await loadCase(tx, actor.workspaceId, candidate.row.caseId);
      const guardians = await loadGuardians(tx, actor.workspaceId, candidate.row.caseId);
      caseAccess(current, item, guardians, "publish");
      const audience = await loadAudience(tx, actor.workspaceId, candidate.row.caseId, candidate.row.audienceId);
      if (!audience || !audience.published || audience.visibility !== "family_full") throw new AppError("NOT_FOUND");
      audienceAccess(current, item, guardians, audience);
      const changed = await tx.query<{ id: QualitativeReviewId }>(`UPDATE ls_progress.qualitative_reviews SET state='published',attended_session_count=$3,
        published_by_account_id=$4,published_at=$5 WHERE workspace_id=$1 AND id=$2 AND state='draft' AND revision=$6 RETURNING id`,
      [actor.workspaceId, reviewId, attendedSessionCount, actor.id, now, candidate.row.revision]);
      if (changed.length !== 1) throw new AppError("CONFLICT");
      await recordLs050Action(tx, { requestId, now }, actor.workspaceId, actor.id, "qualitative_review_published");
    });
    return { reviewId, attendedSessionCount, revision: candidate.row.revision, publishedAt: now.toISOString() };
  }

  async listReviews(actor: Actor, caseId: CaseId): Promise<QualitativeReviewProjection[]> {
    return this.store.transaction(async (tx) => {
      const current = await freshActor(tx, actor, this.clock.now());
      const item = await loadCase(tx, actor.workspaceId, caseId);
      const guardians = await loadGuardians(tx, actor.workspaceId, caseId);
      caseAccess(current, item, guardians, "read");
      const rows = await tx.query<ReviewRow>(`SELECT id,case_id AS "caseId",audience_id AS "audienceId",period_start::text AS "periodStart",
        period_end::text AS "periodEnd",attended_session_count AS "attendedSessionCount",narrative_ciphertext AS "narrativeCiphertext",state,
        published_at AS "publishedAt",revision FROM ls_progress.qualitative_reviews WHERE workspace_id=$1 AND case_id=$2
        ORDER BY period_start DESC,id LIMIT 100`, [actor.workspaceId, caseId]);
      const result: QualitativeReviewProjection[] = [];
      for (const row of rows) {
        if (current.role !== "practitioner" && row.state !== "published") continue;
        const audience = await loadAudience(tx, actor.workspaceId, caseId, row.audienceId);
        if (!audience) continue;
        try { audienceAccess(current, item, guardians, audience); } catch (error) {
          if (error instanceof AppError && error.code === "NOT_FOUND") continue;
          throw error;
        }
        const parentReports = await tx.query<{ reportId: ParentReportId; authorAccountId: Actor["id"]; submittedAt: Date; sourceType: "parent_report" }>(
          `SELECT report_id AS "reportId",author_account_id AS "authorAccountId",submitted_at AS "submittedAt",source_type AS "sourceType"
          FROM ls_progress.review_parent_reports WHERE workspace_id=$1 AND review_id=$2 ORDER BY submitted_at,report_id`, [actor.workspaceId, row.id]);
        const versions = await tx.query<{ versionId: PracticeVersionId }>(
          `SELECT version_id AS "versionId" FROM ls_progress.review_practice_versions WHERE workspace_id=$1 AND review_id=$2 ORDER BY version_id`, [actor.workspaceId, row.id]);
        result.push({
          id: row.id,
          caseId: row.caseId,
          audienceId: row.audienceId,
          periodStart: row.periodStart,
          periodEnd: row.periodEnd,
          attendedSessionCount: row.attendedSessionCount,
          state: row.state,
          revision: row.revision,
          narrative: JSON.parse(unseal(row.narrativeCiphertext, `qualitative-review:${actor.workspaceId}:${row.id}`, this.config.keyring)) as QualitativeNarrative,
          parentReports: parentReports.map((reference) => ({ ...reference, submittedAt: new Date(reference.submittedAt).toISOString() })),
          assignmentVersionIds: versions.map((reference) => reference.versionId),
          publishedAt: row.publishedAt ? new Date(row.publishedAt).toISOString() : null,
        });
      }
      return result;
    });
  }
}
