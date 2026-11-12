import {z} from 'zod';
import {billingId,billingInstant,familyOfferSchema,type FamilyOffer} from '../fishing-billing/contracts.ts';
import {BILLING_DTO_V2,balanceV2Schema,cashDateCommandSchema,reversalCommandV2Schema,operationReceiptV2Schema,calendarDateSchema,type BillingBalanceV2,type LedgerReceiptV2} from '../fishing-billing/contracts-v2.ts';
import {billingOwnerReadV2Schema,type BillingOwnerCommandV2,type BillingOwnerOperationReceiptV2} from '../../lib/fishing-billing-owner-contract-v2.ts';
import {billingStateCommandV2Schema} from '../fishing-billing/state-contracts-v2.ts';

export type BillingData={quote:FamilyOffer;balance:BillingBalanceV2};
export type BillingReceipt=LedgerReceiptV2;
export type BillingOperationReceipt=BillingOwnerOperationReceiptV2;
export type BillingSubject={familyId:string;label:string;children:readonly {id:string;name:string}[]};
export type BillingView=
 | {state:'loading'} | {state:'forbidden'}
 | {state:'unavailable';reason?:string}
 | {state:'unknown';operationId:string;nextAction:'read_operation_then_refresh_balance'}
 | {state:'conflict';current:BillingData}
 | {state:'ready';data:BillingData;cardState?:'pending'|'failed'};
export type CashCommand=Extract<BillingOwnerCommandV2,{action:'cash_date'}>['command'];
export type ReversalCommand=Extract<BillingOwnerCommandV2,{action:'reverse_cash'}>['command'];
export type StateCommand=Extract<BillingOwnerCommandV2,{action:'state'}>['command'];
export type MoneyCommand=CashCommand|ReversalCommand;
export type BillingCommand=MoneyCommand|StateCommand;
export type MoneyKind='cash'|'reversal';
export type CommandKind=MoneyKind|'state';
export type StateAction='pause'|'resume'|'cancel';
export type Scope={quoteId:string;familyId:string;workspaceId:string};
export type PreparationTicket={readonly scope:Scope;readonly revision:number;readonly context:object;readonly generation:symbol};
export function preparationTicket(scope:Scope,revision:number,context:object):PreparationTicket{return {scope:{...scope},revision,context,generation:Symbol('billing-dialog')};}
export const editedPreparation=(ticket:PreparationTicket)=>preparationTicket(ticket.scope,ticket.revision,ticket.context);
export function samePreparation(current:PreparationTicket,captured:PreparationTicket){return current.generation===captured.generation&&current.context===captured.context&&current.revision===captured.revision&&sameScope(current.scope,captured.scope);}
export type CommandOutcome=
 | {kind:'confirmed';receipt:BillingOperationReceipt;current:BillingData}
 | {kind:'conflict';current:BillingData}
 | {kind:'rejected';code:'INVALID_REQUEST'|'FORBIDDEN'|'UNAVAILABLE'}
 | {kind:'unknown'};
/** Root supplies the authenticated HTTP adapter. No URL, fetch, provider or
 * storage implementation belongs to this unmounted presentation slice. */
export interface BillingUiPorts{
 recordCashDate(command:CashCommand):Promise<CommandOutcome>;
 reverseCash(command:ReversalCommand):Promise<CommandOutcome>;
 /** Absent means unavailable, independently of the default-off UI capability. */
 setState?(command:StateCommand):Promise<CommandOutcome>;
 readOperation(operationId:string):Promise<{receipt:BillingOperationReceipt;current:BillingData}|null>;
 readBalance(quoteId:string):Promise<BillingData>;
 nextOperationId():string;
}
export function decodeData(raw:unknown):BillingData{
 const {quote,balance}=z.object({quote:familyOfferSchema,balance:balanceV2Schema}).parse(raw);
 if(quote.id!==balance.quoteId||quote.familyId!==balance.familyId||quote.revision!==balance.revision||quote.paused!==balance.paused||balance.cancelled!==(quote.state==='cancelled')||
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
export function unallocatedAmount(amount:number,allocations:readonly {amountMinor:number}[]){
 const allocated=allocations.reduce((sum,line)=>sum+line.amountMinor,0);
 if(!Number.isSafeInteger(amount)||amount<=0||allocations.some(a=>!Number.isSafeInteger(a.amountMinor)||a.amountMinor<0)||allocated>amount)throw Error('INVALID_ALLOCATION_TOTAL');
 return amount-allocated;
}
export const money=(minor:number,locale:'en'|'he')=>new Intl.NumberFormat(locale==='he'?'he-IL':'en-US',{style:'currency',currency:'USD',currencyDisplay:'code'}).format(minor/100);
export function floridaDate(instant:string):string{
 billingInstant.parse(instant);const p=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(instant));
 return ['year','month','day'].map(k=>p.find(x=>x.type===k)!.value).join('-');
}
/** Calendar validation only. Never manufacture an instant from an owner date. */
export const receivedDate=(value:string)=>calendarDateSchema.parse(value);
export function confirmedReceipt(raw:unknown,scope:Scope,command:BillingCommand,kind:CommandKind){
 const r=operationReceiptV2Schema.parse(raw),d=scopedData(r.result,scope);
 if(r.version!==BILLING_DTO_V2||r.operationId!==command.operationId||r.entityId!==scope.quoteId||
  r.entityVersion!==d.quote.revision||r.entityVersion<=command.expectedVersion)throw Error('INVALID_OPERATION_RECEIPT');
 if(kind==='state'){
  const state=billingStateCommandV2Schema.parse(command);
  if(r.result.receiptId!==null||(state.paused!==undefined&&d.quote.paused!==state.paused)||(state.cancel&&d.quote.state!=='cancelled'))throw Error('INVALID_STATE_RECEIPT');
 }else if(!r.result.receiptId)throw Error('INVALID_OPERATION_RECEIPT');
 // A command receipt is not an authenticated complete ledger-history port.
 if(kind==='reversal'&&!('originalReceiptId' in command))throw Error('INVALID_OPERATION_RECEIPT');
 return r;
}
export function commandFor(kind:'cash',raw:unknown):CashCommand;
export function commandFor(kind:'reversal',raw:unknown):ReversalCommand;
export function commandFor(kind:'state',raw:unknown):StateCommand;
export function commandFor(kind:CommandKind,raw:unknown):BillingCommand;
export function commandFor(kind:CommandKind,raw:unknown):BillingCommand{
 const c=kind==='cash'?cashDateCommandSchema.parse(raw):kind==='reversal'?reversalCommandV2Schema.parse(raw):Object.freeze(billingStateCommandV2Schema.parse(raw));billingId.parse(c.operationId);return c;
}
export function prepareStateCommand(action:StateAction,data:BillingData,operationId:string):StateCommand{
 if(data.balance.cancelled||(action==='pause'&&data.balance.paused)||(action==='resume'&&!data.balance.paused))throw Error('STATE_ACTION_UNAVAILABLE');
 return commandFor('state',{version:BILLING_DTO_V2,operationId,quoteId:data.quote.id,expectedVersion:data.balance.revision,...(action==='cancel'?{cancel:true}:{paused:action==='pause'})});
}
/** Pure seam helpers only; Root owns authenticated transport and mounting. */
export function ownerOperationResult(raw:unknown):{receipt:BillingOperationReceipt;current:BillingData}|null{
 const read=billingOwnerReadV2Schema.parse(raw);
 return read.state==='confirmed'?{receipt:read.receipt,current:decodeData(read.current)}:null;
}
