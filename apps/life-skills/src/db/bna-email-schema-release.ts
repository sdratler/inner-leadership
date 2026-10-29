import {createHash} from "node:crypto";
import {planMigrations,type AppliedMigration,type Migration} from "./migration-plan.ts";
import {INBOUND_305_MIGRATION} from "./owner-305-inbound-schema-release.ts";
import type {Owner305ReleaseQuery} from "./owner-305-schema-release.ts";

export const BNA_EMAIL_MIGRATION={name:"0146_ls_bna_communication_delivery.sql",sha256:"5988e5955f16790960aa5381d07125a8a235f23928d5568cab5d32c816e58da2"} as const;
// Native catalog pin includes column types/nullability/defaults, validated
// constraints, indexes, enabled trigger definitions, and function bodies.
export const BNA_EMAIL_CATALOG_SHA256="2d58993899404b9085189ed5bba553935eb358663e7f88a5c1ccc3a3c6a3adb0";
export function bnaEmailSchemaPlan(files:readonly Migration[],history:readonly AppliedMigration[],stage:0|1){
 const sorted=[...files].sort((a,b)=>a.name.localeCompare(b.name)),index=sorted.findIndex(file=>file.name===BNA_EMAIL_MIGRATION.name&&file.checksum===BNA_EMAIL_MIGRATION.sha256);
 if(index<1||sorted[index-1]?.name!==INBOUND_305_MIGRATION.name||sorted[index-1]?.checksum!==INBOUND_305_MIGRATION.sha256)throw Error("BNA_EMAIL_SCHEMA_SOURCE_MISMATCH");
 planMigrations(sorted,history);
 const scoped=sorted.slice(0,index+1),pending=planMigrations(scoped,history.slice(0,index+1)),expected=stage===0?[BNA_EMAIL_MIGRATION.name]:[];
 if(JSON.stringify(pending.map(file=>file.name))!==JSON.stringify(expected))throw Error("BNA_EMAIL_SCHEMA_LEDGER_STATE_CONFLICT");
 return {scoped,pending};
}
export async function bnaEmailCatalogFingerprint(db:Owner305ReleaseQuery){
 const result=await db.query<{kind:string;name:string;definition:string}>(`WITH relations AS (
 SELECT c.oid,c.relname,c.relowner,c.relacl FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='ls_service_interest' AND c.relkind='r' AND c.relname IN('bna_email_messages','bna_email_delivery','bna_email_delivery_events'))
 SELECT 'column' AS kind,r.relname||'.'||a.attname AS name,
  a.attnum::text||'|'||format_type(a.atttypid,a.atttypmod)||'|'||a.attnotnull::text||'|'||coalesce(pg_get_expr(d.adbin,d.adrelid),'') AS definition
 FROM relations r JOIN pg_attribute a ON a.attrelid=r.oid LEFT JOIN pg_attrdef d ON d.adrelid=r.oid AND d.adnum=a.attnum WHERE a.attnum>0 AND NOT a.attisdropped
 UNION ALL SELECT 'constraint',r.relname||'.'||k.conname,k.contype::text||'|'||k.convalidated::text||'|'||pg_get_constraintdef(k.oid)
 FROM relations r JOIN pg_constraint k ON k.conrelid=r.oid WHERE k.contype<>'n'
 UNION ALL SELECT 'index',c.relname,i.indisvalid::text||'|'||i.indisready::text||'|'||pg_get_indexdef(i.indexrelid)
 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='ls_service_interest' AND (i.indrelid IN(SELECT oid FROM relations) OR c.relname='bna_inquiry_communication_program')
 UNION ALL SELECT 'trigger',r.relname||'.'||t.tgname,t.tgenabled::text||'|'||pg_get_triggerdef(t.oid)
 FROM relations r JOIN pg_trigger t ON t.tgrelid=r.oid WHERE NOT t.tgisinternal
 UNION ALL SELECT 'function',p.proname,l.lanname||'|'||p.prosecdef::text||'|'||p.prosrc
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
 WHERE n.nspname='ls_service_interest' AND p.proname IN('guard_bna_email_delivery','check_bna_email_delivery_event','check_bna_email_delivery_history','reject_public_application_mutation')
 UNION ALL SELECT 'grants',r.relname,count(*)::text FROM relations r,
 LATERAL aclexplode(coalesce(r.relacl,acldefault('r',r.relowner))) acl WHERE acl.grantee<>r.relowner GROUP BY r.relname
 ORDER BY kind,name,definition`);
 return createHash("sha256").update(JSON.stringify(result.rows.map(row=>[row.kind,row.name,row.definition]))).digest("hex");
}
export async function readBnaEmailSchemaStage(db:Owner305ReleaseQuery):Promise<0|1>{
 const result=await db.query<{messages:string|null;delivery:string|null;events:string|null;programIndex:string|null}>(`SELECT
 to_regclass('ls_service_interest.bna_email_messages')::text AS messages,to_regclass('ls_service_interest.bna_email_delivery')::text AS delivery,
 to_regclass('ls_service_interest.bna_email_delivery_events')::text AS events,to_regclass('ls_service_interest.bna_inquiry_communication_program')::text AS "programIndex"`);
 const row=result.rows[0];if(result.rows.length!==1||!row)throw Error("BNA_EMAIL_SCHEMA_CATALOG_CONFLICT");
 if(Object.values(row).every(value=>value===null)){
  const orphan=await db.query<{n:number}>(`SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='ls_service_interest' AND p.proname IN('guard_bna_email_delivery','check_bna_email_delivery_event','check_bna_email_delivery_history')`);
  if(orphan.rows[0]?.n!==0)throw Error("BNA_EMAIL_SCHEMA_CATALOG_CONFLICT");return 0;
 }
 if(Object.values(row).some(value=>value===null)||await bnaEmailCatalogFingerprint(db)!==BNA_EMAIL_CATALOG_SHA256)throw Error("BNA_EMAIL_SCHEMA_CATALOG_CONFLICT");
 return 1;
}
