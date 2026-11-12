import {z} from 'zod';
import {billingId,billingInstant,sourceReferenceSchema} from './contracts.ts';
import {BILLING_SERVICE_V4,serviceMaterialPreviewV4Schema,serviceFamilyOfferV4Schema} from './guest-service-contract-v4.ts';
/** Client-safe DTOs only; none authenticate or admit issuance. */
export const SERVICE_OWNER_ISSUE_ACTION_V4='issue_service_offer_v4' as const;
const sha=z.string().regex(/^[a-f0-9]{64}$/);
export const serviceOwnerIssueCommandV4Schema=z.object({version:z.literal(BILLING_SERVICE_V4),action:z.literal(SERVICE_OWNER_ISSUE_ACTION_V4),operationId:billingId,
 quoteId:billingId,expectedQuoteRevision:z.number().int().positive().max(2147483646),expectedDraftSha256:sha,locale:z.enum(['en','he']),material:serviceMaterialPreviewV4Schema,
}).strict().refine(c=>c.quoteId===c.material.plan.quoteId&&c.expectedQuoteRevision===c.material.plan.expectedQuoteRevision,'ISSUE_BASIS_SCOPE');
export type ServiceOwnerIssueCommandV4=z.infer<typeof serviceOwnerIssueCommandV4Schema>;
export const serviceIssueEvidenceV4Schema=z.object({version:z.literal(BILLING_SERVICE_V4),workspaceId:billingId,actorId:billingId,quoteId:billingId,familyId:billingId,
 materialSha256:sha,locale:z.enum(['en','he']),recipientBindingEvidenceId:billingId,guardianAssuranceEvidenceId:billingId,financialTermsReleaseEvidenceId:billingId,
 admissionPolicy:sourceReferenceSchema,capacityEvidence:sourceReferenceSchema,
}).strict();
export type ServiceIssueEvidenceV4=z.infer<typeof serviceIssueEvidenceV4Schema>;
export const serviceOwnerIssueReceiptV4Schema=z.object({version:z.literal(BILLING_SERVICE_V4),action:z.literal(SERVICE_OWNER_ISSUE_ACTION_V4),workspaceId:billingId,actorId:billingId,operationId:billingId,
 quote:serviceFamilyOfferV4Schema,evidence:serviceIssueEvidenceV4Schema,issuedAt:billingInstant,replayed:z.boolean(),
 financialState:z.literal('unaccepted'),offerHoldClock:z.literal('awaiting_known_successful_send'),
}).strict();
export type ServiceOwnerIssueReceiptV4=z.infer<typeof serviceOwnerIssueReceiptV4Schema>;
