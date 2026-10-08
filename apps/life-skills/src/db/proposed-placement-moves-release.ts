import {createHash} from 'node:crypto';
import {planMigrations,type AppliedMigration,type Migration} from './migration-plan.ts';
import {readDraftGroupPlacementReleaseSnapshot} from './draft-group-placement-release.ts';

export const PROPOSED_PLACEMENT_MOVES_BASELINE={name:'0128_ls_draft_group_placements.sql',sha256:'08eafdc0f7f5d6ca164b2f483a2e1edf947aa80c076ff370a1cf60504e006bb2'} as const;
export const PROPOSED_PLACEMENT_MOVES_MIGRATION={name:'0129_ls_proposed_placement_moves.sql',sha256:'ea126f3154913a63479de212e969e018ec543e66a7cfd336d29d2941865a3e60'} as const;
export const PROPOSED_PLACEMENT_MOVES_SOURCE_PATHS=[
 'package.json','migrations/manifest.json','migrations/0128_ls_draft_group_placements.sql','migrations/0129_ls_proposed_placement_moves.sql',
 'scripts/release-draft-group-placement.ts','scripts/release-proposed-placement-moves.ts',
] as const;
/** Bind the entire application source tree so no transitive authorization,
 * production-off, predecessor-classifier or runtime dependency is omitted. */
export const PROPOSED_PLACEMENT_MOVES_SOURCE_ROOTS=['src'] as const;
export interface ProposedPlacementMovesReleaseQuery{query<R extends object=Record<string,unknown>>(sql:string,values?:readonly unknown[]):Promise<{rows:R[]}>}
type ColumnRow={table_name:string;column_name:string;data_type:string;not_null:boolean;default_expression:string|null};
type ConstraintRow={schema_name:string;table_name:string;name:string;type:string;definition:string;local_columns:string[];reference_schema:string|null;reference_table:string|null;reference_columns:string[]};
type TriggerRow={table_name:string;name:string;function_name:string;definition:string;enabled:string};
type IndexRow={name:string;definition:string;valid:boolean;ready:boolean;live:boolean};
export type ProposedPlacementMovesReleaseSnapshot={stage:0|1;catalogDigest:string;moveRows:number;operationRows:number};

const expectedColumns=[
 ['proposed_placement_move_operations','workspace_id','uuid',true,null],['proposed_placement_move_operations','operation_id','uuid',true,null],['proposed_placement_move_operations','recorded_by','uuid',true,null],['proposed_placement_move_operations','request_digest','text',true,null],['proposed_placement_move_operations','proposed_placement_move_id','uuid',true,null],['proposed_placement_move_operations','created_at','timestamp with time zone',true,'clock_timestamp()'],
 ['proposed_placement_moves','workspace_id','uuid',true,null],['proposed_placement_moves','id','uuid',true,null],['proposed_placement_moves','source_proposed_placement_id','uuid',true,null],['proposed_placement_moves','destination_proposed_placement_id','uuid',true,null],['proposed_placement_moves','source_draft_group_id','uuid',true,null],['proposed_placement_moves','destination_draft_group_id','uuid',true,null],['proposed_placement_moves','service_interest_id','uuid',true,null],['proposed_placement_moves','service_type','text',true,null],['proposed_placement_moves','family_id','uuid',true,null],['proposed_placement_moves','person_id','uuid',true,null],['proposed_placement_moves','recorded_by','uuid',true,null],['proposed_placement_moves','request_digest','text',true,null],['proposed_placement_moves','created_at','timestamp with time zone',true,null],
] as const;
const constraints=[
 ['ls_group_admin','proposed_placements','proposed_placements_movement_identity_key','u',['workspace_id','id','draft_group_id','service_interest_id','service_type','family_id','person_id'],null,null,[]],
 ['ls_group_admin','proposed_placement_moves','proposed_placement_moves_pkey','p',['workspace_id','id'],null,null,[]],
 ['ls_group_admin','proposed_placement_moves','proposed_placement_moves_source_key','u',['workspace_id','source_proposed_placement_id'],null,null,[]],
 ['ls_group_admin','proposed_placement_moves','proposed_placement_moves_destination_key','u',['workspace_id','destination_proposed_placement_id'],null,null,[]],
 ['ls_group_admin','proposed_placement_moves','proposed_placement_moves_receipt_key','u',['workspace_id','id','request_digest'],null,null,[]],
 ['ls_group_admin','proposed_placement_moves','proposed_placement_moves_source_fkey','f',['workspace_id','source_proposed_placement_id','source_draft_group_id','service_interest_id','service_type','family_id','person_id'],'ls_group_admin','proposed_placements',['workspace_id','id','draft_group_id','service_interest_id','service_type','family_id','person_id']],
 ['ls_group_admin','proposed_placement_moves','proposed_placement_moves_destination_fkey','f',['workspace_id','destination_proposed_placement_id','destination_draft_group_id','service_interest_id','service_type','family_id','person_id'],'ls_group_admin','proposed_placements',['workspace_id','id','draft_group_id','service_interest_id','service_type','family_id','person_id']],
 ['ls_group_admin','proposed_placement_moves','proposed_placement_moves_recorded_by_fkey','f',['workspace_id','recorded_by'],'ls_identity','accounts',['workspace_id','id']],
 ['ls_group_admin','proposed_placement_move_operations','proposed_placement_move_operations_pkey','p',['workspace_id','operation_id'],null,null,[]],
 ['ls_group_admin','proposed_placement_move_operations','proposed_placement_move_operations_move_fkey','f',['workspace_id','proposed_placement_move_id','request_digest'],'ls_group_admin','proposed_placement_moves',['workspace_id','id','request_digest']],
 ['ls_group_admin','proposed_placement_move_operations','proposed_placement_move_operations_recorded_by_fkey','f',['workspace_id','recorded_by'],'ls_identity','accounts',['workspace_id','id']],
] as const;
const checks:Record<string,RegExp>={
 proposed_placement_moves_service_type_check:/CHECK \(service_type = 'group'::text\)/i,
 proposed_placement_moves_request_digest_check:/CHECK \(request_digest ~ '\^\[a-f0-9\]\{64\}\$'::text\)/i,
 proposed_placement_moves_different_proposal_check:/CHECK \(source_proposed_placement_id <> destination_proposed_placement_id\)/i,
 proposed_placement_moves_different_group_check:/CHECK \(source_draft_group_id <> destination_draft_group_id\)/i,
 proposed_placement_move_operations_request_digest_check:/CHECK \(request_digest ~ '\^\[a-f0-9\]\{64\}\$'::text\)/i,
};
const same=(a:readonly unknown[],b:readonly unknown[])=>JSON.stringify(a)===JSON.stringify(b);
const canonical=(value:unknown)=>JSON.stringify(value,(_,item)=>item instanceof Date?item.toISOString():item);
export const proposedPlacementMovesSourceBundle=(entries:readonly {path:string;bytes:Buffer|string}[])=>createHash('sha256').update(canonical(entries.map(entry=>({path:entry.path,sha256:createHash('sha256').update(entry.bytes).digest('hex')})).sort((a,b)=>a.path.localeCompare(b.path)))).digest('hex');

export function proposedPlacementMovesMigrationInventory(files:readonly Migration[]):readonly Migration[]{
 const sorted=[...files].sort((a,b)=>a.name.localeCompare(b.name)),end=sorted.findIndex(file=>file.name===PROPOSED_PLACEMENT_MOVES_MIGRATION.name&&file.checksum===PROPOSED_PLACEMENT_MOVES_MIGRATION.sha256);
 if(end<0)throw Error('PROPOSED_PLACEMENT_MOVES_MIGRATION_SET_MISMATCH');const scoped=sorted.slice(0,end+1),baseline=scoped.at(-2),migration=scoped.at(-1);
 if(baseline?.name!==PROPOSED_PLACEMENT_MOVES_BASELINE.name||baseline.checksum!==PROPOSED_PLACEMENT_MOVES_BASELINE.sha256||migration?.name!==PROPOSED_PLACEMENT_MOVES_MIGRATION.name||migration.checksum!==PROPOSED_PLACEMENT_MOVES_MIGRATION.sha256)throw Error('PROPOSED_PLACEMENT_MOVES_MIGRATION_SET_MISMATCH');return scoped;
}

/** Recheck frozen 0128 while hiding only catalog objects owned by 0129. */
async function readFrozenDraftGroupPlacementPredecessor(db:ProposedPlacementMovesReleaseQuery){
 return readDraftGroupPlacementReleaseSnapshot({query:async<R extends object>(sql:string,values:readonly unknown[]=[])=>{
  const result=await db.query<Record<string,unknown>>(sql,values);let rows=result.rows;
  if(sql.includes('FROM pg_constraint k')&&sql.includes("n.nspname='ls_group_admin'"))rows=rows.filter(row=>!(row.schema_name==='ls_group_admin'&&row.table_name==='proposed_placements'&&row.name==='proposed_placements_movement_identity_key'&&row.type==='u'&&same(row.local_columns as unknown[],['workspace_id','id','draft_group_id','service_interest_id','service_type','family_id','person_id'])));
  if(sql.includes('FROM pg_trigger t')&&sql.includes("n.nspname='ls_group_admin'"))rows=rows.filter(row=>row.table_name!=='proposed_placement_moves'&&row.table_name!=='proposed_placement_move_operations');
  return {rows:rows as R[]};
 }});
}

export async function readProposedPlacementMovesReleaseSnapshot(db:ProposedPlacementMovesReleaseQuery):Promise<ProposedPlacementMovesReleaseSnapshot>{
 const existence=await db.query<{successor_absent:boolean}>(`SELECT to_regclass('ls_group_admin.proposed_placement_moves') IS NULL
  AND to_regclass('ls_group_admin.proposed_placement_move_operations') IS NULL
  AND to_regclass('ls_group_admin.proposed_placement_moves_history') IS NULL
  AND NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('ls_group_admin.proposed_placements') AND conname='proposed_placements_movement_identity_key') AS successor_absent`);
 if(existence.rows[0]?.successor_absent){try{const predecessor=await readFrozenDraftGroupPlacementPredecessor(db);if(predecessor.stage!==1)throw Error('DRAFT_GROUP_PLACEMENT_NOT_READY');return {stage:0,catalogDigest:createHash('sha256').update(canonical({predecessor,successorAbsent:true})).digest('hex'),moveRows:0,operationRows:0};}catch{throw Error('PROPOSED_PLACEMENT_MOVES_BASELINE_SCHEMA_CONFLICT');}}
 let predecessor;try{predecessor=await readFrozenDraftGroupPlacementPredecessor(db);if(predecessor.stage!==1)throw Error('DRAFT_GROUP_PLACEMENT_NOT_READY');}catch{throw Error('PROPOSED_PLACEMENT_MOVES_BASELINE_SCHEMA_CONFLICT');}
 const columns=await db.query<ColumnRow>(`SELECT c.relname AS table_name,a.attname AS column_name,format_type(a.atttypid,a.atttypmod) AS data_type,a.attnotnull AS not_null,pg_get_expr(d.adbin,d.adrelid) AS default_expression
  FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
  WHERE n.nspname='ls_group_admin' AND c.relname IN ('proposed_placement_moves','proposed_placement_move_operations') AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname,a.attnum`);
 const constraintRows=await db.query<ConstraintRow>(`SELECT n.nspname AS schema_name,c.relname AS table_name,k.conname AS name,k.contype::text AS type,pg_get_constraintdef(k.oid,true) AS definition,
  ARRAY(SELECT a.attname::text FROM unnest(k.conkey) WITH ORDINALITY x(attnum,ord) JOIN pg_attribute a ON a.attrelid=k.conrelid AND a.attnum=x.attnum ORDER BY x.ord) AS local_columns,
  rn.nspname AS reference_schema,rc.relname AS reference_table,COALESCE(ARRAY(SELECT a.attname::text FROM unnest(k.confkey) WITH ORDINALITY x(attnum,ord) JOIN pg_attribute a ON a.attrelid=k.confrelid AND a.attnum=x.attnum ORDER BY x.ord),'{}') AS reference_columns
  FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_class rc ON rc.oid=k.confrelid LEFT JOIN pg_namespace rn ON rn.oid=rc.relnamespace
  WHERE k.contype<>'n' AND n.nspname='ls_group_admin' AND ((c.relname IN ('proposed_placement_moves','proposed_placement_move_operations')) OR (c.relname='proposed_placements' AND k.conname='proposed_placements_movement_identity_key')) ORDER BY n.nspname,c.relname,k.conname`);
 const triggers=await db.query<TriggerRow>(`SELECT c.relname AS table_name,t.tgname AS name,p.proname AS function_name,pg_get_triggerdef(t.oid,true) AS definition,t.tgenabled::text AS enabled FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid WHERE n.nspname='ls_group_admin' AND c.relname IN ('proposed_placement_moves','proposed_placement_move_operations') AND NOT t.tgisinternal ORDER BY c.relname,t.tgname`);
 const indexes=await db.query<IndexRow>(`SELECT c.relname AS name,pg_get_indexdef(i.indexrelid) AS definition,i.indisvalid AS valid,i.indisready AS ready,i.indislive AS live FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indexrelid=to_regclass('ls_group_admin.proposed_placement_moves_history')`);
 const permissions=await db.query<{tables_allowed:boolean}>(`SELECT NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace,LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) acl WHERE n.nspname='ls_group_admin' AND c.relname IN ('proposed_placement_moves','proposed_placement_move_operations') AND acl.grantee<>c.relowner) AS tables_allowed`);
 const actualColumns=columns.rows.map(row=>[row.table_name,row.column_name,row.data_type,row.not_null,row.default_expression] as const);
 const structural=constraints.every(spec=>constraintRows.rows.some(row=>row.schema_name===spec[0]&&row.table_name===spec[1]&&row.name===spec[2]&&row.type===spec[3]&&same(row.local_columns,spec[4])&&row.reference_schema===spec[5]&&row.reference_table===spec[6]&&same(row.reference_columns,spec[7])))&&Object.entries(checks).every(([name,pattern])=>constraintRows.rows.some(row=>row.name===name&&row.type==='c'&&pattern.test(row.definition)))&&constraintRows.rows.length===16;
 const triggerReady=triggers.rows.length===2&&triggers.rows.every(row=>['O','A'].includes(row.enabled)&&row.function_name==='reject_mutation')&&['proposed_placement_moves_immutable','proposed_placement_move_operations_immutable'].every(name=>triggers.rows.some(row=>row.name===name));
 const indexReady=indexes.rows.length===1&&indexes.rows[0]!.valid&&indexes.rows[0]!.ready&&indexes.rows[0]!.live&&/\(workspace_id, service_interest_id, created_at, id\)/i.test(indexes.rows[0]!.definition);
 if(!same(actualColumns,expectedColumns)||!structural||!triggerReady||!indexReady||permissions.rows[0]?.tables_allowed!==true)throw Error('PROPOSED_PLACEMENT_MOVES_SCHEMA_STATE_CONFLICT');
 const counts=await db.query<{move_rows:number;operation_rows:number}>(`SELECT (SELECT count(*)::int FROM ls_group_admin.proposed_placement_moves) AS move_rows,(SELECT count(*)::int FROM ls_group_admin.proposed_placement_move_operations) AS operation_rows`),row=counts.rows[0];
 const catalogDigest=createHash('sha256').update(canonical({predecessor,columns:columns.rows,constraints:constraintRows.rows,triggers:triggers.rows,indexes:indexes.rows,permissions:permissions.rows})).digest('hex');
 return {stage:1,catalogDigest,moveRows:row?.move_rows??0,operationRows:row?.operation_rows??0};
}
export function proposedPlacementMovesStateDigest(history:readonly AppliedMigration[],snapshot:ProposedPlacementMovesReleaseSnapshot):string{return createHash('sha256').update(canonical({history,snapshot})).digest('hex');}
export function proposedPlacementMovesPlan(files:readonly Migration[],history:readonly AppliedMigration[],snapshot:ProposedPlacementMovesReleaseSnapshot){const scoped=proposedPlacementMovesMigrationInventory(files),pending=planMigrations(scoped,history),expected=snapshot.stage===0?[PROPOSED_PLACEMENT_MOVES_MIGRATION.name]:[];if(!same(pending.map(item=>item.name),expected))throw Error('PROPOSED_PLACEMENT_MOVES_LEDGER_STATE_CONFLICT');return {stage:snapshot.stage,pending};}
