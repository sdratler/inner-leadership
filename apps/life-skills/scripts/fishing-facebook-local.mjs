/** Local operator only. Never import this command into the hosted application. */
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = "C:\\Users\\User\\tools\\fb-group-auto-poster";
export const COMMIT = "1719f0551b67b56e882b821e662917933557ef10";
export const MODULES = Object.freeze({
  florida_campaign: "eed28040168658f61748d208e2a7de59ddf7e0a869adce96364a96ef6a415ea2",
  florida_browser: "3a92ad89e77c1e1d95d572f9d84037d6901727a496053a636a3cb8c2fd8bd7b4",
  safe_poster: "516fbf3ef2d99e744ee7c349546d1381ab9c49ca1a7119623f92b6eea04e3ee3",
  daily_queue: "98ef4f9a6054995776db8dd2d084bec39ca96402fe7389bd9b7bccf775f8bd73",
  weekly_cadence: "72fddfbd9b0ce7026ac4afc20afc30437be50a80a84992fde018403cd241340f",
});
const RUNTIME = Object.freeze({
  ".venv/pyvenv.cfg": "c1f66036f115a00fbd247282f442de3db2d2c4abc14db72c947d35e03b558ed7",
  ".venv/Scripts/python.exe": "e2ed9cb11ecfb365b66642e7716c86206565db0d1b06b54339f38f8d4fc92d13",
  ".python/cpython-3.11.15-windows-x86_64-none/python.exe": "e34501ad446b0d71d3a1bcbd7a825c956496cc6495e6ff395b3d37d0c165d572",
  ".python/cpython-3.11.15-windows-x86_64-none/python311.dll": "3c9b08168e7d76bff5ecf992a5568c59d2f465a276d2795784f69b7e03f8cd7a",
});
const HOSTED = /^(CI|CONTINUOUS_INTEGRATION|BUILD_NUMBER|RUN_ID|GITHUB_ACTIONS|TF_BUILD|CODESPACES|GITPOD_.*|RAILWAY_.*|VERCEL.*|NETLIFY.*|RENDER.*|HEROKU_.*|DYNO|AWS_.*|AZURE_.*|GOOGLE_CLOUD_.*|GCLOUD_.*|K_SERVICE|CLOUD_RUN_.*|CODEX_CLOUD.*|CODEX_REMOTE.*|CONTAINER.*|KUBERNETES_.*)$/i;
const TEST = /^(NODE_TEST_CONTEXT|VITEST.*|JEST_WORKER_ID|PYTEST_CURRENT_TEST)$/i;

export function parseAction(args) {
  if (!args.length) return "status";
  if (args.length === 1 && ["status", "run-due"].includes(args[0])) return args[0];
  throw new Error("Use no arguments (status), status, or run-due. No overrides are accepted.");
}

export function assertLocal({ platform, home, userHome, env }) {
  if (platform !== "win32") throw new Error("This operator requires the installed Windows desktop.");
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && (HOSTED.test(key) || TEST.test(key)
      || (key.toUpperCase() === "NODE_ENV" && ["production", "test"].includes(value)))) {
      throw new Error("Hosted, production and test processes cannot dispatch the local poster.");
    }
  }
  for (const candidate of [home, userHome]) {
    if (path.win32.join(candidate, "tools", "fb-group-auto-poster").toLowerCase() !== ROOT.toLowerCase()) {
      throw new Error("The installed poster belongs to a different Windows home; no path fallback.");
    }
  }
}

export function assertBoundPath(filename, io = fs) {
  const absolute = path.win32.resolve(filename);
  if (io.realpathSync(filename).toLowerCase() !== absolute.toLowerCase()) {
    throw new Error(`Redirected local poster path: ${filename}`);
  }
  for (let cursor = absolute; cursor !== path.win32.dirname(cursor); cursor = path.win32.dirname(cursor)) {
    if (io.lstatSync(cursor).isSymbolicLink()) throw new Error(`Linked local poster path: ${filename}`);
  }
}

export function verifyInstallation(io = fs, git = execFileSync) {
  assertBoundPath(ROOT, io);
  if (!io.lstatSync(path.win32.join(ROOT, ".git")).isDirectory()) {
    throw new Error("Expected the original installed checkout, not an alternate worktree.");
  }
  const options = { cwd: ROOT, encoding: "utf8", windowsHide: true, timeout: 10000,
    env: { ...childEnvironment(), PATH: process.env.PATH ?? process.env.Path ?? "" },
  };
  const gitArgs = ["--no-optional-locks", "-c", "core.fsmonitor=false"];
  if (git("git", [...gitArgs, "rev-parse", "--verify", "HEAD"], options).trim() !== COMMIT) {
    throw new Error("Local poster commit drifted; review the successor before changing pins.");
  }
  if (git("git", [...gitArgs, "status", "--porcelain=v1", "--untracked-files=all"], options).trim()) {
    throw new Error("Local poster checkout has unreviewed changes; no dispatch.");
  }
  const pins = { ...RUNTIME, ...Object.fromEntries(Object.entries(MODULES).map(([name, digest]) => [`${name}.py`, digest])) };
  for (const [relative, expected] of Object.entries(pins)) {
    const file = path.win32.join(ROOT, relative);
    assertBoundPath(file, io);
    if (!io.lstatSync(file).isFile() || createHash("sha256").update(io.readFileSync(file)).digest("hex") !== expected) {
      throw new Error(`Local poster fingerprint changed: ${relative}`);
    }
  }
  // These are the existing durable ledgers/profile, never a fresh state directory.
  for (const relative of ["sessions", "sessions/delivery.sqlite3", "sessions/fishing-daily.sqlite3", "sessions/playwright-profile"]) {
    assertBoundPath(path.win32.join(ROOT, relative), io);
  }
}

export function workerArguments(action) {
  if (!["status", "run-due"].includes(action)) throw new Error("Unsupported local action.");
  return ["-I", "-S", "-B", fileURLToPath(new URL("./fishing-facebook-local-worker.py", import.meta.url)), ROOT, action, JSON.stringify(MODULES)];
}

function childEnvironment() {
  // No app/provider secrets, Python startup overrides, proxies or browser overrides.
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(SystemRoot|WINDIR|TEMP|TMP|USERPROFILE|HOMEDRIVE|HOMEPATH|LOCALAPPDATA|APPDATA|USERNAME|OS|PROCESSOR_ARCHITECTURE)$/i.test(key)));
}

function main() {
  try {
    const action = parseAction(process.argv.slice(2));
    assertLocal({ platform: process.platform, home: os.homedir(), userHome: os.userInfo().homedir, env: process.env });
    verifyInstallation();
    const result = spawnSync(path.win32.join(ROOT, ".venv/Scripts/python.exe"), workerArguments(action), {
      cwd: ROOT, env: childEnvironment(), stdio: "inherit", shell: false, windowsHide: true,
    });
    if (result.error) throw result.error;
    if (result.signal) throw new Error("Local poster interrupted; check existing receipts before another due run.");
    process.exitCode = result.status ?? 1;
  } catch (error) {
    console.error(`Fishing local Facebook: ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
