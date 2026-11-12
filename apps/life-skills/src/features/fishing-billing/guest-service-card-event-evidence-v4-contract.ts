import {z} from 'zod';
import {billingId} from './contracts.ts';
import {CARD_VERSION,type CardAttempt} from './card-contracts.ts';
import type {BillingStripeSignedReceipt} from './stripe-test.ts';
import type {ServiceBalanceV4} from './guest-service-owner-financial-contract-v4.ts';

export const SERVICE_CARD_EVENT_EVIDENCE_V4='JLFA-FISHING-SERVICE-CARD-EVENT-EVIDENCE-v4' as const;
export const serviceCardEventEvidenceQueryV4Schema=z.object({quoteId:billingId,attemptId:billingId,
 eventId:z.string().regex(/^evt_[A-Za-z0-9_]{1,150}$/)}).strict();
export type ServiceCardEventEvidenceQueryV4=z.infer<typeof serviceCardEventEvidenceQueryV4Schema>;
/** Read-only decoder of the EXISTING card-event-processor processing record.
 * It stores neither a historical payment status nor a failure/processing time.
 * This is not a producer, new storage format, policy or failure-clock resolver. */
export const storedCardProcessingEvidenceV4Schema=z.object({
 version:z.literal(CARD_VERSION),workspaceId:billingId,accountId:z.string(),eventId:z.string(),digest:z.string(),
 quoteId:billingId,attemptId:billingId,review:z.boolean(),receiptIds:z.array(billingId),reason:z.string().nullable(),
}).strict();
export type StoredCardProcessingEvidenceV4=z.infer<typeof storedCardProcessingEvidenceV4Schema>;
export type ServiceCardEventEvidenceV4=Readonly<{
 version:typeof SERVICE_CARD_EVENT_EVIDENCE_V4;query:ServiceCardEventEvidenceQueryV4;observedAt:string;
}&({state:'unresolved';reason:'missing_or_unlinked'|'event_review_required'|'unsupported_event_family'|'event_time_unproven'|'event_object_unproven';evidence:null}|
 {state:'committed';evidence:{
  provenance:'original_stored_receipt_and_committed_native_processing';
  scope:{workspaceId:string;programKey:'fishing_monthly_club';familyId:string;quoteId:string;attemptId:string;acceptanceId:string;offerSha256:string;
   children:{lineId:string;childId:string;periodId:string;startsAt:string;endsAt:string;timeZone:'America/New_York';groupId:string|null;selectedMinor:number}[]};
  original:{receipt:BillingStripeSignedReceipt;eventTimePrecision:'provider_event_second';processing:StoredCardProcessingEvidenceV4;
   receivedAt:string;receivedAtPrecision:'database_millisecond';
   receiptCiphertextSha256:string;processingCiphertextSha256:string;requestCiphertextSha256:string};
  current:{attemptCiphertextSha256:string;quoteRevision:number;quoteState:'draft'|'issued'|'accepted'|'cancelled';paused:boolean;balance:ServiceBalanceV4;
   attempt:Pick<CardAttempt,'id'|'revision'|'balanceVersion'|'state'|'dispatchId'|'sessionId'|'paymentIntentId'|'createdAt'>;
   processingReceiptIds:string[];objectSettlementReceiptId:string|null};
 }})>;
