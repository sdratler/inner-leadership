import { createHash } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { z } from "zod";

const sha = z.string().regex(/^[a-f0-9]{64}$/);
const commit = z.string().regex(/^[a-f0-9]{40}$/);
// Next.js route directories legitimately use literal brackets (for example
// `[locale]` and `[[...path]]`).  Traversal is still rejected separately.
const sourcePath = /^(?:(?:src|scripts|migrations)\/(?:[A-Za-z0-9._\-\[\]]+\/)*[A-Za-z0-9._\-\[\]]+|package(?:-lock)?\.json)$/;
const manifestSchema = z.strictObject({ reviewedCommit: commit, files: z.array(z.strictObject({ path: z.string(), sha256: sha })).min(1) });
export type CliSourceProof = Readonly<{ reviewedCommit: string; cliSourceManifestSha256?: string | undefined }>;
const digest = (value: Buffer) => createHash("sha256").update(value).digest("hex");

function checkedPath(path: string): string {
  if (!sourcePath.test(path) || path.includes("\\") || path.split("/").some(part => part === "." || part === "..")) throw new Error("CLI_SOURCE_PATH");
  return path;
}
function contained(root: string, target: string): boolean {
  const value = relative(root, target);
  return value !== "" && !value.startsWith(`..${sep}`) && value !== ".." && !isAbsolute(value);
}
async function walk(root: string, relativePath: string, output: string[]): Promise<void> {
  const absolute = resolve(root, relativePath);
  if (!contained(root, absolute)) throw new Error("CLI_SOURCE_PATH");
  const entries = await readdir(absolute, { withFileTypes: true });
  for (const entry of entries) {
    const child = relativePath ? `${relativePath}/${entry.name}` : entry.name;
    const childAbsolute = resolve(root, child);
    if (!contained(root, childAbsolute)) throw new Error("CLI_SOURCE_PATH");
    const metadata = await lstat(childAbsolute);
    if (metadata.isSymbolicLink()) throw new Error("CLI_SOURCE_SYMLINK");
    if (metadata.isDirectory()) await walk(root, child, output);
    else if (metadata.isFile()) output.push(checkedPath(child));
    else throw new Error("CLI_SOURCE_SPECIAL_FILE");
  }
}
async function inventory(root: string): Promise<string[]> {
  const values: string[] = [];
  for (const directory of ["src", "scripts", "migrations"]) {
    const metadata = await lstat(resolve(root, directory));
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error("CLI_SOURCE_SCOPE");
    await walk(root, directory, values);
  }
  for (const file of ["package.json", "package-lock.json"]) {
    const metadata = await lstat(resolve(root, file));
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("CLI_SOURCE_SCOPE");
    values.push(file);
  }
  return values.sort();
}

/** Archive deployments lack provider Git metadata.  This only accepts an explicit,
 * proof-hash-locked source manifest for the known execution scopes. */
export async function verifyReleaseSourceProvenance(proof: CliSourceProof, input: { providerGitCommit?: string | undefined; cliManifestFile?: string | undefined; root?: string | undefined }): Promise<void> {
  if (input.providerGitCommit) {
    if (input.providerGitCommit !== proof.reviewedCommit) throw new Error("STALE_REVIEW");
    return;
  }
  if (!proof.cliSourceManifestSha256 || !input.cliManifestFile || !isAbsolute(input.cliManifestFile)) throw new Error("CLI_SOURCE_PROOF");
  const root = resolve(input.root ?? process.cwd()), manifestPath = resolve(input.cliManifestFile);
  const manifestMetadata = await lstat(manifestPath);
  if (!manifestMetadata.isFile() || manifestMetadata.isSymbolicLink()) throw new Error("CLI_SOURCE_MANIFEST");
  const bytes = await readFile(manifestPath);
  if (digest(bytes) !== proof.cliSourceManifestSha256) throw new Error("CLI_SOURCE_HASH");
  const manifest = manifestSchema.parse(JSON.parse(bytes.toString("utf8")));
  if (manifest.reviewedCommit !== proof.reviewedCommit) throw new Error("STALE_REVIEW");
  const expected = new Map<string, string>();
  for (const entry of manifest.files) {
    const path = checkedPath(entry.path);
    if (expected.has(path)) throw new Error("CLI_SOURCE_DUPLICATE");
    expected.set(path, entry.sha256);
  }
  const actual = await inventory(root);
  if (actual.length !== expected.size || actual.some(path => !expected.has(path))) throw new Error("CLI_SOURCE_INVENTORY");
  for (const path of actual) {
    const absolute = resolve(root, path);
    if (!contained(root, absolute) || digest(await readFile(absolute)) !== expected.get(path)) throw new Error("CLI_SOURCE_CONTENT");
  }
}
