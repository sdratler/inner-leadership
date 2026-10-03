import "server-only";
import { z } from "zod";
import { AppError } from "../../lib/errors.ts";

const SCOUT_ORIGIN = "https://community-scout-production.up.railway.app";
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const date = z.string().max(40).refine(value => Number.isFinite(Date.parse(value)));
const groupUrl = z.string().max(400).refine(value => {
  try {
    const url = new URL(value);
    return url.href === value && url.protocol === "https:" && !url.username && !url.password && !url.port && !url.search && !url.hash &&
      ["facebook.com", "www.facebook.com", "m.facebook.com"].includes(url.hostname) && /^\/groups\/[A-Za-z0-9_.-]{1,100}\/?$/.test(url.pathname);
  } catch { return false; }
});
export const requestedSettings = z.object({
  groups: z.array(z.object({ url: groupUrl, enabled: z.boolean() }).strict()).max(50),
  lookbackDays: z.union([z.literal(1), z.literal(3), z.literal(7), z.literal(14), z.literal(30)]),
  schedule: z.object({ requested: z.boolean(), localTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).nullable(), timezone: z.literal("Asia/Jerusalem") }).strict(),
  limits: z.object({ postsPerRun: z.number().int().min(1).max(1000), draftsPerDay: z.number().int().min(0).max(5000), threadsPerRun: z.number().int().min(0).max(1000) }).strict(),
  budgets: z.object({ currency: z.literal("USD"), scrapingMonthCents: z.number().int().min(0).max(1_000_000).nullable(), aiMonthCents: z.number().int().min(0).max(1_000_000).nullable() }).strict(),
  autoDraftRequested: z.boolean(),
}).strict().superRefine((value, ctx) => {
  const ids = value.groups.map(group => { try { return new URL(group.url).pathname.split("/")[2]?.toLowerCase() ?? group.url; } catch { return group.url; } });
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", message: "Duplicate group" });
  if (value.schedule.requested && (!value.schedule.localTime || !value.groups.some(group => group.enabled) || !value.budgets.scrapingMonthCents)) ctx.addIssue({ code: "custom", message: "Schedule requires a group, time and ceiling" });
  if (value.autoDraftRequested && (!value.limits.draftsPerDay || !value.budgets.aiMonthCents)) ctx.addIssue({ code: "custom", message: "Drafting requires a limit and ceiling" });
});
export const controlsCommand = z.object({ operationId: z.string().uuid(), expectedRevision: z.number().int().min(0).max(999999), settings: requestedSettings, approveCeilings: z.boolean() }).strict();
const savedControls = z.object({ revision: z.number().int().min(0).max(1_000_000), updatedAt: date.nullable(), settings: requestedSettings }).strict()
  .refine(value => value.revision === 0 ? value.updatedAt === null : value.updatedAt !== null);
export type ScoutRequestedSettings = z.infer<typeof requestedSettings>;
export type ScoutSavedControls = z.infer<typeof savedControls>;
export type ScoutControlsCommand = z.infer<typeof controlsCommand>;
const counts = (names: string[]) => z.record(z.string(), integer).refine(value => Object.keys(value).every(key => names.includes(key)));
const runtimeSettings = z.object({
  asOf: date,
  collection: z.object({ authorized: z.boolean(), allowedGroupCount: integer, providerConfigured: z.boolean(), eligible: z.boolean(), maxItemsPerRun: integer, workerEnabled: z.boolean(), autoDraft: z.boolean() }).strict(),
  limits: z.object({ aiRequestsPerUtcDay: integer, manualReplyTotal: integer, manualReplyUsed: integer, manualReplyRemaining: integer }).strict(),
  usageTodayUtc: z.object({ requests: integer, inputTokens: integer, outputTokens: integer, moneyCost: z.null() }).strict(),
  queue: z.object({ jobs: counts(["queued", "running", "done", "error"]), posts: counts(["new", "ready", "replied", "follow_up", "lead", "skipped", "expired"]) }).strict(),
  controls: savedControls,
}).strict().refine(value => value.collection.eligible === (value.collection.authorized && value.collection.allowedGroupCount > 0 && value.collection.workerEnabled && value.collection.providerConfigured) &&
  value.limits.manualReplyRemaining === Math.max(0, value.limits.manualReplyTotal - value.limits.manualReplyUsed));
export type CommunitySettings = z.infer<typeof runtimeSettings>;

async function exchange(ownerId: string, method: "GET" | "PUT", command: ScoutControlsCommand | undefined, fetcher: typeof fetch, env: Record<string, string | undefined>): Promise<unknown> {
  const secret = env.LS_COMMUNITY_SCOUT_BRIDGE_SECRET;
  if (!z.string().uuid().safeParse(ownerId).success || !secret || !/^[A-Za-z0-9_-]{43,}$/.test(secret)) throw new AppError("UNAVAILABLE");
  let response: Response;
  try {
    response = await fetcher(`${SCOUT_ORIGIN}/internal/life-skills/settings${method === "GET" ? "?" + new URLSearchParams({ ownerId }) : ""}`, {
      method, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10_000),
      headers: { Authorization: `Bearer ${secret}`, ...(command ? { "Content-Type": "application/json" } : {}) },
      ...(command ? { body: JSON.stringify({ ...command, ownerId }) } : {}),
    });
  } catch { throw new AppError("UNAVAILABLE"); }
  if (response.status === 409) throw new AppError("CONFLICT");
  if (response.status === 403) throw new AppError("FORBIDDEN");
  if (response.status === 400) throw new AppError("INVALID_REQUEST");
  if (!response.ok) throw new AppError("UNAVAILABLE");
  try {
    if (!response.body) throw Error("body");
    const reader = response.body.getReader(), chunks: Uint8Array[] = []; let length = 0;
    try {
      for (;;) { const chunk = await reader.read(); if (chunk.done) break; length += chunk.value.byteLength; if (length > 100_000) { await reader.cancel(); throw Error("envelope"); } chunks.push(chunk.value); }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!body || typeof body !== "object" || body.ok !== true) throw Error("envelope");
    return body.data;
  } catch { throw new AppError("UNAVAILABLE"); }
}
export async function readCommunitySettings(ownerId: string, fetcher: typeof fetch = fetch, env: Record<string, string | undefined> = process.env): Promise<CommunitySettings> {
  const value = runtimeSettings.safeParse(await exchange(ownerId, "GET", undefined, fetcher, env));
  if (!value.success) throw new AppError("UNAVAILABLE");
  return value.data;
}
export async function saveCommunitySettings(ownerId: string, command: ScoutControlsCommand, fetcher: typeof fetch = fetch, env: Record<string, string | undefined> = process.env): Promise<ScoutSavedControls> {
  const input = controlsCommand.safeParse(command); if (!input.success) throw new AppError("INVALID_REQUEST");
  const value = savedControls.safeParse(await exchange(ownerId, "PUT", input.data, fetcher, env));
  if (!value.success || value.data.revision !== command.expectedRevision + 1 || JSON.stringify(value.data.settings) !== JSON.stringify(input.data.settings)) throw new AppError("UNAVAILABLE");
  return value.data;
}
