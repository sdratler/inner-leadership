import "server-only";
import { AppError } from "../../lib/errors.ts";

const SCOUT_ORIGIN = "https://community-scout-production.up.railway.app";
const SECRET = /^[A-Za-z0-9_-]{43,}$/;
const STATUSES = new Set(["all", "new", "ready", "replied", "follow_up", "lead", "skipped"]);
export type CommunityInboxPost = {
  id: number; groupName: string; groupUrl: string; postUrl: string;
  postedAt: string | null; capturedAt: string | null; excerpt: string; excerptTruncated: boolean;
  status: string; draft: string; reviewStatus: string; revision: number;
  copiedAt: string | null; manuallyPostedAt: string | null; commentsCaptured: false;
};
export type CommunityInboxPage = { items: CommunityInboxPost[]; nextCursor: string | null; commentsCaptureAvailable: false };
function facebookUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try { const url = new URL(value); return url.protocol === "https:" && ["facebook.com", "www.facebook.com", "m.facebook.com"].includes(url.hostname); }
  catch { return false; }
}

function validPost(value: unknown): value is CommunityInboxPost {
  if (!value || typeof value !== "object") return false;
  const post = value as Partial<CommunityInboxPost>;
  return Number.isSafeInteger(post.id) && (post.id ?? 0) > 0 &&
    typeof post.groupName === "string" && facebookUrl(post.groupUrl) &&
    facebookUrl(post.postUrl) && typeof post.excerpt === "string" && post.excerpt.length <= 1000 &&
    typeof post.excerptTruncated === "boolean" && typeof post.status === "string" &&
    typeof post.draft === "string" && post.draft.length <= 12000 &&
    typeof post.reviewStatus === "string" && Number.isSafeInteger(post.revision) &&
    post.commentsCaptured === false &&
    [post.postedAt, post.capturedAt, post.copiedAt, post.manuallyPostedAt].every(date => date === null || typeof date === "string");
}
function verified(value: unknown): CommunityInboxPage {
  if (!value || typeof value !== "object") throw new AppError("UNAVAILABLE");
  const data = value as Partial<CommunityInboxPage>;
  if (!Array.isArray(data.items) || data.items.length > 25 || !data.items.every(validPost) ||
    (data.nextCursor !== null && (typeof data.nextCursor !== "string" || data.nextCursor.length > 256)) ||
    data.commentsCaptureAvailable !== false) throw new AppError("UNAVAILABLE");
  return data as CommunityInboxPage;
}
export async function readCommunityInbox(status: string, cursor = "", fetcher: typeof fetch = fetch,
  env: Record<string, string | undefined> = process.env): Promise<CommunityInboxPage> {
  if (!STATUSES.has(status) || cursor.length > 256 || (cursor && !/^[A-Za-z0-9_-]+$/.test(cursor))) throw new AppError("INVALID_REQUEST");
  const secret = env.LS_COMMUNITY_SCOUT_BRIDGE_SECRET;
  if (!secret || !SECRET.test(secret)) throw new AppError("UNAVAILABLE");
  const url = new URL("/internal/life-skills/posts", SCOUT_ORIGIN);
  url.searchParams.set("status", status);
  if (cursor) url.searchParams.set("cursor", cursor);
  let response: Response;
  try { response = await fetcher(url, { method: "GET", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10_000), headers: { Authorization: `Bearer ${secret}` } }); }
  catch { throw new AppError("UNAVAILABLE"); }
  if (!response.ok) throw new AppError("UNAVAILABLE");
  let body: unknown;
  try { body = await response.json(); } catch { throw new AppError("UNAVAILABLE"); }
  if (!body || typeof body !== "object" || (body as { ok?: unknown }).ok !== true) throw new AppError("UNAVAILABLE");
  return verified((body as { data?: unknown }).data);
}
