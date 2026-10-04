import {randomUUID} from 'node:crypto';
import {AppError} from '../../lib/errors.ts';
import {asId} from '../../lib/ids.ts';
import {one,type IdentityStore,type SqlSession} from '../identity/store.ts';
import {accountById,freshActor,lockWorkspace} from '../identity/data.ts';
import {defaultPreference,inQuietHours} from '../identity/preferences.ts';
import {loadAudience,loadCase,loadGuardians} from '../cases/data.ts';
import {audienceAccess} from '../cases/policy.ts';
import {demoAccountBatch,demoCaseBatch} from '../demo/provenance.ts';
import type {Actor,AccountId,AudienceId,CaseId,IdentityClock,NotificationChannel,NotificationPreference,WorkspaceId} from '../identity/types.ts';
export type ReminderReason='provider_not_configured'|'channel_not_verified'|'do_not_disturb'|'opted_out'|'completed'|'cancelled'|'stale_source'|'revoked'|'inactive'|'expired'|'demo_external_denied';
type Notice={id:string;workspaceId:WorkspaceId;caseId:CaseId;audienceId:AudienceId;recipientAccountId:AccountId;occurrenceId:string;sourceId:string;sourceVersionId:string;coordinationVersionId:string;channel:NotificationChannel;purpose:'self'|'support'|'remind_child';dueAt:Date;state:'queued'|'available'|'blocked'|'suppressed'|'expired';reason:ReminderReason|null;availableAt:Date|null;readAt:Date|null};
type PendingSource={caseId:CaseId;audienceId:AudienceId;occursOn:string;state:string;current:boolean;recipients:AccountId[];assignees:AccountId[];completionMode:string;completedBy:AccountId[]};
export type ReminderItem={id:string;caseId:CaseId;occursOn:string;dueAt:string;timezone:string;channel:NotificationChannel;purpose:Notice['purpose'];state:'available'|'blocked';reason:ReminderReason|null;readAt:string|null};
export type ReminderPage={items:ReminderItem[];nextCursor:string|null;morePending:boolean;externalDeliveryActive:false};
const SELECT=`SELECT id,workspace_id AS "workspaceId",case_id AS "caseId",audience_id AS "audienceId",recipient_account_id AS "recipientAccountId",
 occurrence_id AS "occurrenceId",source_id AS "sourceId",source_version_id AS "sourceVersionId",coordination_version_id AS "coordinationVersionId",
 channel,purpose,due_at AS "dueAt",state,reason,available_at AS "availableAt",read_at AS "readAt" FROM ls_notifications.notification_outbox`;
export const REMINDER_BATCH_LIMIT=25;
const PAGE_LIMIT=40;
function decodeCursor(value:string|null):{at:Date;id:string}|null{
 if(value===null)return null;
 try{if(value.length>160||!/^[A-Za-z0-9_-]+$/.test(value))throw Error();const data=JSON.parse(Buffer.from(value,'base64url').toString('utf8'));if(!Array.isArray(data)||data.length!==2||typeof data[0]!=='string'||new Date(data[0]).toISOString()!==data[0])throw Error();return{at:new Date(data[0]),id:asId(data[1],'notification')};}catch{throw new AppError('INVALID_REQUEST');}
}
/** One durable native source. No external adapter is activated or invoked here.
 * The installed scheduler/provider proof remains separate from this prepared processor. */
export class PracticeReminderService{
 constructor(private readonly store:IdentityStore,private readonly workspaceId:WorkspaceId,private readonly clock:IdentityClock){}
 private async source(tx:SqlSession,row:Notice):Promise<PendingSource|null>{
  return one<PendingSource>(tx,`SELECT a.case_id AS "caseId",a.audience_id AS "audienceId",o.occurs_on::text AS "occursOn",o.state,
   (a.state='published' AND v.state='published' AND a.active_version_id=v.id) AS current,
   c.reminder_candidate_account_ids AS recipients,c.assignee_account_ids AS assignees,c.completion_mode AS "completionMode",
   ARRAY(SELECT DISTINCT r.author_account_id FROM ls_practice.completion_reports r WHERE r.workspace_id=o.workspace_id AND r.occurrence_id=o.id) AS "completedBy"
   FROM ls_practice.practice_occurrences o
   JOIN ls_practice.practice_assignments a ON a.workspace_id=o.workspace_id AND a.id=o.assignment_id
   JOIN ls_practice.practice_assignment_versions v ON v.workspace_id=a.workspace_id AND v.assignment_id=a.id AND v.id=o.practice_version_id
   JOIN ls_practice.task_coordination_versions c ON c.workspace_id=o.workspace_id AND c.id=o.coordination_version_id
    AND c.assignment_id=a.id AND c.case_id=a.case_id AND c.audience_id=a.audience_id AND c.responsibility_version_id=v.id
   WHERE o.workspace_id=$1 AND o.id=$2 AND a.id=$3 AND v.id=$4 AND c.id=$5 AND o.occurs_at=$6 AND v.responsibility IS NOT NULL`,
   [this.workspaceId,row.occurrenceId,row.sourceId,row.sourceVersionId,row.coordinationVersionId,row.dueAt]);
 }
 private async eligibility(tx:SqlSession,row:Notice):Promise<{source:PendingSource;preference:NotificationPreference}|ReminderReason>{
  const source=await this.source(tx,row);
  if(!source||source.caseId!==row.caseId||source.audienceId!==row.audienceId)return 'stale_source';
  if(source.state==='cancelled')return 'cancelled';
  if(!source.current)return 'stale_source';
  if(source.state==='closed'||row.purpose==='self'&&source.completedBy.includes(row.recipientAccountId))return 'completed';
  if(!source.recipients.includes(row.recipientAccountId))return 'revoked';
  const account=await accountById(tx,this.workspaceId,row.recipientAccountId),item=await loadCase(tx,this.workspaceId,row.caseId),audience=await loadAudience(tx,this.workspaceId,row.caseId,row.audienceId);
  if(!account||account.state!=='active'||!item||item.state!=='active')return 'inactive';
  if(!audience?.published||audience.visibility==='private')return 'revoked';
  try{audienceAccess(account,item,await loadGuardians(tx,this.workspaceId,row.caseId),audience);}catch(error){if(error instanceof AppError&&error.code==='NOT_FOUND')return 'revoked';throw error;}
  const preference=await one<NotificationPreference>(tx,`SELECT event_type AS "eventType",channel,enabled,locale,timezone,quiet_start AS "quietStart",quiet_end AS "quietEnd"
   FROM ls_identity.preferences WHERE workspace_id=$1 AND account_id=$2 AND event_type='practice_due' AND channel=$3`,[this.workspaceId,account.id,row.channel])??defaultPreference('practice_due',row.channel,account.locale);
  if(!preference.enabled)return 'opted_out';
  return {source,preference};
 }
 private async change(tx:SqlSession,row:Notice,state:Notice['state'],reason:ReminderReason|null,now:Date,next=now){
  await tx.query(`UPDATE ls_notifications.notification_outbox SET state=$3,reason=$4,updated_at=$5,next_attempt_at=$6 WHERE workspace_id=$1 AND id=$2`,[this.workspaceId,row.id,state,reason,now,next]);
 }
 private async drain(tx:SqlSession,now:Date,target:AccountId|null){
  const rows=await tx.query<Notice>(SELECT+` WHERE workspace_id=$1 AND ($2::uuid IS NULL OR recipient_account_id=$2)
    AND state IN ('queued','blocked','available') AND due_at<=$3 AND next_attempt_at<=$3 ORDER BY next_attempt_at,id LIMIT 26 FOR UPDATE`,[this.workspaceId,target,now]);
  for(const row of rows.slice(0,REMINDER_BATCH_LIMIT)){
    const eligibility=await this.eligibility(tx,row);
    if(typeof eligibility==='string'){await this.change(tx,row,'suppressed',eligibility,now);continue;}
    if(row.state==='available'){await this.change(tx,row,'available',null,now,new Date(now.getTime()+300000));continue;}
   if(now.getTime()-row.dueAt.getTime()>3600000){await this.change(tx,row,'expired','expired',now);continue;}
   if(row.channel==='in_app'){
    // Receipt and state commit together; a lost HTTP result cannot create another notice.
    await tx.query(`INSERT INTO ls_notifications.message_deliveries(id,workspace_id,outbox_id,channel,provider,recorded_at)
     VALUES($1,$2,$3,'in_app','in_app',$4) ON CONFLICT(workspace_id,outbox_id) DO NOTHING`,[randomUUID(),this.workspaceId,row.id,now]);
     await tx.query(`UPDATE ls_notifications.notification_outbox SET state='available',reason=NULL,available_at=$3,attempts=1,updated_at=$3,next_attempt_at=$4 WHERE workspace_id=$1 AND id=$2`,[this.workspaceId,row.id,now,new Date(now.getTime()+300000)]);continue;
   }
   let reason:ReminderReason='provider_not_configured';
   const account=await accountById(tx,this.workspaceId,row.recipientAccountId);
   if(await demoAccountBatch(tx,this.workspaceId,row.recipientAccountId)||await demoCaseBatch(tx,this.workspaceId,row.caseId))reason='demo_external_denied';
    else if(inQuietHours(eligibility.preference,now)){await this.change(tx,row,'blocked','do_not_disturb',now,new Date(now.getTime()+300000));continue;}
   else if(row.channel==='email'&&!account?.emailVerifiedAt||row.channel==='whatsapp'&&!account?.phoneVerifiedAt||row.channel==='push'&&!await one(tx,`SELECT id FROM ls_identity.push_subscriptions WHERE workspace_id=$1 AND account_id=$2 AND revoked_at IS NULL AND payload_ciphertext IS NOT NULL LIMIT 1`,[this.workspaceId,row.recipientAccountId]))reason='channel_not_verified';
   await this.change(tx,row,'blocked',reason,now,new Date(now.getTime()+300000));
  }
  return rows.length>REMINDER_BATCH_LIMIT;
 }
 /** Trusted application-worker entry, workspace pinned by runtime. Not an HTTP
  * route, timer, new scheduler or proof that an installed worker runs it. */
 async processDue():Promise<{morePending:boolean;externalDeliveryActive:false}>{
  const now=this.clock.now();return this.store.transaction(async tx=>{await lockWorkspace(tx,this.workspaceId);return{morePending:await this.drain(tx,now,null),externalDeliveryActive:false};});
 }
 async list(actor:Actor,cursor:string|null=null):Promise<ReminderPage>{
  const after=decodeCursor(cursor),now=this.clock.now();if(actor.workspaceId!==this.workspaceId)throw new AppError('NOT_FOUND');
  return this.store.transaction(async tx=>{
   await lockWorkspace(tx,this.workspaceId);await freshActor(tx,actor,now);const morePending=await this.drain(tx,now,actor.id);
   const rows=await tx.query<Notice>(SELECT+` WHERE workspace_id=$1 AND recipient_account_id=$2 AND state IN ('available','blocked')
    AND ($3::timestamptz IS NULL OR (due_at,id)<($3::timestamptz,$4::uuid)) ORDER BY due_at DESC,id DESC LIMIT 41`,[this.workspaceId,actor.id,after?.at??null,after?.id??null]);
   const items:ReminderItem[]=[];
   for(const row of rows.slice(0,PAGE_LIMIT)){const eligible=await this.eligibility(tx,row);if(typeof eligible==='string'){await this.change(tx,row,'suppressed',eligible,now);continue;}items.push({id:row.id,caseId:row.caseId,occursOn:eligible.source.occursOn,dueAt:row.dueAt.toISOString(),timezone:eligible.preference.timezone,channel:row.channel,purpose:row.purpose,state:row.state as 'available'|'blocked',reason:row.reason,readAt:row.readAt?.toISOString()??null});}
   const last=rows[PAGE_LIMIT-1];return{items,nextCursor:rows.length>PAGE_LIMIT&&last?Buffer.from(JSON.stringify([last.dueAt.toISOString(),last.id])).toString('base64url'):null,morePending,externalDeliveryActive:false};
  });
 }
 async markRead(actor:Actor,id:string):Promise<{id:string;readAt:string}>{
  const noticeId=asId(id,'notification'),now=this.clock.now();if(actor.workspaceId!==this.workspaceId)throw new AppError('NOT_FOUND');
  return this.store.transaction(async tx=>{
   await lockWorkspace(tx,this.workspaceId);await freshActor(tx,actor,now);
   const row=await one<Notice>(tx,SELECT+` WHERE workspace_id=$1 AND id=$2 AND recipient_account_id=$3 AND channel='in_app' AND state='available' FOR UPDATE`,[this.workspaceId,noticeId,actor.id]);
   if(!row||typeof await this.eligibility(tx,row)==='string')throw new AppError('NOT_FOUND');
   const readAt=row.readAt??now;await tx.query(`UPDATE ls_notifications.notification_outbox SET read_at=$3,updated_at=$4 WHERE workspace_id=$1 AND id=$2`,[this.workspaceId,noticeId,readAt,now]);return{id:noticeId,readAt:readAt.toISOString()};
  });
 }
}
