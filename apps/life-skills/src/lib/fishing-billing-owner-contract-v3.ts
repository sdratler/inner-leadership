import {z} from 'zod';
import {billingId,billingInstant,commandSchema} from '../features/fishing-billing/contracts.ts';
import {cashDateCommandSchema,reversalCommandV2Schema} from '../features/fishing-billing/contracts-v2.ts';
import {billingStateCommandV2Schema} from '../features/fishing-billing/state-contracts-v2.ts';
import {BILLING_GUEST_V3,guestOwnerSnapshotV3Schema} from './fishing-billing-guest-contract-v3.ts';

/** Explicit guest successor. Historical V1/V2 DTOs, precision and records are
 * untouched. No parsed command or receipt supplies owner or billing authority. */
export const FISHING_BILLING_OWNER_V3_PATH='/api/private/fishing-billing/v3';
export const guestCashDateCommandSchema=cashDateCommandSchema.extend({version:z.literal(BILLING_GUEST_V3)});
export const guestReversalCommandSchema=reversalCommandV2Schema.extend({version:z.literal(BILLING_GUEST_V3)});
export const guestStateCommandSchema=commandSchema.extend({
 version:z.literal(BILLING_GUEST_V3),quoteId:billingId,
 paused:billingStateCommandV2Schema.shape.paused,cancel:billingStateCommandV2Schema.shape.cancel,
}).strict().refine(c=>c.paused!==undefined||c.cancel===true,'STATE_CHANGE_REQUIRED');
export const billingOwnerCommandV3Schema=z.discriminatedUnion('action',[
 z.object({action:z.literal('cash_date'),command:guestCashDateCommandSchema}).strict(),
 z.object({action:z.literal('reverse_cash'),command:guestReversalCommandSchema}).strict(),
 z.object({action:z.literal('state'),command:guestStateCommandSchema}).strict(),
]);
export type BillingOwnerCommandV3=z.infer<typeof billingOwnerCommandV3Schema>;
export const ownerMoneyReceiptV3Schema=z.object({
 version:z.literal(BILLING_GUEST_V3),operationId:billingId,action:z.enum(['cash_date','reverse_cash','state']),
 entityId:billingId,entityVersion:z.number().int().positive(),recordedAt:billingInstant,replayed:z.boolean(),
 result:guestOwnerSnapshotV3Schema,
}).strict().superRefine((r,c)=>{
 const q=r.result.quote,b=r.result.balance,fail=()=>c.addIssue({code:'custom',message:'OWNER_MONEY_RECEIPT_SCOPE'});
 if(r.entityId!==q.id||r.entityVersion!==q.revision||Date.parse(r.recordedAt)<Date.parse(q.createdAt))fail();
 const matches=b.receipts.filter(m=>m.operationId===r.operationId);
 if(r.action==='state'){if(r.result.receiptId!==null||matches.length!==0)fail();}
 else{
  const money=matches[0];
  if(matches.length!==1||!money||money.id!==r.result.receiptId||money.recordedAt!==r.recordedAt||!q.acceptance)fail();
  else if(r.action==='cash_date'?(money.kind!=='cash'||!('receivedPrecision' in money)||money.receivedPrecision!=='date'):money.kind!=='cash_reversal')fail();
 }
});
export type OwnerMoneyReceiptV3=z.infer<typeof ownerMoneyReceiptV3Schema>;
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
/** A later current quote may gain its FIRST acceptance. An existing original
 * acceptance and immutable material may never be replaced or relabelled. */
export function sameGuestOwnerLineage(original:z.infer<typeof guestOwnerSnapshotV3Schema>,current:z.infer<typeof guestOwnerSnapshotV3Schema>):boolean{
 const a=original.quote,b=current.quote;
 return a.id===b.id&&a.workspaceId===b.workspaceId&&a.familyId===b.familyId&&a.createdAt===b.createdAt&&b.revision>=a.revision&&
  same(a.definition,b.definition)&&same(a.lines,b.lines)&&same(a.override,b.override)&&
  (a.issuedAt===null||a.issuedAt===b.issuedAt)&&(a.acceptance===null||same(a.acceptance,b.acceptance))&&
  original.balance.receipts.every(r=>current.balance.receipts.some(m=>m.id===r.id&&same(r,m)));
}
export const billingOwnerReadV3Schema=z.discriminatedUnion('state',[
 z.object({version:z.literal(BILLING_GUEST_V3),state:z.literal('ready'),current:guestOwnerSnapshotV3Schema}).strict(),
 z.object({version:z.literal(BILLING_GUEST_V3),state:z.literal('confirmed'),receipt:ownerMoneyReceiptV3Schema,current:guestOwnerSnapshotV3Schema}).strict(),
 z.object({version:z.literal(BILLING_GUEST_V3),state:z.literal('unresolved'),operationId:billingId}).strict(),
]).superRefine((v,c)=>{if(v.state==='confirmed'&&!sameGuestOwnerLineage(v.receipt.result,v.current))c.addIssue({code:'custom',message:'CURRENT_OWNER_RECEIPT_LINEAGE'});});
export type BillingOwnerReadV3=z.infer<typeof billingOwnerReadV3Schema>;
