/** Versioned UI boundary. Legacy account DTOs are not guest DTOs, and compact
 * original operations are never treated as a current full ledger. */
import {BILLING_DTO_VERSION} from '../fishing-billing/contracts.ts';
import {BILLING_DTO_V2} from '../fishing-billing/contracts-v2.ts';
import {BILLING_GUEST_V3,type GuestOwnerSnapshotV3} from '../../lib/fishing-billing-guest-contract-v3.ts';
import {OWNER_MONEY_V3,ownerCurrentV3Schema,ownerMoneyReceiptV3Schema,guestCashDateCommandSchema,guestReversalCommandSchema,guestStateCommandSchema,sameGuestOwnerLineage,type BillingOwnerCommandV3,type OwnerMoneyReceiptV3} from '../../lib/fishing-billing-owner-contract-v3.ts';
import type {createFishingBillingOwnerClientV3} from '../../lib/fishing-billing-owner-client-v3.ts';
import * as legacy from './model.ts';
export {inputUsd,money,parseUsd,floridaDate,receivedDate,unallocatedAmount,preparationTicket,editedPreparation,samePreparation,sameScope} from './model.ts';
export type {BillingReceipt,BillingSubject,Scope,PreparationTicket,MoneyKind,CommandKind,StateAction} from './model.ts';
export type LegacyBillingData=legacy.BillingData;
export type BillingData=legacy.BillingData|GuestOwnerSnapshotV3;
export type GuestMoneyClient=ReturnType<typeof createFishingBillingOwnerClientV3>;
export type GuestMoneyPorts=GuestMoneyClient&{readonly version:typeof OWNER_MONEY_V3;nextOperationId():string};
export type BillingUiPorts=legacy.BillingUiPorts|GuestMoneyPorts;
export type CashCommand=legacy.CashCommand|Extract<BillingOwnerCommandV3,{action:'cash_date'}>['command'];
export type ReversalCommand=legacy.ReversalCommand|Extract<BillingOwnerCommandV3,{action:'reverse_cash'}>['command'];
export type StateCommand=legacy.StateCommand|Extract<BillingOwnerCommandV3,{action:'state'}>['command'];
export type MoneyCommand=CashCommand|ReversalCommand;
export type BillingCommand=MoneyCommand|StateCommand;
export type BillingOperationReceipt=legacy.BillingOperationReceipt|OwnerMoneyReceiptV3;
export type BillingView=legacy.BillingView|{state:'ready';data:GuestOwnerSnapshotV3;cardState?:'pending'|'failed'}|{state:'conflict';current:GuestOwnerSnapshotV3};
/** The reviewed client is provided by composition. No fetch, auth, storage,
 * operation-ID generator or retry implementation is supplied by this facade. */
export function guestMoneyPorts(client:GuestMoneyClient,nextOperationId:()=>string):GuestMoneyPorts{return Object.freeze({...client,version:OWNER_MONEY_V3,nextOperationId});}
export function isGuestPorts(ports:BillingUiPorts):ports is GuestMoneyPorts{return 'version' in ports&&ports.version===OWNER_MONEY_V3;}
export function isLegacyData(data:BillingData):data is legacy.BillingData{return data.quote.version===BILLING_DTO_VERSION&&data.balance.version===BILLING_DTO_V2;}
export function isGuestData(data:BillingData):data is GuestOwnerSnapshotV3{return data.quote.version===BILLING_GUEST_V3&&data.balance.version===BILLING_GUEST_V3;}
export const moneyVersion=(data:BillingData)=>isGuestData(data)?OWNER_MONEY_V3:BILLING_DTO_V2;
export function decodeData(raw:unknown):BillingData{
 if(typeof raw==='object'&&raw!==null&&'quote' in raw&&typeof raw.quote==='object'&&raw.quote!==null&&'version' in raw.quote&&raw.quote.version===BILLING_GUEST_V3)return ownerCurrentV3Schema.parse(raw);
 return legacy.decodeData(raw);
}
export const dataScope=(data:BillingData):legacy.Scope=>({quoteId:data.quote.id,familyId:data.quote.familyId,workspaceId:data.quote.workspaceId});
export function scopedData(raw:unknown,scope:legacy.Scope):BillingData{
 const data=decodeData(raw);if(!legacy.sameScope(dataScope(data),scope))throw Error('BILLING_SCOPE_MISMATCH');return data;
}
export function validateSubject(subject:legacy.BillingSubject,data:BillingData){return subject.familyId===data.quote.familyId&&new Set(subject.children.map(c=>c.id)).size===subject.children.length&&data.quote.lines.every(l=>subject.children.some(c=>c.id===l.childId&&c.name.trim()));}
export function commandFor(kind:'cash',raw:unknown):CashCommand;
export function commandFor(kind:'reversal',raw:unknown):ReversalCommand;
export function commandFor(kind:'state',raw:unknown):StateCommand;
export function commandFor(kind:legacy.CommandKind,raw:unknown):BillingCommand;
export function commandFor(kind:legacy.CommandKind,raw:unknown):BillingCommand{
 if(typeof raw==='object'&&raw!==null&&'version' in raw&&raw.version===OWNER_MONEY_V3)return kind==='cash'?guestCashDateCommandSchema.parse(raw):kind==='reversal'?guestReversalCommandSchema.parse(raw):Object.freeze(guestStateCommandSchema.parse(raw));
 return legacy.commandFor(kind,raw);
}
export function prepareStateCommand(action:legacy.StateAction,data:legacy.BillingData,operationId:string):legacy.StateCommand;
export function prepareStateCommand(action:legacy.StateAction,data:GuestOwnerSnapshotV3,operationId:string):Extract<BillingOwnerCommandV3,{action:'state'}>['command'];
export function prepareStateCommand(action:legacy.StateAction,data:BillingData,operationId:string):StateCommand;
export function prepareStateCommand(action:legacy.StateAction,data:BillingData,operationId:string):StateCommand{
 if(isLegacyData(data))return legacy.prepareStateCommand(action,data,operationId);
 if(data.balance.cancelled||action==='pause'&&data.balance.paused||action==='resume'&&!data.balance.paused)throw Error('STATE_ACTION_UNAVAILABLE');
 return commandFor('state',{version:OWNER_MONEY_V3,operationId,quoteId:data.quote.id,expectedVersion:data.quote.revision,...(action==='cancel'?{cancel:true}:{paused:action==='pause'})});
}
export function confirmedReceipt(raw:unknown,scope:legacy.Scope,command:BillingCommand,kind:legacy.CommandKind):BillingOperationReceipt{
 if(command.version!==OWNER_MONEY_V3)return legacy.confirmedReceipt(raw,scope,command,kind);
 const r=ownerMoneyReceiptV3Schema.parse(raw),q=r.result.quote,action=kind==='cash'?'cash_date':kind==='reversal'?'reverse_cash':'state';
 if(!legacy.sameScope({quoteId:q.id,familyId:q.familyId,workspaceId:q.workspaceId},scope)||r.operationId!==command.operationId||r.action!==action||r.entityVersion!==command.expectedVersion+1)throw Error('INVALID_GUEST_OPERATION_RECEIPT');
 if(kind==='state'){
  const c=guestStateCommandSchema.parse(command);
  if(c.paused!==undefined&&q.paused!==c.paused||c.cancel&&q.state!=='cancelled')throw Error('INVALID_GUEST_STATE_RECEIPT');
 }else{
  const c=kind==='cash'?guestCashDateCommandSchema.parse(command):guestReversalCommandSchema.parse(command),fact=r.result.relatedReceipts.find(x=>x.id===r.result.receiptId);
  if(!fact||fact.amountMinor!==c.amountMinor||JSON.stringify(fact.allocations)!==JSON.stringify(c.allocations))throw Error('GUEST_RECEIPT_ANSWERS_CHANGED');
  if('receivedDate' in c){if(!('receivedDate' in fact)||fact.receivedDate!==c.receivedDate||fact.timeZone!==c.timeZone||fact.currency!==c.currency)throw Error('GUEST_RECEIVED_DATE_CHANGED');}
  else if(fact.originalReceiptId!==c.originalReceiptId||fact.reason!==c.reason)throw Error('GUEST_CORRECTION_CHANGED');
 }
 return r;
}
export function verifyCurrentLineage(receipt:BillingOperationReceipt,data:BillingData){
 if(receipt.version===OWNER_MONEY_V3){if(!isGuestData(data)||!sameGuestOwnerLineage(receipt.result,data))throw Error('CURRENT_GUEST_LINEAGE_MISMATCH');}
 else if(!isLegacyData(data))throw Error('CURRENT_ACCOUNT_VERSION_MISMATCH');
}
