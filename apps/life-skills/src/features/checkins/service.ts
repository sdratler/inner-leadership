import { randomUUID } from "node:crypto";
import { AppError } from "../../lib/errors.ts";
import { asId } from "../../lib/ids.ts";
import { loadAudience, loadCase, loadGuardians } from "../cases/data.ts";
import { audienceAccess } from "../cases/policy.ts";
import { freshActor, lockWorkspace } from "../identity/data.ts";
import type { CompletionReportReference, CoordinationSnapshot, CoordinationVersionId, OccurrenceId } from "../identity/interfaces.ts";
import { one, type IdentityStore, type SqlSession } from "../identity/store.ts";
import type { AccountId, Actor, AudienceId, CaseId, IdentityClock } from "../identity/types.ts";
import { assertAssigneeMayReport, assertCompletionStatus, occurrenceShouldClose } from "../home-practice/policy.ts";
import type { CompletionReportId, CompletionStatus, CompletionView } from "../home-practice/types.ts";
import { recordPracticeAction } from "../home-practice/history.ts";

interface OccurrenceRow {
  occurrenceId: OccurrenceId;
  caseId: CaseId;
  audienceId: AudienceId;
  coordinationVersionId: CoordinationVersionId;
  state: "open" | "closed";
  assigneeAccountIds: AccountId[];
  completionMode: "any_assignee" | "each_assignee";
  effectiveFrom: Date;
  changedByAccountId: AccountId;
}

interface CompletionRow {
  reportId: CompletionReportId;
  occurrenceId: OccurrenceId;
  authorAccountId: AccountId;
  status: CompletionStatus;
  revision: number;
  reportedAt: Date;
  idempotencyKey: string;
  correctsReportId: CompletionReportId | null;
}

const OCCURRENCE_SELECT = `SELECT o.id AS "occurrenceId",a.case_id AS "caseId",a.audience_id AS "audienceId",
 o.coordination_version_id AS "coordinationVersionId",o.state,c.assignee_account_ids AS "assigneeAccountIds",
 c.completion_mode AS "completionMode",c.effective_from AS "effectiveFrom",c.changed_by_account_id AS "changedByAccountId"
 FROM ls_practice.practice_occurrences o JOIN ls_practice.practice_assignments a
 ON a.workspace_id=o.workspace_id AND a.id=o.assignment_id JOIN ls_practice.task_coordination_versions c
 ON c.workspace_id=o.workspace_id AND c.id=o.coordination_version_id`;

export class CheckInService {
  constructor(private readonly store: IdentityStore, private readonly clock: IdentityClock) {}

  async submit(actor: Actor, input: {
    occurrenceId: OccurrenceId; status: CompletionStatus; idempotencyKey: string; correctsReportId?: CompletionReportId | undefined;
  }, requestId: string): Promise<CompletionReportReference> {
    const status = assertCompletionStatus(input.status), now = this.clock.now();
    return this.store.transaction(async tx => {
      await lockWorkspace(tx, actor.workspaceId);
      const occurrence = await this.requireOccurrence(tx, actor, input.occurrenceId);
      const current = await freshActor(tx, actor, now);
      const audience = await loadAudience(tx, actor.workspaceId, occurrence.caseId, occurrence.audienceId);
      if (!audience) throw new AppError("NOT_FOUND");
      audienceAccess(current, await loadCase(tx, actor.workspaceId, occurrence.caseId), await loadGuardians(tx, actor.workspaceId, occurrence.caseId), audience);
      const snapshot: CoordinationSnapshot = {
        versionId: occurrence.coordinationVersionId, caseId: occurrence.caseId, audienceId: occurrence.audienceId,
        assigneeAccountIds: occurrence.assigneeAccountIds, completionMode: occurrence.completionMode,
        effectiveFrom: occurrence.effectiveFrom.toISOString(), changedByAccountId: occurrence.changedByAccountId,
      };
      assertAssigneeMayReport(snapshot, actor.id);
      const existing = await one<CompletionRow>(tx,
        `SELECT id AS "reportId",occurrence_id AS "occurrenceId",author_account_id AS "authorAccountId",status,revision,
         reported_at AS "reportedAt",idempotency_key AS "idempotencyKey",corrects_report_id AS "correctsReportId"
         FROM ls_practice.completion_reports WHERE workspace_id=$1 AND author_account_id=$2 AND idempotency_key=$3`,
        [actor.workspaceId, actor.id, input.idempotencyKey]);
      if (existing) {
        if (existing.occurrenceId !== input.occurrenceId || existing.status !== status || existing.correctsReportId !== (input.correctsReportId ?? null)) throw new AppError("CONFLICT");
        return { occurrenceId: existing.occurrenceId, coordinationVersionId: occurrence.coordinationVersionId, authorAccountId: existing.authorAccountId, reportedAt: existing.reportedAt.toISOString(), idempotencyKey: existing.idempotencyKey, status: existing.status };
      }
      let revision = 1;
      if (input.correctsReportId) {
        const previous = await one<CompletionRow>(tx,
          `SELECT id AS "reportId",occurrence_id AS "occurrenceId",author_account_id AS "authorAccountId",status,revision,
           reported_at AS "reportedAt",idempotency_key AS "idempotencyKey",corrects_report_id AS "correctsReportId"
           FROM ls_practice.completion_reports WHERE workspace_id=$1 AND occurrence_id=$2 AND id=$3 AND author_account_id=$4 FOR UPDATE`,
          [actor.workspaceId, input.occurrenceId, input.correctsReportId, actor.id]);
        if (!previous) throw new AppError("NOT_FOUND");
        const newer = await one(tx, "SELECT id FROM ls_practice.completion_reports WHERE workspace_id=$1 AND occurrence_id=$2 AND author_account_id=$3 AND revision>$4", [actor.workspaceId, input.occurrenceId, actor.id, previous.revision]);
        if (newer) throw new AppError("CONFLICT");
        revision = previous.revision + 1;
      } else {
        if (occurrence.state === "closed") throw new AppError("CONFLICT");
        if (await one(tx, "SELECT id FROM ls_practice.completion_reports WHERE workspace_id=$1 AND occurrence_id=$2 AND author_account_id=$3", [actor.workspaceId, input.occurrenceId, actor.id])) throw new AppError("CONFLICT");
      }
      const reportId = asId(randomUUID(), "completion_report");
      await tx.query(`INSERT INTO ls_practice.completion_reports
        (id,workspace_id,occurrence_id,author_account_id,status,revision,reported_at,idempotency_key,corrects_report_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [reportId, actor.workspaceId, input.occurrenceId, actor.id, status, revision, now, input.idempotencyKey, input.correctsReportId ?? null]);
      const reported = await tx.query<{ authorAccountId: AccountId }>(
        `SELECT DISTINCT ON (author_account_id) author_account_id AS "authorAccountId" FROM ls_practice.completion_reports
         WHERE workspace_id=$1 AND occurrence_id=$2 ORDER BY author_account_id,revision DESC`, [actor.workspaceId, input.occurrenceId]);
      if (occurrenceShouldClose(snapshot, reported.map(row => row.authorAccountId))) {
        await tx.query("UPDATE ls_practice.practice_occurrences SET state='closed',closed_at=COALESCE(closed_at,$3) WHERE workspace_id=$1 AND id=$2", [actor.workspaceId, input.occurrenceId, now]);
      }
      await recordPracticeAction(tx, { requestId, now }, actor.workspaceId, actor.id, input.correctsReportId ? "practice_checkin_corrected" : "practice_checkin_reported");
      return { occurrenceId: input.occurrenceId, coordinationVersionId: occurrence.coordinationVersionId, authorAccountId: actor.id, reportedAt: now.toISOString(), idempotencyKey: input.idempotencyKey, status };
    });
  }

  async list(actor: Actor, occurrenceId: OccurrenceId): Promise<CompletionView[]> {
    return this.store.transaction(async tx => {
      const occurrence = await this.requireOccurrence(tx, actor, occurrenceId);
      const current = await freshActor(tx, actor, this.clock.now());
      const audience = await loadAudience(tx, actor.workspaceId, occurrence.caseId, occurrence.audienceId);
      if (!audience) throw new AppError("NOT_FOUND");
      audienceAccess(current, await loadCase(tx, actor.workspaceId, occurrence.caseId), await loadGuardians(tx, actor.workspaceId, occurrence.caseId), audience);
      const rows = await tx.query<CompletionRow>(
        `SELECT id AS "reportId",occurrence_id AS "occurrenceId",author_account_id AS "authorAccountId",status,revision,
         reported_at AS "reportedAt",idempotency_key AS "idempotencyKey",corrects_report_id AS "correctsReportId"
         FROM ls_practice.completion_reports WHERE workspace_id=$1 AND occurrence_id=$2 ORDER BY author_account_id,revision`, [actor.workspaceId, occurrenceId]);
      return rows.map(row => ({ reportId: row.reportId, occurrenceId: row.occurrenceId, authorAccountId: row.authorAccountId, status: row.status, revision: row.revision, reportedAt: row.reportedAt.toISOString(), correctedReportId: row.correctsReportId }));
    });
  }

  private async requireOccurrence(tx: SqlSession, actor: Actor, occurrenceId: OccurrenceId): Promise<OccurrenceRow> {
    const row = await one<OccurrenceRow>(tx, OCCURRENCE_SELECT + " WHERE o.workspace_id=$1 AND o.id=$2 FOR UPDATE OF o", [actor.workspaceId, occurrenceId]);
    if (!row) throw new AppError("NOT_FOUND");
    return row;
  }
}
