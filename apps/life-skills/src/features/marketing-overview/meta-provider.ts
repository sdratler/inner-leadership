import type { AdDailyPoint, AdSnapshot } from "./contracts.ts";

type GraphRow = Record<string, unknown>;
type GraphPage = { data?: GraphRow[]; paging?: { next?: string } };

function dateInZone(now: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const value = (type: string) => parts.find(part => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function addDays(localDate: string, days: number): string {
  const value = new Date(`${localDate}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function number(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function countAction(actions: unknown, pattern: RegExp): number | null {
  if (!Array.isArray(actions)) return null;
  const matched = actions.filter(action => action && typeof action === "object" && pattern.test(String((action as GraphRow).action_type ?? "")));
  if (!matched.length) return null;
  return matched.reduce((sum, action) => sum + (number((action as GraphRow).value) ?? 0), 0);
}

function moneyMinor(value: unknown): number | null {
  const parsed = number(value);
  return parsed === null ? null : Math.round(parsed * 100);
}

function safeInteger(value: unknown): number | null {
  const parsed = number(value);
  return parsed === null ? null : Math.round(parsed);
}

async function graphJson(fetcher: typeof fetch, url: URL): Promise<GraphRow> {
  const response = await fetcher(url, { cache: "no-store", redirect: "error", headers: { Accept: "application/json" } });
  const body = await response.json().catch(() => null) as GraphRow | null;
  if (!response.ok || !body || typeof body !== "object" || body.error) throw new Error("meta_graph_read_failed");
  return body;
}

async function graphRows(fetcher: typeof fetch, first: URL): Promise<GraphRow[]> {
  const rows: GraphRow[] = [];
  let next: URL | null = first;
  for (let page = 0; next && page < 20; page += 1) {
    const body = await graphJson(fetcher, next) as GraphPage;
    rows.push(...(Array.isArray(body.data) ? body.data : []));
    if (!body.paging?.next) break;
    const candidate = new URL(body.paging.next);
    if (candidate.protocol !== "https:" || candidate.hostname !== "graph.facebook.com") throw new Error("meta_graph_pagination_rejected");
    next = candidate;
  }
  return rows;
}

function url(version: string, path: string, token: string, params: Record<string, string>): URL {
  const result = new URL(`https://graph.facebook.com/${version}/${path.replace(/^\/+/, "")}`);
  result.searchParams.set("access_token", token);
  for (const [key, value] of Object.entries(params)) result.searchParams.set(key, value);
  return result;
}

function campaignStatus(value: unknown): AdSnapshot["status"] {
  const normalized = String(value ?? "").toUpperCase();
  if (normalized === "ACTIVE") return "active";
  if (["PAUSED", "CAMPAIGN_PAUSED", "ADSET_PAUSED", "ARCHIVED", "DELETED"].includes(normalized)) return "paused";
  return "unknown";
}

export async function readDirectMetaAds({
  env = process.env,
  fetcher = fetch,
  now = new Date(),
}: { env?: NodeJS.ProcessEnv; fetcher?: typeof fetch; now?: Date } = {}): Promise<{
  ads: AdSnapshot[];
  adSeries: AdDailyPoint[];
  fetchedAt: string;
  account: { id: string; name: string; currency: string; timezone: string };
}> {
  const token = String(env.LS_META_SYSTEM_USER_TOKEN ?? "").trim();
  const rawAccount = String(env.LS_META_AD_ACCOUNT_ID ?? "").trim();
  const version = String(env.LS_META_GRAPH_VERSION ?? "v26.0").trim();
  if (token.length < 32 || !/^(?:act_)?\d+$/.test(rawAccount) || !/^v\d+\.\d+$/.test(version)) throw new Error("meta_direct_connection_not_configured");
  const accountId = rawAccount.startsWith("act_") ? rawAccount : `act_${rawAccount}`;
  const accountBody = await graphJson(fetcher, url(version, accountId, token, { fields: "id,name,currency,timezone_name,account_status" }));
  const timezone = String(accountBody.timezone_name ?? "Asia/Jerusalem");
  const currency = String(accountBody.currency ?? "USD");
  const today = dateInZone(now, timezone);
  const currentEnd = addDays(today, -1);
  const currentStart = addDays(currentEnd, -6);
  const previousEnd = addDays(currentStart, -1);
  const previousStart = addDays(previousEnd, -6);
  const insightsFields = "campaign_id,campaign_name,spend,impressions,reach,inline_link_clicks,actions";
  const [campaigns, current, previous, daily] = await Promise.all([
    graphRows(fetcher, url(version, `${accountId}/campaigns`, token, { fields: "id,name,status,effective_status,start_time,stop_time", limit: "200" })),
    graphRows(fetcher, url(version, `${accountId}/insights`, token, { level: "campaign", fields: insightsFields, time_range: JSON.stringify({ since: currentStart, until: currentEnd }), limit: "500" })),
    graphRows(fetcher, url(version, `${accountId}/insights`, token, { level: "campaign", fields: "campaign_id,spend", time_range: JSON.stringify({ since: previousStart, until: previousEnd }), limit: "500" })),
    graphRows(fetcher, url(version, `${accountId}/insights`, token, { level: "account", fields: "spend,inline_link_clicks,actions", time_range: JSON.stringify({ since: currentStart, until: currentEnd }), time_increment: "1", limit: "100" })),
  ]);
  const campaignById = new Map(campaigns.map(row => [String(row.id), row]));
  const currentById = new Map(current.map(row => [String(row.campaign_id), row]));
  const previousById = new Map(previous.map(row => [String(row.campaign_id), row]));
  const ids = new Set([...campaignById.keys(), ...currentById.keys()]);
  const ads = [...ids].map(id => {
    const campaign = campaignById.get(id) ?? {};
    const metrics = currentById.get(id) ?? {};
    const prior = previousById.get(id) ?? {};
    const spendMinor = moneyMinor(metrics.spend);
    const impressions = safeInteger(metrics.impressions);
    const linkClicks = safeInteger(metrics.inline_link_clicks);
    const providerResults = countAction(metrics.actions, /messaging_conversation_started/i);
    return {
      id,
      name: String(campaign.name ?? metrics.campaign_name ?? id),
      platform: "meta" as const,
      status: campaignStatus(campaign.effective_status ?? campaign.status),
      creativeAssetIds: [],
      currency,
      spendMinor,
      inquiries: null,
      impressions,
      reach: safeInteger(metrics.reach),
      linkClicks,
      linkCtr: impressions && linkClicks !== null ? (linkClicks / impressions) * 100 : null,
      costPerLinkClickMinor: linkClicks && spendMinor !== null ? Math.round(spendMinor / linkClicks) : null,
      providerResults,
      providerResultLabel: providerResults === null ? null : "Meta messaging conversations started",
      costPerResultMinor: providerResults && spendMinor !== null ? Math.round(spendMinor / providerResults) : null,
      startDate: typeof campaign.start_time === "string" ? campaign.start_time : null,
      endDate: typeof campaign.stop_time === "string" ? campaign.stop_time : null,
      previousSpendMinor: moneyMinor(prior.spend),
      asOf: `${currentEnd}T23:59:59`,
      manageUrl: `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${accountId.replace(/^act_/, "")}&selected_campaign_ids=${encodeURIComponent(id)}`,
    } satisfies AdSnapshot;
  }).sort((a, b) => (b.spendMinor ?? -1) - (a.spendMinor ?? -1));
  const dailyByDate = new Map(daily.map(row => [String(row.date_start ?? ""), row]));
  const dates = Array.from({ length: 7 }, (_, index) => addDays(currentStart, index));
  const adSeries = dates.map(date => {
    const row = dailyByDate.get(date);
    return {
      date,
      spendMinor: row ? moneyMinor(row.spend) : null,
      linkClicks: row ? safeInteger(row.inline_link_clicks) : null,
      providerResults: row ? countAction(row.actions, /messaging_conversation_started/i) : null,
    };
  });
  return { ads, adSeries, fetchedAt: now.toISOString(), account: { id: String(accountBody.id ?? accountId), name: String(accountBody.name ?? "Life Skills Ads"), currency, timezone } };
}
