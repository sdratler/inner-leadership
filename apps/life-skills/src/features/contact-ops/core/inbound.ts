import {z} from "zod";
import {normalizePhone} from "./contact-resolution.ts";
import {ctwaAttributionSchema} from "./acquisition.ts";
const key=z.string().min(1).max(180);
const phone=z.string().max(64).transform(v=>normalizePhone(v)).pipe(z.string());
/** Exact normalized transport DTO, never a raw provider envelope/instruction.
 * Capture does not infer a person, family, login identity or payment from it.
 * Media metadata is recorded only; no remote download happens on receipt.
 */
export const inboundInquirySchema=z.object({provider:z.literal("whapi"),channelId:key,
 businessNumber:phone,providerEventId:key,providerMessageId:key,providerThreadId:key,
 eventType:z.literal("inbound_message"),fromMe:z.literal(false),fromNumber:phone,
 pushName:z.string().max(120).default(""),messageType:z.string().min(1).max(60),
 messageText:z.string().max(16000),occurredAt:z.iso.datetime({offset:true}).transform(v=>new Date(v).toISOString()),
 media:z.array(z.object({providerMediaId:key,fileName:z.string().max(255),mimeType:z.string().max(120),
  sizeBytes:z.number().int().min(0).max(50_000_000).nullable()}).strict()).max(10).default([]),
 // Optional preserves the exact normalized/digested shape of older receipts.
 // Accepted only through the authenticated receiver, never browser lead flags.
 ctwaAttribution:ctwaAttributionSchema.optional()
}).strict().refine(v=>v.messageText.length>0||v.media.length>0);
export type InboundInquiry=z.infer<typeof inboundInquirySchema>;
