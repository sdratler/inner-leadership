import { afterEach, expect, test, vi } from "vitest";
import { authoringReadback, practiceAudienceHref, readPracticeManagement, savePracticeAuthoring, type PracticeAuthoringCommand, type PracticeManagementData } from "../../../src/features/home-practice/management-client.ts";
import { IdentityClientError } from "../../../src/features/identity/client.ts";
import { asId } from "../../../src/lib/ids.ts";
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = { caseId: uuid(1), audienceId: uuid(2) };
const command: PracticeAuthoringCommand = { action: "create_draft", ...scope, instructions: "Retained instruction", startsOn: "2026-10-02", endsOn: null, templateKey: "W01", templateVersion: "manual-1" };
const data: PracticeManagementData = { practice: { hasMore: false, items: [{ workspaceId: asId(uuid(3), "workspace"), caseId: asId(scope.caseId, "case"), audienceId: asId(scope.audienceId, "audience"), assignmentId: asId(uuid(4), "practice_assignment"), versionId: asId(uuid(5), "practice_version"), version: 1, goalId: null, commitmentId: null, templateKey: "W01", templateVersion: "manual-1", instructions: command.instructions, startsOn: command.startsOn, endsOn: null, state: "draft", active: false, publishedAt: null, immutableSnapshotDigest: null }] }, goals: [], commitments: [] };
afterEach(() => vi.unstubAllGlobals());
test.each(["en", "he"])("%s audience navigation keeps the current section and replaces stale or repeated scope keys", locale => {
  const path = `/${locale}/app/practice`;
  const next = practiceAudienceHref(path, `?section=commitments&context=client&caseId=${uuid(9)}&audienceId=${uuid(9)}&audienceId=${uuid(8)}`, scope.caseId, scope.audienceId);
  const url = new URL(next, "https://synthetic.example.invalid");
  expect(url.pathname).toBe(path); expect(url.searchParams.get("section")).toBe("commitments");
  expect(url.searchParams.get("context")).toBe("client");
  expect(url.searchParams.getAll("caseId")).toEqual([scope.caseId]);
  expect(url.searchParams.getAll("audienceId")).toEqual([scope.audienceId]);
  expect(new URL(practiceAudienceHref(path, "", scope.caseId, scope.audienceId), url).searchParams.get("audienceId")).toBe(scope.audienceId);
});
test("authoring requests newest bounded practitioner pages for goals and commitments", async () => {
  const paths: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (path: string) => {
    paths.push(path);
    return Response.json({ ok: true, data: path.includes("home-practice") ? data.practice : [] });
  }));
  await readPracticeManagement(scope.caseId, scope.audienceId, new AbortController().signal);
  expect(paths).toHaveLength(3);
  for (const path of paths) {
    const url = new URL(path, "https://synthetic.example.invalid");
    expect(url.searchParams.get("view")).toBe("management");
    expect(url.searchParams.get("caseId")).toBe(scope.caseId);
    expect(url.searchParams.get("audienceId")).toBe(scope.audienceId);
  }
});
test("readback requires exact assignment/version and saved text, scope and links", () => {
  const receipt = { assignmentId: uuid(4), versionId: uuid(5) };
  expect(authoringReadback(command, receipt, data)).toBe(true);
  expect(authoringReadback(command, { ...receipt, versionId: uuid(6) }, data)).toBe(false);
  expect(authoringReadback({ ...command, caseId: uuid(9) }, receipt, data)).toBe(false);
  expect(authoringReadback({ ...command, instructions: "Different" }, receipt, data)).toBe(false);
  expect(authoringReadback({ ...command, goalId: uuid(9) }, receipt, data)).toBe(false);
  expect(authoringReadback({ ...command, endsOn: "2026-10-03" }, receipt, data)).toBe(false);
});
test("publication readback cannot treat a draft or an earlier inactive version as shared success", () => {
  const publish: PracticeAuthoringCommand = { action: "publish", assignmentId: uuid(4), versionId: uuid(5) };
  expect(authoringReadback(publish, {}, data)).toBe(false);
  const published = { ...data, practice: { hasMore: false, items: [{ ...data.practice.items[0]!, state: "published" as const, active: true, publishedAt: "2026-10-01T11:00:00Z", immutableSnapshotDigest: "a".repeat(64) }] } };
  expect(authoringReadback(publish, {}, published)).toBe(true);
  expect(authoringReadback(publish, {}, { ...published, practice: { ...published.practice, items: [{ ...published.practice.items[0]!, active: false }] } })).toBe(false);
});
test("ordinary authenticated mutation uses actual CSRF and does not publish a saved draft", async () => {
  const calls: { path: string; init: RequestInit | undefined }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
    calls.push({ path, init });
    return Response.json({ ok: true, data: path === "/api/identity/session" ? { role: "practitioner", csrfToken: "actual-session-csrf" } : { assignmentId: uuid(4), versionId: uuid(5) } });
  }));
  await savePracticeAuthoring(command);
  expect(calls.map(row => row.path)).toEqual(["/api/identity/session", "/api/home-practice"]);
  expect(calls[1]?.init?.headers).toMatchObject({ "X-CSRF-Token": "actual-session-csrf" });
  expect(JSON.parse(String(calls[1]?.init?.body))).toEqual(command);
  expect(calls[1]?.init).toMatchObject({ credentials: "same-origin", redirect: "error", cache: "no-store", referrerPolicy: "no-referrer" });
});
test("a customer role cannot dispatch authoring; read errors and cross-case responses fail closed", async () => {
  const fetch = vi.fn(async () => Response.json({ ok: true, data: { role: "parent", csrfToken: "irrelevant" } })); vi.stubGlobal("fetch", fetch);
  await expect(savePracticeAuthoring(command)).rejects.toEqual(new IdentityClientError("NOT_FOUND")); expect(fetch).toHaveBeenCalledTimes(1);
  vi.stubGlobal("fetch", vi.fn(async (path: string) => Response.json({ ok: true, data: path.includes("home-practice") ? { ...data.practice, items: [{ ...data.practice.items[0], caseId: uuid(99) }] } : [] })));
  await expect(readPracticeManagement(scope.caseId, scope.audienceId, new AbortController().signal)).rejects.toEqual(new IdentityClientError("UNAVAILABLE"));
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: false, error: { code: "NOT_FOUND" } }, { status: 404 })));
  await expect(readPracticeManagement(scope.caseId, scope.audienceId, new AbortController().signal)).rejects.toEqual(new IdentityClientError("NOT_FOUND"));
});
