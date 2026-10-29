import {planMigrations,type AppliedMigration,type Migration} from "./migration-plan.ts";
import type {Owner305ReleaseQuery} from "./owner-305-schema-release.ts";
import {OWNER_305_LINK_MIGRATION} from "./owner-305-link-schema-release.ts";
import {BNA_SUPPORT_MIGRATION} from "./bna-support-schema-source.ts";
export {BNA_SUPPORT_MIGRATION};

export function bnaSupportSchemaPlan(files:readonly Migration[],history:readonly AppliedMigration[],stage:0|1){
 const sorted=[...files].sort((a,b)=>a.name.localeCompare(b.name)),index=sorted.findIndex(file=>file.name===BNA_SUPPORT_MIGRATION.name&&file.checksum===BNA_SUPPORT_MIGRATION.sha256);
 if(index<1||sorted[index-1]?.name!==OWNER_305_LINK_MIGRATION.name||sorted[index-1]?.checksum!==OWNER_305_LINK_MIGRATION.sha256)throw Error("BNA_SUPPORT_SCHEMA_SOURCE_MISMATCH");
 planMigrations(sorted,history);
 const scoped=sorted.slice(0,index+1),pending=planMigrations(scoped,history.slice(0,index+1)),expected=stage===0?[BNA_SUPPORT_MIGRATION.name]:[];
 if(JSON.stringify(pending.map(file=>file.name))!==JSON.stringify(expected))throw Error("BNA_SUPPORT_SCHEMA_LEDGER_STATE_CONFLICT");return {scoped,pending};
}
/** Only the exact validated predecessor or support constraint is admitted.
 * The caller must also bind this result to the complete migration ledger. */
export async function readBnaSupportSchemaStage(db:Owner305ReleaseQuery):Promise<0|1>{
 const result=await db.query<{definition:string;validated:boolean}>(`SELECT pg_get_constraintdef(c.oid) AS definition,c.convalidated AS validated
 FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace
 WHERE n.nspname='ls_service_interest' AND r.relname='bna_inquiries' AND c.conname='bna_inquiries_program_key_check' AND c.contype='c'`);
 if(result.rows.length!==1||result.rows[0]!.validated!==true)throw Error("BNA_SUPPORT_SCHEMA_CATALOG_CONFLICT");
 const value=result.rows[0]!.definition.replace(/\s+/g,"");
 if(value==="CHECK((program_key=ANY(ARRAY['bna_torah_mornings'::text,'bna_learning_coop'::text])))")return 0;
 if(value==="CHECK((program_key=ANY(ARRAY['bna_torah_mornings'::text,'bna_learning_coop'::text,'bna_support_interest'::text])))")return 1;
 throw Error("BNA_SUPPORT_SCHEMA_CATALOG_CONFLICT");
}
