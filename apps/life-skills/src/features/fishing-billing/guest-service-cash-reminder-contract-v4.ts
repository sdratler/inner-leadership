import {z} from 'zod';
import {billingId,reminderPolicySchema,reminderIntentSchema,type ReminderIntent} from './contracts.ts';
import {BILLING_SERVICE_V4} from './guest-service-contract-v4.ts';
import type {BillingLedgerContext} from './native.ts';
import type {ServiceOwnerSnapshotV4} from './guest-service-owner-financial-contract-v4.ts';
import type {DispatchPermission} from './reminders.ts';
import type {ReminderServiceBinding,ReminderServiceAudience} from './reminder-service.ts';

/** Cash-due FIRST. Hold notices, failed-charge clocks and pre-renewal
 * information are different lifecycle purposes, not manufactured cash debt. */
export const serviceCashReminderPolicyV4Schema=z.object({version:z.literal(BILLING_SERVICE_V4),purpose:z.literal('cash_due'),
 policy:reminderPolicySchema.refine(p=>p.offsetsMinutes.length<=2&&p.offsetsMinutes.every(n=>n>0),'BOUNDED_CASH_DUE_OFFSETS_REQUIRED'),
}).strict();
export type ServiceCashReminderPolicyV4=z.infer<typeof serviceCashReminderPolicyV4Schema>;
export const serviceCashReminderPlanV4Schema=z.object({version:z.literal(BILLING_SERVICE_V4),purpose:z.literal('cash_due'),guardianId:billingId,
 channels:z.array(z.enum(['email','whatsapp'])).min(1).max(2).refine(v=>v.includes('email')&&new Set(v).size===v.length,'EMAIL_DEFAULT_INDIVIDUAL_WA_ADDITIONAL'),
 policy:serviceCashReminderPolicyV4Schema,
}).strict();
export type ServiceCashReminderPlanV4=z.infer<typeof serviceCashReminderPlanV4Schema>;
export const serviceCashReminderPlanningV4Schema=z.object({version:z.literal(BILLING_SERVICE_V4),quoteId:billingId}).strict();
export type ServiceCashReminderScopeV4=Readonly<{programKey:'fishing_monthly_club';quoteId:string;familyId:string;childIds:readonly string[];offerSha256:string}>;
export type ServiceCashReminderReservationV4=Readonly<{snapshot:ServiceOwnerSnapshotV4;intent:ReminderIntent;policy:ServiceCashReminderPolicyV4;dispatchId:string}>;
/** Constructor-owned independent service. No owner Actor, captured login or
 * parsed policy/reference becomes permission. All decisions use context.tx.
 * Actual cash-choice, current guardian/consent/locale, policy, group/full/optout
 * and Florida/Shabbos windows must be checked, never defaulted from acceptance.
 * Outcome authorization permits genuine late original facts without new send. */
export interface ServiceCashReminderAuthorityV4{
 authorize(c:Readonly<BillingLedgerContext>,binding:Readonly<ReminderServiceBinding>,operation:'scan'|'plan'|'reserve'|'outcome',scope:ServiceCashReminderScopeV4|null,audience:ReminderServiceAudience|null):Promise<void>;
 plan(c:Readonly<BillingLedgerContext>,binding:Readonly<ReminderServiceBinding>,snapshot:ServiceOwnerSnapshotV4):Promise<ServiceCashReminderPlanV4|null>;
 permission(c:Readonly<BillingLedgerContext>,binding:Readonly<ReminderServiceBinding>,snapshot:ServiceOwnerSnapshotV4,policy:ServiceCashReminderPolicyV4,audience:ReminderServiceAudience):Promise<DispatchPermission>;
 /** ONE joint read-only actual native decision for ALL newly reserved rows,
  * in exact order, after every other awaited native guard/read/write. It must
  * pin service, current V4 quote/acceptance/cash-choice/money/state/family,
  * guardian/channel/locale/policy/window and UNKNOWN intent/SAME outbox through
  * commit. Cached flags or sequential saved permission arrays are not evidence.
  * Native only validates synchronously and returns after this call. */
 terminalReservationPermissions(c:Readonly<BillingLedgerContext>,binding:Readonly<ReminderServiceBinding>,reservations:readonly ServiceCashReminderReservationV4[]):Promise<readonly DispatchPermission[]>;
}
/** Shared durable intent envelope remains V1; quote/acceptance/current balance
 * stay explicitly V4. Purpose/version form part of the immutable intent key. */
export function serviceCashReminderKeyV4(i:Pick<ReminderIntent,'quoteId'|'guardianId'|'channel'|'policyId'|'policyRevision'|'dueAt'|'sequence'>){return [BILLING_SERVICE_V4,'cash_due',i.quoteId,i.guardianId,i.channel,i.policyId,i.policyRevision,new Date(i.dueAt).toISOString(),i.sequence].join('|');}
export function validateServiceCashReminderV4(intent:unknown,policy:unknown){
 const i=reminderIntentSchema.parse(intent),p=serviceCashReminderPolicyV4Schema.parse(policy);
 if(i.policyId!==p.policy.id||i.policyRevision!==p.policy.revision||i.sequence>=p.policy.offsetsMinutes.length||i.key!==serviceCashReminderKeyV4(i)||Date.parse(i.scheduledAt)!==Date.parse(i.dueAt)+p.policy.offsetsMinutes[i.sequence]!*60000)throw new Error('CASH_REMINDER_INTEGRITY');
 return {intent:i,policy:p};
}
