import {createHash} from "node:crypto";
import type {SqlSession} from "../features/identity/store.ts";
import type {Migration} from "./migration-plan.ts";
export const SCOPED_DISCLOSURE_USE_MIGRATION={name:"0112_ls_scoped_disclosure_use.sql",sha256:"e59e9bf09dfdcb9bcd899824d42c61e0b4305e459a8d477423eb2ab10a81d99b"} as const;
export const SPEAKER_CORRECTION_RECEIPTS_MIGRATION={name:"0113_ls_speaker_correction_receipts.sql",sha256:"482b5d58b0605587a1425bbefc89de07ac9dcdc839e30d7d07ebb4f1ad225510"} as const;
// Clean 31-migration native17.11 baseline observed in the populated upgrade
// fixture; excludes only the separately compared operation CHECK. History and
// older catalog fingerprints are not changed to admit this forward suffix.
export const SCOPED_DISCLOSURE_BASE_CATALOG="ac997c4d78d025425e5b7343817190e10f73f46c909e3a3f4c397330bd0fc0e9";
export type ScopedDisclosureIntegrity={baselineOperation:boolean;currentOperation:boolean;schemaCatalog:boolean;foreignKeys:boolean;permissions:boolean};
export type SpeakerReceiptIntegrity={prior:ScopedDisclosureIntegrity;current:ScopedDisclosureIntegrity};
const operations=["upload","save_observations","save_recap","share_recap","record_consent","withdraw_consent","authorize_disclosure","revoke_disclosure"];
export function disclosureOperationMatches(value:unknown,current:boolean|"speakers"):boolean{
 if(typeof value!=="string")return false;const values=current==="speakers"?[...operations,"record_disclosure_use","save_speakers"]:current?[...operations,"record_disclosure_use"]:operations;
 const expected=`CHECKoperation=ANYARRAY[${values.map(v=>`'${v}'`).join(",")}]`;
 return value.replace(/\s+/g,"").replace(/::text/g,"").replace(/[()]/g,"")===expected;
}
/** Observe both exact operation frames, sharing unchanged catalog/FK/ACL checks.
 * Do not alter historical fingerprints or claim the old CHECK survived replacement. */
export async function speakerReceiptIntegrity(tx:SqlSession,files:readonly Migration[]):Promise<SpeakerReceiptIntegrity>{
 if(!files.some(file=>file.name===SPEAKER_CORRECTION_RECEIPTS_MIGRATION.name&&file.checksum===SPEAKER_CORRECTION_RECEIPTS_MIGRATION.sha256))throw Error("SPEAKER_MIGRATION_SOURCE_MISMATCH");
 const prior=await scopedDisclosureIntegrity(tx,files),catalog=await scopedDisclosureCatalog(tx);
 return {prior,current:{...prior,baselineOperation:false,currentOperation:catalog.validated&&disclosureOperationMatches(catalog.operation,"speakers")}};
}
/** Every original session table/column/check/FK/index/trigger remains bound;
 * only the one named operation CHECK is compared as prior/current frames. */
export async function scopedDisclosureCatalog(tx:SqlSession):Promise<{sha256:string;operation:unknown;validated:boolean}>{
 const columns=await tx.query(`SELECT c.relname AS "table",a.attname AS "column",format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull AS "notNull",pg_get_expr(d.adbin,d.adrelid) AS "default",a.attidentity AS identity,a.attgenerated AS generated FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE n.nspname='ls_sessions' AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname,a.attnum`);
 const constraints=await tx.query<{table:string;name:string;type:string;definition:string;validated:boolean}>(`SELECT c.relname AS "table",k.conname AS name,k.contype AS type,pg_get_constraintdef(k.oid) AS definition,k.convalidated AS validated FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='ls_sessions' AND k.contype<>'n' ORDER BY c.relname,k.conname`);
 const indexes=await tx.query(`SELECT c.relname AS name,pg_get_indexdef(i.indexrelid) AS definition,i.indisvalid AS valid,i.indisready AS ready,i.indislive AS live FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='ls_sessions' ORDER BY c.relname`);
 const triggers=await tx.query(`SELECT c.relname AS "table",t.tgname AS name,pg_get_triggerdef(t.oid) AS definition,t.tgenabled AS enabled FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='ls_sessions' AND NOT t.tgisinternal ORDER BY c.relname,t.tgname`);
 const operation=constraints.filter(k=>k.table==="command_receipts"&&k.name==="command_receipts_operation_check"),material=constraints.filter(k=>!(k.table==="command_receipts"&&k.name==="command_receipts_operation_check"));
 return {sha256:createHash("sha256").update(JSON.stringify({columns,constraints:material,indexes,triggers})).digest("hex"),operation:operation.length===1?operation[0]!.definition:null,validated:constraints.length>0&&constraints.every(k=>k.validated)};
}
export async function scopedDisclosureIntegrity(tx:SqlSession,files:readonly Migration[]):Promise<ScopedDisclosureIntegrity>{
 if(!files.some(f=>f.name===SCOPED_DISCLOSURE_USE_MIGRATION.name&&f.checksum===SCOPED_DISCLOSURE_USE_MIGRATION.sha256))throw Error("DISCLOSURE_MIGRATION_SOURCE_MISMATCH");
 const catalog=await scopedDisclosureCatalog(tx),read=(await tx.query<{foreignKeys:boolean;permissions:boolean;tables:boolean}>(`SELECT
 (SELECT count(*)=13 AND bool_and(c.relkind='r' AND c.relpersistence='p' AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='ls_sessions' AND c.relkind IN ('r','p')) AS tables,
 NOT EXISTS(SELECT 1 FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='ls_sessions' AND k.contype='f' AND (NOT k.convalidated OR (SELECT count(*)<>4 OR NOT bool_and(t.tgenabled='O') FROM pg_trigger t WHERE t.tgconstraint=k.oid))) AS "foreignKeys",
 NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace,LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE n.nspname='ls_sessions' AND c.relkind='r' AND a.grantee<>c.relowner)
 AND NOT EXISTS(SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace,LATERAL aclexplode(a.attacl) p WHERE n.nspname='ls_sessions' AND a.attnum>0 AND NOT a.attisdropped AND p.grantee<>c.relowner)
 AND NOT EXISTS(SELECT 1 FROM pg_namespace n,LATERAL aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a WHERE n.nspname='ls_sessions' AND a.grantee<>n.nspowner) AS permissions`))[0];
 return {baselineOperation:catalog.validated&&disclosureOperationMatches(catalog.operation,false),currentOperation:catalog.validated&&disclosureOperationMatches(catalog.operation,true),schemaCatalog:read?.tables===true&&catalog.sha256===SCOPED_DISCLOSURE_BASE_CATALOG,foreignKeys:read?.foreignKeys===true,permissions:read?.permissions===true};
}
