import {z} from 'zod';
import {academyOwnerEnrollmentBindingSchema} from './academy-enrollment-contract.ts';
export const academyOfferVersion='JLFA-OWNER-OFFER-20261020-01' as const;
const uuid=z.uuid(),sha=z.string().regex(/^[a-f0-9]{64}$/),base={version:z.literal(academyOfferVersion),operationId:uuid,binding:academyOwnerEnrollmentBindingSchema,learnerIndex:z.number().int().min(0).max(9),stageId:uuid};
export const academyOfferCommandSchema=z.discriminatedUnion('action',[
 z.strictObject({...base,action:z.literal('prepare'),expectedPreparationSha256:sha,holdCommandId:uuid,approvalCommandId:uuid,mode:z.enum(['prepay','installments']),expiresAt:z.iso.datetime({offset:true}),dueAt:z.array(z.iso.datetime({offset:true})).min(1).max(3)}).refine(v=>new Set([v.operationId,v.holdCommandId,v.approvalCommandId]).size===3&&v.dueAt.length===(v.mode==='prepay'?1:3)&&v.dueAt.every((date,i)=>i===0||Date.parse(date)>Date.parse(v.dueAt[i-1]!))),
 z.strictObject({...base,action:z.literal('withdraw'),offerId:uuid,reason:z.string().trim().min(1).max(1200)})
]);
export type AcademyOfferCommand=z.infer<typeof academyOfferCommandSchema>;
export type AcademyOfferSummary={id:string;state:'prepared'|'expired'|'issued';mode:'prepay'|'installments';currency:'USD';totalCents:number;expiresAt:string;dues:{dueAt:string;amountCents:number}[]};
export type AcademyOfferNativeContext={stageId:string;label:string;preparationSha256:string|null;blocked:'fit_required'|'terms_required'|'policy_required'|'plan_required'|'already_enrolled'|null;offer:AcademyOfferSummary|null;withdrawals:{offerId:string;reason:string;recordedAt:string}[];moreWithdrawals:boolean};
export type AcademyOfferContext={state:'not_ready'}|{state:'ready';binding:z.infer<typeof academyOwnerEnrollmentBindingSchema>;learnerIndex:number;childName:string;native:AcademyOfferNativeContext};
