import {z} from 'zod';
import {BILLING_DTO_VERSION,billingId,billingInstant,familyOfferSchema,publishedOfferSchema,quoteLineSchema,sourceReferenceSchema,policyKeys} from '../features/fishing-billing/contracts.ts';
import {balanceV2Schema} from '../features/fishing-billing/contracts-v2.ts';

/** Validation/data contracts only. Neither IDs, hashes, a typed name nor a
 * parsed grant authenticate a person or approve terms. The native resolver
 * must freshly authorize every action and verify the actual displayed bytes.
 * Existing V1/V2 account-based schemas and stored records remain unchanged. */
export const BILLING_GUEST_V3='JLFA-FISHING-BILLING-GUEST-v3' as const;
const sha=z.string().regex(/^[a-f0-9]{64}$/),positive=z.number().int().positive();
const token=z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const equalRef=(a:{id:string;sha256:string},b:{id:string;sha256:string})=>a.id===b.id&&a.sha256===b.sha256;
export const guestIssuedMaterialSchema=z.object({
 workspaceId:billingId,familyId:billingId,quoteId:billingId,issuedRevision:positive,
 definition:publishedOfferSchema,lines:z.array(quoteLineSchema).min(1).max(10),
 createdAt:billingInstant,issuedAt:billingInstant,override:familyOfferSchema.shape.override,
}).strict().superRefine((m,c)=>{
 const fail=(message:string)=>c.addIssue({code:'custom',message});
 if(new Set(m.lines.map(l=>l.id)).size!==m.lines.length||new Set(m.lines.map(l=>l.childId+':'+l.period.id)).size!==m.lines.length)fail('DUPLICATE_LINE');
 if(Date.parse(m.createdAt)<Date.parse(m.definition.publishedAt)||Date.parse(m.createdAt)<Date.parse(m.definition.effectiveAt)||Date.parse(m.issuedAt)<Date.parse(m.createdAt))fail('MATERIAL_CHRONOLOGY');
 if(!m.override&&m.lines.some(l=>l.amountMinor!==m.definition.unitAmountMinor))fail('OVERRIDE_REQUIRED');
});
export const guestOfferBindingSchema=z.object({material:guestIssuedMaterialSchema,sha256:sha}).strict();
export type GuestOfferBinding=z.infer<typeof guestOfferBindingSchema>;
export const guestDisplayBundleSchema=z.object({
 id:billingId,version:z.string().min(1).max(200),sha256:sha,locale:z.enum(['en','he']),offerSnapshotSha256:sha,
 documents:z.array(z.object({
  purpose:z.enum(['financial_terms','privacy_for_completion']),source:sourceReferenceSchema,
  displayedTextSha256:sha,releaseEvidenceId:billingId,
 }).strict()).min(1).max(2),
}).strict().refine(b=>new Set(b.documents.map(d=>d.purpose)).size===b.documents.length,'DUPLICATE_DOCUMENT_PURPOSE');
export const guestFinancialBundleSchema=guestDisplayBundleSchema.refine(b=>b.documents.some(d=>d.purpose==='financial_terms'),'FINANCIAL_DOCUMENT_REQUIRED');
export const guestCompletionBundleSchema=guestDisplayBundleSchema.refine(b=>b.documents.some(d=>d.purpose==='privacy_for_completion'),'COMPLETION_PRIVACY_REQUIRED');
export type GuestDisplayBundle=z.infer<typeof guestDisplayBundleSchema>;
export const guestParentStatementSchema=z.object({
 submittedName:z.string().trim().min(1).max(160),guardianAuthorityAttested:z.literal(true),financialTermsAffirmed:z.literal(true),
 statementSha256:sha,privateEvidenceId:billingId,
}).strict();
export const guestFinancialAcceptanceSchema=z.object({
 version:z.literal(BILLING_GUEST_V3),id:billingId,kind:z.literal('guest_grant'),grantId:billingId,
 offer:guestOfferBindingSchema,displayed:guestFinancialBundleSchema,parent:guestParentStatementSchema,
 assuranceEvidenceId:billingId,operationId:billingId,acceptedAt:billingInstant,
}).strict().superRefine((a,c)=>{
 const terms=a.displayed.documents.find(d=>d.purpose==='financial_terms');
 if(!terms||!equalRef(terms.source,a.offer.material.definition.terms))c.addIssue({code:'custom',message:'FINANCIAL_TERMS_MISMATCH'});
 if(a.displayed.offerSnapshotSha256!==a.offer.sha256)c.addIssue({code:'custom',message:'DISPLAY_OFFER_MISMATCH'});
 if(Date.parse(a.acceptedAt)<Date.parse(a.offer.material.issuedAt))c.addIssue({code:'custom',message:'ACCEPTANCE_CHRONOLOGY'});
 if(policyKeys.some(k=>a.offer.material.definition.policies[k]===null)||a.offer.material.lines.some(l=>l.dueAt===null))c.addIssue({code:'custom',message:'FINANCIAL_POLICY_NOT_READY'});
});
export type GuestFinancialAcceptance=z.infer<typeof guestFinancialAcceptanceSchema>;
/** Explicit successor quote. No account actorId exists on guest acceptance;
 * no cast, placeholder account, accepted/null or legacy rewrite is permitted. */
export const guestFamilyOfferSchema=z.object({
 ...familyOfferSchema.shape,version:z.literal(BILLING_GUEST_V3),acceptance:guestFinancialAcceptanceSchema.nullable(),
}).strict().superRefine((q,c)=>{
 const fail=(message:string)=>c.addIssue({code:'custom',message});
 if(new Set(q.lines.map(l=>l.id)).size!==q.lines.length||new Set(q.lines.map(l=>l.childId+':'+l.period.id)).size!==q.lines.length)fail('DUPLICATE_LINE');
 if(q.state==='accepted'&&!q.acceptance)fail('ACCEPTANCE_REQUIRED');
 if(q.state==='draft'&&(q.acceptance||q.issuedAt))fail('DRAFT_HISTORY');
 if(q.state==='issued'&&(!q.issuedAt||q.acceptance))fail('ISSUE_HISTORY');
 if(Date.parse(q.createdAt)<Date.parse(q.definition.publishedAt)||Date.parse(q.createdAt)<Date.parse(q.definition.effectiveAt)||q.issuedAt&&Date.parse(q.issuedAt)<Date.parse(q.createdAt))fail('OFFER_CHRONOLOGY');
 if(!q.override&&q.lines.some(l=>l.amountMinor!==q.definition.unitAmountMinor))fail('OVERRIDE_REQUIRED');
 if(q.acceptance){
  const a=q.acceptance,m=a.offer.material;
  if(m.issuedRevision>=q.revision)fail('ACCEPTED_REVISION');
  if(q.id!==m.quoteId||q.familyId!==m.familyId||q.workspaceId!==m.workspaceId||q.createdAt!==m.createdAt||q.issuedAt!==m.issuedAt||JSON.stringify(q.definition)!==JSON.stringify(m.definition)||JSON.stringify(q.lines)!==JSON.stringify(m.lines)||JSON.stringify(q.override)!==JSON.stringify(m.override))fail('ACCEPTED_MATERIAL_CHANGED');
 }
});
export type GuestFamilyOffer=z.infer<typeof guestFamilyOfferSchema>;
/** Persisted SERVER grant shape, never an authority-bearing browser DTO.
 * Actual token is digest-only at rest; expiry/assurance/recipient policy has no
 * default. Exchange/GET is not acceptance. Runtime resolution must additionally
 * authenticate metadata, current native relationship, expiry and revocation. */
export const guestGrantRecordSchema=z.object({
 version:z.literal(BILLING_GUEST_V3),id:billingId,action:z.enum(['submit_private_completion','accept_financial_offer']),
 offer:guestOfferBindingSchema,displayBundle:guestDisplayBundleSchema,recipientBindingEvidenceId:billingId,
 admissionPolicy:sourceReferenceSchema,tokenDigest:sha,issuedAt:billingInstant,expiresAt:billingInstant,
 issuedByAccountId:billingId,
}).strict().superRefine((g,c)=>{
 const fail=(message:string)=>c.addIssue({code:'custom',message});
 if(Date.parse(g.expiresAt)<=Date.parse(g.issuedAt)||Date.parse(g.issuedAt)<Date.parse(g.offer.material.issuedAt))fail('GRANT_CHRONOLOGY');
 if(g.displayBundle.offerSnapshotSha256!==g.offer.sha256)fail('GRANT_DISPLAY_MISMATCH');
 const schema=g.action==='accept_financial_offer'?guestFinancialBundleSchema:guestCompletionBundleSchema;
 if(!schema.safeParse(g.displayBundle).success)fail('WRONG_DOCUMENT_PURPOSE');
 if(g.action==='accept_financial_offer'&&!g.displayBundle.documents.some(d=>d.purpose==='financial_terms'&&equalRef(d.source,g.offer.material.definition.terms)))fail('GRANT_TERMS_MISMATCH');
});
export type GuestGrantRecord=z.infer<typeof guestGrantRecordSchema>;
export const guestAcceptCommandSchema=z.object({
 operationId:billingId,expectedVersion:positive,displayBundleId:billingId,displayBundleSha256:sha,displayChallenge:token,
 parent:z.object({submittedName:guestParentStatementSchema.shape.submittedName,guardianAuthorityAttested:z.literal(true),financialTermsAffirmed:z.literal(true)}).strict(),
}).strict();
/** Separate principal/purpose and data shape: completion cannot affirm financial
 * terms, mark a child signed, create an account or authorize participation. */
export const guestCompletionCommandSchema=z.object({
 operationId:billingId,displayBundleId:billingId,displayBundleSha256:sha,displayChallenge:token,
 privateSubmissionEvidenceId:billingId,
}).strict();
export const guestAcceptanceReceiptSchema=z.object({
 version:z.literal(BILLING_GUEST_V3),operationId:billingId,acceptanceId:billingId,quoteId:billingId,
 acceptedRevision:positive,acceptedAt:billingInstant,replayed:z.boolean(),paymentStateAtAcceptance:z.literal('unpaid'),
}).strict();
export const guestCompletionReceiptSchema=z.object({
 version:z.literal(BILLING_GUEST_V3),operationId:billingId,id:billingId,recordedAt:billingInstant,replayed:z.boolean(),financialAcceptanceId:z.null(),
}).strict();
/** Common provenance projection, not a lossy V1 conversion or new ledger.
 * Original account quote/terms evidence stays explicit; a guest basis contains
 * its actual guest evidence. Native readers must validate and authorize the
 * original stored source version before using this as a payable basis. */
export const guestPayableBasisSchema=z.object({
 version:z.literal(BILLING_GUEST_V3),workspaceId:billingId,familyId:billingId,quoteId:billingId,
 offer:guestOfferBindingSchema,obligationLineIds:z.array(billingId).min(1).max(10),
 acceptance:z.discriminatedUnion('kind',[
  z.object({kind:z.literal('historical_account'),quoteSourceVersion:z.literal(BILLING_DTO_VERSION),originalQuoteSha256:sha,
   actorAccountId:billingId,acceptedAt:billingInstant,quoteRevision:positive,terms:sourceReferenceSchema,
  }).strict(),
  z.object({kind:z.literal('guest_successor'),evidence:guestFinancialAcceptanceSchema}).strict(),
 ]),
}).strict().superRefine((b,c)=>{
 const fail=(message:string)=>c.addIssue({code:'custom',message}),m=b.offer.material;
 if(b.workspaceId!==m.workspaceId||b.familyId!==m.familyId||b.quoteId!==m.quoteId)fail('BASIS_SCOPE');
 if(new Set(b.obligationLineIds).size!==b.obligationLineIds.length||JSON.stringify(b.obligationLineIds)!==JSON.stringify(m.lines.map(l=>l.id)))fail('BASIS_OBLIGATIONS');
 if(b.acceptance.kind==='guest_successor'){
  if(JSON.stringify(b.acceptance.evidence.offer)!==JSON.stringify(b.offer))fail('BASIS_GUEST_OFFER');
 }else if(b.acceptance.quoteRevision!==m.issuedRevision||!equalRef(b.acceptance.terms,m.definition.terms)||Date.parse(b.acceptance.acceptedAt)<Date.parse(m.issuedAt))fail('BASIS_ACCOUNT_PROVENANCE');
});
export type GuestPayableBasis=z.infer<typeof guestPayableBasisSchema>;
/** New guest read version retains the existing mixed date/instant receipt
 * schemas; it never labels a guest quote as V1 or mutates old receipt payloads. */
export const guestBalanceV3Schema=balanceV2Schema.extend({version:z.literal(BILLING_GUEST_V3)});
export const guestOwnerSnapshotV3Schema=z.object({quote:guestFamilyOfferSchema,balance:guestBalanceV3Schema,receiptId:billingId.nullable()}).strict().superRefine((s,c)=>{
 const q=s.quote,b=s.balance,fail=()=>c.addIssue({code:'custom',message:'CURRENT_GUEST_SNAPSHOT_SCOPE'});
 if(q.id!==b.quoteId||q.familyId!==b.familyId||q.revision!==b.revision||q.paused!==b.paused||(q.state==='cancelled')!==b.cancelled||q.lines.length!==b.lines.length||new Set(b.lines.map(l=>l.lineId)).size!==b.lines.length)fail();
 for(const line of b.lines){
  const original=q.lines.find(l=>l.id===line.lineId);
  if(!original||original.childId!==line.childId||JSON.stringify(original.period)!==JSON.stringify(line.period)||original.groupId!==line.groupId||original.amountMinor!==line.quotedMinor||original.dueAt!==line.dueAt)fail();
 }
 const lineIds=new Set(q.lines.map(l=>l.id)),receiptIds=new Set(b.receipts.map(r=>r.id));
 if(receiptIds.size!==b.receipts.length||s.receiptId!==null&&!receiptIds.has(s.receiptId))fail();
 for(const receipt of b.receipts){
  if(receipt.quoteId!==q.id||receipt.familyId!==q.familyId||receipt.allocations.some(a=>!lineIds.has(a.lineId))||receipt.originalReceiptId!==null&&!receiptIds.has(receipt.originalReceiptId))fail();
 }
});
export type GuestBalanceV3=z.infer<typeof guestBalanceV3Schema>;
export type GuestOwnerSnapshotV3=z.infer<typeof guestOwnerSnapshotV3Schema>;
