import {z} from 'zod';
import {billingId,billingInstant,commandSchema,reminderStateSchema} from '../features/fishing-billing/contracts.ts';
import {cashDateCommandSchema,reversalCommandV2Schema,ledgerReceiptV2Schema} from '../features/fishing-billing/contracts-v2.ts';
import {billingStateCommandV2Schema} from '../features/fishing-billing/state-contracts-v2.ts';
import {guestOwnerSnapshotV3Schema,guestFamilyOfferSchema,guestBalanceV3Schema,type GuestOwnerSnapshotV3} from './fishing-billing-guest-contract-v3.ts';

/** Explicit guest successor. Historical V1/V2 DTOs, precision and records are
 * untouched. No parsed command or receipt supplies owner or billing authority. */
export const FISHING_BILLING_OWNER_V3_PATH='/api/private/fishing-billing/v3';
export const OWNER_MONEY_V3='JLFA-FISHING-OWNER-MONEY-v3' as const;
// Original operation <=60KB leaves room inside existing64KiB encrypted journal.
// Full current <=4MB plus that original result fits the bounded wire envelope.
export const OWNER_OPERATION_MAX_BYTES=60_000,OWNER_CURRENT_MAX_BYTES=4_000_000,OWNER_RESPONSE_MAX_BYTES=4_100_000;
const bytes=(v:unknown)=>new TextEncoder().encode(JSON.stringify(v)).byteLength;
export const ownerCurrentV3Schema=guestOwnerSnapshotV3Schema.refine(v=>bytes(v)<=OWNER_CURRENT_MAX_BYTES,'CURRENT_OWNER_SIZE');
export const guestCashDateCommandSchema=cashDateCommandSchema.extend({version:z.literal(OWNER_MONEY_V3)});
export const guestReversalCommandSchema=reversalCommandV2Schema.extend({version:z.literal(OWNER_MONEY_V3)});
export const guestStateCommandSchema=commandSchema.extend({
 version:z.literal(OWNER_MONEY_V3),quoteId:billingId,
 paused:billingStateCommandV2Schema.shape.paused,cancel:billingStateCommandV2Schema.shape.cancel,
}).strict().refine(c=>c.paused!==undefined||c.cancel===true,'STATE_CHANGE_REQUIRED');
export const billingOwnerCommandV3Schema=z.discriminatedUnion('action',[
 z.object({action:z.literal('cash_date'),command:guestCashDateCommandSchema}).strict(),
 z.object({action:z.literal('reverse_cash'),command:guestReversalCommandSchema}).strict(),
 z.object({action:z.literal('state'),command:guestStateCommandSchema}).strict(),
]);
export type BillingOwnerCommandV3=z.infer<typeof billingOwnerCommandV3Schema>;
const count=z.number().int().min(0).max(1000);
const reminderCountsSchema=z.object({queued:count,unknown:count,provider_accepted:count,delivered:count,suppressed:count,failed:count}).strict()
 .refine(c=>Object.values(c).reduce((s,n)=>s+n,0)<=1000,'REMINDER_COUNT_LIMIT');
const balanceSummarySchema=guestBalanceV3Schema.omit({receipts:true,reminders:true,pendingAttemptIds:true}).extend({pendingAttemptCount:count,reminderCounts:reminderCountsSchema}).strict();
/** Original operation facts are explicitly a compact snapshot, not a complete
 * receipt/reminder history. Current always uses the full separately read view. */
export const ownerOperationResultV3Schema=z.object({
 kind:z.literal('operation_snapshot'),quote:guestFamilyOfferSchema,balance:balanceSummarySchema,
 receiptId:billingId.nullable(),relatedReceipts:z.array(ledgerReceiptV2Schema).max(2),
}).strict().superRefine((s,c)=>{
 const q=s.quote,b=s.balance,ids=new Set(s.relatedReceipts.map(r=>r.id)),fail=()=>c.addIssue({code:'custom',message:'OPERATION_SNAPSHOT_SCOPE'});
 if(q.id!==b.quoteId||q.familyId!==b.familyId||q.revision!==b.revision||q.paused!==b.paused||(q.state==='cancelled')!==b.cancelled||q.lines.length!==b.lines.length||new Set(b.lines.map(l=>l.lineId)).size!==b.lines.length)fail();
 for(const l of b.lines){const original=q.lines.find(m=>m.id===l.lineId);if(!original||original.childId!==l.childId||JSON.stringify(original.period)!==JSON.stringify(l.period)||original.groupId!==l.groupId||original.amountMinor!==l.quotedMinor||original.dueAt!==l.dueAt)fail();}
 if(ids.size!==s.relatedReceipts.length||s.receiptId!==null&&!ids.has(s.receiptId))fail();
 for(const r of s.relatedReceipts)if(r.quoteId!==q.id||r.familyId!==q.familyId||r.allocations.some(a=>!q.lines.some(l=>l.id===a.lineId))||r.originalReceiptId!==null&&!ids.has(r.originalReceiptId))fail();
 if(bytes(s)>OWNER_OPERATION_MAX_BYTES)fail();
});
export type OwnerOperationResultV3=z.infer<typeof ownerOperationResultV3Schema>;
export function compactOwnerOperationResultV3(raw:GuestOwnerSnapshotV3,receiptId:string|null):OwnerOperationResultV3{
 const current=ownerCurrentV3Schema.parse(raw),{receipts,reminders,pendingAttemptIds,...summary}=current.balance;
 const receipt=receiptId===null?null:receipts.find(r=>r.id===receiptId);if(receiptId!==null&&!receipt)throw new Error('MONEY_RECEIPT_MISSING');
 const relatedReceipts=receipt?[receipt,...(receipt.originalReceiptId===null?[]:receipts.filter(r=>r.id===receipt.originalReceiptId))]:[];
 const reminderCounts={queued:0,unknown:0,provider_accepted:0,delivered:0,suppressed:0,failed:0};for(const i of reminders)reminderCounts[reminderStateSchema.parse(i.state)]++;
 return ownerOperationResultV3Schema.parse({kind:'operation_snapshot',quote:current.quote,balance:{...summary,pendingAttemptCount:pendingAttemptIds.length,reminderCounts},receiptId,relatedReceipts});
}
export const ownerMoneyReceiptV3Schema=z.object({
 version:z.literal(OWNER_MONEY_V3),operationId:billingId,action:z.enum(['cash_date','reverse_cash','state']),
 entityId:billingId,entityVersion:z.number().int().positive(),recordedAt:billingInstant,replayed:z.boolean(),
 result:ownerOperationResultV3Schema,
}).strict().superRefine((r,c)=>{
 const q=r.result.quote,fail=()=>c.addIssue({code:'custom',message:'OWNER_MONEY_RECEIPT_SCOPE'});
 if(r.entityId!==q.id||r.entityVersion!==q.revision||Date.parse(r.recordedAt)<Date.parse(q.createdAt))fail();
 const matches=r.result.relatedReceipts.filter(m=>m.operationId===r.operationId);
 if(r.action==='state'){if(r.result.receiptId!==null||r.result.relatedReceipts.length!==0)fail();}
 else{
  const money=matches[0];
  if(matches.length!==1||!money||money.id!==r.result.receiptId||money.recordedAt!==r.recordedAt||!q.acceptance)fail();
  else if(r.action==='cash_date'?(r.result.relatedReceipts.length!==1||money.kind!=='cash'||!('receivedPrecision' in money)||money.receivedPrecision!=='date'):
   (r.result.relatedReceipts.length!==2||money.kind!=='cash_reversal'||!r.result.relatedReceipts.some(original=>original.id===money.originalReceiptId&&original.kind==='cash')))fail();
 }
});
export type OwnerMoneyReceiptV3=z.infer<typeof ownerMoneyReceiptV3Schema>;
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
/** A later current quote may gain its FIRST acceptance. An existing original
 * acceptance and immutable material may never be replaced or relabelled. */
export function sameGuestOwnerLineage(original:OwnerOperationResultV3,current:GuestOwnerSnapshotV3):boolean{
 const a=original.quote,b=current.quote;
 return a.id===b.id&&a.workspaceId===b.workspaceId&&a.familyId===b.familyId&&a.createdAt===b.createdAt&&b.revision>=a.revision&&
  same(a.definition,b.definition)&&same(a.lines,b.lines)&&same(a.override,b.override)&&
  (a.issuedAt===null||a.issuedAt===b.issuedAt)&&(a.acceptance===null||same(a.acceptance,b.acceptance))&&
  original.relatedReceipts.every(r=>current.balance.receipts.some(m=>m.id===r.id&&same(r,m)));
}
export const billingOwnerReadV3Schema=z.discriminatedUnion('state',[
 z.object({version:z.literal(OWNER_MONEY_V3),state:z.literal('ready'),current:ownerCurrentV3Schema}).strict(),
 z.object({version:z.literal(OWNER_MONEY_V3),state:z.literal('confirmed'),receipt:ownerMoneyReceiptV3Schema,current:ownerCurrentV3Schema}).strict(),
 z.object({version:z.literal(OWNER_MONEY_V3),state:z.literal('unresolved'),operationId:billingId}).strict(),
]).superRefine((v,c)=>{
 if(v.state==='confirmed'&&!sameGuestOwnerLineage(v.receipt.result,v.current))c.addIssue({code:'custom',message:'CURRENT_OWNER_RECEIPT_LINEAGE'});
 if(bytes(v)>OWNER_RESPONSE_MAX_BYTES)c.addIssue({code:'custom',message:'OWNER_RESPONSE_SIZE'});
});
export type BillingOwnerReadV3=z.infer<typeof billingOwnerReadV3Schema>;
