import { beforeEach, expect, it, vi } from "vitest";
import { AppError } from "../../../src/lib/errors.ts";

vi.mock("server-only", () => ({}));
const mock = vi.hoisted(() => ({
  actor: vi.fn(), csrf: vi.fn(), origin: vi.fn(), csrfGuard: vi.fn(),
  get: vi.fn(), getForRequest: vi.fn(), prepare: vi.fn(), markSourceResult: vi.fn(), markDraft: vi.fn(), markDraftSourceConflict: vi.fn(),
  readSource: vi.fn(), write: vi.fn(), reply: vi.fn(),
}));
vi.mock("../../../src/features/identity/runtime.ts", () => ({ identityRuntime: async () => ({
  config: { origin: "https://life-skills.example.invalid", workspaceId: "11111111-1111-4111-8111-111111111111",
    keyring: { activeKeyId: "test", keys: {} }, lookupKey: Buffer.alloc(32) },
  store: {}, services: { sessions: { actor: mock.actor, csrf: () => "csrf" } },
}) }));
vi.mock("../../../src/lib/security/csrf.ts", () => ({ verifyCsrfToken: mock.csrfGuard, verifyMutationOrigin: mock.origin }));
vi.mock("../../../src/features/content-voice/rule-ledger.ts", () => ({ VoiceRuleLedger: class {
  get = mock.get; getForRequest = mock.getForRequest; prepare = mock.prepare;
  markSourceResult = mock.markSourceResult; markDraft = mock.markDraft; markDraftSourceConflict = mock.markDraftSourceConflict;
} }));
vi.mock("../../../src/features/content-voice/source.ts", () => ({ readContentVoiceSource: mock.readSource }));
vi.mock("../../../src/features/content-voice/drive-cas.ts", () => ({ writeContentVoiceIfUnchanged: mock.write }));
vi.mock("../../../src/features/community-reply/bridge.ts", () => ({ requestCommunityReply: mock.reply }));
import { GET, POST } from "../../../src/app/api/content-voice/corrections/route.ts";

const operationId = "12345678-1234-4123-8123-123456789abc";
const actor = { id: "22222222-2222-4222-8222-222222222222", role: "practitioner", state: "active",
  workspaceId: "11111111-1111-4111-8111-111111111111" };
const snapshot = { sha256: "a".repeat(64), driveRevision: "13", declaredVersion: "2.0",
  modifiedAt: "2026-09-28T00:00:00.000Z", checkedAt: "2026-09-28T00:01:00.000Z", text: "synthetic" };
const command = { operationId, correction: "Please keep it concise.", rule: "Keep community replies concise and conversational.",
  language: "en", sourceSha256: snapshot.sha256, sourceRevision: snapshot.driveRevision,
  question: "Synthetic public question about daily practice?", previousReply: "A verbose synthetic reply." };
const change = { operationId, actorId: actor.id, request: command, desiredText: "synthetic desired source",
  desiredSha256: "b".repeat(64), affectedRuleId: "CR-12345678123441238123123456789abc", before: null,
  after: "Keep community replies concise and conversational.", status: "pending", draftOperationId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  sourceAfterSha256: null, sourceAfterRevision: null, draftResult: null, createdAt: "2026-09-28T00:00:00Z", savedAt: null, revisedAt: null };
function post(body: unknown) { return new Request("https://life-skills.example.invalid/api/content-voice/corrections", {
  method: "POST", headers: { cookie: "__Host-ls-session=synthetic", "content-type": "application/json",
    origin: "https://life-skills.example.invalid", "x-csrf-token": "synthetic-csrf" }, body: JSON.stringify(body),
}); }
beforeEach(() => {
  vi.resetAllMocks(); mock.actor.mockResolvedValue(actor); mock.readSource.mockResolvedValue(snapshot);
  mock.getForRequest.mockResolvedValue(null); mock.prepare.mockResolvedValue(change);
});

it.each(["changed-bytes", "same-bytes-new-revision"])("stops a saved draft retry on source drift (%s), preserving its save", async mode => {
  const saved = { ...change, status: "draft_pending", desiredText: null, sourceAfterSha256: change.desiredSha256,
    sourceAfterRevision: "14", savedAt: "2026-09-28T00:02:00Z" };
  const current = { ...snapshot, sha256: mode === "changed-bytes" ? "c".repeat(64) : change.desiredSha256, driveRevision: "15" };
  mock.get.mockResolvedValue(saved); mock.getForRequest.mockResolvedValue(saved); mock.readSource.mockResolvedValue(current);
  mock.markDraft.mockResolvedValue(saved); mock.markDraftSourceConflict.mockResolvedValue({ ...saved, status: "draft_conflict" });
  const response = await POST(post({ operationId }));
  expect((await response.json()).data).toMatchObject({ status: "draft_conflict", savedAt: saved.savedAt, draftSourceConflict: true, draft: null });
  expect(mock.markDraftSourceConflict).toHaveBeenCalledWith(actor, operationId, current);
  expect(mock.reply).not.toHaveBeenCalled(); expect(mock.write).not.toHaveBeenCalled();
  mock.getForRequest.mockResolvedValue({ ...saved, status: "draft_conflict" });
  await POST(post({ operationId }));
  expect(mock.markDraftSourceConflict).toHaveBeenCalledOnce();
  expect(mock.reply).not.toHaveBeenCalled(); expect(mock.write).not.toHaveBeenCalled();
});

it("rejects a parent before touching the guide or ledger", async () => {
  mock.actor.mockResolvedValue({ ...actor, role: "parent" });
  const response = await POST(post(command));
  expect(response.status).toBe(403);
  expect(mock.readSource).not.toHaveBeenCalled(); expect(mock.write).not.toHaveBeenCalled();
  expect(mock.prepare).not.toHaveBeenCalled();
});

it("enforces mutation origin and CSRF before a guide write", async () => {
  mock.csrfGuard.mockImplementationOnce(() => { throw new AppError("FORBIDDEN"); });
  const response = await POST(post(command));
  expect(response.status).toBe(403);
  expect(mock.origin).toHaveBeenCalledOnce(); expect(mock.csrfGuard).toHaveBeenCalledOnce();
  expect(mock.readSource).not.toHaveBeenCalled(); expect(mock.write).not.toHaveBeenCalled();
});

it("keeps a permission-denied source operation pending without claiming a revised reply", async () => {
  mock.write.mockResolvedValue({ state: "permission_denied", snapshot });
  mock.markSourceResult.mockResolvedValue({ ...change, status: "permission_denied" });
  const response = await POST(post(command));
  expect(response.status).toBe(200);
  expect((await response.json()).data).toMatchObject({ status: "permission_denied", savedAt: null, draft: null });
  expect(mock.write).toHaveBeenCalledWith({ sha256: command.sourceSha256, driveRevision: command.sourceRevision }, change.desiredText);
  expect(mock.reply).not.toHaveBeenCalled();
});

it("resumes a saved operation without a second source write and returns exact draft provenance", async () => {
  const savedSource = { ...snapshot, sha256: change.desiredSha256, driveRevision: "14", declaredVersion: "2.1" };
  const saved = { ...change, status: "saved", desiredText: null, sourceAfterSha256: change.desiredSha256,
    sourceAfterRevision: "14", savedAt: "2026-09-28T00:02:00Z" };
  const draft = { operationId: change.draftOperationId, reply: "Concise synthetic reply.", provenance: {
    guide: { sha256: change.desiredSha256, driveRevision: "14", declaredVersion: "2.1", includedCommunityRuleIds: [change.affectedRuleId] },
    playbook: { driveRevision: "7" } } };
  mock.readSource.mockResolvedValue(savedSource); mock.get.mockResolvedValue(saved);
  mock.getForRequest.mockResolvedValue(saved); mock.markDraft.mockResolvedValueOnce({ ...saved, status: "draft_pending" })
    .mockResolvedValueOnce({ ...saved, status: "complete", draftResult: draft });
  mock.reply.mockResolvedValue(draft);
  const response = await POST(post({ operationId }));
  expect(response.status).toBe(200);
  expect((await response.json()).data).toMatchObject({ status: "complete", draft,
    draftInput: { question: command.question, originalUrl: "" } });
  expect(mock.write).not.toHaveBeenCalled();
  expect(mock.reply).toHaveBeenCalledWith({ operationId: change.draftOperationId, ownerId: "22222222-2222-4222-8222-222222222222", mode: "revise_once",
    question: command.question, correction: command.correction, previousReply: command.previousReply });
  const read = await GET(new Request(`https://life-skills.example.invalid/api/content-voice/corrections?operationId=${operationId}`,
    { headers: { cookie: "__Host-ls-session=synthetic" } }));
  expect((await read.json()).data).toMatchObject({ status: "saved", source: { sha256: change.desiredSha256 } });
});

it("lists only current scoped guide rules for an authenticated practitioner", async () => {
  mock.readSource.mockResolvedValue({ ...snapshot, text: `# Synthetic\n### Community-reply writing preferences\n\n**CR-12345678123441238123123456789abc — scope: community; language: en; created: 2026-09-28T00:00:00Z; updated: 2026-09-28T00:00:00Z** Keep replies concise.\n\n## 2. Article structure\n` });
  const url = "https://life-skills.example.invalid/api/content-voice/corrections?list=1";
  const response = await GET(new Request(url, { headers: { cookie: "__Host-ls-session=synthetic" } }));
  expect(response.status).toBe(200);
  expect((await response.json()).data.rules).toEqual([{ id: change.affectedRuleId, language: "en", rule: "Keep replies concise." }]);
  expect(mock.get).not.toHaveBeenCalled();
  mock.actor.mockResolvedValue({ ...actor, role: "parent" });
  const denied = await GET(new Request(url, { headers: { cookie: "__Host-ls-session=synthetic" } }));
  expect(denied.status).toBe(403);
});
