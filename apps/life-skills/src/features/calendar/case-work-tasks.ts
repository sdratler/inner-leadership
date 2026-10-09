import { randomUUID } from 'node:crypto';
import { AppError } from '../../lib/errors.ts';
import { asId } from '../../lib/ids.ts';
import type { CalendarStore, TransactionContext } from './store.ts';
import type { CalendarMode } from './mode.ts';
import { shiftDay } from './time.ts';
import { internalTaskPath } from './validation.ts';
import { MAX_CALENDAR_TASKS } from '../contact-ops/core/limits.ts';

import {caseTaskTitle,isCaseTaskKind,type CaseTaskKind} from './case-work-copy.ts';
export type {CaseTaskKind} from './case-work-copy.ts';
export type CaseWorkSource={kind:CaseTaskKind;id:string;caseId:string;audienceId:string|null;linkId:string|null;linkDate:string|null;dueDate:string;active:boolean;batchId:string|null};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Closed-world records from authenticated server reads, never browser-supplied events. */
export function caseTaskSourcePath(row:CaseWorkSource,mode:CalendarMode):string{
 const query=new URLSearchParams({caseId:row.caseId,...(mode==='demo'?{mode}:{}),...(row.audienceId?{audienceId:row.audienceId}:{})});
 let route:string;
 switch(row.kind){
  case 'calendar_notice':query.set('date',row.linkDate??row.dueDate);query.set('view','agenda');route='calendar';break;
  case 'form_review':route='forms';break;
  case 'update_review':route='communications';break;
  case 'report_review':query.set('section','drafts');route='reports';break;
  case 'session_observations':return `/en/app/cases/${row.caseId}/sessions/${row.id}${mode==='demo'?'?mode=demo':''}`;
 }
 return `/en/app/${route}?${query}`;
}
function validateSources(rows:readonly CaseWorkSource[],mode:CalendarMode):void{
 if(rows.length>MAX_CALENDAR_TASKS)throw new AppError('UNAVAILABLE');
 const seen=new Set<string>();
 for(const row of rows){
  const key=`${row.kind}:${row.id}`;
  if(!isCaseTaskKind(row.kind)||!uuid.test(row.id)||!uuid.test(row.caseId)||
    row.audienceId!==null&&!uuid.test(row.audienceId)||row.linkId!==null&&!uuid.test(row.linkId)||
    typeof row.active!=='boolean'||typeof row.dueDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(row.dueDate)||
    (mode==='demo')!==Boolean(row.batchId)||row.batchId!==null&&!/^ls-owner-\d{8}$/.test(row.batchId)||seen.has(key))throw new AppError('UNAVAILABLE');
  try{if(shiftDay(row.dueDate,0)!==row.dueDate||row.linkDate!==null&&shiftDay(row.linkDate,0)!==row.linkDate)throw Error();}catch{throw new AppError('UNAVAILABLE');}
  if(!internalTaskPath(caseTaskSourcePath(row,mode)))throw new AppError('UNAVAILABLE');
  seen.add(key);
 }
}

/** Only lifecycle metadata enters Calendar. No form answers, messages, narrative,
 * observation scores, transcripts or provider/payment assertions are copied. */
export async function readCaseWorkSources(c:TransactionContext,mode:CalendarMode):Promise<CaseWorkSource[]>{
 const rows=await c.tx.query<CaseWorkSource>(`WITH sources AS (
  SELECT 'calendar_notice'::text AS kind,n.id,n.case_id,n.received_at AT TIME ZONE 'Asia/Jerusalem' AS due,
   NULL::uuid AS audience_id,n.appointment_id AS link_id,(a.starts_at AT TIME ZONE 'Asia/Jerusalem')::date AS link_date,n.state='pending' AS active
   FROM ls_calendar.notices n JOIN ls_calendar.appointments a ON a.workspace_id=n.workspace_id AND a.case_id=n.case_id AND a.id=n.appointment_id WHERE n.workspace_id=$1
  UNION ALL SELECT 'form_review',f.id,f.case_id,fs.submitted_at AT TIME ZONE 'Asia/Jerusalem',NULL::uuid,NULL::uuid,NULL::date,
   f.state='submitted' AND fs.state='submitted' FROM ls_forms.form_assignments f
   JOIN ls_forms.form_submissions fs ON fs.workspace_id=f.workspace_id AND fs.case_id=f.case_id AND fs.assignment_id=f.id
   WHERE f.workspace_id=$1
  UNION ALL SELECT 'update_review',u.id,u.case_id,u.submitted_at AT TIME ZONE 'Asia/Jerusalem',u.audience_id,NULL::uuid,NULL::date,
   u.review_state='new' FROM ls_updates.parent_reports u WHERE u.workspace_id=$1
  UNION ALL SELECT 'session_observations',s.id,s.case_id,a.ends_at AT TIME ZONE 'Asia/Jerusalem',NULL::uuid,s.appointment_id,NULL::date,
   s.state<>'archived' AND EXISTS(SELECT 1 FROM ls_attendance.records ar WHERE ar.workspace_id=s.workspace_id AND ar.appointment_id=s.appointment_id AND ar.attended)
    AND NOT EXISTS(SELECT 1 FROM ls_sessions.practitioner_observations o WHERE o.workspace_id=s.workspace_id AND o.case_id=s.case_id AND o.session_id=s.id)
   FROM ls_sessions.sessions s JOIN ls_calendar.appointments a ON a.workspace_id=s.workspace_id AND a.case_id=s.case_id AND a.id=s.appointment_id WHERE s.workspace_id=$1
  UNION ALL SELECT 'report_review',r.id,r.case_id,r.period_end::timestamp,r.audience_id,NULL::uuid,NULL::date,r.state='draft'
   FROM ls_progress.qualitative_reviews r WHERE r.workspace_id=$1
 ) SELECT s.kind,s.id::text AS id,s.case_id::text AS "caseId",s.audience_id::text AS "audienceId",s.link_id::text AS "linkId",s.link_date::text AS "linkDate",
  s.due::date::text AS "dueDate",(s.active AND cl.state<>'archived') AS active,d.batch_id AS "batchId"
 FROM sources s JOIN ls_cases.cases cl ON cl.workspace_id=$1 AND cl.id=s.case_id AND cl.practitioner_account_id=$2
 LEFT JOIN ls_demo.cases d ON d.workspace_id=cl.workspace_id AND d.case_id=cl.id
 WHERE (d.case_id IS NOT NULL)=$3 ORDER BY s.kind,s.id LIMIT $4`,[c.workspace,c.actor.id,mode==='demo',MAX_CALENDAR_TASKS+1]);
 validateSources(rows,mode);return rows;
}

export async function reconcileCaseWork(db:CalendarStore,c:TransactionContext,mode:CalendarMode,digest:(value:unknown)=>string){
 const rows=await readCaseWorkSources(c,mode),result={created:0,updated:0,resolved:0,unchanged:0};
 const values=rows.map(row=>({...row,digest:digest({workspace:c.workspace,kind:row.kind,id:row.id})}));
 const previous=await c.tx.query<{id:string;sourceDigest:string;sourceRevision:string;version:number}>(`SELECT id,source_digest AS "sourceDigest",source_revision AS "sourceRevision",version
  FROM ls_calendar.tasks WHERE workspace_id=$1 AND source_kind IN ('calendar_notice','form_review','update_review','session_observations','report_review')
  AND source_digest IN(SELECT jsonb_array_elements_text($2::jsonb))`,[c.workspace,JSON.stringify(values.map(row=>row.digest))]);
 const known=new Map(previous.map(row=>[row.sourceDigest,row]));
 const creates:Record<string,unknown>[]=[],changes:Record<string,unknown>[]=[],history:Record<string,unknown>[]=[];
 for(const row of values){
  const path=caseTaskSourcePath(row,mode),title=caseTaskTitle(row.kind,'en');
  const revision=digest({active:row.active,caseId:row.caseId,dueDate:row.dueDate,path,title});
  const old=known.get(row.digest);
  if(old?.sourceRevision===revision||!old&&!row.active){result.unchanged++;continue;}
  const id=old?.id??asId(randomUUID(),'task'),version=(old?.version??0)+1;
  const value={id,caseId:row.caseId,titleCiphertext:db.encrypt(c,'task-title',id,title),sourcePathCiphertext:db.encrypt(c,'task-source',id,path),dueDate:row.dueDate,
   kind:row.kind,digest:row.digest,revision,active:row.active,version:old?.version??0,batchId:row.batchId};
  if(old){changes.push(value);if(row.active)result.updated++;else result.resolved++;}else{creates.push(value);result.created++;}
  history.push({id:randomUUID(),taskId:id,version,action:old?row.active?'source_updated':'source_resolved':'created'});
 }
 if(creates.length){
  const inserted=await c.tx.query<{id:string}>(`INSERT INTO ls_calendar.tasks(workspace_id,id,created_by,case_id,title_ciphertext,source_path_ciphertext,due_date,state,source_kind,source_digest,source_revision,created_at,updated_at)
   SELECT $1,v.id,$2,v."caseId",v."titleCiphertext",v."sourcePathCiphertext",v."dueDate",'open',v.kind,v.digest,v.revision,$3,$3
   FROM jsonb_to_recordset($4::jsonb) AS v(id uuid,"caseId" uuid,"titleCiphertext" text,"sourcePathCiphertext" text,"dueDate" date,kind text,digest text,revision text) RETURNING id`,[c.workspace,c.actor.id,c.now,JSON.stringify(creates)]);
  if(inserted.length!==creates.length)throw new AppError('CONFLICT');
  const demo=creates.filter(row=>row.batchId!==null);
  if(demo.length)await c.tx.query(`INSERT INTO ls_demo.records(workspace_id,batch_id,entity_kind,entity_key,source_key,case_id)
   SELECT $1,v."batchId",'task',v.id::text,'case-task:'||v.digest,v."caseId" FROM jsonb_to_recordset($2::jsonb) AS v("batchId" text,id uuid,digest text,"caseId" uuid)`,[c.workspace,JSON.stringify(demo)]);
 }
 if(changes.length){
  const changed=await c.tx.query<{id:string}>(`UPDATE ls_calendar.tasks t SET title_ciphertext=v."titleCiphertext",source_path_ciphertext=v."sourcePathCiphertext",due_date=v."dueDate",
   state=CASE WHEN v.active THEN CASE WHEN t.state='in_progress' THEN 'in_progress' ELSE 'open' END ELSE 'done' END,
   snoozed_until=CASE WHEN v.active THEN t.snoozed_until ELSE NULL END,source_revision=v.revision,version=t.version+1,updated_at=$2
   FROM jsonb_to_recordset($3::jsonb) AS v(id uuid,version integer,"titleCiphertext" text,"sourcePathCiphertext" text,"dueDate" date,revision text,active boolean)
   WHERE t.workspace_id=$1 AND t.id=v.id AND t.version=v.version RETURNING t.id`,[c.workspace,c.now,JSON.stringify(changes)]);
  if(changed.length!==changes.length)throw new AppError('CONFLICT');
 }
 if(history.length)await c.tx.query(`INSERT INTO ls_calendar.task_history(workspace_id,id,task_id,version,action,actor_account_id,occurred_at)
  SELECT $1,v.id,v."taskId",v.version,v.action,$2,$3 FROM jsonb_to_recordset($4::jsonb) AS v(id uuid,"taskId" uuid,version integer,action text)`,[c.workspace,c.actor.id,c.now,JSON.stringify(history)]);
 return result;
}
