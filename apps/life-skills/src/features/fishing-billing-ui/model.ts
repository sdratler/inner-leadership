import {z} from 'zod';
import {BILLING_DTO_VERSION,billingId,billingInstant,familyOfferSchema,balanceSchema,cashCommandSchema,reversalCommandSchema,operationReceiptSchema,type FamilyOffer,type BillingBalance,type BillingOperationReceipt} from '../fishing-billing/contracts.ts';
import {billingOwnerReadSchema,type BillingOwnerCommand} from '../../lib/fishing-billing-owner-contract.ts';

export type BillingData={quote:FamilyOffer;balance:BillingBalance};
export type BillingSubject={familyId:string;label:string;children:readonly {id:string;name:string}[]};
export type BillingView=
 | {state:'loading'} | {state:'forbidden'}
 | {state:'unavailable';reason?:string}
 | {state:'unknown';operationId:string;nextAction:'read_operation_then_refresh_balance'}
 | {state:'conflict';current:BillingData}
 | {state:'ready';data:BillingData;cardState?:'pending'|'failed'};
export type CashCommand=Extract<BillingOwnerCommand,{action:'cash'}>['command'];
export type ReversalCommand=Extract<BillingOwnerCommand,{action:'reverse_cash'}>['command'];
export type BillingCommand=CashCommand|ReversalCommand;
export type CommandKind='cash'|'reversal';
export type Scope={quoteId:string;familyId:string;workspaceId:string};
export type CommandOutcome=
 | {kind:'confirmed';receipt:BillingOperationReceipt;current:BillingData}
 | {kind:'conflict';current:BillingData}
 | {kind:'rejected';code:'INVALID_REQUEST'|'FORBIDDEN'|'UNAVAILABLE'}
 | {kind:'unknown'};
/** Root supplies the authenticated HTTP adapter. No URL, fetch, provider or
 * storage implementation belongs to this unmounted presentation slice. */
export interface BillingUiPorts{
 recordCash(command:CashCommand):Promise<CommandOutcome>;
 reverseCash(command:ReversalCommand):Promise<CommandOutcome>;
 readOperation(operationId:string):Promise<{receipt:BillingOperationReceipt;current:BillingData}|null>;
 readBalance(quoteId:string):Promise<BillingData>;
 nextOperationId():string;
 /** v1 bridge may return a KNOWN exact instant only. A date alone cannot be
  * converted to a guessed midnight/noon/now. Return null until admitted. */
 resolveReceivedDate(date:string):Promise<{receivedAt:string;observedAt:string}|null>;
}
export function decodeData(raw:unknown):BillingData{
 const {quote,balance}=z.object({quote:familyOfferSchema,balance:balanceSchema}).parse(raw);
 if(quote.id!==balance.quoteId||quote.familyId!==balance.familyId||quote.revision!==balance.revision||
  quote.lines.length!==balance.lines.length||quote.lines.some(l=>!balance.lines.some(b=>b.lineId===l.id&&b.childId===l.childId&&b.period.id===l.period.id)))throw Error('INVALID_BILLING_SNAPSHOT');
 return {quote,balance};
}
export function scopedData(raw:unknown,scope:Scope):BillingData{
 const d=decodeData(raw);
 if(d.quote.id!==scope.quoteId||d.quote.familyId!==scope.familyId||d.quote.workspaceId!==scope.workspaceId)throw Error('BILLING_SCOPE_MISMATCH');
 return d;
}
export const dataScope=(d:BillingData):Scope=>({quoteId:d.quote.id,familyId:d.quote.familyId,workspaceId:d.quote.workspaceId});
export const sameScope=(a:Scope,b:Scope)=>a.quoteId===b.quoteId&&a.familyId===b.familyId&&a.workspaceId===b.workspaceId;
export function validateSubject(subject:BillingSubject,d:BillingData){
 return subject.familyId===d.quote.familyId&&new Set(subject.children.map(c=>c.id)).size===subject.children.length&&
  d.quote.lines.every(l=>subject.children.some(c=>c.id===l.childId&&c.name.trim()));
}
export function parseUsd(value:string):number|null{
 if(!/^(?:0|[1-9][0-9]{0,6})(?:\.[0-9]{1,2})?$/.test(value.trim()))return null;
 const [whole,fraction='']=value.trim().split('.');const amount=Number(whole)*100+Number(fraction.padEnd(2,'0'));
 return Number.isSafeInteger(amount)&&amount>0&&amount<=100_000_000?amount:null;
}
export const inputUsd=(minor:number)=>(minor/100).toFixed(2);
export const money=(minor:number,locale:'en'|'he')=>new Intl.NumberFormat(locale==='he'?'he-IL':'en-US',{style:'currency',currency:'USD',currencyDisplay:'code'}).format(minor/100);
export function floridaDate(instant:string):string{
 billingInstant.parse(instant);const p=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(instant));
 return ['year','month','day'].map(k=>p.find(x=>x.type===k)!.value).join('-');
}
export function resolvedReceivedDate(date:string,raw:{receivedAt:string;observedAt:string}):string{
 billingInstant.parse(raw.receivedAt);billingInstant.parse(raw.observedAt);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||floridaDate(raw.receivedAt)!==date||Date.parse(raw.receivedAt)>Date.parse(raw.observedAt))throw Error('INVALID_RECEIVED_DATE');
 return raw.receivedAt;
}
export function confirmedReceipt(raw:unknown,scope:Scope,command:BillingCommand,kind:CommandKind){
 const r=operationReceiptSchema.parse(raw),d=scopedData(r.result,scope);
 if(r.version!==BILLING_DTO_VERSION||r.operationId!==command.operationId||r.entityId!==scope.quoteId||
  r.entityVersion!==d.quote.revision||r.entityVersion<=command.expectedVersion||!r.result.receiptId)throw Error('INVALID_OPERATION_RECEIPT');
 // A command receipt is not an authenticated complete ledger-history port.
 if(kind==='reversal'&&!('originalReceiptId' in command))throw Error('INVALID_OPERATION_RECEIPT');
 return r;
}
export function commandFor(kind:CommandKind,raw:unknown):BillingCommand{
 const c=kind==='cash'?cashCommandSchema.parse(raw):reversalCommandSchema.parse(raw);billingId.parse(c.operationId);return c;
}
/** Pure seam helpers only; Root owns authenticated transport and mounting. */
export function ownerOperationResult(raw:unknown):{receipt:BillingOperationReceipt;current:BillingData}|null{
 const read=billingOwnerReadSchema.parse(raw);
 return read.state==='confirmed'?{receipt:read.receipt,current:decodeData(read.current)}:null;
}
