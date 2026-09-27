import { createHash, randomUUID } from 'node:crypto';
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
import { demoRecordBatch } from '../demo/provenance.ts';

export type TaskId=Id<'task'>;
export type TaskInput=z.infer<typeof taskCreateSchema>;
export type InternalTask={
 id:TaskId;caseId:CaseId|null;title:string;note:string|null;sourcePath:string|null;sourceKind:'crm_followup'|null;
 dueDate:string;dueTime:string|null;state:'open'|'done';version:number;
 createdAt:string;updatedAt:string;
};
type TaskRow={id:string;caseId:CaseId|null;titleCiphertext:string;noteCiphertext:string|null;sourcePathCiphertext:string|null;sourceKind:'crm_followup'|null;
 dueDate:string;dueTime:string|null;state:'open'|'done';version:number;createdAt:Date;updatedAt:Date};
type SourceTaskRow=TaskRow&{sourceRevision:string};
const columns=`id,case_id AS "caseId",title_ciphertext AS "titleCiphertext",note_ciphertext AS "noteCiphertext",
 source_path_ciphertext AS "sourcePathCiphertext",to_jsonb(tasks)->>'source_kind' AS "sourceKind",due_date::text AS "dueDate",
 to_char(due_time,'HH24:MI') AS "dueTime",state,version,created_at AS "createdAt",updated_at AS "updatedAt"`;

/** Practitioner-only, internal work. No outbox, invoice, booking or provider call. */
export class InternalTaskService {
 constructor(readonly db:CalendarStore){}
 private view(c:TransactionContext,row:TaskRow):InternalTask {
  const id=asId(row.id,'task');
  return {id,caseId:row.caseId,title:this.db.decrypt(c,'task-title',id,row.titleCiphertext),
   note:row.noteCiphertext?this.db.decrypt(c,'task-note',id,row.noteCiphertext):null,
   sourcePath:row.sourcePathCiphertext?this.db.decrypt(c,'task-source',id,row.sourcePathCiphertext):null,
   sourceKind:row.sourceKind,
   dueDate:row.dueDate,dueTime:row.dueTime,state:row.state,version:row.version,
   createdAt:row.createdAt.toISOString(),updatedAt:row.updatedAt.toISOString()};
 }
 async list(actor:Actor,from:string,to:string,caseId:CaseId|null):Promise<InternalTask[]> {
  if(ms(to)<=ms(from)||ms(to)-ms(from)>63*86_400_000)throw new AppError('INVALID_REQUEST');
  const first=civilDate(from),last=civilDate(to);
  return this.db.read(actor,async c=>{
   requirePractitioner(c.actor);
   const rows=await c.tx.query<TaskRow>(`SELECT ${columns} FROM ls_calendar.tasks
    WHERE workspace_id=$1 AND due_date>=$2::date AND due_date<$3::date
      AND ($4::uuid IS NULL OR case_id=$4::uuid)
    ORDER BY due_date,due_time NULLS FIRST,id LIMIT 1001`,[c.workspace,first,last,caseId]);
   if(rows.length>1000)throw new AppError('UNAVAILABLE');
   return rows.map(row=>this.view(c,row));
  });
 }
 async create(actor:Actor,key:string,input:TaskInput):Promise<InternalTask> {
  return this.db.command(actor,'create_task',key,input,async c=>requirePractitioner(c.actor),async c=>{
   const id=asId(randomUUID(),'task');
   if(input.caseId)await this.db.scope(c,input.caseId);
   const rows=await c.tx.query<TaskRow>(`INSERT INTO ls_calendar.tasks
    (workspace_id,id,created_by,case_id,title_ciphertext,note_ciphertext,source_path_ciphertext,due_date,due_time,created_at,updated_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8::date,$9::time,$10,$10) RETURNING ${columns}`,[c.workspace,id,c.actor.id,input.caseId,
    this.db.encrypt(c,'task-title',id,input.title),input.note?this.db.encrypt(c,'task-note',id,input.note):null,
    input.sourcePath?this.db.encrypt(c,'task-source',id,input.sourcePath):null,input.dueDate,input.dueTime,c.now]);
   const row=rows[0];if(!row)throw new AppError('UNAVAILABLE');
   await c.tx.query(`INSERT INTO ls_calendar.task_history(workspace_id,id,task_id,version,action,actor_account_id,occurred_at)
    VALUES($1,$2,$3,1,'created',$4,$5)`,[c.workspace,randomUUID(),id,c.actor.id,c.now]);
   return this.view(c,row);
  });
 }
 async complete(actor:Actor,id:TaskId,key:string,expectedVersion:number):Promise<InternalTask> {
  return this.db.command(actor,'complete_task',key,{id,expectedVersion},async c=>requirePractitioner(c.actor),async c=>{
   const row=await one<TaskRow>(c.tx,`UPDATE ls_calendar.tasks SET state='done',version=version+1,updated_at=$4
    WHERE workspace_id=$1 AND id=$2 AND version=$3 AND state='open' RETURNING ${columns}`,
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
 /** Reconcile only rows read by the authenticated server from the existing CRM.
  * A missing/invalid row is never interpreted as a completed source action.
  * This is internal bookkeeping: it does not send, bill, book or publish. */
 async syncCrmFollowups(actor:Actor,rows:readonly FollowupSource[]):Promise<{created:number;updated:number;resolved:number;unchanged:number}> {
  if(rows.length>1000)throw new AppError('UNAVAILABLE');
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
   for(const row of rows){
    if(await demoRecordBatch(c.tx,c.workspace,'prospect',row.leadId)){result.unchanged++;continue;}
    const digest=createHash('sha256').update(`${c.workspace}:crm_followup:${row.leadId}`).digest('hex');
    const existing=await one<SourceTaskRow>(c.tx,`SELECT ${columns},source_revision AS "sourceRevision" FROM ls_calendar.tasks
     WHERE workspace_id=$1 AND source_kind='crm_followup' AND source_digest=$2`,[c.workspace,digest]);
    const dueDate=crmDueCivilDate(row.dueDate),title=row.nextAction?.trim()??'';
    const archived=/archive|do not contact/i.test(`${row.stage} ${row.outcome}`);
    // Invalid dates are not source resolution. Preserve the task and surface the
    // CRM row separately until its actual source data is repaired.
    if(row.dueDate?.trim()&&!dueDate){result.unchanged++;continue;}
    const active=Boolean(dueDate&&title&&!archived);
    const sourcePath=`/he/app/clients?section=prospects&leadId=${encodeURIComponent(row.leadId)}`;
    if(!internalTaskPath(sourcePath)){result.unchanged++;continue;}
    const clippedTitle=title.slice(0,140);
    const revision=createHash('sha256').update(JSON.stringify({dueDate:dueDate??'',title:clippedTitle,active,sourcePath})).digest('hex');
    if(!existing){
     if(!active){result.unchanged++;continue;}
     const id=asId(randomUUID(),'task');
     await c.tx.query(`INSERT INTO ls_calendar.tasks
      (workspace_id,id,created_by,case_id,title_ciphertext,note_ciphertext,source_path_ciphertext,due_date,due_time,state,source_kind,source_digest,source_revision,created_at,updated_at)
      VALUES($1,$2,$3,NULL,$4,NULL,$5,$6::date,NULL,'open','crm_followup',$7,$8,$9,$9)`,
      [c.workspace,id,c.actor.id,this.db.encrypt(c,'task-title',id,clippedTitle),this.db.encrypt(c,'task-source',id,sourcePath),dueDate,digest,revision,c.now]);
     await c.tx.query(`INSERT INTO ls_calendar.task_history(workspace_id,id,task_id,version,action,actor_account_id,occurred_at)
      VALUES($1,$2,$3,1,'created',$4,$5)`,[c.workspace,randomUUID(),id,c.actor.id,c.now]);
     result.created++;continue;
    }
    if(existing.sourceRevision===revision){result.unchanged++;continue;}
    if(!active){
     await c.tx.query(`UPDATE ls_calendar.tasks SET state='done',source_revision=$3,version=version+1,updated_at=$4
      WHERE workspace_id=$1 AND id=$2`,[c.workspace,existing.id,revision,c.now]);
     result.resolved++;
    }else{
     await c.tx.query(`UPDATE ls_calendar.tasks SET title_ciphertext=$3,source_path_ciphertext=$4,due_date=$5::date,
      state='open',source_revision=$6,version=version+1,updated_at=$7 WHERE workspace_id=$1 AND id=$2`,
      [c.workspace,existing.id,this.db.encrypt(c,'task-title',existing.id,clippedTitle),this.db.encrypt(c,'task-source',existing.id,sourcePath),dueDate,revision,c.now]);
     result.updated++;
    }
    await c.tx.query(`INSERT INTO ls_calendar.task_history(workspace_id,id,task_id,version,action,actor_account_id,occurred_at)
     VALUES($1,$2,$3,$4,$5,$6,$7)`,[c.workspace,randomUUID(),existing.id,existing.version+1,active?'source_updated':'source_resolved',c.actor.id,c.now]);
   }
   return result;
  });
 }
}
