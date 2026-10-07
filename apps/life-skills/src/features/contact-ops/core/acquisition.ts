import {z} from "zod";
import {normalizePhone} from "./contact-resolution.ts";
import {dateOnly} from "./validation.ts";

/** LS-ACQ-CRM-20261002-01. Only the authenticated, exact-channel receiver may
 * normalize provider evidence. An unknown number, message text, UTM string or
 * contact/display name is not business intent. This is not a permission grant.
 * Whapi reference: https://whapi.cloud/blog/track-click-to-whatsapp-ctwa-clid
 * Actual fields: context.ad.ctwa, context.ad.attrib, context.ad.source.id/type.
 */
export const ctwaAttributionSchema=z.object({clickId:z.string().trim().min(1).max(2048),
 adId:z.string().trim().min(1).max(180),attributed:z.literal(true),sourceType:z.literal("ad")}).strict();
export type CtwaAttribution=z.infer<typeof ctwaAttributionSchema>;

/** Fail closed on incomplete attribution. Never inspect/parse the message body.
 * The caller still must authenticate the actual provider and destination.
 */
export function ctwaAttributionFromProviderMessage(message:unknown):CtwaAttribution|null{
 if(!message||typeof message!=="object")return null;
 const own=(value:object,key:string)=>Object.hasOwn(value,key)?Reflect.get(value,key):undefined;
 const context=own(message,"context");if(!context||typeof context!=="object")return null;
 const ad=own(context,"ad");if(!ad||typeof ad!=="object")return null;
 const source=own(ad,"source");if(!source||typeof source!=="object")return null;
 const parsed=ctwaAttributionSchema.safeParse({clickId:own(ad,"ctwa"),adId:own(source,"id"),
  attributed:own(ad,"attrib"),sourceType:own(source,"type")});
 return parsed.success?parsed.data:null;
}
export function qualifiedNewInbound(inquiry:{ctwaAttribution?:CtwaAttribution|undefined}):boolean{
 return Object.hasOwn(inquiry,"ctwaAttribution")&&ctwaAttributionSchema.safeParse(inquiry.ctwaAttribution).success;
}

/** Administrative metadata only. No message body, clinical input, media URL,
 * transcript, family/case/account inference, provider token or address book.
 */
export const acquisitionCandidateMetadataSchema=z.object({id:z.string().uuid(),
 source:z.enum(["organic_whatsapp","android_nomad"]),phone:z.string().refine(v=>normalizePhone(v)===v),
 displayName:z.string().max(120),occurredAt:z.iso.datetime({offset:true}).refine(v=>new Date(v).toISOString()===v),
 callState:z.literal("incoming").optional(),durationSeconds:z.number().int().min(0).max(86400).optional()}).strict()
 .refine(v=>v.source==="android_nomad"?v.callState==="incoming"&&v.durationSeconds!==undefined:
  v.callState===undefined&&v.durationSeconds===undefined);
export type AcquisitionCandidateMetadata=z.infer<typeof acquisitionCandidateMetadataSchema>;
export type AcquisitionCandidate=AcquisitionCandidateMetadata&{state:"NEEDS_REVIEW"};

const epoch=z.number().int().min(0).max(Number.MAX_SAFE_INTEGER-1);
const command={candidateId:z.string().uuid(),operationId:z.string().uuid(),expectedEpoch:epoch};
export const acquisitionDecisionSchema=z.discriminatedUnion("action",[
 z.object({...command,action:z.literal("promote"),fields:z.object({
  name:z.string().trim().min(1).max(120),stage:z.string().trim().min(1).max(120),
  language:z.enum(["","he","en"]),note:z.string().max(5000),nextAction:z.string().max(500),
  dueDate:z.string().refine(v=>v===""||dateOnly(v))}).strict()}).strict(),
 z.object({...command,action:z.literal("match"),personId:z.string().uuid(),
  expectedVersion:z.number().int().min(1).max(2147483646)}).strict(),
 z.object({...command,action:z.literal("not_lead")}).strict()
]);
export type AcquisitionDecision=z.infer<typeof acquisitionDecisionSchema>;
export type AcquisitionDecisionResult={candidateId:string;state:"PROMOTED"|"MATCHED"|"NOT_A_LEAD";
 personId:string|null;version:number|null;authorityEpoch:number;replayed:boolean;
 projections:{google:"pending";whatsapp:"pending";reason:"provider_not_verified"}|null};
export type AcquisitionMatch={personId:string;displayName:string;version:number|null;eligible:boolean};
export type AcquisitionReviewItem=AcquisitionCandidate&{matching:{state:"unmatched"|"existing"|"ambiguous"|"reserved";people:AcquisitionMatch[]}};
/** Counts and search cover the latest bounded pending window. hasMore refers
 * to pending records outside that window, independently of the search. */
export type AcquisitionPage={items:AcquisitionReviewItem[];total:number;page:number;pages:number;authorityEpoch:number;hasMore:boolean};
export const acquisitionPageSchema:z.ZodType<AcquisitionPage>=z.object({
 items:z.array(acquisitionCandidateMetadataSchema.safeExtend({state:z.literal("NEEDS_REVIEW"),matching:z.object({
  state:z.enum(["unmatched","existing","ambiguous","reserved"]),people:z.array(z.object({personId:z.string().uuid(),
   displayName:z.string().max(120),version:z.number().int().min(1).nullable(),eligible:z.boolean()}).strict()).max(1000)}).strict()}).strict()).max(12),
 total:z.number().int().min(0).max(1000),page:z.number().int().min(1),pages:z.number().int().min(1),authorityEpoch:epoch,hasMore:z.boolean()
}).strict().refine(value=>value.pages===Math.max(1,Math.ceil(value.total/12))&&value.page<=value.pages&&value.items.length<=value.total);
export const acquisitionDecisionResultSchema:z.ZodType<AcquisitionDecisionResult>=z.object({candidateId:z.string().uuid(),
 state:z.enum(["PROMOTED","MATCHED","NOT_A_LEAD"]),personId:z.string().uuid().nullable(),version:z.number().int().min(1).max(2147483646).nullable(),
 authorityEpoch:epoch,replayed:z.boolean(),projections:z.object({google:z.literal("pending"),whatsapp:z.literal("pending"),reason:z.literal("provider_not_verified")}).strict().nullable()
}).strict().refine(value=>value.state==="NOT_A_LEAD"?value.personId===null&&value.version===null&&value.projections===null:
 value.personId!==null&&value.version!==null&&value.projections!==null);
