import {z} from 'zod';
import {academyOwnerEnrollmentBindingSchema} from './academy-enrollment-contract.ts';
import type {FamilyHostedAction,FamilyPaymentView} from '../fishing-payments/domain.ts';
import type {AcademyOfferSummary} from './academy-offer-contract.ts';
export const academyBillingVersion='JLFA-ACADEMY-BILLING-20261020-01' as const;
export const academyBillingQuerySchema=z.discriminatedUnion('view',[
 z.strictObject({view:z.literal('owner'),applicationId:z.uuid(),learnerIndex:z.string().regex(/^[0-9]$/).transform(Number),stageId:z.uuid()}),
 z.strictObject({view:z.literal('parent'),learnerId:z.uuid(),stageId:z.uuid().optional()})
]);
export type AcademyBillingQuery=z.infer<typeof academyBillingQuerySchema>;
export const academyBillingCommandSchema=z.strictObject({version:z.literal(academyBillingVersion),action:z.literal('issue'),operationId:z.uuid(),binding:academyOwnerEnrollmentBindingSchema,learnerIndex:z.number().int().min(0).max(9),stageId:z.uuid(),offerId:z.uuid(),expectedOfferRevision:z.literal(1)});
export type AcademyBillingCommand=z.infer<typeof academyBillingCommandSchema>;
type Shared={payments:FamilyPaymentView[];actions:FamilyHostedAction[];links:'ready'|'not_admitted'|'review_required';checkout?:'ready'|'not_admitted'};
export type AcademyBillingContext={state:'not_ready'}|({state:'ready';role:'parent';learnerId:string;stageId:string|null;groups:{stageId:string;label:string}[]}&Shared)|({state:'ready';role:'practitioner';binding:z.infer<typeof academyOwnerEnrollmentBindingSchema>;learnerIndex:number;stageId:string;offer:AcademyOfferSummary|null;issuance:'ready'|'not_admitted'}&Shared);
