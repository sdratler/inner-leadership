import {z} from 'zod';
import {FOUNDER_DECISION,founderPrice,type FounderStatus} from '../group-application/academy-founder-contract.ts';
import {academyMonthlyBlockScopeSchema,type AcademyOwnerEnrollmentBinding} from './academy-enrollment-contract.ts';

export const founderCommercialIntentVersion='JLFA-FOUNDER-COMMERCIAL-INTENT-20261023-01' as const;
export const founderCommercialIntentAction='academy.founder.commercial_intent.v1' as const;
const uuid=z.uuid(),sha=z.string().regex(/^[a-f0-9]{64}$/);
export const founderCommercialIntentCommandSchema=z.strictObject({
 version:z.literal(founderCommercialIntentVersion),operationId:uuid,familyId:uuid,familyRevision:z.number().int().positive(),stageId:uuid,cohortId:uuid,
 proposedFirstSession:z.iso.datetime({offset:true}),plan:z.enum(['prepay','monthly_block']),
 children:z.array(z.strictObject({registrationChildId:uuid,expectedPreparationSha256:sha,block:academyMonthlyBlockScopeSchema.optional()})).min(1).max(10),
 reviewReference:z.string().trim().min(3).max(600),
}).refine(v=>new Set(v.children.map(c=>c.registrationChildId)).size===v.children.length&&v.children.every(c=>(v.plan==='monthly_block')===Boolean(c.block)));
export type FounderCommercialIntentCommand=z.infer<typeof founderCommercialIntentCommandSchema>;
/** Server-derived current facts. Neither this type nor a request flag grants
 * financial authority. The store obtains these inside its transaction. */
export type FounderCommercialFamily={familyId:string;revision:number;allocated:boolean;status:FounderStatus;source:AcademyOwnerEnrollmentBinding;householdId:string;parentAccountId:string;children:{registrationChildId:string;learnerId:string}[]};
export const founderCommercialIntentSchema=z.strictObject({
 version:z.literal(founderCommercialIntentVersion),kind:z.literal('nonpayable_commercial_intent'),state:z.literal('review_only'),id:uuid,workspaceId:uuid,ownerId:uuid,
 familyId:uuid,familyRevision:z.number().int().positive(),snapshotSha256:sha,decision:z.literal(FOUNDER_DECISION),stageId:uuid,cohortId:uuid,
 proposedFirstSession:z.iso.datetime({offset:true}),publishedStartVerified:z.literal(false),preparedAt:z.iso.datetime(),plan:z.enum(['prepay','monthly_block']),
 householdId:uuid,parentAccountId:uuid,founderRateProposed:z.boolean(),currency:z.literal('USD'),totalCents:z.number().int().positive().max(1750000),
 children:z.array(z.strictObject({registrationChildId:uuid,learnerId:uuid,amountCents:z.number().int().positive().max(175000),position:z.enum(['primary','additional']),
  nativePreparationSha256:sha,nativeTerms:z.strictObject({sourceApprovalId:uuid,sourceSha256:sha,termsVersion:z.string().min(1).max(120),acceptanceId:uuid}),block:academyMonthlyBlockScopeSchema.optional(),
 })).min(1).max(10),
 readiness:z.strictObject({commercialTermsAccepted:z.literal(false),merchantVerified:z.literal(false),activationAdmitted:z.literal(false),payable:z.literal(false)}),
});
export type FounderCommercialIntent=z.infer<typeof founderCommercialIntentSchema>;
/** Canonical family order determines primary/additional pricing. Callers may
 * select neither the founder flag nor the ordering used by the server store. */
export function founderCommercialPrices(plan:'prepay'|'monthly_block',family:FounderCommercialFamily){
 const ids=family.children.map(c=>c.registrationChildId),learners=family.children.map(c=>c.learnerId);
 if(!ids.length||ids.length>10||new Set(ids).size!==ids.length||new Set(learners).size!==learners.length)throw Error('INVALID_NATIVE_FAMILY_MAPPING');
 return family.children.map((c,i)=>({...c,position:i===0?'primary' as const:'additional' as const,amountCents:founderPrice(plan,family.allocated,i>0)*100}));
}
