import {createHash} from 'node:crypto';
import {planMigrations,type AppliedMigration,type Migration} from './migration-plan.ts';
import {readServiceInterestReleaseSnapshot} from './service-interest-release.ts';

export const DRAFT_GROUP_PLACEMENT_BASELINE={name:'0127_ls_service_interests.sql',sha256:'af9b7f061682453d4595bfef9f1a9226b1daa955ec518d7bd9d959cd352caf6a'} as const;
export const DRAFT_GROUP_PLACEMENT_MIGRATION={name:'0128_ls_draft_group_placements.sql',sha256:'08eafdc0f7f5d6ca164b2f483a2e1edf947aa80c076ff370a1cf60504e006bb2'} as const;
export const DRAFT_GROUP_PLACEMENT_SOURCE_PATHS=[
 'package.json','migrations/manifest.json','migrations/0127_ls_service_interests.sql','migrations/0128_ls_draft_group_placements.sql',
 'scripts/release-draft-group-placement.ts','src/db/draft-group-placement-release.ts','src/db/draft-group-placement-evidence.ts','src/db/service-interest-release.ts','src/db/contact-work-release.ts','src/db/contact-ops-production-guard.ts','src/db/migration-plan.ts','src/db/migration-runner.ts',
 'src/features/group-interest/candidate.ts','src/features/group-interest/contract.ts','src/features/group-interest/http.ts','src/features/group-interest/store.ts','src/features/group-interest/workspace.tsx','src/features/group-interest/workspace.module.css',
 'src/features/group-placement/contract.ts','src/features/group-placement/http.ts','src/features/group-placement/store.ts','src/features/group-placement/workspace.tsx','src/features/group-placement/workspace.module.css',
 'src/app/api/private/group-interest/route.ts','src/app/api/private/group-placement/route.ts','src/app/[locale]/app/group-interest/page.tsx','src/app/[locale]/app/layout.tsx','src/features/identity/login-return.ts','src/proxy.ts','src/ui/workspace/core-navigation.tsx','src/ui/workspace/navigation-model.ts','src/ui/workspace/workspace-shell.tsx',
] as const;
export interface DraftGroupPlacementReleaseQuery{query<R extends object=Record<string,unknown>>(sql:string,values?:readonly unknown[]):Promise<{rows:R[]}>}
type ColumnRow={table_name:string;column_name:string;data_type:string;not_null:boolean;default_expression:string|null};
type ConstraintRow={schema_name:string;table_name:string;name:string;type:string;definition:string;local_columns:string[];reference_schema:string|null;reference_table:string|null;reference_columns:string[]};
type TriggerRow={table_name:string;name:string;function_name:string;definition:string;enabled:string};
type FunctionRow={name:string;definition:string;security_definer:boolean;public_execute:boolean};
type IndexRow={name:string;definition:string;valid:boolean;ready:boolean;live:boolean};
export type DraftGroupPlacementReleaseSnapshot={stage:0|1;catalogDigest:string;draftGroupRows:number;draftGroupOperationRows:number;proposedPlacementRows:number;proposedPlacementOperationRows:number};

const expectedColumns=[
 ['draft_group_operations','workspace_id','uuid',true,null],['draft_group_operations','operation_id','uuid',true,null],['draft_group_operations','recorded_by','uuid',true,null],['draft_group_operations','request_digest','text',true,null],['draft_group_operations','draft_group_id','uuid',true,null],['draft_group_operations','created_at','timestamp with time zone',true,'clock_timestamp()'],
 ['draft_groups','workspace_id','uuid',true,null],['draft_groups','id','uuid',true,null],['draft_groups','label_ciphertext','text',true,null],['draft_groups','recorded_by','uuid',true,null],['draft_groups','request_digest','text',true,null],['draft_groups','created_at','timestamp with time zone',true,null],
 ['proposed_placement_operations','workspace_id','uuid',true,null],['proposed_placement_operations','operation_id','uuid',true,null],['proposed_placement_operations','recorded_by','uuid',true,null],['proposed_placement_operations','request_digest','text',true,null],['proposed_placement_operations','proposed_placement_id','uuid',true,null],['proposed_placement_operations','created_at','timestamp with time zone',true,'clock_timestamp()'],
 ['proposed_placements','workspace_id','uuid',true,null],['proposed_placements','id','uuid',true,null],['proposed_placements','draft_group_id','uuid',true,null],['proposed_placements','service_interest_id','uuid',true,null],['proposed_placements','service_type','text',true,null],['proposed_placements','family_id','uuid',true,null],['proposed_placements','person_id','uuid',true,null],['proposed_placements','recorded_by','uuid',true,null],['proposed_placements','request_digest','text',true,null],['proposed_placements','created_at','timestamp with time zone',true,null],
] as const;
const constraints=[
 ['ls_service_interest','service_interests','service_interests_placement_identity_key','u',['workspace_id','id','service_type','family_id','person_id'],null,null,[]],
 ['ls_group_admin','draft_groups','draft_groups_pkey','p',['workspace_id','id'],null,null,[]],
 ['ls_group_admin','draft_groups','draft_groups_receipt_key','u',['workspace_id','id','request_digest'],null,null,[]],
 ['ls_group_admin','draft_groups','draft_groups_recorded_by_fkey','f',['workspace_id','recorded_by'],'ls_identity','accounts',['workspace_id','id']],
 ['ls_group_admin','draft_groups','draft_groups_workspace_id_fkey','f',['workspace_id'],'ls_identity','workspaces',['id']],
 ['ls_group_admin','draft_group_operations','draft_group_operations_pkey','p',['workspace_id','operation_id'],null,null,[]],
 ['ls_group_admin','draft_group_operations','draft_group_operations_group_fkey','f',['workspace_id','draft_group_id','request_digest'],'ls_group_admin','draft_groups',['workspace_id','id','request_digest']],
 ['ls_group_admin','draft_group_operations','draft_group_operations_recorded_by_fkey','f',['workspace_id','recorded_by'],'ls_identity','accounts',['workspace_id','id']],
 ['ls_group_admin','proposed_placements','proposed_placements_pkey','p',['workspace_id','id'],null,null,[]],
 ['ls_group_admin','proposed_placements','proposed_placements_exact_key','u',['workspace_id','draft_group_id','service_interest_id'],null,null,[]],
 ['ls_group_admin','proposed_placements','proposed_placements_receipt_key','u',['workspace_id','id','request_digest'],null,null,[]],
 ['ls_group_admin','proposed_placements','proposed_placements_group_fkey','f',['workspace_id','draft_group_id'],'ls_group_admin','draft_groups',['workspace_id','id']],
 ['ls_group_admin','proposed_placements','proposed_placements_interest_fkey','f',['workspace_id','service_interest_id','service_type','family_id','person_id'],'ls_service_interest','service_interests',['workspace_id','id','service_type','family_id','person_id']],
 ['ls_group_admin','proposed_placements','proposed_placements_recorded_by_fkey','f',['workspace_id','recorded_by'],'ls_identity','accounts',['workspace_id','id']],
 ['ls_group_admin','proposed_placement_operations','proposed_placement_operations_pkey','p',['workspace_id','operation_id'],null,null,[]],
 ['ls_group_admin','proposed_placement_operations','proposed_placement_operations_placement_fkey','f',['workspace_id','proposed_placement_id','request_digest'],'ls_group_admin','proposed_placements',['workspace_id','id','request_digest']],
 ['ls_group_admin','proposed_placement_operations','proposed_placement_operations_recorded_by_fkey','f',['workspace_id','recorded_by'],'ls_identity','accounts',['workspace_id','id']],
] as const;
const checkNames=['draft_groups_label_ciphertext_check','draft_groups_request_digest_check','draft_group_operations_request_digest_check','proposed_placements_service_type_check','proposed_placements_request_digest_check','proposed_placement_operations_request_digest_check'] as const;
const same=(a:readonly unknown[],b:readonly unknown[])=>JSON.stringify(a)===JSON.stringify(b);
const canonical=(value:unknown)=>JSON.stringify(value,(_,item)=>item instanceof Date?item.toISOString():item);
export const draftGroupPlacementSourceBundle=(entries:readonly {path:string;bytes:Buffer|string}[])=>createHash('sha256').update(canonical(entries.map(entry=>({path:entry.path,sha256:createHash('sha256').update(entry.bytes).digest('hex')})).sort((a,b)=>a.path.localeCompare(b.path)))).digest('hex');

export function draftGroupPlacementMigrationInventory(files:readonly Migration[]):readonly Migration[]{
 const sorted=[...files].sort((a,b)=>a.name.localeCompare(b.name)),end=sorted.findIndex(file=>file.name===DRAFT_GROUP_PLACEMENT_MIGRATION.name&&file.checksum===DRAFT_GROUP_PLACEMENT_MIGRATION.sha256);
 if(end<0)throw Error('DRAFT_GROUP_PLACEMENT_MIGRATION_SET_MISMATCH');const scoped=sorted.slice(0,end+1),baseline=scoped.at(-2),migration=scoped.at(-1);
 if(baseline?.name!==DRAFT_GROUP_PLACEMENT_BASELINE.name||baseline.checksum!==DRAFT_GROUP_PLACEMENT_BASELINE.sha256||migration?.name!==DRAFT_GROUP_PLACEMENT_MIGRATION.name||migration.checksum!==DRAFT_GROUP_PLACEMENT_MIGRATION.sha256)throw Error('DRAFT_GROUP_PLACEMENT_MIGRATION_SET_MISMATCH');return scoped;
}

export async function readDraftGroupPlacementReleaseSnapshot(db:DraftGroupPlacementReleaseQuery):Promise<DraftGroupPlacementReleaseSnapshot>{
 const existence=await db.query<{successor_absent:boolean}>(`SELECT to_regnamespace('ls_group_admin') IS NULL
  AND to_regclass('ls_group_admin.draft_groups') IS NULL AND to_regclass('ls_group_admin.draft_group_operations') IS NULL
  AND to_regclass('ls_group_admin.proposed_placements') IS NULL AND to_regclass('ls_group_admin.proposed_placement_operations') IS NULL
  AND to_regprocedure('ls_group_admin.reject_mutation()') IS NULL
  AND NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('ls_service_interest.service_interests') AND conname='service_interests_placement_identity_key') AS successor_absent`);
 if(existence.rows[0]?.successor_absent){try{const predecessor=await readServiceInterestReleaseSnapshot(db);if(predecessor.stage!==1)throw Error('SERVICE_INTEREST_NOT_READY');return {stage:0,catalogDigest:createHash('sha256').update(canonical({predecessor,successorAbsent:true})).digest('hex'),draftGroupRows:0,draftGroupOperationRows:0,proposedPlacementRows:0,proposedPlacementOperationRows:0};}catch{throw Error('DRAFT_GROUP_PLACEMENT_BASELINE_SCHEMA_CONFLICT');}}
 const columns=await db.query<ColumnRow>(`SELECT c.relname AS table_name,a.attname AS column_name,format_type(a.atttypid,a.atttypmod) AS data_type,a.attnotnull AS not_null,pg_get_expr(d.adbin,d.adrelid) AS default_expression
  FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
  WHERE n.nspname='ls_group_admin' AND c.relname IN ('draft_groups','draft_group_operations','proposed_placements','proposed_placement_operations') AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname,a.attnum`);
 const constraintRows=await db.query<ConstraintRow>(`SELECT n.nspname AS schema_name,c.relname AS table_name,k.conname AS name,k.contype::text AS type,pg_get_constraintdef(k.oid,true) AS definition,
  ARRAY(SELECT a.attname::text FROM unnest(k.conkey) WITH ORDINALITY x(attnum,ord) JOIN pg_attribute a ON a.attrelid=k.conrelid AND a.attnum=x.attnum ORDER BY x.ord) AS local_columns,
  rn.nspname AS reference_schema,rc.relname AS reference_table,COALESCE(ARRAY(SELECT a.attname::text FROM unnest(k.confkey) WITH ORDINALITY x(attnum,ord) JOIN pg_attribute a ON a.attrelid=k.confrelid AND a.attnum=x.attnum ORDER BY x.ord),'{}') AS reference_columns
  FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_class rc ON rc.oid=k.confrelid LEFT JOIN pg_namespace rn ON rn.oid=rc.relnamespace
  WHERE k.contype<>'n' AND ((n.nspname='ls_group_admin' AND c.relname IN ('draft_groups','draft_group_operations','proposed_placements','proposed_placement_operations')) OR (n.nspname='ls_service_interest' AND c.relname='service_interests' AND k.conname='service_interests_placement_identity_key')) ORDER BY n.nspname,c.relname,k.conname`);
 const triggers=await db.query<TriggerRow>(`SELECT c.relname AS table_name,t.tgname AS name,p.proname AS function_name,pg_get_triggerdef(t.oid,true) AS definition,t.tgenabled::text AS enabled FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid WHERE n.nspname='ls_group_admin' AND NOT t.tgisinternal ORDER BY c.relname,t.tgname`);
 const functions=await db.query<FunctionRow>(`SELECT p.proname AS name,pg_get_functiondef(p.oid) AS definition,p.prosecdef AS security_definer,EXISTS(SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) acl WHERE acl.grantee=0 AND acl.privilege_type='EXECUTE') AS public_execute FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='ls_group_admin' AND p.proname='reject_mutation'`);
 const indexes=await db.query<IndexRow>(`SELECT c.relname AS name,pg_get_indexdef(i.indexrelid) AS definition,i.indisvalid AS valid,i.indisready AS ready,i.indislive AS live FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indexrelid IN (to_regclass('ls_group_admin.draft_groups_recent'),to_regclass('ls_group_admin.proposed_placements_recent')) ORDER BY c.relname`);
 const permissions=await db.query<{tables_allowed:boolean;schema_allowed:boolean}>(`SELECT NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace,LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) acl WHERE n.nspname='ls_group_admin' AND c.relname IN ('draft_groups','draft_group_operations','proposed_placements','proposed_placement_operations') AND acl.grantee<>c.relowner) AS tables_allowed,NOT EXISTS(SELECT 1 FROM pg_namespace n,LATERAL aclexplode(COALESCE(n.nspacl,acldefault('n',n.nspowner))) acl WHERE n.nspname='ls_group_admin' AND acl.grantee=0 AND acl.privilege_type='USAGE') AS schema_allowed`);
 const actualColumns=columns.rows.map(row=>[row.table_name,row.column_name,row.data_type,row.not_null,row.default_expression] as const),structural=constraints.every(spec=>constraintRows.rows.some(row=>row.schema_name===spec[0]&&row.table_name===spec[1]&&row.name===spec[2]&&row.type===spec[3]&&same(row.local_columns,spec[4])&&row.reference_schema===spec[5]&&row.reference_table===spec[6]&&same(row.reference_columns,spec[7])))&&checkNames.every(name=>constraintRows.rows.some(row=>row.name===name&&row.type==='c'))&&constraintRows.rows.length===23;
 const triggerReady=triggers.rows.length===4&&triggers.rows.every(row=>['O','A'].includes(row.enabled)&&row.function_name==='reject_mutation')&&['draft_groups_immutable','draft_group_operations_immutable','proposed_placements_immutable','proposed_placement_operations_immutable'].every(name=>triggers.rows.some(row=>row.name===name));
 const functionReady=functions.rows.length===1&&!functions.rows[0]!.security_definer&&!functions.rows[0]!.public_execute&&/GROUP_PLANNING_PROVENANCE_IMMUTABLE/.test(functions.rows[0]!.definition);
 const indexReady=indexes.rows.length===2&&indexes.rows.every(row=>row.valid&&row.ready&&row.live)&&indexes.rows.some(row=>row.name==='draft_groups_recent'&&/\(workspace_id, created_at DESC, id DESC\)/i.test(row.definition))&&indexes.rows.some(row=>row.name==='proposed_placements_recent'&&/\(workspace_id, draft_group_id, created_at DESC, id DESC\)/i.test(row.definition));
 if(!same(actualColumns,expectedColumns)||!structural||!triggerReady||!functionReady||!indexReady||permissions.rows[0]?.tables_allowed!==true||permissions.rows[0]?.schema_allowed!==true)throw Error('DRAFT_GROUP_PLACEMENT_SCHEMA_STATE_CONFLICT');
 const counts=await db.query<{draft_group_rows:number;draft_group_operation_rows:number;proposed_placement_rows:number;proposed_placement_operation_rows:number}>(`SELECT (SELECT count(*)::int FROM ls_group_admin.draft_groups) AS draft_group_rows,(SELECT count(*)::int FROM ls_group_admin.draft_group_operations) AS draft_group_operation_rows,(SELECT count(*)::int FROM ls_group_admin.proposed_placements) AS proposed_placement_rows,(SELECT count(*)::int FROM ls_group_admin.proposed_placement_operations) AS proposed_placement_operation_rows`),row=counts.rows[0];
 const catalogDigest=createHash('sha256').update(canonical({columns:columns.rows,constraints:constraintRows.rows,triggers:triggers.rows,functions:functions.rows,indexes:indexes.rows,permissions:permissions.rows})).digest('hex');
 return {stage:1,catalogDigest,draftGroupRows:row?.draft_group_rows??0,draftGroupOperationRows:row?.draft_group_operation_rows??0,proposedPlacementRows:row?.proposed_placement_rows??0,proposedPlacementOperationRows:row?.proposed_placement_operation_rows??0};
}
export function draftGroupPlacementStateDigest(history:readonly AppliedMigration[],snapshot:DraftGroupPlacementReleaseSnapshot):string{return createHash('sha256').update(canonical({history,snapshot})).digest('hex');}
export function draftGroupPlacementPlan(files:readonly Migration[],history:readonly AppliedMigration[],snapshot:DraftGroupPlacementReleaseSnapshot){const scoped=draftGroupPlacementMigrationInventory(files),pending=planMigrations(scoped,history),expected=snapshot.stage===0?[DRAFT_GROUP_PLACEMENT_MIGRATION.name]:[];if(!same(pending.map(item=>item.name),expected))throw Error('DRAFT_GROUP_PLACEMENT_LEDGER_STATE_CONFLICT');return {stage:snapshot.stage,pending};}
