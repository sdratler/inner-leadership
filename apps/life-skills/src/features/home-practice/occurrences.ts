import { AppError } from "../../lib/errors.ts";
import { loadAudience, loadCase, loadGuardians } from "../cases/data.ts";
import { audienceAccess } from "../cases/policy.ts";
import { freshActor } from "../identity/data.ts";
import type { IdentityStore } from "../identity/store.ts";
import type { AccountId, Actor, AudienceId, CaseId, IdentityClock } from "../identity/types.ts";
import { occurrenceRange } from "./occurrence-range.ts";
import type { CompletionView, PracticeOccurrencePage, PublishedPracticeVersion, ScheduledOccurrence } from "./types.ts";
import {unseal,type Keyring} from "../identity/crypto.ts";
import {practiceReportNoteAad} from "../checkins/service.ts";

interface OccurrenceRow extends ScheduledOccurrence {
  assigneeAccountIds: AccountId[];
  versionId: PublishedPracticeVersion["versionId"];
  reportId: CompletionView["reportId"] | null;
  reportStatus: CompletionView["status"] | null;
  revision: number | null;
  reportedAt: Date | null;
  correctedReportId: CompletionView["correctedReportId"];
  assistedParentAccountIds:AccountId[]|null;
  occursAtValue:Date|null;
  subjectPersonId:string|null;
  authorship:NonNullable<CompletionView["attribution"]>["authorship"]|null;
  noteCiphertext:string|null;
}

/** No accounts, occurrences or reports are created by this read path. */
export async function readPracticeOccurrences<Version extends { versionId: PublishedPracticeVersion["versionId"] }>(
  store: IdentityStore, clock: IdentityClock, actor: Actor, caseId: CaseId, audienceId: AudienceId,
  from: string, to: string,
  versionSelect: string, project: (row: Version) => PublishedPracticeVersion,keyring?:Keyring,
): Promise<PracticeOccurrencePage> {
  occurrenceRange(from, to);
  return store.transaction(async tx => {
    const current = await freshActor(tx, actor, clock.now());
    const audience = await loadAudience(tx, actor.workspaceId, caseId, audienceId);
    if (!audience || !audience.published || audience.visibility === "private") throw new AppError("NOT_FOUND");
    const item=await loadCase(tx,actor.workspaceId,caseId);if(!item)throw new AppError("NOT_FOUND");
    audienceAccess(current, item, await loadGuardians(tx, actor.workspaceId, caseId), audience);
    const rows = await tx.query<OccurrenceRow>(`SELECT o.id,o.assignment_id AS "assignmentId",o.practice_version_id AS "practiceVersionId",
      o.coordination_version_id AS "coordinationVersionId",o.occurs_on::text AS "occursOn",o.period,o.state,
      c.assignee_account_ids AS "assigneeAccountIds",o.practice_version_id AS "versionId",
      c.assisted_parent_account_ids AS "assistedParentAccountIds",o.occurs_at AS "occursAtValue",
      r.id AS "reportId",r.status AS "reportStatus",r.revision,r.reported_at AS "reportedAt",r.corrects_report_id AS "correctedReportId",
      r.subject_person_id AS "subjectPersonId",r.authorship,r.note_ciphertext AS "noteCiphertext"
      FROM ls_practice.practice_occurrences o
      JOIN ls_practice.practice_assignments a ON a.workspace_id=o.workspace_id AND a.id=o.assignment_id
      JOIN ls_practice.practice_assignment_versions v ON v.workspace_id=o.workspace_id AND v.assignment_id=a.id AND v.id=o.practice_version_id
      JOIN ls_practice.task_coordination_versions c ON c.workspace_id=o.workspace_id AND c.assignment_id=a.id AND c.id=o.coordination_version_id
      LEFT JOIN LATERAL (SELECT r.* FROM ls_practice.completion_reports r
        WHERE r.workspace_id=o.workspace_id AND r.occurrence_id=o.id AND r.author_account_id=$6
        ORDER BY r.revision DESC LIMIT 1) r ON true
      WHERE o.workspace_id=$1 AND a.case_id=$2 AND a.audience_id=$3 AND c.case_id=a.case_id AND c.audience_id=a.audience_id
        AND a.state='published' AND v.state='published' AND o.occurs_on>=$4::date AND o.occurs_on<$5::date
      ORDER BY o.occurs_on,CASE o.period WHEN 'morning' THEN 0 ELSE 1 END,o.id LIMIT 501`,
    [actor.workspaceId, caseId, audienceId, from, to, current.id]);
    const items = rows.slice(0, 500);
    const versions = items.length ? await tx.query<Version>(versionSelect + ` WHERE a.workspace_id=$1 AND a.case_id=$2
      AND a.audience_id=$3 AND v.state='published' AND v.id=ANY($4::uuid[])`,
    [actor.workspaceId, caseId, audienceId, [...new Set(items.map(row => row.versionId))]]) : [];
    const byId = new Map(versions.map(row => [row.versionId, row]));
    return { hasMore: rows.length > 500, items: items.map(row => {
      const version = byId.get(row.versionId);
      if (!version) throw new AppError("UNAVAILABLE");
      const published = project(version);
      // Explicit projection keeps encrypted fields and other assignees out of JSON.
      const practice: PublishedPracticeVersion = {
        workspaceId: published.workspaceId, caseId: published.caseId, assignmentId: published.assignmentId,
        versionId: published.versionId, version: published.version, audienceId: published.audienceId,
        goalId: published.goalId, commitmentId: published.commitmentId, templateKey: published.templateKey,
        templateVersion: published.templateVersion,
        instructions: audience.visibility === "family_title_completion" && current.role !== "practitioner" ? "" : published.instructions,
        startsOn: published.startsOn, endsOn: published.endsOn, publishedAt: published.publishedAt,
        immutableSnapshotDigest: published.immutableSnapshotDigest,
      };
      const ownAttribution=row.authorship&&row.reportId?(()=>{
        if(!keyring||!row.subjectPersonId||row.noteCiphertext===null)throw new AppError("UNAVAILABLE");
        return {subjectPersonId:row.subjectPersonId,authorship:row.authorship,note:unseal(row.noteCiphertext,practiceReportNoteAad(actor.workspaceId,caseId,row.practiceVersionId,row.id,row.reportId,current.id,row.subjectPersonId,row.authorship),keyring)};
      })():undefined;
      const assisted=current.role==="parent"&&row.assistedParentAccountIds?.includes(current.id)===true;
      return {
        occurrence: { id: row.id, assignmentId: row.assignmentId, practiceVersionId: row.practiceVersionId,
          coordinationVersionId: row.coordinationVersionId, occursOn: row.occursOn, period: row.period, state: row.state,...(row.occursAtValue?{occursAt:row.occursAtValue.toISOString()}:{}) },
        ...(published.responsibility?{schedule:{participant:published.responsibility.participant,caseKind:item.kind,localTime:published.responsibility.localTime,timezone:published.responsibility.timezone,timeOrigin:published.responsibility.timeOrigin}}:{}),
        ...(assisted?{assistanceModes:["together","parent_report"] as const}:{}),
        practice, canReport: current.role !== "practitioner" && (row.assigneeAccountIds.includes(current.id)||assisted) && row.state!=="cancelled" && (row.state === "open" || row.reportId !== null),
        ownReport: row.reportId && row.reportStatus && row.revision && row.reportedAt ? {
          reportId: row.reportId, occurrenceId: row.id, authorAccountId: current.id, status: row.reportStatus,
          revision: row.revision, reportedAt: row.reportedAt.toISOString(), correctedReportId: row.correctedReportId,
          ...(ownAttribution?{attribution:ownAttribution}:{}),
        } : null,
      };
    }) };
  });
}
