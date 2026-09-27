import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { writeContentVoiceIfUnchanged } from "../../../src/features/content-voice/drive-cas.ts";
import { CONTENT_VOICE_FILE_ID } from "../../../src/features/content-voice/source.ts";

vi.mock("server-only", () => ({}));

const env = { LS_AUTH_GOOGLE_CLIENT_ID: "synthetic-client", LS_AUTH_GOOGLE_CLIENT_SECRET: "synthetic-secret", LS_AUTH_GOOGLE_REFRESH_TOKEN: "synthetic-refresh" };
const original = "# Synthetic writing rules\n**Version:** fixture\nKeep language clear.\n";
const changed = "# Synthetic writing rules\n**Version:** fixture\nKeep language concise.\n";
const sha = (value: string) => createHash("sha256").update(value).digest("hex");

function fixture(options: { editable?: boolean; timeoutAfterCommit?: boolean; failReadback?: boolean; conflictBeforeUpload?: boolean } = {}) {
  let text = original, version = 1, modified = "2026-09-27T05:00:00.000Z", uploads = 0, mediaReads = 0;
  const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url === "https://oauth2.googleapis.com/token") return Response.json({ access_token: "synthetic-access" });
    if (url.includes("/drive/v3/files/") && url.includes("?fields="))
      return Response.json({ id: CONTENT_VOICE_FILE_ID, name: "Synthetic Content Voice.md", mimeType: "text/markdown",
        modifiedTime: modified, version: String(version), size: String(Buffer.byteLength(text)) });
    if (url.includes("/drive/v3/files/") && url.endsWith("?alt=media")) {
      mediaReads++;
      if (options.failReadback && mediaReads > 1) throw Error("synthetic readback outage");
      return new Response(text, { headers: { "content-length": String(Buffer.byteLength(text)) } });
    }
    if (url.includes("/drive/v2/files/") && init?.method !== "PUT")
      return Response.json({ id: CONTENT_VOICE_FILE_ID, mimeType: "text/markdown", etag: `"synthetic-${version}"`,
        version: String(version), editable: options.editable !== false });
    if (url.includes("/upload/drive/v2/files/") && init?.method === "PUT") {
      uploads++;
      if (options.conflictBeforeUpload) { text = "External edit survives.\n"; version++; modified = "2026-09-27T05:00:02.000Z"; }
      if ((init.headers as Record<string, string>)["If-Match"] !== `"synthetic-${version}"`)
        return new Response("stale", { status: 412 });
      text = String(init.body); version++; modified = "2026-09-27T05:00:01.000Z";
      if (options.timeoutAfterCommit) throw Error("synthetic response lost after commit");
      return Response.json({ id: CONTENT_VOICE_FILE_ID, version: String(version) });
    }
    throw Error(`Unexpected synthetic request ${url}`);
  });
  return { fetcher: fetcher as typeof fetch, calls: fetcher, get text() { return text; }, get uploads() { return uploads; } };
}

describe("canonical raw-Markdown conditional write transport", () => {
  const expected = { sha256: sha(original), driveRevision: "1" };
  it("uses a strong v2 ETag, reads back the exact bytes and makes an identical retry a no-op", async () => {
    const f = fixture();
    const first = await writeContentVoiceIfUnchanged(expected, changed, f.fetcher, env);
    expect(first.state).toBe("saved");
    if (first.state === "saved") expect(first.snapshot).toMatchObject({ sha256: sha(changed), driveRevision: "2" });
    const upload = f.calls.mock.calls.find(([url, init]) => String(url).includes("/upload/drive/v2/files/") && init?.method === "PUT");
    expect((upload?.[1]?.headers as Record<string, string>)["If-Match"]).toBe('"synthetic-1"');
    expect(upload?.[1]?.body).toBe(changed);
    const repeated = await writeContentVoiceIfUnchanged(expected, changed, f.fetcher, env);
    expect(repeated.state).toBe("already_saved");
    expect(f.uploads).toBe(1);
  });

  it("rejects a stale proposed revision before an upload", async () => {
    const f = fixture();
    const result = await writeContentVoiceIfUnchanged({ ...expected, driveRevision: "0" }, changed, f.fetcher, env);
    expect(result.state).toBe("conflict");
    expect(f.uploads).toBe(0);
    expect(f.text).toBe(original);
  });

  it("rejects a concurrent ETag change without overwriting the external edit", async () => {
    const f = fixture({ conflictBeforeUpload: true });
    const result = await writeContentVoiceIfUnchanged(expected, changed, f.fetcher, env);
    expect(result.state).toBe("conflict");
    expect(f.uploads).toBe(1);
    expect(f.text).toBe("External edit survives.\n");
  });

  it("refuses the real read-only principal before an upload", async () => {
    const f = fixture({ editable: false });
    const result = await writeContentVoiceIfUnchanged(expected, changed, f.fetcher, env);
    expect(result.state).toBe("permission_denied");
    expect(f.uploads).toBe(0);
  });

  it("reconciles a lost acknowledgement by exact source readback", async () => {
    const f = fixture({ timeoutAfterCommit: true });
    const result = await writeContentVoiceIfUnchanged(expected, changed, f.fetcher, env);
    expect(result.state).toBe("saved");
    expect(f.text).toBe(changed);
  });

  it("keeps an unverified acknowledgement unknown instead of claiming saved", async () => {
    const f = fixture({ failReadback: true });
    const result = await writeContentVoiceIfUnchanged(expected, changed, f.fetcher, env);
    expect(result.state).toBe("unknown");
    expect(f.uploads).toBe(1);
  });

  it("does not contact Google for invalid or oversized proposed content", async () => {
    const f = fixture();
    await expect(writeContentVoiceIfUnchanged(expected, "", f.fetcher, env)).rejects.toThrow("CONTENT_VOICE_WRITE_INVALID");
    await expect(writeContentVoiceIfUnchanged(expected, "x".repeat(100_001), f.fetcher, env)).rejects.toThrow("CONTENT_VOICE_WRITE_INVALID");
    expect(f.calls).not.toHaveBeenCalled();
  });
});
