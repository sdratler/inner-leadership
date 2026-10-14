import {expect,test,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {reconcileFishingLabel,type FishingLabelPorts} from "../../../src/features/contact-ops/server/fishing-label-projection.ts";
import {fishingLabelDesired,nextFishingMembership,type FishingLabelProjection} from "../../../src/features/contact-ops/core/fishing-lead.ts";
const uuid=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const now=new Date("2026-10-14T20:40:00.000Z"),binding={accountId:"synthetic-channel",managedLabelId:"16",chatId:"13055550109@s.whatsapp.net"};
function fixture(){
 const membership=nextFishingMembership(null,{action:"add",workspaceId:uuid(1),personId:uuid(2),program:"sunday_fishing_academy",expectedVersion:0,
  relationship:"guardian",source:{kind:"inquiry",id:uuid(3)},permission:{state:"unknown"},recordedAt:now.toISOString(),recordedBy:uuid(4)});
 let value=fishingLabelDesired(membership,null),present=false,reads=0,changes=0,locked=false;
 const ports:FishingLabelPorts={accountId:binding.accountId,now:()=>now,serial:async work=>{expect(locked).toBe(false);locked=true;try{return await work();}finally{locked=false;}},
  current:async()=>structuredClone(value),record:async(expected,next)=>{expect(locked).toBe(true);if(JSON.stringify(value)!==JSON.stringify(expected))return false;value=structuredClone(next);return true;},
  capability:async()=>({accountId:binding.accountId,state:"supported",checkedAt:now.toISOString()}),binding:async()=>binding,
  read:async()=>{reads++;return {binding,present,checkedAt:now.toISOString()};},change:async(_,desired)=>{changes++;present=desired;return {status:200};}};
 return {ports,membership,get:()=>value,set:(p:FishingLabelProjection)=>{value=p;},setPresent:(p:boolean)=>{present=p;},metrics:()=>({reads,changes})};
}
test("explicit configured account binding, durable unknown BEFORE mutation, exact readback then verified",async()=>{
 const f=fixture(),change=f.ports.change;f.ports.change=async(...args)=>{expect(f.get().status).toBe("outcome_unknown");return change(...args);};
 expect(await reconcileFishingLabel(f.get(),f.ports)).toEqual({state:"verified",generation:1});expect(f.metrics()).toEqual({reads:2,changes:1});expect(f.get().verifiedAt).toBe(now.toISOString());
});
test("no genuine binding stays unconfigured and never mutates a provider",async()=>{const f=fixture();f.ports.binding=async()=>null;
 expect((await reconcileFishingLabel(f.get(),f.ports)).state).toBe("unconfigured");expect(f.metrics().changes).toBe(0);});
test("known capability absence is durable unsupported, disconnected/old evidence is not",async()=>{const f=fixture();f.ports.capability=async()=>({accountId:binding.accountId,state:"unsupported",checkedAt:now.toISOString()});
 expect((await reconcileFishingLabel(f.get(),f.ports)).state).toBe("unsupported");expect(f.get().capability?.labelsSupported).toBe(false);expect(f.metrics().changes).toBe(0);
 f.ports.capability=async()=>{throw Error("unavailable");};expect((await reconcileFishingLabel(f.get(),f.ports)).state).toBe("unconfigured");expect(f.get().capability).toBeUndefined();});
test("wrong account and stale capability cannot authorize a provider write",async()=>{for(const cap of [{accountId:"wrong",state:"supported" as const,checkedAt:now.toISOString()},
 {accountId:binding.accountId,state:"supported" as const,checkedAt:"2026-10-14T20:38:00.000Z"}]){const f=fixture();f.ports.capability=async()=>cap;
 expect((await reconcileFishingLabel(f.get(),f.ports)).state).toBe("unconfigured");expect(f.metrics().changes).toBe(0);}});
test("timeout after apply can be resolved by exact readback without repeating the mutation",async()=>{const f=fixture();f.ports.change=async()=>{f.setPresent(true);throw Error("timeout after apply");};
 expect((await reconcileFishingLabel(f.get(),f.ports)).state).toBe("verified");const second=await reconcileFishingLabel(f.get(),f.ports);expect(second.state).toBe("verified");expect(f.get().status).toBe("verified");});
test("timeout plus failed readback remains durable unknown; later retry READS first and sends nothing if already applied",async()=>{const f=fixture();let reads=0,changes=0;
 f.ports.read=async()=>{if(++reads===2)throw Error("unavailable");return {binding,present:changes>0,checkedAt:now.toISOString()};};f.ports.change=async()=>{changes++;throw Error("timeout");};
 expect((await reconcileFishingLabel(f.get(),f.ports)).state).toBe("outcome_unknown");expect(f.get().status).toBe("outcome_unknown");
 expect((await reconcileFishingLabel(f.get(),f.ports)).state).toBe("verified");expect(changes).toBe(1);
});
test("unknown effect cannot be erased by later unsupported capability",async()=>{const f=fixture();f.set({...f.get(),binding,status:"outcome_unknown"});f.ports.capability=async()=>({accountId:binding.accountId,state:"unsupported",checkedAt:now.toISOString()});
 expect((await reconcileFishingLabel(f.get(),f.ports)).state).toBe("outcome_unknown");expect(f.get().status).toBe("outcome_unknown");});
for(const status of [400,401,403,429])test(`definite rejection${status} plus unreadable provider becomes failed, never verified`,async()=>{const f=fixture();let reads=0;
 f.ports.read=async()=>{if(++reads>1)throw Error("read failed");return {binding,present:false,checkedAt:now.toISOString()};};f.ports.change=async()=>({status});
 expect((await reconcileFishingLabel(f.get(),f.ports)).state).toBe("failed");expect(f.get().verifiedAt).toBeNull();});
test("5xx after possibly applied effect and failed GET must remain unknown",async()=>{const f=fixture();let reads=0;f.ports.read=async()=>{if(++reads>1)throw Error("read failed");return {binding,present:false,checkedAt:now.toISOString()};};f.ports.change=async()=>({status:500});
 expect((await reconcileFishingLabel(f.get(),f.ports)).state).toBe("outcome_unknown");});
test("POST409 and DELETE404 require fresh exact readback; accepted2xx alone is not verified",async()=>{
 for(const [present,status,readback] of [[true,409,true],[false,404,false],[true,200,false]] as const){const f=fixture();
  if(!present){const m=nextFishingMembership(f.membership,{action:"remove",workspaceId:uuid(1),personId:uuid(2),program:"sunday_fishing_academy",expectedVersion:1,
   relationship:"guardian",source:f.membership.source,permission:{state:"unknown"},recordedAt:now.toISOString(),recordedBy:uuid(4)});f.set(fishingLabelDesired(m,binding,f.get()));f.setPresent(true);}
  f.ports.change=async()=>{f.setPresent(readback);return {status};};expect((await reconcileFishingLabel(f.get(),f.ports)).state).toBe(readback===present?"verified":"pending");}
});
test("queued old Add after newer Remove makes NO provider call",async()=>{const f=fixture(),old=f.get();f.set({...old,binding,status:"pending",generation:2,desiredPresent:false});
 expect((await reconcileFishingLabel(old,f.ports)).state).toBe("superseded");expect(f.metrics()).toEqual({reads:0,changes:0});});
test("late Add completion cannot mark the newer Remove verified or change its desired state",async()=>{const f=fixture();f.ports.change=async()=>{f.set({...f.get(),generation:2,desiredPresent:false,status:"pending"});f.setPresent(true);return {status:200};};
 expect((await reconcileFishingLabel(f.get(),f.ports)).state).toBe("superseded");expect(f.get()).toMatchObject({generation:2,desiredPresent:false,status:"pending"});
});
test("wrong chat/label or stale readback never becomes verified",async()=>{for(const patch of [{binding:{...binding,chatId:"wrong"}},{binding:{...binding,managedLabelId:"wrong"}},{checkedAt:"2026-10-14T20:38:00.000Z"}]){
 const f=fixture();f.ports.read=async()=>({binding,present:true,checkedAt:now.toISOString(),...patch});expect((await reconcileFishingLabel(f.get(),f.ports)).state).toBe("pending");expect(f.metrics().changes).toBe(0);expect(f.get().verifiedAt).toBeNull();}});
test("old verified state is invalidated when actual capability/readback becomes unavailable",async()=>{const f=fixture();f.set({...f.get(),binding,status:"verified",verifiedAt:now.toISOString()});f.ports.read=async()=>{throw Error("provider unavailable");};
 expect((await reconcileFishingLabel(f.get(),f.ports)).state).toBe("pending");expect(f.get().status).toBe("pending");expect(f.get().verifiedAt).toBeNull();});
test("RM04-LABEL-UNKNOWN-GENERATION-01: Remove retains earlier uncertainty across unsupported capability",async()=>{
 const f=fixture(),prior={...f.get(),binding,status:"outcome_unknown" as const},removed=nextFishingMembership(f.membership,{action:"remove",workspaceId:uuid(1),personId:uuid(2),program:"sunday_fishing_academy",expectedVersion:1,
  relationship:"guardian",source:f.membership.source,permission:{state:"unknown"},recordedAt:now.toISOString(),recordedBy:uuid(4)});
 f.set(fishingLabelDesired(removed,binding,prior));f.ports.capability=async()=>({accountId:binding.accountId,state:"unsupported",checkedAt:now.toISOString()});
 expect((await reconcileFishingLabel(f.get(),f.ports)).state).toBe("outcome_unknown");expect(f.get()).toMatchObject({generation:2,desiredPresent:false,unresolvedEffect:{generation:1,binding}});
 expect(f.metrics()).toEqual({reads:0,changes:0});expect(()=>fishingLabelDesired(removed,binding)).toThrow("FISHING_LABEL_PREVIOUS_REQUIRED");
});
test("related binding/capability loss cannot erase the prior effect; exact current readback resolves it",async()=>{
 const f=fixture(),prior={...f.get(),binding,status:"outcome_unknown" as const},removed=nextFishingMembership(f.membership,{action:"remove",workspaceId:uuid(1),personId:uuid(2),program:"sunday_fishing_academy",expectedVersion:1,
  relationship:"guardian",source:f.membership.source,permission:{state:"unknown"},recordedAt:now.toISOString(),recordedBy:uuid(4)});
 f.set(fishingLabelDesired(removed,null,prior));f.ports.binding=async()=>null;f.ports.capability=async()=>{throw Error("capability lost");};
 expect((await reconcileFishingLabel(f.get(),f.ports)).state).toBe("outcome_unknown");expect(f.get().binding).toEqual(binding);expect(f.get().unresolvedEffect?.generation).toBe(1);
 f.ports.capability=async()=>({accountId:binding.accountId,state:"supported",checkedAt:now.toISOString()});f.setPresent(false);
 expect((await reconcileFishingLabel(f.get(),f.ports)).state).toBe("verified");expect(f.get().unresolvedEffect).toBeUndefined();expect(f.metrics().changes).toBe(0);
});
