import {academyAgreementBundleSchema,academyAgreementAcceptanceSchema} from './academy-agreements.ts';
import {z} from "zod";
import {stageReferenceSchema} from "../fishing-stage/contract.ts";
import {templateSchema} from "../fishing-stage/native-storage.ts";

const uuid=z.uuid(),version=z.string().min(1).max(120),sha=z.string().regex(/^[a-f0-9]{64}$/);
const label=z.string().min(1).max(160).refine(value=>value.trim().length>0),reason=z.string().min(1).max(1200).refine(value=>value.trim().length>0);
const command={commandId:uuid},scope=stageReferenceSchema.shape;
export const programLimits=Object.freeze({records:1000,sourceBytes:60000,occurrences:12});
export class FishingProgramError extends Error{
 constructor(readonly code:"POLICY_REQUIRED"|"APPROVAL_REQUIRED"|"CAPACITY"|"CONFLICT"|"NOT_FOUND"|"FORBIDDEN"|"INVALID_REQUEST"|"UNAVAILABLE"){super(code);this.name="FishingProgramError";}
}
/** Source imports are NOT exposed as an operator command. No missing policy
 * defaults to a selected financial threshold. These representations do not
 * adopt a choice: real imported canonical approval is independently required.
 */
export const programPolicySchema=z.strictObject({policyVersion:version,sourceVersion:version,confirmation:z.discriminatedUnion("kind",[
 z.strictObject({kind:z.literal("unselected")}),z.strictObject({kind:z.literal("all_native_dues_paid")}),
 z.strictObject({kind:z.literal("native_due_indices_paid"),indices:z.array(z.union([z.literal(1),z.literal(2),z.literal(3)])).min(1).max(3).refine(values=>new Set(values).size===values.length)})
])});
export const programTermsSchema=z.strictObject({program:z.literal("sunday_fishing_academy"),termsVersion:version,policyVersion:version,sourceVersion:version,contentSha256:sha,owner03Bundle:academyAgreementBundleSchema.optional(),document:z.strictObject({format:z.literal('plain_text'),body:z.string().min(1).max(20000).refine(v=>!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v))}).optional()});
export const cohortCommandSchema=z.strictObject({...command,...scope,label,instructorAccountId:uuid,approvedChildCapacity:z.number().int().min(1).max(1000),templateApprovalId:uuid,termsApprovalId:uuid,policyApprovalId:uuid,reason});
export const venueCommandSchema=z.strictObject({...command,id:uuid,label,address:z.string().max(1200),capacity:z.number().int().min(1).max(1000),approvalReference:z.string().min(1).max(500),reason});
export const fitCommandSchema=z.strictObject({...command,id:uuid,stageId:uuid,learnerId:uuid,purpose:z.enum(["enrollment","makeup"]),decision:z.enum(["approved","rejected"]),targetOccurrenceId:uuid.nullable(),targetRevision:z.number().int().positive().nullable(),note:reason,sourceBindingSha256:sha.optional()}).refine(value=>value.purpose==="makeup"?value.targetOccurrenceId!==null&&value.targetRevision!==null:value.targetOccurrenceId===null&&value.targetRevision===null);
export const termsCommandSchema=z.strictObject({...command,id:uuid,stageId:uuid,learnerId:uuid,householdId:uuid,sourceApprovalId:uuid,sourceSha256:sha,agreementAcceptance:academyAgreementAcceptanceSchema.optional(),sourceBindingSha256:sha.optional()});
export const monthlyBlockScopeSchema=z.strictObject({id:uuid,acceptanceId:uuid,occurrenceIds:z.array(uuid).length(4).refine(v=>new Set(v).size===4)});
export const monthlyBlockTermsCommandSchema=z.strictObject({...command,id:uuid,blockId:uuid,stageId:uuid,learnerId:uuid,householdId:uuid,sourceApprovalId:uuid,sourceSha256:sha,expectedPlanRevision:z.number().int().positive(),occurrenceIds:z.array(uuid).length(4).refine(v=>new Set(v).size===4),currency:z.literal('USD'),priceCents:z.literal(65000),purchasedLessons:z.literal(4),automaticFutureCharges:z.literal(false),agreementAcceptance:academyAgreementAcceptanceSchema});
export const holdCommandSchema=z.strictObject({...command,holdId:uuid,stageId:uuid,learnerId:uuid,householdId:uuid,payerAccountId:uuid,expectedCohortRevision:z.number().int().positive(),reason,block:monthlyBlockScopeSchema.optional()});
export const offerCommandSchema=z.strictObject({...command,id:uuid,stageId:uuid,payerAccountId:uuid,householdId:uuid,policyApprovalId:uuid,expiresAt:z.iso.datetime({offset:true}),
 lines:z.array(z.strictObject({id:uuid,learnerId:uuid,fitDecisionId:uuid,termsAcceptanceId:uuid,holdId:uuid,mode:z.enum(["prepay","installments","monthly_block"]),block:monthlyBlockScopeSchema.optional(),dueAt:z.array(z.iso.datetime({offset:true})).min(1).max(3)}).refine(v=>(v.mode==='monthly_block')===Boolean(v.block)&&(!v.block||v.block.acceptanceId===v.termsAcceptanceId))).min(1).max(20)});
export const enrollmentCommandSchema=z.strictObject({...command,id:uuid,stageId:uuid,purchaseId:uuid,fitDecisionId:uuid,termsAcceptanceId:uuid,policyApprovalId:uuid,expectedPaymentRevision:z.number().int().positive()});
export const enrollmentStateCommandSchema=z.strictObject({...command,id:uuid,expectedRevision:z.number().int().positive(),state:z.enum(["suspended","revoked"]),reason});
export const nativeProgramIntentSchema=z.strictObject({operationId:uuid,
 resources:z.array(z.strictObject({occurrenceId:uuid,expectedRevision:z.number().int().positive(),venueId:uuid})).max(12).refine(values=>new Set(values.map(value=>value.occurrenceId)).size===values.length),
 makeupFitDecisionId:uuid.nullable()});
export type NativeProgramCommandIntent=z.infer<typeof nativeProgramIntentSchema>;
export const sourcePayloadSchemas={terms:programTermsSchema,template:templateSchema,payment_condition:programPolicySchema};
export type ProgramPolicy=z.infer<typeof programPolicySchema>;
