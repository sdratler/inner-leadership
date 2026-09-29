import {expect,test,vi} from "vitest";
import {randomUUID} from "node:crypto";
vi.mock("server-only",()=>({}));
import {authoritativeProspectCreate,type ProspectCreateDependencies} from "../../../src/features/contact-ops/server/authoritative-prospect-create.ts";
import type {CutoverState} from "../../../src/features/contact-ops/core/cutover.ts";
import type {Actor} from "../../../src/features/identity/types.ts";
const actor={id:randomUUID(),workspaceId:randomUUID(),personId:randomUUID(),role:"practitioner"} as Actor;
const fields={action:"add" as const,name:"Synthetic contact",phone:"+972535550187",language:"he" as const,source:"Owner entered",notes:"Synthetic preserved note\nעברית",nextAction:"Follow up",dueDate:"2026-09-28"};
function setup(phase:CutoverState["phase"],epoch=3){
 const state:CutoverState={phase,epoch,batchId:null,sourceFileId:null,sourceRevision:null,nativeWritesSinceSwitch:0};
 const native=vi.fn(async()=>({personId:randomUUID(),leadId:"LS-LEAD-native-synthetic",version:1,replayed:false}));
 const sheet=vi.fn(async()=>({success:true as const,result:{action:"created" as const,leadId:"LS-LEAD-synthetic",row:2}}));
 const d:ProspectCreateDependencies={authority:{read:vi.fn(async()=>state)},native:{createContact:native},sheet:{create:sheet}};
 return {d,native,sheet,state};
}
test.each(["sheet_active","shadow_ready"] as const)("%s retains the existing sole Sheet writer with no native effect",async phase=>{
 const s=setup(phase,0);expect(await authoritativeProspectCreate(actor,fields,s.d)).toMatchObject({source:"sheet",action:"created"});
 expect(s.sheet).toHaveBeenCalledWith(expect.objectContaining({notes:fields.notes}));expect(s.native).not.toHaveBeenCalled();
 await expect(authoritativeProspectCreate(actor,{...fields,expectedEpoch:0,operationId:randomUUID()},s.d)).rejects.toThrow("CONFLICT");
 expect(s.sheet).toHaveBeenCalledTimes(1);
});
test.each(["frozen","rollback_prepared"] as const)("%s refuses both writers",async phase=>{
 const s=setup(phase);await expect(authoritativeProspectCreate(actor,{...fields,expectedEpoch:3,operationId:randomUUID()},s.d)).rejects.toThrow("CONFLICT");
 expect(s.native).not.toHaveBeenCalled();expect(s.sheet).not.toHaveBeenCalled();
});
test.each(["native_active","retired"] as const)("%s requires exact current epoch and original operation without Sheet fallback",async phase=>{
 const s=setup(phase),operationId=randomUUID();
 for(const request of [fields,{...fields,expectedEpoch:2,operationId},{...fields,expectedEpoch:3}])
  await expect(authoritativeProspectCreate(actor,request,s.d)).rejects.toThrow("CONFLICT");
 expect(await authoritativeProspectCreate(actor,{...fields,expectedEpoch:3,operationId},s.d)).toMatchObject({action:"created",source:"native",authorityEpoch:3});
 expect(s.native).toHaveBeenCalledWith(actor,expect.objectContaining({notes:fields.notes}),operationId,3);expect(s.sheet).not.toHaveBeenCalled();
 s.native.mockRejectedValueOnce(new Error("SYNTHETIC_NATIVE_FAILURE"));
 await expect(authoritativeProspectCreate(actor,{...fields,expectedEpoch:3,operationId},s.d)).rejects.toThrow("SYNTHETIC_NATIVE_FAILURE");expect(s.sheet).not.toHaveBeenCalled();
});
test.each(["parent","child","adult_client"] as const)("%s cannot select either contact writer",async role=>{
 const s=setup("native_active");await expect(authoritativeProspectCreate({...actor,role},fields,s.d)).rejects.toThrow("FORBIDDEN");
 expect(s.d.authority.read).not.toHaveBeenCalled();expect(s.native).not.toHaveBeenCalled();expect(s.sheet).not.toHaveBeenCalled();
});
test("malformed caller authority/provenance never reaches a writer",async()=>{
 const s=setup("native_active");await expect(authoritativeProspectCreate(actor,{...fields,sourceFileId:"fake"} as typeof fields,s.d)).rejects.toThrow("INVALID_REQUEST");
 expect(s.d.authority.read).not.toHaveBeenCalled();expect(s.native).not.toHaveBeenCalled();expect(s.sheet).not.toHaveBeenCalled();
});
