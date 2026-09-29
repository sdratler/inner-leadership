import {z} from "zod";
import type {Phase} from "./cutover.ts";
import {normalizePhone} from "./contact-resolution.ts";
import {dateOnly,requireThat} from "./validation.ts";
import type {InboundInquiry} from "./inbound.ts";

const timestamp=z.iso.datetime({offset:true}).refine(v=>new Date(v).toISOString()===v);
const blindKey=z.string().regex(/^[a-f0-9]{64}$/);
/** Real business-message provenance, not a manual inquiry or a Sheet snapshot.
 * None of these fields creates an account, case, guardian or permission. */
export const nativeWhatsappInquirySchema=z.object({origin:z.literal("native_whatsapp"),
 leadId:z.string().regex(/^LS-WAPI-native-[0-9a-f-]{36}$/),phone:z.string().refine(v=>normalizePhone(v)===v),
 language:z.enum(["","he","en"]),source:z.literal("WhatsApp"),createdAt:timestamp,
 providerBindingKey:blindKey,providerThreadKey:blindKey}).strict();
export type NativeWhatsappInquiry=z.infer<typeof nativeWhatsappInquirySchema>;
export const inboundActivitySchema=z.object({firstInboundAt:timestamp,lastInboundAt:timestamp,
 messageCount:z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
 lastMessageKey:blindKey}).strict().refine(v=>v.firstInboundAt<=v.lastInboundAt);
export type InboundActivity=z.infer<typeof inboundActivitySchema>;

/** Freezing a writer must not prevent durable receipt capture. Only the separately
 * verified native authority enables administrative projections. */
export function inboundProjectionEnabled(phase:Phase):boolean{
 return phase==="native_active"||phase==="retired";
}
/** Event IDs may differ on replay. Message identity/content must stay exact;
 * display-name changes are not edits to an already received message. */
export function inboundMessageMaterial(inquiry:InboundInquiry){
 const {providerEventId:_event,pushName:_name,...message}=inquiry;
 void _event;void _name;return message;
}
export function nextInboundActivity(previous:InboundActivity|undefined,inquiry:InboundInquiry,messageKey:string):InboundActivity{
 if(previous)inboundActivitySchema.parse(previous);
 requireThat(!previous||previous.messageCount<Number.MAX_SAFE_INTEGER,"INBOUND_ACTIVITY_EXHAUSTED");
 return inboundActivitySchema.parse({firstInboundAt:previous&&previous.firstInboundAt<inquiry.occurredAt?previous.firstInboundAt:inquiry.occurredAt,
  lastInboundAt:previous&&previous.lastInboundAt>inquiry.occurredAt?previous.lastInboundAt:inquiry.occurredAt,
  messageCount:(previous?.messageCount??0)+1,
  // An older delivery does not replace the current-message reference.
  lastMessageKey:previous&&previous.lastInboundAt>inquiry.occurredAt?previous.lastMessageKey:messageKey});
}
/** Keep authored notes, stages, opt-outs and existing follow-up choices intact.
 * This is an internal to-do, never an instruction to send a reply. */
export function inboundFollowUp<T extends {nextAction:string|null;followUpDate:string|null;notes:string}>(
 profile:T,today:string,suppressed:boolean):Pick<T,"nextAction"|"followUpDate"|"notes">{
 requireThat(dateOnly(today),"INVALID_FOLLOW_UP_DATE");
 return {nextAction:profile.nextAction||(suppressed?"Review inbound inquiry":"Respond to inbound WhatsApp inquiry"),
  followUpDate:profile.followUpDate||today,notes:profile.notes};
}
