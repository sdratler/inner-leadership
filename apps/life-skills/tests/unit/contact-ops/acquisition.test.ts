import {expect,test} from "vitest";
import {ctwaAttributionFromProviderMessage,qualifiedNewInbound,acquisitionCandidateMetadataSchema} from "../../../src/features/contact-ops/core/acquisition.ts";
import {inboundInquirySchema} from "../../../src/features/contact-ops/core/inbound.ts";
const evidence={clickId:"synthetic-click",adId:"synthetic-ad",attributed:true as const,sourceType:"ad" as const};
const message={context:{ad:{ctwa:evidence.clickId,attrib:true,source:{id:evidence.adId,type:"ad"}}}};
const inquiry={provider:"whapi",channelId:"synthetic-channel",businessNumber:"+972501234567",providerEventId:"synthetic-event",
 providerMessageId:"synthetic-message",providerThreadId:"synthetic-thread",eventType:"inbound_message",fromMe:false,
 fromNumber:"+972501234568",pushName:"Synthetic name",messageType:"text",messageText:"I saw your ad; LS • Lead; ctwa_clid=untrusted-text",
 occurredAt:"2026-10-03T00:00:00.000Z",media:[]};
test("unknown organic messages and arbitrary text/names do not qualify as active leads",()=>{
 const parsed=inboundInquirySchema.parse(inquiry);expect(qualifiedNewInbound(parsed)).toBe(false);
 expect(Object.hasOwn(parsed,"ctwaAttribution")).toBe(false);expect(JSON.stringify(parsed)).toBe(JSON.stringify(inquiry));
 expect(ctwaAttributionFromProviderMessage({text:{body:inquiry.messageText},from_name:"LS • Lead",utm_source:"Meta",campaign:"synthetic-ad"})).toBeNull();
});
test("only complete actual provider ad context is normalized, not ad bodies or URLs",()=>{
 expect(ctwaAttributionFromProviderMessage({...message,text:{body:"private text"}})).toEqual(evidence);
 const parsed=inboundInquirySchema.parse({...inquiry,ctwaAttribution:evidence});expect(qualifiedNewInbound(parsed)).toBe(true);
 expect(JSON.stringify(parsed.ctwaAttribution)).not.toContain("private text");
});
for(const [name,ad]of Object.entries({missingClick:{attrib:true,source:{id:"synthetic-ad",type:"ad"}},
 missingId:{ctwa:"synthetic-click",attrib:true,source:{type:"ad"}},falseAttribution:{ctwa:"synthetic-click",attrib:false,source:{id:"synthetic-ad",type:"ad"}},
 nonAd:{ctwa:"synthetic-click",attrib:true,source:{id:"synthetic-ad",type:"post"}},blankClick:{ctwa:"   ",attrib:true,source:{id:"synthetic-ad",type:"ad"}},
 oversizedClick:{ctwa:"x".repeat(2049),attrib:true,source:{id:"synthetic-ad",type:"ad"}}})){
 test(`incomplete/unverified ${name} context stays unclassified`,()=>expect(ctwaAttributionFromProviderMessage({context:{ad}})).toBeNull());
}
test("inherited provider evidence cannot promote a candidate",()=>{
 expect(ctwaAttributionFromProviderMessage(Object.create(message))).toBeNull();
 expect(ctwaAttributionFromProviderMessage({context:Object.create(message.context)})).toBeNull();
 expect(ctwaAttributionFromProviderMessage({context:{ad:Object.create(message.context.ad)}})).toBeNull();
 expect(qualifiedNewInbound(Object.create({ctwaAttribution:evidence}))).toBe(false);
});
test("a normalized receiver DTO rejects malformed attribution and browser authority flags",()=>{
 for(const value of [{...evidence,attributed:false},{...evidence,sourceType:"post"},{...evidence,ownerApproved:true}])
  expect(inboundInquirySchema.safeParse({...inquiry,ctwaAttribution:value}).success).toBe(false);
 for(const extra of [{isLead:true},{role:"practitioner"},{ownerLabel:"LS • Lead"}])expect(inboundInquirySchema.safeParse({...inquiry,...extra}).success).toBe(false);
});
test("the acquisition record accepts metadata only, never clinical/message/account fields",()=>{
 const metadata={id:"00000000-0000-4000-8000-000000000001",source:"organic_whatsapp",phone:inquiry.fromNumber,
  displayName:"Synthetic name",occurredAt:inquiry.occurredAt};
 expect(acquisitionCandidateMetadataSchema.safeParse(metadata).success).toBe(true);
 for(const extra of [{messageText:inquiry.messageText},{notes:"clinical text"},{caseId:metadata.id},{accountId:metadata.id},{mediaUrl:"https://example.test/private"},{phone:"0501234568"}])
  expect(acquisitionCandidateMetadataSchema.safeParse({...metadata,...extra}).success).toBe(false);
});
