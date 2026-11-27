import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { AppliedMigration, Migration } from './migration-plan.ts';
import { individualTripUpgradePlan, INDIVIDUAL_TRIP_MIGRATION } from './individual-trip-migration.ts';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const tripReleaseProof = z.strictObject({
  commit: z.string().regex(/^[a-f0-9]{40}$/), databaseBindingSha256: digest, caSha256: digest,
  systemId: z.literal('7682781321794240577'), migrationSha256: z.literal(INDIVIDUAL_TRIP_MIGRATION.sha256),
  backup: z.strictObject({archiveSha256:digest, readbackAt:z.iso.datetime()}),
  restore: z.strictObject({archiveSha256:digest, systemId:z.string().regex(/^\d+$/),
    verifiedAt:z.iso.datetime(), beforeLedgerSha256:digest, afterCatalogSha256:digest, rollbackVerified:z.literal(true)}),
  expiresAt:z.iso.datetime(),
});
export type TripReleaseProof = z.infer<typeof tripReleaseProof>;
export const tripDigest = (value:string) => createHash('sha256').update(value).digest('hex');
export interface TripReleaseClient {
  query<T extends object>(sql:string, values?:unknown[]):Promise<{rows:T[]}>;
}
export function validateTripProof(proof:TripReleaseProof, target:{mergedCommit:string;databaseBindingSha256:string},ca:string,now=Date.now()) {
  const backupAt=Date.parse(proof.backup.readbackAt), restoredAt=Date.parse(proof.restore.verifiedAt), expiresAt=Date.parse(proof.expiresAt);
  if(proof.commit!==target.mergedCommit || proof.databaseBindingSha256!==target.databaseBindingSha256 || proof.caSha256!==tripDigest(ca)
      || proof.restore.systemId===proof.systemId || proof.backup.archiveSha256!==proof.restore.archiveSha256
      || backupAt>restoredAt || restoredAt>now || now-backupAt>7*86400000 || expiresAt<=now || expiresAt>restoredAt+86400000) {
    throw Error('TRIP_RELEASE_RECOVERY_PROOF_MISMATCH');
  }
}

/** Definitions are sorted by PostgreSQL before hashing. Include keys, FK actions,
 * defaults, column nullability, indexes and any triggers without reading rows. */
export async function tripReleaseCatalog(db:TripReleaseClient) {
  const {rows}=await db.query<{kind:string;name:string;definition:string}>(`
    WITH relations AS (
      SELECT c.oid,c.relname,c.relpersistence,c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='ls_individual_trips' AND c.relkind IN ('r','p','v','m','f','S')
    ), entries AS (
      SELECT 'relation' AS kind, relname::text AS name, relkind::text || relpersistence::text AS definition FROM relations
      UNION ALL SELECT 'column',r.relname||'.'||a.attname,concat_ws('|',a.attnum,format_type(a.atttypid,a.atttypmod),a.attnotnull,pg_get_expr(d.adbin,d.adrelid))
        FROM relations r JOIN pg_attribute a ON a.attrelid=r.oid AND a.attnum>0 AND NOT a.attisdropped
        LEFT JOIN pg_attrdef d ON d.adrelid=r.oid AND d.adnum=a.attnum
      UNION ALL SELECT 'constraint',r.relname||'.'||c.conname,pg_get_constraintdef(c.oid) FROM relations r JOIN pg_constraint c ON c.conrelid=r.oid WHERE c.contype<>'n'
      UNION ALL SELECT 'index',i.relname,pg_get_indexdef(i.oid) FROM relations r JOIN pg_index x ON x.indrelid=r.oid JOIN pg_class i ON i.oid=x.indexrelid
      UNION ALL SELECT 'trigger',r.relname||'.'||t.tgname,pg_get_triggerdef(t.oid) FROM relations r JOIN pg_trigger t ON t.tgrelid=r.oid WHERE NOT t.tgisinternal
    ) SELECT kind,name,definition FROM entries ORDER BY kind COLLATE "C",name COLLATE "C"`);
  return {tables:rows.filter(r=>r.kind==='relation').length, sha256:tripDigest(JSON.stringify(rows))};
}

/** Caller owns a single transaction. Unrecognized history or partial objects
 * abort before application. Retrying after a committed migration is read-only. */
export async function releaseTripTables(db:TripReleaseClient,files:readonly Migration[],proof:TripReleaseProof,apply:boolean) {
  const history=(await db.query<AppliedMigration>('SELECT name,checksum FROM ls_control.migrations ORDER BY name')).rows;
  const {installed,trip}=individualTripUpgradePlan(files,history);
  const predecessor=installed?history.slice(0,-1):history;
  if(tripDigest(JSON.stringify(predecessor))!==proof.restore.beforeLedgerSha256)throw Error('TRIP_RELEASE_BASELINE_MISMATCH');
  const exists=(await db.query<{present:boolean}>("SELECT to_regnamespace('ls_individual_trips') IS NOT NULL AS present")).rows[0]?.present;
  if(exists!==installed)throw Error('TRIP_RELEASE_NAMESPACE_MISMATCH');
  if(!installed) {
    if(!apply)throw Error('TRIP_RELEASE_SCHEMA_PENDING');
    await db.query(trip.sql);
    await db.query('INSERT INTO ls_control.migrations(name,checksum) VALUES($1,$2)',[trip.name,trip.checksum]);
  }
  const catalog=await tripReleaseCatalog(db);
  if(catalog.tables!==9 || catalog.sha256!==proof.restore.afterCatalogSha256)throw Error('TRIP_RELEASE_CATALOG_MISMATCH');
  return {installed:true,applied:installed?0:1,catalogSha256:catalog.sha256,ledgerRows:predecessor.length+1};
}
