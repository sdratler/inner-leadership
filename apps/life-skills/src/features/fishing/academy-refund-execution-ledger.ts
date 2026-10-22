import 'server-only';
import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import {AppError} from '../../lib/errors.ts';
import {digest,type SettlementFact,type MerchantBinding} from '../fishing-payments/domain.ts';
import type {ProviderOperation} from '../fishing-payments/ports.ts';
import {one,type SqlSession} from '../identity/store.ts';
import {AcademyRefundExecutionJournal} from './academy-refund-execution-store.ts';
import {refundExecutionClaimSchema,refundExecutionObservationSchema,type RefundExecutionBatch,type RefundExecutionMember,type RefundExecutionObservation} from './academy-refund-execution-contract.ts';

const opaque=z.string().regex(/^[A-Za-z0-9_.:-]{1,160}$/),money=z.number().int().positive().max(100000000);
const resultSchema=z.strictObject({kind:z.literal('refund'),providerObjectId:z.string().regex(/^re_[A-Za-z0-9_]{1,150}$/),providerAccountId:opaque,livemode:z.boolean(),currency:z.literal('USD'),amountCents:money,purchaseId:z.uuid(),idempotencyKey:z.string().max(255),status:z.enum(['pending','succeeded','failed'])});
const operationSchema=z.strictObject({id:z.uuid(),kind:z.literal('refund'),workspaceId:z.uuid(),purchaseId:z.uuid(),dueId:opaque,refundPaymentId:opaque,providerAccountId:opaque,livemode:z.boolean(),amountCents:money,currency:z.literal('USD'),idempotencyKey:z.string().max(255),state:z.enum(['reserved','unknown','confirmed']),requestDigest:z.string().regex(/^[a-f0-9]{64}$/),result:resultSchema.nullable()});
function requireLedger(value:unknown):asserts value{if(!value)throw new AppError('UNAVAILABLE');}
export function refundExecutionRequest(batch:RefundExecutionBatch,member:RefundExecutionMember){return digest({batchId:batch.id,preparationId:batch.preparationId,review:batch.preparationReviewSha256,decision:batch.effectDecision,member});}

/** Canonical PAY interoperability. No cash fact is authored here. Only the
 * existing signed-receipt/readback processor may settle a confirmed operation.
 * Caller owns workspace lock; journal and SQL must describe precisely one op. */
export class AcademyRefundExecutionLedger{
 constructor(private readonly journal:AcademyRefundExecutionJournal){}
 expected(batch:RefundExecutionBatch,member:RefundExecutionMember):ProviderOperation{
  const prepared=batch.preparedFacts.members.find(p=>p.input.purchase.purchaseId===member.purchaseId);requireLedger(prepared);
  return {id:member.operationId,kind:'refund',workspaceId:batch.workspaceId,purchaseId:member.purchaseId,dueId:member.dueId,refundPaymentId:member.originalPaymentId,providerAccountId:prepared.originalPayment.providerAccountId,livemode:prepared.originalPayment.livemode,amountCents:member.amountCents,currency:'USD',idempotencyKey:`rm:${batch.workspaceId}:${member.operationId}`,state:'reserved',requestDigest:refundExecutionRequest(batch,member),result:null};
 }
 async due(tx:SqlSession,workspace:string,prepared:RefundExecutionBatch['preparedFacts']['members'][number]){
  const p=prepared.originalPayment,row=await one<{op:unknown}>(tx,`SELECT CASE WHEN octet_length(operation_json::text)<=131072 THEN operation_json ELSE NULL END AS op FROM ls_fishing_payments.operations WHERE workspace_id=$1 AND id=$2 AND purchase_id=$3 AND kind='hosted_invoice' FOR SHARE`,[workspace,p.hostedOperationId,prepared.input.purchase.purchaseId]);
  const parsed=z.object({id:z.literal(p.hostedOperationId),kind:z.literal('hosted_invoice'),workspaceId:z.literal(workspace),purchaseId:z.literal(prepared.input.purchase.purchaseId),state:z.literal('confirmed'),dueId:opaque,providerAccountId:z.literal(p.providerAccountId),livemode:z.literal(p.livemode),currency:z.literal('USD'),amountCents:z.literal(p.amountCents),result:z.object({kind:z.literal('hosted_invoice'),providerObjectId:z.literal(p.providerObjectId),dueId:opaque})}).parse(row?.op);requireLedger(parsed.dueId===parsed.result.dueId);return parsed.dueId;
 }
 async reserve(tx:SqlSession,batch:RefundExecutionBatch,member:RefundExecutionMember){
  const old=await tx.query(`SELECT id FROM ls_fishing_payments.operations WHERE workspace_id=$1 AND purchase_id=$2 AND kind='refund' LIMIT 1 FOR SHARE`,[batch.workspaceId,member.purchaseId]);if(old.length)throw new AppError('CONFLICT');const op=this.expected(batch,member);
  await tx.query(`INSERT INTO ls_fishing_payments.operations(workspace_id,id,purchase_id,kind,due_id,request_digest,operation_json) VALUES($1,$2,$3,'refund',$4,$5,$6::jsonb)`,[op.workspaceId,op.id,op.purchaseId,op.dueId,op.requestDigest,JSON.stringify(op)]);return op;
 }
 async operation(tx:SqlSession,batch:RefundExecutionBatch,member:RefundExecutionMember){
  const rows=await tx.query<{id:string;kind:string;dueId:string;hash:string;op:unknown}>(`SELECT id,kind,due_id AS "dueId",request_digest AS hash,CASE WHEN octet_length(operation_json::text)<=131072 THEN operation_json ELSE NULL END AS op FROM ls_fishing_payments.operations WHERE workspace_id=$1 AND purchase_id=$2 AND kind='refund' LIMIT 2 FOR SHARE`,[batch.workspaceId,member.purchaseId]);requireLedger(rows.length===1);const row=rows[0]!,op=operationSchema.parse(row.op),expected=this.expected(batch,member);
  requireLedger(row.id===member.operationId&&row.kind==='refund'&&row.dueId===member.dueId&&row.hash===expected.requestDigest&&digest({...op,state:'reserved',result:null})===digest(expected));return op;
 }
 async observation(tx:SqlSession,batch:RefundExecutionBatch,member:RefundExecutionMember){
  const read=(status:string)=>this.journal.read(tx,batch.workspaceId,`owner03.refund.observed_${status}`,member.operationId,refundExecutionObservationSchema),pending=await read('pending'),succeeded=await read('succeeded'),failed=await read('failed');requireLedger(!(succeeded&&failed));const result=succeeded??failed??pending;
  for(const v of [pending,succeeded,failed])if(v&&result)requireLedger(v.providerObjectId===result.providerObjectId);return result;
 }
 async verify(tx:SqlSession,batch:RefundExecutionBatch,member:RefundExecutionMember){
  const op=await this.operation(tx,batch,member),observation=await this.observation(tx,batch,member),claim=await this.journal.read(tx,batch.workspaceId,'owner03.refund.claim',member.operationId,refundExecutionClaimSchema),consumed=await this.journal.read(tx,batch.workspaceId,'owner03.refund.consumed',member.operationId,refundExecutionClaimSchema),fenced=await this.journal.dispatched(tx,batch.workspaceId,member.operationId);
  requireLedger(op.state==='reserved'?!claim&&!consumed&&!fenced&&!observation:!!claim);if(claim)requireLedger(claim.batchId===batch.id&&claim.operationId===member.operationId&&claim.requestSha256===op.requestDigest&&claim.decisionId===batch.effectDecision.id&&claim.decisionRevision===batch.effectDecision.revision);
  requireLedger(!!consumed===fenced&&(!consumed||digest(consumed)===digest(claim)));if(observation){requireLedger(consumed&&op.state==='confirmed'&&digest(op.result)===digest(this.result(op,observation)));}else requireLedger(op.state!=='confirmed'&&op.result===null);
  return {op,observation,claim,consumed};
 }
 private result(op:ProviderOperation,observation:RefundExecutionObservation){return resultSchema.parse({kind:'refund',providerObjectId:observation.providerObjectId,providerAccountId:op.providerAccountId,livemode:op.livemode,currency:'USD',amountCents:op.amountCents,purchaseId:op.purchaseId,idempotencyKey:op.idempotencyKey,status:observation.status});}
 async unknown(tx:SqlSession,batch:RefundExecutionBatch,member:RefundExecutionMember){const op=await this.operation(tx,batch,member);requireLedger(op.state==='reserved');await tx.query(`UPDATE ls_fishing_payments.operations SET operation_json=$3::jsonb WHERE workspace_id=$1 AND id=$2`,[batch.workspaceId,member.operationId,JSON.stringify({...op,state:'unknown'})]);}
 async confirm(tx:SqlSession,batch:RefundExecutionBatch,member:RefundExecutionMember,observation:RefundExecutionObservation){const op=await this.operation(tx,batch,member);requireLedger(op.state!=='reserved');await tx.query(`UPDATE ls_fishing_payments.operations SET operation_json=$3::jsonb WHERE workspace_id=$1 AND id=$2`,[batch.workspaceId,member.operationId,JSON.stringify({...op,state:'confirmed',result:this.result(op,observation)})]);}
 /** Called only after native paymentFacts has verified processed receipts and
  * recomputed the actual PAY state. Return the original immutable payment set;
  * allow only this journal's succeeded refund and its single revision delta. */
 async originalFacts(tx:SqlSession,batch:RefundExecutionBatch,member:RefundExecutionMember,facts:readonly SettlementFact[],revision:number){
  const {op,observation}=await this.verify(tx,batch,member),prepared=batch.preparedFacts.members.find(p=>p.input.purchase.purchaseId===member.purchaseId)!;
  const payments=facts.filter(f=>f.kind==='payment'),refunds=facts.filter(f=>f.kind!=='payment');requireLedger(payments.length===1&&digest(payments)===prepared.provenance.settlementSha256&&refunds.length<=1&&revision===prepared.provenance.paymentRevision+refunds.length);
  for(const f of refunds)requireLedger(f.kind==='refund'&&observation?.status==='succeeded'&&f.canonicalTransactionId===observation.providerObjectId&&f.relatedProviderObjectId===observation.providerObjectId&&f.operationId===op.id&&f.originalPaymentId===member.originalPaymentId&&f.purchaseId===member.purchaseId&&f.purchaseLineId===member.purchaseLineId&&f.dueId===member.dueId&&f.cents===member.amountCents&&f.providerAccountId===op.providerAccountId&&f.livemode===op.livemode&&f.currency==='USD');
  return {facts:payments,settled:refunds.length===1};
 }
 /** Populate ONLY a known refund mapping from already verified invoice/PI and
  * customer mappings. No inferred customer, extra access, new invoice mapping,
  * provider search, cash allocation or actual merchant verification occurs. */
 async mapKnownRefund(tx:SqlSession,batch:RefundExecutionBatch,member:RefundExecutionMember,merchant:MerchantBinding,now:Date){
  const {op,observation}=await this.verify(tx,batch,member),prepared=batch.preparedFacts.members.find(p=>p.input.purchase.purchaseId===member.purchaseId)!;requireLedger(observation&&op.state==='confirmed'&&!merchant.livemode&&merchant.accountId===op.providerAccountId&&merchant.apiVersion===prepared.originalPayment.apiVersion&&Number.isFinite(now.valueOf()));await this.due(tx,batch.workspaceId,prepared);
  const rows=await tx.query<{id:string;revision:number;customerId:string;purchaseId:string;hostedId:string;operationId:string;invoiceId:string;kind:string;objectId:string;provenance:string;at:Date;revokedAt:Date|null}>(txSqlMappings+` WHERE workspace_id=$1 AND provider_account_id=$2 AND livemode=false AND hosted_operation_id=$3 AND object_kind IN('invoice','payment_intent') LIMIT 3 FOR SHARE`,[batch.workspaceId,merchant.accountId,prepared.originalPayment.hostedOperationId]);requireLedger(rows.length===2);const invoice=rows.find(r=>r.kind==='invoice'),payment=rows.find(r=>r.kind==='payment_intent');requireLedger(invoice&&payment&&/^in_[A-Za-z0-9_]{1,150}$/.test(prepared.originalPayment.providerObjectId)&&/^pi_[A-Za-z0-9_]{1,150}$/.test(member.originalPaymentId));
  for(const row of rows)requireLedger(z.uuid().safeParse(row.id).success&&row.revision>0&&row.purchaseId===member.purchaseId&&row.hostedId===prepared.originalPayment.hostedOperationId&&row.operationId===row.hostedId&&row.invoiceId===prepared.originalPayment.providerObjectId&&row.customerId===invoice.customerId&&row.provenance.length>0&&row.provenance.length<=160&&row.at instanceof Date&&Number.isFinite(row.at.valueOf())&&row.at<=now&&!row.revokedAt);
  requireLedger(invoice.objectId===invoice.invoiceId&&payment.objectId===member.originalPaymentId);
  const customer=await one<{revision:number;payerId:string;customerId:string;bindingId:string;api:string;at:Date;revokedAt:Date|null;provenance:string}>(tx,`SELECT revision,payer_account_id AS "payerId",customer_id AS "customerId",merchant_binding_id AS "bindingId",api_version AS api,verified_at AS at,revoked_at AS "revokedAt",provenance_reference AS provenance FROM ls_fishing_payments.customer_bindings WHERE workspace_id=$1 AND id=$2 AND provider_account_id=$3 AND livemode=false FOR SHARE`,[batch.workspaceId,invoice.customerId,merchant.accountId]);requireLedger(customer&&customer.revision>0&&customer.payerId===batch.preparedFacts.payerAccountId&&/^cus_[A-Za-z0-9_]{1,150}$/.test(customer.customerId)&&customer.bindingId===merchant.verifiedBindingId&&customer.api===merchant.apiVersion&&customer.at instanceof Date&&Number.isFinite(customer.at.valueOf())&&customer.at<=now&&!customer.revokedAt&&customer.provenance.length>0&&customer.provenance.length<=160);
  const existing=await tx.query<{workspaceId:string;customerId:string;purchaseId:string;hostedId:string;operationId:string;invoiceId:string;objectId:string;kind:string;revokedAt:Date|null}>(`SELECT workspace_id AS "workspaceId",customer_binding_id AS "customerId",purchase_id AS "purchaseId",hosted_operation_id AS "hostedId",operation_id AS "operationId",invoice_id AS "invoiceId",object_id AS "objectId",object_kind AS kind,revoked_at AS "revokedAt" FROM ls_fishing_payments.object_bindings WHERE provider_account_id=$1 AND livemode=false AND (object_id=$2 OR (workspace_id=$3 AND operation_id=$4 AND object_kind='refund')) LIMIT 3 FOR SHARE`,[merchant.accountId,observation.providerObjectId,batch.workspaceId,member.operationId]);requireLedger(existing.length<=1);
  const expected={workspaceId:batch.workspaceId,customerId:invoice.customerId,purchaseId:member.purchaseId,hostedId:prepared.originalPayment.hostedOperationId,operationId:member.operationId,invoiceId:invoice.invoiceId,objectId:observation.providerObjectId,kind:'refund',revokedAt:null};if(existing.length){requireLedger(digest(existing[0])===digest(expected));return;}
  await tx.query(`INSERT INTO ls_fishing_payments.object_bindings(workspace_id,id,revision,provider_account_id,livemode,customer_binding_id,purchase_id,hosted_operation_id,operation_id,invoice_id,object_kind,object_id,provenance_reference,verified_at) VALUES($1,$2,1,$3,false,$4,$5,$6,$7,$8,'refund',$9,$10,$11)`,[batch.workspaceId,randomUUID(),merchant.accountId,invoice.customerId,member.purchaseId,prepared.originalPayment.hostedOperationId,member.operationId,invoice.invoiceId,observation.providerObjectId,'owner03-refund:'+batch.id,now]);
 }
}
const txSqlMappings=`SELECT id,revision,customer_binding_id AS "customerId",purchase_id AS "purchaseId",hosted_operation_id AS "hostedId",operation_id AS "operationId",invoice_id AS "invoiceId",object_kind AS kind,object_id AS "objectId",provenance_reference AS provenance,verified_at AS at,revoked_at AS "revokedAt" FROM ls_fishing_payments.object_bindings`;
