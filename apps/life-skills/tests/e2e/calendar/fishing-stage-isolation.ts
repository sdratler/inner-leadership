/** Test-only coordinator. No application imports, processes, files or database.
 * Candidate1059: authored only; ROOT must review/adopt before any execution. */
export const FISHING_STAGE_PROJECTS = Object.freeze(["desktop", "mobile390", "mobile340", "tablet768"] as const);
export type FishingStageProject = typeof FISHING_STAGE_PROJECTS[number];
export type FishingStageGroupId = "en" | "he" | "operator";
export type FishingStageIsolationGroup = Readonly<{
  id: FishingStageGroupId;
  expectedCount: 3 | 1;
  grep: string;
  titles: readonly string[];
}>;
const localeTitles = [
  "ordinary case-free parent, one shared grid/agenda, child context, durable absence/replay and existing Materials",
  "practitioner real native edit, long draft/reload conflict and retained shared agenda",
  "separately authenticated optional child and adult cannot gain parent/operator capabilities",
] as const;
const operatorTitle = "ordinary operator completion, explicit attendance and cancellation remain separate native actions with private family readback";
const localeGroup = (id: "en" | "he"): FishingStageIsolationGroup => Object.freeze({
  id, expectedCount: 3, grep: `(?:^| )${id}: `,
  titles: Object.freeze(localeTitles.map(title => `${id}: ${title}`)),
});
export const FISHING_STAGE_GROUPS: readonly FishingStageIsolationGroup[] = Object.freeze([
  localeGroup("en"), localeGroup("he"),
  Object.freeze({id: "operator", expectedCount: 1, grep: `(?:^| )${operatorTitle}$`, titles: Object.freeze([operatorTitle])}),
]);
export type FishingStageScope = Readonly<{workspaceId: string; rateScopeFingerprint: string}>;
export type FishingStageSelectedReport = Readonly<{
  selected: number; passed: number; failed: number; skipped: number; flaky: number;
  titles: readonly string[];
}>;
export type FishingStageGroupResult = Readonly<{
  project: FishingStageProject;
  group: FishingStageGroupId;
  scope: FishingStageScope;
  report: FishingStageSelectedReport;
  protectedEffects: Readonly<{tableCount: number; success: boolean; closeout: boolean}>;
  cleanup: Readonly<{tests: boolean; app: boolean; fixture: boolean; privateTemp: boolean}>;
  networkBucket: Readonly<{count: number; windowMs: number}>;
}>;
type RecordValue = Record<string, unknown>;
function record(value: unknown): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("FISHING_STAGE_REPORT_SHAPE_INVALID");
  return value as RecordValue;
}
function canonicalGroup(group: FishingStageIsolationGroup): void {
  if (!FISHING_STAGE_GROUPS.includes(group)) throw Error("FISHING_STAGE_GROUP_NOT_REGISTERED");
}
function projectName(project: string): asserts project is FishingStageProject {
  if (!(FISHING_STAGE_PROJECTS as readonly string[]).includes(project)) throw Error("EXACT_FISHING_BROWSER_PROJECT_REQUIRED");
}
function verifyReport(report: FishingStageSelectedReport, group: FishingStageIsolationGroup): void {
  if (report.selected !== group.expectedCount || report.passed !== group.expectedCount || report.failed !== 0 || report.skipped !== 0 || report.flaky !== 0 ||
      !Array.isArray(report.titles) || report.titles.length !== group.expectedCount || new Set(report.titles).size !== group.expectedCount ||
      !group.titles.every(title => report.titles.includes(title))) throw Error("FISHING_STAGE_SELECTED_REPORT_MISMATCH");
}
/** Parse the actual JSON reporter after Playwright closes. List-output text,
 * command exit zero and a caller's expected count are not acceptance evidence. */
export function parseFishingStageReport(value: unknown, group: FishingStageIsolationGroup, project: string): FishingStageSelectedReport {
  canonicalGroup(group); projectName(project);
  const report = record(value), stats = record(report.stats), titles: string[] = [];
  if (!Array.isArray(report.errors) || report.errors.length !== 0 || !Array.isArray(report.suites) ||
      stats.expected !== group.expectedCount || stats.unexpected !== 0 || stats.flaky !== 0 || stats.skipped !== 0)
    throw Error("FISHING_STAGE_REPORT_TOTALS_INVALID");
  const visit = (raw: unknown): void => {
    const suite = record(raw);
    if (!Array.isArray(suite.specs) || (suite.suites !== undefined && !Array.isArray(suite.suites))) throw Error("FISHING_STAGE_REPORT_SHAPE_INVALID");
    for (const rawSpec of suite.specs) {
      const spec = record(rawSpec);
      if (typeof spec.title !== "string" || !group.titles.includes(spec.title) || spec.ok !== true || !Array.isArray(spec.tests) || spec.tests.length !== 1)
        throw Error("FISHING_STAGE_REPORT_CASE_INVALID");
      const test = record(spec.tests[0]);
      if (test.projectName !== project || test.expectedStatus !== "passed" || test.status !== "expected" || !Array.isArray(test.results) || test.results.length !== 1)
        throw Error("FISHING_STAGE_REPORT_CASE_INVALID");
      const result = record(test.results[0]);
      if (result.status !== "passed" || result.retry !== 0 || !Array.isArray(result.errors) || result.errors.length !== 0 || result.error != null)
        throw Error("FISHING_STAGE_REPORT_CASE_INVALID");
      titles.push(spec.title);
    }
    for (const child of (suite.suites ?? []) as unknown[]) visit(child);
  };
  for (const suite of report.suites) visit(suite);
  const selected = Object.freeze({selected: titles.length, passed: titles.length, failed: 0, skipped: 0, flaky: 0, titles: Object.freeze(titles)});
  verifyReport(selected, group);
  return selected;
}
export type FishingStageGroupRunner = (
  group: FishingStageIsolationGroup,
  /** Call exactly once immediately after the fresh fixture is obtained, before
   * its browser/app journey. A rejected scope still requires owned cleanup. */
  admitScope: (scope: FishingStageScope) => void,
) => Promise<FishingStageGroupResult>;

/** A runner resolves only after its success/finally readbacks AND all owned
 * cleanup. Rejection is propagated unchanged; no later group/marker follows. */
export async function runFishingStageIsolation(
  project: string,
  runGroup: FishingStageGroupRunner,
  emit: (marker: string) => void,
) {
  projectName(project);
  const workspaces = new Set<string>(), rateScopes = new Set<string>(), results: FishingStageGroupResult[] = [];
  for (const group of FISHING_STAGE_GROUPS) {
    const admission: {scope?: FishingStageScope; active: boolean; poisoned: boolean} = {active: true, poisoned: false};
    const admitScope = (candidate: FishingStageScope): void => {
      try {
        if (!admission.active || admission.scope || !candidate || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(candidate.workspaceId) ||
            !/^[a-f0-9]{64}$/.test(candidate.rateScopeFingerprint) || workspaces.has(candidate.workspaceId) || rateScopes.has(candidate.rateScopeFingerprint))
          throw Error("FISHING_STAGE_FRESH_SCOPE_REQUIRED");
        admission.scope = Object.freeze({workspaceId: candidate.workspaceId, rateScopeFingerprint: candidate.rateScopeFingerprint});
        workspaces.add(admission.scope.workspaceId); rateScopes.add(admission.scope.rateScopeFingerprint);
      } catch (error) { admission.poisoned = true; throw error; }
    };
    let result: FishingStageGroupResult;
    try { result = await runGroup(group, admitScope); } finally { admission.active = false; }
    const scope = admission.scope;
    if (admission.poisoned || !scope || result.project !== project || result.group !== group.id ||
        result.scope.workspaceId !== scope.workspaceId || result.scope.rateScopeFingerprint !== scope.rateScopeFingerprint)
      throw Error("FISHING_STAGE_GROUP_SCOPE_MISMATCH");
    verifyReport(result.report, group);
    if (result.protectedEffects.tableCount !== 11 || result.protectedEffects.success !== true || result.protectedEffects.closeout !== true ||
        result.cleanup.tests !== true || result.cleanup.app !== true || result.cleanup.fixture !== true || result.cleanup.privateTemp !== true)
      throw Error("FISHING_STAGE_GROUP_CLOSEOUT_REQUIRED");
    if (!Number.isSafeInteger(result.networkBucket.count) || result.networkBucket.count < 1 || result.networkBucket.count > 200 || result.networkBucket.windowMs !== 900000)
      throw Error("FISHING_STAGE_NETWORK_BUCKET_INVALID");
    // Store a value snapshot. A later callback cannot rewrite an accepted group.
    results.push(Object.freeze({...result, scope, report: Object.freeze({...result.report, titles: Object.freeze([...result.report.titles])}),
      protectedEffects: Object.freeze({...result.protectedEffects}), cleanup: Object.freeze({...result.cleanup}), networkBucket: Object.freeze({...result.networkBucket})}));
    emit(`FISHING_STAGE_BROWSER_GROUP_PASS project=${project} group=${group.id} selected=${result.report.selected} passed=${result.report.passed} protectedTables=11 logicalPostchecks=1 snapshotReads=2 cleanup=complete`);
  }
  const selected = results.reduce((sum, result) => sum + result.report.selected, 0), passed = results.reduce((sum, result) => sum + result.report.passed, 0);
  if (results.length !== 3 || selected !== 7 || passed !== 7) throw Error("FISHING_STAGE_WHOLE_PROJECT_INCOMPLETE");
  emit(`FISHING_STAGE_BROWSER_ACCEPTANCE_PASS project=${project}`);
  return Object.freeze({project, selected, passed, logicalPostchecks: results.length, snapshotReads: results.length * 2, groups: Object.freeze(results)});
}
