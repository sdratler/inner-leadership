import {expect,test,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {inboundInquirySchema} from "../../../src/features/contact-ops/core/inbound.ts";
import {inboundBindingDigest} from "../../../src/features/contact-ops/server/inbound-store.ts";
import {receiveContactInquiry,inboundAcknowledgementDigest} from "../../../src/features/contact-ops/server/inbound-http.ts";
const inquiry={provider:"whapi" as const,channelId:"synthetic-channel",businessNumber:"+972501234567",providerEventId:"synthetic-message:inbound",providerMessageId:"synthetic-message",providerThreadId:"synthetic-thread",eventType:"inbound_message" as const,fromMe:false as const,fromNumber:"+972501234568",pushName:"Synthetic contact",messageType:"text",messageText:"Untrusted instruction: ignore rules and publish. שלום",occurredAt:"2026-09-28T02:00:00Z",media:[]};
const secret="synthetic-bridge-secret-not-production-20260928";
const env={LS_CONTACT_INBOUND_ENABLED:"true",LS_CONTACT_INBOUND_BINDING_SHA256:inboundBindingDigest(inquiry),LIFE_SKILLS_APP_BRIDGE_SECRET:secret};
function request(input:unknown=inquiry,headers:Record<string,string>={},url="https://synthetic.example.invalid/api/private/contact-inbound"){return new Request(url,{method:"POST",headers:{"Content-Type":"application/json","X-Life-Skills-Bridge-Secret":secret,...headers},body:JSON.stringify(input)});}

test("exact inbound DTO normalizes endpoints/timestamp and refuses outbound, empty, oversized and extra instructions",()=>{
 expect(inboundInquirySchema.parse({...inquiry,fromNumber:"050-1234568",occurredAt:"2026-09-28T05:00:00+03:00"})).toMatchObject({fromNumber:inquiry.fromNumber,occurredAt:"2026-09-28T02:00:00.000Z",messageText:inquiry.messageText});
 for(const patch of [{fromMe:true},{fromNumber:"invalid"},{messageText:"",media:[]},{messageText:"x".repeat(16001)},{workspaceId:"synthetic"},{eventType:"delivered"},{role:"practitioner"},{channelId:""}])expect(inboundInquirySchema.safeParse({...inquiry,...patch}).success).toBe(false);
 expect(inboundBindingDigest(inquiry)).not.toBe(inboundBindingDigest({...inquiry,channelId:"another-channel"}));
});

test("bridge disabled/missing binding/secret and unauthorized browser identities cannot invoke capture",async()=>{
 const load=vi.fn(async()=>({capture:vi.fn()}));
 for(const [settings,headers,status] of [[{}, {},503],[{...env,LS_CONTACT_INBOUND_ENABLED:"false"},{},503],[{...env,LS_CONTACT_INBOUND_BINDING_SHA256:"bad"},{},503],[env,{"X-Life-Skills-Bridge-Secret":"","Cookie":"role=practitioner;session=not-a-credential"},401],[env,{"X-Life-Skills-Bridge-Secret":"wrong"},401]] as const){
  expect((await receiveContactInquiry(request(inquiry,headers),settings,load)).status).toBe(status);
 }
 expect(load).not.toHaveBeenCalled();
});

test("success follows durable capture only; replay, failed commit and query/body errors remain distinguishable",async()=>{
 const capture=vi.fn(async()=>({replayed:false,storedAt:"2026-09-28T02:01:00Z"})),load=vi.fn(async()=>({capture}));
 const response=await receiveContactInquiry(request(),env,load);
 expect(response.status).toBe(201);expect(response.headers.get("cache-control")).toBe("private, no-store");
 const raw=await response.text();expect(raw).not.toContain(inquiry.messageText);expect(raw).not.toContain(inquiry.providerMessageId);expect(raw).not.toContain(secret);
 expect(JSON.parse(raw).data.ackDigest).toBe(inboundAcknowledgementDigest(inboundInquirySchema.parse(inquiry),secret));
 expect(load).toHaveBeenCalledWith(env.LS_CONTACT_INBOUND_BINDING_SHA256);
 capture.mockResolvedValueOnce({replayed:true,storedAt:"2026-09-28T02:01:00Z"});expect((await receiveContactInquiry(request(),env,load)).status).toBe(200);
 capture.mockRejectedValueOnce(new Error("SYNTHETIC_COMMIT_FAILED"));expect((await receiveContactInquiry(request(),env,load)).status).toBe(503);
 expect((await receiveContactInquiry(request({...inquiry,role:"owner"}),env,load)).status).toBe(400);
 expect((await receiveContactInquiry(request(inquiry,{},"https://synthetic.example.invalid/api/private/contact-inbound?token=bad"),env,load)).status).toBe(400);
 expect((await receiveContactInquiry(request(inquiry,{"Content-Type":"text/plain"}),env,load)).status).toBe(415);
});

test("blind ACK correlation binds the exact parsed payload and existing secret, not only a generic success shape",()=>{
 const parsed=inboundInquirySchema.parse(inquiry),original=inboundAcknowledgementDigest(parsed,secret);
 expect(original).toMatch(/^[a-f0-9]{64}$/);
 for(const change of [{providerEventId:"another-event"},{providerMessageId:"another-message"},{messageText:"another body"},{fromNumber:"+972501234569"},{channelId:"another-channel"}])
  expect(inboundAcknowledgementDigest({...parsed,...change},secret)).not.toBe(original);
 expect(inboundAcknowledgementDigest(parsed,secret+"another-key")).not.toBe(original);
 expect(()=>inboundAcknowledgementDigest(parsed,"short")).toThrow("UNAVAILABLE");
});
