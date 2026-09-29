import {expect,test} from "vitest";
import {inboundInquirySchema} from "../../../src/features/contact-ops/core/inbound.ts";
import {inboundProjectionEnabled,inboundMessageMaterial,nextInboundActivity,inboundFollowUp,nativeWhatsappInquirySchema} from "../../../src/features/contact-ops/core/inbound-projection.ts";
const inquiry=inboundInquirySchema.parse({provider:"whapi",channelId:"synthetic-channel",businessNumber:"+972501234567",providerEventId:"synthetic-event-1",providerMessageId:"synthetic-message-1",providerThreadId:"synthetic-thread",eventType:"inbound_message",fromMe:false,fromNumber:"+972501234568",pushName:"Synthetic name",messageType:"text",messageText:"Synthetic inquiry",occurredAt:"2026-09-29T00:00:00Z",media:[]});
const key="1".repeat(64);
test("only independently activated native phases project; frozen/rollback keep durable capture only",()=>{
 for(const phase of ["sheet_active","shadow_ready","frozen","rollback_prepared"] as const)expect(inboundProjectionEnabled(phase)).toBe(false);
 for(const phase of ["native_active","retired"] as const)expect(inboundProjectionEnabled(phase)).toBe(true);
});
test("provider event replay/name change keeps exact message material; actual body/time/thread changes do not",()=>{
 expect(inboundMessageMaterial({...inquiry,providerEventId:"synthetic-replay",pushName:"Changed name"})).toEqual(inboundMessageMaterial(inquiry));
 for(const change of [{messageText:"Changed body"},{providerThreadId:"another thread"},{occurredAt:"2026-09-29T00:01:00.000Z"}])
  expect(inboundMessageMaterial({...inquiry,...change})).not.toEqual(inboundMessageMaterial(inquiry));
});
test("late chronological delivery retains newest message, expands first time and advances one committed count",()=>{
 const first=nextInboundActivity(undefined,inquiry,key);
 const earlier=nextInboundActivity(first,{...inquiry,occurredAt:"2026-09-28T23:59:00.000Z"},"2".repeat(64));
 expect(earlier).toEqual({...first,firstInboundAt:"2026-09-28T23:59:00.000Z",messageCount:2});
 const later=nextInboundActivity(earlier,{...inquiry,occurredAt:"2026-09-29T00:01:00.000Z"},"3".repeat(64));
 expect(later.lastInboundAt).toBe("2026-09-29T00:01:00.000Z");expect(later.lastMessageKey).toBe("3".repeat(64));expect(later.messageCount).toBe(3);
 expect(()=>nextInboundActivity({...later,messageCount:Number.MAX_SAFE_INTEGER},inquiry,key)).toThrow("INBOUND_ACTIVITY_EXHAUSTED");
});
test("inquiry follow-up is today only when no authored choice; notes and opt-out remain intact",()=>{
 const saved={nextAction:"Owner's chosen task",followUpDate:"2026-10-01",notes:"Existing notes\nPreserve Hebrew: הערה"};
 expect(inboundFollowUp(saved,"2026-09-29",false)).toEqual(saved);
 expect(inboundFollowUp({...saved,nextAction:null,followUpDate:null},"2026-09-29",false)).toEqual({notes:saved.notes,nextAction:"Respond to inbound WhatsApp inquiry",followUpDate:"2026-09-29"});
 expect(inboundFollowUp({...saved,nextAction:null},"2026-09-29",true).nextAction).toBe("Review inbound inquiry");
 expect(()=>inboundFollowUp(saved,"2026-02-30",false)).toThrow("INVALID_FOLLOW_UP_DATE");
});
test("business inbound origin cannot masquerade as manual/Sheet/verified clinical identity",()=>{
 const value={origin:"native_whatsapp",leadId:"LS-WAPI-native-00000000-0000-4000-8000-000000000001",phone:inquiry.fromNumber,language:"he",source:"WhatsApp",createdAt:inquiry.occurredAt,providerBindingKey:key,providerThreadKey:key};
 expect(nativeWhatsappInquirySchema.safeParse(value).success).toBe(true);
 for(const change of [{origin:"native_manual"},{source:"verified payment"},{caseId:"00000000-0000-4000-8000-000000000002"},{phone:"0501234568"},{providerBindingKey:"raw secret"}])expect(nativeWhatsappInquirySchema.safeParse({...value,...change}).success).toBe(false);
});
