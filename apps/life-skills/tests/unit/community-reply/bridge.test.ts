import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const sources = vi.hoisted(() => ({
  guide: vi.fn(), playbook: vi.fn(),
}));
vi.mock("../../../src/features/content-voice/source.ts", () => ({
  CONTENT_VOICE_FILE_ID: "174-EqMG0QIH5rCuRgn2xYYPMX-XWJZNn",
  COMMUNITY_PLAYBOOK_FILE_ID: "12C3QM4F6RZdpeWRvReN2x2BB7GzBnSqvfhjMg1PKwC0",
  readContentVoiceSource: sources.guide,
  readCommunityPlaybookSource: sources.playbook,
}));
import { requestCommunityReply } from "../../../src/features/community-reply/bridge.ts";

const secret = "s".repeat(43);
const command = { operationId: "412302a8-3694-4718-9a3b-e5de1a78de6e", mode: "generate" as const,
  question: "How can a family make a calmer morning routine?" };
function snapshot(id: string) { const guide = id.startsWith("174"); return { title: "Synthetic source", sourceUrl: "https://drive.google.com/", declaredVersion: guide ? "2.0" : "0.3", driveRevision: guide ? "5" : "7",
  modifiedAt: guide ? "2026-09-24T09:00:00Z" : "2026-09-17T09:00:00Z", checkedAt: "2026-09-24T09:01:00Z", sha256: (guide ? "a" : "b").repeat(64), text: "Synthetic source text." , id }; }
const data = { reply: "What is one small step that your child could choose?", copyAllowed: true, reviewFlags: [], suggestedRule: "", ruleScope: "", originalUrl: null,
  provenance: { guide: { id: "174-EqMG0QIH5rCuRgn2xYYPMX-XWJZNn", sha256: "a".repeat(64), driveRevision: "5", declaredVersion: "2.0", modifiedAt: "2026-09-24T09:00:00Z", checkedAt: "2026-09-24T09:01:00Z" },
    playbook: { id: "12C3QM4F6RZdpeWRvReN2x2BB7GzBnSqvfhjMg1PKwC0", sha256: "b".repeat(64), driveRevision: "7", declaredVersion: "0.3", modifiedAt: "2026-09-17T09:00:00Z", checkedAt: "2026-09-24T09:01:00Z" },
    policyVersion: "synthetic", generatedAt: "2026-09-24T09:01:00Z", model: "synthetic-model", usage: { inputTokens: 2, outputTokens: 3 } } };

describe("authenticated app to existing Scout bridge", () => {
  beforeEach(() => { sources.guide.mockResolvedValue(snapshot("174-EqMG0QIH5rCuRgn2xYYPMX-XWJZNn"));
    sources.playbook.mockResolvedValue(snapshot("12C3QM4F6RZdpeWRvReN2x2BB7GzBnSqvfhjMg1PKwC0")); });
  it("requires a server-only shared secret and makes no source or provider call when absent", async () => {
    const fetcher = vi.fn(); await expect(requestCommunityReply(command, fetcher as typeof fetch, {})).rejects.toMatchObject({ code: "UNAVAILABLE" });
    expect(fetcher).not.toHaveBeenCalled(); expect(sources.guide).not.toHaveBeenCalled();
  });
  it("sends both fresh canonical source snapshots to the one verified Scout service and validates provenance", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ ok: true, data }));
    const result = await requestCommunityReply(command, fetcher as typeof fetch, { LS_COMMUNITY_SCOUT_BRIDGE_SECRET: secret });
    expect(result.reply).toBe(data.reply);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, options] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://community-scout-production.up.railway.app/internal/life-skills/reply");
    expect(options.headers).toMatchObject({ Authorization: `Bearer ${secret}` });
    expect(JSON.parse(String(options.body))).toMatchObject({ operationId: command.operationId, guide: { id: data.provenance.guide.id }, playbook: { id: data.provenance.playbook.id } });
  });
  it("fails closed on mismatched source provenance or unconfirmed provider output", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ ok: true, data: { ...data, provenance: { ...data.provenance, guide: { ...data.provenance.guide, id: "wrong" } } } }))
      .mockResolvedValueOnce(Response.json({ ok: true, data: { ...data, provenance: { ...data.provenance, playbook: { ...data.provenance.playbook, sha256: "c".repeat(64) } } } }))
      .mockResolvedValueOnce(Response.json({ ok: true, data: { ...data, provenance: { ...data.provenance, playbook: { ...data.provenance.playbook, declaredVersion: "wrong" } } } }))
      .mockResolvedValueOnce(Response.json({ ok: false }));
    await expect(requestCommunityReply(command, fetcher as typeof fetch, { LS_COMMUNITY_SCOUT_BRIDGE_SECRET: secret })).rejects.toMatchObject({ code: "UNAVAILABLE" });
    await expect(requestCommunityReply(command, fetcher as typeof fetch, { LS_COMMUNITY_SCOUT_BRIDGE_SECRET: secret })).rejects.toMatchObject({ code: "UNAVAILABLE" });
    await expect(requestCommunityReply(command, fetcher as typeof fetch, { LS_COMMUNITY_SCOUT_BRIDGE_SECRET: secret })).rejects.toMatchObject({ code: "UNAVAILABLE" });
    await expect(requestCommunityReply(command, fetcher as typeof fetch, { LS_COMMUNITY_SCOUT_BRIDGE_SECRET: secret })).rejects.toMatchObject({ code: "UNAVAILABLE" });
  });
  it("refuses a different original post link in the returned draft", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ ok: true, data: { ...data, originalUrl: "https://www.facebook.com/groups/other/posts/99" } }));
    await expect(requestCommunityReply({ ...command, originalUrl: "https://www.facebook.com/groups/synthetic/posts/42" }, fetcher as typeof fetch,
      { LS_COMMUNITY_SCOUT_BRIDGE_SECRET: secret })).rejects.toMatchObject({ code: "UNAVAILABLE" });
  });
});
