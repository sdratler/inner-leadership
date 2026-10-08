import {createHash} from 'node:crypto';
import {planMigrations,type AppliedMigration,type Migration} from './migration-plan.ts';
import {classifyContactWork,readContactWorkSnapshot} from './contact-work-release.ts';

export const SERVICE_INTEREST_BASELINE={name:'0126_ls_audience_interest.sql',sha256:'f2d2c2d84d34e7224e8c53fb19e4fa7e68c89d5c2d13e197f4f86b2155703845'} as const;
export const SERVICE_INTEREST_MIGRATION={name:'0127_ls_service_interests.sql',sha256:'af9b7f061682453d4595bfef9f1a9226b1daa955ec518d7bd9d959cd352caf6a'} as const;
export const SERVICE_INTEREST_SOURCE_PATHS=['package.json','migrations/manifest.json','migrations/0127_ls_service_interests.sql','scripts/release-service-interest.ts','src/db/service-interest-release.ts','src/db/service-interest-evidence.ts','src/db/contact-work-release.ts','src/db/contact-ops-production-guard.ts','src/db/migration-plan.ts','src/db/migration-runner.ts'] as const;
export interface ServiceInterestReleaseQuery{query<R extends object=Record<string,unknown>>(sql:string,values?:readonly unknown[]):Promise<{rows:R[]}>}
type ColumnRow={table_name:string;column_name:string;data_type:string;not_null:boolean;default_expression:string|null};
type ConstraintRow={schema_name:string;table_name:string;name:string;type:string;definition:string;local_columns:string[];reference_schema:string|null;reference_table:string|null;reference_columns:string[]};
type TriggerRow={table_name:string;name:string;function_name:string;definition:string;enabled:string};
type FunctionRow={name:string;definition:string;security_definer:boolean;public_execute:boolean};
type IndexRow={name:string;definition:string;valid:boolean;ready:boolean;live:boolean};
export type ServiceInterestReleaseSnapshot={stage:0|1;catalogDigest:string;serviceRows:number;operationRows:number};

const expectedColumns=[
 ['service_interest_operations','workspace_id','uuid',true,null],['service_interest_operations','operation_id','uuid',true,null],['service_interest_operations','recorded_by','uuid',true,null],['service_interest_operations','request_digest','text',true,null],['service_interest_operations','service_interest_id','uuid',true,null],['service_interest_operations','created_at','timestamp with time zone',true,'clock_timestamp()'],
 ['service_interests','workspace_id','uuid',true,null],['service_interests','id','uuid',true,null],['service_interests','family_id','uuid',true,null],['service_interests','person_id','uuid',true,null],['service_interests','member_role','text',true,null],['service_interests','person_kind','text',true,null],['service_interests','service_type','text',true,null],['service_interests','source_inquiry_id','uuid',true,null],['service_interests','recorded_by','uuid',true,null],['service_interests','request_digest','text',true,null],['service_interests','created_at','timestamp with time zone',true,null],
] as const;
const constraints=[
 ['ls_cases','family_members','family_members_service_interest_identity_key','u',['workspace_id','family_id','person_id','role'],null,null,[]],
 ['ls_identity','people','people_service_interest_kind_key','u',['workspace_id','id','kind'],null,null,[]],
 ['ls_service_interest','service_interests','service_interests_pkey','p',['workspace_id','id'],null,null,[]],
 ['ls_service_interest','service_interests','service_interests_identity_key','u',['workspace_id','source_inquiry_id','family_id','person_id','service_type'],null,null,[]],
 ['ls_service_interest','service_interests','service_interests_receipt_key','u',['workspace_id','id','request_digest'],null,null,[]],
 ['ls_service_interest','service_interests','service_interests_family_member_fkey','f',['workspace_id','family_id','person_id','member_role'],'ls_cases','family_members',['workspace_id','family_id','person_id','role']],
 ['ls_service_interest','service_interests','service_interests_person_kind_fkey','f',['workspace_id','person_id','person_kind'],'ls_identity','people',['workspace_id','id','kind']],
 ['ls_service_interest','service_interests','service_interests_source_inquiry_fkey','f',['workspace_id','source_inquiry_id'],'ls_service_interest','inquiries',['workspace_id','id']],
 ['ls_service_interest','service_interests','service_interests_recorded_by_fkey','f',['workspace_id','recorded_by'],'ls_identity','accounts',['workspace_id','id']],
 ['ls_service_interest','service_interest_operations','service_interest_operations_pkey','p',['workspace_id','operation_id'],null,null,[]],
 ['ls_service_interest','service_interest_operations','service_interest_operations_interest_fkey','f',['workspace_id','service_interest_id','request_digest'],'ls_service_interest','service_interests',['workspace_id','id','request_digest']],
 ['ls_service_interest','service_interest_operations','service_interest_operations_recorded_by_fkey','f',['workspace_id','recorded_by'],'ls_identity','accounts',['workspace_id','id']],
] as const;
const checkNames=['service_interests_member_role_check','service_interests_person_kind_check','service_interests_service_type_check','service_interests_request_digest_check','service_interest_operations_request_digest_check'] as const;
const same=(a:readonly unknown[],b:readonly unknown[])=>JSON.stringify(a)===JSON.stringify(b);
const canonical=(value:unknown)=>JSON.stringify(value,(_,item)=>item instanceof Date?item.toISOString():item);
export const serviceInterestSourceBundle=(entries:readonly {path:string;bytes:Buffer|string}[])=>createHash('sha256').update(canonical(entries.map(entry=>({path:entry.path,sha256:createHash('sha256').update(entry.bytes).digest('hex')})).sort((a,b)=>a.path.localeCompare(b.path)))).digest('hex');

export function serviceInterestMigrationInventory(files:readonly Migration[]):readonly Migration[]{
 const sorted=[...files].sort((a,b)=>a.name.localeCompare(b.name)),end=sorted.findIndex(file=>file.name===SERVICE_INTEREST_MIGRATION.name&&file.checksum===SERVICE_INTEREST_MIGRATION.sha256);
 if(end<0)throw Error('SERVICE_INTEREST_MIGRATION_SET_MISMATCH');
 const scoped=sorted.slice(0,end+1),baseline=scoped.at(-2),migration=scoped.at(-1);
 if(baseline?.name!==SERVICE_INTEREST_BASELINE.name||baseline.checksum!==SERVICE_INTEREST_BASELINE.sha256||migration?.name!==SERVICE_INTEREST_MIGRATION.name||migration.checksum!==SERVICE_INTEREST_MIGRATION.sha256)throw Error('SERVICE_INTEREST_MIGRATION_SET_MISMATCH');
 return scoped;
}

export async function readServiceInterestReleaseSnapshot(db:ServiceInterestReleaseQuery):Promise<ServiceInterestReleaseSnapshot>{
 const existence=await db.query<{group_ready:boolean;service_absent:boolean}>(`SELECT
  to_regclass('ls_service_interest.inquiries') IS NOT NULL AND to_regclass('ls_service_interest.operations') IS NOT NULL AS group_ready,
  to_regclass('ls_service_interest.service_interests') IS NULL
   AND to_regclass('ls_service_interest.service_interest_operations') IS NULL
   AND to_regclass('ls_service_interest.service_interests_recent') IS NULL
   AND to_regprocedure('ls_service_interest.check_service_interest_child()') IS NULL
   AND to_regprocedure('ls_service_interest.reject_service_interest_mutation()') IS NULL
   AND NOT EXISTS(SELECT 1 FROM pg_constraint WHERE
    (conrelid=to_regclass('ls_cases.family_members') AND conname='family_members_service_interest_identity_key')
    OR (conrelid=to_regclass('ls_identity.people') AND conname='people_service_interest_kind_key')) AS service_absent`);
 const base=existence.rows[0];if(!base?.group_ready)throw Error('SERVICE_INTEREST_BASELINE_SCHEMA_CONFLICT');
 if(base.service_absent){try{const predecessor=await readContactWorkSnapshot(db);if(classifyContactWork(predecessor)!==8)throw Error('CONTACT_WORK_NOT_READY');return {stage:0,catalogDigest:createHash('sha256').update(canonical({predecessor,successorAbsent:true})).digest('hex'),serviceRows:0,operationRows:0};}catch{throw Error('SERVICE_INTEREST_BASELINE_SCHEMA_CONFLICT');}}
 const columns=await db.query<ColumnRow>(`SELECT c.relname AS table_name,a.attname AS column_name,format_type(a.atttypid,a.atttypmod) AS data_type,a.attnotnull AS not_null,pg_get_expr(d.adbin,d.adrelid) AS default_expression
  FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
  WHERE n.nspname='ls_service_interest' AND c.relname IN ('service_interests','service_interest_operations') AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname,a.attnum`);
 const constraintRows=await db.query<ConstraintRow>(`SELECT n.nspname AS schema_name,c.relname AS table_name,k.conname AS name,k.contype::text AS type,pg_get_constraintdef(k.oid,true) AS definition,
  ARRAY(SELECT a.attname::text FROM unnest(k.conkey) WITH ORDINALITY x(attnum,ord) JOIN pg_attribute a ON a.attrelid=k.conrelid AND a.attnum=x.attnum ORDER BY x.ord) AS local_columns,
  rn.nspname AS reference_schema,rc.relname AS reference_table,
  COALESCE(ARRAY(SELECT a.attname::text FROM unnest(k.confkey) WITH ORDINALITY x(attnum,ord) JOIN pg_attribute a ON a.attrelid=k.confrelid AND a.attnum=x.attnum ORDER BY x.ord),'{}') AS reference_columns
  FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_class rc ON rc.oid=k.confrelid LEFT JOIN pg_namespace rn ON rn.oid=rc.relnamespace
  WHERE k.contype<>'n' AND ((n.nspname='ls_service_interest' AND c.relname IN ('service_interests','service_interest_operations')) OR k.conname IN ('family_members_service_interest_identity_key','people_service_interest_kind_key')) ORDER BY n.nspname,c.relname,k.conname`);
 const triggers=await db.query<TriggerRow>(`SELECT c.relname AS table_name,t.tgname AS name,p.proname AS function_name,pg_get_triggerdef(t.oid,true) AS definition,t.tgenabled::text AS enabled
  FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid
  WHERE n.nspname='ls_service_interest' AND c.relname IN ('service_interests','service_interest_operations') AND NOT t.tgisinternal ORDER BY c.relname,t.tgname`);
 const functions=await db.query<FunctionRow>(`SELECT p.proname AS name,pg_get_functiondef(p.oid) AS definition,p.prosecdef AS security_definer,
  EXISTS(SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) acl WHERE acl.grantee=0 AND acl.privilege_type='EXECUTE') AS public_execute FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='ls_service_interest' AND p.proname IN ('check_service_interest_child','reject_service_interest_mutation') ORDER BY p.proname`);
 const indexes=await db.query<IndexRow>(`SELECT c.relname AS name,pg_get_indexdef(i.indexrelid) AS definition,i.indisvalid AS valid,i.indisready AS ready,i.indislive AS live
  FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indexrelid=to_regclass('ls_service_interest.service_interests_recent')`);
 const permissions=await db.query<{allowed:boolean}>(`SELECT NOT EXISTS(
  SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace,LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) acl
  WHERE n.nspname='ls_service_interest' AND c.relname IN ('service_interests','service_interest_operations') AND acl.grantee<>c.relowner) AS allowed`);
 const actualColumns=columns.rows.map(row=>[row.table_name,row.column_name,row.data_type,row.not_null,row.default_expression] as const);
 const structural=constraints.every(spec=>constraintRows.rows.some(row=>row.schema_name===spec[0]&&row.table_name===spec[1]&&row.name===spec[2]&&row.type===spec[3]&&same(row.local_columns,spec[4])&&row.reference_schema===spec[5]&&row.reference_table===spec[6]&&same(row.reference_columns,spec[7])))&&
  checkNames.every(name=>constraintRows.rows.some(row=>row.name===name&&row.type==='c'))&&constraintRows.rows.filter(row=>row.schema_name==='ls_service_interest').length===15;
 const triggerReady=triggers.rows.length===3&&triggers.rows.every(row=>['O','A'].includes(row.enabled))&&triggers.rows.some(row=>row.name==='service_interests_verified_child'&&row.function_name==='check_service_interest_child')&&triggers.rows.filter(row=>row.function_name==='reject_service_interest_mutation').length===2;
 const functionReady=functions.rows.length===2&&functions.rows.every(row=>!row.security_definer&&!row.public_execute)&&functions.rows.some(row=>row.name==='check_service_interest_child'&&/fm\.role\s*=\s*'child'/i.test(row.definition)&&/p\.kind\s*=\s*'minor'/i.test(row.definition))&&functions.rows.some(row=>row.name==='reject_service_interest_mutation'&&/SERVICE_INTEREST_PROVENANCE_IMMUTABLE/.test(row.definition));
 const indexReady=indexes.rows.length===1&&indexes.rows[0]!.valid&&indexes.rows[0]!.ready&&indexes.rows[0]!.live&&/\(workspace_id, created_at DESC, id DESC\)/i.test(indexes.rows[0]!.definition);
 if(!same(actualColumns,expectedColumns)||!structural||!triggerReady||!functionReady||!indexReady||permissions.rows[0]?.allowed!==true)throw Error('SERVICE_INTEREST_SCHEMA_STATE_CONFLICT');
 const counts=await db.query<{service_rows:number;operation_rows:number}>(`SELECT (SELECT count(*)::int FROM ls_service_interest.service_interests) AS service_rows,(SELECT count(*)::int FROM ls_service_interest.service_interest_operations) AS operation_rows`);
 const catalogDigest=createHash('sha256').update(canonical({columns:columns.rows,constraints:constraintRows.rows,triggers:triggers.rows,functions:functions.rows,indexes:indexes.rows,permissions:permissions.rows})).digest('hex');
 return {stage:1,catalogDigest,serviceRows:counts.rows[0]?.service_rows??0,operationRows:counts.rows[0]?.operation_rows??0};
}

export function serviceInterestStateDigest(history:readonly AppliedMigration[],snapshot:ServiceInterestReleaseSnapshot):string{return createHash('sha256').update(canonical({history,snapshot})).digest('hex');}
export function serviceInterestPlan(files:readonly Migration[],history:readonly AppliedMigration[],snapshot:ServiceInterestReleaseSnapshot){
 const scoped=serviceInterestMigrationInventory(files),pending=planMigrations(scoped,history),expected=snapshot.stage===0?[SERVICE_INTEREST_MIGRATION.name]:[];
 if(!same(pending.map(item=>item.name),expected))throw Error('SERVICE_INTEREST_LEDGER_STATE_CONFLICT');
 return {stage:snapshot.stage,pending};
}
