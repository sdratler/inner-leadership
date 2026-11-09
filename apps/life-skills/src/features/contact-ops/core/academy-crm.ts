import {z} from "zod";
import {normalizePhone} from "./contact-resolution.ts";
import {dateOnly} from "./validation.ts";

export const ACADEMY_CRM_PROGRAM="sunday_fishing_academy" as const;
export const ACADEMY_RETIREMENT_DECISION="ACADEMY-ONLY-CRM-20261028-01" as const;
const uuid=z.string().uuid(),digest=z.string().regex(/^[a-f0-9]{64}$/);
export const academyEpoch=z.number().int().min(0).max(Number.MAX_SAFE_INTEGER-1);
const phone=z.string().refine(value=>normalizePhone(value)===value).nullable();
const email=z.email().max(254).refine(value=>value===value.trim().toLowerCase()).nullable();
const endpoint={phone,email};
const hasEndpoint=(value:{phone:string|null;email:string|null})=>Boolean(value.phone||value.email);

/** Evidence references are supplied by the reviewed server-side coordinator.
 * They are not a public activation API, imported-row proof, or permission to run
 * a production operator. Database emptiness is checked again under the fence. */
export const academyInitializationInputSchema=z.object({operationId:uuid,expectedEpoch:academyEpoch,
 observedNativeWritesSinceSwitch:academyEpoch,decisionId:z.literal(ACADEMY_RETIREMENT_DECISION),
 evidence:z.object({retiredSourcesFence:digest,retiredSchedulesFence:digest,
  retainedAcademyRecords:digest,queueReconciliation:digest,restorePlan:digest}).strict()}).strict();
export type AcademyInitializationInput=z.infer<typeof academyInitializationInputSchema>;
export const academyInitializationSchema=z.object({kind:z.literal("academy_fresh"),
 program:z.literal(ACADEMY_CRM_PROGRAM),operationId:uuid,decisionId:z.literal(ACADEMY_RETIREMENT_DECISION),
 initializedAt:z.iso.datetime(),importedRows:z.literal(0),evidence:academyInitializationInputSchema.shape.evidence}).strict();
export type AcademyInitialization=z.infer<typeof academyInitializationSchema>;

/** Immutable origin for a newly created administrative person. It does not
 * attach an account, merge an identity, admit an old profile or grant consent. */
export const academyContactOriginSchema=z.object({kind:z.enum(["manual","inquiry"]),
 program:z.literal(ACADEMY_CRM_PROGRAM),initializationId:uuid,sourceApplicationId:uuid.nullable(),
 sourceDigest:digest.nullable(),language:z.enum(["en","he"]),...endpoint,createdAt:z.iso.datetime()}).strict()
 .refine(value=>value.kind==="inquiry"?
  hasEndpoint(value)&&value.sourceApplicationId!==null&&value.sourceDigest!==null:
  value.sourceApplicationId===null&&value.sourceDigest===null);
export type AcademyContactOrigin=z.infer<typeof academyContactOriginSchema>;
export const academyLeadSourceSchema=z.enum(["unknown","facebook","referral","website","other"]);
export const academyConversationChannelSchema=z.enum(["unknown","whatsapp","messenger","phone","email","in_person","other"]);
const reviewedPhone=z.string().refine(value=>normalizePhone(value)===value&&(!value.startsWith("+1")||/^\+1\d{10}$/.test(value)));
// Owner labels describe a conversation. They do not establish a platform identity, permission or provider binding.
export const academyTrackingShape={
 leadSource:academyLeadSourceSchema.optional(),conversationChannel:academyConversationChannelSchema.optional(),
 confirmedPhone:reviewedPhone.optional(),
};
export const academyAdminFieldsSchema=z.object({stage:z.string().trim().min(1).max(120),
 nextAction:z.string().max(500).nullable(),followUpDate:z.string().refine(dateOnly).nullable(),
 notes:z.string().max(5000),...academyTrackingShape}).strict();
export const academyManualFieldsSchema=z.object({name:z.string().trim().min(1).max(120),
 language:z.enum(["en","he"]),relationship:z.enum(["guardian","adult_partner"]),phone:reviewedPhone.nullable(),email,...academyAdminFieldsSchema.shape}).strict()
 .refine(value=>value.confirmedPhone===undefined)
 .refine(value=>hasEndpoint(value)||value.notes.trim().length>0,
  {message:"A manual contact without a confirmed phone or email needs a conversation note",path:["notes"]});

/** A name is only a collision warning for provisional leads. Never merge identities by name. */
export function provisionalNameConflict(a:{name:string;phone:string|null;email:string|null},
 b:{name:string;phone:string|null;email:string|null}):boolean {
 const normalize=(name:string)=>name.normalize("NFKC").trim().replace(/\s+/g," ").toLowerCase();
 return (!hasEndpoint(a)||!hasEndpoint(b))&&normalize(a.name)===normalize(b.name);
}
const command={operationId:uuid,expectedEpoch:academyEpoch};
export const academyCrmCommandSchema=z.discriminatedUnion("action",[
 z.object({action:z.literal("create"),...command,fields:academyManualFieldsSchema}).strict(),
 z.object({action:z.literal("from_inquiry"),...command,sourceApplicationId:uuid,sourceDigest:digest,
  fields:academyAdminFieldsSchema}).strict(),
 z.object({action:z.literal("update"),...command,personId:uuid,
  expectedVersion:z.number().int().min(1).max(2147483645),fields:academyAdminFieldsSchema}).strict(),
 z.object({action:z.literal("note"),...command,personId:uuid,
  expectedVersion:z.number().int().min(1).max(2147483645),text:z.string().trim().min(1).max(5000)}).strict(),
]);
export type AcademyCrmCommand=z.infer<typeof academyCrmCommandSchema>;
export const academyCrmResultSchema=z.object({personId:uuid,version:z.number().int().min(1),
 operationId:uuid,authorityEpoch:academyEpoch,replayed:z.boolean(),outboundEligible:z.literal(false)}).strict();
export type AcademyCrmResult=z.infer<typeof academyCrmResultSchema>;
export const academyActivitySchema=z.object({operationId:uuid,kind:z.enum(["created","updated","note"]),
 recordedAt:z.iso.datetime(),recordedBy:uuid,text:z.string().max(5000),
 result:academyCrmResultSchema,fields:academyAdminFieldsSchema.optional()}).strict();
export type AcademyActivity=z.infer<typeof academyActivitySchema>;
export type AcademyContact={personId:string;name:string;version:number;origin:AcademyContactOrigin;
 fields:z.infer<typeof academyAdminFieldsSchema>;outboundEligible:false};
export type AcademyCrmPage={state:"ready";authorityEpoch:number;items:AcademyContact[];total:number;page:number;pageSize:number}|
 {state:"setup_required";authorityEpoch:number};
