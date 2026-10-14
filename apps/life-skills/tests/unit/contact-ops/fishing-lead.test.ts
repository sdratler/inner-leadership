import {describe,expect,it} from "vitest";
import {fishingLeadRequestSchema,nextFishingMembership,fishingLeadDisplayState,
 fishingLabelDesired,fishingLabelVerified,type FishingLeadResult} from "../../../src/features/contact-ops/core/fishing-lead.ts";
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const base={action:"add" as const,workspaceId:id(1),personId:id(2),program:"sunday_fishing_academy" as const,
 expectedVersion:0,relationship:"guardian" as const,source:{kind:"inquiry" as const,id:id(3)},
 permission:{state:"unknown" as const},recordedAt:"2026-10-14T18:00:00Z",recordedBy:id(4)};
const result=(v:number,state:"active"|"removed"):FishingLeadResult=>({operationId:id(5),workspaceId:id(1),personId:id(2),
 program:base.program,version:v,state,authorityEpoch:3,newPerson:false,replayed:true,tasksCreated:0,outboundEligible:false});
const binding={accountId:"synthetic-account",managedLabelId:"synthetic-managed-label",chatId:"synthetic-chat"};
describe("RM04 scoped fishing lead boundary",()=>{
 it("accepts explicit inquiry preview but not a name-derived command",()=>{
  expect(fishingLeadRequestSchema.parse({action:"preview_add",operationId:id(5),expectedEpoch:3,
   source:base.source,expectedAssociationVersion:0,relationship:"guardian"}).action).toBe("preview_add");
 });
 it.each(["workspaceId","program","phone","name","recordMode","role","permission","nextAction","dueDate","callbackWindow","send","paymentVerified"])
 ("rejects body-derived or side-effect field %s",key=>{
  expect(fishingLeadRequestSchema.safeParse({action:"preview_add",operationId:id(5),expectedEpoch:3,
   source:base.source,expectedAssociationVersion:0,relationship:"guardian",[key]:"untrusted"}).success).toBe(false);
 });
 it("requires the selected ordinary contact to be the actual source contact",()=>{
  expect(fishingLeadRequestSchema.safeParse({action:"preview_add",operationId:id(5),expectedEpoch:3,
   source:{kind:"person",id:id(2)},selectedPersonId:id(6),expectedAssociationVersion:0,relationship:"adult_partner"}).success).toBe(false);
 });
 it("adds, removes and restores only through consecutive fresh versions",()=>{
  const added=nextFishingMembership(null,base),removed=nextFishingMembership(added,{...base,action:"remove",expectedVersion:1}),
   restored=nextFishingMembership(removed,{...base,expectedVersion:2});
  expect([added.state,removed.state,restored.state]).toEqual(["active","removed","active"]);
  expect([added.version,removed.version,restored.version]).toEqual([1,2,3]);
  expect(restored.outboundEligible).toBe(false);
 });
 it("never grants permission by classifying a guardian or creating membership",()=>{
  const added=nextFishingMembership(null,base);expect(added.permission).toEqual({state:"unknown"});
  expect(added).not.toHaveProperty("familyId");expect(added).not.toHaveProperty("nextAction");
  expect(added).not.toHaveProperty("followUpDate");expect(added).not.toHaveProperty("tasks");
 });
 it("keeps withdrawal and original facts during remove and fresh restore",()=>{
  const permission={state:"withdrawn" as const,observedAt:base.recordedAt,sourceRef:"synthetic-optout"};
  const added=nextFishingMembership(null,{...base,permission}),removed=nextFishingMembership(added,
   {...base,action:"remove",expectedVersion:1,relationship:"adult_partner",source:{kind:"person",id:id(2)}});
  expect(removed.permission).toEqual(permission);expect(removed.source).toEqual(base.source);expect(removed.relationship).toBe("guardian");
  expect(nextFishingMembership(removed,{...base,expectedVersion:2}).permission).toEqual(permission);
 });
 it("does not change permission facts as a side effect of Remove",()=>{
  const added=nextFishingMembership(null,base);
  const removed=nextFishingMembership(added,{...base,action:"remove",expectedVersion:1,
   permission:{state:"withdrawn",observedAt:base.recordedAt,sourceRef:"different-evidence"}});
  expect(removed.permission).toEqual(added.permission);
 });
 it.each(["workspaceId","personId","program"])("rejects a cross-%s transition",key=>{
  const added=nextFishingMembership(null,base);const changed=key==="program"?"private_fishing_life_skills":id(8);
  expect(()=>nextFishingMembership(added,{...base,action:"remove",expectedVersion:1,[key]:changed})).toThrow("FISHING_MEMBERSHIP_CONFLICT");
 });
 it("rejects duplicate Add, absent Remove, stale version and stale restore",()=>{
  const added=nextFishingMembership(null,base),removed=nextFishingMembership(added,{...base,action:"remove",expectedVersion:1});
  expect(()=>nextFishingMembership(added,{...base,expectedVersion:1})).toThrow();
  expect(()=>nextFishingMembership(null,{...base,action:"remove"})).toThrow();
  expect(()=>nextFishingMembership(added,{...base,action:"remove",expectedVersion:0})).toThrow();
  expect(()=>nextFishingMembership(removed,{...base,expectedVersion:1})).toThrow();
 });
 it("displays Removed after replay of a successful historical Add",()=>{
  const added=nextFishingMembership(null,base),removed=nextFishingMembership(added,{...base,action:"remove",expectedVersion:1});
  expect(fishingLeadDisplayState(result(1,"active"),removed)).toBe("removed");
  expect(removed.version).toBe(2); // Projection doesn't mutate native membership.
  expect(()=>fishingLeadDisplayState({...result(1,"active"),personId:id(8)},removed)).toThrow();
 });
 it("keeps native state independent when no real provider binding exists",()=>{
  const added=nextFishingMembership(null,base),projection=fishingLabelDesired(added,null);
  expect(projection.status).toBe("unconfigured");expect(projection.verifiedAt).toBeNull();expect(added.state).toBe("active");
  expect(()=>fishingLabelVerified(projection,{generation:1,binding,present:true,checkedAt:base.recordedAt})).toThrow();
 });
 it("requires exact latest desired label readback, not provider acceptance",()=>{
  const added=nextFishingMembership(null,base),pending=fishingLabelDesired(added,binding);
  expect(pending.status).toBe("pending");expect(pending.verifiedAt).toBeNull();
  expect(fishingLabelVerified(pending,{generation:1,binding,present:true,checkedAt:base.recordedAt}).status).toBe("verified");
  expect(()=>fishingLabelVerified(pending,{generation:1,binding,present:false,checkedAt:base.recordedAt})).toThrow();
 });
 it.each(["accountId","managedLabelId","chatId"])("rejects a wrong provider %s",key=>{
  const projection=fishingLabelDesired(nextFishingMembership(null,base),binding);
  expect(()=>fishingLabelVerified(projection,{generation:1,binding:{...binding,[key]:"wrong"},present:true,checkedAt:base.recordedAt})).toThrow();
 });
 it("cannot verify stale Add after newer Remove or restore",()=>{
  const added=nextFishingMembership(null,base),removed=nextFishingMembership(added,{...base,action:"remove",expectedVersion:1}),
   pending=fishingLabelDesired(removed,binding);
  expect(()=>fishingLabelVerified(pending,{generation:1,binding,present:true,checkedAt:base.recordedAt})).toThrow();
  expect(fishingLabelVerified(pending,{generation:2,binding,present:false,checkedAt:base.recordedAt}).status).toBe("verified");
  const restored=nextFishingMembership(removed,{...base,expectedVersion:2});
  expect(()=>fishingLabelVerified(fishingLabelDesired(restored,binding),{generation:2,binding,present:false,checkedAt:base.recordedAt})).toThrow();
 });
});
