import assert from "node:assert/strict";
import { test,expect } from "vitest";
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

const env:NodeJS.ProcessEnv={NODE_ENV:"test",LS_META_SYSTEM_USER_TOKEN:"x".repeat(40),LS_META_AD_ACCOUNT_ID:"act_101",LS_META_GRAPH_VERSION:"v26.0"};
function response(body:unknown){return new Response(JSON.stringify(body),{status:200});}
test("null, blank, boolean, fractional counts and unsafe money remain unknown, not zero",async()=>{
 const fetcher=(async(input:string|URL)=>{const u=new URL(String(input));if(u.pathname.endsWith("/act_101"))return response({id:"101",currency:"ILS",timezone_name:"Asia/Jerusalem"});if(u.pathname.endsWith("/campaigns"))return response({data:[{id:"c",status:"PAUSED"}]});return response({data:u.searchParams.has("time_increment")?[{date_start:"2026-10-01",spend:null,inline_link_clicks:false,actions:[{action_type:"messaging_conversation_started",value:""}]}]:[{campaign_id:"c",spend:"",impressions:null,inline_link_clicks:"2.5",reach:false,actions:[{action_type:"messaging_conversation_started",value:null}]}]});}) as typeof fetch;
 const r=await readDirectMetaAds({env,fetcher,now:new Date("2026-10-02T08:00:00Z")});expect(r.ads[0]).toMatchObject({status:"paused",spendMinor:null,impressions:null,reach:null,linkClicks:null,providerResults:null});expect(r.adReporting.days).toHaveLength(14);expect(r.adReporting.days.at(-1)).toMatchObject({spendMinor:null,linkClicks:null,providerResults:null});expect(r.adReporting.currency).toBe("ILS");
});
test("actual account identity, currency and timezone are mandatory without fallback guesses",async()=>{
 for(const body of [{id:"999",currency:"USD",timezone_name:"Asia/Jerusalem"},{id:"101",timezone_name:"Asia/Jerusalem"},{id:"101",currency:"USD"},{id:"101",currency:"USD",timezone_name:"invented/zone"}])await expect(readDirectMetaAds({env,fetcher:(async()=>response(body)) as typeof fetch})).rejects.toThrow("meta_account_identity_unverified");
});
test("truncated pagination and duplicate daily rows fail rather than becoming a complete total",async()=>{
 const account={id:"101",currency:"USD",timezone_name:"Asia/Jerusalem"};
 const pages=(async(input:string|URL)=>{const u=new URL(String(input));return response(u.pathname.endsWith("/act_101")?account:{data:[],paging:{next:"https://graph.facebook.com/v26.0/continuation"}});}) as typeof fetch;
 await expect(readDirectMetaAds({env,fetcher:pages})).rejects.toThrow("meta_graph_page_bound_exceeded");
 const duplicate=(async(input:string|URL)=>{const u=new URL(String(input));return response(u.pathname.endsWith("/act_101")?account:{data:u.searchParams.has("time_increment")?[{date_start:"2026-10-01",spend:"0"},{date_start:"2026-10-01",spend:"1"}]:[]});}) as typeof fetch;
 await expect(readDirectMetaAds({env,fetcher:duplicate,now:new Date("2026-10-02T08:00:00Z")})).rejects.toThrow("meta_daily_period_unverified");
});
