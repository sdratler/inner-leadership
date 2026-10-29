import {planMigrations,type AppliedMigration,type Migration} from "./migration-plan.ts";
import type {Owner305ReleaseQuery} from "./owner-305-schema-release.ts";
import {BNA_COOP_MIGRATION} from "./bna-coop-schema-release.ts";

export const OWNER_305_LINK_MIGRATION={name:"0143_ls_owner_305_inquiry_links.sql",sha256:"63624d56b8692249e8bab3bd68aaf1c8b5596129fac703c47cd25d662048000c"} as const;
export function owner305LinkSchemaPlan(files:readonly Migration[],history:readonly AppliedMigration[],stage:0|1){
 const sorted=[...files].sort((a,b)=>a.name.localeCompare(b.name)),index=sorted.findIndex(file=>file.name===OWNER_305_LINK_MIGRATION.name&&file.checksum===OWNER_305_LINK_MIGRATION.sha256);
 if(index<1||sorted[index-1]?.name!==BNA_COOP_MIGRATION.name||sorted[index-1]?.checksum!==BNA_COOP_MIGRATION.sha256)throw Error("OWNER_305_LINK_SCHEMA_SOURCE_MISMATCH");
 // Validate later ledger entries too, then evaluate only the link migration prefix.
 planMigrations(sorted,history);
 const scoped=sorted.slice(0,index+1),pending=planMigrations(scoped,history.slice(0,index+1)),expected=stage===0?[OWNER_305_LINK_MIGRATION.name]:[];
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
 if(JSON.stringify(columns.rows.map(value=>[value.name,value.type,value.nullable]))!==JSON.stringify(expected))throw Error("OWNER_305_LINK_SCHEMA_CATALOG_CONFLICT");
 const definitions=await db.query<{kind:string;definition:string}>(`SELECT c.contype::text AS kind,pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace
  WHERE n.nspname='ls_service_interest' AND r.relname='owner_305_inquiry_link_events' AND c.contype IN ('c','f','p') AND c.convalidated ORDER BY kind,definition`);
 const expectedDefinitions=[
  ['c','CHECK (((bna_inquiry_id IS NULL) <> (fishing_application_id IS NULL)))'],['c','CHECK (((version >= 1) AND (version <= 2147483646)))'],['c',"CHECK ((request_digest ~ '^[a-f0-9]{64}$'::text))"],
  ['f','FOREIGN KEY (workspace_id, bna_inquiry_id) REFERENCES ls_service_interest.bna_inquiries(workspace_id, id)'],['f','FOREIGN KEY (workspace_id, conversation_id) REFERENCES ls_service_interest.owner_305_conversations(workspace_id, id)'],
  ['f','FOREIGN KEY (workspace_id, fishing_application_id) REFERENCES ls_service_interest.public_applications(workspace_id, id)'],['f','FOREIGN KEY (workspace_id, owner_account_id) REFERENCES ls_identity.accounts(workspace_id, id)'],['p','PRIMARY KEY (workspace_id, operation_id)']];
 // Database collations can order punctuation differently; compare exact
 // definitions in a deterministic order without weakening the catalog check.
 const canonical=(values:string[][])=>values.map(value=>JSON.stringify(value)).sort();
 if(JSON.stringify(canonical(definitions.rows.map(value=>[value.kind,value.definition])))!==JSON.stringify(canonical(expectedDefinitions)))throw Error("OWNER_305_LINK_SCHEMA_CATALOG_CONFLICT");
 const indexes=await db.query<{name:string;definition:string}>(`SELECT indexname AS name,indexdef AS definition FROM pg_indexes WHERE schemaname='ls_service_interest' AND tablename='owner_305_inquiry_link_events' ORDER BY indexname`);
 const expectedIndexes=[
  ['owner_305_bna_link_version','CREATE UNIQUE INDEX owner_305_bna_link_version ON ls_service_interest.owner_305_inquiry_link_events USING btree (workspace_id, conversation_id, bna_inquiry_id, version) WHERE (bna_inquiry_id IS NOT NULL)'],
  ['owner_305_fishing_link_version','CREATE UNIQUE INDEX owner_305_fishing_link_version ON ls_service_interest.owner_305_inquiry_link_events USING btree (workspace_id, conversation_id, fishing_application_id, version) WHERE (fishing_application_id IS NOT NULL)'],
  ['owner_305_inquiry_link_events_pkey','CREATE UNIQUE INDEX owner_305_inquiry_link_events_pkey ON ls_service_interest.owner_305_inquiry_link_events USING btree (workspace_id, operation_id)'],
  ['owner_305_inquiry_link_history','CREATE INDEX owner_305_inquiry_link_history ON ls_service_interest.owner_305_inquiry_link_events USING btree (workspace_id, conversation_id, recorded_at DESC, operation_id DESC)']];
 if(JSON.stringify(indexes.rows.map(value=>[value.name,value.definition]))!==JSON.stringify(expectedIndexes))throw Error("OWNER_305_LINK_SCHEMA_CATALOG_CONFLICT");
 const triggers=await db.query<{name:string;definition:string}>(`SELECT t.tgname AS name,pg_get_triggerdef(t.oid) AS definition FROM pg_trigger t JOIN pg_class r ON r.oid=t.tgrelid JOIN pg_namespace n ON n.oid=r.relnamespace
  WHERE n.nspname='ls_service_interest' AND r.relname='owner_305_inquiry_link_events' AND NOT t.tgisinternal AND t.tgenabled IN ('O','A') ORDER BY t.tgname`);
 const expectedTriggers=[['owner_305_inquiry_link_no_edit','CREATE TRIGGER owner_305_inquiry_link_no_edit BEFORE DELETE OR UPDATE ON ls_service_interest.owner_305_inquiry_link_events FOR EACH ROW EXECUTE FUNCTION ls_service_interest.reject_public_application_mutation()'],
  ['owner_305_inquiry_link_no_truncate','CREATE TRIGGER owner_305_inquiry_link_no_truncate BEFORE TRUNCATE ON ls_service_interest.owner_305_inquiry_link_events FOR EACH STATEMENT EXECUTE FUNCTION ls_service_interest.reject_public_application_mutation()']];
 if(JSON.stringify(triggers.rows.map(value=>[value.name,value.definition]))!==JSON.stringify(expectedTriggers))throw Error("OWNER_305_LINK_SCHEMA_CATALOG_CONFLICT");
 const grants=await db.query<{count:number}>(`SELECT count(*)::int AS count FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace,LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) acl
  WHERE n.nspname='ls_service_interest' AND c.relname='owner_305_inquiry_link_events' AND acl.grantee<>c.relowner`);
 if(grants.rows[0]?.count!==0)throw Error("OWNER_305_LINK_SCHEMA_CATALOG_CONFLICT");return 1;
}
