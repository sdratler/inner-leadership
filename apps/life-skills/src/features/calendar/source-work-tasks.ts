import {randomUUID} from 'node:crypto';
import {AppError} from '../../lib/errors.ts';
import type {CaseId} from '../../lib/ids.ts';
import type {CalendarStore,TransactionContext} from './store.ts';
import {internalTaskPath} from './validation.ts';
import {civilDate,shiftDay} from './time.ts';
import {MAX_CALENDAR_TASKS} from '../contact-ops/core/limits.ts';
import {isAdministrativeTaskKind,type AdministrativeTaskKind} from './administrative-work-copy.ts';

export type AdministrativeWorkSource={kind:AdministrativeTaskKind;sourceId:string;caseId:CaseId|null;title:string;sourcePath:string;dueDate:string|null;active:boolean;revisionFacts:unknown};
/** Same encrypted task store, workspace transaction and append-only history.
 * Callers supply bounded server-read metadata, never client event assertions.
 * A missing source row never resolves work. A null source date uses the first
 * internal observation's civil date (no invented provider timestamp/hour). */
export async function reconcileAdministrativeSources(db:CalendarStore,c:TransactionContext,rows:readonly AdministrativeWorkSource[],digest:(value:unknown)=>string){
 if(rows.length>MAX_CALENDAR_TASKS)throw new AppError('UNAVAILABLE');
 const seen=new Set<string>();
 const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
 for(const row of rows){
  const key=`${row.kind}:${row.sourceId}`;
  if(!isAdministrativeTaskKind(row.kind)||typeof row.sourceId!=='string'||!row.sourceId||row.sourceId.length>200||seen.has(key)||row.caseId!==null&&!uuid.test(row.caseId)||
   typeof row.active!=='boolean'||typeof row.title!=='string'||!row.title.trim()||row.title.length>140||/[\u0000-\u001f\u007f]/.test(row.title)||
   typeof row.sourcePath!=='string'||!internalTaskPath(row.sourcePath)||row.dueDate!==null&&!/^\d{4}-\d{2}-\d{2}$/.test(row.dueDate))throw new AppError('UNAVAILABLE');
  if(row.dueDate!==null){try{if(shiftDay(row.dueDate,0)!==row.dueDate)throw Error();}catch{throw new AppError('UNAVAILABLE');}}
  seen.add(key);
 }
 const caseIds=[...new Set(rows.map(row=>row.caseId).filter((id):id is CaseId=>id!==null))];
 const authorized=await c.tx.query<{id:CaseId}>(`SELECT cl.id FROM ls_cases.cases cl WHERE cl.workspace_id=$1 AND cl.id=ANY($2::uuid[]) AND cl.practitioner_account_id=$3
  AND NOT EXISTS(SELECT 1 FROM ls_demo.cases d WHERE d.workspace_id=cl.workspace_id AND d.case_id=cl.id)`,[c.workspace,caseIds,c.actor.id]);
 if(authorized.length!==caseIds.length)throw new AppError('NOT_FOUND');
 const values=rows.map(row=>({...row,digest:digest({workspace:c.workspace,kind:row.kind,id:row.sourceId})}));
 const previous=await c.tx.query<{id:string;caseId:CaseId|null;sourceDigest:string;sourceRevision:string;version:number;dueDate:string;owned:boolean}>(`SELECT t.id,t.case_id AS "caseId",t.source_digest AS "sourceDigest",t.source_revision AS "sourceRevision",t.version,t.due_date::text AS "dueDate",
  (t.case_id IS NULL OR EXISTS(SELECT 1 FROM ls_cases.cases cl WHERE cl.workspace_id=t.workspace_id AND cl.id=t.case_id AND cl.practitioner_account_id=$3)) AS owned
  FROM ls_calendar.tasks t WHERE t.workspace_id=$1 AND t.source_digest IN(SELECT jsonb_array_elements_text($2::jsonb))`,[c.workspace,JSON.stringify(values.map(row=>row.digest)),c.actor.id]);
 const known=new Map(previous.map(row=>[row.sourceDigest,row])),result={created:0,updated:0,resolved:0,unchanged:0};
 const creates:Record<string,unknown>[]=[],changes:Record<string,unknown>[]=[],history:Record<string,unknown>[]=[];
 for(const row of values){
  const old=known.get(row.digest);
  if(old&&!old.owned){result.unchanged++;continue;}
  const dueDate=row.dueDate??old?.dueDate??civilDate(c.now);
  const revision=digest({active:row.active,caseId:row.caseId,dueDate,title:row.title,path:row.sourcePath,facts:row.revisionFacts});
  if(old?.sourceRevision===revision||!old&&!row.active){result.unchanged++;continue;}
  const id=old?.id??randomUUID(),version=(old?.version??0)+1;
  const value={id,caseId:row.caseId,titleCiphertext:db.encrypt(c,'task-title',id,row.title),sourcePathCiphertext:db.encrypt(c,'task-source',id,row.sourcePath),dueDate,kind:row.kind,digest:row.digest,revision,active:row.active,version:old?.version??0};
  if(old){changes.push(value);if(row.active)result.updated++;else result.resolved++;}else{creates.push(value);result.created++;}
  history.push({id:randomUUID(),taskId:id,version,action:old?row.active?'source_updated':'source_resolved':'created'});
 }
 if(creates.length){
  const inserted=await c.tx.query<{id:string}>(`INSERT INTO ls_calendar.tasks(workspace_id,id,created_by,case_id,title_ciphertext,source_path_ciphertext,due_date,state,source_kind,source_digest,source_revision,created_at,updated_at)
   SELECT $1,v.id,$2,v."caseId",v."titleCiphertext",v."sourcePathCiphertext",v."dueDate",'open',v.kind,v.digest,v.revision,$3,$3
   FROM jsonb_to_recordset($4::jsonb) AS v(id uuid,"caseId" uuid,"titleCiphertext" text,"sourcePathCiphertext" text,"dueDate" date,kind text,digest text,revision text) RETURNING id`,[c.workspace,c.actor.id,c.now,JSON.stringify(creates)]);
  if(inserted.length!==creates.length)throw new AppError('CONFLICT');
 }
 if(changes.length){
  const changed=await c.tx.query<{id:string}>(`UPDATE ls_calendar.tasks t SET case_id=v."caseId",title_ciphertext=v."titleCiphertext",source_path_ciphertext=v."sourcePathCiphertext",due_date=v."dueDate",
   state=CASE WHEN v.active THEN CASE WHEN t.state='in_progress' THEN 'in_progress' ELSE 'open' END ELSE 'done' END,
   snoozed_until=CASE WHEN v.active THEN t.snoozed_until ELSE NULL END,source_revision=v.revision,version=t.version+1,updated_at=$2
   FROM jsonb_to_recordset($3::jsonb) AS v(id uuid,"caseId" uuid,version integer,"titleCiphertext" text,"sourcePathCiphertext" text,"dueDate" date,revision text,active boolean)
   WHERE t.workspace_id=$1 AND t.id=v.id AND t.version=v.version RETURNING t.id`,[c.workspace,c.now,JSON.stringify(changes)]);
  if(changed.length!==changes.length)throw new AppError('CONFLICT');
 }
 if(history.length)await c.tx.query(`INSERT INTO ls_calendar.task_history(workspace_id,id,task_id,version,action,actor_account_id,occurred_at)
  SELECT $1,v.id,v."taskId",v.version,v.action,$2,$3 FROM jsonb_to_recordset($4::jsonb) AS v(id uuid,"taskId" uuid,version integer,action text)`,[c.workspace,c.actor.id,c.now,JSON.stringify(history)]);
 return result;
}
