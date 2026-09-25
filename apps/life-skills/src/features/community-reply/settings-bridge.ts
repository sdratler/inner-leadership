import "server-only";
import { AppError } from "../../lib/errors.ts";

const SCOUT_ORIGIN = "https://community-scout-production.up.railway.app";
const SECRET = /^[A-Za-z0-9_-]{43,}$/;
export type CommunitySettings = {
  asOf: string;
  collection: { authorized: boolean; allowedGroupCount: number; active: boolean; maxItemsPerRun: number; workerEnabled: boolean; autoDraft: boolean };
  limits: { aiRequestsPerUtcDay: number; manualReplyTotal: number; manualReplyUsed: number; manualReplyRemaining: number };
  usageTodayUtc: { requests: number; inputTokens: number; outputTokens: number; moneyCost: null };
  queue: { jobs: Record<string, number>; posts: Record<string, number> };
};
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
function counts(value: unknown, names: readonly string[]): value is Record<string, number> {
  return !!value && typeof value === "object" && !Array.isArray(value) &&
    Object.entries(value).every(([name, count]) => names.includes(name) && integer(count));
}
function verified(value: unknown): CommunitySettings {
  if (!value || typeof value !== "object") throw new AppError("UNAVAILABLE");
  const item = value as Partial<CommunitySettings>;
  const c = item.collection, l = item.limits, u = item.usageTodayUtc, q = item.queue;
  if (typeof item.asOf !== "string" || !Number.isFinite(Date.parse(item.asOf)) ||
    !c || [c.authorized, c.active, c.workerEnabled, c.autoDraft].some(flag => typeof flag !== "boolean") ||
    !integer(c.allowedGroupCount) || !integer(c.maxItemsPerRun) ||
    !l || !integer(l.aiRequestsPerUtcDay) || !integer(l.manualReplyTotal) || !integer(l.manualReplyUsed) || !integer(l.manualReplyRemaining) ||
    l.manualReplyRemaining !== Math.max(0, l.manualReplyTotal - l.manualReplyUsed) ||
    !u || !integer(u.requests) || !integer(u.inputTokens) || !integer(u.outputTokens) || u.moneyCost !== null ||
    !q || !counts(q.jobs, ["queued", "running", "done", "error"]) ||
    !counts(q.posts, ["new", "ready", "replied", "follow_up", "lead", "skipped", "expired"])) throw new AppError("UNAVAILABLE");
  return item as CommunitySettings;
}
export async function readCommunitySettings(fetcher: typeof fetch = fetch,
  env: Record<string, string | undefined> = process.env): Promise<CommunitySettings> {
  const secret = env.LS_COMMUNITY_SCOUT_BRIDGE_SECRET;
  if (!secret || !SECRET.test(secret)) throw new AppError("UNAVAILABLE");
  let response: Response;
  try { response = await fetcher(`${SCOUT_ORIGIN}/internal/life-skills/settings`, { method: "GET", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10_000), headers: { Authorization: `Bearer ${secret}` } }); }
  catch { throw new AppError("UNAVAILABLE"); }
  if (!response.ok) throw new AppError("UNAVAILABLE");
  let body: unknown;
  try { body = await response.json(); } catch { throw new AppError("UNAVAILABLE"); }
  if (!body || typeof body !== "object" || (body as { ok?: unknown }).ok !== true) throw new AppError("UNAVAILABLE");
  return verified((body as { data?: unknown }).data);
}
