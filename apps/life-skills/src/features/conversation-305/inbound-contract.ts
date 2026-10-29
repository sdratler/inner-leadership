import {z} from "zod";
import {normalizePhone} from "../contact-ops/core/contact-resolution.ts";
import {ctwaAttributionSchema} from "../contact-ops/core/acquisition.ts";
import {CONVERSATION_305_LINE} from "./contract.ts";
const key=z.string().min(1).max(180);
const phone=z.string().max(64).transform(value=>normalizePhone(value)).pipe(z.string());
/** An opaque WhatsApp LID is never converted into a phone or a Person. */
export const inbound305InquirySchema=z.object({provider:z.literal("whapi"),channelId:key,businessNumber:z.literal(CONVERSATION_305_LINE),
 providerEventId:key,providerMessageId:key,providerThreadId:key,eventType:z.literal("inbound_message"),fromMe:z.literal(false),
 fromNumber:phone.nullable(),pushName:z.string().max(120).default(""),messageType:z.string().min(1).max(60),messageText:z.string().max(16000),
 occurredAt:z.iso.datetime({offset:true}).transform(value=>new Date(value).toISOString()),
 media:z.array(z.object({providerMediaId:key,fileName:z.string().max(255),mimeType:z.string().max(120),sizeBytes:z.number().int().min(0).max(50_000_000).nullable()}).strict()).max(10).default([]),
 ctwaAttribution:ctwaAttributionSchema.optional()}).strict().superRefine((value,ctx)=>{
 const lid=/^[0-9]+@lid$/.test(value.providerThreadId),match=value.providerThreadId.match(/^([0-9]+)@(?:s\.whatsapp\.net|c\.us)$/);
 if((lid&&value.fromNumber!==null)||(!lid&&(!match||value.fromNumber!==`+${match[1]}`)))ctx.addIssue({code:"custom",path:["providerThreadId"],message:"exact direct thread binding required"});
 if(!value.messageText&&!value.media.length)ctx.addIssue({code:"custom",path:["messageText"],message:"message content required"});
});
export type Inbound305Inquiry=z.infer<typeof inbound305InquirySchema>;
