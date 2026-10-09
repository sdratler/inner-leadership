import {createHash} from 'node:crypto';
import {lstat,readFile,readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {planMigrations,type AppliedMigration,type Migration} from './migration-plan.ts';
import {readDraftGroupMeetingsReleaseSnapshot} from './draft-group-meetings-release.ts';

export const PUBLIC_GROUP_APPLICATIONS_BASELINE={name:'0130_ls_draft_group_meetings.sql',sha256:'106320890c774544cee83648d15243decfdef7061c7e14aea532d89ac5be23e7'} as const;
export const PUBLIC_GROUP_APPLICATIONS_MIGRATION={name:'0131_ls_public_group_applications.sql',sha256:'76af0c01649a67e1ddffeda5e8f93e3fb39ef03436465f456f59f3d9a7a9050c'} as const;
export const PUBLIC_GROUP_APPLICATIONS_SOURCE_PATHS=[
 'package.json','migrations/manifest.json','migrations/0130_ls_draft_group_meetings.sql','migrations/0131_ls_public_group_applications.sql',
 'scripts/release-draft-group-meetings.ts','scripts/release-public-group-applications.ts',
] as const;
export const PUBLIC_GROUP_APPLICATIONS_SOURCE_ROOTS=['src'] as const;
type SourceNode={isSymbolicLink():boolean;isFile():boolean;isDirectory():boolean};
export function assertPublicGroupApplicationsSourceNode(path:string,expected:'file'|'directory',node:SourceNode):void{if(node.isSymbolicLink())throw Error('PUBLIC_GROUP_APPLICATIONS_SOURCE_SYMLINK_REJECTED');if((expected==='file'&&!node.isFile())||(expected==='directory'&&!node.isDirectory()))throw Error('PUBLIC_GROUP_APPLICATIONS_SOURCE_TYPE_REJECTED:'+path);}
export async function collectPublicGroupApplicationsSourceEntries(appRoot:URL,fixedPaths:readonly string[]=PUBLIC_GROUP_APPLICATIONS_SOURCE_PATHS,sourceRoots:readonly string[]=PUBLIC_GROUP_APPLICATIONS_SOURCE_ROOTS):Promise<{path:string;bytes:Buffer}[]>{
 const entries:{path:string;bytes:Buffer}[]=[];
 for(const path of fixedPaths){const url=new URL(path,appRoot);assertPublicGroupApplicationsSourceNode(path,'file',await lstat(fileURLToPath(url)));entries.push({path,bytes:await readFile(url)});}
 const walk=async(relativeDirectory:string):Promise<void>=>{const directory=new URL(relativeDirectory+'/',appRoot),children=(await readdir(fileURLToPath(directory),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name));for(const child of children){const relative=relativeDirectory+'/'+child.name;if(child.isSymbolicLink())throw Error('PUBLIC_GROUP_APPLICATIONS_SOURCE_SYMLINK_REJECTED');if(child.isDirectory())await walk(relative);else{assertPublicGroupApplicationsSourceNode(relative,'file',child);entries.push({path:relative,bytes:await readFile(new URL(relative,appRoot))});}}};
 for(const root of sourceRoots){assertPublicGroupApplicationsSourceNode(root,'directory',await lstat(fileURLToPath(new URL(root,appRoot))));await walk(root);}return entries;
}

export interface PublicGroupApplicationsReleaseQuery{query<R extends object=Record<string,unknown>>(sql:string,values?:readonly unknown[]):Promise<{rows:R[]}>}
type ColumnRow={table_name:string;column_name:string;data_type:string;not_null:boolean;default_expression:string|null};
type ConstraintRow={schema_name:string;table_name:string;name:string;type:string;definition:string;local_columns:string[];reference_schema:string|null;reference_table:string|null;reference_columns:string[]};
type TriggerRow={table_name:string;name:string;function_name:string;enabled:string};
type IndexRow={name:string;definition:string;valid:boolean;ready:boolean;live:boolean};
type OwnerRow={table_name:string;owner_name:string;expected_owner:string};
type FunctionRow={name:string;definition:string;security_definer:boolean;public_execute:boolean};
export type PublicGroupApplicationsReleaseSnapshot={stage:0|1;catalogDigest:string;applicationRows:number;operationRows:number};

const expectedColumns=[
 ['public_application_operations','workspace_id','uuid',true,null],['public_application_operations','operation_id','uuid',true,null],['public_application_operations','request_digest','text',true,null],['public_application_operations','application_id','uuid',true,null],['public_application_operations','created_at','timestamp with time zone',true,'clock_timestamp()'],
 ['public_applications','workspace_id','uuid',true,null],['public_applications','id','uuid',true,null],['public_applications','contact_digest','text',true,null],['public_applications','request_digest','text',true,null],['public_applications','payload_ciphertext','text',true,null],['public_applications','notice_version','text',true,null],['public_applications','notice_language','text',true,null],['public_applications','received_at','timestamp with time zone',true,null],
] as const;
const structuralConstraints=[
 ['public_application_operations','public_application_operations_pkey','p',['workspace_id','operation_id'],null,null,[]],
 ['public_application_operations','public_application_operations_workspace_id_application_id__fkey','f',['workspace_id','application_id','request_digest'],'ls_service_interest','public_applications',['workspace_id','id','request_digest']],
 ['public_applications','public_applications_pkey','p',['workspace_id','id'],null,null,[]],
 ['public_applications','public_applications_workspace_id_fkey','f',['workspace_id'],'ls_identity','workspaces',['id']],
 ['public_applications','public_applications_workspace_id_id_request_digest_key','u',['workspace_id','id','request_digest'],null,null,[]],
 ['public_applications','public_applications_workspace_id_request_digest_key','u',['workspace_id','request_digest'],null,null,[]],
] as const;
const checkNames=['public_application_operations_request_digest_check','public_applications_contact_digest_check','public_applications_notice_language_check','public_applications_notice_version_check','public_applications_payload_ciphertext_check','public_applications_request_digest_check'] as const;
const same=(a:readonly unknown[],b:readonly unknown[])=>JSON.stringify(a)===JSON.stringify(b);
const canonical=(value:unknown)=>JSON.stringify(value,(_,item)=>item instanceof Date?item.toISOString():item);
export const publicGroupApplicationsSourceBundle=(entries:readonly {path:string;bytes:Buffer|string}[])=>createHash('sha256').update(canonical(entries.map(entry=>({path:entry.path,sha256:createHash('sha256').update(entry.bytes).digest('hex')})).sort((a,b)=>a.path.localeCompare(b.path)))).digest('hex');

export function publicGroupApplicationsMigrationInventory(files:readonly Migration[]):readonly Migration[]{
 const sorted=[...files].sort((a,b)=>a.name.localeCompare(b.name)),end=sorted.findIndex(file=>file.name===PUBLIC_GROUP_APPLICATIONS_MIGRATION.name&&file.checksum===PUBLIC_GROUP_APPLICATIONS_MIGRATION.sha256);
 if(end<0)throw Error('PUBLIC_GROUP_APPLICATIONS_MIGRATION_SET_MISMATCH');const scoped=sorted.slice(0,end+1),baseline=scoped.at(-2),migration=scoped.at(-1);
 if(baseline?.name!==PUBLIC_GROUP_APPLICATIONS_BASELINE.name||baseline.checksum!==PUBLIC_GROUP_APPLICATIONS_BASELINE.sha256||migration?.name!==PUBLIC_GROUP_APPLICATIONS_MIGRATION.name||migration.checksum!==PUBLIC_GROUP_APPLICATIONS_MIGRATION.sha256)throw Error('PUBLIC_GROUP_APPLICATIONS_MIGRATION_SET_MISMATCH');return scoped;
}

export async function readPublicGroupApplicationsReleaseSnapshot(db:PublicGroupApplicationsReleaseQuery):Promise<PublicGroupApplicationsReleaseSnapshot>{
 const existence=await db.query<{successor_absent:boolean}>(`SELECT to_regclass('ls_service_interest.public_applications') IS NULL
  AND to_regclass('ls_service_interest.public_application_operations') IS NULL
  AND to_regclass('ls_service_interest.public_group_application_recent') IS NULL
  AND to_regclass('ls_service_interest.public_group_application_contact_recent') IS NULL
  AND to_regprocedure('ls_service_interest.reject_public_application_mutation()') IS NULL AS successor_absent`);
 let predecessor;try{predecessor=await readDraftGroupMeetingsReleaseSnapshot(db);if(predecessor.stage!==1)throw Error('DRAFT_GROUP_MEETINGS_NOT_READY');}catch(error){throw Error(`PUBLIC_GROUP_APPLICATIONS_BASELINE_SCHEMA_CONFLICT:${error instanceof Error?error.message:'UNKNOWN'}`);}
 if(existence.rows[0]?.successor_absent)return {stage:0,catalogDigest:createHash('sha256').update(canonical({predecessor,successorAbsent:true})).digest('hex'),applicationRows:0,operationRows:0};
 const columns=await db.query<ColumnRow>(`SELECT c.relname AS table_name,a.attname AS column_name,format_type(a.atttypid,a.atttypmod) AS data_type,a.attnotnull AS not_null,pg_get_expr(d.adbin,d.adrelid) AS default_expression FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE n.nspname='ls_service_interest' AND c.relname IN ('public_applications','public_application_operations') AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname,a.attnum`);
 const constraints=await db.query<ConstraintRow>(`SELECT n.nspname AS schema_name,c.relname AS table_name,k.conname AS name,k.contype::text AS type,pg_get_constraintdef(k.oid,true) AS definition,ARRAY(SELECT a.attname::text FROM unnest(k.conkey) WITH ORDINALITY x(attnum,ord) JOIN pg_attribute a ON a.attrelid=k.conrelid AND a.attnum=x.attnum ORDER BY x.ord) AS local_columns,rn.nspname AS reference_schema,rc.relname AS reference_table,COALESCE(ARRAY(SELECT a.attname::text FROM unnest(k.confkey) WITH ORDINALITY x(attnum,ord) JOIN pg_attribute a ON a.attrelid=k.confrelid AND a.attnum=x.attnum ORDER BY x.ord),'{}') AS reference_columns FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_class rc ON rc.oid=k.confrelid LEFT JOIN pg_namespace rn ON rn.oid=rc.relnamespace WHERE k.contype<>'n' AND n.nspname='ls_service_interest' AND c.relname IN ('public_applications','public_application_operations') ORDER BY c.relname,k.conname`);
 const triggers=await db.query<TriggerRow>(`SELECT c.relname AS table_name,t.tgname AS name,p.proname AS function_name,t.tgenabled::text AS enabled FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid WHERE n.nspname='ls_service_interest' AND c.relname IN ('public_applications','public_application_operations') AND NOT t.tgisinternal ORDER BY c.relname,t.tgname`);
 const indexes=await db.query<IndexRow>(`SELECT c.relname AS name,pg_get_indexdef(i.indexrelid) AS definition,i.indisvalid AS valid,i.indisready AS ready,i.indislive AS live FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indexrelid IN (to_regclass('ls_service_interest.public_group_application_recent'),to_regclass('ls_service_interest.public_group_application_contact_recent')) ORDER BY c.relname`);
 const functions=await db.query<FunctionRow>(`SELECT p.proname AS name,pg_get_functiondef(p.oid) AS definition,p.prosecdef AS security_definer,EXISTS(SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) acl WHERE acl.grantee=0 AND acl.privilege_type='EXECUTE') AS public_execute FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='ls_service_interest' AND p.proname='reject_public_application_mutation'`);
 const permissions=await db.query<{allowed:boolean}>(`SELECT NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace,LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) acl WHERE n.nspname='ls_service_interest' AND c.relname IN ('public_applications','public_application_operations') AND acl.grantee<>c.relowner) AS allowed`);
 const owners=await db.query<OwnerRow>(`SELECT c.relname AS table_name,pg_get_userbyid(c.relowner) AS owner_name,current_user::text AS expected_owner FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='ls_service_interest' AND c.relname IN ('public_applications','public_application_operations') ORDER BY c.relname`);
 const actualColumns=columns.rows.map(row=>[row.table_name,row.column_name,row.data_type,row.not_null,row.default_expression] as const);
 const structural=structuralConstraints.every(spec=>constraints.rows.some(row=>row.schema_name==='ls_service_interest'&&row.table_name===spec[0]&&row.name===spec[1]&&row.type===spec[2]&&same(row.local_columns,spec[3])&&row.reference_schema===spec[4]&&row.reference_table===spec[5]&&same(row.reference_columns,spec[6])))&&checkNames.every(name=>constraints.rows.some(row=>row.name===name&&row.type==='c'))&&constraints.rows.length===12;
 const triggerReady=triggers.rows.length===2&&triggers.rows.every(row=>['O','A'].includes(row.enabled)&&row.function_name==='reject_public_application_mutation')&&['public_group_application_immutable','public_group_application_operation_immutable'].every(name=>triggers.rows.some(row=>row.name===name));
 const indexesReady=indexes.rows.length===2&&indexes.rows.every(row=>row.valid&&row.ready&&row.live)&&indexes.rows.some(row=>row.name==='public_group_application_recent'&&/\(workspace_id, received_at DESC, id DESC\)/i.test(row.definition))&&indexes.rows.some(row=>row.name==='public_group_application_contact_recent'&&/\(workspace_id, contact_digest, received_at DESC\)/i.test(row.definition));
 const functionReady=functions.rows.length===1&&!functions.rows[0]!.security_definer&&!functions.rows[0]!.public_execute&&/public_group_application_append_only/.test(functions.rows[0]!.definition);
 const owner=owners.rows[0]?.expected_owner,ownersReady=same(owners.rows.map(row=>row.table_name),['public_application_operations','public_applications'])&&!!owner&&owners.rows.every(row=>row.owner_name===owner);
 if(!same(actualColumns,expectedColumns)||!structural||!triggerReady||!indexesReady||!functionReady||permissions.rows[0]?.allowed!==true||!ownersReady)throw Error(`PUBLIC_GROUP_APPLICATIONS_SCHEMA_STATE_CONFLICT:columns=${same(actualColumns,expectedColumns)}:constraints=${structural}:${constraints.rows.length}:triggers=${triggerReady}:indexes=${indexesReady}:function=${functionReady}:permissions=${permissions.rows[0]?.allowed===true}:owners=${ownersReady}`);
 const counts=await db.query<{application_rows:number;operation_rows:number}>(`SELECT (SELECT count(*)::int FROM ls_service_interest.public_applications) AS application_rows,(SELECT count(*)::int FROM ls_service_interest.public_application_operations) AS operation_rows`),row=counts.rows[0];
 return {stage:1,catalogDigest:createHash('sha256').update(canonical({predecessor,columns:columns.rows,constraints:constraints.rows,triggers:triggers.rows,indexes:indexes.rows,functions:functions.rows,permissions:permissions.rows,owners:owners.rows})).digest('hex'),applicationRows:row?.application_rows??0,operationRows:row?.operation_rows??0};
}

export const publicGroupApplicationsStateDigest=(history:readonly AppliedMigration[],snapshot:PublicGroupApplicationsReleaseSnapshot)=>createHash('sha256').update(canonical({history,snapshot})).digest('hex');
export function publicGroupApplicationsPlan(files:readonly Migration[],history:readonly AppliedMigration[],snapshot:PublicGroupApplicationsReleaseSnapshot){const scoped=publicGroupApplicationsMigrationInventory(files),pending=planMigrations(scoped,history),expected=snapshot.stage===0?[PUBLIC_GROUP_APPLICATIONS_MIGRATION.name]:[];if(!same(pending.map(item=>item.name),expected))throw Error('PUBLIC_GROUP_APPLICATIONS_LEDGER_STATE_CONFLICT');return {stage:snapshot.stage,pending};}
