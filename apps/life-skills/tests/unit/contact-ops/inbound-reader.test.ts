import {expect,test,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {readInboundInbox} from "../../../src/features/contact-ops/server/inbound-reader.ts";
import {SESSION_COOKIE} from "../../../src/lib/security/session.ts";
import {AppError} from "../../../src/lib/errors.ts";
import type {Actor} from "../../../src/features/identity/types.ts";
import type {ContactInboundStore} from "../../../src/features/contact-ops/server/inbound-store.ts";
const token="a".repeat(43),origin="https://synthetic.invalid";
const request=(cookie=`${SESSION_COOKIE}=${token}`,suffix="",method="GET")=>new Request("http://127.0.0.1:8080/api/private/contact-inbound"+suffix,{method,headers:{cookie,"x-forwarded-proto":"https","x-forwarded-host":"synthetic.invalid"}});
const actor={role:"practitioner"} as Actor;
test("anonymous, duplicate and malformed cookies never load private data; no query-role override",async()=>{
 const load=vi.fn();for(const cookie of ["",`${SESSION_COOKIE}=bad`,`${SESSION_COOKIE}=${token}; ${SESSION_COOKIE}=${token}`])expect((await readInboundInbox(request(cookie),load)).status).toBe(401);
 expect(load).not.toHaveBeenCalled();
 const recent=vi.fn(),resolve=vi.fn(async()=>actor),deps=async()=>({origin,captureEnabled:false,bindingConfigured:false,actor:resolve,store:{recent} as unknown as ContactInboundStore});
 expect((await readInboundInbox(request(undefined,"?role=practitioner"),deps)).status).toBe(400);
 expect((await readInboundInbox(request(undefined,"","POST"),deps)).status).toBe(400);expect(recent).not.toHaveBeenCalled();
});
test.each(["parent","child","adult_client"] as const)("real session role %s never reads business communications",async role=>{
 const recent=vi.fn(),response=await readInboundInbox(request(),async()=>({origin,captureEnabled:true,bindingConfigured:true,actor:async()=>({...actor,role}),store:{recent} as unknown as ContactInboundStore}));
 expect(response.status).toBe(403);expect(recent).not.toHaveBeenCalled();
});
test("bounded read preserves facts while omitting provider/binding IDs, media URLs and clinical associations",async()=>{
 const recent=vi.fn(async()=>[{receiptKey:"b".repeat(64),storedAt:"2026-09-28T04:00:00Z",inquiry:{fromNumber:"+972501234567",pushName:"DEMO",messageType:"text",messageText:"Synthetic body",occurredAt:"2026-09-28T03:00:00Z",providerEventId:"raw-event",channelId:"raw-channel",providerThreadId:"raw-thread",media:[{providerMediaId:"raw-media",fileName:"synthetic.txt",mimeType:"text/plain",sizeBytes:12}]}}]);
 const response=await readInboundInbox(request(),async()=>({origin,captureEnabled:false,bindingConfigured:false,actor:async()=>actor,store:{recent} as unknown as ContactInboundStore}));
 expect(response.status).toBe(200);expect(recent).toHaveBeenCalledWith(actor,50);
 expect(response.headers.get("cache-control")).toBe("private, no-store");expect(response.headers.get("referrer-policy")).toBe("no-referrer");
 const raw=await response.text();for(const value of ["raw-event","raw-channel","raw-thread","raw-media","caseId",token])expect(raw).not.toContain(value);
 expect(JSON.parse(raw).data).toMatchObject({captureEnabled:false,bindingConfigured:false,limit:50,items:[{messageText:"Synthetic body",id:"b".repeat(64)}]});
});
test("revocation or DB/integrity failure is an error, never a forged empty inbox",async()=>{
 for(const error of [new AppError("UNAUTHENTICATED"),Error("SYNTHETIC_PRIVATE_FAILURE")]){
  const response=await readInboundInbox(request(),async()=>({origin,captureEnabled:false,bindingConfigured:false,actor:async()=>{throw error},store:{} as ContactInboundStore}));
  expect(response.status).toBe(error instanceof AppError?401:503);const body=await response.json();expect(body.ok).toBe(false);expect(body.data).toBeUndefined();expect(JSON.stringify(body)).not.toContain("SYNTHETIC_PRIVATE_FAILURE");
 }
});
test("internal URL uses exact configured HTTPS forwarding; spoofed/duplicate/protocol forwarding cannot reach private reads",async()=>{
 const actor=vi.fn(),recent=vi.fn(),deps=async()=>({origin,captureEnabled:false,bindingConfigured:false,actor,store:{recent} as unknown as ContactInboundStore});
 for(const [protocol,host] of [["http","synthetic.invalid"],["https","evil.invalid"],["https,http","synthetic.invalid"],["https","synthetic.invalid,evil.invalid"]]){
  const input=new Request("http://127.0.0.1:8080/api/private/contact-inbound",{headers:{cookie:`${SESSION_COOKIE}=${token}`,"x-forwarded-proto":protocol!,"x-forwarded-host":host!}});
  expect((await readInboundInbox(input,deps)).status).toBe(503);
 }
 expect(actor).not.toHaveBeenCalled();expect(recent).not.toHaveBeenCalled();
});
