/** Browser-safe agreement schemas; hashing and source verification remain server-side. */
import {z} from 'zod';
export const academyAgreementDecision='JLFA-OWNER-20261020-REFUND-SAFETY-03' as const;
const text=z.string().trim().min(1).max(20000),ref=z.string().trim().min(1).max(160),sha=z.string().regex(/^[a-f0-9]{64}$/);
export const agreementKinds=['participation_safety','program','privacy','payment_cancellation','child_conduct'] as const;
const documentSchema=z.strictObject({kind:z.enum(agreementKinds),version:ref,language:z.enum(['en','he']),body:text,sha256:sha});
/** An importer must supply actual final documents and review references. No
 * public API can create this source record or turn a draft into approval. */
export const academyAgreementBundleSchema=z.strictObject({decision:z.literal(academyAgreementDecision),status:z.literal('final_owner_approved'),version:ref,legalOperator:ref,releasedParties:z.array(ref).min(1).max(20),statutoryWarning:text,reviewReference:ref,childPrivacyReviewReference:ref,unresolvedMaterialTerms:z.array(ref).length(0),documents:z.array(documentSchema).length(10)});
export type AcademyAgreementBundle=z.infer<typeof academyAgreementBundleSchema>;
export const academyAgreementAcceptanceSchema=z.strictObject({language:z.enum(['en','he']),bundleVersion:ref,parentAccepted:z.literal(true),parentSignature:z.string().trim().min(1).max(160),childAcknowledged:z.literal(true),guardianWitnessed:z.literal(true),documentRefs:z.array(z.strictObject({kind:z.enum(agreementKinds),version:ref,sha256:sha})).length(5)});
export type AcademyAgreementAcceptance=z.infer<typeof academyAgreementAcceptanceSchema>;
