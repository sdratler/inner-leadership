import { createHash, randomUUID } from "node:crypto";
import { AppError } from "../../lib/errors.ts";
import { asId } from "../../lib/ids.ts";
import { instant } from "../../lib/time.ts";
import { loadAudience, loadCase, loadGuardians } from "../cases/data.ts";
import { audienceAccess } from "../cases/policy.ts";
import type { IdentityConfig } from "../identity/config.ts";
import { seal, unseal } from "../identity/crypto.ts";
import { freshActor, lockWorkspace } from "../identity/data.ts";
import type { PracticeVersionId, PracticeVersionReader, PracticeVersionReference } from "../identity/interfaces.ts";
import { one, type IdentityStore, type SqlSession } from "../identity/store.ts";
import type { AccountId, Actor, AudienceId, CaseId, IdentityClock } from "../identity/types.ts";
import { recordUpdateAction } from "./history.ts";
import { narrative, parentMayReport, practitionerMayRespond } from "./policy.ts";
import type {
  AdaptationDraftReceipt,
  ParentReportView,
  PracticeAdaptationPort,
  PractitionerReplyView,
  ReviewState,
  UpdateReplyId,
  UpdateReportId,
  UpdateThreadView,
} from "./types.ts";

const reportAad = (workspaceId: string, reportId: string) => `update-report:${workspaceId}:${reportId}`;
const replyAad = (workspaceId: string, replyId: string) => `update-reply:${workspaceId}:${replyId}`;
const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

interface ReportRow {
  id: UpdateReportId;
  workspaceId: Actor["workspaceId"];
  caseId: CaseId;
  audienceId: AudienceId;
  authorAccountId: AccountId;
  bodyCiphertext: string;
  bodyDigest: string;
  eventAt: Date | null;
  submittedAt: Date;
  reviewState: ReviewState;
  reviewedByAccountId: AccountId | null;
  reviewedAt: Date | null;
  practiceAssignmentId: PracticeVersionReference["assignmentId"];
  practiceVersionId: PracticeVersionId;
  practicePublishedAt: Date;
  practiceSnapshotDigest: string;
}

interface ReplyRow {
  id: UpdateReplyId;
  reportId: UpdateReportId;
  authorAccountId: AccountId;
  bodyCiphertext: string;
  bodyDigest: string;
  state: "draft" | "published";
  createdAt: Date;
  publishedAt: Date | null;
  supersedesReplyId: UpdateReplyId | null;
}

const REPORT_SELECT = `SELECT id,workspace_id AS "workspaceId",case_id AS "caseId",audience_id AS "audienceId",
 author_account_id AS "authorAccountId",body_ciphertext AS "bodyCiphertext",body_digest AS "bodyDigest",
 event_at AS "eventAt",submitted_at AS "submittedAt",review_state AS "reviewState",
 reviewed_by_account_id AS "reviewedByAccountId",reviewed_at AS "reviewedAt",
 practice_assignment_id AS "practiceAssignmentId",practice_version_id AS "practiceVersionId",
 practice_published_at AS "practicePublishedAt",practice_snapshot_digest AS "practiceSnapshotDigest"
 FROM ls_updates.parent_reports`;

const REPLY_SELECT = `SELECT id,report_id AS "reportId",author_account_id AS "authorAccountId",
 body_ciphertext AS "bodyCiphertext",body_digest AS "bodyDigest",state,created_at AS "createdAt",published_at AS "publishedAt",
 supersedes_reply_id AS "supersedesReplyId" FROM ls_updates.practitioner_replies`;

export class UpdateService {
  constructor(
    private readonly store: IdentityStore,
    private readonly config: IdentityConfig,
    private readonly clock: IdentityClock,
    private readonly versions: PracticeVersionReader,
    private readonly adaptations: PracticeAdaptationPort,
  ) {}

  private practice(row: ReportRow): PracticeVersionReference {
    return {
      workspaceId: row.workspaceId,
      caseId: row.caseId,
      assignmentId: row.practiceAssignmentId,
      versionId: row.practiceVersionId,
      audienceId: row.audienceId,
      visibility: "family_full",
      publishedAt: new Date(row.practicePublishedAt).toISOString(),
      immutableSnapshotDigest: row.practiceSnapshotDigest,
    };
  }

  private report(row: ReportRow): ParentReportView {
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      caseId: row.caseId,
      audienceId: row.audienceId,
      authorAccountId: row.authorAccountId,
      body: unseal(row.bodyCiphertext, reportAad(row.workspaceId, row.id), this.config.keyring),
      eventAt: row.eventAt ? new Date(row.eventAt).toISOString() : null,
      submittedAt: new Date(row.submittedAt).toISOString(),
      reviewState: row.reviewState,
      reviewedByAccountId: row.reviewedByAccountId,
      reviewedAt: row.reviewedAt ? new Date(row.reviewedAt).toISOString() : null,
      practice: this.practice(row),
    };
  }

  private reply(workspaceId: Actor["workspaceId"], row: ReplyRow): PractitionerReplyView {
    return {
      id: row.id,
      reportId: row.reportId,
      authorAccountId: row.authorAccountId,
      body: unseal(row.bodyCiphertext, replyAad(workspaceId, row.id), this.config.keyring),
      state: row.state,
      createdAt: new Date(row.createdAt).toISOString(),
      publishedAt: row.publishedAt ? new Date(row.publishedAt).toISOString() : null,
      supersedesReplyId: row.supersedesReplyId,
    };
  }

  private async authorizeReport(tx: SqlSession, actor: Actor, reportId: UpdateReportId, forUpdate = false): Promise<{ current: Awaited<ReturnType<typeof freshActor>>; row: ReportRow }> {
    const row = await one<ReportRow>(tx, REPORT_SELECT + " WHERE workspace_id=$1 AND id=$2" + (forUpdate ? " FOR UPDATE" : ""), [actor.workspaceId, reportId]);
    if (!row) throw new AppError("NOT_FOUND");
    const current = await freshActor(tx, actor, this.clock.now());
    practitionerMayRespond(current, await loadCase(tx, actor.workspaceId, row.caseId), await loadGuardians(tx, actor.workspaceId, row.caseId));
    return { current, row };
  }

  async submitParentReport(actor: Actor, input: {
    caseId: CaseId;
    audienceId: AudienceId;
    practiceVersionId: PracticeVersionId;
    body: string;
    eventAt?: string | null | undefined;
    idempotencyKey: string;
  }, requestId: string): Promise<ParentReportView> {
    const body = narrative(input.body);
    const eventAt = input.eventAt ? new Date(instant(input.eventAt)) : null;
    const scope = Object.freeze({ workspaceId: actor.workspaceId, accountId: actor.id, caseId: input.caseId });
    const version = await this.versions.getAuthorizedVersion(scope, input.practiceVersionId);
    if (!version || version.workspaceId !== actor.workspaceId || version.caseId !== input.caseId ||
      version.audienceId !== input.audienceId || version.visibility !== "family_full" ||
      !/^[0-9a-f]{64}$/.test(version.immutableSnapshotDigest)) throw new AppError("NOT_FOUND");
    const now = this.clock.now();
    return this.store.transaction(async tx => {
      await lockWorkspace(tx, actor.workspaceId);
      const current = await freshActor(tx, actor, now);
      const item = await loadCase(tx, actor.workspaceId, input.caseId);
      const guardians = await loadGuardians(tx, actor.workspaceId, input.caseId);
      const audience = await loadAudience(tx, actor.workspaceId, input.caseId, input.audienceId);
      if (!audience) throw new AppError("NOT_FOUND");
      parentMayReport(current, item, guardians, audience);
      const bodyDigest = digest(body);
      const existing = await one<ReportRow>(tx, REPORT_SELECT + " WHERE workspace_id=$1 AND author_account_id=$2 AND idempotency_key=$3", [actor.workspaceId, actor.id, input.idempotencyKey]);
      if (existing) {
        if (existing.bodyDigest !== bodyDigest || existing.practiceVersionId !== input.practiceVersionId) throw new AppError("CONFLICT");
        return this.report(existing);
      }
      const id = asId(randomUUID(), "parent_report");
      const ciphertext = seal(body, reportAad(actor.workspaceId, id), this.config.keyring);
      await tx.query(`INSERT INTO ls_updates.parent_reports
        (id,workspace_id,case_id,audience_id,author_account_id,body_ciphertext,body_digest,event_at,submitted_at,
         review_state,practice_assignment_id,practice_version_id,practice_published_at,practice_snapshot_digest,idempotency_key)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'new',$10,$11,$12,$13,$14)`,
      [id, actor.workspaceId, input.caseId, input.audienceId, actor.id, ciphertext, bodyDigest, eventAt, now,
        version.assignmentId, version.versionId, new Date(version.publishedAt), version.immutableSnapshotDigest, input.idempotencyKey]);
      await recordUpdateAction(tx, { workspaceId: actor.workspaceId, actorAccountId: actor.id, requestId, action: "parent_report_submitted", now });
      return {
        id, workspaceId: actor.workspaceId, caseId: input.caseId, audienceId: input.audienceId,
        authorAccountId: actor.id, body, eventAt: eventAt?.toISOString() ?? null, submittedAt: now.toISOString(),
        reviewState: "new", reviewedByAccountId: null, reviewedAt: null,
        practice: { ...version, publishedAt: new Date(version.publishedAt).toISOString() },
      };
    });
  }

  async review(actor: Actor, reportId: UpdateReportId, requestId: string): Promise<ParentReportView> {
    const now = this.clock.now();
    return this.store.transaction(async tx => {
      await lockWorkspace(tx, actor.workspaceId);
      const { row } = await this.authorizeReport(tx, actor, reportId, true);
      if (row.reviewState === "new") {
        await tx.query(`UPDATE ls_updates.parent_reports SET review_state='reviewed',reviewed_by_account_id=$3,reviewed_at=$4
          WHERE workspace_id=$1 AND id=$2 AND review_state='new'`, [actor.workspaceId, reportId, actor.id, now]);
        row.reviewState = "reviewed";
        row.reviewedByAccountId = actor.id;
        row.reviewedAt = now;
        await recordUpdateAction(tx, { workspaceId: actor.workspaceId, actorAccountId: actor.id, requestId, action: "parent_report_reviewed", now });
      }
      return this.report(row);
    });
  }

  async replyToReport(actor: Actor, input: {
    reportId: UpdateReportId;
    body: string;
    publish: boolean;
    supersedesReplyId?: UpdateReplyId | undefined;
    idempotencyKey: string;
  }, requestId: string): Promise<PractitionerReplyView> {
    const body = narrative(input.body);
    const now = this.clock.now();
    return this.store.transaction(async tx => {
      await lockWorkspace(tx, actor.workspaceId);
      const { row } = await this.authorizeReport(tx, actor, input.reportId, true);
      const existing = await one<ReplyRow>(tx, REPLY_SELECT + " WHERE workspace_id=$1 AND author_account_id=$2 AND idempotency_key=$3", [actor.workspaceId, actor.id, input.idempotencyKey]);
      if (existing) {
        if (existing.reportId !== input.reportId || existing.bodyDigest !== digest(body) || existing.state !== (input.publish ? "published" : "draft")) throw new AppError("CONFLICT");
        return this.reply(actor.workspaceId, existing);
      }
      if (input.supersedesReplyId) {
        const prior = await one<ReplyRow>(tx, REPLY_SELECT + " WHERE workspace_id=$1 AND report_id=$2 AND id=$3 AND state='published'", [actor.workspaceId, input.reportId, input.supersedesReplyId]);
        if (!prior) throw new AppError("NOT_FOUND");
      }
      const id = asId(randomUUID(), "update_reply");
      const ciphertext = seal(body, replyAad(actor.workspaceId, id), this.config.keyring);
      const state = input.publish ? "published" : "draft";
      await tx.query(`INSERT INTO ls_updates.practitioner_replies
        (id,workspace_id,report_id,case_id,audience_id,author_account_id,body_ciphertext,body_digest,state,created_at,published_at,supersedes_reply_id,idempotency_key)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [id, actor.workspaceId, input.reportId, row.caseId, row.audienceId, actor.id, ciphertext, digest(body), state, now, input.publish ? now : null, input.supersedesReplyId ?? null, input.idempotencyKey]);
      if (input.publish) {
        await tx.query("UPDATE ls_updates.parent_reports SET review_state='replied',reviewed_by_account_id=COALESCE(reviewed_by_account_id,$3),reviewed_at=COALESCE(reviewed_at,$4) WHERE workspace_id=$1 AND id=$2", [actor.workspaceId, input.reportId, actor.id, now]);
      } else if (row.reviewState === "new") {
        await tx.query("UPDATE ls_updates.parent_reports SET review_state='reviewed',reviewed_by_account_id=$3,reviewed_at=$4 WHERE workspace_id=$1 AND id=$2 AND review_state='new'", [actor.workspaceId, input.reportId, actor.id, now]);
      }
      await recordUpdateAction(tx, { workspaceId: actor.workspaceId, actorAccountId: actor.id, requestId, action: input.publish ? "practitioner_reply_published" : "practitioner_reply_drafted", now });
      return { id, reportId: input.reportId, authorAccountId: actor.id, body, state, createdAt: now.toISOString(), publishedAt: input.publish ? now.toISOString() : null, supersedesReplyId: input.supersedesReplyId ?? null };
    });
  }

  async publishReply(actor: Actor, replyId: UpdateReplyId, requestId: string): Promise<PractitionerReplyView> {
    const now = this.clock.now();
    return this.store.transaction(async tx => {
      await lockWorkspace(tx, actor.workspaceId);
      const joined = await one<ReplyRow & { caseId: CaseId; reportId: UpdateReportId }>(tx, `SELECT
        r.id,r.report_id AS "reportId",r.author_account_id AS "authorAccountId",r.body_ciphertext AS "bodyCiphertext",r.body_digest AS "bodyDigest",
        r.state,r.created_at AS "createdAt",r.published_at AS "publishedAt",r.supersedes_reply_id AS "supersedesReplyId",
        p.case_id AS "caseId"
        FROM ls_updates.practitioner_replies r JOIN ls_updates.parent_reports p
          ON p.workspace_id=r.workspace_id AND p.id=r.report_id
        WHERE r.workspace_id=$1 AND r.id=$2 FOR UPDATE OF r`, [actor.workspaceId, replyId]);
      if (!joined) throw new AppError("NOT_FOUND");
      await this.authorizeReport(tx, actor, joined.reportId, true);
      if (joined.state === "draft") {
        await tx.query("UPDATE ls_updates.practitioner_replies SET state='published',published_at=$3 WHERE workspace_id=$1 AND id=$2 AND state='draft'", [actor.workspaceId, replyId, now]);
        await tx.query("UPDATE ls_updates.parent_reports SET review_state='replied',reviewed_by_account_id=COALESCE(reviewed_by_account_id,$3),reviewed_at=COALESCE(reviewed_at,$4) WHERE workspace_id=$1 AND id=$2", [actor.workspaceId, joined.reportId, actor.id, now]);
        joined.state = "published";
        joined.publishedAt = now;
        await recordUpdateAction(tx, { workspaceId: actor.workspaceId, actorAccountId: actor.id, requestId, action: "practitioner_reply_published", now });
      }
      return this.reply(actor.workspaceId, joined);
    });
  }

  async list(actor: Actor, caseId: CaseId, audienceId: AudienceId): Promise<UpdateThreadView[]> {
    return this.store.transaction(async tx => {
      const current = await freshActor(tx, actor, this.clock.now());
      const item = await loadCase(tx, actor.workspaceId, caseId);
      const guardians = await loadGuardians(tx, actor.workspaceId, caseId);
      const audience = await loadAudience(tx, actor.workspaceId, caseId, audienceId);
      if (!audience) throw new AppError("NOT_FOUND");
      audienceAccess(current, item, guardians, audience);
      if (current.role !== "practitioner" && (current.role !== "parent" || audience.visibility !== "family_full")) throw new AppError("NOT_FOUND");
      const reports = await tx.query<ReportRow>(REPORT_SELECT + " WHERE workspace_id=$1 AND case_id=$2 AND audience_id=$3 ORDER BY submitted_at DESC,id LIMIT 100", [actor.workspaceId, caseId, audienceId]);
      const results: UpdateThreadView[] = [];
      for (const row of reports) {
        const replies = await tx.query<ReplyRow>(REPLY_SELECT + ` WHERE workspace_id=$1 AND report_id=$2
          ${current.role === "practitioner" ? "" : "AND state='published'"} ORDER BY created_at,id`, [actor.workspaceId, row.id]);
        results.push({ report: this.report(row), replies: replies.map(reply => this.reply(actor.workspaceId, reply)) });
      }
      return results;
    });
  }

  async adapt(actor: Actor, input: {
    reportId: UpdateReportId;
    adaptedInstructions: string;
    idempotencyKey: string;
  }, requestId: string): Promise<AdaptationDraftReceipt> {
    const adaptedInstructions = narrative(input.adaptedInstructions);
    const authorized = await this.store.transaction(async tx => {
      await lockWorkspace(tx, actor.workspaceId);
      const { current, row } = await this.authorizeReport(tx, actor, input.reportId, true);
      if (row.reviewState === "new") throw new AppError("CONFLICT");
      const existing = await one<AdaptationDraftReceipt>(tx, `SELECT id,report_id AS "reportId",assignment_id AS "assignmentId",
        previous_version_id AS "previousVersionId",new_version_id AS "newVersionId",state,created_at AS "createdAt"
        FROM ls_updates.adaptation_receipts WHERE workspace_id=$1 AND report_id=$2 AND idempotency_key=$3`, [actor.workspaceId, input.reportId, input.idempotencyKey]);
      return { current, row, existing };
    });
    // Even an acknowledged retry must pass the adapter's durable request digest
    // and current authorization checks; an old receipt is not a body-validation bypass.
    const currentVersion = this.practice(authorized.row);
    const result = await this.adaptations.createDraftFromReport({
      scope: { workspaceId: actor.workspaceId, accountId: actor.id, caseId: authorized.row.caseId },
      sourceReportId: input.reportId,
      currentVersion,
      adaptedInstructions,
      practitionerAccountId: authorized.current.id,
      idempotencyKey: input.idempotencyKey,
    });
    if (result.state !== "draft" || result.assignmentId !== currentVersion.assignmentId ||
      result.previousVersionId !== currentVersion.versionId || result.newVersionId === currentVersion.versionId) throw new AppError("UNAVAILABLE");
    if (authorized.existing) {
      if (authorized.existing.assignmentId !== result.assignmentId || authorized.existing.previousVersionId !== result.previousVersionId ||
        authorized.existing.newVersionId !== result.newVersionId) throw new AppError("CONFLICT");
      return { ...authorized.existing, createdAt: new Date(authorized.existing.createdAt).toISOString() };
    }
    const now = this.clock.now();
    return this.store.transaction(async tx => {
      await lockWorkspace(tx, actor.workspaceId);
      await this.authorizeReport(tx, actor, input.reportId, true);
      const id = asId(randomUUID(), "adaptation_receipt");
      await tx.query(`INSERT INTO ls_updates.adaptation_receipts
        (id,workspace_id,report_id,assignment_id,previous_version_id,new_version_id,state,created_by_account_id,created_at,idempotency_key)
        VALUES ($1,$2,$3,$4,$5,$6,'draft',$7,$8,$9) ON CONFLICT (workspace_id,report_id,idempotency_key) DO NOTHING`,
      [id, actor.workspaceId, input.reportId, result.assignmentId, result.previousVersionId, result.newVersionId, actor.id, now, input.idempotencyKey]);
      const stored = await one<AdaptationDraftReceipt>(tx, `SELECT id,report_id AS "reportId",assignment_id AS "assignmentId",
        previous_version_id AS "previousVersionId",new_version_id AS "newVersionId",state,created_at AS "createdAt"
        FROM ls_updates.adaptation_receipts WHERE workspace_id=$1 AND report_id=$2 AND idempotency_key=$3`, [actor.workspaceId, input.reportId, input.idempotencyKey]);
      if (!stored || stored.newVersionId !== result.newVersionId) throw new AppError("CONFLICT");
      await tx.query("UPDATE ls_updates.parent_reports SET review_state='adapted' WHERE workspace_id=$1 AND id=$2", [actor.workspaceId, input.reportId]);
      await recordUpdateAction(tx, { workspaceId: actor.workspaceId, actorAccountId: actor.id, requestId, action: "practice_adaptation_drafted", now });
      return { ...stored, createdAt: new Date(stored.createdAt).toISOString() };
    });
  }
}
