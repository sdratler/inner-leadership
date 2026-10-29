import {planMigrations,type AppliedMigration,type Migration} from "./migration-plan.ts";
import {owner305Hash,type Owner305ReleaseQuery} from "./owner-305-schema-release.ts";
export const INBOUND_305_BASELINE={name:"0141_ls_owner_305_conversations.sql",sha256:"d4c5c6a4e98382c4059e97c6147eae378b0017fd61307df771b1bdbc68b29790"} as const;
export const INBOUND_305_MIGRATION={name:"0142_ls_owner_305_inbound.sql",sha256:"427267a71da4dfc161bea056bf91e2dce12c6eef97aa7dc8d06d67264b1097df"} as const;
export {owner305Hash};
export function inbound305SchemaPlan(files:readonly Migration[],history:readonly AppliedMigration[],stage:0|1){
 const sorted=[...files].sort((a,b)=>a.name.localeCompare(b.name)),index=sorted.findIndex(f=>f.name===INBOUND_305_MIGRATION.name&&f.checksum===INBOUND_305_MIGRATION.sha256);
 if(index<1||sorted[index-1]?.name!==INBOUND_305_BASELINE.name||sorted[index-1]?.checksum!==INBOUND_305_BASELINE.sha256)throw Error("INBOUND_305_SCHEMA_SOURCE_MISMATCH");
 const scoped=sorted.slice(0,index+1),pending=planMigrations(scoped,history),expected=stage===0?[INBOUND_305_MIGRATION.name]:[];
 if(JSON.stringify(pending.map(f=>f.name))!==JSON.stringify(expected))throw Error("INBOUND_305_SCHEMA_LEDGER_STATE_CONFLICT");return {scoped,pending};
}
export async function readInbound305SchemaStage(db:Owner305ReleaseQuery):Promise<0|1>{
 const result=await db.query<{relation:string|null}>("SELECT to_regclass('ls_service_interest.owner_305_inbound_receipts')::text AS relation");
 if(result.rows.length!==1)throw Error("INBOUND_305_SCHEMA_CATALOG_CONFLICT");if(result.rows[0]!.relation===null)return 0;
 const state=await db.query<{triggers:number;indexes:number;constraints:number;unauthorizedGrants:number}>(`SELECT
  (SELECT count(*)::int FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='ls_service_interest' AND c.relname='owner_305_inbound_receipts' AND t.tgname IN ('owner_305_inbound_no_edit','owner_305_inbound_no_truncate') AND NOT t.tgisinternal AND t.tgenabled IN ('O','A')) AS triggers,
  (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='ls_service_interest' AND c.relname='owner_305_inbound_recent' AND c.relkind='i') AS indexes,
  (SELECT count(*)::int FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='ls_service_interest' AND c.relname='owner_305_inbound_receipts' AND k.contype IN ('p','u')) AS constraints,
  (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace,LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) acl WHERE n.nspname='ls_service_interest' AND c.relname='owner_305_inbound_receipts' AND acl.grantee<>c.relowner) AS "unauthorizedGrants"`);
 const v=state.rows[0];if(!v||v.triggers!==2||v.indexes!==1||v.constraints!==2||v.unauthorizedGrants!==0)throw Error("INBOUND_305_SCHEMA_CATALOG_CONFLICT");return 1;
}
