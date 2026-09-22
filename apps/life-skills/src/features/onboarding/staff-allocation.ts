import type { ReceiptAllocation, ReceiptStore } from '../payments/provider-types.ts';

interface AuditedReceiptStore extends ReceiptStore {
  recordStaffAllocationAudit(input:{eventKey:string;transactionId:string;orderId:string;actorId:string;auditRecordId:string}):Promise<void>;
}
/** Private staff allocation of an already authenticated receipt. No name/email/amount
 * search and no account grant. An upstream staff authorization adapter is required. */
export async function allocateVerifiedReceipt(input:{eventKey:string;orderId:string;auditRecordId:string}, deps:{store:AuditedReceiptStore;authorize?:()=>Promise<{actorId:string}|undefined>}){
  const principal=await deps.authorize?.();
  if(!principal?.actorId?.trim() || !input.auditRecordId?.trim()) throw new Error('staff_authorization_required');
  return deps.store.withReceiptLock(input.eventKey,async()=>{
    const receipt=await deps.store.findByEventKey(input.eventKey);
    const order=await deps.store.findOrder(input.orderId);
    const event=receipt?.event;
    const payment=event?.transactions[0];
    // Only an explicitly unmatched, single successful first-session payment can
    // be allocated. A known different order is a conflict, not a manual override.
    if(!receipt || receipt.state!=='unmatched' || event?.status!=='succeeded' || event.purpose!=='first_session' || event.transactions.length!==1
      || !payment || payment.status!=='succeeded' || payment.amountMinor!==55000 || payment.currency!=='ILS'
      || !order || order.amountMinor!==55000 || order.currency!=='ILS' || order.purpose!=='first_session'
      || (event.orderId && event.orderId!==order.orderId) || (payment.orderId && payment.orderId!==order.orderId)) throw new Error('verified_unmatched_payment_required');
    if(await deps.store.hasRefundedTransaction(payment.transactionId) || await deps.store.findAllocation(payment.transactionId) || await deps.store.findOrderAllocation(order.orderId)) throw new Error('payment_allocation_conflict');
    const allocation:ReceiptAllocation={transactionId:payment.transactionId,orderId:order.orderId,childId:order.childId,amountMinor:55000};
    await deps.store.saveAllocation(allocation);
    await deps.store.recordStaffAllocationAudit({...input,transactionId:payment.transactionId,actorId:principal.actorId});
    await deps.store.save({...receipt,state:'paid',allocations:[allocation]});
    return {state:'paid' as const,allocation};
  });
}
