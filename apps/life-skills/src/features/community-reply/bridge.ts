import "server-only";
import { AppError } from "../../lib/errors.ts";
import { COMMUNITY_PLAYBOOK_FILE_ID, CONTENT_VOICE_FILE_ID, readCommunityPlaybookSource, readContentVoiceSource, type ContentVoiceSnapshot } from "../content-voice/source.ts";
import { communityRuleIdsInGuide, globalRuleIdsInGuide } from "../content-voice/rule-editor.ts";
import { isCommunitySourceUrl } from "./input-state.ts";
import { communityReplyResultSchema } from "./drafts-bridge.ts";

const SCOUT_ORIGIN = "https://community-scout-production.up.railway.app";
const SECRET = /^[A-Za-z0-9_-]{43,}$/;
export type CommunityReplyCommand = {
  operationId: string;
  /** Trusted server session only; never accepted from a browser command. */
  ownerId?: string;
  mode: "generate" | "revise_once";
  question: string;
  originalUrl?: string | undefined;
  correction?: string | undefined;
  previousReply?: string | undefined;
};
export type CommunityReplyResult = {
  operationId: string;
  reply: string;
  copyAllowed: boolean;
  reviewFlags: string[];
  suggestedRule: string;
  ruleScope: "" | "community" | "general";
  originalUrl: string | null;
  provenance: {
    guide: { id: string; sha256: string; driveRevision: string; declaredVersion: string | null; modifiedAt: string; checkedAt: string;
      includedCommunityRuleIds: string[]; includedGlobalRuleIds?: string[] | undefined };
    playbook: { id: string; sha256: string; driveRevision: string; declaredVersion: string | null; modifiedAt: string; checkedAt: string };
    policyVersion: string;
    generatedAt: string;
    model: string;
    usage: { inputTokens: number; outputTokens: number };
  };
};

function sourceMatches(actual: { id: string; sha256: string; driveRevision: string; declaredVersion: string | null;
  modifiedAt: string; checkedAt: string } | undefined, expected: ContentVoiceSnapshot, id: string): boolean {
  return actual?.id === id && actual.sha256 === expected.sha256 && actual.driveRevision === expected.driveRevision &&
    actual.declaredVersion === expected.declaredVersion && actual.modifiedAt === expected.modifiedAt && actual.checkedAt === expected.checkedAt;
}
function verified(value: unknown, guide: ContentVoiceSnapshot, playbook: ContentVoiceSnapshot, command: CommunityReplyCommand, originalUrl: string | null): CommunityReplyResult {
  if (!value || typeof value !== "object") throw new AppError("UNAVAILABLE");
  const result = value as Partial<CommunityReplyResult>;
  if (result.operationId !== command.operationId || result.originalUrl !== originalUrl ||
      !result.provenance || !sourceMatches(result.provenance.guide, guide, CONTENT_VOICE_FILE_ID) ||
      !sourceMatches(result.provenance.playbook, playbook, COMMUNITY_PLAYBOOK_FILE_ID)) throw new AppError("UNAVAILABLE");
  // These IDs were included in the exact canonical snapshot sent to Scout.
  // They are input provenance, not a claim that the model obeyed every rule.
  const globalIds=globalRuleIdsInGuide(guide.text);
  const {includedGlobalRuleIds:providerGlobalIds,...guideProvenance}=result.provenance.guide;
  if(providerGlobalIds?.length&&JSON.stringify(providerGlobalIds)!==JSON.stringify(globalIds))throw new AppError('UNAVAILABLE');
  const parsed=communityReplyResultSchema.safeParse({ ...result, provenance: { ...result.provenance,
    guide: { ...guideProvenance, includedCommunityRuleIds: communityRuleIdsInGuide(guide.text),
      ...(globalIds.length||providerGlobalIds!==undefined?{includedGlobalRuleIds:globalIds}:{}) } } });
  if(!parsed.success)throw new AppError("UNAVAILABLE");
  return parsed.data;
}

export async function requestCommunityReply(command: CommunityReplyCommand,
  fetcher: typeof fetch = fetch,
  env: Record<string, string | undefined> = process.env): Promise<CommunityReplyResult> {
  const secret = env.LS_COMMUNITY_SCOUT_BRIDGE_SECRET;
  if (!secret || !SECRET.test(secret)) throw new AppError("UNAVAILABLE");
  if (command.ownerId !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(command.ownerId)) throw new AppError("UNAVAILABLE");
  if (command.originalUrl !== undefined && !isCommunitySourceUrl(command.originalUrl)) throw new AppError("UNAVAILABLE");
  let originalUrl: string | null = null;
  try { originalUrl = command.originalUrl ? new URL(command.originalUrl).toString() : null; }
  catch { throw new AppError("UNAVAILABLE"); }
  let guide, playbook;
  try { [guide, playbook] = await Promise.all([readContentVoiceSource(fetcher, env), readCommunityPlaybookSource(fetcher, env)]); }
  catch { throw new AppError("UNAVAILABLE"); }
  let response: Response;
  try {
    response = await fetcher(`${SCOUT_ORIGIN}/internal/life-skills/reply`, {
      method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(70_000),
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ...command, ...(originalUrl ? { originalUrl } : {}),
        guide: { id: CONTENT_VOICE_FILE_ID, ...guide, includedCommunityRuleIds: communityRuleIdsInGuide(guide.text),
          ...(globalRuleIdsInGuide(guide.text).length?{includedGlobalRuleIds:globalRuleIdsInGuide(guide.text)}:{}) },
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
  return verified((body as { data?: unknown }).data, guide, playbook, command, originalUrl);
}
