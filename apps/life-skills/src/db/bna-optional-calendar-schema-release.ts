import {createHash} from "node:crypto";
import {planMigrations,type AppliedMigration,type Migration} from "./migration-plan.ts";
import {BNA_PREFERENCES_MIGRATION} from "./bna-preferences-schema-release.ts";
import type {Owner305ReleaseQuery} from "./owner-305-schema-release.ts";

export const BNA_OPTIONAL_CALENDAR_MIGRATION={name:"0149_ls_bna_optional_calendar.sql",sha256:"2fe71ca3f6309e2db1029a7c82471879f11dfebcb5ef0c80ae3bbbc05eb466d5"} as const;
export const BNA_OPTIONAL_CALENDAR_CATALOG_SHA256="6a5277a25b2ae4f3ccde2dd58e94f3bea4f230c554140ef04e90e431de025f1c";
export function bnaOptionalCalendarSchemaPlan(files:readonly Migration[],history:readonly AppliedMigration[],stage:0|1){
 const sorted=[...files].sort((a,b)=>a.name.localeCompare(b.name)),index=sorted.findIndex(file=>file.name===BNA_OPTIONAL_CALENDAR_MIGRATION.name&&file.checksum===BNA_OPTIONAL_CALENDAR_MIGRATION.sha256);
 if(index!==68||sorted[index-1]?.name!==BNA_PREFERENCES_MIGRATION.name||sorted[index-1]?.checksum!==BNA_PREFERENCES_MIGRATION.sha256)throw Error("BNA_OPTIONAL_CALENDAR_SCHEMA_SOURCE_MISMATCH");
 if(createHash("sha256").update(JSON.stringify(sorted.slice(0,index).map(file=>({name:file.name,sha256:file.checksum})))).digest("hex")!=="8fb4285163f7de84d2f7c433a92f333c00a2f1a2383cc068493340ecac711b27")throw Error("BNA_OPTIONAL_CALENDAR_SCHEMA_PREFIX_MISMATCH");
 planMigrations(sorted,history);
 const scoped=sorted.slice(0,index+1),pending=planMigrations(scoped,history.slice(0,index+1)),expected=stage===0?[BNA_OPTIONAL_CALENDAR_MIGRATION.name]:[];
 if(JSON.stringify(pending.map(file=>file.name))!==JSON.stringify(expected))throw Error("BNA_OPTIONAL_CALENDAR_SCHEMA_LEDGER_STATE_CONFLICT");
 return {scoped,pending};
}
/** Stable across native collation and PostgreSQL17/18 not-null catalogs.
 * Pins actual definitions and ACLs, not only a count of named objects. */
export async function bnaOptionalCalendarCatalogFingerprint(db:Owner305ReleaseQuery){
 const result=await db.query<{kind:string;name:string;definition:string}>(`WITH relations AS (
 SELECT c.oid,c.relname,c.relowner,c.relacl,c.relpersistence,c.relrowsecurity,c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='ls_service_interest' AND c.relkind='r' AND c.relname IN('bna_optional_messages','bna_optional_events'))
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
 WHERE n.nspname='ls_service_interest' AND p.proname IN('check_bna_optional_event','check_bna_optional_initial_history','reject_public_application_mutation')
 UNION ALL SELECT 'functiongrants',p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',count(*)::text
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace,LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
 WHERE n.nspname='ls_service_interest' AND p.proname IN('check_bna_optional_event','check_bna_optional_initial_history') AND acl.grantee<>p.proowner GROUP BY p.oid,p.proname
 UNION ALL SELECT 'grants',r.relname,count(*)::text FROM relations r,
 LATERAL aclexplode(coalesce(r.relacl,acldefault('r',r.relowner))) acl WHERE acl.grantee<>r.relowner GROUP BY r.relname`);
 const entries=result.rows.map(row=>[row.kind,row.name,row.definition.replace(/\r\n/g,"\n")]);
 entries.sort((a,b)=>{for(let i=0;i<3;i++){if(a[i]!==b[i])return a[i]!<b[i]!?-1:1;}return 0;});
 return createHash("sha256").update(JSON.stringify(entries)).digest("hex");
}
export async function readBnaOptionalCalendarSchemaStage(db:Owner305ReleaseQuery):Promise<0|1>{
 const result=await db.query<{messages:string|null;events:string|null}>("SELECT to_regclass('ls_service_interest.bna_optional_messages')::text AS messages,to_regclass('ls_service_interest.bna_optional_events')::text AS events");
 if(result.rows.length!==1)throw Error("BNA_OPTIONAL_CALENDAR_SCHEMA_CATALOG_CONFLICT");
 const row=result.rows[0]!;
 if(row.messages===null&&row.events===null){
  const orphan=await db.query<{n:number}>(`SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='ls_service_interest' AND p.proname IN('check_bna_optional_event','check_bna_optional_initial_history')`);
  if(orphan.rows[0]?.n!==0)throw Error("BNA_OPTIONAL_CALENDAR_SCHEMA_CATALOG_CONFLICT");return 0;
 }
 if(row.messages===null||row.events===null||await bnaOptionalCalendarCatalogFingerprint(db)!==BNA_OPTIONAL_CALENDAR_CATALOG_SHA256)throw Error("BNA_OPTIONAL_CALENDAR_SCHEMA_CATALOG_CONFLICT");
 return 1;
}
