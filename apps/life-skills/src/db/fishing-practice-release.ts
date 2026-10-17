import {createHash} from 'node:crypto';
import {INQUIRY_OUTBOX_MIGRATION,exactInquiryOutbox} from './inquiry-outbox-history.ts';
import {lstat,readFile,readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {planMigrations,type AppliedMigration,type Migration} from './migration-plan.ts';
import {readPublicGroupApplicationsReleaseSnapshot} from './public-group-applications-release.ts';

export const FISHING_PRACTICE_BASELINE={name:'0131_ls_public_group_applications.sql',sha256:'76af0c01649a67e1ddffeda5e8f93e3fb39ef03436465f456f59f3d9a7a9050c'} as const;
export const FISHING_PRACTICE_MIGRATION={name:'0132_ls_fishing_practice_revisions.sql',sha256:'5d01872a0304d0dc9af14afdd660b470000c6cb99752239bf2fab3c00579eebf'} as const;
export const FISHING_PRACTICE_SOURCE_PATHS=[
 'package.json','migrations/manifest.json','migrations/0131_ls_public_group_applications.sql','migrations/0135_ls_public_inquiry_email_outbox.sql','migrations/0132_ls_fishing_practice_revisions.sql',
 'scripts/release-public-group-applications.ts','scripts/release-fishing-practice.ts',
] as const;
export const FISHING_PRACTICE_SOURCE_ROOTS=['src','public/groups'] as const;
type SourceNode={isSymbolicLink():boolean;isFile():boolean;isDirectory():boolean};
export function assertFishingPracticeSourceNode(path:string,expected:'file'|'directory',node:SourceNode):void{if(node.isSymbolicLink())throw Error('FISHING_PRACTICE_SOURCE_SYMLINK_REJECTED');if((expected==='file'&&!node.isFile())||(expected==='directory'&&!node.isDirectory()))throw Error('FISHING_PRACTICE_SOURCE_TYPE_REJECTED:'+path);}
export async function collectFishingPracticeSourceEntries(appRoot:URL,fixedPaths:readonly string[]=FISHING_PRACTICE_SOURCE_PATHS,sourceRoots:readonly string[]=FISHING_PRACTICE_SOURCE_ROOTS):Promise<{path:string;bytes:Buffer}[]>{
 const entries:{path:string;bytes:Buffer}[]=[];
 for(const path of fixedPaths){const url=new URL(path,appRoot);assertFishingPracticeSourceNode(path,'file',await lstat(fileURLToPath(url)));entries.push({path,bytes:await readFile(url)});}
 const walk=async(relativeDirectory:string):Promise<void>=>{const directory=new URL(relativeDirectory+'/',appRoot),children=(await readdir(fileURLToPath(directory),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name));for(const child of children){const relative=relativeDirectory+'/'+child.name;if(child.isSymbolicLink())throw Error('FISHING_PRACTICE_SOURCE_SYMLINK_REJECTED');if(child.isDirectory())await walk(relative);else{assertFishingPracticeSourceNode(relative,'file',child);entries.push({path:relative,bytes:await readFile(new URL(relative,appRoot))});}}};
 for(const root of sourceRoots){assertFishingPracticeSourceNode(root,'directory',await lstat(fileURLToPath(new URL(root,appRoot))));await walk(root);}return entries;
}

export interface FishingPracticeReleaseQuery{query<R extends object=Record<string,unknown>>(sql:string,values?:readonly unknown[]):Promise<{rows:R[]}>}
type ColumnRow={table_name:string;column_name:string;data_type:string;not_null:boolean;default_expression:string|null};
type ConstraintRow={schema_name:string;table_name:string;name:string;type:string;definition:string;validated:boolean;local_columns:string[];reference_schema:string|null;reference_table:string|null;reference_columns:string[]};
type TriggerRow={table_name:string;name:string;function_schema:string;function_name:string;definition:string;trigger_type:number;enabled:string};
type IndexRow={name:string;definition:string;valid:boolean;ready:boolean;live:boolean};
type OwnerRow={table_name:string;owner_name:string;expected_owner:string};
export type FishingPracticeReleaseSnapshot={stage:0|1;catalogDigest:string;revisionRows:number;operationRows:number};

const expectedColumns=[
 ['fishing_practice_operations','workspace_id','uuid',true,null],['fishing_practice_operations','operation_id','uuid',true,null],['fishing_practice_operations','recorded_by','uuid',true,null],['fishing_practice_operations','request_digest','text',true,null],['fishing_practice_operations','practice_revision_id','uuid',true,null],['fishing_practice_operations','created_at','timestamp with time zone',true,'clock_timestamp()'],
 ['fishing_practice_revisions','workspace_id','uuid',true,null],['fishing_practice_revisions','id','uuid',true,null],['fishing_practice_revisions','draft_group_id','uuid',true,null],['fishing_practice_revisions','proposed_placement_id','uuid',true,null],['fishing_practice_revisions','program_key','text',true,null],['fishing_practice_revisions','module_key','text',true,null],['fishing_practice_revisions','evidence_state','text',true,null],['fishing_practice_revisions','note_ciphertext','text',true,null],['fishing_practice_revisions','previous_revision_id','uuid',false,null],['fishing_practice_revisions','recorded_by','uuid',true,null],['fishing_practice_revisions','request_digest','text',true,null],['fishing_practice_revisions','created_at','timestamp with time zone',true,null],
] as const;
const structuralConstraints=[
 ['fishing_practice_operations','fishing_practice_operations_pkey','p',['workspace_id','operation_id'],null,null,[]],
 ['fishing_practice_operations','fishing_practice_operations_recorded_by_fkey','f',['workspace_id','recorded_by'],'ls_identity','accounts',['workspace_id','id']],
 ['fishing_practice_operations','fishing_practice_operations_revision_fkey','f',['workspace_id','practice_revision_id','request_digest'],'ls_group_admin','fishing_practice_revisions',['workspace_id','id','request_digest']],
 ['fishing_practice_revisions','fishing_practice_revisions_identity_key','u',['workspace_id','id','draft_group_id','proposed_placement_id','module_key'],null,null,[]],
 ['fishing_practice_revisions','fishing_practice_revisions_one_successor','u',['workspace_id','previous_revision_id'],null,null,[]],
 ['fishing_practice_revisions','fishing_practice_revisions_pkey','p',['workspace_id','id'],null,null,[]],
 ['fishing_practice_revisions','fishing_practice_revisions_placement_fkey','f',['workspace_id','proposed_placement_id','draft_group_id'],'ls_group_admin','proposed_placements',['workspace_id','id','draft_group_id']],
 ['fishing_practice_revisions','fishing_practice_revisions_previous_fkey','f',['workspace_id','previous_revision_id','draft_group_id','proposed_placement_id','module_key'],'ls_group_admin','fishing_practice_revisions',['workspace_id','id','draft_group_id','proposed_placement_id','module_key']],
 ['fishing_practice_revisions','fishing_practice_revisions_receipt_key','u',['workspace_id','id','request_digest'],null,null,[]],
 ['fishing_practice_revisions','fishing_practice_revisions_recorded_by_fkey','f',['workspace_id','recorded_by'],'ls_identity','accounts',['workspace_id','id']],
] as const;
const checkNames=['fishing_practice_operations_request_digest_check','fishing_practice_revisions_evidence_state_check','fishing_practice_revisions_module_key_check','fishing_practice_revisions_note_ciphertext_check','fishing_practice_revisions_program_key_check','fishing_practice_revisions_request_digest_check'] as const;
const checkDefinitions:Record<(typeof checkNames)[number],RegExp>={
 fishing_practice_operations_request_digest_check:/^CHECK \(request_digest ~ '\^\[a-f0-9\]\{64\}\$'::text\)$/i,
 fishing_practice_revisions_evidence_state_check:/^CHECK \(evidence_state = ANY \(ARRAY\['practice_observed'::text, 'no_evidence_yet'::text\]\)\)$/i,
 fishing_practice_revisions_module_key_check:/^CHECK \(module_key = ANY \(ARRAY\['knots'::text, 'rod_rigging'::text, 'terminal_tackle'::text, 'field_casting'::text, 'fish_fighting'::text, 'equipment_selection'::text\]\)\)$/i,
 fishing_practice_revisions_note_ciphertext_check:/^CHECK \(length\(note_ciphertext\) > 0\)$/i,
 fishing_practice_revisions_program_key_check:/^CHECK \(program_key = 'fishing_lessons'::text\)$/i,
 fishing_practice_revisions_request_digest_check:/^CHECK \(request_digest ~ '\^\[a-f0-9\]\{64\}\$'::text\)$/i,
};
const same=(a:readonly unknown[],b:readonly unknown[])=>JSON.stringify(a)===JSON.stringify(b);
const canonical=(value:unknown)=>JSON.stringify(value,(_,item)=>item instanceof Date?item.toISOString():item);
export const fishingPracticeSourceBundle=(entries:readonly {path:string;bytes:Buffer|string}[])=>createHash('sha256').update(canonical(entries.map(entry=>({path:entry.path,sha256:createHash('sha256').update(entry.bytes).digest('hex')})).sort((a,b)=>a.path.localeCompare(b.path)))).digest('hex');

export function fishingPracticeMigrationInventory(files:readonly Migration[]):readonly Migration[]{
 const sorted=[...files].sort((a,b)=>a.name.localeCompare(b.name)),end=sorted.findIndex(file=>file.name===FISHING_PRACTICE_MIGRATION.name&&file.checksum===FISHING_PRACTICE_MIGRATION.sha256);
 if(end<0)throw Error('FISHING_PRACTICE_MIGRATION_SET_MISMATCH');
 const scoped=sorted.slice(0,end+1),baseline=scoped.at(-2),outbox=sorted.find(f=>f.name===INQUIRY_OUTBOX_MIGRATION.name);
 if(baseline?.name!==FISHING_PRACTICE_BASELINE.name||baseline.checksum!==FISHING_PRACTICE_BASELINE.sha256||outbox&&!exactInquiryOutbox(outbox))throw Error('FISHING_PRACTICE_MIGRATION_SET_MISMATCH');
 // Declare an already-applied inquiry outbox instead of hiding its ledger row.
 // The planner permits only this exact early addition; 0133/0134 stay outside
 // this independently admitted practice-only inventory.
 return outbox?[...scoped,outbox]:scoped;
}

/** Recheck the frozen 0131 predecessor while hiding only 0132-owned catalog
 * objects from older broad ls_group_admin inventories. */
async function readFrozenPublicGroupApplicationsPredecessor(db:FishingPracticeReleaseQuery){
 return readPublicGroupApplicationsReleaseSnapshot({query:async<R extends object>(sql:string,values:readonly unknown[]=[])=>{
  const result=await db.query<Record<string,unknown>>(sql,values);let rows=result.rows;
  if(sql.includes('FROM pg_constraint k')&&sql.includes("n.nspname='ls_group_admin'"))rows=rows.filter(row=>!(row.schema_name==='ls_group_admin'&&row.table_name==='proposed_placements'&&row.name==='proposed_placements_fishing_practice_identity_key'&&row.type==='u'&&same(row.local_columns as unknown[],['workspace_id','id','draft_group_id'])));
  if(sql.includes('FROM pg_trigger t')&&sql.includes("n.nspname='ls_group_admin'"))rows=rows.filter(row=>row.table_name!=='fishing_practice_revisions'&&row.table_name!=='fishing_practice_operations');
  return {rows:rows as R[]};
 }});
}

export async function readFishingPracticeReleaseSnapshot(db:FishingPracticeReleaseQuery):Promise<FishingPracticeReleaseSnapshot>{
 const existence=await db.query<{successor_absent:boolean}>(`SELECT to_regclass('ls_group_admin.fishing_practice_revisions') IS NULL
  AND to_regclass('ls_group_admin.fishing_practice_operations') IS NULL
  AND NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('ls_group_admin.proposed_placements') AND conname='proposed_placements_fishing_practice_identity_key') AS successor_absent`);
 let predecessor;try{predecessor=await readFrozenPublicGroupApplicationsPredecessor(db);if(predecessor.stage!==1)throw Error('PUBLIC_GROUP_APPLICATIONS_NOT_READY');}catch(error){throw Error(`FISHING_PRACTICE_BASELINE_SCHEMA_CONFLICT:${error instanceof Error?error.message:'UNKNOWN'}`);}
 if(existence.rows[0]?.successor_absent)return {stage:0,catalogDigest:createHash('sha256').update(canonical({predecessor,successorAbsent:true})).digest('hex'),revisionRows:0,operationRows:0};
 const columns=await db.query<ColumnRow>(`SELECT c.relname AS table_name,a.attname AS column_name,format_type(a.atttypid,a.atttypmod) AS data_type,a.attnotnull AS not_null,pg_get_expr(d.adbin,d.adrelid) AS default_expression FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE n.nspname='ls_group_admin' AND c.relname IN ('fishing_practice_revisions','fishing_practice_operations') AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname,a.attnum`);
 const constraints=await db.query<ConstraintRow>(`SELECT n.nspname AS schema_name,c.relname AS table_name,k.conname AS name,k.contype::text AS type,pg_get_constraintdef(k.oid,true) AS definition,k.convalidated AS validated,ARRAY(SELECT a.attname::text FROM unnest(k.conkey) WITH ORDINALITY x(attnum,ord) JOIN pg_attribute a ON a.attrelid=k.conrelid AND a.attnum=x.attnum ORDER BY x.ord) AS local_columns,rn.nspname AS reference_schema,rc.relname AS reference_table,COALESCE(ARRAY(SELECT a.attname::text FROM unnest(k.confkey) WITH ORDINALITY x(attnum,ord) JOIN pg_attribute a ON a.attrelid=k.confrelid AND a.attnum=x.attnum ORDER BY x.ord),'{}') AS reference_columns FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_class rc ON rc.oid=k.confrelid LEFT JOIN pg_namespace rn ON rn.oid=rc.relnamespace WHERE k.contype<>'n' AND n.nspname='ls_group_admin' AND c.relname IN ('fishing_practice_revisions','fishing_practice_operations') ORDER BY c.relname,k.conname`);
 const placementConstraint=await db.query<ConstraintRow>(`SELECT n.nspname AS schema_name,c.relname AS table_name,k.conname AS name,k.contype::text AS type,pg_get_constraintdef(k.oid,true) AS definition,k.convalidated AS validated,ARRAY(SELECT a.attname::text FROM unnest(k.conkey) WITH ORDINALITY x(attnum,ord) JOIN pg_attribute a ON a.attrelid=k.conrelid AND a.attnum=x.attnum ORDER BY x.ord) AS local_columns,NULL::text AS reference_schema,NULL::text AS reference_table,'{}'::text[] AS reference_columns FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='ls_group_admin' AND c.relname='proposed_placements' AND k.conname='proposed_placements_fishing_practice_identity_key'`);
 const triggers=await db.query<TriggerRow>(`SELECT c.relname AS table_name,t.tgname AS name,pn.nspname AS function_schema,p.proname AS function_name,pg_get_triggerdef(t.oid,true) AS definition,t.tgtype::int AS trigger_type,t.tgenabled::text AS enabled FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace pn ON pn.oid=p.pronamespace WHERE n.nspname='ls_group_admin' AND c.relname IN ('fishing_practice_revisions','fishing_practice_operations') AND NOT t.tgisinternal ORDER BY c.relname,t.tgname`);
 const indexes=await db.query<IndexRow>(`SELECT c.relname AS name,pg_get_indexdef(i.indexrelid) AS definition,i.indisvalid AS valid,i.indisready AS ready,i.indislive AS live FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indexrelid IN (to_regclass('ls_group_admin.fishing_practice_revisions_one_root'),to_regclass('ls_group_admin.fishing_practice_revisions_history')) ORDER BY c.relname`);
 const permissions=await db.query<{allowed:boolean}>(`SELECT NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace,LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) acl WHERE n.nspname='ls_group_admin' AND c.relname IN ('fishing_practice_revisions','fishing_practice_operations') AND acl.grantee<>c.relowner) AS allowed`);
 const owners=await db.query<OwnerRow>(`SELECT c.relname AS table_name,pg_get_userbyid(c.relowner) AS owner_name,current_user::text AS expected_owner FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='ls_group_admin' AND c.relname IN ('fishing_practice_revisions','fishing_practice_operations') ORDER BY c.relname`);
 const actualColumns=columns.rows.map(row=>[row.table_name,row.column_name,row.data_type,row.not_null,row.default_expression] as const);
 const structural=structuralConstraints.every(spec=>constraints.rows.some(row=>row.schema_name==='ls_group_admin'&&row.table_name===spec[0]&&row.name===spec[1]&&row.type===spec[2]&&row.validated&&same(row.local_columns,spec[3])&&row.reference_schema===spec[4]&&row.reference_table===spec[5]&&same(row.reference_columns,spec[6])))&&checkNames.every(name=>constraints.rows.some(row=>row.name===name&&row.type==='c'&&row.validated&&checkDefinitions[name].test(row.definition)))&&constraints.rows.length===16;
 const placementReady=placementConstraint.rows.length===1&&placementConstraint.rows[0]?.schema_name==='ls_group_admin'&&placementConstraint.rows[0]?.table_name==='proposed_placements'&&placementConstraint.rows[0]?.type==='u'&&placementConstraint.rows[0]?.validated===true&&same(placementConstraint.rows[0]?.local_columns??[],['workspace_id','id','draft_group_id']);
 const triggerReady=triggers.rows.length===2&&['fishing_practice_revisions','fishing_practice_operations'].every(table=>triggers.rows.some(row=>row.table_name===table&&row.name===table+'_immutable'&&['O','A'].includes(row.enabled)&&row.function_schema==='ls_group_admin'&&row.function_name==='reject_mutation'&&row.trigger_type===27&&new RegExp('^CREATE TRIGGER '+table+'_immutable BEFORE (?:UPDATE OR DELETE|DELETE OR UPDATE) ON ls_group_admin\\.'+table+' FOR EACH ROW EXECUTE FUNCTION ls_group_admin\\.reject_mutation\\(\\)$','i').test(row.definition)));
 const indexesReady=indexes.rows.length===2&&indexes.rows.every(row=>row.valid&&row.ready&&row.live)&&indexes.rows.some(row=>row.name==='fishing_practice_revisions_one_root'&&/\(workspace_id, proposed_placement_id, module_key\).*WHERE \(previous_revision_id IS NULL\)/i.test(row.definition))&&indexes.rows.some(row=>row.name==='fishing_practice_revisions_history'&&/\(workspace_id, draft_group_id, proposed_placement_id, module_key, created_at, id\)/i.test(row.definition));
 const owner=owners.rows[0]?.expected_owner,ownersReady=same(owners.rows.map(row=>row.table_name),['fishing_practice_operations','fishing_practice_revisions'])&&!!owner&&owners.rows.every(row=>row.owner_name===owner);
 if(!same(actualColumns,expectedColumns)||!structural||!placementReady||!triggerReady||!indexesReady||permissions.rows[0]?.allowed!==true||!ownersReady)throw Error(`FISHING_PRACTICE_SCHEMA_STATE_CONFLICT:columns=${same(actualColumns,expectedColumns)}:constraints=${structural}:${constraints.rows.length}:placement=${placementReady}:triggers=${triggerReady}:indexes=${indexesReady}:permissions=${permissions.rows[0]?.allowed===true}:owners=${ownersReady}`);
 const counts=await db.query<{revision_rows:number;operation_rows:number}>(`SELECT (SELECT count(*)::int FROM ls_group_admin.fishing_practice_revisions) AS revision_rows,(SELECT count(*)::int FROM ls_group_admin.fishing_practice_operations) AS operation_rows`),row=counts.rows[0];
 return {stage:1,catalogDigest:createHash('sha256').update(canonical({predecessor,columns:columns.rows,constraints:constraints.rows,placementConstraint:placementConstraint.rows,triggers:triggers.rows,indexes:indexes.rows,permissions:permissions.rows,owners:owners.rows})).digest('hex'),revisionRows:row?.revision_rows??0,operationRows:row?.operation_rows??0};
}

export const fishingPracticeStateDigest=(history:readonly AppliedMigration[],snapshot:FishingPracticeReleaseSnapshot)=>createHash('sha256').update(canonical({history,snapshot})).digest('hex');
export function fishingPracticePlan(files:readonly Migration[],history:readonly AppliedMigration[],snapshot:FishingPracticeReleaseSnapshot){const scoped=fishingPracticeMigrationInventory(files),pending=planMigrations(scoped,history),expected=snapshot.stage===0?[FISHING_PRACTICE_MIGRATION.name]:[];if(!same(pending.map(item=>item.name),expected))throw Error('FISHING_PRACTICE_LEDGER_STATE_CONFLICT');return {stage:snapshot.stage,pending};}
