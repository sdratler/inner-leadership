import {z} from 'zod';
import {billingId,billingInstant,reminderStateSchema} from './contracts.ts';
import {cashDateCommandSchema,reversalCommandV2Schema,ledgerReceiptV2Schema} from './contracts-v2.ts';
import {BILLING_SERVICE_V4} from './guest-service-contract-v4.ts';
import {serviceBalanceV4Schema,type ServiceOwnerSnapshotV4} from './guest-service-owner-financial-contract-v4.ts';

export const serviceCashDateCommandV4Schema=cashDateCommandSchema.extend({version:z.literal(BILLING_SERVICE_V4)});
export const serviceReverseCashCommandV4Schema=reversalCommandV2Schema.extend({version:z.literal(BILLING_SERVICE_V4)});
export const serviceOwnerMoneyCommandV4Schema=z.discriminatedUnion('action',[
 z.object({action:z.literal('cash_date'),command:serviceCashDateCommandV4Schema}).strict(),
 z.object({action:z.literal('reverse_cash'),command:serviceReverseCashCommandV4Schema}).strict(),
]);
export type ServiceOwnerMoneyCommandV4=z.infer<typeof serviceOwnerMoneyCommandV4Schema>;
const count=z.number().int().min(0).max(1000);
const reminderCounts=z.object({queued:count,unknown:count,provider_accepted:count,delivered:count,suppressed:count,failed:count}).strict().refine(v=>Object.values(v).reduce((s,n)=>s+n,0)<=1000);
const summary=serviceBalanceV4Schema.omit({receipts:true,reminders:true,pendingAttemptIds:true}).extend({pendingAttemptCount:count,reminderCounts}).strict();
/** Immutable original-operation snapshot, never the separately reloaded current
 * balance. Keep the result bounded within the existing encrypted journal. */
export const serviceOwnerMoneyReceiptV4Schema=z.object({version:z.literal(BILLING_SERVICE_V4),action:z.enum(['cash_date','reverse_cash']),
 workspaceId:billingId,actorId:billingId,operationId:billingId,quoteId:billingId,familyId:billingId,offerSha256:z.string().regex(/^[a-f0-9]{64}$/),acceptanceId:billingId,
 entityVersion:z.number().int().positive(),recordedAt:billingInstant,replayed:z.boolean(),
 result:z.object({kind:z.literal('operation_snapshot'),balance:summary,receipt:ledgerReceiptV2Schema,originalCashReceipt:ledgerReceiptV2Schema.nullable()}).strict(),
}).strict().superRefine((v,c)=>{
 const b=v.result.balance,r=v.result.receipt,o=v.result.originalCashReceipt,fail=()=>c.addIssue({code:'custom',message:'SERVICE_MONEY_OPERATION_SCOPE'});
 if(b.quoteId!==v.quoteId||b.familyId!==v.familyId||b.revision!==v.entityVersion||r.operationId!==v.operationId||r.quoteId!==v.quoteId||r.familyId!==v.familyId||r.recordedAt!==v.recordedAt||r.actorId!==v.actorId||r.provider!==null||r.allocations.some(a=>!b.lines.some(l=>l.lineId===a.lineId)))fail();
 if(v.action==='cash_date'?(r.kind!=='cash'||!('receivedPrecision' in r)||o!==null):
  (r.kind!=='cash_reversal'||!o||o.kind!=='cash'||o.id!==r.originalReceiptId||o.quoteId!==v.quoteId||o.familyId!==v.familyId||Date.parse(o.recordedAt)>Date.parse(r.recordedAt)))fail();
 if(new TextEncoder().encode(JSON.stringify(v)).byteLength>60000)fail();
});
export type ServiceOwnerMoneyReceiptV4=z.infer<typeof serviceOwnerMoneyReceiptV4Schema>;
export function serviceMoneySnapshotV4(view:ServiceOwnerSnapshotV4,receiptId:string){
 const {receipts,reminders,pendingAttemptIds,...balance}=view.balance,receipt=receipts.find(r=>r.id===receiptId);
 if(!receipt)throw new Error('MONEY_RECEIPT_MISSING');
 const counts={queued:0,unknown:0,provider_accepted:0,delivered:0,suppressed:0,failed:0};for(const i of reminders)counts[reminderStateSchema.parse(i.state)]++;
 return {kind:'operation_snapshot' as const,balance:{...balance,pendingAttemptCount:pendingAttemptIds.length,reminderCounts:counts},receipt,originalCashReceipt:receipts.find(r=>r.id===receipt.originalReceiptId)??null};
}
export const serviceOwnerMoneyOutcomeV4Schema=z.discriminatedUnion('state',[
 z.object({state:z.literal('committed'),version:z.literal(BILLING_SERVICE_V4),workspaceId:billingId,actorId:billingId,input:serviceOwnerMoneyCommandV4Schema,result:serviceOwnerMoneyReceiptV4Schema}).strict(),
 z.object({state:z.literal('rejected_current_attempt'),version:z.literal(BILLING_SERVICE_V4),workspaceId:billingId,actorId:billingId,input:serviceOwnerMoneyCommandV4Schema,code:z.enum(['CONFLICT','FORBIDDEN','NOT_FOUND','UNAUTHENTICATED','INVALID_REQUEST'])}).strict(),
]).superRefine((o,c)=>{
 if(o.state==='committed'&&(o.result.workspaceId!==o.workspaceId||o.result.actorId!==o.actorId||o.result.operationId!==o.input.command.operationId||o.result.action!==o.input.action||o.result.quoteId!==o.input.command.quoteId||o.result.entityVersion!==o.input.command.expectedVersion+1))c.addIssue({code:'custom',message:'SERVICE_MONEY_OUTCOME_SCOPE'});
});
