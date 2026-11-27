/** Run inside the reviewed Fishing app deployment. The checked migration is
 * the only selectable SQL. Ordinary application requests never import this file. */
import { readFile } from 'node:fs/promises';
import { Client } from 'pg';
import { z } from 'zod';
import { assertContactOpsDatabaseIdentity } from '../src/db/contact-ops-production-guard.ts';
import { inquirySchemaTargetBinding } from '../src/db/inquiry-email-control-schema-release.ts';
import { releaseTripTables, tripReleaseProof, validateTripProof } from '../src/db/individual-trip-release.ts';

async function main() {
  const mode=process.argv[2];
  if(!['--apply','--verify-only'].includes(mode??''))throw Error('TRIP_RELEASE_MODE_REQUIRED');
  const env=process.env, target=inquirySchemaTargetBinding(env);
  if(env.NODE_TLS_REJECT_UNAUTHORIZED==='0')throw Error('TRIP_RELEASE_VERIFIED_TLS_REQUIRED');
  const workspace=z.uuid().parse(env.LS_IDENTITY_WORKSPACE_ID), owner=z.uuid().parse(env.LS_PROVIDER_INDEX_OWNER_ACCOUNT_ID);
  if(workspace!==env.LS_INDIVIDUAL_TRIPS_WORKSPACE_ID || owner!==env.LS_INDIVIDUAL_TRIPS_OWNER_ACCOUNT_ID)throw Error('TRIP_RELEASE_OWNER_BINDING_MISMATCH');
  const proof=tripReleaseProof.parse(JSON.parse(env.LS_INDIVIDUAL_TRIPS_SCHEMA_PROOF_JSON??'null'));
  validateTripProof(proof,target,env.LS_DATABASE_CA!);
  const root=new URL('../migrations/',import.meta.url);
  const manifest=z.array(z.strictObject({name:z.string().regex(/^\d{4}_[a-z0-9_]+\.sql$/),sha256:z.string().regex(/^[a-f0-9]{64}$/)}))
    .parse(JSON.parse(await readFile(new URL('manifest.json',root),'utf8')));
  const files=await Promise.all(manifest.map(async row=>({name:row.name,checksum:row.sha256,sql:await readFile(new URL(row.name,root),'utf8')})));
  const client=new Client({connectionString:env.LS_DATABASE_URL,ssl:{ca:env.LS_DATABASE_CA,rejectUnauthorized:true},connectionTimeoutMillis:10000});
  await client.connect();
  try {
    await client.query(mode==='--apply'?'BEGIN':'BEGIN READ ONLY');
    await client.query("SET LOCAL search_path TO pg_catalog");
    await client.query("SET LOCAL lock_timeout TO '5s'");
    await client.query("SET LOCAL statement_timeout TO '30s'");
    const targetRow=(await client.query(`SELECT (SELECT system_identifier::text FROM pg_control_system()) AS "systemId",
      (SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS ssl,pg_try_advisory_xact_lock(541931,0) AS locked`)).rows[0];
    assertContactOpsDatabaseIdentity(targetRow?.systemId,targetRow?.ssl);
    if(!targetRow?.locked)throw Error('TRIP_RELEASE_LOCKED');
    const confirmed=await client.query(`SELECT 1 FROM ls_identity.accounts a JOIN ls_identity.account_subjects s
      ON s.workspace_id=a.workspace_id AND s.account_id=a.id JOIN ls_identity.people p ON p.workspace_id=s.workspace_id AND p.id=s.person_id
      WHERE a.workspace_id=$1 AND a.id=$2 AND a.state='active' AND a.role='practitioner' AND p.kind='adult'`,[workspace,owner]);
    if(confirmed.rowCount!==1)throw Error('TRIP_RELEASE_NATIVE_OWNER_MISMATCH');
    const receipt=await releaseTripTables(client,files,proof,mode==='--apply');
    await client.query('COMMIT');
    console.log(JSON.stringify({event:'fishing_trip_schema_verified',commit:target.mergedCommit,...receipt}));
  } catch(error) {
    await client.query('ROLLBACK').catch(()=>undefined);
    throw error;
  } finally {await client.end();}
}
main().catch((e:unknown)=>{
  const message=e instanceof Error && /^(TRIP_(?:RELEASE|SCHEMA)_|INQUIRY_EMAIL_CONTROL_SCHEMA_|CONTACT_OPS_)[A-Z_]+$/.test(e.message)
    ?e.message:'TRIP_RELEASE_FAILED';
  console.error(message);
  process.exitCode=1;
});
