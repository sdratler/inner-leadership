import {afterEach,expect,test,vi} from "vitest";
import {readFishingLeadContext,previewFishingLead,confirmFishingLead,FishingLeadClientError} from "../../../src/features/contact-ops/core/fishing-lead-client.ts";
import type {FishingLeadRequest} from "../../../src/features/contact-ops/core/fishing-lead.ts";
const person="00000000-0000-4000-8000-000000000001",workspace="00000000-0000-4000-8000-000000000002",op="00000000-0000-4000-8000-000000000003",
 actor="00000000-0000-4000-8000-000000000004",program="sunday_fishing_academy" as const,source={kind:"person" as const,id:person};
const member={workspaceId:workspace,personId:person,program,version:1,state:"active" as const,relationship:"guardian" as const,source,
 permission:{state:"unknown" as const},outboundEligible:false as const,recordedAt:"2026-10-14T19:00:00.000Z",recordedBy:actor};
const context={state:"ready",epoch:3,personId:person,membership:member,projection:{workspaceId:workspace,personId:person,program,generation:1,
 desiredPresent:true,status:"unconfigured",binding:null,verifiedAt:null}};
const preview={state:"ready" as const,token:"t".repeat(80),operationId:op,name:"Synthetic parent",phone:null,personId:person,newPerson:false,
 action:"add" as const,expectedVersion:0,expiresAt:"2026-10-14T20:15:00.000Z"};
const input:Exclude<FishingLeadRequest,{action:"confirm"}>={action:"preview_add",operationId:op,expectedEpoch:3,source,expectedAssociationVersion:0,relationship:"guardian"};
const confirm={action:"confirm" as const,token:preview.token,confirmNewPerson:false};
const receipt={operationId:op,workspaceId:workspace,personId:person,program,version:1,state:"active",authorityEpoch:3,newPerson:false,replayed:false,tasksCreated:0,outboundEligible:false};
const json=(data:unknown,status=200)=>new Response(JSON.stringify({ok:status===200,data}),{status,headers:{"content-type":"application/json"}});
const session=json({role:"practitioner",csrfToken:"synthetic-csrf"});
afterEach(()=>vi.unstubAllGlobals());

test("detail edit preview is bound to exactly the reviewed Academy data and confirm retains active membership",async()=>{
 const details={status:"follow_up" as const,notes:"Synthetic note",nextAction:"Owner callback",followUpDate:null},edit={action:"preview_edit" as const,operationId:op,expectedEpoch:3,personId:person,expectedAssociationVersion:1,details},ready={...preview,action:"edit" as const,expectedVersion:1,details};
 vi.stubGlobal("fetch",vi.fn().mockResolvedValueOnce(session.clone()).mockResolvedValueOnce(json(ready)));expect(await previewFishingLead(program,edit)).toEqual(ready);
 vi.stubGlobal("fetch",vi.fn().mockResolvedValueOnce(session.clone()).mockResolvedValueOnce(json({...ready,details:{...details,notes:"Different"}})));await expect(previewFishingLead(program,edit)).rejects.toThrow();
 vi.stubGlobal("fetch",vi.fn().mockResolvedValueOnce(session.clone()).mockResolvedValueOnce(json({...receipt,version:2})));expect(await confirmFishingLead(program,confirm,ready,3)).toMatchObject({state:"active",version:2});
});
test("current membership and projection are schema-checked and bound to the requested person/program/generation",async()=>{
 const f=vi.fn().mockResolvedValue(json(context));vi.stubGlobal("fetch",f);expect(await readFishingLeadContext(program,source)).toEqual(context);
 expect(f.mock.calls[0]![0]).toBe("/api/private/fishing-leads/sunday_fishing_academy?source=person&sourceId="+person);
 expect(f.mock.calls[0]![1]).toMatchObject({method:"GET",credentials:"same-origin",cache:"no-store",redirect:"error",referrerPolicy:"no-referrer"});
});
for(const delta of [{personId:actor},{membership:{...member,program:"private_fishing_life_skills"}},
 {projection:{...context.projection,generation:2}},{projection:{...context.projection,desiredPresent:false}}])
 test("reject unbound current state "+JSON.stringify(delta),async()=>{vi.stubGlobal("fetch",vi.fn().mockResolvedValue(json({...context,...delta})));
  await expect(readFishingLeadContext(program,source)).rejects.toThrow();});
test("native-authority and email-only blocks are honest data, not empty membership or Sheet fallback",async()=>{
 for(const reason of ["native_authority_required","email_only"]){vi.stubGlobal("fetch",vi.fn().mockResolvedValue(json({state:"blocked",epoch:0,reason,choices:[]})));
  expect(await readFishingLeadContext(program,source)).toEqual({state:"blocked",epoch:0,reason,choices:[]});}
});
test("preview uses normal practitioner session CSRF and the exact typed request without provider/task fields",async()=>{
 const f=vi.fn().mockResolvedValueOnce(session.clone()).mockResolvedValueOnce(json(preview));vi.stubGlobal("fetch",f);
 expect(await previewFishingLead(program,input)).toEqual(preview);expect(f.mock.calls[1]![1]).toMatchObject({method:"POST",headers:{"content-type":"application/json","x-csrf-token":"synthetic-csrf"},body:JSON.stringify(input)});
});
test("preview cannot change operation/person/action/version silently",async()=>{
 for(const patch of [{operationId:actor},{personId:actor},{action:"remove"},{expectedVersion:2}]){
  vi.stubGlobal("fetch",vi.fn().mockResolvedValueOnce(session.clone()).mockResolvedValueOnce(json({...preview,...patch})));
  await expect(previewFishingLead(program,input)).rejects.toThrow();}
});
test("parent session refuses mutation before the private POST",async()=>{
 const f=vi.fn().mockResolvedValue(json({role:"parent",csrfToken:"synthetic"}));vi.stubGlobal("fetch",f);
 await expect(previewFishingLead(program,input)).rejects.toMatchObject({status:403});expect(f).toHaveBeenCalledTimes(1);
});
for(const status of [400,401,403,409,429,503])test("retain exact HTTP failure category "+status,async()=>{
 vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response("",{status})));await expect(readFishingLeadContext(program,source)).rejects.toMatchObject({status});
});
test("lost confirmation response remains unknown, then retry sends the exact same token/body and obtains one historical receipt",async()=>{
 const f=vi.fn().mockResolvedValueOnce(session.clone()).mockRejectedValueOnce(Error("synthetic response lost"))
  .mockResolvedValueOnce(session.clone()).mockResolvedValueOnce(json({...receipt,replayed:true}));vi.stubGlobal("fetch",f);
 await expect(confirmFishingLead(program,confirm,preview,3)).rejects.toBeInstanceOf(FishingLeadClientError);
 expect(await confirmFishingLead(program,confirm,preview,3)).toEqual({...receipt,replayed:true});
 expect(f.mock.calls[1]![1].body).toBe(f.mock.calls[3]![1].body);
});
test("receipt cannot claim task creation, different program/person/epoch/version or unexpected mutation",async()=>{
 for(const patch of [{tasksCreated:1},{program:"private_fishing_life_skills"},{personId:actor},{authorityEpoch:4},{version:3},{state:"removed"},{newPerson:true}]){
  vi.stubGlobal("fetch",vi.fn().mockResolvedValueOnce(session.clone()).mockResolvedValueOnce(json({...receipt,...patch})));
  await expect(confirmFishingLead(program,confirm,preview,3)).rejects.toThrow();}
});
test("old Add receipt and fresh removed membership are returned separately, never resurrected by the client",async()=>{
 const f=vi.fn().mockResolvedValueOnce(session.clone()).mockResolvedValueOnce(json({...receipt,replayed:true})).mockResolvedValueOnce(json({...context,
  membership:{...member,state:"removed",version:2},projection:{...context.projection,generation:2,desiredPresent:false}}));vi.stubGlobal("fetch",f);
 expect((await confirmFishingLead(program,confirm,preview,3)).state).toBe("active");
 const fresh=await readFishingLeadContext(program,source);expect(fresh.state==="ready"&&fresh.membership?.state).toBe("removed");
});
