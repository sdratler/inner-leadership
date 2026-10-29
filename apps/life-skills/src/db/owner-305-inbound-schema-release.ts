import {planMigrations,type AppliedMigration,type Migration} from "./migration-plan.ts";
import {owner305Hash,type Owner305ReleaseQuery} from "./owner-305-schema-release.ts";
import {BNA_SUPPORT_MIGRATION} from "./bna-support-schema-source.ts";
export const INBOUND_305_BASELINE=BNA_SUPPORT_MIGRATION;
export const INBOUND_305_MIGRATION={name:"0145_ls_owner_305_inbound.sql",sha256:"73b274095bbd3acafd9eeb4461c26abc57b5276ce115c1e1e46c34f1c4d535cc"} as const;
export {owner305Hash};
export function inbound305SchemaPlan(files:readonly Migration[],history:readonly AppliedMigration[],stage:0|1){
 const sorted=[...files].sort((a,b)=>a.name.localeCompare(b.name)),index=sorted.findIndex(f=>f.name===INBOUND_305_MIGRATION.name&&f.checksum===INBOUND_305_MIGRATION.sha256);
 if(index<1||sorted[index-1]?.name!==INBOUND_305_BASELINE.name||sorted[index-1]?.checksum!==INBOUND_305_BASELINE.sha256)throw Error("INBOUND_305_SCHEMA_SOURCE_MISMATCH");
 planMigrations(sorted,history);
 const scoped=sorted.slice(0,index+1),pending=planMigrations(scoped,history.slice(0,index+1)),expected=stage===0?[INBOUND_305_MIGRATION.name]:[];
 if(JSON.stringify(pending.map(f=>f.name))!==JSON.stringify(expected))throw Error("INBOUND_305_SCHEMA_LEDGER_STATE_CONFLICT");return {scoped,pending};
}
export async function readInbound305SchemaStage(db:Owner305ReleaseQuery):Promise<0|1>{
 const result=await db.query<{relation:string|null;links:string|null}>("SELECT to_regclass('ls_service_interest.owner_305_inbound_receipts')::text AS relation,to_regclass('ls_service_interest.owner_305_inbound_links')::text AS links");
 if(result.rows.length!==1)throw Error("INBOUND_305_SCHEMA_CATALOG_CONFLICT");if(result.rows[0]!.relation===null&&result.rows[0]!.links===null)return 0;
 if(!result.rows[0]!.relation||!result.rows[0]!.links)throw Error("INBOUND_305_SCHEMA_CATALOG_CONFLICT");
 const state=await db.query<{triggers:number;indexes:number;constraints:number;foreignKeys:number;checks:number;unauthorizedGrants:number}>(`SELECT
  (SELECT count(*)::int FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='ls_service_interest' AND c.relname IN ('owner_305_inbound_receipts','owner_305_inbound_links') AND t.tgname IN ('owner_305_inbound_no_edit','owner_305_inbound_no_truncate','owner_305_inbound_link_no_edit','owner_305_inbound_link_no_truncate') AND NOT t.tgisinternal AND t.tgenabled IN ('O','A')) AS triggers,
  (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='ls_service_interest' AND c.relname='owner_305_inbound_recent' AND c.relkind='i') AS indexes,
  (SELECT count(*)::int FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='ls_service_interest' AND c.relname IN ('owner_305_inbound_receipts','owner_305_inbound_links') AND k.contype IN ('p','u')) AS constraints,
  (SELECT count(*)::int FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='ls_service_interest' AND c.relname IN ('owner_305_inbound_receipts','owner_305_inbound_links') AND k.contype='f') AS "foreignKeys",
  (SELECT count(*)::int FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='ls_service_interest' AND c.relname='owner_305_inbound_receipts' AND k.contype='c') AS checks,
  (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace,LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) acl WHERE n.nspname='ls_service_interest' AND c.relname IN ('owner_305_inbound_receipts','owner_305_inbound_links') AND acl.grantee<>c.relowner) AS "unauthorizedGrants"`);
 const v=state.rows[0];if(!v||v.triggers!==4||v.indexes!==1||v.constraints!==4||v.foreignKeys!==3||v.checks!==5||v.unauthorizedGrants!==0)throw Error("INBOUND_305_SCHEMA_CATALOG_CONFLICT");return 1;
}
