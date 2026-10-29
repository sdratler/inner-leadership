import {planMigrations,type AppliedMigration,type Migration} from "./migration-plan.ts";
import type {Owner305ReleaseQuery} from "./owner-305-schema-release.ts";
import {BNA_COOP_MIGRATION} from "./bna-coop-schema-release.ts";

export const OWNER_305_LINK_MIGRATION={name:"0143_ls_owner_305_inquiry_links.sql",sha256:"63624d56b8692249e8bab3bd68aaf1c8b5596129fac703c47cd25d662048000c"} as const;
export function owner305LinkSchemaPlan(files:readonly Migration[],history:readonly AppliedMigration[],stage:0|1){
 const sorted=[...files].sort((a,b)=>a.name.localeCompare(b.name)),index=sorted.findIndex(file=>file.name===OWNER_305_LINK_MIGRATION.name&&file.checksum===OWNER_305_LINK_MIGRATION.sha256);
 if(index<1||sorted[index-1]?.name!==BNA_COOP_MIGRATION.name||sorted[index-1]?.checksum!==BNA_COOP_MIGRATION.sha256)throw Error("OWNER_305_LINK_SCHEMA_SOURCE_MISMATCH");
 const scoped=sorted.slice(0,index+1),pending=planMigrations(scoped,history),expected=stage===0?[OWNER_305_LINK_MIGRATION.name]:[];
 if(JSON.stringify(pending.map(file=>file.name))!==JSON.stringify(expected))throw Error("OWNER_305_LINK_SCHEMA_LEDGER_STATE_CONFLICT");return {scoped,pending};
}
/** Detect an absent or structurally incomplete link table before release. */
export async function readOwner305LinkSchemaStage(db:Owner305ReleaseQuery):Promise<0|1>{
 const table=await db.query<{exists:boolean}>(`SELECT to_regclass('ls_service_interest.owner_305_inquiry_link_events') IS NOT NULL AS "exists"`);
 if(table.rows.length!==1)throw Error("OWNER_305_LINK_SCHEMA_CATALOG_CONFLICT");if(!table.rows[0]!.exists)return 0;
 const result=await db.query<{columns:number;foreignKeys:number;checks:number;indexes:number;triggers:number}>(`SELECT
  (SELECT count(*)::int FROM information_schema.columns WHERE table_schema='ls_service_interest' AND table_name='owner_305_inquiry_link_events') AS columns,
  (SELECT count(*)::int FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='ls_service_interest' AND r.relname='owner_305_inquiry_link_events' AND c.contype='f' AND c.convalidated) AS "foreignKeys",
  (SELECT count(*)::int FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='ls_service_interest' AND r.relname='owner_305_inquiry_link_events' AND c.contype='c' AND c.convalidated) AS checks,
  (SELECT count(*)::int FROM pg_indexes WHERE schemaname='ls_service_interest' AND tablename='owner_305_inquiry_link_events' AND indexname IN ('owner_305_bna_link_version','owner_305_fishing_link_version','owner_305_inquiry_link_history')) AS indexes,
  (SELECT count(*)::int FROM pg_trigger t JOIN pg_class r ON r.oid=t.tgrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='ls_service_interest' AND r.relname='owner_305_inquiry_link_events' AND NOT t.tgisinternal AND t.tgenabled='O' AND t.tgname IN ('owner_305_inquiry_link_no_edit','owner_305_inquiry_link_no_truncate')) AS triggers`);
 const row=result.rows[0];if(!row||row.columns!==10||row.foreignKeys!==4||row.checks!==3||row.indexes!==3||row.triggers!==2)throw Error("OWNER_305_LINK_SCHEMA_CATALOG_CONFLICT");
 const columns=await db.query<{name:string;type:string;nullable:string}>(`SELECT column_name AS name,data_type AS type,is_nullable AS nullable FROM information_schema.columns
  WHERE table_schema='ls_service_interest' AND table_name='owner_305_inquiry_link_events' ORDER BY ordinal_position`);
 const expected=[['workspace_id','uuid','NO'],['operation_id','uuid','NO'],['conversation_id','uuid','NO'],['owner_account_id','uuid','NO'],['version','integer','NO'],['request_digest','text','NO'],['bna_inquiry_id','uuid','YES'],['fishing_application_id','uuid','YES'],['linked','boolean','NO'],['recorded_at','timestamp with time zone','NO']];
 if(JSON.stringify(columns.rows.map(value=>[value.name,value.type,value.nullable]))!==JSON.stringify(expected))throw Error("OWNER_305_LINK_SCHEMA_CATALOG_CONFLICT");return 1;
}
