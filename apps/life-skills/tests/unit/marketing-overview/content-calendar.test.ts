import {describe,expect,it} from "vitest";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import type {CreativeVersion,MarketingSnapshot,Publication} from "../../../src/features/marketing-overview/contracts.ts";
import {MarketingContentCalendar,type ContentCalendarQuery} from "../../../src/ui/revamp/marketing-content-calendar.tsx";
import {MarketingDashboard} from "../../../src/ui/revamp/marketing-dashboard.tsx";
const digest="a".repeat(64),asset:CreativeVersion={assetId:"DEMO-he",revision:2,locale:"he",width:1080,height:1920,imageUrl:null,title:"DEMO — Exact approved creative",caption:"DEMO registered text בלבד\nSecond line",contentDigest:digest,review:"approved",approvedDigest:digest,sourceUrl:"https://drive.google.com/file/d/demo-exact/view"};
const publication=(id:string,time:string|null,state:Publication["state"]="scheduled",channel:Publication["channel"]="whatsapp_status"):Publication=>({id,assetId:asset.assetId,creativeRevision:2,creativeDigest:digest,channel,destinationLabel:"DEMO destination "+id,scheduledFor:time,timezone:"Asia/Jerusalem",state,provider:channel.endsWith("_manual")?"manual":"whapi",providerReceiptId:null,providerReadAt:null,postUrl:null,receiptKind:"unknown",manualReportedAt:null,errorCode:null});
const snapshot=(items:readonly Publication[],creatives:readonly CreativeVersion[]=[asset]):MarketingSnapshot=>({source:"synthetic",fetchedAt:"2026-10-01T08:00:00Z",creatives,publications:items,ads:[],scout:{readyDrafts:null,sourceUrl:null,lastChecked:null,status:"unbound"}});
const render=(items:readonly Publication[],query:ContentCalendarQuery={},locale:"en"|"he"="en",creatives:readonly CreativeVersion[]=[asset])=>renderToStaticMarkup(React.createElement(MarketingContentCalendar,{locale,snapshot:snapshot(items,creatives),query,renderedAt:"2026-10-01T08:00:00Z",thumbnail:a=>React.createElement("span",{"data-thumbnail":a.assetId+":"+a.revision},"DEMO exact thumbnail")}));
describe("retained read-only Marketing calendar controls",()=>{
  it("replaces month/week/agenda main views while retaining an empty calendar and usable controls",()=>{
    const month=render([],{layout:"month",month:"2026-10"}),week=render([],{layout:"week",date:"2026-10-01"}),agenda=render([],{layout:"agenda"});
    expect(month).toContain('aria-label="Monthly content calendar"');expect(month).not.toContain('aria-label="Content agenda"');
    expect((week.match(/class="lsr-content-day"/g)??[])).toHaveLength(7);expect(week).toContain('aria-label="Weekly content calendar"');expect(week).not.toContain('aria-label="Monthly content calendar"');
    expect(agenda).toContain('aria-label="Content agenda"');expect(agenda).not.toContain('class="lsr-content-calendar-grid"');expect(agenda).toContain("No dated records match");
    for(const html of [month,week,agenda]){expect(html).toContain('method="get"');expect(html).toContain("Apply filters");expect(html).toContain("Clear filters");expect(html).not.toContain('method="post"');}
  });
  it("preserves exact URL-backed channel/state/date/layout filters on links and item return",()=>{
    const query={layout:"week",month:"2026-10",date:"2026-10-01",channel:"facebook_page",state:"failed",from:"2026-09-27",to:"2026-10-03"};
    const item=publication("failed-one","2026-10-01T17:00:00Z","failed","facebook_page"),html=render([item],query);
    expect(html).toContain('value="facebook_page" selected');expect(html).toContain('value="failed" selected');expect(html).toContain('value="2026-09-27"');
    expect(html).toContain("channel=facebook_page&amp;state=failed&amp;from=2026-09-27&amp;to=2026-10-03&amp;publication=failed-one");
    const detail=render([item],{...query,publication:item.id});expect(detail).toContain('aria-label="Publication breadcrumbs"');expect(detail).toContain("layout=week");expect(detail).toContain("state=failed");expect(detail).toContain("Back to content calendar");expect(detail).not.toContain('aria-label="Weekly content calendar"');
  });
  it("applies Jerusalem-day, channel and state filters without replacing undated errors with invented dates",()=>{
    const first=publication("first","2026-09-30T21:15:00Z","failed","facebook_page"),outside=publication("outside","2026-09-30T20:00:00Z","failed","facebook_page"),wrongState=publication("wrong-state","2026-10-01T17:00:00Z","scheduled","facebook_page"),wrongChannel=publication("wrong-channel","2026-10-01T17:00:00Z","failed","instagram");
    const html=render([first,outside,wrongState,wrongChannel],{layout:"agenda",month:"2026-10",channel:"facebook_page",state:"failed",from:"2026-10-01",to:"2026-10-01"});
    expect(html).toContain("DEMO destination first");for(const id of ["outside","wrong-state","wrong-channel"])expect(html).not.toContain("DEMO destination "+id);
    const invalid=render([{...first,scheduledFor:"2026-02-30T17:00:00Z"}],{month:"2026-10",from:"2026-10-01",to:"2026-10-01"});expect(invalid).toContain("Invalid scheduled date — check source");expect(invalid).toContain('aria-label="Source record errors"');expect(invalid).not.toContain("Oct 1, 2026, 8:00 PM");
  });
  it("shows malformed/reversed date range recovery without silently displaying other dates",()=>{
    for(const query of [{from:"2026-02-30",to:"2026-10-02"},{from:"2026-10-03",to:"2026-10-01"}]){const html=render([publication("dated","2026-10-01T17:00:00Z","draft","facebook_page")],{...query,layout:"agenda",month:"2026-10"});expect(html).toContain('role="alert"');expect(html).toContain("Correct the range or clear filters");expect(html).not.toContain("DEMO destination dated");}
  });
  it("keeps unscheduled-ready queue records separately discoverable even when a dated range is selected",()=>{
    const html=render([publication("unscheduled",null,"ready")],{layout:"agenda",from:"2026-10-01",to:"2026-10-01",channel:"whatsapp_status",filter:"queued"});expect(html).toContain("Unscheduled ready records: 1");expect(html).toContain("Ordered planned and ready records: 1");expect(html).toContain("DEMO destination unscheduled");expect(html).toContain("count is not the provider queue count");
  });
  it("shows actual receipt, manual/unknown state and safe source/permalink on the exact detail revision",()=>{
    const item={...publication("manual","2026-10-01T17:00:00Z","manually_reported","facebook_group_manual"),manualReportedAt:"2026-10-01T17:05:00Z",providerReceiptId:"DEMO-only-receipt",postUrl:"https://www.facebook.com/groups/demo/posts/123"};
    const html=render([item],{publication:item.id});expect(html).toContain("Manually marked as posted — not provider-verified");expect(html).toContain("Provider receipt: DEMO-only-receipt");expect(html).toContain("https://drive.google.com/file/d/demo-exact/view");expect(html).toContain("https://www.facebook.com/groups/demo/posts/123");expect(html).toContain('data-thumbnail="DEMO-he:2"');expect(html).toContain('<details><summary>Registered caption</summary>');expect(html).not.toContain("<details open");expect(html).not.toContain("Published — provider receipt recorded");
  });
  it("does not substitute another revision, or render unsafe source or post URLs",()=>{
    const mismatch={...publication("mismatch","2026-10-01T17:00:00Z"),creativeDigest:"b".repeat(64),postUrl:"javascript:alert(1)"},html=render([mismatch],{publication:mismatch.id});expect(html).toContain("Creative revision unavailable");expect(html).not.toContain("demo-exact");expect(html).not.toContain("data-thumbnail");expect(html).not.toContain("javascript:");
    const unsafe=render([{...publication("unsafe",null),postUrl:"https://user:password@facebook.com/post"}],{publication:"unsafe"},"en",[{...asset,sourceUrl:"http://drive.google.com/file/d/demo/view",imageUrl:null}]);expect(unsafe).not.toContain("Open source asset");expect(unsafe).not.toContain("Open recorded post link");
  });
  it("keeps unknown/deleted detail recovery and inherited-property query values safe",()=>{
    const unknown=render([],{publication:"not-in-inventory"});expect(unknown).toContain("Publication unavailable");expect(unknown).toContain("Back to content calendar");
    const inherited=render([],{channel:"constructor",state:"toString",layout:"__proto__"});expect(inherited).toContain('value="" selected');expect(inherited).not.toContain("function Object");expect(inherited).toContain("Monthly content calendar");
  });
  it("keeps Hebrew copy and source errors visible outside collapsed history",()=>{
    const item={...publication("error",null,"unknown"),errorCode:"DEMO_UNCERTAIN"},html=render([item],{layout:"agenda"},"he");expect(html).toContain("סדר יום תוכן");expect(html).toContain("החלת סינון");expect(html).toContain("שגיאות רשומה במקור");expect(html).toContain("DEMO_UNCERTAIN");expect(html).not.toContain("Published — provider receipt recorded");
  });
  it("does not hide a dated failure outside the visible calendar period in collapsed history",()=>{
    const item={...publication("older-failure","2026-09-01T17:00:00Z","failed"),errorCode:"DEMO_PROVIDER_FAILED"},html=render([item],{layout:"month",month:"2026-10"});
    expect(html).toMatch(/aria-label="Source record errors"[\s\S]*role="alert"[\s\S]*DEMO_PROVIDER_FAILED/);
    expect(html).toContain("publication=older-failure");
  });
  it("does not turn a foreign URL containing a Drive-looking path into a trusted thumbnail",()=>{
    const html=renderToStaticMarkup(React.createElement(MarketingDashboard,{locale:"en",snapshot:snapshot([],[{...asset,imageUrl:"https://untrusted.example/drive.google.com/file/d/demo-fake/view"}]),initialSection:"creatives",renderedAt:"2026-10-01T08:00:00Z"}));
    expect(html).not.toContain("thumbnail?id=demo-fake");expect(html).not.toContain("<img");expect(html).toContain("Thumbnail unavailable");
  });
  it("routes the Hebrew Status overview count to the actual content queue rather than the generic gallery",()=>{
    const inventory={files:1,concepts:1,publishablePosts:1,heStatusReady:1,heFeedReady:0,enFeedReady:0,adEligible:0,inLiveAds:0,queued:1,published:0,needsApproval:0,needsResizeOrCaption:0,heldMissing:0,partial:false,asOf:"2026-10-01T08:00:00Z"};
    const html=renderToStaticMarkup(React.createElement(MarketingDashboard,{locale:"en",snapshot:{...snapshot([]),inventory},renderedAt:"2026-10-01T08:00:00Z"}));expect(html).toContain("section=content_calendar&amp;filter=queued&amp;channel=whatsapp_status&amp;layout=agenda");expect(html).not.toContain("section=creatives&amp;filter=he_status");
  });
});
