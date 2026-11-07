import {z} from 'zod';

/** Client-safe validation only; these DTOs never authenticate a caller.
 * Route composition must use the existing session, CSRF and error envelope. */
export const BILLING_DTO_VERSION = 'JLFA-FISHING-BILLING-DTO-v1' as const;
export const billingId = z.string().uuid();
export const billingInstant = z.string().datetime({offset:true});
export const billingAmount = z.number().int().min(0).max(100_000_000);
const positiveAmount = billingAmount.refine(n=>n>0);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const sourceReferenceSchema = z.object({id:z.string().min(1).max(200),sha256:digest}).strict();
export const policyKeys = ['service_period','proration','renewal','cancellation','weather','payment_due'] as const;
export const policyKeySchema = z.enum(policyKeys);
export const policyReferencesSchema = z.object({
 service_period:sourceReferenceSchema.nullable(),proration:sourceReferenceSchema.nullable(),
 renewal:sourceReferenceSchema.nullable(),cancellation:sourceReferenceSchema.nullable(),
 weather:sourceReferenceSchema.nullable(),payment_due:sourceReferenceSchema.nullable(),
}).strict();
export const servicePeriodSchema = z.object({
 id:billingId,startsAt:billingInstant,endsAt:billingInstant,timeZone:z.literal('America/New_York'),
}).strict().refine(p=>Date.parse(p.endsAt)>Date.parse(p.startsAt),{message:'PERIOD_ORDER'});
export const publishedOfferSchema = z.object({
 version:z.literal(BILLING_DTO_VERSION),id:billingId,programKey:z.literal('fishing_monthly_club'),
 environment:z.literal('test'),currency:z.literal('USD'),unitAmountMinor:positiveAmount,
 effectiveAt:billingInstant,publishedAt:billingInstant,publishedBy:billingId,
 source:sourceReferenceSchema,terms:sourceReferenceSchema,policies:policyReferencesSchema,
}).strict();
export type PublishedOffer = z.infer<typeof publishedOfferSchema>;
export const quoteLineSchema = z.object({
 id:billingId,childId:billingId,period:servicePeriodSchema,groupId:billingId.nullable(),
 amountMinor:billingAmount,dueAt:billingInstant.nullable(),
}).strict();
export const familyOfferSchema = z.object({
 version:z.literal(BILLING_DTO_VERSION),id:billingId,workspaceId:billingId,familyId:billingId,
 revision:z.number().int().positive(),state:z.enum(['draft','issued','accepted','cancelled']),
 definition:publishedOfferSchema,lines:z.array(quoteLineSchema).min(1).max(10),
 createdAt:billingInstant,issuedAt:billingInstant.nullable(),
 override:z.object({reason:z.string().trim().min(1).max(500),actorId:billingId}).strict().nullable(),
 acceptance:z.object({
  actorId:billingId,acceptedAt:billingInstant,terms:sourceReferenceSchema,quoteRevision:z.number().int().positive(),
 }).strict().nullable(),paused:z.boolean(),
}).strict().superRefine((q,c)=>{
 const fail=(message:string)=>c.addIssue({code:'custom',message});
 if(new Set(q.lines.map(l=>l.id)).size!==q.lines.length ||
    new Set(q.lines.map(l=>l.childId+':'+l.period.id)).size!==q.lines.length)fail('DUPLICATE_LINE');
 if((q.state==='accepted')&&!q.acceptance)fail('ACCEPTANCE_REQUIRED');
 if(q.state==='issued'&&(!q.issuedAt||q.acceptance))fail('ISSUE_HISTORY');
 if(q.acceptance&&q.acceptance.quoteRevision>=q.revision)fail('ACCEPTED_REVISION');
 if(Date.parse(q.createdAt)<Date.parse(q.definition.publishedAt)||Date.parse(q.createdAt)<Date.parse(q.definition.effectiveAt))fail('OFFER_CHRONOLOGY');
 if(!q.override&&q.lines.some(l=>l.amountMinor!==q.definition.unitAmountMinor))fail('OVERRIDE_REQUIRED');
 if(q.acceptance&&(q.acceptance.terms.id!==q.definition.terms.id||q.acceptance.terms.sha256!==q.definition.terms.sha256))fail('TERMS_MISMATCH');
 if(q.state==='draft'&&(q.acceptance||q.issuedAt))fail('DRAFT_HISTORY');
 if(q.acceptance&&(!q.issuedAt||Date.parse(q.acceptance.acceptedAt)<Date.parse(q.issuedAt)))fail('ACCEPTANCE_CHRONOLOGY');
});
export type FamilyOffer = z.infer<typeof familyOfferSchema>;
export const allocationSchema = z.object({lineId:billingId,amountMinor:positiveAmount}).strict();
export const ledgerReceiptSchema = z.object({
 id:billingId,operationId:billingId,quoteId:billingId,familyId:billingId,currency:z.literal('USD'),
 kind:z.enum(['cash','card','cash_reversal','refund','dispute']),amountMinor:positiveAmount,
 allocations:z.array(allocationSchema).max(10),originalReceiptId:billingId.nullable(),
 actorId:billingId.nullable(),receivedAt:billingInstant,recordedAt:billingInstant,
 reason:z.string().trim().min(1).max(500).nullable(),
 provider:z.object({accountId:z.string().regex(/^acct_[A-Za-z0-9]+$/),mode:z.literal('test'),transactionId:z.string().min(1).max(160)}).strict().nullable(),
}).strict().superRefine((r,c)=>{
 const fail=(message:string)=>c.addIssue({code:'custom',message});
 if(new Set(r.allocations.map(a=>a.lineId)).size!==r.allocations.length)fail('DUPLICATE_ALLOCATION');
 if(r.allocations.reduce((s,a)=>s+a.amountMinor,0)>r.amountMinor)fail('ALLOCATION_TOTAL');
 const isReturn=['cash_reversal','refund','dispute'].includes(r.kind);
 if(isReturn !== (r.originalReceiptId!==null))fail('ORIGINAL_RECEIPT');
 if(isReturn&&!r.reason)fail('CORRECTION_REASON');
 if(['cash','cash_reversal'].includes(r.kind)?(!r.actorId||r.provider!==null):(!r.provider||r.actorId!==null))fail('RECEIPT_PROVENANCE');
 if(Date.parse(r.receivedAt)>Date.parse(r.recordedAt))fail('RECEIVED_IN_FUTURE');
});
export type LedgerReceipt = z.infer<typeof ledgerReceiptSchema>;
export const balanceLineSchema = z.object({
 lineId:billingId,childId:billingId,period:servicePeriodSchema,groupId:billingId.nullable(),
 quotedMinor:billingAmount,dueMinor:billingAmount,paidMinor:z.number().int().min(0),
 remainingMinor:z.number().int().min(0),excessMinor:z.number().int().min(0),dueAt:billingInstant.nullable(),
}).strict();
export const reminderStateSchema=z.enum(['queued','unknown','provider_accepted','delivered','suppressed','failed']);
export const balanceSchema=z.object({
 version:z.literal(BILLING_DTO_VERSION),quoteId:billingId,familyId:billingId,revision:z.number().int().positive(),
 state:z.enum(['no_debt','unpaid','partial','paid','overpaid','review_required']),
 lines:z.array(balanceLineSchema),quotedMinor:z.number().int().min(0),dueMinor:z.number().int().min(0),
 paidMinor:z.number().int().min(0),remainingMinor:z.number().int().min(0),excessMinor:z.number().int().min(0),
 unallocatedMinor:z.number().int().min(0),pendingAttemptIds:z.array(billingId),receipts:z.array(ledgerReceiptSchema),
 paused:z.boolean(),cancelled:z.boolean(),collection:z.literal('test_only'),
 missingPolicy:z.array(policyKeySchema),reminders:z.array(z.object({id:billingId,state:reminderStateSchema}).strict()),
}).strict();
export type BillingBalance=z.infer<typeof balanceSchema>;
export const commandSchema=z.object({operationId:billingId,expectedVersion:z.number().int().positive()}).strict();
export const cashCommandSchema=commandSchema.extend({
 quoteId:billingId,amountMinor:positiveAmount,currency:z.literal('USD'),
 receivedAt:billingInstant,allocations:z.array(allocationSchema).min(1).max(10),
}).strict();
export const reversalCommandSchema=commandSchema.extend({
 quoteId:billingId,originalReceiptId:billingId,amountMinor:positiveAmount,
 allocations:z.array(allocationSchema).max(10),reason:z.string().trim().min(1).max(500),
}).strict();
export const acceptanceCommandSchema=commandSchema.extend({
 quoteId:billingId,terms:sourceReferenceSchema,acknowledged:z.literal(true),
}).strict();
export const createFamilyOfferSchema=z.object({
 operationId:billingId,id:billingId,familyId:billingId,definitionId:billingId,
 children:z.array(z.object({
  lineId:billingId,childId:billingId,period:servicePeriodSchema,groupId:billingId.nullable(),dueAt:billingInstant.nullable(),
 }).strict()).min(1).max(10),
 override:z.object({
  reason:z.string().trim().min(1).max(500),
  amounts:z.array(z.object({lineId:billingId,amountMinor:billingAmount}).strict()).min(1).max(10),
 }).strict().nullable(),
}).strict();
export type CreateFamilyOffer=z.infer<typeof createFamilyOfferSchema>;
export const operationReceiptSchema=z.object({
 version:z.literal(BILLING_DTO_VERSION),operationId:billingId,entityId:billingId,
 entityVersion:z.number().int().positive(),replayed:z.boolean(),
 result:z.object({quote:familyOfferSchema,balance:balanceSchema,receiptId:billingId.nullable()}).strict(),
}).strict();
export type BillingOperationReceipt=z.infer<typeof operationReceiptSchema>;
export const billingUnavailableSchema=z.object({
 version:z.literal(BILLING_DTO_VERSION),state:z.literal('unavailable'),reason:z.enum(['policy_not_ready','provider_unavailable','not_integrated']),
 missingPolicy:z.array(policyKeySchema),
}).strict();
export const reminderPolicySchema=z.object({
 id:z.string().min(1).max(200),revision:z.number().int().positive(),
 source:sourceReferenceSchema,timeZone:z.literal('America/New_York'),
 offsetsMinutes:z.array(z.number().int().min(-43200).max(43200)).min(1).max(30),
}).strict().refine(p=>new Set(p.offsetsMinutes).size===p.offsetsMinutes.length);
export type ReminderPolicy=z.infer<typeof reminderPolicySchema>;
export const reminderIntentSchema=z.object({
 version:z.literal(BILLING_DTO_VERSION),id:billingId,key:z.string().min(1).max(1000),
 quoteId:billingId,familyId:billingId,guardianId:billingId,
 channel:z.enum(['email','whatsapp']),audience:z.literal('individual'),locale:z.enum(['en','he']),
 policyId:z.string().min(1).max(200),policyRevision:z.number().int().positive(),
 sequence:z.number().int().min(0),dueAt:billingInstant,scheduledAt:billingInstant,
 state:reminderStateSchema,dispatchId:billingId.nullable(),providerId:z.string().min(1).max(200).nullable(),
 reason:z.string().max(100).nullable(),
}).strict();
export type ReminderIntent=z.infer<typeof reminderIntentSchema>;

