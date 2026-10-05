import { createHmac, randomUUID } from 'node:crypto';
import { AppError } from '../../lib/errors.ts';
import { asId, type Id, type CaseId } from '../../lib/ids.ts';
import type { Actor } from '../identity/types.ts';
import { requirePractitioner } from '../cases/policy.ts';
import { one } from '../identity/store.ts';
import { civilDate, ms } from './time.ts';
import type { CalendarStore, TransactionContext } from './store.ts';
import type { z } from 'zod';
import type { taskCreateSchema } from './validation.ts';
import { internalTaskPath } from './validation.ts';
import { crmDueCivilDate } from '../prospects/due-date.ts';
import type { FollowupSource } from './followups.ts';
import { MAX_CALENDAR_TASKS, MAX_OPERATIONAL_PROSPECTS } from '../contact-ops/core/limits.ts';
import {demoCaseBatch} from '../demo/provenance.ts';
import type {CalendarMode} from './mode.ts';
import {reconcileCaseWork,type CaseTaskKind} from './case-work-tasks.ts';
import {taskManageSchema} from './validation.ts';
import type {TaskState} from './task-state.ts';
import {prospectArchived,prospectContactSuppressed} from '../prospects/native-edit.ts';
import {reconcileIntakeWork} from './administrative-work-tasks.ts';
import type {AdministrativeTaskKind} from './administrative-work-copy.ts';
import {reconcileAdministrativeSources,type AdministrativeWorkSource} from './source-work-tasks.ts';

export type TaskId=Id<'task'>;
export type TaskInput=z.infer<typeof taskCreateSchema>;
export type InternalTask={
 id:TaskId;caseId:CaseId|null;title:string;note:string|null;sourcePath:string|null;sourceKind:'crm_followup'|CaseTaskKind|AdministrativeTaskKind|null;
 dueDate:string;dueTime:string|null;state:TaskState;version:number;snoozedUntil?:string|null;
 createdAt:string;updatedAt:string;
};
type TaskRow={id:string;caseId:CaseId|null;titleCiphertext:string;noteCiphertext:string|null;sourcePathCiphertext:string|null;sourceKind:'crm_followup'|CaseTaskKind|AdministrativeTaskKind|null;
 dueDate:string;dueTime:string|null;state:TaskState;version:number;snoozedUntil:string|null;createdAt:Date;updatedAt:Date};
type SourceTaskRow={id:string;sourceDigest:string;sourceRevision:string;version:number};
function candidateCaseId(value:unknown):CaseId|null{if(typeof value!=='string')return null;try{return asId(value,'case');}catch{return null;}}
const columns=`id,case_id AS "caseId",title_ciphertext AS "titleCiphertext",note_ciphertext AS "noteCiphertext",
 source_path_ciphertext AS "sourcePathCiphertext",to_jsonb(tasks)->>'source_kind' AS "sourceKind",due_date::text AS "dueDate",
 to_char(due_time,'HH24:MI') AS "dueTime",state,version,to_jsonb(tasks)->>'snoozed_until' AS "snoozedUntil",created_at AS "createdAt",updated_at AS "updatedAt"`;
// Include the case root as well as descendant markers, so old synthetic tasks
// cannot leak into live lists if they predate automatic task marking.
const syntheticTask=`(EXISTS(SELECT 1 FROM ls_demo.cases d WHERE d.workspace_id=tasks.workspace_id AND d.case_id=tasks.case_id)
 OR EXISTS(SELECT 1 FROM ls_demo.records d WHERE d.workspace_id=tasks.workspace_id AND d.entity_kind='task' AND d.entity_key=tasks.id::text))`;

/** Practitioner-only, internal work. No outbox, invoice, booking or provider call. */
export class InternalTaskService {
 constructor(readonly db:CalendarStore,readonly digestKey:Buffer){
  if(digestKey.length!==32)throw new AppError('UNAVAILABLE');
 }
 private sourceDigest(value:unknown):string {
  return createHmac('sha256',this.digestKey).update(JSON.stringify(['life-skills-task-source-v1',value])).digest('hex');
 }
 /** The server reads actual case-work lifecycle metadata under the same fresh
  * practitioner/workspace lock as reconciliation. Missing reads never resolve
  * work; marking a task Done never mutates its authoritative source. */
 async syncCaseWork(actor:Actor,mode:CalendarMode='live'){
  if(mode!=='live'&&mode!=='demo')throw new AppError('INVALID_REQUEST');
  return this.db.read(actor,async c=>{
   requirePractitioner(c.actor);
   return reconcileCaseWork(this.db,c,mode,value=>this.sourceDigest(value));
  });
 }
 async syncContentWork(actor:Actor,sources:readonly AdministrativeWorkSource[]){
  if(sources.some(row=>!['creative_approval','publishing_failure'].includes(row.kind)||row.caseId!==null))throw new AppError('INVALID_REQUEST');
  return this.db.read(actor,async c=>{requirePractitioner(c.actor);return reconcileAdministrativeSources(this.db,c,sources,value=>this.sourceDigest(value));});
 }
 private view(c:TransactionContext,row:TaskRow):InternalTask {
  const id=asId(row.id,'task');
  return {id,caseId:row.caseId,title:this.db.decrypt(c,'task-title',id,row.titleCiphertext),
   note:row.noteCiphertext?this.db.decrypt(c,'task-note',id,row.noteCiphertext):null,
   sourcePath:row.sourcePathCiphertext?this.db.decrypt(c,'task-source',id,row.sourcePathCiphertext):null,
   sourceKind:row.sourceKind,
   dueDate:row.dueDate,dueTime:row.dueTime,state:row.state,version:row.version,snoozedUntil:row.snoozedUntil,
   createdAt:row.createdAt.toISOString(),updatedAt:row.updatedAt.toISOString()};
 }
 async list(actor:Actor,from:string,to:string,caseId:CaseId|null,mode:CalendarMode='live'):Promise<InternalTask[]> {
  if(mode!=='live'&&mode!=='demo')throw new AppError('INVALID_REQUEST');
  if(ms(to)<=ms(from)||ms(to)-ms(from)>63*86_400_000)throw new AppError('INVALID_REQUEST');
  const first=civilDate(from),last=civilDate(to);
  return this.db.read(actor,async c=>{
   requirePractitioner(c.actor);
   if(caseId)await this.db.scope(c,caseId);
   const rows=await c.tx.query<TaskRow>(`SELECT ${columns} FROM ls_calendar.tasks
    WHERE workspace_id=$1 AND greatest(due_date,snoozed_until)>=$2::date AND greatest(due_date,snoozed_until)<$3::date
      AND ($4::uuid IS NULL OR case_id=$4::uuid)
      AND (case_id IS NULL OR EXISTS(SELECT 1 FROM ls_cases.cases authorized_case
       WHERE authorized_case.workspace_id=tasks.workspace_id AND authorized_case.id=tasks.case_id AND authorized_case.practitioner_account_id=$7))
      AND ${syntheticTask}=$6::boolean
    ORDER BY greatest(due_date,snoozed_until),due_time NULLS FIRST,id LIMIT $5`,[c.workspace,first,last,caseId,MAX_CALENDAR_TASKS+1,mode==='demo',c.actor.id]);
   if(rows.length>MAX_CALENDAR_TASKS)throw new AppError('UNAVAILABLE');
   return rows.map(row=>this.view(c,row));
  });
 }
 async create(actor:Actor,key:string,input:TaskInput):Promise<InternalTask> {
  const mode=input.mode??'live';if(mode!=='live'&&mode!=='demo')throw new AppError('INVALID_REQUEST');
  return this.db.command(actor,'create_task',key,input,async c=>{
   requirePractitioner(c.actor);
   if(input.caseId)await this.db.scope(c,input.caseId);
   const batch=input.caseId?await demoCaseBatch(c.tx,c.workspace,input.caseId):null;
   if((mode==='demo')!==Boolean(batch))throw new AppError('INVALID_REQUEST');
  },async c=>{
   const id=asId(randomUUID(),'task');
   if(input.caseId)await this.db.scope(c,input.caseId);
   const rows=await c.tx.query<TaskRow>(`INSERT INTO ls_calendar.tasks
    (workspace_id,id,created_by,case_id,title_ciphertext,note_ciphertext,source_path_ciphertext,due_date,due_time,created_at,updated_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8::date,$9::time,$10,$10) RETURNING ${columns}`,[c.workspace,id,c.actor.id,input.caseId,
    this.db.encrypt(c,'task-title',id,input.title),input.note?this.db.encrypt(c,'task-note',id,input.note):null,
    input.sourcePath?this.db.encrypt(c,'task-source',id,input.sourcePath):null,input.dueDate,input.dueTime,c.now]);
   const row=rows[0];if(!row)throw new AppError('UNAVAILABLE');
   if(mode==='demo'){
    const batch=await demoCaseBatch(c.tx,c.workspace,input.caseId!);
    if(!batch)throw new AppError('CONFLICT');
    await c.tx.query(`INSERT INTO ls_demo.records(workspace_id,batch_id,entity_kind,entity_key,source_key,case_id)
     VALUES($1,$2,'task',$3,$4,$5)`,[c.workspace,batch,id,`calendar-task:${id}`,input.caseId]);
   }
   await c.tx.query(`INSERT INTO ls_calendar.task_history(workspace_id,id,task_id,version,action,actor_account_id,occurred_at)
    VALUES($1,$2,$3,1,'created',$4,$5)`,[c.workspace,randomUUID(),id,c.actor.id,c.now]);
   return this.view(c,row);
  });
 }
 async complete(actor:Actor,id:TaskId,key:string,expectedVersion:number,mode:CalendarMode='live'):Promise<InternalTask> {
  if(mode!=='live'&&mode!=='demo')throw new AppError('INVALID_REQUEST');
  return this.db.command(actor,'complete_task',key,{id,expectedVersion,...(mode==='demo'?{mode}:{})},async c=>{
   requirePractitioner(c.actor);
   const row=await one<{id:string;caseId:CaseId|null}>(c.tx,`SELECT id,case_id AS "caseId" FROM ls_calendar.tasks WHERE workspace_id=$1 AND id=$2 AND ${syntheticTask}=$3::boolean`,[c.workspace,id,mode==='demo']);
   if(!row)throw new AppError('NOT_FOUND');if(row.caseId)await this.db.scope(c,row.caseId);
  },async c=>{
   const row=await one<TaskRow>(c.tx,`UPDATE ls_calendar.tasks SET state='done',snoozed_until=NULL,version=version+1,updated_at=$4
    WHERE workspace_id=$1 AND id=$2 AND version=$3 AND state IN ('open','in_progress') RETURNING ${columns}`,
    [c.workspace,id,expectedVersion,c.now]);
   if(!row){
    const exists=await one<{id:string}>(c.tx,'SELECT id FROM ls_calendar.tasks WHERE workspace_id=$1 AND id=$2',[c.workspace,id]);
    throw new AppError(exists?'CONFLICT':'NOT_FOUND');
   }
   await c.tx.query(`INSERT INTO ls_calendar.task_history(workspace_id,id,task_id,version,action,actor_account_id,occurred_at)
    VALUES($1,$2,$3,$4,'completed',$5,$6)`,[c.workspace,randomUUID(),id,row.version,c.actor.id,c.now]);
   return this.view(c,row);
 });
 }
 async get(actor:Actor,id:TaskId,mode:CalendarMode='live'):Promise<InternalTask>{
  if(mode!=='live'&&mode!=='demo')throw new AppError('INVALID_REQUEST');
  return this.db.read(actor,async c=>{
   requirePractitioner(c.actor);const row=await one<TaskRow>(c.tx,`SELECT ${columns} FROM ls_calendar.tasks WHERE workspace_id=$1 AND id=$2 AND ${syntheticTask}=$3::boolean`,[c.workspace,id,mode==='demo']);
   if(!row)throw new AppError('NOT_FOUND');if(row.caseId)await this.db.scope(c,row.caseId);return this.view(c,row);
  });
 }
 /** One optimistic, idempotent internal edit. Reauthorization precedes replay;
  * source keys, notes, source dates and external records are never modified. */
 async manage(actor:Actor,id:TaskId,key:string,input:z.infer<typeof taskManageSchema>):Promise<InternalTask>{
  const parsed=taskManageSchema.safeParse(input);if(!parsed.success)throw new AppError('INVALID_REQUEST');
  const body=parsed.data,mode=body.mode??'live';
  return this.db.command(actor,'manage_task',key,{id,...body},async c=>{
   requirePractitioner(c.actor);
   const row=await one<{id:string;caseId:CaseId|null}>(c.tx,`SELECT id,case_id AS "caseId" FROM ls_calendar.tasks WHERE workspace_id=$1 AND id=$2 AND ${syntheticTask}=$3::boolean`,[c.workspace,id,mode==='demo']);
   if(!row)throw new AppError('NOT_FOUND');if(row.caseId)await this.db.scope(c,row.caseId);
  },async c=>{
   if(body.snoozedUntil!==null&&body.snoozedUntil<civilDate(c.now))throw new AppError('INVALID_REQUEST');
   const row=await one<TaskRow>(c.tx,`UPDATE ls_calendar.tasks SET state=$4,snoozed_until=$5::date,version=version+1,updated_at=$6
    WHERE workspace_id=$1 AND id=$2 AND version=$3 RETURNING ${columns}`,[c.workspace,id,body.expectedVersion,body.state,body.snoozedUntil,c.now]);
   if(!row){const exists=await one<{id:string}>(c.tx,'SELECT id FROM ls_calendar.tasks WHERE workspace_id=$1 AND id=$2',[c.workspace,id]);throw new AppError(exists?'CONFLICT':'NOT_FOUND');}
   await c.tx.query(`INSERT INTO ls_calendar.task_history(workspace_id,id,task_id,version,action,actor_account_id,occurred_at,state_value,snoozed_until)
    VALUES($1,$2,$3,$4,'managed',$5,$6,$7,$8::date)`,[c.workspace,randomUUID(),id,row.version,c.actor.id,c.now,row.state,row.snoozedUntil]);
   return this.view(c,row);
  });
 }
 /** Reconcile only rows read by the authenticated server from the existing CRM.
  * A missing/invalid row is never interpreted as a completed source action.
  * This is internal bookkeeping: it does not send, bill, book or publish. */
 async syncCrmFollowups(actor:Actor,rows:readonly FollowupSource[]):Promise<{created:number;updated:number;resolved:number;unchanged:number}> {
  if(rows.length>MAX_OPERATIONAL_PROSPECTS)throw new AppError('UNAVAILABLE');
  const seen=new Set<string>();
  for(const row of rows){
   if(typeof row.leadId!=='string'||typeof row.dueDate!=='string'||typeof row.nextAction!=='string'||
    typeof row.stage!=='string'||typeof row.outcome!=='string'||
    !/^LS-(?:LEAD|WAPI)-[A-Za-z0-9_-]+$/.test(row.leadId)||seen.has(row.leadId))throw new AppError('UNAVAILABLE');
   seen.add(row.leadId);
  }
  return this.db.read(actor,async c=>{
   requirePractitioner(c.actor);
   const result={created:0,updated:0,resolved:0,unchanged:0};
   // Load every authorization/provenance/source fact in sets before mutating.
   // CalendarStore holds the workspace lock; no SQL query scales per lead.
   // The production identity adapter deliberately admits JS arrays only for
   // validated UUID casts. Bind text sets as JSON, not raw arrays or SQL text.
   const demoRows=await c.tx.query<{leadId:string}>(`SELECT entity_key AS "leadId" FROM ls_demo.records
    WHERE workspace_id=$1 AND entity_kind='prospect' AND entity_key IN (SELECT jsonb_array_elements_text($2::jsonb))`,
    [c.workspace,JSON.stringify(rows.map(row=>row.leadId))]);
   const demoLeads=new Set(demoRows.map(row=>row.leadId));
   const caseIds=[...new Set(rows.map(row=>candidateCaseId(row.caseId)).filter((id):id is CaseId=>id!==null))];
   const caseRows=await c.tx.query<{id:string;ownerId:string;demoBatchId:string|null}>(`SELECT c.id,
     c.practitioner_account_id AS "ownerId",d.batch_id AS "demoBatchId"
    FROM ls_cases.cases c LEFT JOIN ls_demo.cases d ON d.workspace_id=c.workspace_id AND d.case_id=c.id
    WHERE c.workspace_id=$1 AND c.id=ANY($2::uuid[])`,[c.workspace,caseIds]);
   const validCases=new Map(caseRows.map(row=>[row.id,row]));
   const digests=rows.map(row=>this.sourceDigest({workspace:c.workspace,kind:'crm_followup',leadId:row.leadId}));
   const sourceRows=await c.tx.query<SourceTaskRow>(`SELECT id,source_digest AS "sourceDigest",
    source_revision AS "sourceRevision",version FROM ls_calendar.tasks
    WHERE workspace_id=$1 AND source_kind='crm_followup' AND source_digest IN (SELECT jsonb_array_elements_text($2::jsonb))`,
    [c.workspace,JSON.stringify(digests)]);
   const existingByDigest=new Map(sourceRows.map(row=>[row.sourceDigest,row]));
   const creates:{id:string;caseId:CaseId|null;titleCiphertext:string;sourcePathCiphertext:string;dueDate:string;digest:string;revision:string}[]=[];
   const updates:{id:string;version:number;caseId:CaseId|null;titleCiphertext:string;sourcePathCiphertext:string;dueDate:string;revision:string}[]=[];
   const resolves:{id:string;version:number;revision:string}[]=[];
   const history:{id:string;taskId:string;version:number;action:'created'|'source_updated'|'source_resolved'}[]=[];
   for(let index=0;index<rows.length;index++){
    const row=rows[index]!,digest=digests[index]!;
    if(demoLeads.has(row.leadId)){result.unchanged++;continue;}
    const existing=existingByDigest.get(digest);
    const dueDate=crmDueCivilDate(row.dueDate),title=row.nextAction?.trim()??'';
    const archived=prospectArchived(row)||prospectContactSuppressed(row);
    // Invalid dates are not source resolution. Preserve the task and surface the
    // CRM row separately until its actual source data is repaired.
    if(!archived&&row.dueDate?.trim()&&!dueDate){result.unchanged++;continue;}
    const active=Boolean(dueDate&&title&&!archived);
    const sourcePath=`/he/app/clients?section=prospects&leadId=${encodeURIComponent(row.leadId)}`;
    if(!internalTaskPath(sourcePath)){result.unchanged++;continue;}
    const candidate=candidateCaseId(row.caseId);
    const matched=candidate?validCases.get(candidate):null;
    // A valid case assigned to someone else is not a stale CRM reference.
    // Never clear or take over its link during this practitioner's sync.
    if(matched&&(matched.ownerId!==c.actor.id||matched.demoBatchId)){result.unchanged++;continue;}
    const linkedCaseId=matched?candidate:null;
    // The previous CRM card named the person. Keep that identity visible in the
    // encrypted task title so identical actions remain distinguishable.
    const person=(typeof row.name==='string'&&row.name.trim()?row.name.trim():row.leadId).slice(0,64);
    const clippedTitle=`${person} · ${title}`.slice(0,140);
    const revision=this.sourceDigest({dueDate:dueDate??'',title:clippedTitle,active,sourcePath,caseId:linkedCaseId});
    if(!existing){
     if(!active){result.unchanged++;continue;}
     const id=asId(randomUUID(),'task');
     creates.push({id,caseId:linkedCaseId,titleCiphertext:this.db.encrypt(c,'task-title',id,clippedTitle),
      sourcePathCiphertext:this.db.encrypt(c,'task-source',id,sourcePath),dueDate:dueDate!,digest,revision});
     history.push({id:randomUUID(),taskId:id,version:1,action:'created'});
     result.created++;continue;
    }
    if(existing.sourceRevision===revision){result.unchanged++;continue;}
    if(!active){
     resolves.push({id:existing.id,version:existing.version,revision});
     result.resolved++;
    }else{
     updates.push({id:existing.id,version:existing.version,caseId:linkedCaseId,
      titleCiphertext:this.db.encrypt(c,'task-title',existing.id,clippedTitle),
      sourcePathCiphertext:this.db.encrypt(c,'task-source',existing.id,sourcePath),dueDate:dueDate!,revision});
     result.updated++;
    }
    history.push({id:randomUUID(),taskId:existing.id,version:existing.version+1,
     action:active?'source_updated':'source_resolved'});
   }
   if(creates.length){
    const inserted=await c.tx.query<{id:string}>(`INSERT INTO ls_calendar.tasks
     (workspace_id,id,created_by,case_id,title_ciphertext,note_ciphertext,source_path_ciphertext,due_date,due_time,state,source_kind,source_digest,source_revision,created_at,updated_at)
     SELECT $1,v.id,$2,v."caseId",v."titleCiphertext",NULL,v."sourcePathCiphertext",v."dueDate",NULL,
      'open','crm_followup',v.digest,v.revision,$3,$3 FROM jsonb_to_recordset($4::jsonb)
      AS v(id uuid,"caseId" uuid,"titleCiphertext" text,"sourcePathCiphertext" text,"dueDate" date,digest text,revision text)
     RETURNING id`,[c.workspace,c.actor.id,c.now,JSON.stringify(creates)]);
    if(inserted.length!==creates.length)throw new AppError('CONFLICT');
   }
   if(updates.length){
    const changed=await c.tx.query<{id:string}>(`UPDATE ls_calendar.tasks t SET
     title_ciphertext=v."titleCiphertext",source_path_ciphertext=v."sourcePathCiphertext",due_date=v."dueDate",
     case_id=v."caseId",state=CASE WHEN t.state='in_progress' THEN 'in_progress' ELSE 'open' END,source_revision=v.revision,version=t.version+1,updated_at=$2
     FROM jsonb_to_recordset($3::jsonb) AS v(id uuid,version integer,"caseId" uuid,
      "titleCiphertext" text,"sourcePathCiphertext" text,"dueDate" date,revision text)
     WHERE t.workspace_id=$1 AND t.id=v.id AND t.version=v.version RETURNING t.id`,
     [c.workspace,c.now,JSON.stringify(updates)]);
    if(changed.length!==updates.length)throw new AppError('CONFLICT');
   }
   if(resolves.length){
    const changed=await c.tx.query<{id:string}>(`UPDATE ls_calendar.tasks t SET
     state='done',snoozed_until=NULL,source_revision=v.revision,version=t.version+1,updated_at=$2
     FROM jsonb_to_recordset($3::jsonb) AS v(id uuid,version integer,revision text)
     WHERE t.workspace_id=$1 AND t.id=v.id AND t.version=v.version RETURNING t.id`,
     [c.workspace,c.now,JSON.stringify(resolves)]);
    if(changed.length!==resolves.length)throw new AppError('CONFLICT');
   }
   if(history.length)await c.tx.query(`INSERT INTO ls_calendar.task_history
    (workspace_id,id,task_id,version,action,actor_account_id,occurred_at)
    SELECT $1,v.id,v."taskId",v.version,v.action,$2,$3 FROM jsonb_to_recordset($4::jsonb)
     AS v(id uuid,"taskId" uuid,version integer,action text)`,
    [c.workspace,c.actor.id,c.now,JSON.stringify(history)]);
   const intake=await reconcileIntakeWork(this.db,c,rows,value=>this.sourceDigest(value));
   return {created:result.created+intake.created,updated:result.updated+intake.updated,resolved:result.resolved+intake.resolved,unchanged:result.unchanged+intake.unchanged};
  });
 }
}
