import {createHash} from "node:crypto";
import {planMigrations,type AppliedMigration,type Migration} from "./migration-plan.ts";

export const OWNER_305_BASELINE={name:"0140_ls_fishing_inquiry_followups.sql",sha256:"0d24071314c823f5754c1d5d5637fd18b33cb81d08c45f7a58e95d2bf4c45d46"} as const;
export const OWNER_305_MIGRATION={name:"0141_ls_owner_305_conversations.sql",sha256:"d4c5c6a4e98382c4059e97c6147eae378b0017fd61307df771b1bdbc68b29790"} as const;
export const owner305Hash=(value:string|Buffer)=>createHash("sha256").update(value).digest("hex");
export function owner305SchemaPlan(files:readonly Migration[],history:readonly AppliedMigration[],stage:0|1){
 const sorted=[...files].sort((a,b)=>a.name.localeCompare(b.name)),index=sorted.findIndex(file=>file.name===OWNER_305_MIGRATION.name&&file.checksum===OWNER_305_MIGRATION.sha256);
 if(index<1||sorted[index-1]?.name!==OWNER_305_BASELINE.name||sorted[index-1]?.checksum!==OWNER_305_BASELINE.sha256)throw Error("OWNER_305_SCHEMA_SOURCE_MISMATCH");
 const scoped=sorted.slice(0,index+1),pending=planMigrations(scoped,history),expected=stage===0?[OWNER_305_MIGRATION.name]:[];
 if(JSON.stringify(pending.map(file=>file.name))!==JSON.stringify(expected))throw Error("OWNER_305_SCHEMA_LEDGER_STATE_CONFLICT");return {scoped,pending};
}
export interface Owner305ReleaseQuery{query<T extends object>(sql:string,values?:readonly unknown[]):Promise<{rows:T[]}>}
export async function readOwner305SchemaStage(db:Owner305ReleaseQuery):Promise<0|1>{
 const rows=await db.query<{conversations:string|null;operations:string|null;revisions:string|null}>(`SELECT
  to_regclass('ls_service_interest.owner_305_conversations')::text AS conversations,
  to_regclass('ls_service_interest.owner_305_conversation_operations')::text AS operations,
  to_regclass('ls_service_interest.owner_305_conversation_revisions')::text AS revisions`);
 const row=rows.rows[0];if(!row)throw Error("OWNER_305_SCHEMA_CATALOG_CONFLICT");const names=[row.conversations,row.operations,row.revisions];
 if(names.every(value=>value===null))return 0;if(names.some(value=>value===null))throw Error("OWNER_305_SCHEMA_CATALOG_CONFLICT");
 const state=await db.query<{conversations:number;operations:number;revisions:number;triggers:number;indexes:number;primaryKeys:number;unauthorizedGrants:number}>(`SELECT
  (SELECT count(*)::int FROM ls_service_interest.owner_305_conversations) AS conversations,
  (SELECT count(*)::int FROM ls_service_interest.owner_305_conversation_operations) AS operations,
  (SELECT count(*)::int FROM ls_service_interest.owner_305_conversation_revisions) AS revisions,
  (SELECT count(*)::int FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='ls_service_interest' AND t.tgname IN ('owner_305_conversation_no_edit','owner_305_operation_no_edit','owner_305_revision_no_edit','owner_305_conversation_no_truncate','owner_305_operation_no_truncate','owner_305_revision_no_truncate')
    AND NOT t.tgisinternal AND t.tgenabled IN ('O','A')) AS triggers,
  (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='ls_service_interest'
    AND c.relname IN ('owner_305_conversations_recent','owner_305_conversation_history') AND c.relkind='i') AS indexes,
  (SELECT count(*)::int FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='ls_service_interest' AND k.conname IN ('owner_305_conversations_pkey','owner_305_conversation_operations_pkey','owner_305_conversation_revisions_pkey')) AS "primaryKeys",
  (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace,LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) acl
    WHERE n.nspname='ls_service_interest' AND c.relname IN ('owner_305_conversations','owner_305_conversation_operations','owner_305_conversation_revisions') AND acl.grantee<>c.relowner) AS "unauthorizedGrants"`);
 const value=state.rows[0];if(!value||value.triggers!==6||value.indexes!==2||value.primaryKeys!==3||value.unauthorizedGrants!==0||
  [value.conversations,value.operations,value.revisions].some(count=>!Number.isSafeInteger(count)||count<0))throw Error("OWNER_305_SCHEMA_CATALOG_CONFLICT");
 return 1;
}
