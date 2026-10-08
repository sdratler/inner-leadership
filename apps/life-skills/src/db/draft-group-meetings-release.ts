import {createHash} from 'node:crypto';
import {lstat,readFile,readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {planMigrations,type AppliedMigration,type Migration} from './migration-plan.ts';
import {readProposedPlacementMovesReleaseSnapshot} from './proposed-placement-moves-release.ts';

export const DRAFT_GROUP_MEETINGS_BASELINE={name:'0129_ls_proposed_placement_moves.sql',sha256:'ea126f3154913a63479de212e969e018ec543e66a7cfd336d29d2941865a3e60'} as const;
export const DRAFT_GROUP_MEETINGS_MIGRATION={name:'0130_ls_draft_group_meetings.sql',sha256:'106320890c774544cee83648d15243decfdef7061c7e14aea532d89ac5be23e7'} as const;
export const DRAFT_GROUP_MEETINGS_SOURCE_PATHS=[
 'package.json','migrations/manifest.json','migrations/0129_ls_proposed_placement_moves.sql','migrations/0130_ls_draft_group_meetings.sql',
 'scripts/release-proposed-placement-moves.ts','scripts/release-draft-group-meetings.ts',
] as const;
/** Bind the complete runtime and release boundary, while rejecting source
 * substitution through symlinks, junctions or non-regular fixed paths. */
export const DRAFT_GROUP_MEETINGS_SOURCE_ROOTS=['src'] as const;
type SourceNode={isSymbolicLink():boolean;isFile():boolean;isDirectory():boolean};
export function assertDraftGroupMeetingsSourceNode(path:string,expected:'file'|'directory',node:SourceNode):void{if(node.isSymbolicLink())throw Error('DRAFT_GROUP_MEETINGS_SOURCE_SYMLINK_REJECTED');if((expected==='file'&&!node.isFile())||(expected==='directory'&&!node.isDirectory()))throw Error('DRAFT_GROUP_MEETINGS_SOURCE_TYPE_REJECTED:'+path);}
export async function collectDraftGroupMeetingsSourceEntries(appRoot:URL,fixedPaths:readonly string[]=DRAFT_GROUP_MEETINGS_SOURCE_PATHS,sourceRoots:readonly string[]=DRAFT_GROUP_MEETINGS_SOURCE_ROOTS):Promise<{path:string;bytes:Buffer}[]>{
 const entries:{path:string;bytes:Buffer}[]=[];
 for(const path of fixedPaths){const url=new URL(path,appRoot);assertDraftGroupMeetingsSourceNode(path,'file',await lstat(fileURLToPath(url)));entries.push({path,bytes:await readFile(url)});}
 const walk=async(relativeDirectory:string):Promise<void>=>{const directory=new URL(relativeDirectory+'/',appRoot),children=(await readdir(fileURLToPath(directory),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name));for(const child of children){const relative=relativeDirectory+'/'+child.name;if(child.isSymbolicLink())throw Error('DRAFT_GROUP_MEETINGS_SOURCE_SYMLINK_REJECTED');if(child.isDirectory())await walk(relative);else{assertDraftGroupMeetingsSourceNode(relative,'file',child);entries.push({path:relative,bytes:await readFile(new URL(relative,appRoot))});}}};
 for(const root of sourceRoots){assertDraftGroupMeetingsSourceNode(root,'directory',await lstat(fileURLToPath(new URL(root,appRoot))));await walk(root);}return entries;
}

export interface DraftGroupMeetingsReleaseQuery{query<R extends object=Record<string,unknown>>(sql:string,values?:readonly unknown[]):Promise<{rows:R[]}>}
type ColumnRow={table_name:string;column_name:string;data_type:string;not_null:boolean;default_expression:string|null};
type ConstraintRow={schema_name:string;table_name:string;name:string;type:string;definition:string;local_columns:string[];reference_schema:string|null;reference_table:string|null;reference_columns:string[]};
type TriggerRow={table_name:string;name:string;function_name:string;definition:string;enabled:string};
type IndexRow={name:string;definition:string;valid:boolean;ready:boolean;live:boolean};
type OwnerRow={table_name:string;owner_name:string;expected_owner:string};
export type DraftGroupMeetingsReleaseSnapshot={stage:0|1;catalogDigest:string;revisionRows:number;operationRows:number};

const expectedColumns=[
 ['draft_meeting_operations','workspace_id','uuid',true,null],['draft_meeting_operations','operation_id','uuid',true,null],['draft_meeting_operations','recorded_by','uuid',true,null],['draft_meeting_operations','request_digest','text',true,null],['draft_meeting_operations','meeting_revision_id','uuid',true,null],['draft_meeting_operations','created_at','timestamp with time zone',true,'clock_timestamp()'],
 ['draft_meeting_revisions','workspace_id','uuid',true,null],['draft_meeting_revisions','id','uuid',true,null],['draft_meeting_revisions','occurrence_id','uuid',true,null],['draft_meeting_revisions','draft_group_id','uuid',true,null],['draft_meeting_revisions','previous_revision_id','uuid',false,null],['draft_meeting_revisions','state','text',true,null],['draft_meeting_revisions','time_zone','text',true,null],['draft_meeting_revisions','local_start','text',true,null],['draft_meeting_revisions','starts_at','timestamp with time zone',true,null],['draft_meeting_revisions','ends_at','timestamp with time zone',true,null],['draft_meeting_revisions','duration_minutes','integer',true,null],['draft_meeting_revisions','venue_ciphertext','text',true,null],['draft_meeting_revisions','recorded_by','uuid',true,null],['draft_meeting_revisions','request_digest','text',true,null],['draft_meeting_revisions','created_at','timestamp with time zone',true,null],
] as const;
const constraints=[
 ['ls_group_admin','draft_meeting_revisions','draft_meeting_revisions_pkey','p',['workspace_id','id'],null,null,[]],
 ['ls_group_admin','draft_meeting_revisions','draft_meeting_revisions_identity_key','u',['workspace_id','occurrence_id','id'],null,null,[]],
 ['ls_group_admin','draft_meeting_revisions','draft_meeting_revisions_receipt_key','u',['workspace_id','id','request_digest'],null,null,[]],
 ['ls_group_admin','draft_meeting_revisions','draft_meeting_revisions_one_successor','u',['workspace_id','previous_revision_id'],null,null,[]],
 ['ls_group_admin','draft_meeting_revisions','draft_meeting_revisions_group_fkey','f',['workspace_id','draft_group_id'],'ls_group_admin','draft_groups',['workspace_id','id']],
 ['ls_group_admin','draft_meeting_revisions','draft_meeting_revisions_previous_fkey','f',['workspace_id','occurrence_id','previous_revision_id'],'ls_group_admin','draft_meeting_revisions',['workspace_id','occurrence_id','id']],
 ['ls_group_admin','draft_meeting_revisions','draft_meeting_revisions_recorded_by_fkey','f',['workspace_id','recorded_by'],'ls_identity','accounts',['workspace_id','id']],
 ['ls_group_admin','draft_meeting_operations','draft_meeting_operations_pkey','p',['workspace_id','operation_id'],null,null,[]],
 ['ls_group_admin','draft_meeting_operations','draft_meeting_operations_revision_fkey','f',['workspace_id','meeting_revision_id','request_digest'],'ls_group_admin','draft_meeting_revisions',['workspace_id','id','request_digest']],
 ['ls_group_admin','draft_meeting_operations','draft_meeting_operations_recorded_by_fkey','f',['workspace_id','recorded_by'],'ls_identity','accounts',['workspace_id','id']],
] as const;
const checks:Record<string,RegExp>={
 draft_meeting_revisions_state_check:/CHECK \(state = 'proposed'::text\)/i,
 draft_meeting_revisions_time_zone_check:/CHECK \(time_zone = 'Asia\/Jerusalem'::text\)/i,
 draft_meeting_revisions_local_start_check:/local_start ~ '\^\\d\{4\}-\\d\{2\}-\\d\{2\}T\\d\{2\}:\\d\{2\}\$'/i,
 draft_meeting_revisions_duration_minutes_check:/duration_minutes >= 15.*duration_minutes <= 480/i,
 draft_meeting_revisions_venue_ciphertext_check:/length\(venue_ciphertext\) > 0/i,
 draft_meeting_revisions_request_digest_check:/request_digest ~ '\^\[a-f0-9\]\{64\}\$'/i,
 draft_meeting_revisions_time_check:/ends_at = .*starts_at .* duration_minutes.*00:01:00.*interval/i,
 draft_meeting_revisions_root_check:/previous_revision_id IS NULL.*occurrence_id = id/i,
 draft_meeting_operations_request_digest_check:/request_digest ~ '\^\[a-f0-9\]\{64\}\$'/i,
};
const same=(a:readonly unknown[],b:readonly unknown[])=>JSON.stringify(a)===JSON.stringify(b);
const canonical=(value:unknown)=>JSON.stringify(value,(_,item)=>item instanceof Date?item.toISOString():item);
export const draftGroupMeetingsSourceBundle=(entries:readonly {path:string;bytes:Buffer|string}[])=>createHash('sha256').update(canonical(entries.map(entry=>({path:entry.path,sha256:createHash('sha256').update(entry.bytes).digest('hex')})).sort((a,b)=>a.path.localeCompare(b.path)))).digest('hex');

export function draftGroupMeetingsMigrationInventory(files:readonly Migration[]):readonly Migration[]{
 const sorted=[...files].sort((a,b)=>a.name.localeCompare(b.name)),end=sorted.findIndex(file=>file.name===DRAFT_GROUP_MEETINGS_MIGRATION.name&&file.checksum===DRAFT_GROUP_MEETINGS_MIGRATION.sha256);
 if(end<0)throw Error('DRAFT_GROUP_MEETINGS_MIGRATION_SET_MISMATCH');const scoped=sorted.slice(0,end+1),baseline=scoped.at(-2),migration=scoped.at(-1);
 if(baseline?.name!==DRAFT_GROUP_MEETINGS_BASELINE.name||baseline.checksum!==DRAFT_GROUP_MEETINGS_BASELINE.sha256||migration?.name!==DRAFT_GROUP_MEETINGS_MIGRATION.name||migration.checksum!==DRAFT_GROUP_MEETINGS_MIGRATION.sha256)throw Error('DRAFT_GROUP_MEETINGS_MIGRATION_SET_MISMATCH');return scoped;
}

/** Recheck the frozen 0129 predecessor while hiding only 0130-owned triggers
 * from the older broad ls_group_admin trigger inventory. */
async function readFrozenProposedPlacementMovesPredecessor(db:DraftGroupMeetingsReleaseQuery){
 return readProposedPlacementMovesReleaseSnapshot({query:async<R extends object>(sql:string,values:readonly unknown[]=[])=>{
  const result=await db.query<Record<string,unknown>>(sql,values);let rows=result.rows;
  if(sql.includes('FROM pg_trigger t')&&sql.includes("n.nspname='ls_group_admin'"))rows=rows.filter(row=>row.table_name!=='draft_meeting_revisions'&&row.table_name!=='draft_meeting_operations');
  return {rows:rows as R[]};
 }});
}

const predecessorTables=['draft_group_operations','draft_groups','proposed_placement_move_operations','proposed_placement_moves','proposed_placement_operations','proposed_placements'] as const;
async function readFrozenOwnership(db:DraftGroupMeetingsReleaseQuery){
 const tables=await db.query<OwnerRow>(`SELECT c.relname AS table_name,pg_get_userbyid(c.relowner) AS owner_name,current_user::text AS expected_owner FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='ls_group_admin' AND c.relname IN ('draft_groups','draft_group_operations','proposed_placements','proposed_placement_operations','proposed_placement_moves','proposed_placement_move_operations') ORDER BY c.relname`);
 const names=tables.rows.map(row=>row.table_name),expected=tables.rows[0]?.expected_owner;
 const namesReady=same(names,predecessorTables),tablesReady=!!expected&&tables.rows.every(row=>row.owner_name===expected);
 if(!namesReady||!tablesReady)throw Error(`DRAFT_GROUP_MEETINGS_BASELINE_OWNER_CONFLICT:names=${namesReady}:${names.join(',')}:tables=${tablesReady}`);
 return {tables:tables.rows};
}

export async function readDraftGroupMeetingsReleaseSnapshot(db:DraftGroupMeetingsReleaseQuery):Promise<DraftGroupMeetingsReleaseSnapshot>{
 const existence=await db.query<{successor_absent:boolean}>(`SELECT to_regclass('ls_group_admin.draft_meeting_revisions') IS NULL
  AND to_regclass('ls_group_admin.draft_meeting_operations') IS NULL
  AND to_regclass('ls_group_admin.draft_meeting_revisions_group_history') IS NULL AS successor_absent`);
 if(existence.rows[0]?.successor_absent){try{const predecessor=await readFrozenProposedPlacementMovesPredecessor(db),predecessorOwnership=await readFrozenOwnership(db);if(predecessor.stage!==1)throw Error('PROPOSED_PLACEMENT_MOVES_NOT_READY');return {stage:0,catalogDigest:createHash('sha256').update(canonical({predecessor,predecessorOwnership,successorAbsent:true})).digest('hex'),revisionRows:0,operationRows:0};}catch(error){throw Error(`DRAFT_GROUP_MEETINGS_BASELINE_SCHEMA_CONFLICT:${error instanceof Error?error.message:'UNKNOWN'}`);}}
 let predecessor,predecessorOwnership;try{predecessor=await readFrozenProposedPlacementMovesPredecessor(db);predecessorOwnership=await readFrozenOwnership(db);if(predecessor.stage!==1)throw Error('PROPOSED_PLACEMENT_MOVES_NOT_READY');}catch(error){throw Error(`DRAFT_GROUP_MEETINGS_BASELINE_SCHEMA_CONFLICT:${error instanceof Error?error.message:'UNKNOWN'}`);}
 const columns=await db.query<ColumnRow>(`SELECT c.relname AS table_name,a.attname AS column_name,format_type(a.atttypid,a.atttypmod) AS data_type,a.attnotnull AS not_null,pg_get_expr(d.adbin,d.adrelid) AS default_expression
  FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
  WHERE n.nspname='ls_group_admin' AND c.relname IN ('draft_meeting_revisions','draft_meeting_operations') AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname,a.attnum`);
 const constraintRows=await db.query<ConstraintRow>(`SELECT n.nspname AS schema_name,c.relname AS table_name,k.conname AS name,k.contype::text AS type,pg_get_constraintdef(k.oid,true) AS definition,
  ARRAY(SELECT a.attname::text FROM unnest(k.conkey) WITH ORDINALITY x(attnum,ord) JOIN pg_attribute a ON a.attrelid=k.conrelid AND a.attnum=x.attnum ORDER BY x.ord) AS local_columns,
  rn.nspname AS reference_schema,rc.relname AS reference_table,COALESCE(ARRAY(SELECT a.attname::text FROM unnest(k.confkey) WITH ORDINALITY x(attnum,ord) JOIN pg_attribute a ON a.attrelid=k.confrelid AND a.attnum=x.attnum ORDER BY x.ord),'{}') AS reference_columns
  FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_class rc ON rc.oid=k.confrelid LEFT JOIN pg_namespace rn ON rn.oid=rc.relnamespace
  WHERE k.contype<>'n' AND n.nspname='ls_group_admin' AND c.relname IN ('draft_meeting_revisions','draft_meeting_operations') ORDER BY n.nspname,c.relname,k.conname`);
 const triggers=await db.query<TriggerRow>(`SELECT c.relname AS table_name,t.tgname AS name,p.proname AS function_name,pg_get_triggerdef(t.oid,true) AS definition,t.tgenabled::text AS enabled FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid WHERE n.nspname='ls_group_admin' AND c.relname IN ('draft_meeting_revisions','draft_meeting_operations') AND NOT t.tgisinternal ORDER BY c.relname,t.tgname`);
 const indexes=await db.query<IndexRow>(`SELECT c.relname AS name,pg_get_indexdef(i.indexrelid) AS definition,i.indisvalid AS valid,i.indisready AS ready,i.indislive AS live FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indexrelid=to_regclass('ls_group_admin.draft_meeting_revisions_group_history')`);
 const permissions=await db.query<{tables_allowed:boolean}>(`SELECT NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace,LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) acl WHERE n.nspname='ls_group_admin' AND c.relname IN ('draft_meeting_revisions','draft_meeting_operations') AND acl.grantee<>c.relowner) AS tables_allowed`);
 const owners=await db.query<OwnerRow>(`SELECT c.relname AS table_name,pg_get_userbyid(c.relowner) AS owner_name,current_user::text AS expected_owner FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='ls_group_admin' AND c.relname IN ('draft_meeting_revisions','draft_meeting_operations') ORDER BY c.relname`);
 const actualColumns=columns.rows.map(row=>[row.table_name,row.column_name,row.data_type,row.not_null,row.default_expression] as const);
 const missingStructural=constraints.filter(spec=>!constraintRows.rows.some(row=>row.schema_name===spec[0]&&row.table_name===spec[1]&&row.name===spec[2]&&row.type===spec[3]&&same(row.local_columns,spec[4])&&row.reference_schema===spec[5]&&row.reference_table===spec[6]&&same(row.reference_columns,spec[7]))).map(spec=>spec[2]);
 const missingChecks=Object.entries(checks).filter(([name,pattern])=>!constraintRows.rows.some(row=>row.name===name&&row.type==='c'&&pattern.test(row.definition))).map(([name])=>name);
 const structural=missingStructural.length===0&&missingChecks.length===0&&constraintRows.rows.length===19;
 const triggerReady=triggers.rows.length===2&&triggers.rows.every(row=>['O','A'].includes(row.enabled)&&row.function_name==='reject_mutation')&&['draft_meeting_revisions_immutable','draft_meeting_operations_immutable'].every(name=>triggers.rows.some(row=>row.name===name));
 const indexReady=indexes.rows.length===1&&indexes.rows[0]!.valid&&indexes.rows[0]!.ready&&indexes.rows[0]!.live&&/\(workspace_id, draft_group_id, occurrence_id, created_at, id\)/i.test(indexes.rows[0]!.definition);
 const columnsReady=same(actualColumns,expectedColumns),permissionsReady=permissions.rows[0]?.tables_allowed===true,ownerNames=owners.rows.map(row=>row.table_name),owner=owners.rows[0]?.expected_owner,ownersReady=same(ownerNames,['draft_meeting_operations','draft_meeting_revisions'])&&!!owner&&owners.rows.every(row=>row.owner_name===owner);
 if(!columnsReady||!structural||!triggerReady||!indexReady||!permissionsReady||!ownersReady)throw Error(`DRAFT_GROUP_MEETINGS_SCHEMA_STATE_CONFLICT:columns=${columnsReady}:constraints=${structural}:${constraintRows.rows.length}:missing=${[...missingStructural,...missingChecks].join(',')||'none'}:triggers=${triggerReady}:index=${indexReady}:permissions=${permissionsReady}:owners=${ownersReady}`);
 const counts=await db.query<{revision_rows:number;operation_rows:number}>(`SELECT (SELECT count(*)::int FROM ls_group_admin.draft_meeting_revisions) AS revision_rows,(SELECT count(*)::int FROM ls_group_admin.draft_meeting_operations) AS operation_rows`),row=counts.rows[0];
 const catalogDigest=createHash('sha256').update(canonical({predecessor,predecessorOwnership,columns:columns.rows,constraints:constraintRows.rows,triggers:triggers.rows,indexes:indexes.rows,permissions:permissions.rows,owners:owners.rows})).digest('hex');
 return {stage:1,catalogDigest,revisionRows:row?.revision_rows??0,operationRows:row?.operation_rows??0};
}

export function draftGroupMeetingsStateDigest(history:readonly AppliedMigration[],snapshot:DraftGroupMeetingsReleaseSnapshot):string{return createHash('sha256').update(canonical({history,snapshot})).digest('hex');}
export function draftGroupMeetingsPlan(files:readonly Migration[],history:readonly AppliedMigration[],snapshot:DraftGroupMeetingsReleaseSnapshot){const scoped=draftGroupMeetingsMigrationInventory(files),pending=planMigrations(scoped,history),expected=snapshot.stage===0?[DRAFT_GROUP_MEETINGS_MIGRATION.name]:[];if(!same(pending.map(item=>item.name),expected))throw Error('DRAFT_GROUP_MEETINGS_LEDGER_STATE_CONFLICT');return {stage:snapshot.stage,pending};}
