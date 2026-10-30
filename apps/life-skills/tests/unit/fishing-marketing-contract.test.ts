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

it('accepts observed cooldown facts while rejecting invented availability or contradictory dates',()=>{
 const preparation={status:'cooldown',nextEligibleAt:'2026-11-04T19:29:23Z',rulesCheckedAt:'2026-10-28T12:00:00Z',lastPublishedAt:'2026-10-28T19:29:23Z',canPrepare:false};
 const value={...snapshot,targets:[{...snapshot.targets[0],preparation}]};
 expect(schema.safeParse(value).success).toBe(true);
 for(const patch of [{canPrepare:true},{nextEligibleAt:null},{nextEligibleAt:'2026-10-28T12:00:00Z'},{status:'ready'},{rulesCheckedAt:null},{rulesCheckedAt:'2026-11-04T12:00:00Z'},{lastPublishedAt:'2026-11-04T12:00:00Z'}]){
  expect(schema.safeParse({...value,targets:[{...snapshot.targets[0],preparation:{...preparation,...patch}}]}).success).toBe(false);
 }
 expect(schema.safeParse({...value,history:[],historyAvailable:false}).success).toBe(false);
});

const review={postingIdentity:'personal',membershipVerifiedAt:'2026-10-28T12:00:00Z',rulesCheckedAt:'2026-10-28T13:00:00Z',rulesUrl:'https://www.facebook.com/groups/123/about',
 ruleNote:'Synthetic rule: promotion requires prior admin approval.',ownerNote:'Exact content and previous activity still need review.',promotionAllowed:false,cooldownDays:31};
it('preserves legacy snapshot bytes and admits bounded recorded rule evidence without clearing the destination',()=>{
 expect(schema.parse(snapshot)).toEqual(snapshot);expect(schema.parse(snapshot).targets[0]).not.toHaveProperty('review');
 const current={...snapshot,targets:[{...snapshot.targets[0],eligible:false,review}]};
 expect(schema.parse(current).targets[0]?.review).toEqual(review);
 expect(schema.parse(current).targets[0]?.eligible).toBe(false);
 for(const patch of [{rulesUrl:'javascript:alert(1)'},{rulesUrl:'https://www.facebook.com/groups/other/about'},{rulesUrl:review.rulesUrl+'?redirect=other'},
  {ruleNote:' '},{ownerNote:'x'.repeat(2001)},{postingIdentity:'page'},{cooldownDays:29},{rulesCheckedAt:'2026-10-30T00:00:00Z'},
  {membershipVerifiedAt:'2026-10-30T00:00:00Z'},{memberEmails:['not allowed']}]){
  expect(schema.safeParse({...current,targets:[{...current.targets[0],review:{...review,...patch}}]}).success).toBe(false);
 }
});
it('rejects evidence that contradicts preparation or silently grants an unchecked group',()=>{
 const current={...snapshot,targets:[{...snapshot.targets[0],eligible:false,review,preparation:{status:'rules_review',nextEligibleAt:null,rulesCheckedAt:review.rulesCheckedAt,lastPublishedAt:null,canPrepare:false}}]};
 expect(schema.safeParse(current).success).toBe(true);
 expect(schema.safeParse({...current,targets:[{...current.targets[0],review:{...review,rulesCheckedAt:at}}]}).success).toBe(false);
 expect(schema.safeParse({...current,targets:[{...current.targets[0],eligible:true}]}).success).toBe(false);
 expect(schema.safeParse({...current,targets:[{...current.targets[0],eligible:true,review:{...review,promotionAllowed:true,membershipVerifiedAt:null}}]}).success).toBe(false);
});
