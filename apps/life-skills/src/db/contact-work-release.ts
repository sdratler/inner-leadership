import {createHash} from 'node:crypto';
import {planMigrations,type AppliedMigration,type Migration} from './migration-plan.ts';

export const CONTACT_WORK_MIGRATIONS=Object.freeze([
 {name:'0119_ls_case_work_tasks.sql',sha256:'5e97f59f4b9caa07db49a6ce0549a49e25ee6a48f893ace72873038ffe034d8b'},
 {name:'0120_ls_task_workflow.sql',sha256:'f099a103f215b066417a03031d6df8ede3907238ddad3bbb2f7f154d8f6b6025'},
 {name:'0121_ls_administrative_tasks.sql',sha256:'303f8bcd33faf0c45b6a2b8c849c30eb3005fa03f5c0b84af615f8b7d7300c16'},
 {name:'0122_ls_call_activity_links.sql',sha256:'5472787029d825b464fdb0712888d60e310a666691f2c59e1a648e2223d088ff'},
 {name:'0123_ls_lead_commands.sql',sha256:'8af72dc80feda1487885907efdc1e632b4521758cc62cff092fc374986e66c30'},
]);
export const CONTACT_WORK_BASELINE={name:'0118_ls_contact_delta_history.sql',sha256:'89124785efc166f1f4aa1390f814798c2b63b71a874e37b4da10e11a7c0a202f'} as const;

export type ContactWorkStage=0|1|2|3|4|5;
export type ContactWorkSnapshot={
 taskColumns:number;taskConstraints:number;sourceKinds:string[];stateKinds:string[];historyActions:string[];
 workflowColumns:boolean;workflowConstraints:boolean;effectiveDueIndex:boolean;taskHistoryImmutable:boolean;taskPermissions:boolean;
 callLinksAbsent:boolean;callLinksSchema:boolean;callLinksForeignKeys:boolean;callLinksImmutable:boolean;callLinksPermissions:boolean;callLinksReferencesSound:boolean;
 leadCommandsAbsent:boolean;leadCommandsSchema:boolean;leadCommandsForeignKeys:boolean;leadCommandsImmutable:boolean;leadCommandsPermissions:boolean;leadCommandsReferencesSound:boolean;
};
export interface ContactWorkQuery{query<R extends object=Record<string,unknown>>(sql:string,values?:readonly unknown[]):Promise<{rows:R[]}>}

const sourceStages=[
 ['crm_followup'],
 ['calendar_notice','crm_followup','form_review','report_review','session_observations','update_review'],
 ['booking_followup','calendar_notice','creative_approval','crm_followup','form_review','intake_followup','publishing_failure','report_review','session_observations','update_review'],
] as const;
const same=(a:readonly string[],b:readonly string[])=>JSON.stringify([...a].sort())===JSON.stringify([...b].sort());
const literals=(value:unknown,allowed:ReadonlySet<string>)=>typeof value==='string'?[...value.matchAll(/'([^']+)'(?:::\w+)?/g)].map(match=>match[1]!).filter(item=>allowed.has(item)).sort():[];
const sourceValues=new Set(sourceStages.flat()),stateValues=new Set(['open','in_progress','done']),actionValues=new Set(['created','completed','source_updated','source_resolved','managed']);

export function classifyContactWork(snapshot:ContactWorkSnapshot):ContactWorkStage{
 const workflow=snapshot.workflowColumns&&snapshot.workflowConstraints&&snapshot.effectiveDueIndex&&snapshot.taskHistoryImmutable&&snapshot.taskPermissions&&snapshot.taskColumns===26&&snapshot.taskConstraints===16;
 const baseline=!snapshot.workflowColumns&&!snapshot.workflowConstraints&&!snapshot.effectiveDueIndex&&snapshot.taskHistoryImmutable&&snapshot.taskPermissions&&snapshot.taskColumns===23&&snapshot.taskConstraints===14;
 const source=same(snapshot.sourceKinds,sourceStages[0])?0:same(snapshot.sourceKinds,sourceStages[1])?1:same(snapshot.sourceKinds,sourceStages[2])?2:-1;
 const baseState=same(snapshot.stateKinds,['open','done'])&&same(snapshot.historyActions,['created','completed','source_updated','source_resolved']);
 const managedState=same(snapshot.stateKinds,['open','in_progress','done'])&&same(snapshot.historyActions,['created','completed','source_updated','source_resolved','managed']);
 const call=snapshot.callLinksSchema&&snapshot.callLinksForeignKeys&&snapshot.callLinksImmutable&&snapshot.callLinksPermissions&&snapshot.callLinksReferencesSound;
 const lead=snapshot.leadCommandsSchema&&snapshot.leadCommandsForeignKeys&&snapshot.leadCommandsImmutable&&snapshot.leadCommandsPermissions&&snapshot.leadCommandsReferencesSound;
 if(baseline&&source===0&&baseState&&snapshot.callLinksAbsent&&snapshot.leadCommandsAbsent)return 0;
 if(baseline&&source===1&&baseState&&snapshot.callLinksAbsent&&snapshot.leadCommandsAbsent)return 1;
 if(workflow&&source===1&&managedState&&snapshot.callLinksAbsent&&snapshot.leadCommandsAbsent)return 2;
 if(workflow&&source===2&&managedState&&snapshot.callLinksAbsent&&snapshot.leadCommandsAbsent)return 3;
 if(workflow&&source===2&&managedState&&call&&!snapshot.callLinksAbsent&&snapshot.leadCommandsAbsent)return 4;
 if(workflow&&source===2&&managedState&&call&&!snapshot.callLinksAbsent&&lead&&!snapshot.leadCommandsAbsent)return 5;
 throw new Error('CONTACT_WORK_SCHEMA_STATE_CONFLICT');
}

export function contactWorkPlan(files:readonly Migration[],history:readonly AppliedMigration[],snapshot:ContactWorkSnapshot):{stage:ContactWorkStage;pending:readonly Migration[]} {
 const baseline=files.findIndex(file=>file.name===CONTACT_WORK_BASELINE.name&&file.checksum===CONTACT_WORK_BASELINE.sha256);
 if(baseline<0)throw new Error('CONTACT_WORK_BASELINE_MISSING');
 const suffix=files.slice(baseline+1);
 if(suffix.length!==CONTACT_WORK_MIGRATIONS.length||suffix.some((file,index)=>file.name!==CONTACT_WORK_MIGRATIONS[index]?.name||file.checksum!==CONTACT_WORK_MIGRATIONS[index]?.sha256))throw new Error('CONTACT_WORK_MIGRATION_SET_MISMATCH');
 const pending=planMigrations(files,history),stage=classifyContactWork(snapshot);
 const applied=history.length-(baseline+1);
 if(applied!==stage||pending.length!==CONTACT_WORK_MIGRATIONS.length-stage||pending.some((file,index)=>file.name!==CONTACT_WORK_MIGRATIONS[stage+index]?.name))throw new Error('CONTACT_WORK_LEDGER_STATE_CONFLICT');
 return {stage,pending};
}

export async function readContactWorkSnapshot(db:ContactWorkQuery):Promise<ContactWorkSnapshot>{
 const task=await db.query<{columns:string[];constraints:number;source:string|null;state:string|null;actions:string|null;workflow:boolean;effective:boolean;immutable:boolean;permissions:boolean}>(`SELECT
  (SELECT array_agg(c.relname||'.'||a.attname ORDER BY c.relname,a.attnum) FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='ls_calendar' AND c.relname IN ('tasks','task_history') AND a.attnum>0 AND NOT a.attisdropped) AS columns,
  (SELECT count(*)::int FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='ls_calendar' AND c.relname IN ('tasks','task_history') AND k.contype<>'n') AS constraints,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid=to_regclass('ls_calendar.tasks') AND conname='tasks_source_tuple_check') AS source,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid=to_regclass('ls_calendar.tasks') AND conname='tasks_state_check') AS state,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid=to_regclass('ls_calendar.task_history') AND conname='task_history_action_check') AS actions,
  EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('ls_calendar.tasks') AND attname='snoozed_until' AND atttypid='date'::regtype AND NOT attnotnull AND NOT attisdropped)
   AND EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('ls_calendar.task_history') AND attname='state_value' AND atttypid='text'::regtype AND NOT attnotnull AND NOT attisdropped)
   AND EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('ls_calendar.task_history') AND attname='snoozed_until' AND atttypid='date'::regtype AND NOT attnotnull AND NOT attisdropped) AS workflow,
  EXISTS(SELECT 1 FROM pg_index WHERE indexrelid=to_regclass('ls_calendar.tasks_by_effective_due') AND indisvalid AND indisready AND indislive) AS effective,
  EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('ls_calendar.task_history') AND tgname='task_history_immutable' AND NOT tgisinternal AND tgenabled IN ('O','A') AND tgfoid=to_regprocedure('ls_calendar.append_only()')) AS immutable,
  NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace,LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl WHERE n.nspname='ls_calendar' AND c.relname IN ('tasks','task_history') AND acl.grantee<>c.relowner) AS permissions`);
 const tables=await db.query<{call_absent:boolean;call_schema:boolean;call_fks:boolean;call_immutable:boolean;call_permissions:boolean;call_refs:boolean;lead_absent:boolean;lead_schema:boolean;lead_fks:boolean;lead_immutable:boolean;lead_permissions:boolean;lead_refs:boolean}>(`SELECT
  to_regclass('ls_contact_ops.call_activity_links') IS NULL AS call_absent,
  (SELECT count(*)=4 FROM pg_attribute WHERE attrelid=to_regclass('ls_contact_ops.call_activity_links') AND attnum>0 AND NOT attisdropped) AND (SELECT count(*)=3 FROM pg_constraint WHERE conrelid=to_regclass('ls_contact_ops.call_activity_links') AND contype<>'n') AND EXISTS(SELECT 1 FROM pg_index WHERE indexrelid=to_regclass('ls_contact_ops.call_activity_by_person') AND indisvalid AND indisready AND indislive) AS call_schema,
  (SELECT count(*)=2 AND bool_and(convalidated) FROM pg_constraint WHERE conrelid=to_regclass('ls_contact_ops.call_activity_links') AND contype='f') AS call_fks,
  (SELECT count(*)=2 AND bool_and(tgfoid=to_regprocedure('ls_contact_ops.deny_acquisition_receipt_mutation()') AND tgenabled IN ('O','A')) FROM pg_trigger WHERE tgrelid=to_regclass('ls_contact_ops.call_activity_links') AND NOT tgisinternal) AS call_immutable,
  NOT EXISTS(SELECT 1 FROM pg_class c,LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl WHERE c.oid=to_regclass('ls_contact_ops.call_activity_links') AND acl.grantee<>c.relowner) AS call_permissions,
  true AS call_refs,
  to_regclass('ls_contact_ops.lead_commands') IS NULL AS lead_absent,
  (SELECT count(*)=8 FROM pg_attribute WHERE attrelid=to_regclass('ls_contact_ops.lead_commands') AND attnum>0 AND NOT attisdropped) AND (SELECT count(*)=6 FROM pg_constraint WHERE conrelid=to_regclass('ls_contact_ops.lead_commands') AND contype<>'n') AS lead_schema,
  (SELECT count(*)=2 AND bool_and(convalidated) FROM pg_constraint WHERE conrelid=to_regclass('ls_contact_ops.lead_commands') AND contype='f') AS lead_fks,
  (SELECT count(*)=2 AND bool_and(tgfoid=to_regprocedure('ls_contact_ops.deny_acquisition_receipt_mutation()') AND tgenabled IN ('O','A')) FROM pg_trigger WHERE tgrelid=to_regclass('ls_contact_ops.lead_commands') AND NOT tgisinternal) AS lead_immutable,
  NOT EXISTS(SELECT 1 FROM pg_class c,LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl WHERE c.oid=to_regclass('ls_contact_ops.lead_commands') AND acl.grantee<>c.relowner) AS lead_permissions,
  true AS lead_refs`);
 const row=task.rows[0]!,objects=tables.rows[0]!;
 const workflowConstraints=row.workflow&&await (async()=>{const value=await db.query<{ok:boolean}>(`SELECT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('ls_calendar.tasks') AND conname='tasks_snooze_check' AND convalidated) AND EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('ls_calendar.task_history') AND conname='task_history_state_check' AND convalidated) AS ok`);return value.rows[0]?.ok===true;})();
 return {taskColumns:row.columns?.length??0,taskConstraints:Number(row.constraints),sourceKinds:literals(row.source,sourceValues),stateKinds:literals(row.state,stateValues),historyActions:literals(row.actions,actionValues),workflowColumns:row.workflow===true,workflowConstraints:workflowConstraints===true,effectiveDueIndex:row.effective===true,taskHistoryImmutable:row.immutable===true,taskPermissions:row.permissions===true,callLinksAbsent:objects.call_absent===true,callLinksSchema:objects.call_schema===true,callLinksForeignKeys:objects.call_fks===true,callLinksImmutable:objects.call_immutable===true,callLinksPermissions:objects.call_permissions===true,callLinksReferencesSound:objects.call_refs===true,leadCommandsAbsent:objects.lead_absent===true,leadCommandsSchema:objects.lead_schema===true,leadCommandsForeignKeys:objects.lead_fks===true,leadCommandsImmutable:objects.lead_immutable===true,leadCommandsPermissions:objects.lead_permissions===true,leadCommandsReferencesSound:objects.lead_refs===true};
}

export function contactWorkSourceBundle(entries:readonly {path:string;bytes:Uint8Array}[]):string{
 const hash=createHash('sha256');for(const entry of entries){const normalized=new TextDecoder('utf-8',{fatal:true}).decode(entry.bytes).replace(/\r\n/g,'\n');hash.update(entry.path).update('\0').update(createHash('sha256').update(normalized).digest('hex')).update('\n');}return hash.digest('hex');
}
