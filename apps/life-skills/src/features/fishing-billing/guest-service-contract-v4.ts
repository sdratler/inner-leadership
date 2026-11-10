import {z} from 'zod';
import {billingId,billingInstant,sourceReferenceSchema} from './contracts.ts';
import {guestFamilyOfferSchema,guestIssuedMaterialSchema} from '../../lib/fishing-billing-guest-contract-v3.ts';
import {servicePlanSnapshotV1Schema} from './service-plan-contract-v1.ts';

/** NEW prospective protocol only. Parsing, hashes, typed names or checked
 * boxes supply no native guardian/recipient/legal/provider/seat authority.
 * No V3 grant, signature, token or evidence is accepted as a V4 record. */
export const BILLING_SERVICE_V4='JLFA-FISHING-BILLING-SERVICE-v4' as const;
export const SERVICE_FINANCIAL_ACTION_V4='accept_service_financial_offer_v4' as const;
const sha=z.string().regex(/^[a-f0-9]{64}$/),revision=z.number().int().positive().max(2147483647);
const refs=z.object({cancellation:sourceReferenceSchema,weather:sourceReferenceSchema,renewal:sourceReferenceSchema,servicePeriod:sourceReferenceSchema}).strict();
export const servicePolicyV4Schema=z.discriminatedUnion('kind',[
 refs.extend({kind:z.literal('selected_650_product_policy'),rulesVersion:z.literal('JLFA-OWNER-FULLSTACK-PACKAGE-20261110-01'),
  preAttendanceNoticeHours:z.literal(24),preAttendanceRetentionMinor:z.literal(10000),oneLessonBeforeTripRetentionTotalMinor:z.literal(20000),
  afterLessonAndTrip:z.literal('no_refund_subject_to_mandatory_rights'),retentionBasis:z.literal('actual_paid_child_period_only'),
  absenceNoticeHours:z.literal(24),absenceCredit:z.literal('affected_activity_subject_to_capacity'),weatherOutcome:z.literal('preserve_undelivered_without_second_fee'),
  unspecifiedCase:z.literal('owner_review_no_invented_penalty'),
 }).strict(),
 refs.extend({kind:z.literal('custom_terms_document'),refundDisposition:z.literal('owner_review_under_exact_released_terms')}).strict(),
]);
export type ServicePolicyV4=z.infer<typeof servicePolicyV4Schema>;
export const serviceScheduleBindingV4Schema=z.object({snapshot:servicePlanSnapshotV1Schema,sourceDigest:sha}).strict();
const draftBasis=guestFamilyOfferSchema.refine(q=>q.state==='draft'&&q.acceptance===null&&q.issuedAt===null,'UNISSUED_NATIVE_BASIS_REQUIRED');
export const serviceFinancialDraftV4Schema=z.object({version:z.literal(BILLING_SERVICE_V4),kind:z.literal('prospective_service_financial_draft'),
 basis:draftBasis,schedule:serviceScheduleBindingV4Schema,policy:servicePolicyV4Schema,
}).strict();
export type ServiceFinancialDraftV4=z.infer<typeof serviceFinancialDraftV4Schema>;
export const serviceIssuedMaterialV4Schema=z.object({version:z.literal(BILLING_SERVICE_V4),kind:z.literal('issued_service_financial_material'),
 financial:guestIssuedMaterialSchema,schedule:serviceScheduleBindingV4Schema,policy:servicePolicyV4Schema,
}).strict();
export type ServiceIssuedMaterialV4=z.infer<typeof serviceIssuedMaterialV4Schema>;
export const serviceOfferBindingV4Schema=z.object({material:serviceIssuedMaterialV4Schema,sha256:sha}).strict();
export type ServiceOfferBindingV4=z.infer<typeof serviceOfferBindingV4Schema>;
export const serviceDraftBindingV4Schema=z.object({material:serviceFinancialDraftV4Schema,sha256:sha}).strict();
const document=z.object({source:sourceReferenceSchema,displayedTextSha256:sha,releaseEvidenceId:billingId}).strict();
export const serviceDisplayBundleV4Schema=z.object({version:z.literal(BILLING_SERVICE_V4),action:z.literal(SERVICE_FINANCIAL_ACTION_V4),
 id:billingId,sha256:sha,locale:z.enum(['en','he']),offerSnapshotSha256:sha,serviceSnapshotSha256:sha,
 financialTerms:document,
}).strict();
export const serviceRecurringChoiceV4Schema=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('one_time_only')}).strict(),
 z.object({kind:z.literal('separate_affirmative_card_authorization'),statementSha256:sha,
  lines:z.array(z.object({lineId:billingId,childId:billingId,periodId:billingId,amountMinor:z.number().int().positive().max(100000000),currency:z.literal('USD'),
   firstPeriodStartsAt:billingInstant,nextRenewalAt:billingInstant,
  }).strict()).min(1).max(10),amountTimingCancellationAffirmed:z.literal(true),
 }).strict(),
]);
export const serviceAcceptCommandV4Schema=z.object({version:z.literal(BILLING_SERVICE_V4),action:z.literal(SERVICE_FINANCIAL_ACTION_V4),operationId:billingId,
 expectedQuoteRevision:revision,offerSnapshotSha256:sha,displayBundleId:billingId,displayBundleSha256:sha,displayChallenge:z.string().regex(/^[A-Za-z0-9_-]{43}$/),
 parent:z.object({submittedName:z.string().trim().min(1).max(160),guardianAuthorityAttested:z.literal(true),financialTermsAffirmed:z.literal(true),serviceScheduleAffirmed:z.literal(true)}).strict(),
 recurring:serviceRecurringChoiceV4Schema,
}).strict();
export type ServiceAcceptCommandV4=z.infer<typeof serviceAcceptCommandV4Schema>;
const statementText=z.string().min(1).max(4000).refine(v=>v.trim().length>0);
export const servicePresentationV4Schema=z.object({version:z.literal(BILLING_SERVICE_V4),action:z.literal(SERVICE_FINANCIAL_ACTION_V4),grantId:billingId,
 displayBundleId:billingId,displayBundleSha256:sha,locale:z.enum(['en','he']),evidenceId:billingId,
 affirmation:z.object({version:z.string().min(1).max(200),guardianAuthorityText:statementText,financialTermsText:statementText,serviceScheduleText:statementText}).strict(),
}).strict();
export const serviceRecurringPresentationV4Schema=z.object({version:z.literal(BILLING_SERVICE_V4),purpose:z.literal('separate_recurring_card_authorization'),
 grantId:billingId,displayBundleId:billingId,displayBundleSha256:sha,locale:z.enum(['en','he']),evidenceId:billingId,
 textVersion:z.string().min(1).max(200),amountTimingCancellationText:statementText,
}).strict();
export const serviceGrantRecordV4Schema=z.object({version:z.literal(BILLING_SERVICE_V4),materialVersion:z.literal(BILLING_SERVICE_V4),action:z.literal(SERVICE_FINANCIAL_ACTION_V4),id:billingId,
 offer:serviceOfferBindingV4Schema,displayBundle:serviceDisplayBundleV4Schema,recipientBindingEvidenceId:billingId,admissionPolicy:sourceReferenceSchema,
 tokenDigest:sha,issuedAt:billingInstant,expiresAt:billingInstant,issuedByAccountId:billingId,
}).strict().superRefine((g,c)=>{
 if(Date.parse(g.expiresAt)<=Date.parse(g.issuedAt)||Date.parse(g.issuedAt)<Date.parse(g.offer.material.financial.issuedAt)||
  g.displayBundle.offerSnapshotSha256!==g.offer.sha256)c.addIssue({code:'custom',message:'SERVICE_GRANT_SCOPE_OR_TIME'});
});
export type ServiceGrantRecordV4=z.infer<typeof serviceGrantRecordV4Schema>;
export const serviceFinancialAcceptanceV4Schema=z.object({version:z.literal(BILLING_SERVICE_V4),kind:z.literal('service_guest_grant'),action:z.literal(SERVICE_FINANCIAL_ACTION_V4),id:billingId,grantId:billingId,
 offer:serviceOfferBindingV4Schema,displayed:serviceDisplayBundleV4Schema,parent:serviceAcceptCommandV4Schema.shape.parent.extend({statementSha256:sha,privateEvidenceId:billingId}).strict(),
 assuranceEvidenceId:billingId,operationId:billingId,acceptedAt:billingInstant,recurring:serviceRecurringChoiceV4Schema,recurringPrivateEvidenceId:billingId.nullable(),
}).strict().superRefine((a,c)=>{
 if(a.parent.privateEvidenceId!==a.id||a.displayed.offerSnapshotSha256!==a.offer.sha256||Date.parse(a.acceptedAt)<Date.parse(a.offer.material.financial.issuedAt)||
  (a.recurring.kind==='one_time_only')!==(a.recurringPrivateEvidenceId===null))c.addIssue({code:'custom',message:'SERVICE_ACCEPTANCE_SCOPE_OR_TIME'});
});
export type ServiceFinancialAcceptanceV4=z.infer<typeof serviceFinancialAcceptanceV4Schema>;
