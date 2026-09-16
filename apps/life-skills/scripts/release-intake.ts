/** One-shot, operator-only storage release. It never opens intake or sends messages.
 * Existing migrate.ts keeps its disposable-loopback restriction unchanged.
 * Readback proofs are private operator artifacts, not claims supplied by the app. */
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { Pool } from "pg";
import { z } from "zod";
import { validateDatabaseUrl } from "../src/lib/env/schema.ts";
import { migrate } from "../src/db/migration-runner.ts";
import type { Migration } from "../src/db/migration-plan.ts";

const target = Object.freeze({
  projectId:"3b756632-1f66-4f75-a016-eabc37aa0d67",
  serviceId:"0267d061-f3ce-4a0a-82d4-ce133e4501e9",
  environmentId:"dd91bd71-57cc-45e6-a75b-8c858491d7c7",
  databaseServiceId:"354b5343-9e83-45a7-b764-09396f14ae29",
  databaseHost:"postgres.railway.internal",
});
const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const proofSchema=z.strictObject({
  changeId:z.literal("LS-FIRST-PARENTS-20260916-01"),
  scope:z.literal("private-intake-storage-only"),
  projectId:z.literal(target.projectId),serviceId:z.literal(target.serviceId),
  environmentId:z.literal(target.environmentId),databaseServiceId:z.literal(target.databaseServiceId),
  reviewedCommit:z.string().regex(/^[a-f0-9]{40}$/),manifestSha256:sha,
  independentReview:z.literal("PASS"),reviewReceiptSha256:sha,
  backupId:z.string().min(1),backupReadbackSha256:sha,
  isolatedRestore:z.literal("PASS"),restoreReceiptSha256:sha,
  consentConfigurationSha256:sha,retentionPolicyRecorded:z.literal(true),
  controlFence:z.string().min(20),expiresAt:z.iso.datetime(),
});
async function main():Promise<void>{
  const args=process.argv.slice(2);
  if(args.length!==1||!["--verify-only","--apply"].includes(args[0]!))throw Error("ARGUMENTS");
  if(process.env.LS_INTAKE_STORAGE_RELEASE_APPROVED!=="true" ||
     process.env.RAILWAY_PROJECT_ID!==target.projectId || process.env.RAILWAY_SERVICE_ID!==target.serviceId ||
     process.env.RAILWAY_ENVIRONMENT_ID!==target.environmentId || process.env.LS_DATABASE_TLS!=="verify-full")throw Error("TARGET");
  const proofFile=process.env.LS_INTAKE_RELEASE_PROOF_FILE;
  if(!proofFile)throw Error("PROOF");
  const proofBytes=await readFile(proofFile);
  if(hash(proofBytes)!==process.env.LS_INTAKE_RELEASE_PROOF_SHA256)throw Error("PROOF_HASH");
  const proof=proofSchema.parse(JSON.parse(proofBytes.toString("utf8")));
  if(Date.parse(proof.expiresAt)<=Date.now() || proof.reviewedCommit!==process.env.RAILWAY_GIT_COMMIT_SHA)throw Error("STALE_REVIEW");
  if(hash(process.env.LS_INTAKE_PUBLIC_CONSENT_JSON??"")!==proof.consentConfigurationSha256)throw Error("CONSENT_CHANGED");
  const connectionString=process.env.LS_DATABASE_URL;
  if(!connectionString||!process.env.LS_DATABASE_CA)throw Error("DATABASE_TLS");
  const database=validateDatabaseUrl(connectionString,"verify-full");
  if(database.hostname!==target.databaseHost||database.pathname!=="/railway")throw Error("DATABASE_TARGET");
  const root=new URL("../migrations/",import.meta.url),manifestBytes=await readFile(new URL("manifest.json",root));
  if(hash(manifestBytes)!==proof.manifestSha256)throw Error("MANIFEST_CHANGED");
  const manifest=z.array(z.strictObject({name:z.string().regex(/^\d{4}_[a-z][a-z0-9_]*\.sql$/),sha256:sha})).parse(JSON.parse(manifestBytes.toString("utf8")));
  const actual=(await readdir(root)).filter(name=>name.endsWith(".sql")).sort();
  if(JSON.stringify(actual)!==JSON.stringify(manifest.map(entry=>entry.name).sort()))throw Error("INVENTORY");
  const files:Migration[]=[];
  for(const entry of manifest){const bytes=await readFile(new URL(entry.name,root));if(hash(bytes)!==entry.sha256)throw Error("CHECKSUM");files.push({name:entry.name,checksum:entry.sha256,sql:bytes.toString("utf8")});}
  const pool=new Pool({connectionString,ssl:{rejectUnauthorized:true,ca:process.env.LS_DATABASE_CA},max:1,connectionTimeoutMillis:5000,statement_timeout:30000});
  try{const client=await pool.connect();try{
    const tls=await client.query("SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()");
    if(tls.rows[0]?.ssl!==true)throw Error("TLS_REQUIRED");
    const result=await migrate({query:(sql,values)=>client.query(sql,values?[...values]:undefined)},files,args[0]==="--verify-only");
    process.stdout.write(JSON.stringify({code:"INTAKE_STORAGE_VERIFIED",...result,acceptingRealResponses:false})+"\n");
  }finally{client.release();}}finally{await pool.end();}
}
void main().catch(()=>{process.stderr.write("INTAKE_STORAGE_RELEASE_BLOCKED_OR_FAILED\n");process.exitCode=1;});
