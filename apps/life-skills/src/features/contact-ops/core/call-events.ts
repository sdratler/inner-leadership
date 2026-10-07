import {z} from "zod";
import {normalizePhone} from "./contact-resolution.ts";
/** Nomad custom CALL template, not enhanced device/SMS/push data. Verified in
 * ForwardingConfig.java at 642f1d56438d3b3194ad597c77b273f96b5192e4:
 * timestamp is epoch milliseconds, retained by CallWebhookWorker on retries.
 * Incoming duration=0 is a ringing notification, NOT a completed/missed call.
 */
const integer=(max:number)=>z.union([z.number().int().min(0).max(max),
 z.string().regex(/^(0|[1-9]\d{0,13})$/).transform(Number).refine(v=>Number.isSafeInteger(v)&&v<=max)]);
export const callEventSchema=z.object({source:z.literal("android_nomad"),
 from:z.string().max(80).transform(v=>normalizePhone(v)).refine((v):v is string=>v!==null),
 contact:z.string().max(120).optional().default(""),timestamp:integer(4102444800000).refine(v=>v>=946684800000),
 duration:integer(86400)}).strict().transform(v=>({source:v.source,phone:v.from!,displayName:v.contact,
 occurredAt:new Date(v.timestamp).toISOString(),callState:"incoming" as const,durationSeconds:v.duration}));
export type CallEvent=z.output<typeof callEventSchema>;
/** Normalized events are internal only; HTTP accepts the exact provider shape. */
export const normalizedCallEventSchema=z.object({source:z.literal("android_nomad"),
 phone:z.string().refine(v=>normalizePhone(v)===v),displayName:z.string().max(120),
 occurredAt:z.iso.datetime().refine(v=>new Date(v).toISOString()===v),callState:z.literal("incoming"),
 durationSeconds:z.number().int().min(0).max(86400)}).strict();
export type CallActivity={id:string;occurredAt:string;callState:"incoming";durationSeconds:number};
