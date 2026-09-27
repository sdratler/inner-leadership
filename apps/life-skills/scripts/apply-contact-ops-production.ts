/** One-time additive native CRM schema gate for the registered dedicated app DB.
 * Run only inside the deployed app service after exact-deployment readback,
 * current full encrypted backup/restore proof and protected checks. It does
 * not import contacts, switch CRM authority, send messages or change providers.
 *
 * First obtain an owner-private, authenticated Railway variable readback from
 * BOTH exact service IDs: SHA-256(app LS_DATABASE_URL) must equal
 * SHA-256(database service DATABASE_URL). Supply only that verified digest:
 * node --import tsx scripts/apply-contact-ops-production.ts --preflight --deployment=<Railway deployment ID> --database-binding=<database service ID>:<verified digest>
 * node --import tsx scripts/apply-contact-ops-production.ts --apply --deployment=<same ID> --database-binding=<same ID>:<same digest>
 */
import {createHash} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {Pool} from 'pg';
import {migrate} from '../src/db/migration-runner.ts';
import {contactOpsMigrationState,contactOpsProductionTarget,CONTACT_OPS_MIGRATION,type ContactOpsIntegrityObjects} from '../src/db/contact-ops-production-guard.ts';
import type {AppliedMigration,Migration} from '../src/db/migration-plan.ts';

async function migrations():Promise<Migration[]>{
 const root=new URL('../migrations/',import.meta.url);
 const manifest=JSON.parse(await readFile(new URL('manifest.json',root),'utf8')) as unknown;
 if(!Array.isArray(manifest)||!manifest.length||manifest.some(item=>!item||typeof item!=='object'||typeof item.name!=='string'||typeof item.sha256!=='string'||!/^\d{4}_[a-z][a-z0-9_]*\.sql$/.test(item.name)||!/^[a-f0-9]{64}$/.test(item.sha256)))throw new Error('CONTACT_OPS_MANIFEST_INVALID');
 const entries=manifest as {name:string;sha256:string}[];
 const actual=(await readdir(fileURLToPath(root))).filter(name=>name.endsWith('.sql')).sort();
 if(JSON.stringify(actual)!==JSON.stringify(entries.map(item=>item.name).sort()))throw new Error('CONTACT_OPS_MIGRATION_INVENTORY_MISMATCH');
 const files:Migration[]=[];
 for(const entry of entries){
  const bytes=await readFile(new URL(entry.name,root));
  if(createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw new Error('CONTACT_OPS_MIGRATION_CHECKSUM_MISMATCH');
  files.push({name:entry.name,checksum:entry.sha256,sql:bytes.toString('utf8')});
 }
 return files;
}

async function main(){
 const target=contactOpsProductionTarget(process.env,process.argv.slice(2));
 const files=await migrations();
 if(files.at(-1)?.name!==CONTACT_OPS_MIGRATION.name)throw new Error('CONTACT_OPS_NOT_LAST_MIGRATION');
 const pool=new Pool({connectionString:target.url,ssl:{rejectUnauthorized:true,ca:process.env.LS_DATABASE_CA},max:1,connectionTimeoutMillis:8000,statement_timeout:30000});
 try{
  const client=await pool.connect();
  try{
   const inspect=async()=>{
    await client.query('BEGIN READ ONLY');
    try{
     const ledger=await client.query<{name:string;checksum:string}>('SELECT name,checksum FROM ls_control.migrations ORDER BY name');
     const objects=await client.query<ContactOpsIntegrityObjects>(`SELECT
       to_regclass('ls_contact_ops.profiles') IS NOT NULL AS profiles,
       to_regclass('ls_contact_ops.legacy_links') IS NOT NULL AS "legacyLinks",
       to_regclass('ls_contact_ops.command_receipts') IS NOT NULL AS "commandReceipts",
       to_regclass('ls_contact_ops.legacy_links_by_person') IS NOT NULL AS "legacyIndex",
       EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='profile_provenance'
         AND tgrelid=to_regclass('ls_contact_ops.profiles') AND NOT tgisinternal) AS "profileProvenanceTrigger",
       EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='contact_person_marker_compatibility'
         AND tgrelid=to_regclass('ls_demo.records') AND NOT tgisinternal) AS "markerCompatibilityTrigger",
       EXISTS(SELECT 1 FROM pg_constraint WHERE conname='canonical_demo_person_key'
         AND conrelid=to_regclass('ls_demo.records')) AS "canonicalPersonConstraint"`);
     await client.query('COMMIT');
     const history:AppliedMigration[]=ledger.rows.map(row=>({name:row.name,checksum:row.checksum}));
     return contactOpsMigrationState(files,history,objects.rows[0]!);
    }catch(error){await client.query('ROLLBACK').catch(()=>undefined);throw error;}
   };
   const before=await inspect();
   if(target.mode==='preflight'){
    process.stdout.write(JSON.stringify({code:'CONTACT_OPS_PREFLIGHT_OK',deploymentId:target.deploymentId,databaseServiceId:target.databaseServiceId,migration:CONTACT_OPS_MIGRATION.name,state:before})+'\n');
    return;
   }
   const result=before==='pending'?await migrate({query:(sql,values)=>client.query(sql,values?[...values]:undefined)},files,false):{applied:0,pending:0};
   const after=await inspect();
   if(after!=='applied'||result.applied!==(before==='pending'?1:0))throw new Error('CONTACT_OPS_APPLY_READBACK_FAILED');
   process.stdout.write(JSON.stringify({code:'CONTACT_OPS_SCHEMA_VERIFIED',deploymentId:target.deploymentId,databaseServiceId:target.databaseServiceId,migration:CONTACT_OPS_MIGRATION.name,checksum:CONTACT_OPS_MIGRATION.sha256,applied:result.applied,state:after})+'\n');
  }finally{client.release();}
 }finally{await pool.end();}
}
main().catch(error=>{const code=error instanceof Error && /^(CONTACT_OPS|MIGRATION)_[A-Z0-9_]+$/.test(error.message)?error.message:'CONTACT_OPS_OPERATION_FAILED';process.stderr.write(code+'\n');process.exitCode=1;});
