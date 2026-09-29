import {createHash} from "node:crypto";
import type {SqlSession} from "../features/identity/store.ts";

export const CONTACT_OUTBOUND_PROJECTION_MIGRATION={name:"0110_ls_contact_outbound_projection.sql",
 sha256:"b881b9b074cb217d48d2b6fb8bb62b39d3ced3a0447353beaa35809fde862e76"} as const;
/** Exact isolated PostgreSQL 17.11 catalog of this additive private table. */
export const CONTACT_OUTBOUND_PROJECTION_CATALOG={columns:12,constraints:9,
 sha256:"da1f1923db64bf2f8beb1d5fa79648de975e236aa0d12bbf27d04ea2194dd031"} as const;
export type ContactOutboundProjectionIntegrity={objectsAbsent:boolean;table:boolean;schemaCatalog:boolean;
 foreignKeys:boolean;pendingIndex:boolean;permissions:boolean;referencesSound:boolean};

export function outboundProjectionCatalogMatches(columns:unknown,constraints:unknown):boolean{
 if(!Array.isArray(columns)||columns.length!==CONTACT_OUTBOUND_PROJECTION_CATALOG.columns||!Array.isArray(constraints))return false;
 const compared=constraints.filter(row=>row?.type!=="n");
 return compared.length===CONTACT_OUTBOUND_PROJECTION_CATALOG.constraints&&
  createHash("sha256").update(JSON.stringify({columns,constraints:compared})).digest("hex")===CONTACT_OUTBOUND_PROJECTION_CATALOG.sha256;
}

/** Read-only absence or exact body/catalog/index/FK/ACL/reference proof. */
export async function contactOutboundProjectionIntegrity(tx:SqlSession):Promise<ContactOutboundProjectionIntegrity>{
 const objects=(await tx.query<Omit<ContactOutboundProjectionIntegrity,"schemaCatalog"|"referencesSound">>(`SELECT
  to_regclass('ls_contact_ops.outbound_projections') IS NULL
   AND to_regclass('ls_contact_ops.outbound_projections_pending') IS NULL AS "objectsAbsent",
  (SELECT count(*)=1 AND bool_and(c.relkind='r' AND c.relpersistence='p' AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user))
   FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='ls_contact_ops' AND c.relname='outbound_projections') AS "table",
  (SELECT count(*)=2 AND bool_and(k.convalidated) FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid
   JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='ls_contact_ops' AND c.relname='outbound_projections' AND k.contype='f') AS "foreignKeys",
  (SELECT count(*)=1 AND bool_and(i.indisvalid AND i.indisready AND i.indislive AND NOT i.indisunique
   AND i.indnatts=3 AND i.indnkeyatts=3 AND i.indkey::text='1 9 10'
   AND pg_get_indexdef(i.indexrelid)='CREATE INDEX outbound_projections_pending ON ls_contact_ops.outbound_projections USING btree (workspace_id, state, created_at) WHERE (state <> ''projected''::text)')
   FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='ls_contact_ops' AND c.relname='outbound_projections_pending') AS "pendingIndex",
  NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace,
   LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl
   WHERE n.nspname='ls_contact_ops' AND c.relname='outbound_projections' AND acl.grantee<>c.relowner)
   AND NOT EXISTS(SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace,
    LATERAL aclexplode(a.attacl) acl WHERE n.nspname='ls_contact_ops' AND c.relname='outbound_projections'
    AND a.attnum>0 AND NOT a.attisdropped AND acl.grantee<>c.relowner) AS permissions`))[0];
 if(!objects)throw Error("CONTACT_OPS_OUTBOUND_READBACK_INVALID");
 const columns=(await tx.query<{catalog:unknown}>(`SELECT coalesce(json_agg(json_build_object(
  'table',c.relname,'column',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,
  'default',pg_get_expr(d.adbin,d.adrelid),'identity',a.attidentity,'generated',a.attgenerated)
  ORDER BY c.relname,a.attnum),'[]'::json) AS catalog FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
  JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
  WHERE n.nspname='ls_contact_ops' AND c.relname='outbound_projections' AND a.attnum>0 AND NOT a.attisdropped`))[0]?.catalog;
 const constraints=(await tx.query<{catalog:unknown;validated:boolean}>(`SELECT coalesce(json_agg(json_build_object(
  'table',c.relname,'name',k.conname,'type',k.contype,'definition',pg_get_constraintdef(k.oid)) ORDER BY c.relname,k.conname),'[]'::json) AS catalog,
  coalesce(bool_and(k.convalidated),false) AS validated FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid
  JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='ls_contact_ops' AND c.relname='outbound_projections' AND k.contype<>'n'`))[0];
 let referencesSound=false;
 if(objects.table)referencesSound=(await tx.query<{sound:boolean}>(`SELECT NOT EXISTS(
  SELECT 1 FROM ls_contact_ops.outbound_projections o LEFT JOIN ls_identity.workspaces w ON w.id=o.workspace_id
  LEFT JOIN ls_identity.accounts a ON a.workspace_id=o.workspace_id AND a.id=o.actor_account_id
  WHERE w.id IS NULL OR a.id IS NULL OR
   (o.state='prepared' AND (o.receipt_ciphertext IS NOT NULL OR o.resolution_ciphertext IS NOT NULL)) OR
   (o.state IN ('sent_pending','projected') AND (o.receipt_ciphertext IS NULL OR o.resolution_ciphertext IS NOT NULL)) OR
   (o.state='not_delivered' AND (o.receipt_ciphertext IS NOT NULL OR o.resolution_ciphertext IS NULL))) AS sound`))[0]?.sound===true;
 return {...objects,schemaCatalog:constraints?.validated===true&&outboundProjectionCatalogMatches(columns,constraints.catalog),referencesSound};
}
