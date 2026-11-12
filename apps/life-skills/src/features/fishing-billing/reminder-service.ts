import {z} from 'zod';
import {billingId,reminderPolicySchema,type FamilyOffer,type ReminderIntent,type ReminderPolicy} from './contracts.ts';
import type {BillingLedgerContext,BillingScope,BillingOutboxReservation} from './native.ts';
import type {DispatchPermission} from './reminders.ts';
import type {BillingCurrentReminderServiceAuthorityV3} from '../../lib/fishing-billing-current-ledger-v3.ts';

export const REMINDER_SERVICE_VERSION='JLFA-FISHING-REMINDER-SERVICE-v1' as const;
export const reminderServiceBindingSchema=z.object({
 version:z.literal(REMINDER_SERVICE_VERSION),mode:z.literal('test'),
 serviceBindingId:z.string().min(1).max(160),outboxBindingId:z.string().min(1).max(160),
}).strict();
export type ReminderServiceBinding=z.infer<typeof reminderServiceBindingSchema>;
export const reminderBatchCommandSchema=z.object({limit:z.number().int().min(1).max(50)}).strict();
export const reminderPlanningCommandSchema=z.object({quoteId:billingId}).strict();
export const reminderServicePlanSchema=z.object({policy:reminderPolicySchema,guardianId:billingId,channel:z.enum(['email','whatsapp'])}).strict();
export type ReminderServicePlan=z.infer<typeof reminderServicePlanSchema>;
export type ReminderServiceAudience=Pick<ReminderIntent,'quoteId'|'familyId'|'guardianId'|'channel'>;
export const reminderOutcomeLookupSchema=z.object({intentId:billingId,dispatchId:billingId}).strict();
export const serviceDispatchPermissionSchema=z.object({
 audience:z.object({guardianId:billingId,channel:z.enum(['email','whatsapp']),audience:z.literal('individual'),locale:z.enum(['en','he']),
  verified:z.boolean(),consented:z.boolean(),active:z.boolean()}).strict(),
 sendWindowOpen:z.boolean(),ownerEnabled:z.boolean(),policyCurrent:z.boolean(),
}).strict();
export const verifiedReminderOutcomeSchema=z.object({
 intentId:billingId,dispatchId:billingId,guardianId:billingId,channel:z.enum(['email','whatsapp']),
 outboxBindingId:z.string().min(1).max(160),sourceReceiptId:z.string().min(1).max(200),
 state:z.enum(['provider_accepted','delivered','failed']),providerId:z.string().min(1).max(200).nullable(),
}).strict().refine(x=>x.state==='failed'||x.providerId!==null,'PROVIDER_ID_REQUIRED');
export type VerifiedReminderOutcome=z.infer<typeof verifiedReminderOutcomeSchema>;

/** Root resolves its current service policy and native program/family/guardian
 * authority in this exact transaction. This is constructor-owned server code,
 * never an Actor, captured owner session, HTTP claim or default allow. Scope
 * null first authorizes the bounded workspace operation; each selected reserve
 * or outcome is then authorized again with its actual family and guardian.
 * Outcome authorization must permit actual late facts after paid/cancel/pause,
 * without treating revoked send consent or a closed window as a new send. */
export interface BillingReminderServiceAuthority{
 authorize(context:BillingLedgerContext,binding:ReminderServiceBinding,operation:'scan'|'plan'|'reserve'|'outcome',scope:BillingScope|null,audience:ReminderServiceAudience|null):Promise<void>;
 /** Resolve actual current approved policy and native guardian preference. Null
  * means unavailable; no default price/due/offset/channel/audience is supplied. */
 plan(context:BillingLedgerContext,binding:ReminderServiceBinding,quote:FamilyOffer):Promise<ReminderServicePlan|null>;
 permission(context:BillingLedgerContext,binding:ReminderServiceBinding,quote:FamilyOffer,policy:ReminderPolicy,audience:ReminderServiceAudience):Promise<DispatchPermission>;
}
export type BillingReminderServiceConfiguration={binding:ReminderServiceBinding;authority:BillingReminderServiceAuthority};
/** Additive current-source binding. Missing configuration denies; it never
 * selects the legacy FamilyOffer permission callback for a guest successor. */
export type BillingCurrentReminderServiceConfigurationV3={binding:ReminderServiceBinding;authority:BillingCurrentReminderServiceAuthorityV3};
export type ReminderOutboxPayload=Parameters<BillingOutboxReservation['reserve']>[1];
/** Additional methods on the SAME existing outbox binding. Reserve must write
 * only in context.tx; no transport. Read must return its actually verified
 * original-dispatch fact, including binding/recipient/channel, or null. Missing
 * methods deny service work; the owner-Actor reservation is never a fallback. */
export interface BillingReminderServiceOutbox{
 reserveService(context:BillingLedgerContext,binding:ReminderServiceBinding,payload:ReminderOutboxPayload):Promise<void>;
 readServiceOutcome(context:BillingLedgerContext,binding:ReminderServiceBinding,lookup:z.infer<typeof reminderOutcomeLookupSchema>):Promise<VerifiedReminderOutcome|null>;
}
export type ReminderBatchResult={
 version:typeof REMINDER_SERVICE_VERSION;scanned:number;moreDue:boolean;
 results:({intentId:string;state:'reserved';dispatchId:string;remainingMinor:number}|
  {intentId:string;state:'suppressed'|'deferred'|'blocked_unknown';reason:string})[];
};
