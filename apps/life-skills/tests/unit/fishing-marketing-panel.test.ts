import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {expect,it} from "vitest";
import {FishingMarketingPanel} from "../../src/features/fishing-marketing/panel.tsx";
import {fishingMarketingSnapshotSchema} from "../../src/features/fishing-marketing/contract.ts";
const h="a".repeat(64),at="2026-10-29T12:00:00Z";
const snapshot=fishingMarketingSnapshotSchema.parse({schemaVersion:1,program:"fishing",channel:"facebook_group_manual",mode:"assisted",generatedAt:at,
 schedule:{timezone:"America/New_York",dailyCap:5,cooldownDays:30,enabled:true,funnelReady:false,day:"2026-10-29",window:"waiting",nextDue:at,lastRun:null},
 assets:[{id:"v",language:"en",caption:"Synthetic caption",captionSha256:h,imageSha256:h}],targets:[],items:[],itemsTruncated:false,history:[],historyAvailable:true,historyTruncated:false,excludedHistory:0});
it("renders the registered image only for its exact digest, with honest assisted status",()=>{
 const data={snapshot,receivedAt:at},creative={path:"/groups/academy/prereg-approved-square-20261023.png",sha256:h,width:1254,height:1254};
 const html=renderToStaticMarkup(createElement(FishingMarketingPanel,{locale:"en",data,creative}));
 expect(html).toContain('src="/groups/academy/prereg-approved-square-20261023.png"');expect(html).toContain("Assisted posting");expect(html).toContain("Funnel gate held");
 const wrong=renderToStaticMarkup(createElement(FishingMarketingPanel,{locale:"en",data,creative:{...creative,sha256:"b".repeat(64)}}));
 expect(wrong).not.toContain('src="/groups/academy/prereg-approved-square-20261023.png"');expect(wrong).toContain("Exact approved image unavailable");
});

it("does not show Fishing records when BNA or an unconnected channel is selected",()=>{
 const data={snapshot,receivedAt:at};
 const bna=renderToStaticMarkup(createElement(FishingMarketingPanel,{locale:"en",data,filters:{program:"bna"}}));
 expect(bna).toContain("BNA marketing is not connected yet");expect(bna).not.toContain("Synthetic caption");
 const page=renderToStaticMarkup(createElement(FishingMarketingPanel,{locale:"en",data,filters:{channel:"page"}}));
 expect(page).toContain("This channel is not connected");expect(page).not.toContain("Synthetic caption");
});


it("renders owner inquiry links and a bounded next page without claiming causation",()=>{
 const id="00000000-0000-4000-8000-000000000004",cursor="00000000-0000-4000-8000-000000000005";
 const html=renderToStaticMarkup(createElement(FishingMarketingPanel,{locale:"en",data:{snapshot,receivedAt:at},section:"content_calendar",filters:{program:"fishing",channel:"groups",state:"published"},attribution:{links:[{applicationId:id,postUrl:"https://www.facebook.com/groups/123/posts/456"}],nextCursor:cursor}}));
 expect(html).toContain(`/en/app/group-applications?inquiryId=${id}`);
 expect(html).toContain(`linkCursor=${cursor}`);expect(html).toContain("Tags do not prove the post caused the inquiry");
 expect(html).toContain('rel="noreferrer"');
 const unavailable=renderToStaticMarkup(createElement(FishingMarketingPanel,{locale:"en",data:{snapshot,receivedAt:at},attributionUnavailable:true}));
 expect(unavailable).toContain("this does not mean there are no matches");
});
