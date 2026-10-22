/** Candidate1059: authored, NOT executed. Only the pure test coordinator is
 * imported; no fixture/application import, child process, browser, DB or I/O. */
import {test} from "vitest";
import assert from "node:assert/strict";
import {
  FISHING_STAGE_GROUPS, FISHING_STAGE_PROJECTS, parseFishingStageReport, runFishingStageIsolation,
  type FishingStageGroupResult, type FishingStageIsolationGroup, type FishingStageProject, type FishingStageScope,
} from "../e2e/calendar/fishing-stage-isolation.ts";

function scopeFor(index: number): FishingStageScope {
  return {workspaceId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, rateScopeFingerprint: String(index + 1).repeat(64)};
}
function rawReport(group: FishingStageIsolationGroup, project: FishingStageProject = "desktop") {
  return {
    errors: [] as unknown[], stats: {expected: group.expectedCount as number, unexpected: 0, flaky: 0, skipped: 0},
    suites: [{title: "fishing-stage.focused.ts", specs: group.titles.map(title => ({title, ok: true,
      tests: [{projectName: project as string, expectedStatus: "passed", status: "expected", results: [{status: "passed", retry: 0, errors: [] as unknown[]}]}],
    }))}],
  };
}
function resultFor(group: FishingStageIsolationGroup, scope: FishingStageScope, project: FishingStageProject = "desktop"): FishingStageGroupResult {
  return {project, group: group.id, scope, report: parseFishingStageReport(rawReport(group, project), group, project),
    protectedEffects: {tableCount: 11, success: true, closeout: true},
    cleanup: {tests: true, app: true, fixture: true, privateTemp: true}, networkBucket: {count: 150, windowMs: 900000}};
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return {promise, resolve};
}
const first = FISHING_STAGE_GROUPS[0]!;

test("selection keeps the exact locale prefixes and the complete operator title", () => {
  assert.deepEqual(FISHING_STAGE_GROUPS.map(group => [group.id, group.expectedCount]), [["en", 3], ["he", 3], ["operator", 1]]);
  for (const selected of FISHING_STAGE_GROUPS) {
    const pattern = new RegExp(selected.grep);
    for (const group of FISHING_STAGE_GROUPS) for (const title of group.titles)
      assert.equal(pattern.test(`desktop fishing-stage.focused.ts ${title}`), group === selected);
    assert.equal(pattern.test(`desktop fishing-stage.focused.ts pre-${selected.titles[0]}`), false);
  }
  assert.equal(new RegExp(FISHING_STAGE_GROUPS[2]!.grep).test(`${FISHING_STAGE_GROUPS[2]!.titles[0]} extra`), false);
});

for (const project of FISHING_STAGE_PROJECTS) test(`${project}: 3/3/1 actual parsed results, three postchecks and markers after cleanup`, async () => {
  const events: string[] = [];
  const result = await runFishingStageIsolation(project, async (group, admit) => {
    const scope = scopeFor(FISHING_STAGE_GROUPS.indexOf(group));
    events.push(`start:${group.id}`); admit(scope);
    const receipt = resultFor(group, scope, project);
    events.push(`cleanup:${group.id}`);
    return receipt;
  }, marker => { events.push(marker); });
  assert.equal(result.project, project); assert.equal(result.selected, 7); assert.equal(result.passed, 7);
  assert.equal(result.logicalPostchecks, 3); assert.equal(result.snapshotReads, 6);
  assert.deepEqual(result.groups.map(group => group.report.passed), [3, 3, 1]);
  const expected: string[] = [];
  for (const group of FISHING_STAGE_GROUPS) expected.push(`start:${group.id}`, `cleanup:${group.id}`,
    `FISHING_STAGE_BROWSER_GROUP_PASS project=${project} group=${group.id} selected=${group.expectedCount} passed=${group.expectedCount} protectedTables=11 logicalPostchecks=1 snapshotReads=2 cleanup=complete`);
  expected.push(`FISHING_STAGE_BROWSER_ACCEPTANCE_PASS project=${project}`);
  assert.deepEqual(events, expected);
});

test("no next group or marker can start while the current group's cleanup is pending", async () => {
  const gates = FISHING_STAGE_GROUPS.map(() => deferred()), entered = FISHING_STAGE_GROUPS.map(() => deferred());
  const starts: string[] = [], markers: string[] = [];
  const pending = runFishingStageIsolation("desktop", async (group, admit) => {
    const index = FISHING_STAGE_GROUPS.indexOf(group), scope = scopeFor(index);
    starts.push(group.id); admit(scope); entered[index]!.resolve();
    await gates[index]!.promise;
    return resultFor(group, scope);
  }, marker => { markers.push(marker); });
  try {
    await entered[0]!.promise; assert.deepEqual(starts, ["en"]); assert.deepEqual(markers, []);
    gates[0]!.resolve(); await entered[1]!.promise; assert.deepEqual(starts, ["en", "he"]); assert.equal(markers.length, 1);
    gates[1]!.resolve(); await entered[2]!.promise; assert.deepEqual(starts, ["en", "he", "operator"]); assert.equal(markers.length, 2);
    gates[2]!.resolve(); await pending; assert.equal(markers.length, 4);
  } finally { for (const gate of gates) gate.resolve(); await pending; }
});

for (const field of ["workspaceId", "rateScopeFingerprint"] as const) test(`duplicate ${field} is rejected before the next browser work, with no later group`, async () => {
  const events: string[] = [], markers: string[] = [];
  await assert.rejects(runFishingStageIsolation("desktop", async (group, admit) => {
    const index = FISHING_STAGE_GROUPS.indexOf(group), original = scopeFor(index), scope = index === 1 ? {...original, [field]: scopeFor(0)[field]} : original;
    try { admit(scope); events.push(`browser:${group.id}`); return resultFor(group, scope); }
    finally { events.push(`cleanup:${group.id}`); }
  }, marker => { markers.push(marker); }), /FRESH_SCOPE_REQUIRED/);
  assert.deepEqual(events, ["browser:en", "cleanup:en", "cleanup:he"]); assert.equal(markers.length, 1);
});

for (const primary of [new Error("synthetic primary"), null, 0, "synthetic primitive"] as const)
  test(`runner rejection preserves the primary (${primary instanceof Error ? "Error" : String(primary)}) and stops after its cleanup`, async () => {
    const events: string[] = [], markers: string[] = []; let caught: unknown = Symbol("no rejection");
    try {
      await runFishingStageIsolation("desktop", async (group, admit) => {
        admit(scopeFor(FISHING_STAGE_GROUPS.indexOf(group)));
        try { events.push(`work:${group.id}`); throw primary; }
        finally { events.push(`cleanup:${group.id}`); }
      }, marker => { markers.push(marker); });
    } catch (error) { caught = error; }
    assert.equal(caught, primary); assert.deepEqual(events, ["work:en", "cleanup:en"]); assert.deepEqual(markers, []);
  });

for (const index of [1, 2]) test(`failure in group ${index + 1} keeps only earlier completed markers`, async () => {
  const primary = new Error("owned cleanup rejected"), starts: string[] = [], markers: string[] = [];
  await assert.rejects(runFishingStageIsolation("desktop", async (group, admit) => {
    const current = FISHING_STAGE_GROUPS.indexOf(group), scope = scopeFor(current); starts.push(group.id); admit(scope);
    if (current === index) throw primary;
    return resultFor(group, scope);
  }, marker => { markers.push(marker); }), error => error === primary);
  assert.deepEqual(starts, FISHING_STAGE_GROUPS.slice(0, index + 1).map(group => group.id));
  assert.equal(markers.length, index); assert.equal(markers.some(marker => marker.includes("ACCEPTANCE_PASS")), false);
});

const invalidResults: ReadonlyArray<readonly [string, (result: FishingStageGroupResult) => FishingStageGroupResult]> = [
  ["wrong selected count", result => ({...result, report: {...result.report, selected: 2}})],
  ["wrong passed count", result => ({...result, report: {...result.report, passed: 2}})],
  ["failed result", result => ({...result, report: {...result.report, failed: 1}})],
  ["skipped result", result => ({...result, report: {...result.report, skipped: 1}})],
  ["flaky result", result => ({...result, report: {...result.report, flaky: 1}})],
  ["duplicate title", result => ({...result, report: {...result.report, titles: first.titles.map(() => first.titles[0]!)}})],
  ["other project", result => ({...result, project: "mobile390"})],
  ["other group", result => ({...result, group: "he"})],
  ["other returned workspace", result => ({...result, scope: scopeFor(2)})],
  ["wrong protected table count", result => ({...result, protectedEffects: {...result.protectedEffects, tableCount: 10}})],
  ["missing success comparison", result => ({...result, protectedEffects: {...result.protectedEffects, success: false}})],
  ["failed finally comparison", result => ({...result, protectedEffects: {...result.protectedEffects, closeout: false}})],
  ...(["tests", "app", "fixture", "privateTemp"] as const).map(field => [
    `unconfirmed ${field} cleanup`, (result: FishingStageGroupResult) => ({...result, cleanup: {...result.cleanup, [field]: false}}),
  ] as const),
  ["exhausted network bucket", result => ({...result, networkBucket: {count: 201, windowMs: 900000}})],
  ["missing network consumption", result => ({...result, networkBucket: {count: 0, windowMs: 900000}})],
  ["non-integer network count", result => ({...result, networkBucket: {count: 1.5, windowMs: 900000}})],
  ["wrong network window", result => ({...result, networkBucket: {count: 150, windowMs: 1}})],
];
for (const [name, corrupt] of invalidResults) test(`${name} blocks both group and project success`, async () => {
  const starts: string[] = [], markers: string[] = [];
  await assert.rejects(runFishingStageIsolation("desktop", async (group, admit) => {
    starts.push(group.id); const scope = scopeFor(0); admit(scope); return corrupt(resultFor(group, scope));
  }, marker => { markers.push(marker); }));
  assert.deepEqual(starts, ["en"]); assert.deepEqual(markers, []);
});

test("scope admission is mandatory, exactly once, and cannot be swallowed", async () => {
  for (const mode of ["missing", "twice", "invalid-swallowed"] as const) {
    const markers: string[] = [];
    await assert.rejects(runFishingStageIsolation("desktop", async (group, admit) => {
      const scope = scopeFor(0);
      if (mode !== "missing") {
        if (mode === "invalid-swallowed") { try { admit({...scope, rateScopeFingerprint: "not a fingerprint"}); } catch { /* coordinator must remain poisoned */ } }
        admit(scope);
        if (mode === "twice") { try { admit(scope); } catch { /* coordinator must remain poisoned */ } }
      }
      return resultFor(group, scope);
    }, marker => { markers.push(marker); }), /GROUP_SCOPE_MISMATCH/);
    assert.deepEqual(markers, []);
  }
});

test("unsupported project rejects before allocating a fixture", async () => {
  let called = false;
  await assert.rejects(runFishingStageIsolation("mobile", async () => { called = true; throw Error("must not run"); }, () => undefined), /EXACT_FISHING_BROWSER_PROJECT_REQUIRED/);
  assert.equal(called, false);
});

test("marker sink failure stops the next group and preserves its error", async () => {
  const primary = new Error("marker sink failed"), starts: string[] = [];
  await assert.rejects(runFishingStageIsolation("desktop", async (group, admit) => {
    starts.push(group.id); const scope = scopeFor(0); admit(scope); return resultFor(group, scope);
  }, () => { throw primary; }), error => error === primary);
  assert.deepEqual(starts, ["en"]);
});

type RawReport = ReturnType<typeof rawReport>;
const invalidReports: readonly [string, (report: RawReport) => void][] = [
  ["inflated expected count", report => { report.stats.expected = 7; }],
  ["unexpected count", report => { report.stats.unexpected = 1; }],
  ["skipped count", report => { report.stats.skipped = 1; }],
  ["flaky count", report => { report.stats.flaky = 1; }],
  ["global error", report => { report.errors.push({message: "synthetic"}); }],
  ["truncated cases despite claimed total", report => { report.suites[0]!.specs.pop(); }],
  ["extra case", report => { report.suites[0]!.specs.push(report.suites[0]!.specs[0]!); }],
  ["duplicate case", report => { report.suites[0]!.specs[1] = report.suites[0]!.specs[0]!; }],
  ["foreign title", report => { report.suites[0]!.specs[0]!.title = "he: unrelated"; }],
  ["spec not okay", report => { report.suites[0]!.specs[0]!.ok = false; }],
  ["extra project", report => { const spec = report.suites[0]!.specs[0]!; spec.tests.push(spec.tests[0]!); }],
  ["wrong project", report => { report.suites[0]!.specs[0]!.tests[0]!.projectName = "mobile390"; }],
  ["expected failure", report => { report.suites[0]!.specs[0]!.tests[0]!.expectedStatus = "failed"; }],
  ["flaky test", report => { report.suites[0]!.specs[0]!.tests[0]!.status = "flaky"; }],
  ["extra attempt", report => { const item = report.suites[0]!.specs[0]!.tests[0]!; item.results.push(item.results[0]!); }],
  ["skipped attempt", report => { report.suites[0]!.specs[0]!.tests[0]!.results[0]!.status = "skipped"; }],
  ["retried attempt", report => { report.suites[0]!.specs[0]!.tests[0]!.results[0]!.retry = 1; }],
  ["attempt error", report => { report.suites[0]!.specs[0]!.tests[0]!.results[0]!.errors.push({message: "synthetic"}); }],
];
for (const [name, corrupt] of invalidReports) test(`JSON reporter rejects ${name}`, () => {
  const report = rawReport(first); corrupt(report);
  assert.throws(() => parseFishingStageReport(report, first, "desktop"));
});

test("JSON reporter walks nested suites without fabricating aggregate counts", () => {
  const report = rawReport(first), specs = report.suites[0]!.specs;
  const nested = {...report, suites: [{specs: [], suites: [{specs: specs.slice(0, 1)}, {specs: specs.slice(1)}]}]};
  assert.deepEqual(parseFishingStageReport(nested, first, "desktop"), {selected: 3, passed: 3, failed: 0, skipped: 0, flaky: 0, titles: [...first.titles]});
});

test("malformed or unregistered reports/groups never yield counts", () => {
  for (const value of [null, [], {}, {stats: {}, errors: [], suites: [null]}, {...rawReport(first), suites: [{specs: null}]}])
    assert.throws(() => parseFishingStageReport(value, first, "desktop"));
  assert.throws(() => parseFishingStageReport(rawReport(first), {...first}, "desktop"), /GROUP_NOT_REGISTERED/);
});
