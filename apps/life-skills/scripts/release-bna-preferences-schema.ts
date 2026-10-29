/** Exact-target 0148 BNA preference schema-only operator. It never sends or publishes. */
import {readFile,readdir,lstat} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {isAbsolute} from "node:path";
import {Pool} from "pg";
import {z} from "zod";
import {migrate} from "../src/db/migration-runner.ts";
import type {AppliedMigration,Migration} from "../src/db/migration-plan.ts";
import {assertContactOpsDatabaseIdentity} from "../src/db/contact-ops-production-guard.ts";
import {readBnaLeadSchemaStage} from "../src/db/bna-lead-schema-release.ts";
import {owner305Hash,readOwner305SchemaStage} from "../src/db/owner-305-schema-release.ts";
import {readBnaEmailSchemaStage} from "../src/db/bna-email-schema-release.ts";
import {readInbound305SchemaStage} from "../src/db/owner-305-inbound-schema-release.ts";
import {BNA_PREFERENCES_MIGRATION,BNA_PREFERENCES_CATALOG_SHA256,bnaPreferencesSchemaPlan,readBnaPreferencesSchemaStage} from "../src/db/bna-preferences-schema-release.ts";
import {readFishingMarketingSchemaStage} from "../src/db/fishing-marketing-schema-release.ts";

const target={projectId:"3b756632-1f66-4f75-a016-eabc37aa0d67",environmentId:"dd91bd71-57cc-45e6-a75b-8c858491d7c7",
 appServiceId:"0267d061-f3ce-4a0a-82d4-ce133e4501e9",databaseServiceId:"354b5343-9e83-45a7-b764-09396f14ae29",
 databaseHost:"postgres.railway.internal",appOrigin:"https://life-skills.bneineviimacademy.org"} as const;
const sha=z.string().regex(/^[a-f0-9]{64}$/),gitSha=z.string().regex(/^[a-f0-9]{40}$/),uuid=z.string().uuid();
const proofSchema=z.strictObject({projectId:uuid,environmentId:uuid,appServiceId:uuid,databaseServiceId:uuid,deploymentId:uuid,
 reviewedCommit:gitSha,manifestSha256:sha,sourceSha256:sha,databaseBindingSha256:sha,baselineLedgerSha256:sha,
 backup:z.strictObject({receiptId:z.string().min(1).max(200),readbackAt:z.iso.datetime(),databaseSystemIdentifier:z.string().min(1),archiveSha256:sha}),
 isolatedRestore:z.strictObject({sourceReceiptId:z.string().min(1).max(200),verifiedAt:z.iso.datetime(),verified:z.literal(true),archiveSha256:sha,migrationSha256:sha,catalogSha256:sha,previousTablesUnchanged:z.literal(true)}),
 rollback:z.strictObject({reviewed:z.literal(true),description:z.string().min(20).max(2000)})});
const sources=["migrations/manifest.json","migrations/0139_ls_bna_inquiries.sql","migrations/0140_ls_fishing_inquiry_followups.sql","migrations/0141_ls_owner_305_conversations.sql","migrations/0142_ls_bna_coop_interest.sql","migrations/0143_ls_owner_305_inquiry_links.sql","migrations/0144_ls_bna_support_interest.sql","migrations/0145_ls_owner_305_inbound.sql","migrations/0146_ls_bna_communication_delivery.sql","migrations/0147_ls_fishing_marketing_snapshot.sql","migrations/0148_ls_bna_email_preferences.sql",
 "src/db/owner-305-schema-release.ts","src/db/owner-305-inbound-schema-release.ts","src/db/bna-email-schema-release.ts","src/db/fishing-marketing-schema-release.ts","src/db/bna-preferences-schema-release.ts","src/db/migration-plan.ts","src/db/migration-runner.ts","src/db/contact-ops-production-guard.ts",
 "src/features/bna-inquiry/store.ts","src/features/bna-communications/preferences-contract.ts","src/features/bna-communications/preferences-store.ts","src/features/bna-communications/preferences-http.ts",
 "src/app/api/private/bna-preferences/route.ts","src/app/api/public/bna-preferences/route.ts","scripts/release-bna-preferences-schema.ts"] as const;
async function sourceSha(){const root=new URL("../",import.meta.url),entries=[];
 for(const name of sources){const url=new URL(name,root),stat=await lstat(fileURLToPath(url));if(!stat.isFile()||stat.isSymbolicLink())throw Error("BNA_PREFERENCES_SCHEMA_SOURCE_INVALID");entries.push([name,owner305Hash(await readFile(url))]);}
 return owner305Hash(JSON.stringify(entries));}
async function inventory(){const root=new URL("../migrations/",import.meta.url),manifestBytes=await readFile(new URL("manifest.json",root));
 const manifest=z.array(z.strictObject({name:z.string().regex(/^\d{4}_[a-z][a-z0-9_]*\.sql$/),sha256:sha})).parse(JSON.parse(manifestBytes.toString("utf8")));
 const actual=(await readdir(fileURLToPath(root))).filter(name=>name.endsWith(".sql")).sort();
 if(JSON.stringify(actual)!==JSON.stringify(manifest.map(row=>row.name).sort()))throw Error("BNA_PREFERENCES_SCHEMA_INVENTORY_MISMATCH");
 const files:Migration[]=[];for(const row of manifest){const bytes=await readFile(new URL(row.name,root));if(owner305Hash(bytes)!==row.sha256)throw Error("BNA_PREFERENCES_SCHEMA_CHECKSUM_MISMATCH");files.push({name:row.name,checksum:row.sha256,sql:bytes.toString("utf8")});}
 return {files,manifestSha256:owner305Hash(manifestBytes)};}
async function main(){const mode=process.argv[2];if(!["--source-digest","--preflight","--apply","--verify-only"].includes(mode??"")||process.argv.length!==3)throw Error("BNA_PREFERENCES_SCHEMA_ARGUMENTS_INVALID");
 const actualSourceSha=await sourceSha();if(mode==="--source-digest"){process.stdout.write(actualSourceSha+"\n");return;}
 if(process.env.RAILWAY_PROJECT_ID!==target.projectId||process.env.RAILWAY_ENVIRONMENT_ID!==target.environmentId||process.env.RAILWAY_SERVICE_ID!==target.appServiceId||process.env.LS_APP_ORIGIN!==target.appOrigin)throw Error("BNA_PREFERENCES_SCHEMA_TARGET_MISMATCH");
 const deployment=uuid.parse(process.env.RAILWAY_DEPLOYMENT_ID),reviewedCommit=gitSha.parse(process.env.RAILWAY_GIT_COMMIT_SHA);
 if(process.env.LS_DATABASE_TLS!=="verify-full"||!process.env.LS_DATABASE_CA?.trim())throw Error("BNA_PREFERENCES_SCHEMA_TLS_REQUIRED");
 const url=new URL(process.env.LS_DATABASE_URL??"");if(!["postgres:","postgresql:"].includes(url.protocol)||url.hostname!==target.databaseHost||url.port!=="5432"||url.pathname!=="/railway"||url.search||url.hash||!url.username||!url.password)throw Error("BNA_PREFERENCES_SCHEMA_DATABASE_TARGET_MISMATCH");
 const databaseBindingSha256=owner305Hash(process.env.LS_DATABASE_URL!),{files,manifestSha256}=await inventory();
 if(!files.some(file=>file.name===BNA_PREFERENCES_MIGRATION.name&&file.checksum===BNA_PREFERENCES_MIGRATION.sha256))throw Error("BNA_PREFERENCES_SCHEMA_SOURCE_MISMATCH");
 const proofPath=process.env.LS_BNA_PREFERENCES_SCHEMA_PROOF_FILE,proofSha=process.env.LS_BNA_PREFERENCES_SCHEMA_PROOF_SHA256;
 if(!proofPath||!isAbsolute(proofPath)||!proofSha)throw Error("BNA_PREFERENCES_SCHEMA_PROOF_REQUIRED");
 const proofStat=await lstat(proofPath);if(!proofStat.isFile()||proofStat.isSymbolicLink()||(proofStat.mode&0o077)!==0)throw Error("BNA_PREFERENCES_SCHEMA_PROOF_INVALID");
 const proofBytes=await readFile(proofPath);if(owner305Hash(proofBytes)!==sha.parse(proofSha))throw Error("BNA_PREFERENCES_SCHEMA_PROOF_HASH_MISMATCH");
 const proof=proofSchema.parse(JSON.parse(proofBytes.toString("utf8")));
 if(proof.projectId!==target.projectId||proof.environmentId!==target.environmentId||proof.appServiceId!==target.appServiceId||proof.databaseServiceId!==target.databaseServiceId||proof.deploymentId!==deployment||proof.reviewedCommit!==reviewedCommit||proof.manifestSha256!==manifestSha256||proof.sourceSha256!==actualSourceSha||proof.databaseBindingSha256!==databaseBindingSha256||proof.backup.receiptId!==proof.isolatedRestore.sourceReceiptId||proof.backup.archiveSha256!==proof.isolatedRestore.archiveSha256||proof.isolatedRestore.migrationSha256!==BNA_PREFERENCES_MIGRATION.sha256||proof.isolatedRestore.catalogSha256!==BNA_PREFERENCES_CATALOG_SHA256)throw Error("BNA_PREFERENCES_SCHEMA_PROOF_TARGET_MISMATCH");
 const now=Date.now(),backupAt=Date.parse(proof.backup.readbackAt),restoreAt=Date.parse(proof.isolatedRestore.verifiedAt);
 if(backupAt>restoreAt||restoreAt>now||now-backupAt>7*86400_000)throw Error("BNA_PREFERENCES_SCHEMA_BACKUP_STALE");
 if((mode==="--apply"&&process.env.LS_BNA_PREFERENCES_SCHEMA_APPLY_APPROVED!=="true")||(mode!=="--verify-only"&&process.env.LS_BNA_PREFERENCES_ENABLED==="true"))throw Error("BNA_PREFERENCES_SCHEMA_APPLY_NOT_APPROVED");
 const pool=new Pool({connectionString:url.toString(),ssl:{rejectUnauthorized:true,ca:process.env.LS_DATABASE_CA},max:1,connectionTimeoutMillis:8000,statement_timeout:30000});
 try{const client=await pool.connect();try{
  const lock=await client.query<{locked:boolean}>("SELECT pg_try_advisory_lock(541940,8) AS locked");if(lock.rows[0]?.locked!==true)throw Error("BNA_PREFERENCES_SCHEMA_LOCKED");
  try{
   const identity=await client.query<{system_identifier:string;ssl:boolean}>("SELECT (SELECT system_identifier FROM pg_control_system()) AS system_identifier,(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS ssl");
   assertContactOpsDatabaseIdentity(identity.rows[0]?.system_identifier,identity.rows[0]?.ssl);
   if(proof.backup.databaseSystemIdentifier!==identity.rows[0]?.system_identifier)throw Error("BNA_PREFERENCES_SCHEMA_BACKUP_IDENTITY_MISMATCH");
   const ledger=await client.query<{name:string;checksum:string}>("SELECT name,checksum FROM ls_control.migrations ORDER BY name"),history:AppliedMigration[]=ledger.rows;
   if(await readBnaLeadSchemaStage({query:(sql,values)=>client.query(sql,values?[...values]:undefined)})!==1||await readOwner305SchemaStage({query:(sql,values)=>client.query(sql,values?[...values]:undefined)})!==1||await readInbound305SchemaStage({query:(sql,values)=>client.query(sql,values?[...values]:undefined)})!==1||await readBnaEmailSchemaStage({query:(sql,values)=>client.query(sql,values?[...values]:undefined)})!==1)throw Error("BNA_PREFERENCES_SCHEMA_PREDECESSOR_NOT_READY");
   if(await readFishingMarketingSchemaStage({query:(sql,values)=>client.query(sql,values?[...values]:undefined)})!==1)throw Error("BNA_PREFERENCES_SCHEMA_PREDECESSOR_NOT_READY");
   const stage=await readBnaPreferencesSchemaStage({query:(sql,values)=>client.query(sql,values?[...values]:undefined)}),plan=bnaPreferencesSchemaPlan(files,history,stage);
   if(mode==="--verify-only"){if(stage!==1||plan.pending.length)throw Error("BNA_PREFERENCES_SCHEMA_VERIFY_PENDING");
    process.stdout.write(JSON.stringify({code:"BNA_PREFERENCES_SCHEMA_VERIFIED",applied:0,stage:1})+"\n");return;}
   if(stage!==0||plan.pending.length!==1||owner305Hash(JSON.stringify(history))!==proof.baselineLedgerSha256)throw Error("BNA_PREFERENCES_SCHEMA_BASELINE_CHANGED");
   if(mode==="--preflight"){process.stdout.write(JSON.stringify({code:"BNA_PREFERENCES_SCHEMA_PREFLIGHT_OK",pending:plan.pending.map(file=>file.name),effects:"schema-only"})+"\n");return;}
   const result=await migrate({query:(sql,values)=>client.query(sql,values?[...values]:undefined)},plan.scoped,false);
   const afterLedger=await client.query<{name:string;checksum:string}>("SELECT name,checksum FROM ls_control.migrations ORDER BY name"),afterStage=await readBnaPreferencesSchemaStage({query:(sql,values)=>client.query(sql,values?[...values]:undefined)}),after=bnaPreferencesSchemaPlan(files,afterLedger.rows,afterStage);
   const rows=await client.query<{total:number}>(`SELECT count(*)::int AS total FROM ls_service_interest.bna_email_preference_events`);
   if(result.applied!==1||afterStage!==1||after.pending.length||rows.rows[0]?.total!==0)throw Error("BNA_PREFERENCES_SCHEMA_READBACK_FAILED");
   process.stdout.write(JSON.stringify({code:"BNA_PREFERENCES_SCHEMA_VERIFIED",applied:1,stage:1})+"\n");
  }finally{await client.query("SELECT pg_advisory_unlock(541940,8)").catch(()=>undefined);}
 }finally{client.release();}}finally{await pool.end();}
}
main().catch(error=>{const code=error instanceof Error&&/^BNA_PREFERENCES_SCHEMA_[A-Z_]+$/.test(error.message)?error.message:"BNA_PREFERENCES_SCHEMA_OPERATION_FAILED";process.stderr.write(code+"\n");process.exitCode=1;});
