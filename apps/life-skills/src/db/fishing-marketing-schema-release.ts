import {planMigrations,type AppliedMigration,type Migration} from "./migration-plan.ts";
import {owner305Hash,type Owner305ReleaseQuery} from "./owner-305-schema-release.ts";
export const FISHING_MARKETING_BASELINE={name:"0142_ls_owner_305_inbound.sql",sha256:"73b274095bbd3acafd9eeb4461c26abc57b5276ce115c1e1e46c34f1c4d535cc"} as const;
export const FISHING_MARKETING_MIGRATION={name:"0143_ls_fishing_marketing_snapshot.sql",sha256:"6419f05b3cf4d17add4f49fdb4c2eabe8f8cad2afe6f1b004398ab6f4327c755"} as const;
export {owner305Hash};
export function fishingMarketingSchemaPlan(files:readonly Migration[],history:readonly AppliedMigration[],stage:0|1){
 const sorted=[...files].sort((a,b)=>a.name.localeCompare(b.name)),index=sorted.findIndex(f=>f.name===FISHING_MARKETING_MIGRATION.name&&f.checksum===FISHING_MARKETING_MIGRATION.sha256);
 if(index<1||sorted[index-1]?.name!==FISHING_MARKETING_BASELINE.name||sorted[index-1]?.checksum!==FISHING_MARKETING_BASELINE.sha256)throw Error("FISHING_MARKETING_SCHEMA_SOURCE_MISMATCH");
 const scoped=sorted.slice(0,index+1),pending=planMigrations(scoped,history),expected=stage===0?[FISHING_MARKETING_MIGRATION.name]:[];
 if(JSON.stringify(pending.map(f=>f.name))!==JSON.stringify(expected))throw Error("FISHING_MARKETING_SCHEMA_LEDGER_STATE_CONFLICT");return {scoped,pending};
}
export async function readFishingMarketingSchemaStage(db:Owner305ReleaseQuery):Promise<0|1>{
 const result=await db.query<{relation:string|null}>("SELECT to_regclass('ls_service_interest.fishing_marketing_snapshot')::text AS relation");
 if(result.rows.length!==1)throw Error("FISHING_MARKETING_SCHEMA_CATALOG_CONFLICT");if(result.rows[0]!.relation===null)return 0;
 const state=await db.query<{triggers:number;constraints:number;foreignKeys:number;checks:number;columns:number;unauthorizedGrants:number}>(`SELECT
  (SELECT count(*)::int FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='ls_service_interest' AND c.relname='fishing_marketing_snapshot' AND t.tgname IN ('fishing_marketing_no_delete','fishing_marketing_no_truncate') AND NOT t.tgisinternal AND t.tgenabled IN ('O','A')) AS triggers,
  (SELECT count(*)::int FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='ls_service_interest' AND c.relname='fishing_marketing_snapshot' AND k.contype='p') AS constraints,
  (SELECT count(*)::int FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='ls_service_interest' AND c.relname='fishing_marketing_snapshot' AND k.contype='f') AS "foreignKeys",
  (SELECT count(*)::int FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='ls_service_interest' AND c.relname='fishing_marketing_snapshot' AND k.contype='c') AS checks,
  (SELECT count(*)::int FROM information_schema.columns WHERE table_schema='ls_service_interest' AND table_name='fishing_marketing_snapshot' AND column_name IN ('workspace_id','owner_account_id','generated_at','received_at','payload_digest','payload_ciphertext') AND is_nullable='NO') AS columns,
  (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace,LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) acl WHERE n.nspname='ls_service_interest' AND c.relname='fishing_marketing_snapshot' AND acl.grantee<>c.relowner) AS "unauthorizedGrants"`);
 const v=state.rows[0];if(!v||v.triggers!==2||v.constraints!==1||v.foreignKeys!==2||v.checks!==2||v.columns!==6||v.unauthorizedGrants!==0)throw Error("FISHING_MARKETING_SCHEMA_CATALOG_CONFLICT");return 1;
}
