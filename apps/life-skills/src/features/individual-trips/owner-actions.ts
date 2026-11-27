import { randomUUID } from 'node:crypto';
import { AppError } from '../../lib/errors.ts';
import type { Actor } from '../identity/types.ts';
import type { TripCommand } from './contract.ts';
import type { IndividualTripStore } from './store.ts';
import type { OwnerTripAction } from './http.ts';
import { verifyInvoiceBinding,type TripInvoiceProvider } from './invoice-provider.ts';
import { one } from '../identity/store.ts';
import { freshActor,lockWorkspace } from '../identity/data.ts';
import { blindEmail,unseal } from '../identity/crypto.ts';

/** Browser owner attestation is accepted for manual delivery and actual cash.
 * Provider-derived money/status is accepted only from this read-only port. */
export class IndividualTripOwnerActions {
 constructor(private readonly trips:IndividualTripStore,private readonly provider:TripInvoiceProvider|null){}
 async execute(actor:Actor,input:OwnerTripAction):Promise<unknown>{
  if(actor.id!==this.trips.config.ownerAccountId||actor.role!=='practitioner')throw new AppError('NOT_FOUND');
  let state=await this.trips.read(actor);
  if(input.action==='manual_delivery')return this.trips.recordManualDelivery(actor,{type:'delivery.record_sent',operationId:input.operationId,expectedRevision:input.expectedRevision,offerId:input.offerId,sentAt:input.sentAt,...(input.shortNoticeDeadline?{shortNoticeDeadline:input.shortNoticeDeadline}:{})},input.reference);
  if(!this.provider)throw new AppError('UNAVAILABLE');
  if(state.revision!==input.expectedRevision)throw new AppError('CONFLICT');
  const offer=state.offers.find(o=>o.id===input.offerId);if(!offer)throw new AppError('NOT_FOUND');
  const invoiceId=input.action==='attach_invoice'?input.invoiceId:offer.invoice?.id;if(!invoiceId)throw new AppError('INVALID_REQUEST');
  const invoice=await this.provider.lookup(invoiceId);
  verifyInvoiceBinding(invoice,offer,this.trips.config.workspaceId);
  if(input.action==='attach_invoice'){
   const customerEmail=await this.trips.database.transaction(async tx=>{
   await lockWorkspace(tx,this.trips.identity.workspaceId);await freshActor(tx,actor,this.trips.clock.now());
   const household=state.households.find(h=>h.id===offer.householdId);if(!household)throw new AppError('NOT_FOUND');
   const parent=await one<{email:string}>(tx,`SELECT a.email_ciphertext AS email FROM ls_identity.accounts a JOIN ls_individual_trips.memberships m ON m.workspace_id=a.workspace_id AND m.account_id=a.id WHERE a.workspace_id=$1 AND a.id=$2 AND a.role='parent' AND a.state='active' AND a.email_verified_at IS NOT NULL AND m.household_id=$3 AND m.state='active'`,[actor.workspaceId,household.ownerAccountId,household.id]);
   if(!parent)throw new AppError('NOT_FOUND');return unseal(parent.email,`email:${actor.workspaceId}:${household.ownerAccountId}`,this.trips.identity.keyring);
   });
   if(invoice.customer_email.trim().toLowerCase()!==customerEmail.trim().toLowerCase())throw new AppError('FORBIDDEN');
   if(invoice.status!=='open'||invoice.amount_paid!==0||!invoice.hosted_invoice_url)throw new AppError('CONFLICT');
   return this.trips.execute(actor,{type:'invoice.attach',operationId:input.operationId,expectedRevision:input.expectedRevision,offerId:offer.id,invoiceId:invoice.id,url:invoice.hosted_invoice_url,amountMinor:invoice.amount_due,customerId:invoice.customer,customerEmailBlind:blindEmail(invoice.customer_email,this.trips.identity.lookupKey)});
  }
  // Reconciliation stays bound to the finalized invoice, including after a
  // legitimate native account-email change. It grants no new household access.
  if(offer.invoice!.customerId!==invoice.customer||offer.invoice!.customerEmailBlind!==blindEmail(invoice.customer_email,this.trips.identity.lookupKey))throw new AppError('FORBIDDEN');
  if(invoice.amount_due!==offer.invoice!.amountMinor)throw new AppError('CONFLICT');
  const verified=invoice.payments.filter(p=>p.status==='paid'&&p.payment.type==='payment_intent');
  const verifiedTotal=verified.reduce((sum,p)=>sum+(p.amount_paid??0),0);
  // Unknown/new payment types never become new cash or Stripe receipts. The
  // provider's off-Stripe total must map to an existing exact cash receipt.
  if(verifiedTotal+invoice.amount_paid_off_stripe!==invoice.amount_paid)throw new AppError('CONFLICT');
  const commands:Omit<TripCommand,'operationId'|'expectedRevision'>[]=[];
  for(const payment of verified){
   if(!payment.amount_paid||!payment.status_transitions.paid_at||!payment.payment.payment_intent)throw new AppError('CONFLICT');
   commands.push({type:'payment.record_verified',offerId:offer.id,invoiceId:invoice.id,paymentKey:'stripe:'+payment.id,providerEventId:'lookup:'+payment.id,amountMinor:payment.amount_paid,receivedAt:new Date(payment.status_transitions.paid_at*1000).toISOString()} as Omit<TripCommand,'operationId'|'expectedRevision'>);
  }
  if(invoice.amount_paid_off_stripe>0){
   const ids=input.cashReceiptIds??(input.cashReceiptId?[input.cashReceiptId]:[]);
   if(input.cashReceiptIds&&input.cashReceiptId||new Set(ids).size!==ids.length)throw new AppError('INVALID_REQUEST');
   const receipts=ids.map(id=>state.receipts.find(r=>r.id===id&&r.source==='cash'&&r.offerId===offer.id));
   if(receipts.some(r=>!r)||receipts.reduce((sum,r)=>sum+(r?.amountMinor??0),0)!==invoice.amount_paid_off_stripe)throw new AppError('CONFLICT');
   for(const cash of receipts)commands.push({type:'payment.link_cash_out_of_band',offerId:offer.id,invoiceId:invoice.id,cashReceiptId:cash!.id,providerEventId:'lookup:'+invoice.id+':outside:'+cash!.id,amountMinor:cash!.amountMinor} as Omit<TripCommand,'operationId'|'expectedRevision'>);
  }
  for(const command of commands){
   await this.trips.executeInternal(actor,{...command,operationId:randomUUID(),expectedRevision:state.revision});state=await this.trips.read(actor);
  }
  if(['paid','void','uncollectible'].includes(invoice.status))return this.trips.executeInternal(actor,{type:'invoice.reconcile_closed',offerId:offer.id,invoiceId:invoice.id,status:invoice.status,allPaymentsReconciled:true,operationId:input.operationId,expectedRevision:state.revision});
  return{status:invoice.status,revision:state.revision,reconciledPayments:commands.length};
 }
}
