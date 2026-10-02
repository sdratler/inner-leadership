import {randomUUID} from 'node:crypto';
import {AppError} from '../../lib/errors.ts';
import {one,type SqlSession} from '../identity/store.ts';
import {notificationChannels,type WorkspaceId} from '../identity/types.ts';
import type {OccurrenceId} from '../identity/interfaces.ts';
type FrozenNotice={caseId:string;audienceId:string;sourceId:string;sourceVersionId:string;coordinationVersionId:string;dueAt:Date;recipients:string[];assignees:string[];routing:Array<{accountId:string;purpose:'self'|'support'|'remind_child'}>};
/** Called inside the retained scheduling transaction. Never scans history, reads
 * contact values, sends, grants access, or gives a legacy window an invented clock. */
export async function enqueuePracticeReminder(tx:SqlSession,workspaceId:WorkspaceId,occurrenceId:OccurrenceId,now:Date):Promise<void>{
 const source=await one<FrozenNotice>(tx,`SELECT a.case_id AS "caseId",a.audience_id AS "audienceId",a.id AS "sourceId",
  v.id AS "sourceVersionId",c.id AS "coordinationVersionId",o.occurs_at AS "dueAt",
  c.reminder_candidate_account_ids AS recipients,c.assignee_account_ids AS assignees,v.responsibility->'reminderRecipients' AS routing
  FROM ls_practice.practice_occurrences o
  JOIN ls_practice.practice_assignments a ON a.workspace_id=o.workspace_id AND a.id=o.assignment_id
  JOIN ls_practice.practice_assignment_versions v ON v.workspace_id=a.workspace_id AND v.assignment_id=a.id AND v.id=o.practice_version_id
  JOIN ls_practice.task_coordination_versions c ON c.workspace_id=o.workspace_id AND c.id=o.coordination_version_id
   AND c.assignment_id=a.id AND c.case_id=a.case_id AND c.audience_id=a.audience_id AND c.responsibility_version_id=v.id
  WHERE o.workspace_id=$1 AND o.id=$2 AND o.occurs_at IS NOT NULL AND v.responsibility IS NOT NULL`,[workspaceId,occurrenceId]);
 if(!source||!Array.isArray(source.recipients)||source.recipients.length>3||!Array.isArray(source.routing))throw new AppError('UNAVAILABLE');
 for(const recipient of source.recipients){
  const purpose=source.routing.find(row=>row.accountId===recipient)?.purpose??(source.assignees.includes(recipient)?'self':null);
  if(!purpose)throw new AppError('UNAVAILABLE');
  for(const channel of notificationChannels)await tx.query(`INSERT INTO ls_notifications.notification_outbox
   (id,workspace_id,case_id,audience_id,occurrence_id,recipient_account_id,source_id,source_version_id,coordination_version_id,
    message_key,purpose,channel,due_at,idempotency_key,state,next_attempt_at,created_at,updated_at)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'practice_due',$10,$11,$12,$13,'queued',$12,$14,$14)
   ON CONFLICT(workspace_id,occurrence_id,recipient_account_id,channel) DO NOTHING`,
   [randomUUID(),workspaceId,source.caseId,source.audienceId,occurrenceId,recipient,source.sourceId,source.sourceVersionId,source.coordinationVersionId,purpose,channel,source.dueAt,`practice_due:${occurrenceId}:${recipient}:${channel}`,now]);
 }
}
