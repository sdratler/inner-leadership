import {ownerServiceCurrentV4Schema,sameOwnerServiceValueV4} from '../../lib/fishing-billing-owner-contract-v4.ts';
import {freezeServiceOwnerV4,prepareServiceOwnerOperationV4,type ServiceOwnerClientScopeV4} from '../../lib/fishing-billing-owner-client-v4.ts';
import {BILLING_SERVICE_V4} from '../fishing-billing/guest-service-contract-v4.ts';
import {SERVICE_STATE_ACTION_V4} from '../fishing-billing/guest-service-owner-state-contract-v4.ts';
import {calculateLedger} from '../fishing-billing/ledger-math.ts';
import type {ServiceOwnerSnapshotV4} from '../fishing-billing/guest-service-owner-financial-contract-v4.ts';
import {parseUsd,receivedDate,unallocatedAmount,money} from './model.ts';

/** Explicit V4 validation plus the existing ledger arithmetic, never a V3 DTO
 * conversion, new account ledger, financial admission or provider capability. */
export function serviceOwnerDataV4(raw:unknown,scope?:ServiceOwnerClientScopeV4):ServiceOwnerSnapshotV4{
 const data=ownerServiceCurrentV4Schema.parse(raw),q=data.quote,b=data.balance;
 if(scope&&(q.id!==scope.quoteId||q.familyId!==scope.familyId||q.workspaceId!==scope.workspaceId||q.offer.sha256!==scope.offerSha256))throw Error('SERVICE_UI_SCOPE');
 const calculated=calculateLedger(q,b.receipts,b.pendingAttemptIds);
 for(const key of ['lines','state','quotedMinor','dueMinor','paidMinor','remainingMinor','excessMinor','unallocatedMinor'] as const)
  if(!sameOwnerServiceValueV4(calculated[key],b[key]))throw Error('SERVICE_UI_LEDGER_MISMATCH');
 return freezeServiceOwnerV4(data);
}
export function serviceOwnerProgressV4(before:ServiceOwnerSnapshotV4,after:ServiceOwnerSnapshotV4){
 const a=before.quote,b=after.quote;
 if(a.id!==b.id||a.workspaceId!==b.workspaceId||a.familyId!==b.familyId||b.revision<a.revision||!sameOwnerServiceValueV4(a.offer,b.offer)||
  a.acceptance&&!sameOwnerServiceValueV4(a.acceptance,b.acceptance)||before.balance.receipts.some(r=>!after.balance.receipts.some(v=>sameOwnerServiceValueV4(r,v))))throw Error('SERVICE_UI_LINEAGE');
}
function allocations(raw:Readonly<Record<string,string>>,limits:readonly {lineId:string;available:number}[]){
 const rows=Object.entries(raw).map(([lineId,text])=>{
  const limit=limits.find(l=>l.lineId===lineId);if(!limit||typeof text!=='string')throw Error('SERVICE_ALLOCATION_SCOPE');
  const amountMinor=text.trim()===''||/^0(?:\.0{1,2})?$/.test(text.trim())?0:parseUsd(text);
  if(amountMinor===null||amountMinor>limit.available)throw Error('SERVICE_ALLOCATION_AMOUNT');return {lineId,amountMinor};
 }).filter(r=>r.amountMinor>0);
 return rows;
}
function amount(text:string){const value=parseUsd(text);if(value===null)throw Error('SERVICE_AMOUNT');return value;}
export function prepareServiceOwnerCashV4(raw:unknown,operationId:string,input:{amount:string;allocations:Readonly<Record<string,string>>;date:string}){
 const data=serviceOwnerDataV4(raw),q=data.quote;
 if(q.state!=='accepted'||data.balance.cancelled||data.balance.pendingAttemptIds.length)throw Error('SERVICE_CASH_NOT_READY');
 const rows=allocations(input.allocations,data.balance.lines.map(l=>({lineId:l.lineId,available:l.remainingMinor}))),amountMinor=amount(input.amount);
 unallocatedAmount(amountMinor,rows);
 return prepareServiceOwnerOperationV4({action:'cash_date',command:{version:BILLING_SERVICE_V4,operationId,quoteId:q.id,expectedVersion:q.revision,currency:'USD',amountMinor,
  receivedPrecision:'date',receivedDate:receivedDate(input.date),timeZone:'America/New_York',allocations:rows}});
}
export function prepareServiceOwnerReversalV4(raw:unknown,operationId:string,receiptId:string,input:{amount:string;allocations:Readonly<Record<string,string>>;reason:string}){
 const data=serviceOwnerDataV4(raw),original=data.balance.receipts.find(r=>r.id===receiptId);
 if(!original||original.kind!=='cash')throw Error('SERVICE_ORIGINAL_CASH_REQUIRED');
 const returns=data.balance.receipts.filter(r=>r.originalReceiptId===original.id),amountMinor=amount(input.amount);
 if(amountMinor>original.amountMinor-returns.reduce((s,r)=>s+r.amountMinor,0))throw Error('SERVICE_REVERSAL_AMOUNT');
 const rows=allocations(input.allocations,original.allocations.map(a=>({lineId:a.lineId,available:a.amountMinor-returns.reduce((s,r)=>s+(r.allocations.find(v=>v.lineId===a.lineId)?.amountMinor??0),0)})));
 const unallocated=unallocatedAmount(amountMinor,rows),originalUnallocated=original.amountMinor-original.allocations.reduce((s,a)=>s+a.amountMinor,0);
 if(unallocated>originalUnallocated-returns.reduce((s,r)=>s+r.amountMinor-r.allocations.reduce((n,a)=>n+a.amountMinor,0),0))throw Error('SERVICE_REVERSAL_UNALLOCATED');
 return prepareServiceOwnerOperationV4({action:'reverse_cash',command:{version:BILLING_SERVICE_V4,operationId,quoteId:data.quote.id,expectedVersion:data.quote.revision,
  originalReceiptId:original.id,amountMinor,allocations:rows,reason:input.reason}});
}
export function prepareServiceOwnerStateV4(raw:unknown,operationId:string,action:'pause'|'resume'|'cancel'){
 if(!['pause','resume','cancel'].includes(action))throw Error('SERVICE_STATE_ACTION');
 const data=serviceOwnerDataV4(raw),q=data.quote;
 if(q.state==='cancelled'||action==='pause'&&q.paused||action==='resume'&&!q.paused)throw Error('SERVICE_STATE_UNCHANGED');
 return prepareServiceOwnerOperationV4({action:'state',command:{version:BILLING_SERVICE_V4,action:SERVICE_STATE_ACTION_V4,operationId,quoteId:q.id,expectedQuoteRevision:q.revision,
  ...(action==='cancel'?{cancel:true}:{paused:action==='pause'})}});
}
/** Reuses existing USD formatting for future explicit V4 components. No new
 * rendered surface, made-up child names, amount calculation or enabled action. */
export function serviceOwnerAmountsV4(raw:unknown,locale:'en'|'he'){
 const data=serviceOwnerDataV4(raw);
 return {version:BILLING_SERVICE_V4,quoteId:data.quote.id,revision:data.quote.revision,state:data.balance.state,
  due:money(data.balance.dueMinor,locale),paid:money(data.balance.paidMinor,locale),remaining:money(data.balance.remainingMinor,locale),
  lines:data.balance.lines.map(l=>({lineId:l.lineId,childId:l.childId,period:l.period,due:money(l.dueMinor,locale),paid:money(l.paidMinor,locale),remaining:money(l.remainingMinor,locale)}))};
}
