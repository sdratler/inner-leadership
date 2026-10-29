import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {afterEach,expect,test,vi} from "vitest";
vi.mock("server-only",()=>({}));
vi.mock("../../../src/features/identity/runtime.ts",()=>({identityRuntime:async()=>({services:{sessions:{actor:async()=>({role:"practitioner"})}}})}));
import {SESSION_COOKIE} from "../../../src/lib/security/session.ts";
import {loadMarketingSnapshot,loadContentRegistry} from "../../../src/features/marketing-overview/provider.ts";
import {validateMarketingSnapshot} from "../../../src/features/marketing-overview/read-model.ts";
import {marketingMedia} from "../../../src/features/marketing-overview/media.ts";
import {MarketingDashboard} from "../../../src/ui/revamp/marketing-dashboard.tsx";
import {BnaContentReviewLibrary} from "../../../src/features/bna-communications/content-review-library.tsx";

afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});

test("Academy setup is explicit and cannot fall back to old registry or ads credentials",async()=>{
 const fetch=vi.fn();vi.stubGlobal("fetch",fetch);
 vi.stubEnv("LIFE_SKILLS_CRM_BRIDGE_ORIGIN","https://retired.example");vi.stubEnv("LIFE_SKILLS_APP_BRIDGE_SECRET","x".repeat(32));
 const snapshot=await loadMarketingSnapshot();validateMarketingSnapshot(snapshot);
 expect(snapshot).toMatchObject({source:"unconfigured",fetchedAt:null,creatives:[],publications:[],ads:[],workbookUrl:null,inventoryReadback:{status:"unconfigured",lastSuccessfulReadAt:null}});
 expect(snapshot.inventory).toBeUndefined();
 await expect(loadContentRegistry()).rejects.toMatchObject({code:"UNAVAILABLE"});
 expect(fetch).not.toHaveBeenCalled();
 for(const patch of [{workbookUrl:"https://docs.google.com/spreadsheets/d/retired"},{fetchedAt:"2026-10-28T00:00:00.000Z"},{scout:{status:"available" as const,readyDrafts:0,sourceUrl:null,lastChecked:null}}])expect(()=>validateMarketingSnapshot({...snapshot,...patch})).toThrow();
});

test.each(["en","he"] as const)("Academy marketing setup is actionable without retired assets or invented results in %s",async locale=>{
 const html=renderToStaticMarkup(React.createElement(MarketingDashboard,{locale,snapshot:await loadMarketingSnapshot(),renderedAt:"2026-10-28T00:00:00.000Z"}));
 expect(html).toContain("data-academy-marketing-setup");expect(html).toContain(`/${locale}/app/group-applications`);
 expect(html).toContain(locale==="en"?"needs setup":"יש להגדיר");
 expect(html).not.toMatch(/<img|retired\.example|Life Skills|Temporarily unavailable|No registered revisions/);
});

test.each(["en","he"] as const)("owner can review actual supplied drafts before connecting publication sources in %s",async locale=>{
 const fetch=vi.fn();vi.stubGlobal("fetch",fetch);
 const snapshot=await loadMarketingSnapshot();
 const contentReview=React.createElement(BnaContentReviewLibrary,{locale});
 const render=(initialSection:string)=>renderToStaticMarkup(React.createElement(MarketingDashboard,{locale,snapshot,initialSection,contentReview,renderedAt:"2026-10-29T15:00:00.000Z"}));
 const html=render("creatives");
 expect(html).toContain("data-academy-marketing-setup");
 expect(html).toContain(locale==="en"?"34 social drafts":"34 נוסחי פוסטים");
 expect(html).toContain(locale==="en"?"15 email drafts":"15 נוסחי דוא״ל");
 expect(html).toContain(locale==="en"?"Nothing here is approved, scheduled or sent.":"דבר כאן אינו מאושר, מתוזמן או נשלח.");
 expect(html).not.toMatch(/<details[^>]*\bopen\b|<form|<button/);
 expect(render("overview")).not.toContain(locale==="en"?"34 social drafts":"34 נוסחי פוסטים");
 expect(fetch).not.toHaveBeenCalled();
});

test("a direct old marketing asset URL remains private and cannot reach its old bridge",async()=>{
 const fetch=vi.fn();vi.stubGlobal("fetch",fetch);
 const url=`https://app.example/api/marketing/assets/retired-asset?revision=1&digest=${"a".repeat(64)}`;
 const response=await marketingMedia(new Request(url,{headers:{cookie:`${SESSION_COOKIE}=owner-session`}}),"retired-asset");
 expect(response.status).toBe(404);expect(response.headers.get("cache-control")).toBe("private, no-store");
 expect(fetch).not.toHaveBeenCalled();
 expect((await marketingMedia(new Request(url),"retired-asset")).status).toBe(401);
});

test("assisted group readback shares the existing Marketing shell while the exact BNA review library stays separate",async()=>{
 const fetch=vi.fn();vi.stubGlobal("fetch",fetch);const snapshot=await loadMarketingSnapshot();
 const contentReview=React.createElement(BnaContentReviewLibrary,{locale:"en"});
 const groupPreparation=React.createElement("section",{"data-fishing-preparation":true},"Synthetic assisted preparation");
 const render=(initialSection:string)=>renderToStaticMarkup(React.createElement(MarketingDashboard,{locale:"en",snapshot,initialSection,contentReview,groupPreparation,renderedAt:"2026-10-29T15:00:00.000Z"}));
 const overview=render("overview"),creatives=render("creatives");
 expect(overview).toContain("Synthetic assisted preparation");expect(overview.indexOf("<h1>Marketing</h1>")).toBeLessThan(overview.indexOf("data-fishing-preparation"));
 expect(creatives).toContain("34 social drafts");expect(creatives).toContain("15 email drafts");expect(creatives).not.toContain("Synthetic assisted preparation");
 expect(fetch).not.toHaveBeenCalled();
});
