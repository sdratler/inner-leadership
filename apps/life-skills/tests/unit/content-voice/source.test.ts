import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { CONTENT_VOICE_FILE_ID, readContentVoiceSource } from "../../../src/features/content-voice/source.ts";
import { settingsItems } from "../../../src/ui/workspace/navigation-model.ts";

const env = { LS_AUTH_GOOGLE_CLIENT_ID: "synthetic-client", LS_AUTH_GOOGLE_CLIENT_SECRET: "synthetic-secret", LS_AUTH_GOOGLE_REFRESH_TOKEN: "synthetic-refresh" };
const fixture = "# Synthetic writing guide\n**Version:** test-2.0\nKeep the wording clear.\n";
const bytes = Buffer.byteLength(fixture);
const meta = (version: string) => ({ id: CONTENT_VOICE_FILE_ID, name: "Synthetic Content Voice.md", mimeType: "text/markdown",
  modifiedTime: `2026-09-24T09:00:0${version}Z`, version, size: String(bytes) });
const oauth = () => Response.json({ access_token: "synthetic-access" });
const source = () => new Response(fixture, { headers: { "content-length": String(bytes) } });

describe("canonical Content Voice read-only snapshot", () => {
  it("offers this private source view only in practitioner settings", () => {
    expect(settingsItems("practitioner").some(item => item.key === "content_voice")).toBe(true);
    expect(settingsItems("parent").some(item => item.key === "content_voice")).toBe(false);
    expect(settingsItems("client").some(item => item.key === "content_voice")).toBe(false);
  });
  it("reads a consistent raw Markdown revision and reports its actual hash and check time", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(oauth()).mockResolvedValueOnce(Response.json(meta("1")))
      .mockResolvedValueOnce(source()).mockResolvedValueOnce(Response.json(meta("1")));
    const result = await readContentVoiceSource(fetcher as typeof fetch, env, () => new Date("2026-09-24T09:05:00Z"));
    expect(result).toMatchObject({ title: "Synthetic Content Voice.md", declaredVersion: "test-2.0", driveRevision: "1",
      modifiedAt: "2026-09-24T09:00:01Z", checkedAt: "2026-09-24T09:05:00.000Z", text: fixture });
    expect(result.sha256).toBe(createHash("sha256").update(fixture).digest("hex"));
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(fetcher.mock.calls.slice(1).every(([, options]) => options.method === undefined && options.cache === "no-store")).toBe(true);
  });

  it("retries a source changed during read without calling a writer", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(oauth())
      .mockResolvedValueOnce(Response.json(meta("1"))).mockResolvedValueOnce(source()).mockResolvedValueOnce(Response.json(meta("2")))
      .mockResolvedValueOnce(Response.json(meta("2"))).mockResolvedValueOnce(source()).mockResolvedValueOnce(Response.json(meta("2")));
    const result = await readContentVoiceSource(fetcher as typeof fetch, env);
    expect(result.driveRevision).toBe("2");
    expect(fetcher.mock.calls.slice(1).every(([url]) => String(url).includes("/drive/v3/files/"))).toBe(true);
  });

  it("does not report a stale revision current after repeated conflicts", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(oauth())
      .mockResolvedValueOnce(Response.json(meta("1"))).mockResolvedValueOnce(source()).mockResolvedValueOnce(Response.json(meta("2")))
      .mockResolvedValueOnce(Response.json(meta("2"))).mockResolvedValueOnce(source()).mockResolvedValueOnce(Response.json(meta("3")));
    await expect(readContentVoiceSource(fetcher as typeof fetch, env)).rejects.toThrow("CONTENT_VOICE_CHANGED_DURING_READ");
  });

  it("fails closed without configured existing OAuth credentials", async () => {
    const fetcher = vi.fn();
    await expect(readContentVoiceSource(fetcher as typeof fetch, {})).rejects.toThrow("CONTENT_VOICE_UNAVAILABLE");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
