import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { ROOT, COMMIT, MODULES, parseAction, assertLocal, assertBoundPath, verifyInstallation, workerArguments } from "../../scripts/fishing-facebook-local.mjs";

const entry = fileURLToPath(new URL("../../scripts/fishing-facebook-local.mjs", import.meta.url));
const local = { platform: "win32", home: "C:\\Users\\User", userHome: "C:\\Users\\User", env: {} };

test("default and explicit status select only the read-only command", () => {
  assert.equal(parseAction([]), "status");
  assert.equal(parseAction(["status"]), "status");
  assert.equal(parseAction(["run-due"]), "run-due");
  for (const args of [["publish"], ["main.py"], ["--run"], ["status", "run-due"], ["run-due", "--force"], ["run-due", "GROUP"], ["run-due", "--link", "https://example.invalid"]]) {
    assert.throws(() => parseAction(args), /No overrides/);
  }
});

test("Windows home, hosted and test boundaries reject before dispatch", () => {
  assert.doesNotThrow(() => assertLocal(local));
  for (const platform of ["linux", "darwin"]) assert.throws(() => assertLocal({ ...local, platform }), /Windows desktop/);
  for (const field of ["home", "userHome"]) assert.throws(() => assertLocal({ ...local, [field]: "D:\\other" }), /different Windows home/);
  for (const key of ["CI", "GITHUB_ACTIONS", "RAILWAY_ENVIRONMENT_ID", "VERCEL", "CODESPACES", "K_SERVICE", "CONTAINER", "CODEX_CLOUD", "VITEST", "NODE_TEST_CONTEXT", "PYTEST_CURRENT_TEST"]) {
    assert.throws(() => assertLocal({ ...local, env: { [key]: "false" } }), /cannot dispatch/);
  }
  for (const value of ["production", "test"]) assert.throws(() => assertLocal({ ...local, env: { NODE_ENV: value } }), /cannot dispatch/);
});

const ordinary = { isSymbolicLink: () => false, isDirectory: () => true, isFile: () => true };
const io = { realpathSync: value => path.win32.resolve(value), lstatSync: () => ordinary, readFileSync: () => Buffer.from("changed source") };

test("redirected roots and linked ancestors fail closed", () => {
  assert.throws(() => assertBoundPath(ROOT, { ...io, realpathSync: () => "D:\\replacement" }), /Redirected/);
  assert.throws(() => assertBoundPath(ROOT, { ...io, lstatSync: value => ({ ...ordinary, isSymbolicLink: () => value === "C:\\Users\\User\\tools" }) }), /Linked/);
});

test("wrong commit, unreviewed files and fingerprint drift fail closed", () => {
  assert.throws(() => verifyInstallation(io, () => "different commit"), /commit drifted/);
  assert.throws(() => verifyInstallation(io, (_cmd, args) => args.includes("rev-parse") ? COMMIT : "?? argparse.py"), /unreviewed changes/);
  assert.throws(() => verifyInstallation(io, (_cmd, args) => args.includes("rev-parse") ? COMMIT : ""), /fingerprint changed/);
  assert.throws(() => verifyInstallation({ ...io, lstatSync: value => ({ ...ordinary, isDirectory: () => !value.endsWith(".git") }) }), /alternate worktree/);
});

test("dispatch has isolated Python, fixed root and no passthrough", () => {
  for (const action of ["status", "run-due"]) {
    const args = workerArguments(action);
    assert.deepEqual(args.slice(0, 3), ["-I", "-S", "-B"]);
    assert.equal(args[4], ROOT);
    assert.equal(args[5], action);
    assert.deepEqual(JSON.parse(args[6]), MODULES);
    assert.equal(args.length, 7);
  }
  assert.throws(() => workerArguments("poster.py"), /Unsupported/);
});

test("even an explicit due-run CLI in tests cannot start the poster", () => {
  const result = spawnSync(process.execPath, [entry, "run-due"], { encoding: "utf8", env: { ...process.env, NODE_ENV: "test" } });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /cannot dispatch|requires the installed Windows desktop/);
  assert.equal(result.stdout, "");
});

// All bridge execution below uses synthetic modules in a disposable directory.
// It never imports the installed poster or opens Facebook, even on this machine.
const installedPython = "C:\\Users\\User\\tools\\fb-group-auto-poster\\.venv\\Scripts\\python.exe";
const python = process.platform === "win32" ? (fs.existsSync(installedPython) ? installedPython : "python") : "python3";
const bridge = fileURLToPath(new URL("../../scripts/fishing-facebook-local-worker.py", import.meta.url));

function synthetic(source, action = "status", extra = {}, pinsOverride) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fishing-poster-test-"));
  try {
    const filename = path.join(root, "florida_campaign.py");
    fs.writeFileSync(filename, source);
    for (const [name, bytes] of Object.entries(extra)) fs.writeFileSync(path.join(root, name), bytes);
    const pins = pinsOverride ?? { florida_campaign: createHash("sha256").update(source).digest("hex") };
    return spawnSync(python, ["-I", "-S", "-B", bridge, root, action, JSON.stringify(pins)], {
      encoding: "utf8", env: { ...process.env, NODE_TEST_CONTEXT: "synthetic-only" }, timeout: 10000,
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("source-only bridge runs synthetic status and rejects drift", () => {
  const source = "def main():\n    print('synthetic-status')\n";
  assert.equal(synthetic(source).stdout.trim(), "synthetic-status");
  const result = synthetic(source, "status", {}, { florida_campaign: "0".repeat(64) });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /fingerprint changed/);
});

test("status rejects browser/mass-loop imports, sockets, processes and writes", () => {
  for (const [source, pattern, extra] of [
    ["import florida_browser", /cannot load a browser/, {}],
    ["import poster", /Unreviewed poster module/, { "poster.py": "raise Exception('MASS LOOP MUST NEVER EXECUTE')" }],
    ["import socket\nsocket.socket()", /cannot use network/, {}],
    ["import subprocess\nsubprocess.run(['DO_NOT_EXECUTE'])", /cannot use network/, {}],
    ["open('DO_NOT_CREATE', 'w')", /cannot write files/, {}],
  ]) {
    const result = synthetic(source, "status", extra);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, pattern);
  }
});

test("status cannot create a SQLite ledger or write an existing one", () => {
  const create = synthetic("import sqlite3\nsqlite3.connect('DO_NOT_CREATE.sqlite3')");
  assert.notEqual(create.status, 0);
  assert.match(create.stderr, /existing ledger URI/);
  const memory = synthetic("import sqlite3\nsqlite3.connect('file:test?mode=memory', uri=True)");
  assert.notEqual(memory.status, 0);
  assert.match(memory.stderr, /read-only ledger/);
  const existing = "from pathlib import Path\nimport sqlite3\ndb = sqlite3.connect(Path(__file__).parent / 'existing.sqlite3')\n";
  const read = synthetic(existing + "def main():\n    print(db.execute('SELECT 1').fetchone()[0])\n", "status", { "existing.sqlite3": "" });
  assert.equal(read.status, 0, read.stderr);
  assert.equal(read.stdout.trim(), "1");
  const write = synthetic(existing + "db.execute('CREATE TABLE forbidden(value)')", "status", { "existing.sqlite3": "" });
  assert.notEqual(write.status, 0);
  assert.match(write.stderr, /readonly database/);
});

test("direct bridge cannot dispatch a live due run under a test process", () => {
  const result = synthetic("raise Exception('MUST NOT EXECUTE')", "run-due");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Tests cannot run/);
  assert.doesNotMatch(result.stderr, /MUST NOT EXECUTE/);
});
