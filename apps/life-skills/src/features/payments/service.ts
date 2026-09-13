import { AppError } from '../../lib/errors.ts';
import type { Actor } from '../identity/types.ts';
import { one } from '../identity/store.ts';
import { APPOINTMENT_RATE_MINOR,BLOCK_PRICE_MINOR,CREDITS_PER_BLOCK,CURRENCY,TERMS_VERSION,assertMinor } from './policy.ts';
import { PaymentsStore } from './store.ts';
import type { NewAllocation,NewPayment,NewRefund } from './types.ts';
export class PaymentsService {
 constructor(private readonly db:PaymentsStore){}
 overview(actor:Actor,caseId:NewPayment['caseId']){return this.db.read(actor,async context=>{await this.db.requireMinorCase(context,caseId,'read');return this.db.overview(context,caseId);});}
 createCharge(actor:Actor,key:string,input:{caseId:NewPayment['caseId'];dueOn:string}){return this.db.command(actor,'charge:create',key,input,context=>this.db.requireMinorCase(context,input.caseId,'write'),async context=>{
  const id=this.db.newChargeId();await context.tx.query(`INSERT INTO ls_payments.charges(id,workspace_id,case_id,kind,amount_minor,currency,status,due_on,created_by,created_at) VALUES($1,$2,$3,'four_appointment_block',$4,$5,'open',$6,$7,$8)`,[id,context.workspace,input.caseId,BLOCK_PRICE_MINOR,CURRENCY,input.dueOn,context.actor.id,context.now]);return {chargeId:id,amountMinor:BLOCK_PRICE_MINOR,currency:CURRENCY,dueOn:input.dueOn};
 });}
 recordPayment(actor:Actor,key:string,input:NewPayment){return this.db.command(actor,'payment:record',key,input,context=>this.db.requireMinorCase(context,input.caseId,'write'),async context=>{
  assertMinor(input.amountMinor);const receivedAt=new Date(input.receivedAt);if(!Number.isFinite(receivedAt.valueOf())||receivedAt.valueOf()>context.now.valueOf()+300_000)throw new AppError('INVALID_REQUEST');
  const id=this.db.newPaymentId(),reference=this.db.encryptReference(context,id,input.privateReference);
  await context.tx.query(`INSERT INTO ls_payments.payments(id,workspace_id,case_id,amount_minor,currency,method,received_at,reference_ciphertext,recorded_by,recorded_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[id,context.workspace,input.caseId,input.amountMinor,CURRENCY,input.method,receivedAt,reference,context.actor.id,context.now]);return {paymentId:id,amountMinor:input.amountMinor,currency:CURRENCY};
 });}
 allocate(actor:Actor,key:string,input:NewAllocation){return this.db.command(actor,'allocation:create',key,input,context=>this.db.requireMinorCase(context,input.caseId,'write'),async context=>{
  assertMinor(input.amountMinor);
  const payment=await one<{amountMinor:number}>(context.tx,`SELECT amount_minor AS "amountMinor" FROM ls_payments.payments WHERE workspace_id=$1 AND case_id=$2 AND id=$3 FOR UPDATE`,[context.workspace,input.caseId,input.paymentId]);
  const charge=await one<{amountMinor:number;status:'open'|'paid'}>(context.tx,`SELECT amount_minor AS "amountMinor",status FROM ls_payments.charges WHERE workspace_id=$1 AND case_id=$2 AND id=$3 FOR UPDATE`,[context.workspace,input.caseId,input.chargeId]);
  const paymentAllocated=await one<{value:number}>(context.tx,`SELECT COALESCE(SUM(amount_minor),0)::integer AS value FROM ls_payments.allocations WHERE workspace_id=$1 AND payment_id=$2`,[context.workspace,input.paymentId]);
  const chargeAllocated=await one<{value:number}>(context.tx,`SELECT COALESCE(SUM(amount_minor),0)::integer AS value FROM ls_payments.allocations WHERE workspace_id=$1 AND charge_id=$2`,[context.workspace,input.chargeId]);
  if(!payment||!charge||charge.status!=='open'||!paymentAllocated||!chargeAllocated||Number(paymentAllocated.value)+input.amountMinor>Number(payment.amountMinor)||Number(chargeAllocated.value)+input.amountMinor>Number(charge.amountMinor))throw new AppError('CONFLICT');
  const id=this.db.newAllocationId();await context.tx.query('INSERT INTO ls_payments.allocations(id,workspace_id,case_id,payment_id,charge_id,amount_minor,allocated_by,allocated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[id,context.workspace,input.caseId,input.paymentId,input.chargeId,input.amountMinor,context.actor.id,context.now]);
  let blockId:null|ReturnType<PaymentsStore['newBlockId']>=null;
  if(Number(chargeAllocated.value)+input.amountMinor===BLOCK_PRICE_MINOR){
   blockId=this.db.newBlockId();const eventId=this.db.newEventId();await context.tx.query(`UPDATE ls_payments.charges SET status='paid',paid_at=$3 WHERE workspace_id=$1 AND id=$2 AND status='open'`,[context.workspace,input.chargeId,context.now]);
   await context.tx.query(`INSERT INTO ls_payments.credit_blocks(id,workspace_id,case_id,charge_id,credits_purchased,purchase_amount_minor,currency,terms_version,purchased_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[blockId,context.workspace,input.caseId,input.chargeId,CREDITS_PER_BLOCK,BLOCK_PRICE_MINOR,CURRENCY,TERMS_VERSION,context.now]);
   await context.tx.query(`INSERT INTO ls_payments.credit_events(id,workspace_id,case_id,credit_block_id,kind,delta_credits,value_minor,appointment_id,reschedule_request_id,event_key,reason_code,actor_account_id,occurred_at) VALUES($1,$2,$3,$4,'purchase',$5,$6,NULL,NULL,$7,'manual_prepaid_block',$8,$9)`,[eventId,context.workspace,input.caseId,blockId,CREDITS_PER_BLOCK,BLOCK_PRICE_MINOR,`charge:${input.chargeId}:purchase`,context.actor.id,context.now]);
  }
  return {allocationId:id,creditBlockId:blockId};
 });}
 refund(actor:Actor,key:string,input:NewRefund){return this.db.command(actor,'refund:create',key,input,context=>this.db.requireMinorCase(context,input.caseId,'write'),async context=>{
  // Lock the concrete block in the nonaggregate outer query. PostgreSQL forbids
  // FOR UPDATE on a grouped query; the workspace lock serializes ledger writers.
  const block=await one<{remainingCredits:number}>(context.tx,`SELECT COALESCE((SELECT SUM(e.delta_credits) FROM ls_payments.credit_events e WHERE e.workspace_id=b.workspace_id AND e.credit_block_id=b.id),0)::integer AS "remainingCredits" FROM ls_payments.credit_blocks b WHERE b.workspace_id=$1 AND b.case_id=$2 AND b.id=$3 FOR UPDATE OF b`,[context.workspace,input.caseId,input.blockId]);
  if(!block||input.credits>Number(block.remainingCredits))throw new AppError('CONFLICT');const amount=input.credits*APPOINTMENT_RATE_MINOR,id=this.db.newRefundId(),eventId=this.db.newEventId();
  await context.tx.query(`INSERT INTO ls_payments.refunds(id,workspace_id,case_id,credit_block_id,credits,amount_minor,currency,reason_ciphertext,recorded_by,recorded_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[id,context.workspace,input.caseId,input.blockId,input.credits,amount,CURRENCY,this.db.encryptReference(context,id,input.reason),context.actor.id,context.now]);
  await context.tx.query(`INSERT INTO ls_payments.credit_events(id,workspace_id,case_id,credit_block_id,kind,delta_credits,value_minor,appointment_id,reschedule_request_id,event_key,reason_code,actor_account_id,occurred_at) VALUES($1,$2,$3,$4,'refund',$5,$6,NULL,NULL,$7,'manual_refund',$8,$9)`,[eventId,context.workspace,input.caseId,input.blockId,-input.credits,-amount,`refund:${id}`,context.actor.id,context.now]);return {refundId:id,credits:input.credits,amountMinor:amount};
 });}
}
