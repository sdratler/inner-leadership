import {createHash} from "node:crypto";
import {planMigrations,type AppliedMigration,type Migration} from "./migration-plan.ts";
import {FISHING_MARKETING_MIGRATION} from "./fishing-marketing-schema-release.ts";
import type {Owner305ReleaseQuery} from "./owner-305-schema-release.ts";

export const BNA_PREFERENCES_MIGRATION={name:"0148_ls_bna_email_preferences.sql",sha256:"6e11023cce18b93d1e7af783d91ff6208bdca9c794f2194c921994c3bc951e74"} as const;
export const BNA_PREFERENCES_CATALOG_SHA256="333ac7f3d66acd80f92bc3f6cce2e5abf537028f3a9fc8e04b8924936c7275bf";
export function bnaPreferencesSchemaPlan(files:readonly Migration[],history:readonly AppliedMigration[],stage:0|1){
 const sorted=[...files].sort((a,b)=>a.name.localeCompare(b.name)),index=sorted.findIndex(file=>file.name===BNA_PREFERENCES_MIGRATION.name&&file.checksum===BNA_PREFERENCES_MIGRATION.sha256);
 if(index<1||sorted[index-1]?.name!==FISHING_MARKETING_MIGRATION.name||sorted[index-1]?.checksum!==FISHING_MARKETING_MIGRATION.sha256)throw Error("BNA_PREFERENCES_SCHEMA_SOURCE_MISMATCH");
 planMigrations(sorted,history);
 const scoped=sorted.slice(0,index+1),pending=planMigrations(scoped,history.slice(0,index+1)),expected=stage===0?[BNA_PREFERENCES_MIGRATION.name]:[];
 if(JSON.stringify(pending.map(file=>file.name))!==JSON.stringify(expected))throw Error("BNA_PREFERENCES_SCHEMA_LEDGER_STATE_CONFLICT");
 return {scoped,pending};
}
/** Stable across native collation and PostgreSQL17/18 not-null catalogs.
 * Pins actual definitions and ACLs, not only a count of named objects. */
export async function bnaPreferencesCatalogFingerprint(db:Owner305ReleaseQuery){
 const result=await db.query<{kind:string;name:string;definition:string}>(`WITH relations AS (
 SELECT c.oid,c.relname,c.relowner,c.relacl,c.relpersistence,c.relrowsecurity,c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='ls_service_interest' AND c.relkind='r' AND c.relname='bna_email_preference_events')
 SELECT 'relation' AS kind,r.relname AS name,r.relpersistence::text||'|'||r.relrowsecurity::text||'|'||r.relforcerowsecurity::text AS definition FROM relations r
 UNION ALL SELECT 'column',r.relname||'.'||a.attname,
  a.attnum::text||'|'||format_type(a.atttypid,a.atttypmod)||'|'||a.attnotnull::text||'|'||coalesce(pg_get_expr(d.adbin,d.adrelid),'')
 FROM relations r JOIN pg_attribute a ON a.attrelid=r.oid LEFT JOIN pg_attrdef d ON d.adrelid=r.oid AND d.adnum=a.attnum WHERE a.attnum>0 AND NOT a.attisdropped
 UNION ALL SELECT 'constraint',r.relname||'.'||k.conname,k.contype::text||'|'||k.convalidated::text||'|'||pg_get_constraintdef(k.oid)
 FROM relations r JOIN pg_constraint k ON k.conrelid=r.oid WHERE k.contype<>'n'
 UNION ALL SELECT 'index',c.relname,i.indisvalid::text||'|'||i.indisready::text||'|'||pg_get_indexdef(i.indexrelid)
 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE i.indrelid IN(SELECT oid FROM relations)
 UNION ALL SELECT 'trigger',r.relname||'.'||t.tgname,t.tgenabled::text||'|'||pg_get_triggerdef(t.oid)
 FROM relations r JOIN pg_trigger t ON t.tgrelid=r.oid WHERE NOT t.tgisinternal
 UNION ALL SELECT 'function',p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',
  l.lanname||'|'||p.prosecdef::text||'|'||p.provolatile::text||'|'||p.proparallel::text||'|'||p.proisstrict::text||'|'||coalesce(p.proconfig::text,'')||'|'||p.prosrc
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
 WHERE n.nspname='ls_service_interest' AND p.proname IN('check_bna_email_preference_event','reject_public_application_mutation')
 UNION ALL SELECT 'functiongrants',p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',count(*)::text
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace,LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
 WHERE n.nspname='ls_service_interest' AND p.proname='check_bna_email_preference_event' AND acl.grantee<>p.proowner GROUP BY p.oid,p.proname
 UNION ALL SELECT 'grants',r.relname,count(*)::text FROM relations r,
 LATERAL aclexplode(coalesce(r.relacl,acldefault('r',r.relowner))) acl WHERE acl.grantee<>r.relowner GROUP BY r.relname`);
 const entries=result.rows.map(row=>[row.kind,row.name,row.definition.replace(/\r\n/g,"\n")]);
 entries.sort((a,b)=>{for(let i=0;i<3;i++){if(a[i]!==b[i])return a[i]!<b[i]!?-1:1;}return 0;});
 return createHash("sha256").update(JSON.stringify(entries)).digest("hex");
}
export async function readBnaPreferencesSchemaStage(db:Owner305ReleaseQuery):Promise<0|1>{
 const result=await db.query<{relation:string|null}>("SELECT to_regclass('ls_service_interest.bna_email_preference_events')::text AS relation");
 if(result.rows.length!==1)throw Error("BNA_PREFERENCES_SCHEMA_CATALOG_CONFLICT");
 if(result.rows[0]!.relation===null){
  const orphan=await db.query<{n:number}>(`SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='ls_service_interest' AND p.proname='check_bna_email_preference_event'`);
  if(orphan.rows[0]?.n!==0)throw Error("BNA_PREFERENCES_SCHEMA_CATALOG_CONFLICT");return 0;
 }
 if(await bnaPreferencesCatalogFingerprint(db)!==BNA_PREFERENCES_CATALOG_SHA256)throw Error("BNA_PREFERENCES_SCHEMA_CATALOG_CONFLICT");
 return 1;
}
