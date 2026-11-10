import {z} from 'zod';
import {BILLING_SERVICE_V4} from '../features/fishing-billing/guest-service-contract-v4.ts';
import {serviceOwnerSnapshotV4Schema} from '../features/fishing-billing/guest-service-owner-financial-contract-v4.ts';
import {serviceOwnerMoneyCommandV4Schema,serviceOwnerMoneyReceiptV4Schema} from '../features/fishing-billing/guest-service-owner-money-contract-v4.ts';
import {serviceStateCommandV4Schema,serviceStateReceiptV4Schema} from '../features/fishing-billing/guest-service-owner-state-contract-v4.ts';

export const FISHING_BILLING_OWNER_V4_PATH='/api/private/fishing-billing/v4';
export const OWNER_SERVICE_RESPONSE_MAX_BYTES=4_100_000;
const bytes=(v:unknown)=>new TextEncoder().encode(JSON.stringify(v)).byteLength;
const same=(a:unknown,b:unknown):boolean=>{
 if(a===null||b===null||typeof a!=='object'||typeof b!=='object')return a===b;
 if(Array.isArray(a)||Array.isArray(b))return Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((v,i)=>same(v,b[i]));
 const x=a as Record<string,unknown>,y=b as Record<string,unknown>,keys=Object.keys(x);
 return keys.length===Object.keys(y).length&&keys.every(k=>Object.hasOwn(y,k)&&same(x[k],y[k]));
};
/** Explicit prospective V4 only. Recovery carries the ORIGINAL command: an ID
 * alone cannot authenticate a money/state journal or authorize a retry. */
export const ownerServiceOperationV4Schema=z.union([
 serviceOwnerMoneyCommandV4Schema,
 z.object({action:z.literal('state'),command:serviceStateCommandV4Schema}).strict(),
]);
export type OwnerServiceOperationV4=z.infer<typeof ownerServiceOperationV4Schema>;
export const ownerServiceRequestV4Schema=z.object({version:z.literal(BILLING_SERVICE_V4),intent:z.enum(['execute','recover']),operation:ownerServiceOperationV4Schema}).strict();
export const ownerServiceCurrentV4Schema=serviceOwnerSnapshotV4Schema.refine(v=>bytes(v)<=4_000_000,'CURRENT_OWNER_SIZE');
export const ownerServiceReceiptV4Schema=z.union([serviceOwnerMoneyReceiptV4Schema,serviceStateReceiptV4Schema]);
export type OwnerServiceReceiptV4=z.infer<typeof ownerServiceReceiptV4Schema>;

export function matchesOwnerServiceOperationV4(operation:OwnerServiceOperationV4,receipt:OwnerServiceReceiptV4):boolean{
 const cmd=operation.command;
 if(receipt.operationId!==cmd.operationId||receipt.quoteId!==cmd.quoteId)return false;
 if(operation.action==='state')return receipt.action===operation.command.action&&'before' in receipt&&
  receipt.before.revision===operation.command.expectedQuoteRevision&&
  receipt.after.paused===(operation.command.paused??receipt.before.paused)&&
  receipt.after.state===(operation.command.cancel?'cancelled':receipt.before.state);
 if(!('result' in receipt)||receipt.action!==operation.action||receipt.entityVersion!==operation.command.expectedVersion+1)return false;
 const money=receipt.result.receipt;
 if(money.amountMinor!==operation.command.amountMinor||!same(money.allocations,operation.command.allocations))return false;
 return operation.action==='cash_date'?
  'receivedDate' in money&&money.receivedDate===operation.command.receivedDate&&money.timeZone===operation.command.timeZone:
  money.originalReceiptId===operation.command.originalReceiptId&&money.reason===operation.command.reason;
}
/** Current readback may have advanced since an original operation. It must
 * retain that offer, any original acceptance and original money byte values. */
export function sameOwnerServiceLineageV4(receipt:OwnerServiceReceiptV4,current:z.infer<typeof ownerServiceCurrentV4Schema>):boolean{
 const q=current.quote,revision='after' in receipt?receipt.after.revision:receipt.entityVersion;
 if(receipt.workspaceId!==q.workspaceId||receipt.quoteId!==q.id||receipt.familyId!==q.familyId||receipt.offerSha256!==q.offer.sha256||
  revision>q.revision||receipt.acceptanceId!==null&&receipt.acceptanceId!==q.acceptance?.id)return false;
 if('result' in receipt){
  const original=receipt.result.balance;
  if(original.lines.length!==q.lines.length||original.lines.some(l=>!q.lines.some(m=>m.id===l.lineId&&m.childId===l.childId&&same(m.period,l.period)&&m.groupId===l.groupId&&m.amountMinor===l.quotedMinor&&m.amountMinor===l.dueMinor&&m.dueAt===l.dueAt)))return false;
  return [receipt.result.receipt,...(receipt.result.originalCashReceipt?[receipt.result.originalCashReceipt]:[])].every(r=>current.balance.receipts.some(actual=>same(r,actual)));
 }
 return true;
}
const rejection=z.enum(['CONFLICT','FORBIDDEN','NOT_FOUND','UNAUTHENTICATED','INVALID_REQUEST']);
export const ownerServiceReadV4Schema=z.discriminatedUnion('state',[
 z.object({version:z.literal(BILLING_SERVICE_V4),state:z.literal('ready'),current:ownerServiceCurrentV4Schema}).strict(),
 z.object({version:z.literal(BILLING_SERVICE_V4),state:z.literal('confirmed'),operation:ownerServiceOperationV4Schema,receipt:ownerServiceReceiptV4Schema,current:ownerServiceCurrentV4Schema}).strict(),
 z.object({version:z.literal(BILLING_SERVICE_V4),state:z.literal('unresolved'),operation:ownerServiceOperationV4Schema}).strict(),
 // This proves only THIS invocation rolled back; an earlier UNKNOWN remains
 // unresolved until its own original operation is recovered.
 z.object({version:z.literal(BILLING_SERVICE_V4),state:z.literal('rejected_current_attempt'),operation:ownerServiceOperationV4Schema,code:rejection}).strict(),
]).superRefine((v,c)=>{
 if(v.state==='confirmed'&&(!matchesOwnerServiceOperationV4(v.operation,v.receipt)||!sameOwnerServiceLineageV4(v.receipt,v.current)))c.addIssue({code:'custom',message:'SERVICE_OWNER_OPERATION_LINEAGE'});
 if(bytes(v)>OWNER_SERVICE_RESPONSE_MAX_BYTES)c.addIssue({code:'custom',message:'SERVICE_OWNER_RESPONSE_SIZE'});
});
export type OwnerServiceReadV4=z.infer<typeof ownerServiceReadV4Schema>;
export {same as sameOwnerServiceValueV4};
