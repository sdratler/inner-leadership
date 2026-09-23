import assert from "node:assert/strict";
import { test } from "vitest";
import { readDirectMetaAds } from "../../src/features/marketing-overview/meta-provider.ts";

test("direct Meta readback excludes today's partial period and derives link metrics from totals", async () => {
  const fetcher = async (input: string | URL) => {
    const value = new URL(String(input));
    const path = value.pathname;
    let body: unknown;
    if (path.endsWith("/act_101")) body = { id: "act_101", name: "Life Skills Ads", currency: "USD", timezone_name: "Asia/Jerusalem", account_status: 1 };
    else if (path.endsWith("/campaigns")) body = { data: [{ id: "campaign-1", name: "Hebrew", status: "ACTIVE", effective_status: "ACTIVE", start_time: "2026-09-16T00:00:00+0300", stop_time: "2026-09-30T23:59:00+0300" }] };
    else {
      const range = JSON.parse(value.searchParams.get("time_range") ?? "{}");
      const daily = value.searchParams.get("time_increment") === "1";
      if (daily) body = { data: [{ date_start: "2026-09-22", spend: "10.00", inline_link_clicks: "2", actions: [{ action_type: "onsite_conversion.messaging_conversation_started_7d", value: "1" }] }] };
      else if (range.since === "2026-09-16") body = { data: [{ campaign_id: "campaign-1", campaign_name: "Hebrew", spend: "70.00", impressions: "1000", reach: "700", inline_link_clicks: "20", actions: [{ action_type: "onsite_conversion.messaging_conversation_started_7d", value: "2" }] }] };
      else body = { data: [{ campaign_id: "campaign-1", spend: "35.00" }] };
    }
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const result = await readDirectMetaAds({ env: { ...process.env, LS_META_SYSTEM_USER_TOKEN: "x".repeat(40), LS_META_AD_ACCOUNT_ID: "act_101", LS_META_GRAPH_VERSION: "v26.0" }, fetcher: fetcher as typeof fetch, now: new Date("2026-09-23T09:00:00Z") });
  assert.deepEqual(result.adSeries.map(point => point.date), ["2026-09-16", "2026-09-17", "2026-09-18", "2026-09-19", "2026-09-20", "2026-09-21", "2026-09-22"]);
  assert.equal(result.ads[0]?.spendMinor, 7000);
  assert.equal(result.ads[0]?.linkCtr, 2);
  assert.equal(result.ads[0]?.costPerLinkClickMinor, 350);
  assert.equal(result.ads[0]?.providerResults, 2);
  assert.equal(result.ads[0]?.previousSpendMinor, 3500);
  assert.equal(result.adSeries[0]?.spendMinor, null);
  assert.equal(result.adSeries[6]?.spendMinor, 1000);
});
