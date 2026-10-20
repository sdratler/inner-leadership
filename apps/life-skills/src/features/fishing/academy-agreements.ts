import {createHash} from 'node:crypto';
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
export const agreementHash=(text:string)=>createHash('sha256').update(text,'utf8').digest('hex');
export function readAcademyAgreementBundle(raw:unknown):AcademyAgreementBundle|null{
 const parsed=academyAgreementBundleSchema.safeParse(raw);if(!parsed.success)return null;const b=parsed.data;
 if([b.legalOperator,...b.releasedParties].some(v=>/\b(TBD|TODO|placeholder|name of released|synthetic)\b|[<>\[\]]/i.test(v)))return null;
 if(b.statutoryWarning!==b.statutoryWarning.toUpperCase()||!b.statutoryWarning.startsWith('NOTICE TO THE MINOR CHILD')||!b.releasedParties.every(v=>b.statutoryWarning.includes(v.toUpperCase())))return null;
 if(new Set(b.documents.map(d=>d.kind+':'+d.language)).size!==10||b.documents.some(d=>agreementHash(d.body)!==d.sha256))return null;
 return b;
}
export function verifyAcademyAgreementAcceptance(bundle:AcademyAgreementBundle,raw:unknown){
 const b=readAcademyAgreementBundle(bundle),a=academyAgreementAcceptanceSchema.parse(raw);if(!b||a.bundleVersion!==b.version)throw Error('AGREEMENT_REVIEW_REQUIRED');
 const expected=b.documents.filter(d=>d.language===a.language);
 if(new Set(a.documentRefs.map(d=>d.kind)).size!==5||expected.some(d=>!a.documentRefs.some(v=>v.kind===d.kind&&v.version===d.version&&v.sha256===d.sha256)))throw Error('AGREEMENT_REVIEW_REQUIRED');
 return a;
}
/** New source hashes cover both the displayed contract and all translations,
 * versions, identities and review references. Legacy body hashes stay readable. */
export function academyTermsHash(terms:{document?:{body:string}|undefined;owner03Bundle?:AcademyAgreementBundle|undefined}){
 return terms.owner03Bundle?agreementHash(JSON.stringify({body:terms.document?.body??'',bundle:terms.owner03Bundle})):agreementHash(terms.document?.body??'');
}
