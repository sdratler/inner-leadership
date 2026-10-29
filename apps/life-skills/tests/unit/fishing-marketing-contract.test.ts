import {expect,it} from "vitest";
import {fishingMarketingSnapshotSchema as schema} from "../../src/features/fishing-marketing/contract.ts";
const at="2026-10-29T14:00:00+00:00",h="a".repeat(64);
const snapshot={schemaVersion:1,program:"fishing",channel:"facebook_group_manual",mode:"assisted",generatedAt:at,
 schedule:{timezone:"America/New_York",dailyCap:5,cooldownDays:30,enabled:true,funnelReady:false,day:"2026-10-29",window:"due",nextDue:at,lastRun:null},
 assets:[{id:"approved",language:"en",caption:"Fishing inquiry",captionSha256:h,imageSha256:h}],
 targets:[{id:"123",name:"Group",url:"https://www.facebook.com/groups/123",eligible:true,hold:null}],
 items:[{day:"2026-10-29",groupId:"123",variantId:"approved",captionSha256:h,imageSha256:h,actorProfileId:null,state:"unknown",createdAt:at,postUrl:null,publicationEvidence:"unverified"}],itemsTruncated:false,
 history:[{id:h,groupId:"123",contentDigest:h,variantId:"approved",identity:"personal",state:"published_browser_readback_verified",recordedAt:at,postUrl:"https://www.facebook.com/groups/123/posts/42",publicationEvidence:"browser_readback"}],historyAvailable:true,historyTruncated:false,excludedHistory:0} as const;
it("accepts bounded Fishing evidence without inventing an identity",()=>{expect(schema.parse(snapshot).items[0]?.actorProfileId).toBeNull();});
it("rejects cross-group links, unsupported data and invented publication evidence",()=>{
 expect(schema.safeParse({...snapshot,program:"bna"}).success).toBe(false);
 expect(schema.safeParse({...snapshot,privateNote:"not allowed"}).success).toBe(false);
 expect(schema.safeParse({...snapshot,history:[{...snapshot.history[0],postUrl:"https://www.facebook.com/groups/other/posts/42"}]}).success).toBe(false);
 expect(schema.safeParse({...snapshot,items:[{...snapshot.items[0],publicationEvidence:"operator_recorded_readback"}]}).success).toBe(false);
 expect(schema.safeParse({...snapshot,historyAvailable:false}).success).toBe(false);
 expect(schema.safeParse({...snapshot,history:[{...snapshot.history[0],groupId:"1.3",postUrl:"https://www.facebook.com/groups/1x3/posts/42"}]}).success).toBe(false);
});
