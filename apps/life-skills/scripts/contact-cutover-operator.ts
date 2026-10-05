/** Owner-signed, one-action CLI for the existing native CRM transition.
 * No HTTP entry, session minting, provider call, DDL or Sheet mutation. External
 * writer/source fences and consumer reconciliation remain separate real proofs.
 * Read stdin privately; capture stdout privately (preflight contains stable IDs).
 * Historical one-shot import attestations remain unchanged.
 */
import {createHash,createPublicKey,verify} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {z} from 'zod';
import type {CutoverOperatorEnvelope} from '../src/features/contact-ops/server/cutover-operator.ts';
import type {SheetSnapshot} from '../src/features/contact-ops/server/import-plan.ts';
import type {DeltaApplication} from '../src/features/contact-ops/server/shadow-import.ts';
import type {CutoverAdvanceInput} from '../src/features/contact-ops/server/cutover-store.ts';

const root=fileURLToPath(new URL('../',import.meta.url));
const sha=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
const workspace='1553e959-b299-40e4-b82e-8529597b69ec',sourceFile='1UbbkY6h74L3_sG_m2hcBZ_rmBRLJDO7pYgghrXGdARI',sourceSheet=2105699580;
// Bootstrap trust anchor matches the existing owner-local signer. Do not execute
// any application module until its complete signed source tree is verified.
const ownerPublicKey='MCowBQYDK2VwAyEA1eM66lcH9HqHpmoDkvfI9MDw+3fwhZsnMu1A7pirBJg=';
const envelopeInput=z.object({envelope:z.record(z.string(),z.unknown()),signature:z.string().regex(/^[A-Za-z0-9+/]{86}==$/),integrityKey:z.string().regex(/^[a-f0-9]{64}$/),payload:z.unknown()}).strict();
function canonical(value:unknown):string{
 if(value===null||typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);
 if(typeof value==='number'){must(Number.isFinite(value),'CUTOVER_NON_JSON_INPUT');return JSON.stringify(value);}
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 must(typeof value==='object'&&value!==null&&Object.getPrototypeOf(value)===Object.prototype,'CUTOVER_NON_JSON_INPUT');
 return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical((value as Record<string,unknown>)[key])).join(',')+'}';
}
const snapshotSchema=z.object({fileId:z.literal(sourceFile),sheetId:z.literal(sourceSheet),tab:z.literal('Leads'),revision:z.string().min(1).max(200),complete:z.literal(true),
 headers:z.array(z.string()).max(100),rows:z.array(z.array(z.string()).max(100)).max(5000),cellTypes:z.array(z.array(z.string()).max(100)).max(5000)}).strict();
function must(value:unknown,code:string):asserts value{if(!value)throw Error(code);}
async function sourceTree(){
 const paths:string[]=[];
 async function walk(relative:string){for(const entry of await readdir(join(root,relative),{withFileTypes:true})){
  const path=relative+'/'+entry.name;
  if(entry.isDirectory())await walk(path);else if(entry.isFile())paths.push(path);else throw Error('CUTOVER_SOURCE_ENTRY_INVALID');
 }}
 for(const dir of ['src','scripts','migrations'])await walk(dir);
 paths.push('package.json','package-lock.json');paths.sort();
 const hash=createHash('sha256');for(const path of paths)hash.update(path).update('\0').update((await readFile(join(root,path),'utf8')).replace(/\r\n/g,'\n')).update('\0');
 return hash.digest('hex');
}
async function readInput(){let length=0;const chunks:Buffer[]=[];for await(const chunk of process.stdin){const b=Buffer.from(chunk);length+=b.length;must(length<=4*1024*1024,'CUTOVER_INPUT_TOO_LARGE');chunks.push(b);}
 return envelopeInput.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
}
let close:(()=>Promise<void>)|undefined;
async function main(){
 must(process.argv.length===2&&process.env.LS_NATIVE_SHADOW_IMPORT_APPROVED==='true'&&process.env.RAILWAY_PROJECT_ID==='3b756632-1f66-4f75-a016-eabc37aa0d67'&&
  process.env.RAILWAY_ENVIRONMENT_ID==='dd91bd71-57cc-45e6-a75b-8c858491d7c7'&&process.env.RAILWAY_SERVICE_ID==='0267d061-f3ce-4a0a-82d4-ce133e4501e9'&&
  /(?:^|[\\/])scripts[\\/]contact-cutover-operator\.ts$/.test(process.argv[1]??''),'CUTOVER_OPERATOR_NOT_ADMITTED');
 const input=await readInput(),e=input.envelope as CutoverOperatorEnvelope;
 must(verify(null,Buffer.from(canonical(input.envelope)),createPublicKey({key:Buffer.from(ownerPublicKey,'base64'),format:'der',type:'spki'}),Buffer.from(input.signature,'base64')),'CUTOVER_SIGNATURE_INVALID');
 must(e.workspaceId===workspace,'CUTOVER_WORKSPACE_MISMATCH');
 must(sha(canonical(input.payload))===e.payloadSha256,'CUTOVER_PAYLOAD_MISMATCH');
 must(sha(input.integrityKey)===e.integrityKeySha256,'CUTOVER_INTEGRITY_KEY_MISMATCH');
 must(sha(await readFile(fileURLToPath(import.meta.url)))===e.operatorSha256&&await sourceTree()===e.sourceTreeSha256,'CUTOVER_REVIEWED_SOURCE_MISMATCH');
 const {admitCutoverOperator}=await import('../src/features/contact-ops/server/cutover-operator.ts');
 const permit=admitCutoverOperator(e,input.signature);
 const url=process.env.LS_DATABASE_URL;
 must(url&&process.env.LS_DATABASE_TLS==='verify-full'&&process.env.LS_DATABASE_CA&&sha(url)===e.databaseBindingSha256,'CUTOVER_DATABASE_BINDING_MISMATCH');
 const parsed=new URL(url);must(parsed.hostname==='postgres.railway.internal'&&parsed.pathname==='/railway','CUTOVER_DATABASE_TARGET_MISMATCH');
 // Load application adapters only after the signed full-source/target checks.
 const [{identityRuntime},{closeDatabase},{NativeShadowImporter},{ContactCutoverStore}]=await Promise.all([
  import('../src/features/identity/runtime.ts'),import('../src/db/client.ts'),
  import('../src/features/contact-ops/server/shadow-import.ts'),import('../src/features/contact-ops/server/cutover-store.ts')]);
 close=closeDatabase;const runtime=await identityRuntime();
 must(runtime.config.workspaceId===workspace&&runtime.config.origin==='https://life-skills.bneineviimacademy.org','CUTOVER_RUNTIME_MISMATCH');
 const manifest=z.array(z.object({name:z.string().regex(/^[0-9]+_[a-z0-9_]+\.sql$/),sha256:z.string().regex(/^[a-f0-9]{64}$/)}).passthrough()).parse(JSON.parse(await readFile(join(root,'migrations/manifest.json'),'utf8')));
 for(const migration of manifest)must(sha(await readFile(join(root,'migrations',migration.name)))===migration.sha256,'CUTOVER_MIGRATION_SOURCE_MISMATCH');
 await runtime.store.transaction(async tx=>{
  await tx.query('SET TRANSACTION READ ONLY');await tx.query("SET LOCAL statement_timeout='10s'");
  const identity=await tx.query<{cluster:string;ssl:boolean}>(`SELECT (SELECT system_identifier::text FROM pg_control_system()) AS cluster,
   (SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS ssl`);
  must(identity.length===1&&identity[0]!.cluster==='7682781321794240577'&&identity[0]!.ssl,'CUTOVER_CLUSTER_MISMATCH');
  const ledger=await tx.query<{name:string;checksum:string}>('SELECT name,checksum FROM ls_control.migrations ORDER BY name');
  must(canonical(ledger)===canonical(manifest.map(m=>({name:m.name,checksum:m.sha256})).sort((a,b)=>a.name.localeCompare(b.name))),'CUTOVER_MIGRATION_LEDGER_MISMATCH');
 });
 const importer=new NativeShadowImporter(runtime.store,runtime.config.keyring,runtime.config.lookupKey,input.integrityKey,sourceFile,sourceSheet);
 let result:unknown;
 if(e.action==='preflight'||e.action==='delta'){
  const p=z.object({previous:snapshotSchema,next:snapshotSchema,...(e.action==='delta'?{input:z.object({operationId:z.string(),expectedEpoch:z.number().int().nonnegative(),versions:z.array(z.object({legacyId:z.string(),version:z.number().int().positive()}).strict()),newPeople:z.array(z.object({sourceRow:z.number().int().positive(),sourceRevision:z.string(),legacyId:z.string(),rowDigest:z.string().regex(/^[a-f0-9]{64}$/),kind:z.literal('new_person')}).strict())}).strict()}: {})}).strict().parse(input.payload);
  result=e.action==='preflight'?await importer.preflightDeltaAsOperator(p.previous as SheetSnapshot,p.next as SheetSnapshot,permit):
   await importer.applyDeltaAsOperator(p.previous as SheetSnapshot,p.next as SheetSnapshot,(p as typeof p&{input:DeltaApplication}).input,permit);
 }else{
  const p=input.payload as CutoverAdvanceInput;
  must(p&&p.action===e.action&&p.proof?.sourceFileId===sourceFile,'CUTOVER_ACTION_MISMATCH');
  result=await new ContactCutoverStore(runtime.store,runtime.config.keyring,input.integrityKey).advanceAsOperator(p,permit,runtime.config.lookupKey);
 }
 // Receipt is private operational data. No source contact payloads are returned.
 process.stdout.write(JSON.stringify({code:'CONTACT_CUTOVER_OPERATOR_OK',action:e.action,deployment:e.deploymentId,reviewedMain:e.reviewedMainSha,
  sourceTreeSha256:e.sourceTreeSha256,payloadSha256:e.payloadSha256,observedAt:new Date().toISOString(),providerEffects:false,result})+'\n');
}
main().catch(error=>{const code=error instanceof Error&&/^(CUTOVER|DELTA|IMPORT)_[A-Z0-9_]+$/.test(error.message)?error.message:'CUTOVER_OPERATION_FAILED';process.stderr.write(code+'\n');process.exitCode=1;}).finally(async()=>{await close?.().catch(()=>{process.stderr.write('CUTOVER_CLOSE_FAILED\n');process.exitCode=1;});});
