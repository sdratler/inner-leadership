import {describe,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {authoritativeProspectUpdate,prospectUpdateSchema} from "../../../src/features/contact-ops/server/authoritative-prospect-update.ts";
import type {Actor} from "../../../src/features/identity/types.ts";
import type {CutoverState,Phase} from "../../../src/features/contact-ops/core/cutover.ts";
const actor={role:"practitioner"} as Actor,operation="11111111-1111-4111-8111-111111111111";
const legacy={action:"update" as const,leadId:"LS-LEAD-synthetic-update",fields:{nextAction:"Synthetic next action"}};
const request={...legacy,expectedEpoch:3,expectedVersion:1,operationId:operation};
function deps(phase:Phase){const state:CutoverState={phase,epoch:3,batchId:"synthetic",sourceFileId:"synthetic",sourceRevision:"synthetic",nativeWritesSinceSwitch:0};
 return {authority:{read:vi.fn().mockResolvedValue(state)},native:{updateProspectFields:vi.fn().mockResolvedValue({personId:"synthetic-person",version:2,replayed:false})},sheet:{update:vi.fn().mockResolvedValue({})}};}
describe("one authoritative administrative prospect update",()=>{
 it.each(["sheet_active","shadow_ready"] as const)("keeps the real legacy writer in %s",async phase=>{
  const d=deps(phase);expect(await authoritativeProspectUpdate(actor,legacy,d)).toEqual({updated:true,source:"sheet"});
  expect(d.sheet.update).toHaveBeenCalledWith(legacy.leadId,legacy.fields);expect(d.native.updateProspectFields).not.toHaveBeenCalled();
 });
 it.each(["native_active","retired"] as const)("writes only native with the observed epoch in %s",async phase=>{
  const d=deps(phase);expect(await authoritativeProspectUpdate(actor,request,d)).toMatchObject({updated:true,source:"native",version:2,replayed:false});
  expect(d.native.updateProspectFields).toHaveBeenCalledWith(actor,request.leadId,request.fields,1,operation,3);expect(d.sheet.update).not.toHaveBeenCalled();
 });
 it.each(["frozen","rollback_prepared"] as const)("holds %s without a fallback",async phase=>{
  const d=deps(phase);await expect(authoritativeProspectUpdate(actor,request,d)).rejects.toMatchObject({code:"CONFLICT"});
  expect(d.sheet.update).not.toHaveBeenCalled();expect(d.native.updateProspectFields).not.toHaveBeenCalled();
 });
 it("requires all native preconditions and rejects a stale epoch before mutation",async()=>{
  for(const input of [legacy,{...request,expectedEpoch:2},{...legacy,expectedEpoch:3,expectedVersion:1},{...legacy,expectedEpoch:3,operationId:operation}]){
   const d=deps("native_active");await expect(authoritativeProspectUpdate(actor,input,d)).rejects.toMatchObject({code:"CONFLICT"});
   expect(d.native.updateProspectFields).not.toHaveBeenCalled();expect(d.sheet.update).not.toHaveBeenCalled();
  }
 });
 it("never applies a pre-rollback native tab to the Sheet writer",async()=>{
  const d=deps("sheet_active");await expect(authoritativeProspectUpdate(actor,request,d)).rejects.toMatchObject({code:"CONFLICT"});expect(d.sheet.update).not.toHaveBeenCalled();
 });
 it("never falls back after an authority/native failure",async()=>{
  const d=deps("native_active");d.native.updateProspectFields.mockRejectedValue(Error("Synthetic native failure"));
  await expect(authoritativeProspectUpdate(actor,request,d)).rejects.toThrow("Synthetic native failure");expect(d.sheet.update).not.toHaveBeenCalled();
  d.authority.read.mockRejectedValue(Error("Synthetic authority failure"));await expect(authoritativeProspectUpdate(actor,legacy,d)).rejects.toThrow("Synthetic authority failure");
 });
 it("denies parent, child and adult roles before any source access",async()=>{
  for(const role of ["parent","child","adult_client"] as const){const d=deps("sheet_active");
   await expect(authoritativeProspectUpdate({...actor,role},legacy,d)).rejects.toMatchObject({code:"FORBIDDEN"});expect(d.authority.read).not.toHaveBeenCalled();expect(d.sheet.update).not.toHaveBeenCalled();}
 });
 it("rejects empty, privileged, invalid civil dates and browser destination fields",()=>{
  for(const fields of [{},{notes:undefined},{stage:""},{dueDate:"2026-02-30"},{dueDate:"2026-09-28T00:00:00Z"},{paymentVerified:"true"},{caseId:"synthetic"}])
   expect(prospectUpdateSchema.safeParse({...request,fields}).success).toBe(false);
  expect(prospectUpdateSchema.safeParse({...request,destination:"native"}).success).toBe(false);
  expect(prospectUpdateSchema.safeParse({...request,personId:operation}).success).toBe(false);
  expect(prospectUpdateSchema.safeParse({...request,fields:{dueDate:"",notes:""}}).success).toBe(true);
 });
});
