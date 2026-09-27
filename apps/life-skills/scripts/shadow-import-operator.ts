/** One-shot encrypted shadow import on the registered private-app service.
 * Source JSON arrives on stdin from the owner-private, checksum-verified full
 * workbook backup. It is never logged. This does not fence the Sheet, switch
 * authority, create accounts/cases, or invoke a provider.
 */
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { NewPersonDisposition } from "../src/features/contact-ops/server/shadow-import.ts";
import type { SheetSnapshot } from "../src/features/contact-ops/server/import-plan.ts";

const databaseService = "354b5343-9e83-45a7-b764-09396f14ae29";
const sourceFileId = "1UbbkY6h74L3_sG_m2hcBZ_rmBRLJDO7pYgghrXGdARI";
const sourceSheetId = 2105699580;
const systemIdentifier = "7682781321794240577";
const exactProject = "3b756632-1f66-4f75-a016-eabc37aa0d67";
const exactService = "0267d061-f3ce-4a0a-82d4-ce133e4501e9";
const exactEnvironment = "dd91bd71-57cc-45e6-a75b-8c858491d7c7";
const exactWorkspace = "1553e959-b299-40e4-b82e-8529597b69ec";
// Pinned from the independently reviewed source tree: every src file and package-lock.json.
// An unrelated later deployment must fail closed until this one-shot tool is reviewed again.
const reviewedSourceTreeSha256 = "948e1b918e562e085cd4e6ddee62fc6d4a45d589ab5de10ea8a3c043ca6f9138";

type Input = {
 snapshot: SheetSnapshot;
 dispositions: NewPersonDisposition[];
 integrityKey: string;
 expectedSnapshotDigest: string;
 backupSha256: string;
 workbookSha256: string;
 snapshotSha256: string;
 attestationSignature: string;
};
function fail(code: string): never { throw new Error(code); }
async function sourceTreeSha256(): Promise<string> {
 const appRoot=fileURLToPath(new URL("../",import.meta.url));
 const files:string[]=[];
 async function walk(dir:string,relative:string):Promise<void> {
  for(const entry of await readdir(dir,{withFileTypes:true})) {
   const name=relative?`${relative}/${entry.name}`:entry.name;
   if(entry.isDirectory()) await walk(join(dir,entry.name),name);
   else if(entry.isFile()) files.push(`src/${name}`);
   else fail("IMPORT_SOURCE_TREE_ENTRY_INVALID");
  }
 }
 await walk(join(appRoot,"src"),"");
 files.push("package-lock.json");files.sort();
 const hash=createHash("sha256");
 for(const path of files) hash.update(path).update("\0")
  .update((await readFile(join(appRoot,...path.split("/")),"utf8")).replace(/\r\n/g,"\n")).update("\0");
 return hash.digest("hex");
}
function options(argv: string[]) {
 const [mode, ...items] = argv;
 if (mode !== "--preflight" && mode !== "--apply") fail("IMPORT_MODE_REQUIRED");
 const out = new Map<string, string>();
 for (const item of items) {
  const match = /^--([a-z-]+)=([A-Za-z0-9:._-]+)$/.exec(item);
  if (!match || out.has(match[1]!)) fail("IMPORT_OPTION_INVALID");
  out.set(match[1]!, match[2]!);
 }
 if (out.size !== 6 || !["deployment", "database-binding", "source-revision", "operator-sha256", "source-modified-at", "reviewed-main"].every(key => out.has(key))) fail("IMPORT_OPTIONS_INCOMPLETE");
 return {mode, deployment: out.get("deployment")!, databaseBinding: out.get("database-binding")!, sourceRevision: out.get("source-revision")!, operatorSha256: out.get("operator-sha256")!, sourceModifiedAt: out.get("source-modified-at")!, reviewedMain: out.get("reviewed-main")!};
}
async function input(): Promise<Input> {
 const chunks: Buffer[] = [];
 let length = 0;
 for await (const chunk of process.stdin) {
  const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  length += bytes.length;
  if (length > 2 * 1024 * 1024) fail("IMPORT_INPUT_TOO_LARGE");
  chunks.push(bytes);
 }
 if (!length) fail("IMPORT_INPUT_REQUIRED");
 let parsed: unknown;
 try { parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
 catch { fail("IMPORT_INPUT_JSON_INVALID"); }
 if (!parsed || typeof parsed !== "object") fail("IMPORT_INPUT_INVALID");
 return parsed as Input;
}
let closeDatabase: (()=>Promise<void>) | undefined;
async function main() {
 if (process.env.LS_NATIVE_SHADOW_IMPORT_APPROVED !== "true" ||
  process.env.RAILWAY_PROJECT_ID !== exactProject || process.env.RAILWAY_SERVICE_ID !== exactService ||
  process.env.RAILWAY_ENVIRONMENT_ID !== exactEnvironment ||
  process.env.LS_IDENTITY_WORKSPACE_ID !== exactWorkspace ||
  !/(?:^|[\\/])scripts[\\/]shadow-import-operator\.ts$/.test(process.argv[1]??"")) fail("IMPORT_OPERATOR_NOT_ADMITTED");
 const opt = options(process.argv.slice(2));
 if (!/^[0-9a-f-]{36}$/.test(opt.deployment) || process.env.RAILWAY_DEPLOYMENT_ID !== opt.deployment ||
  !/^[a-f0-9]{64}$/.test(opt.operatorSha256) || !/^[a-f0-9]{40}$/.test(opt.reviewedMain) ||
  !/^[a-f0-9]{64}$/.test(opt.databaseBinding.split(":")[1] ?? "") ||
  opt.databaseBinding.split(":")[0] !== databaseService ||
  !/^modified-\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(opt.sourceRevision) ||
  opt.sourceRevision !== `modified-${opt.sourceModifiedAt}`) fail("IMPORT_TARGET_OR_SOURCE_ARGUMENT_INVALID");
 const script = await readFile(fileURLToPath(import.meta.url));
 if (createHash("sha256").update(script).digest("hex") !== opt.operatorSha256) fail("IMPORT_OPERATOR_SOURCE_MISMATCH");
 if (await sourceTreeSha256() !== reviewedSourceTreeSha256) fail("IMPORT_REVIEWED_SOURCE_TREE_MISMATCH");
 // No application module is evaluated until the complete reviewed tree passes.
 const [{closeDatabase:shutdown},{validateDatabaseUrl},{identityRuntime},
  {NativeShadowImporter,nativeShadowOperatorPermit},{planImport},attestation] = await Promise.all([
  import("../src/db/client.ts"),import("../src/lib/env/schema.ts"),
  import("../src/features/identity/runtime.ts"),
  import("../src/features/contact-ops/server/shadow-import.ts"),
  import("../src/features/contact-ops/server/import-plan.ts"),
  import("../src/features/contact-ops/server/shadow-attestation.ts"),
 ]);
 closeDatabase=shutdown;
 const {SHADOW_PLAN_DIGEST,SHADOW_SNAPSHOT_SHA256,SHADOW_WORKBOOK_SHA256,verifyShadowAttestation}=attestation;
 const permit=nativeShadowOperatorPermit();
 const url = process.env.LS_DATABASE_URL;
 if (!url || process.env.LS_DATABASE_TLS !== "verify-full" || !process.env.LS_DATABASE_CA) fail("IMPORT_DATABASE_CONFIGURATION_INVALID");
 const parsedUrl = validateDatabaseUrl(url, "verify-full");
 if (parsedUrl.hostname !== "postgres.railway.internal" || parsedUrl.pathname !== "/railway" ||
  createHash("sha256").update(url).digest("hex") !== opt.databaseBinding.split(":")[1]) fail("IMPORT_DATABASE_BINDING_INVALID");
 const payload = await input();
 if (!/^[a-f0-9]{64}$/.test(payload.integrityKey) || !/^[a-f0-9]{64}$/.test(payload.backupSha256) ||
  !/^[a-f0-9]{64}$/.test(payload.expectedSnapshotDigest) || !Array.isArray(payload.dispositions) ||
  !payload.snapshot || payload.snapshot.fileId !== sourceFileId || payload.snapshot.sheetId !== sourceSheetId ||
  payload.snapshot.tab !== "Leads" || payload.snapshot.revision !== opt.sourceRevision || payload.snapshot.complete !== true ||
  !Array.isArray(payload.snapshot.headers) || !Array.isArray(payload.snapshot.rows) || !Array.isArray(payload.snapshot.cellTypes)) fail("IMPORT_SOURCE_PAYLOAD_INVALID");
 const snapshotSha256=createHash("sha256").update(JSON.stringify({headers:payload.snapshot.headers,
  rows:payload.snapshot.rows,cellTypes:payload.snapshot.cellTypes})).digest("hex");
 if (payload.workbookSha256 !== SHADOW_WORKBOOK_SHA256 || payload.snapshotSha256 !== SHADOW_SNAPSHOT_SHA256 ||
  snapshotSha256 !== SHADOW_SNAPSHOT_SHA256 || payload.expectedSnapshotDigest !== SHADOW_PLAN_DIGEST ||
  !verifyShadowAttestation({workspaceId:exactWorkspace,sourceFileId,sourceSheetId,sourceRevision:opt.sourceRevision,
   deploymentId:opt.deployment,reviewedMainSha:opt.reviewedMain,operatorSha256:opt.operatorSha256,
   workbookSha256:payload.workbookSha256,
   snapshotSha256, databaseBackupSha256:payload.backupSha256},payload.attestationSignature)) fail("IMPORT_OWNER_BACKUP_ATTESTATION_INVALID");
 const runtime = await identityRuntime();
 if (runtime.config.origin !== "https://life-skills.bneineviimacademy.org" || runtime.config.workspaceId !== exactWorkspace)
  fail("IMPORT_ORIGIN_OR_WORKSPACE_MISMATCH");
 const plan = planImport(payload.snapshot, runtime.config.workspaceId, payload.integrityKey);
 if (!plan.canImport || plan.rows.length < 1 || plan.rows.some(row => row.issues.length) || plan.snapshotDigest !== SHADOW_PLAN_DIGEST ||
  plan.rows.length !== payload.dispositions.length || plan.rows.some(row => !payload.dispositions.some(decision => decision.kind === "new_person" && decision.sourceRow === row.sourceRow && decision.sourceRevision === opt.sourceRevision && decision.legacyId === row.legacyId && decision.rowDigest === row.rowDigest))) fail("IMPORT_PLAN_OR_DISPOSITION_INVALID");
 await runtime.store.transaction(async tx => {
  const identity = await tx.query<{system_identifier: string; ssl: boolean}>(`SELECT
   (SELECT system_identifier FROM pg_control_system()) AS system_identifier,
   (SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS ssl`);
  if (identity.length !== 1 || identity[0]?.system_identifier !== systemIdentifier || identity[0]?.ssl !== true) fail("IMPORT_DATABASE_IDENTITY_MISMATCH");
 });
 const importer = new NativeShadowImporter(runtime.store, runtime.config.keyring, runtime.config.lookupKey,
  payload.integrityKey, sourceFileId, sourceSheetId);
 const checked = await importer.preflightNewPeopleAsOperator(runtime.config.workspaceId, payload.snapshot, payload.dispositions, permit);
 if (opt.mode === "--preflight") {
  process.stdout.write(JSON.stringify({code:"NATIVE_SHADOW_PREFLIGHT_OK", deploymentId: opt.deployment,reviewedMainSha:opt.reviewedMain,
   sourceRevision: opt.sourceRevision, snapshotDigest: plan.snapshotDigest, planned: checked.planned,
   wouldCreate:checked.wouldCreate,replayed:checked.replayed,
   backupSha256: payload.backupSha256, effects:"none"}) + "\n");
  return;
 }
 const result = await importer.importNewPeopleAsOperator(runtime.config.workspaceId, payload.snapshot, payload.dispositions, permit);
 if (result.created + result.replayed !== plan.rows.length) fail("IMPORT_POSTFLIGHT_FAILED");
 process.stdout.write(JSON.stringify({code:"NATIVE_SHADOW_IMPORTED_AND_VERIFIED", deploymentId: opt.deployment,reviewedMainSha:opt.reviewedMain,
  sourceRevision: opt.sourceRevision, snapshotDigest: plan.snapshotDigest, planned: result.planned,
  created: result.created, replayed: result.replayed, encryptedProfilesVerifiedAtCommit: result.planned,
  legacyLinksVerifiedAtCommit: result.planned, backupSha256: payload.backupSha256,
  sheetAuthority:"unchanged", appReaderAuthority:"unchanged", providerEffects:"none"}) + "\n");
}
main().catch(error => { const code = error instanceof Error && /^(IMPORT|NATIVE)_[A-Z0-9_]+$/.test(error.message) ? error.message : "IMPORT_OPERATION_FAILED"; process.stderr.write(code + "\n"); process.exitCode = 1; }).finally(async () => { await closeDatabase?.().catch(() => undefined); });
