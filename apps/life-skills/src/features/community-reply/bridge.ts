import "server-only";
import { AppError } from "../../lib/errors.ts";
import { COMMUNITY_PLAYBOOK_FILE_ID, CONTENT_VOICE_FILE_ID, readCommunityPlaybookSource, readContentVoiceSource, type ContentVoiceSnapshot } from "../content-voice/source.ts";

const SCOUT_ORIGIN = "https://community-scout-production.up.railway.app";
const SECRET = /^[A-Za-z0-9_-]{43,}$/;
export type CommunityReplyCommand = {
  operationId: string;
  mode: "generate" | "revise_once";
  question: string;
  originalUrl?: string | undefined;
  correction?: string | undefined;
  previousReply?: string | undefined;
};
export type CommunityReplyResult = {
  reply: string;
  copyAllowed: boolean;
  reviewFlags: string[];
  suggestedRule: string;
  ruleScope: "" | "community" | "general";
  originalUrl: string | null;
  provenance: {
    guide: { id: string; sha256: string; driveRevision: string; declaredVersion: string | null; modifiedAt: string; checkedAt: string };
    playbook: { id: string; sha256: string; driveRevision: string; declaredVersion: string | null; modifiedAt: string; checkedAt: string };
    policyVersion: string;
    generatedAt: string;
    model: string;
    usage: { inputTokens: number; outputTokens: number };
  };
};

function sourceMatches(actual: CommunityReplyResult["provenance"]["guide"] | undefined, expected: ContentVoiceSnapshot, id: string): boolean {
  return actual?.id === id && actual.sha256 === expected.sha256 && actual.driveRevision === expected.driveRevision &&
    actual.declaredVersion === expected.declaredVersion && actual.modifiedAt === expected.modifiedAt && actual.checkedAt === expected.checkedAt;
}
function verified(value: unknown, guide: ContentVoiceSnapshot, playbook: ContentVoiceSnapshot): CommunityReplyResult {
  if (!value || typeof value !== "object") throw new AppError("UNAVAILABLE");
  const result = value as Partial<CommunityReplyResult>;
  if (typeof result.reply !== "string" || result.reply.length > 3000 || typeof result.copyAllowed !== "boolean" ||
      !Array.isArray(result.reviewFlags) || result.reviewFlags.some(item => typeof item !== "string") ||
      typeof result.suggestedRule !== "string" || result.suggestedRule.length > 400 ||
      !["", "community", "general"].includes(String(result.ruleScope)) ||
      (result.originalUrl !== null && typeof result.originalUrl !== "string") ||
      !result.provenance || !sourceMatches(result.provenance.guide, guide, CONTENT_VOICE_FILE_ID) ||
      !sourceMatches(result.provenance.playbook, playbook, COMMUNITY_PLAYBOOK_FILE_ID) ||
      typeof result.provenance.model !== "string" || typeof result.provenance.policyVersion !== "string" ||
      !Number.isFinite(Date.parse(result.provenance.generatedAt)) ||
      !Number.isSafeInteger(result.provenance.usage?.inputTokens) || !Number.isSafeInteger(result.provenance.usage?.outputTokens)) throw new AppError("UNAVAILABLE");
  return result as CommunityReplyResult;
}

export async function requestCommunityReply(command: CommunityReplyCommand,
  fetcher: typeof fetch = fetch,
  env: Record<string, string | undefined> = process.env): Promise<CommunityReplyResult> {
  const secret = env.LS_COMMUNITY_SCOUT_BRIDGE_SECRET;
  if (!secret || !SECRET.test(secret)) throw new AppError("UNAVAILABLE");
  let guide, playbook;
  try { [guide, playbook] = await Promise.all([readContentVoiceSource(fetcher, env), readCommunityPlaybookSource(fetcher, env)]); }
  catch { throw new AppError("UNAVAILABLE"); }
  let response: Response;
  try {
    response = await fetcher(`${SCOUT_ORIGIN}/internal/life-skills/reply`, {
      method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(70_000),
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ...command,
        guide: { id: CONTENT_VOICE_FILE_ID, ...guide },
        playbook: { id: COMMUNITY_PLAYBOOK_FILE_ID, ...playbook },
      }),
    });
  } catch { throw new AppError("UNAVAILABLE"); }
  if (response.status === 409) throw new AppError("CONFLICT");
  if (response.status === 429) throw new AppError("RATE_LIMITED");
  if (!response.ok) throw new AppError("UNAVAILABLE");
  let body: unknown;
  try { body = await response.json(); } catch { throw new AppError("UNAVAILABLE"); }
  if (!body || typeof body !== "object" || (body as { ok?: unknown }).ok !== true) throw new AppError("UNAVAILABLE");
  return verified((body as { data?: unknown }).data, guide, playbook);
}
