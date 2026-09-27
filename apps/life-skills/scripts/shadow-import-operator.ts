/** One-shot encrypted shadow import on the registered private-app service.
 * Source JSON arrives on stdin from the owner-private, checksum-verified full
 * workbook backup. It is never logged. This does not fence the Sheet, switch
 * authority, create accounts/cases, or invoke a provider.
 */
import "server-only";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { closeDatabase } from "../src/db/client.ts";
import { validateDatabaseUrl } from "../src/lib/env/schema.ts";
import { identityRuntime } from "../src/features/identity/runtime.ts";
import { NativeShadowImporter, nativeShadowOperatorPermit, type NewPersonDisposition } from "../src/features/contact-ops/server/shadow-import.ts";
import { planImport, type SheetSnapshot } from "../src/features/contact-ops/server/import-plan.ts";

const databaseService = "354b5343-9e83-45a7-b764-09396f14ae29";
const sourceFileId = "1UbbkY6h74L3_sG_m2hcBZ_rmBRLJDO7pYgghrXGdARI";
const sourceSheetId = 2105699580;
const systemIdentifier = "7682781321794240577";

type Input = {
 snapshot: SheetSnapshot;
 dispositions: NewPersonDisposition[];
 integrityKey: string;
 expectedSnapshotDigest: string;
 backupSha256: string;
};
function fail(code: string): never { throw new Error(code); }
function options(argv: string[]) {
 const [mode, ...items] = argv;
 if (mode !== "--preflight" && mode !== "--apply") fail("IMPORT_MODE_REQUIRED");
 const out = new Map<string, string>();
 for (const item of items) {
  const match = /^--([a-z-]+)=([A-Za-z0-9:._-]+)$/.exec(item);
  if (!match || out.has(match[1]!)) fail("IMPORT_OPTION_INVALID");
  out.set(match[1]!, match[2]!);
 }
 if (out.size !== 5 || !["deployment", "database-binding", "source-revision", "operator-sha256", "source-modified-at"].every(key => out.has(key))) fail("IMPORT_OPTIONS_INCOMPLETE");
 return {mode, deployment: out.get("deployment")!, databaseBinding: out.get("database-binding")!, sourceRevision: out.get("source-revision")!, operatorSha256: out.get("operator-sha256")!, sourceModifiedAt: out.get("source-modified-at")!};
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
async function main() {
 const permit = nativeShadowOperatorPermit();
 const opt = options(process.argv.slice(2));
 if (!/^[0-9a-f-]{36}$/.test(opt.deployment) || process.env.RAILWAY_DEPLOYMENT_ID !== opt.deployment ||
  !/^[a-f0-9]{64}$/.test(opt.operatorSha256) ||
  !/^[a-f0-9]{64}$/.test(opt.databaseBinding.split(":")[1] ?? "") ||
  opt.databaseBinding.split(":")[0] !== databaseService ||
  !/^modified-\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(opt.sourceRevision) ||
  opt.sourceRevision !== `modified-${opt.sourceModifiedAt}`) fail("IMPORT_TARGET_OR_SOURCE_ARGUMENT_INVALID");
 const script = await readFile(fileURLToPath(import.meta.url));
 if (createHash("sha256").update(script).digest("hex") !== opt.operatorSha256) fail("IMPORT_OPERATOR_SOURCE_MISMATCH");
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
 const runtime = await identityRuntime();
 if (runtime.config.origin !== "https://life-skills.bneineviimacademy.org") fail("IMPORT_ORIGIN_MISMATCH");
 const plan = planImport(payload.snapshot, runtime.config.workspaceId, payload.integrityKey);
 if (!plan.canImport || plan.rows.length < 1 || plan.rows.some(row => row.issues.length) || plan.snapshotDigest !== payload.expectedSnapshotDigest ||
  plan.rows.length !== payload.dispositions.length || plan.rows.some(row => !payload.dispositions.some(decision => decision.kind === "new_person" && decision.sourceRow === row.sourceRow && decision.sourceRevision === opt.sourceRevision && decision.legacyId === row.legacyId && decision.rowDigest === row.rowDigest))) fail("IMPORT_PLAN_OR_DISPOSITION_INVALID");
 const before = await runtime.store.transaction(async tx => {
  const identity = await tx.query<{system_identifier: string; ssl: boolean}>(`SELECT
   (SELECT system_identifier FROM pg_control_system()) AS system_identifier,
   (SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS ssl`);
  if (identity.length !== 1 || identity[0]?.system_identifier !== systemIdentifier || identity[0]?.ssl !== true) fail("IMPORT_DATABASE_IDENTITY_MISMATCH");
  return (await tx.query<{links:number;profiles:number}>(`SELECT
    (SELECT count(*)::integer FROM ls_contact_ops.legacy_links WHERE workspace_id=$1 AND source_file_id=$2 AND source_sheet_id=$3) AS links,
    (SELECT count(*)::integer FROM ls_contact_ops.profiles WHERE workspace_id=$1 AND record_mode='live') AS profiles`,
   [runtime.config.workspaceId, sourceFileId, sourceSheetId]))[0];
 });
 if (!before) fail("IMPORT_BASELINE_UNAVAILABLE");
 if (opt.mode === "--preflight") {
  process.stdout.write(JSON.stringify({code:"NATIVE_SHADOW_PREFLIGHT_OK", deploymentId: opt.deployment, sourceRevision: opt.sourceRevision, snapshotDigest: plan.snapshotDigest, planned: plan.rows.length, existingLinks: before.links, existingLiveProfiles: before.profiles, backupSha256: payload.backupSha256, effects:"none"}) + "\n");
  return;
 }
 const importer = new NativeShadowImporter(runtime.store, runtime.config.keyring, runtime.config.lookupKey,
  payload.integrityKey, sourceFileId, sourceSheetId);
 const result = await importer.importNewPeopleAsOperator(runtime.config.workspaceId, payload.snapshot, payload.dispositions, permit);
 const after = await runtime.store.transaction(tx => tx.query<{links:number;profiles:number}>(`SELECT
   (SELECT count(*)::integer FROM ls_contact_ops.legacy_links WHERE workspace_id=$1 AND source_file_id=$2 AND source_sheet_id=$3) AS links,
   (SELECT count(*)::integer FROM ls_contact_ops.profiles WHERE workspace_id=$1 AND record_mode='live') AS profiles`,
  [runtime.config.workspaceId, sourceFileId, sourceSheetId]));
 if (after.length !== 1 || after[0]?.links !== plan.rows.length || after[0]?.profiles !== plan.rows.length ||
  result.created + result.replayed !== plan.rows.length) fail("IMPORT_POSTFLIGHT_FAILED");
 process.stdout.write(JSON.stringify({code:"NATIVE_SHADOW_IMPORTED_AND_VERIFIED", deploymentId: opt.deployment,
  sourceRevision: opt.sourceRevision, snapshotDigest: plan.snapshotDigest, planned: result.planned,
  created: result.created, replayed: result.replayed, encryptedProfiles: after[0].profiles,
  legacyLinks: after[0].links, backupSha256: payload.backupSha256,
  sheetAuthority:"unchanged", appReaderAuthority:"unchanged", providerEffects:"none"}) + "\n");
}
main().catch(error => { const code = error instanceof Error && /^(IMPORT|NATIVE)_[A-Z0-9_]+$/.test(error.message) ? error.message : "IMPORT_OPERATION_FAILED"; process.stderr.write(code + "\n"); process.exitCode = 1; }).finally(async () => { await closeDatabase().catch(() => undefined); });
