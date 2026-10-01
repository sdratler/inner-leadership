import { createHash,randomUUID } from "node:crypto";
import { AppError } from "../../lib/errors.ts";
import { asId } from "../../lib/ids.ts";
import { loadAudience, loadCase, loadGuardians } from "../cases/data.ts";
import { audienceAccess } from "../cases/policy.ts";
import { freshActor, lockWorkspace } from "../identity/data.ts";
import type { CompletionReportReference, CoordinationSnapshot, CoordinationVersionId, OccurrenceId } from "../identity/interfaces.ts";
import { one, type IdentityStore, type SqlSession } from "../identity/store.ts";
import type { AccountId, Actor, AudienceId, CaseId, IdentityClock } from "../identity/types.ts";
import { assertAssigneeMayReport, assertCompletionStatus, occurrenceShouldClose } from "../home-practice/policy.ts";
import type { CompletionReportId, CompletionStatus, CompletionView, OwnCompletionView } from "../home-practice/types.ts";
import { recordPracticeAction } from "../home-practice/history.ts";
import {seal,unseal,type Keyring} from "../identity/crypto.ts";
import {assistedCheckInInput,type AssistedCheckInInput} from "../home-practice/responsibility-input.ts";

interface OccurrenceRow {
  occurrenceId: OccurrenceId;
  caseId: CaseId;
  audienceId: AudienceId;
  coordinationVersionId: CoordinationVersionId;
  state: "open" | "closed" | "cancelled";
  assigneeAccountIds: AccountId[];
  completionMode: "any_assignee" | "each_assignee";
  effectiveFrom: Date;
  changedByAccountId: AccountId;
  responsibilityVersionId:string|null;
  participant:"parent"|"client"|null;
  assistedParentAccountIds:AccountId[]|null;
  subjectPersonId:string;
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
  subjectPersonId:string|null;
  authorship:"self"|"parent_assisted_child"|"parent_reporting_child"|null;
  noteCiphertext:string|null;
}

const REPORT_FIELDS=`id AS "reportId",occurrence_id AS "occurrenceId",author_account_id AS "authorAccountId",status,revision,
 reported_at AS "reportedAt",idempotency_key AS "idempotencyKey",corrects_report_id AS "correctsReportId",
 subject_person_id AS "subjectPersonId",authorship,note_ciphertext AS "noteCiphertext"`;
export function practiceReportNoteAad(workspaceId:string,caseId:string,versionId:string,occurrenceId:string,reportId:string,authorAccountId:string,subjectPersonId:string,authorship:string):string{
  return "practice-note:"+createHash("sha256").update(JSON.stringify([workspaceId,caseId,versionId,occurrenceId,reportId,authorAccountId,subjectPersonId,authorship])).digest("hex");
}

const OCCURRENCE_SELECT = `SELECT o.id AS "occurrenceId",a.case_id AS "caseId",a.audience_id AS "audienceId",
 o.coordination_version_id AS "coordinationVersionId",o.state,c.assignee_account_ids AS "assigneeAccountIds",
 c.completion_mode AS "completionMode",c.effective_from AS "effectiveFrom",c.changed_by_account_id AS "changedByAccountId",
 c.responsibility_version_id AS "responsibilityVersionId",c.participant,c.assisted_parent_account_ids AS "assistedParentAccountIds",cl.person_id AS "subjectPersonId"
 FROM ls_practice.practice_occurrences o JOIN ls_practice.practice_assignments a
 ON a.workspace_id=o.workspace_id AND a.id=o.assignment_id JOIN ls_practice.task_coordination_versions c
 ON c.workspace_id=o.workspace_id AND c.id=o.coordination_version_id
 JOIN ls_cases.cases ca ON ca.workspace_id=a.workspace_id AND ca.id=a.case_id
 JOIN ls_cases.clients cl ON cl.workspace_id=ca.workspace_id AND cl.id=ca.client_id`;

export class CheckInService {
  constructor(private readonly store: IdentityStore, private readonly clock: IdentityClock,private readonly keyring?:Keyring) {}

  private note(actor:Actor,occurrence:OccurrenceRow,row:CompletionRow):string{
    if(!this.keyring||!occurrence.responsibilityVersionId||!row.subjectPersonId||!row.authorship||row.noteCiphertext===null)throw new AppError("UNAVAILABLE");
    return unseal(row.noteCiphertext,practiceReportNoteAad(actor.workspaceId,occurrence.caseId,occurrence.responsibilityVersionId,row.occurrenceId,row.reportId,row.authorAccountId,row.subjectPersonId,row.authorship),this.keyring);
  }

  async submit(actor: Actor, input: {
    occurrenceId: OccurrenceId; status: CompletionStatus; idempotencyKey: string; correctsReportId?: CompletionReportId | undefined;assistance?:AssistedCheckInInput|undefined;
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
      let authorship:CompletionRow["authorship"]=null,note="";
      if(occurrence.responsibilityVersionId){
        if(input.assistance){
          const parsed=assistedCheckInInput.safeParse(input.assistance);if(!parsed.success)throw new AppError("INVALID_REQUEST");
          if(current.role!=="parent"||occurrence.participant!=="client"||!occurrence.assistedParentAccountIds?.includes(current.id))throw new AppError("NOT_FOUND");
          authorship=parsed.data.mode==="together"?"parent_assisted_child":"parent_reporting_child";note=parsed.data.note;
        }else{
          assertAssigneeMayReport(snapshot,current.id);
          if((occurrence.participant==="parent")!==(current.role==="parent"))throw new AppError("NOT_FOUND");
          authorship="self";
        }
        if(!this.keyring)throw new AppError("UNAVAILABLE");
      }else{if(input.assistance)throw new AppError("INVALID_REQUEST");assertAssigneeMayReport(snapshot,current.id);}
      if(occurrence.state==="cancelled")throw new AppError("CONFLICT");
      const existing = await one<CompletionRow>(tx,
        `SELECT ${REPORT_FIELDS}
         FROM ls_practice.completion_reports WHERE workspace_id=$1 AND author_account_id=$2 AND idempotency_key=$3`,
        [actor.workspaceId, actor.id, input.idempotencyKey]);
      if (existing) {
        if (existing.occurrenceId !== input.occurrenceId || existing.status !== status || existing.correctsReportId !== (input.correctsReportId ?? null)||existing.authorship!==authorship||existing.subjectPersonId!==(authorship?occurrence.subjectPersonId:null)||authorship&&this.note(actor,occurrence,existing)!==note) throw new AppError("CONFLICT");
        return { occurrenceId: existing.occurrenceId, coordinationVersionId: occurrence.coordinationVersionId, authorAccountId: existing.authorAccountId, reportedAt: existing.reportedAt.toISOString(), idempotencyKey: existing.idempotencyKey, status: existing.status };
      }
      let revision = 1;
      if (input.correctsReportId) {
        const previous = await one<CompletionRow>(tx,
          `SELECT ${REPORT_FIELDS}
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
      const noteCiphertext=authorship?seal(note,practiceReportNoteAad(actor.workspaceId,occurrence.caseId,occurrence.responsibilityVersionId!,input.occurrenceId,reportId,actor.id,occurrence.subjectPersonId,authorship),this.keyring!):null;
      await tx.query(`INSERT INTO ls_practice.completion_reports
        (id,workspace_id,occurrence_id,author_account_id,status,revision,reported_at,idempotency_key,corrects_report_id,subject_person_id,authorship,note_ciphertext)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [reportId, actor.workspaceId, input.occurrenceId, actor.id, status, revision, now, input.idempotencyKey, input.correctsReportId ?? null,authorship?occurrence.subjectPersonId:null,authorship,noteCiphertext]);
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

  async list(actor: Actor, occurrenceId: OccurrenceId, ownOnly: true): Promise<OwnCompletionView[]>;
  async list(actor: Actor, occurrenceId: OccurrenceId, ownOnly?: false): Promise<CompletionView[]>;
  async list(actor: Actor, occurrenceId: OccurrenceId, ownOnly = false): Promise<Array<CompletionView | OwnCompletionView>> {
    return this.store.transaction(async tx => {
      const occurrence = await this.requireOccurrence(tx, actor, occurrenceId);
      const current = await freshActor(tx, actor, this.clock.now());
      const audience = await loadAudience(tx, actor.workspaceId, occurrence.caseId, occurrence.audienceId);
      if (!audience) throw new AppError("NOT_FOUND");
      audienceAccess(current, await loadCase(tx, actor.workspaceId, occurrence.caseId), await loadGuardians(tx, actor.workspaceId, occurrence.caseId), audience);
      const rows = await tx.query<CompletionRow>(
        `SELECT ${REPORT_FIELDS}
         FROM ls_practice.completion_reports WHERE workspace_id=$1 AND occurrence_id=$2
          AND ($3::uuid IS NULL OR author_account_id=$3) ORDER BY author_account_id,revision`, [actor.workspaceId, occurrenceId, ownOnly ? current.id : null]);
      return rows.map(row => ({ reportId: row.reportId, occurrenceId: row.occurrenceId, authorAccountId: row.authorAccountId, status: row.status, revision: row.revision, reportedAt: row.reportedAt.toISOString(), correctedReportId: row.correctsReportId,
        ...(row.authorship&&(current.id===row.authorAccountId||current.role==="practitioner")?{attribution:{subjectPersonId:row.subjectPersonId!,authorship:row.authorship,note:this.note(actor,occurrence,row)}}:{}),
        ...(ownOnly ? { idempotencyKey: row.idempotencyKey } : {}) }));
    });
  }

  private async requireOccurrence(tx: SqlSession, actor: Actor, occurrenceId: OccurrenceId): Promise<OccurrenceRow> {
    const row = await one<OccurrenceRow>(tx, OCCURRENCE_SELECT + " WHERE o.workspace_id=$1 AND o.id=$2 FOR UPDATE OF o", [actor.workspaceId, occurrenceId]);
    if (!row) throw new AppError("NOT_FOUND");
    return row;
  }
}
