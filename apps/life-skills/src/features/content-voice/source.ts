import { createHash } from "node:crypto";

export const CONTENT_VOICE_FILE_ID = "174-EqMG0QIH5rCuRgn2xYYPMX-XWJZNn";
export const COMMUNITY_PLAYBOOK_FILE_ID = "12C3QM4F6RZdpeWRvReN2x2BB7GzBnSqvfhjMg1PKwC0";
const MAX_SOURCE_BYTES = 100_000;
const TOKEN_PATTERN = /^[^\r\n]{1,4096}$/;

export type ContentVoiceSnapshot = {
  title: string;
  sourceUrl: string;
  declaredVersion: string | null;
  driveRevision: string;
  modifiedAt: string;
  checkedAt: string;
  sha256: string;
  text: string;
};

type Metadata = { id?: unknown; name?: unknown; mimeType?: unknown; modifiedTime?: unknown; version?: unknown; size?: unknown };
type DriveMetadata = { id: string; name: string; mimeType: "text/markdown"; modifiedTime: string; version: string; size: string };

function configured(env: Record<string, string | undefined>) {
  const clientId = env.LS_AUTH_GOOGLE_CLIENT_ID;
  const clientSecret = env.LS_AUTH_GOOGLE_CLIENT_SECRET;
  const refreshToken = env.LS_AUTH_GOOGLE_REFRESH_TOKEN;
  if (![clientId, clientSecret, refreshToken].every(value => typeof value === "string" && TOKEN_PATTERN.test(value))) throw new Error("CONTENT_VOICE_UNAVAILABLE");
  return { clientId: clientId!, clientSecret: clientSecret!, refreshToken: refreshToken! };
}

async function token(fetcher: typeof fetch, env: Record<string, string | undefined>) {
  const config = configured(env);
  const response = await fetcher("https://oauth2.googleapis.com/token", {
    method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(8000),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret,
      refresh_token: config.refreshToken, grant_type: "refresh_token" }).toString(),
  });
  if (!response.ok) throw new Error("CONTENT_VOICE_UNAVAILABLE");
  const data: unknown = await response.json();
  const value = data && typeof data === "object" ? (data as { access_token?: unknown }).access_token : undefined;
  if (typeof value !== "string" || !TOKEN_PATTERN.test(value)) throw new Error("CONTENT_VOICE_UNAVAILABLE");
  return value;
}

async function metadata(fetcher: typeof fetch, accessToken: string): Promise<DriveMetadata> {
  const url = `https://www.googleapis.com/drive/v3/files/${CONTENT_VOICE_FILE_ID}?fields=id,name,mimeType,modifiedTime,version,size`;
  const response = await fetcher(url, { redirect: "error", cache: "no-store", signal: AbortSignal.timeout(8000),
    headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error("CONTENT_VOICE_UNAVAILABLE");
  const value: Metadata = await response.json();
  if (value.id !== CONTENT_VOICE_FILE_ID || value.mimeType !== "text/markdown" ||
      typeof value.name !== "string" || value.name.length > 200 ||
      typeof value.version !== "string" || !/^\d+$/.test(value.version) ||
      typeof value.modifiedTime !== "string" || !Number.isFinite(Date.parse(value.modifiedTime)) ||
      typeof value.size !== "string" || !/^\d+$/.test(value.size) || Number(value.size) > MAX_SOURCE_BYTES) {
    throw new Error("CONTENT_VOICE_UNAVAILABLE");
  }
  return value as DriveMetadata;
}

/** Fetch a consistent read-only snapshot of the canonical raw Markdown file. No local master or writer exists here. */
export async function readContentVoiceSource(fetcher: typeof fetch = fetch,
  env: Record<string, string | undefined> = process.env,
  now: () => Date = () => new Date()): Promise<ContentVoiceSnapshot> {
  const accessToken = await token(fetcher, env);
  for (let attempt = 0; attempt < 2; attempt++) {
    const before = await metadata(fetcher, accessToken);
    const response = await fetcher(`https://www.googleapis.com/drive/v3/files/${CONTENT_VOICE_FILE_ID}?alt=media`, {
      redirect: "error", cache: "no-store", signal: AbortSignal.timeout(8000),
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok || Number(response.headers.get("content-length") ?? 0) > MAX_SOURCE_BYTES) throw new Error("CONTENT_VOICE_UNAVAILABLE");
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_SOURCE_BYTES) throw new Error("CONTENT_VOICE_UNAVAILABLE");
    const after = await metadata(fetcher, accessToken);
    if (before.version !== after.version || before.modifiedTime !== after.modifiedTime || bytes.length !== Number(after.size)) {
      if (attempt === 0) continue;
      throw new Error("CONTENT_VOICE_CHANGED_DURING_READ");
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const declaredVersion = text.match(/^\*\*Version:\*\*\s*(.+)$/m)?.[1]?.trim() ?? null;
    return { title: after.name, sourceUrl: `https://drive.google.com/file/d/${CONTENT_VOICE_FILE_ID}/view`,
      declaredVersion, driveRevision: after.version, modifiedAt: after.modifiedTime, checkedAt: now().toISOString(),
      sha256: createHash("sha256").update(bytes).digest("hex"), text };
  }
  throw new Error("CONTENT_VOICE_UNAVAILABLE");
}

/** The separate community-channel authority is a native Google Doc, not a copy of the writing guide. */
export async function readCommunityPlaybookSource(fetcher: typeof fetch = fetch,
  env: Record<string, string | undefined> = process.env,
  now: () => Date = () => new Date()): Promise<ContentVoiceSnapshot> {
  const accessToken = await token(fetcher, env);
  const url = `https://www.googleapis.com/drive/v3/files/${COMMUNITY_PLAYBOOK_FILE_ID}`;
  const readMetadata = async () => {
    const response = await fetcher(`${url}?fields=id,name,mimeType,modifiedTime,version`, {
      redirect: "error", cache: "no-store", signal: AbortSignal.timeout(8000),
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) throw new Error("COMMUNITY_PLAYBOOK_UNAVAILABLE");
    const value: Metadata = await response.json();
    if (value.id !== COMMUNITY_PLAYBOOK_FILE_ID || value.mimeType !== "application/vnd.google-apps.document" ||
        typeof value.name !== "string" || value.name.length > 200 ||
        typeof value.version !== "string" || !/^\d+$/.test(value.version) ||
        typeof value.modifiedTime !== "string" || !Number.isFinite(Date.parse(value.modifiedTime))) {
      throw new Error("COMMUNITY_PLAYBOOK_UNAVAILABLE");
    }
    return value as { name: string; version: string; modifiedTime: string };
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    const before = await readMetadata();
    const response = await fetcher(`${url}/export?mimeType=text%2Fplain`, {
      redirect: "error", cache: "no-store", signal: AbortSignal.timeout(8000),
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok || Number(response.headers.get("content-length") ?? 0) > MAX_SOURCE_BYTES) throw new Error("COMMUNITY_PLAYBOOK_UNAVAILABLE");
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_SOURCE_BYTES) throw new Error("COMMUNITY_PLAYBOOK_UNAVAILABLE");
    const after = await readMetadata();
    if (before.version !== after.version || before.modifiedTime !== after.modifiedTime) {
      if (attempt === 0) continue;
      throw new Error("COMMUNITY_PLAYBOOK_CHANGED_DURING_READ");
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const versions = [...text.matchAll(/^Version\s+([0-9]+(?:\.[0-9]+)*)\b/gm)];
    return { title: after.name, sourceUrl: `https://docs.google.com/document/d/${COMMUNITY_PLAYBOOK_FILE_ID}/edit`,
      declaredVersion: versions.at(-1)?.[1] ?? null, driveRevision: after.version,
      modifiedAt: after.modifiedTime, checkedAt: now().toISOString(),
      sha256: createHash("sha256").update(bytes).digest("hex"), text };
  }
  throw new Error("COMMUNITY_PLAYBOOK_UNAVAILABLE");
}
