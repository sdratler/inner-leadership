import "server-only";
import { createHash } from "node:crypto";
import { CONTENT_VOICE_FILE_ID, contentVoiceAccessToken, readContentVoiceSource, type ContentVoiceSnapshot } from "./source.ts";

const MAX_SOURCE_BYTES = 100_000;
type Fetcher = typeof fetch;

export type RawMarkdownWriteResult =
  | { state: "saved" | "already_saved"; snapshot: ContentVoiceSnapshot }
  | { state: "conflict" | "permission_denied" | "unknown"; snapshot: ContentVoiceSnapshot | null };

type V2Metadata = { id?: unknown; mimeType?: unknown; etag?: unknown; version?: unknown; editable?: unknown };
const digest = (text: string) => createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");

/**
 * One raw-Markdown compare-and-swap, not a client-facing arbitrary-file editor.
 * The caller must compose/review a scoped rule change and durably associate its
 * operation ID with the desired bytes before calling this transport.
 * Drive v2 exposes the strong ETag missing from v3 metadata. An actual isolated
 * Drive fixture confirmed stale If-Match media uploads return 412 on 2026-09-27.
 */
export async function writeContentVoiceIfUnchanged(
  expected: Pick<ContentVoiceSnapshot, "sha256" | "driveRevision">,
  desiredText: string,
  fetcher: Fetcher = fetch,
  env: Record<string, string | undefined> = process.env,
): Promise<RawMarkdownWriteResult> {
  if (!/^[0-9a-f]{64}$/.test(expected.sha256) || !/^\d+$/.test(expected.driveRevision) ||
      typeof desiredText !== "string" || !desiredText.length || Buffer.byteLength(desiredText, "utf8") > MAX_SOURCE_BYTES ||
      desiredText.includes("\0")) throw new Error("CONTENT_VOICE_WRITE_INVALID");
  const desiredHash = digest(desiredText);
  let current: ContentVoiceSnapshot;
  try { current = await readContentVoiceSource(fetcher, env); }
  catch { return { state: "unknown", snapshot: null }; }
  // An uncertain prior write is reconciled by exact canonical readback, never by
  // blindly re-uploading. This also makes an identical retry a no-op.
  if (current.sha256 === desiredHash) return { state: "already_saved", snapshot: current };
  if (current.sha256 !== expected.sha256 || current.driveRevision !== expected.driveRevision)
    return { state: "conflict", snapshot: current };

  let accessToken: string;
  try { accessToken = await contentVoiceAccessToken(fetcher, env); }
  catch { return { state: "unknown", snapshot: current }; }
  let metadata: V2Metadata;
  try {
    const response = await fetcher(`https://www.googleapis.com/drive/v2/files/${CONTENT_VOICE_FILE_ID}?fields=id,mimeType,etag,version,editable`, {
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(8000),
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return { state: response.status === 403 ? "permission_denied" : "unknown", snapshot: current };
    metadata = await response.json() as V2Metadata;
  } catch { return { state: "unknown", snapshot: current }; }
  if (metadata.id !== CONTENT_VOICE_FILE_ID || metadata.mimeType !== "text/markdown" ||
      typeof metadata.etag !== "string" || metadata.etag.length > 256 || metadata.etag.startsWith("W/") ||
      !/^"[^"\r\n]+"$/.test(metadata.etag) || typeof metadata.version !== "string" || !/^\d+$/.test(metadata.version))
    return { state: "unknown", snapshot: current };
  if (metadata.editable !== true) return { state: "permission_denied", snapshot: current };
  if (metadata.version !== current.driveRevision) return { state: "conflict", snapshot: current };

  let uploadStatus: number | null = null;
  try {
    const response = await fetcher(`https://www.googleapis.com/upload/drive/v2/files/${CONTENT_VOICE_FILE_ID}?uploadType=media`, {
      method: "PUT", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "text/markdown; charset=utf-8", "If-Match": metadata.etag },
      body: desiredText,
    });
    uploadStatus = response.status;
  } catch { /* A timeout can occur after Google commits; read back below. */ }
  let after: ContentVoiceSnapshot | null = null;
  try { after = await readContentVoiceSource(fetcher, env); }
  catch { /* Unknown, never claim a save solely from an HTTP acknowledgement. */ }
  if (after?.sha256 === desiredHash) return { state: "saved", snapshot: after };
  if (uploadStatus === 412) return { state: "conflict", snapshot: after };
  if (uploadStatus === 403) return { state: "permission_denied", snapshot: after };
  return { state: "unknown", snapshot: after };
}
