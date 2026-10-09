import {expect,test,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {callEventSchema} from "../../../src/features/contact-ops/core/call-events.ts";
import {acquisitionCandidateMetadataSchema,acquisitionPageSchema} from "../../../src/features/contact-ops/core/acquisition.ts";
import {receiveCallEvent} from "../../../src/features/contact-ops/server/call-events-http.ts";
import {AppError} from "../../../src/lib/errors.ts";
const binding="00000000-0000-4000-8000-000000000001",secret=Buffer.alloc(32,19).toString("base64url");
const env={LS_NOMAD_CALLS_ENABLED:"true",LS_NOMAD_DEVICE_BINDING_ID:binding,LS_NOMAD_CALL_SECRET:secret};
const payload={source:"android_nomad",from:"0501234567",contact:"Synthetic אדם",timestamp:"1791277200000",duration:"0"};
const canonical={source:"android_nomad",phone:"+972501234567",displayName:payload.contact,occurredAt:"2026-10-06T09:00:00.000Z",callState:"incoming",durationSeconds:0};
function request(body:unknown=payload,headers:Record<string,string>={},path="/api/private/acquisition/call-events"){
 return new Request("https://synthetic.invalid"+path,{method:"POST",headers:{"content-type":"application/json","authorization":"Bearer "+secret,
  "x-forwarded-proto":"https","x-forwarded-host":"synthetic.invalid",...headers},body:JSON.stringify(body)});
}
function dependencies(replayed=false){const capture=vi.fn(async(_event:unknown,_binding:string)=>{void _event;void _binding;return {replayed};}),consume=vi.fn(async(_key:string,_window:number)=>{void _key;void _window;return {count:1,retryAfterMs:1000};});
 const load=vi.fn(async()=>({origin:"https://synthetic.invalid",workspaceId:binding,rateLimitKey:"synthetic-private-salt-only-32-characters",limits:{consume},capture}));
 return {load,capture,consume};}
test("documented milliseconds/string duration normalize without guessing call outcome",()=>{
 expect(callEventSchema.parse(payload)).toEqual(canonical);expect(callEventSchema.parse({...payload,timestamp:Number(payload.timestamp),duration:0})).toEqual(canonical);
 const {contact:_contact,...minimum}=payload;void _contact;expect(callEventSchema.parse(minimum).displayName).toBe("");
});
test("no enhanced device, text, history, identity or business-intent input is admitted",()=>{
 for(const extra of [{text:"private"},{message:"private"},{device_info:{}},{role:"practitioner"},{workspaceId:binding},{isLead:true},{history:[]},{caseId:binding},{sourceQualified:true},{autoLink:true},{eventId:"physical-call"},{deviceId:binding},{state:"answered"}])
  expect(callEventSchema.safeParse({...payload,...extra}).success).toBe(false);
 for(const patch of [{source:"whatsapp"},{from:"Anonymous"},{from:"+972501234567 #"},{timestamp:"1791277200000x"},{timestamp:"1"},{duration:-1},{duration:"000"},{duration:86401},{contact:"x".repeat(121)}])
  expect(callEventSchema.safeParse({...payload,...patch}).success).toBe(false);
});
test("call metadata is strictly distinct from organic WhatsApp in loaded pages",()=>{
 const meta={...canonical,id:binding},item={...meta,state:"NEEDS_REVIEW",matching:{state:"unmatched",people:[]}};
 expect(acquisitionCandidateMetadataSchema.parse(meta)).toEqual(meta);
 expect(acquisitionPageSchema.safeParse({items:[item],total:1,page:1,pages:1,authorityEpoch:3,hasMore:false}).success).toBe(true);
 for(const patch of [{source:"organic_whatsapp"},{callState:undefined},{durationSeconds:undefined},{callState:"missed"},{notes:"clinical"}])
  expect(acquisitionCandidateMetadataSchema.safeParse({...meta,...patch}).success).toBe(false);
});
test.each([false,true])("committed capture replay=%s returns only a blind acknowledgement",async replayed=>{
 const d=dependencies(replayed),r=await receiveCallEvent(request(),env,d.load);expect(r.status).toBe(replayed?200:201);
 expect(d.capture).toHaveBeenCalledExactlyOnceWith(canonical,binding);const body=await r.json();expect(body.data).toEqual({replayed});
 expect(JSON.stringify(body)).not.toContain(payload.contact);expect(JSON.stringify(body)).not.toContain(secret);expect(JSON.stringify(body)).not.toContain(canonical.phone);
 expect(d.consume.mock.calls[0]![0]).toMatch(/^[a-f0-9]{64}$/);expect(r.headers.get("cache-control")).toBe("private, no-store");
});
test.each([{}, {...env,LS_NOMAD_CALLS_ENABLED:"false"},{...env,LS_NOMAD_DEVICE_BINDING_ID:"phone-name"},
 {...env,LS_NOMAD_CALL_SECRET:"x".repeat(31)},{...env,LS_NOMAD_CALL_SECRET:undefined,LIFE_SKILLS_APP_BRIDGE_SECRET:secret}])("disabled/invalid configuration cannot load a database or inherit another credential",async configuration=>{
 const d=dependencies(),r=await receiveCallEvent(request(),configuration,d.load);expect(r.status).toBe(503);expect(d.load).not.toHaveBeenCalled();
});
test.each(["",secret,"Bearer wrong","Bearer  "+secret])('invalid authorization %s cannot load runtime',async authorization=>{
 const d=dependencies(),r=await receiveCallEvent(request(payload,{authorization}),env,d.load);expect(r.status).toBe(401);expect(d.load).not.toHaveBeenCalled();
});
test.each(["/api/private/acquisition/call-events?mode=demo","/api/private/acquisition/other"])('rejects altered path %s without capture',async path=>{
 const d=dependencies(),r=await receiveCallEvent(request(payload,{},path),env,d.load);expect(r.status).toBe(400);expect(d.capture).not.toHaveBeenCalled();
});
test.each([{ "x-forwarded-proto":"http"},{"x-forwarded-host":"other.invalid"},{"x-forwarded-host":"synthetic.invalid,other.invalid"}])("canonical HTTPS/host fails closed",async headers=>{
 const d=dependencies(),r=await receiveCallEvent(request(payload,headers),env,d.load);expect(r.status).toBe(503);expect(d.capture).not.toHaveBeenCalled();
});
test("shared durable limit denial/failure prevents capture; no process-memory fallback",async()=>{
 const d=dependencies();d.consume.mockResolvedValueOnce({count:61,retryAfterMs:1000});expect((await receiveCallEvent(request(),env,d.load)).status).toBe(429);
 d.consume.mockRejectedValueOnce(Error("private dependency detail"));const failed=await receiveCallEvent(request(),env,d.load);expect(failed.status).toBe(503);
 expect(JSON.stringify(await failed.json())).not.toContain("private dependency detail");expect(d.capture).not.toHaveBeenCalled();
});
test("bounded bytes, strict payload and an actual failed commit cannot return success",async()=>{
 const d=dependencies();expect((await receiveCallEvent(request({...payload,contact:"x".repeat(2100)}),env,d.load)).status).toBe(413);
 expect((await receiveCallEvent(request({...payload,text:"private"}),env,d.load)).status).toBe(400);expect(d.capture).not.toHaveBeenCalled();
 d.capture.mockRejectedValueOnce(new AppError("CONFLICT"));expect((await receiveCallEvent(request(),env,d.load)).status).toBe(409);
});
