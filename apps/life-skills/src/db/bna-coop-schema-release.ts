import {planMigrations,type AppliedMigration,type Migration} from "./migration-plan.ts";
import type {Owner305ReleaseQuery} from "./owner-305-schema-release.ts";
import {BNA_SUPPORT_MIGRATION} from "./bna-support-schema-source.ts";
export const BNA_COOP_BASELINE={name:"0141_ls_owner_305_conversations.sql",sha256:"d4c5c6a4e98382c4059e97c6147eae378b0017fd61307df771b1bdbc68b29790"} as const;
export const BNA_COOP_MIGRATION={name:"0142_ls_bna_coop_interest.sql",sha256:"84146e6f8341d09f0b7f865cd920cc9e7350120ce0aa81a52528f6aa45085bdc"} as const;
export function bnaCoopSchemaPlan(files:readonly Migration[],history:readonly AppliedMigration[],stage:0|1){
 const sorted=[...files].sort((a,b)=>a.name.localeCompare(b.name)),index=sorted.findIndex(f=>f.name===BNA_COOP_MIGRATION.name&&f.checksum===BNA_COOP_MIGRATION.sha256);
 if(index<1||sorted[index-1]?.name!==BNA_COOP_BASELINE.name||sorted[index-1]?.checksum!==BNA_COOP_BASELINE.sha256)throw Error("BNA_COOP_SCHEMA_SOURCE_MISMATCH");
 // Validate the complete ledger first, including any later migrations, then
 // inspect the 0142 prefix. A later migration cannot hide a divergent history.
 planMigrations(sorted,history);
 const scoped=sorted.slice(0,index+1),pending=planMigrations(scoped,history.slice(0,index+1)),expected=stage===0?[BNA_COOP_MIGRATION.name]:[];
 if(JSON.stringify(pending.map(f=>f.name))!==JSON.stringify(expected))throw Error("BNA_COOP_SCHEMA_LEDGER_STATE_CONFLICT");return {scoped,pending};
}
export async function readBnaCoopSchemaStage(db:Owner305ReleaseQuery):Promise<0|1>{
 const result=await db.query<{definition:string;validated:boolean}>(`SELECT pg_get_constraintdef(c.oid) AS definition,c.convalidated AS validated
 FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace
 WHERE n.nspname='ls_service_interest' AND r.relname='bna_inquiries' AND c.conname='bna_inquiries_program_key_check' AND c.contype='c'`);
 if(result.rows.length!==1||result.rows[0]!.validated!==true)throw Error("BNA_COOP_SCHEMA_CATALOG_CONFLICT");
 const value=result.rows[0]!.definition.replace(/\s+/g,"");
 if(value==="CHECK((program_key='bna_torah_mornings'::text))")return 0;
 if(value==="CHECK((program_key=ANY(ARRAY['bna_torah_mornings'::text,'bna_learning_coop'::text])))")return 1;
 if(value==="CHECK((program_key=ANY(ARRAY['bna_torah_mornings'::text,'bna_learning_coop'::text,'bna_support_interest'::text])))"){
  const ledger=await db.query<{checksum:string}>("SELECT checksum FROM ls_control.migrations WHERE name=$1",[BNA_SUPPORT_MIGRATION.name]);
  if(ledger.rows.length===1&&ledger.rows[0]!.checksum===BNA_SUPPORT_MIGRATION.sha256)return 1;
 }
 throw Error("BNA_COOP_SCHEMA_CATALOG_CONFLICT");
}
