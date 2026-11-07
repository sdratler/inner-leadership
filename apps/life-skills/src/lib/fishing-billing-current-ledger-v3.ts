import 'server-only';
import {AppError} from './errors.ts';
import {familyOfferSchema,type LedgerReceipt,type ReminderPolicy} from '../features/fishing-billing/contracts.ts';
import {projectBalanceV2,type LedgerReceiptV2} from '../features/fishing-billing/contracts-v2.ts';
import {projectGuestBalanceV3} from '../features/fishing-billing/guest-domain-v3.ts';
import {cardExceptionSchema} from '../features/fishing-billing/card-contracts.ts';
import {BILLING_GUEST_V3,guestPayableBasisSchema} from './fishing-billing-guest-contract-v3.ts';
import {verifyGuestFamilyOffer,verifyGuestPayableBasis,projectHistoricalAccountPayableBasis} from './fishing-billing-guest-material-v3.ts';
import {BILLING_CURRENT_LEDGER_V3,currentLedgerSourceV3Schema,currentLedgerFrameV3Schema,type CurrentLedgerSourceV3,type CurrentLedgerFrameV3} from './fishing-billing-current-contract-v3.ts';
import type {Actor,AccountFacts} from '../features/identity/types.ts';
import type {BillingLedgerContext,BillingContext,BillingAuthority,BillingFinancialServiceAuthority} from '../features/fishing-billing/native.ts';
import type {BillingStripeBinding} from '../features/fishing-billing/card-binding.ts';
import type {DispatchPermission} from '../features/fishing-billing/reminders.ts';
import type {BillingReminderServiceAuthority,ReminderServiceBinding,ReminderServicePlan,ReminderServiceAudience} from '../features/fishing-billing/reminder-service.ts';

/** Server projection after the native decoder authenticated the actual source,
 * original acceptance/evidence, complete money/status records and current
 * authority in ONE transaction. These pure arguments never confer access. */
export function projectBillingCurrentLedgerV3(input:{
 source:CurrentLedgerSourceV3;receipts:readonly LedgerReceiptV2[];exceptions:readonly ReturnType<typeof cardExceptionSchema.parse>[];pendingAttemptIds?:string[];
 reminders?:CurrentLedgerFrameV3['balance']['reminders'];originalAccountSnapshot?:unknown;
}):CurrentLedgerFrameV3{
 const source=currentLedgerSourceV3Schema.parse(input.source),q=source.quote,receipts=[...input.receipts],pending=[...(input.pendingAttemptIds??[])],reminders=input.reminders??[];
 if(receipts.length>1000||pending.length>1000||reminders.length>1000||!Array.isArray(input.exceptions)||input.exceptions.length>1000)throw new AppError('UNAVAILABLE');
 const exceptions=input.exceptions.map(e=>cardExceptionSchema.parse(e));
 if(new Set(exceptions.map(e=>e.id)).size!==exceptions.length||exceptions.some(e=>e.workspaceId!==q.workspaceId||e.quoteId!==q.id||e.familyId!==q.familyId||e.snapshot.quoteId!==q.id))throw new AppError('UNAVAILABLE');
 let payableBasis:CurrentLedgerFrameV3['payableBasis']=null;
 if(source.kind==='guest_successor'){
  if(input.originalAccountSnapshot!==undefined)throw new AppError('UNAVAILABLE');
  const guest=verifyGuestFamilyOffer(source.quote),a=guest.acceptance;
  if(a)payableBasis=verifyGuestPayableBasis(guestPayableBasisSchema.parse({version:BILLING_GUEST_V3,workspaceId:q.workspaceId,familyId:q.familyId,quoteId:q.id,offer:a.offer,obligationLineIds:q.lines.map(l=>l.id),acceptance:{kind:'guest_successor',evidence:a}}));
 }else if(q.acceptance){
  const original=familyOfferSchema.parse(input.originalAccountSnapshot),a=original.acceptance;
  if(!a||original.state!=='accepted'||original.revision!==a.quoteRevision+1||original.revision>q.revision||original.id!==q.id||original.workspaceId!==q.workspaceId||original.familyId!==q.familyId||JSON.stringify([original.createdAt,original.issuedAt,original.definition,original.lines,original.override,original.acceptance])!==JSON.stringify([q.createdAt,q.issuedAt,q.definition,q.lines,q.override,q.acceptance]))throw new AppError('UNAVAILABLE');
  payableBasis=verifyGuestPayableBasis(projectHistoricalAccountPayableBasis(original),original);
 }else if(input.originalAccountSnapshot!==undefined)throw new AppError('UNAVAILABLE');
 const balance=source.kind==='historical_account'?projectBalanceV2(source.quote,receipts,pending):projectGuestBalanceV3(source.quote,receipts,pending);
 if(exceptions.some(e=>e.state==='open'))balance.state='review_required';
 return currentLedgerFrameV3Schema.parse({version:BILLING_CURRENT_LEDGER_V3,source,payableBasis,balance:{...balance,reminders},cardExceptions:exceptions.map(e=>({id:e.id,state:e.state}))});
}

/** Prospective trusted Native ports. No implementation, fallback store, SQL,
 * provider call or runtime is installed here. The existing Native writer must
 * preserve original source/AAD, current auth/evidence and a single CAS/rollback
 * boundary. advance is once-only, updates the SAME quote and ledger, suppresses
 * queued reminders, retains UNKNOWN, then returns freshly projected current.
 * No provider/network call is allowed inside this transaction callback. */
export type BillingCurrentCardLedgerV3={
 context:Readonly<BillingLedgerContext>;frame:CurrentLedgerFrameV3;
 advance(receipts?:readonly LedgerReceipt[]):Promise<CurrentLedgerFrameV3>;
};
export interface BillingCurrentCardLedgerAccessV3{
 withCurrentCardActorV3<T>(actor:Actor,quoteId:string,work:(ledger:BillingCurrentCardLedgerV3&{actor:AccountFacts})=>Promise<T>):Promise<T>;
 withCurrentCardServiceV3<T>(binding:BillingStripeBinding,quoteId:string,work:(ledger:BillingCurrentCardLedgerV3)=>Promise<T>):Promise<T>;
}
export type BillingCurrentFinancialServiceAuthorityV3=BillingFinancialServiceAuthority;
/** The same current permission/policy/locale/audience resolution, with explicit
 * quote provenance instead of falsely relabelling a guest as an account. No
 * send defaults or new outbox; existing BillingReminderServiceOutbox stays. */
export interface BillingCurrentOwnerAuthorityV3 extends Pick<BillingAuthority,'authorize'>{
 reminderPermission(context:BillingContext,frame:CurrentLedgerFrameV3,policy:ReminderPolicy,guardianId:string,channel:'email'|'whatsapp'):Promise<DispatchPermission>;
}
export interface BillingCurrentReminderServiceAuthorityV3 extends Pick<BillingReminderServiceAuthority,'authorize'>{
 plan(context:BillingLedgerContext,binding:ReminderServiceBinding,frame:CurrentLedgerFrameV3):Promise<ReminderServicePlan|null>;
 permission(context:BillingLedgerContext,binding:ReminderServiceBinding,frame:CurrentLedgerFrameV3,policy:ReminderPolicy,audience:ReminderServiceAudience):Promise<DispatchPermission>;
}
