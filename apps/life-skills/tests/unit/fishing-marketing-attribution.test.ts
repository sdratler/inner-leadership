import {expect,it} from "vitest";
import {ACADEMY_CAMPAIGN,PREREG_CREATIVE,type CampaignAttribution} from "../../src/features/group-application/academy-campaign-contract.ts";
import {fishingMarketingSnapshotSchema} from "../../src/features/fishing-marketing/contract.ts";
import {matchingTaggedPosts} from "../../src/features/fishing-marketing/attribution.ts";
const h="a".repeat(64),at="2026-10-29T12:00:00Z";
const snapshot=fishingMarketingSnapshotSchema.parse({schemaVersion:1,program:"fishing",channel:"facebook_group_manual",mode:"assisted",generatedAt:at,
 schedule:{timezone:"America/New_York",dailyCap:5,cooldownDays:30,enabled:true,funnelReady:false,day:"2026-10-29",window:"waiting",nextDue:at,lastRun:null},assets:[],targets:[],items:[],itemsTruncated:false,
 history:[{id:h,groupId:"123",contentDigest:h,variantId:null,identity:"personal",state:"published_browser_readback_verified",recordedAt:at,postUrl:"https://www.facebook.com/groups/123/posts/456",publicationEvidence:"browser_readback"}],historyAvailable:true,historyTruncated:false,excludedHistory:0});
const touch={campaign:ACADEMY_CAMPAIGN,source:"facebook",medium:"social",content:PREREG_CREATIVE.id,groupRef:"123",postRef:"456"} as const;
it("links only exact recorded group and post references, without inferring conversions",()=>{
 const attribution={first:touch,last:touch} satisfies CampaignAttribution;
 expect(matchingTaggedPosts(attribution,snapshot)).toEqual(["https://www.facebook.com/groups/123/posts/456"]);
 expect(matchingTaggedPosts({...attribution,first:{...touch,postRef:"other"},last:{...touch,groupRef:"other"}},snapshot)).toEqual([]);
 expect(matchingTaggedPosts({...attribution,first:{...touch,groupRef:undefined},last:{...touch,postRef:undefined}} as unknown as CampaignAttribution,snapshot)).toEqual([]);
 expect(matchingTaggedPosts(attribution,{...snapshot,history:[{...snapshot.history[0]!,publicationEvidence:"unverified"}]})).toEqual([]);
});
