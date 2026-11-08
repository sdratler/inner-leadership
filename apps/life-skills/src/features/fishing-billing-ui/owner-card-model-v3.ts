import {prepareCardCommandSchema,type PrepareCardCommand} from '../fishing-billing/card-contracts.ts';
import {BILLING_CARD_OWNER_V3,billingCardOwnerReadV3Schema,currentCardCheckoutPermittedV3,type BillingCardOwnerReadV3} from '../../lib/fishing-billing-card-owner-contract-v3.ts';
import {currentLedgerFrameV3Schema,type CurrentLedgerFrameV3} from '../../lib/fishing-billing-current-contract-v3.ts';
import {ownerCurrentV3Schema} from '../../lib/fishing-billing-owner-contract-v3.ts';
import type {createFishingBillingCardOwnerClientV3} from '../../lib/fishing-billing-card-owner-client-v3.ts';
import type {GuestOwnerSnapshotV3} from '../../lib/fishing-billing-guest-contract-v3.ts';
import {dataScope,sameScope,type Scope} from './owner-model.ts';

type Client=ReturnType<typeof createFishingBillingCardOwnerClientV3>;
export type GuestCardPorts=Client&{readonly version:typeof BILLING_CARD_OWNER_V3};
/** Explicit composition capability; no default transport/auth/storage/IDs. */
export function guestCardPorts(client:Client):GuestCardPorts{return Object.freeze({...client,version:BILLING_CARD_OWNER_V3});}
export function isGuestCardPorts(client:GuestCardPorts|null):client is GuestCardPorts{return client?.version===BILLING_CARD_OWNER_V3;}
export type GuestCardProjection=Extract<BillingCardOwnerReadV3,{state:'prepared'|'attempt'}>;
export type GuestCardContext={
 readonly version:typeof BILLING_CARD_OWNER_V3;readonly scope:Scope;readonly operationId:string;readonly attemptId:string;
 readonly basis:GuestOwnerSnapshotV3;readonly command:PrepareCardCommand|null;
 phase:'preparing'|'dispatching'|'reading'|'unknown'|'ready'|'conflict'|'rejected';
 lookup:'operation'|'attempt';checkoutInvoked:boolean;fresh:boolean;
 projection?:GuestCardProjection;code?:'INVALID_REQUEST'|'FORBIDDEN';
};
export function guestCardContext(data:GuestOwnerSnapshotV3,operationId:string,command:PrepareCardCommand|null):GuestCardContext{
 const basis=ownerCurrentV3Schema.parse(data);return {version:BILLING_CARD_OWNER_V3,scope:dataScope(basis),basis,operationId,attemptId:operationId,command,phase:command?'preparing':'reading',lookup:command?'operation':'attempt',checkoutInvoked:false,fresh:false};
}
const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
export function guestCardUnresolved(card:GuestCardContext|undefined){return Boolean(card&&(['preparing','dispatching','reading','unknown'].includes(card.phase)||['unknown','review_required'].includes(card.projection?.attempt.state??'')));}
export function guestCardEligible(data:GuestOwnerSnapshotV3){return data.quote.state==='accepted'&&data.quote.acceptance!==null&&!data.quote.paused&&!data.balance.cancelled&&['unpaid','partial'].includes(data.balance.state)&&data.balance.remainingMinor>0&&!data.balance.excessMinor&&!data.balance.missingPolicy.length;}
export function guestCardCommand(raw:unknown,data:GuestOwnerSnapshotV3):PrepareCardCommand{
 const c=prepareCardCommandSchema.parse(raw);
 if(c.quoteId!==data.quote.id||c.expectedVersion!==data.balance.revision||!guestCardEligible(data)||new Set(c.selection.map(a=>a.lineId)).size!==c.selection.length||c.selection.some(a=>a.amountMinor>(data.balance.lines.find(l=>l.lineId===a.lineId)?.remainingMinor??0)))throw Error('INVALID_GUEST_CARD_SELECTION');
 c.selection.forEach(Object.freeze);Object.freeze(c.selection);return Object.freeze(c);
}
export function guestCardCurrent(raw:CurrentLedgerFrameV3):GuestOwnerSnapshotV3{
 const f=currentLedgerFrameV3Schema.parse(raw);if(f.source.kind!=='guest_successor')throw Error('GUEST_CARD_SOURCE_MISMATCH');
 return ownerCurrentV3Schema.parse({quote:f.source.quote,balance:f.balance,receiptId:null});
}
/** Preserve immutable financial acceptance and every already-observed receipt;
 * original preparation is not a source for today's balances or ledger. */
export function guestCardLineage(basis:GuestOwnerSnapshotV3,current:GuestOwnerSnapshotV3){
 const a=basis.quote,b=current.quote;
 if(!sameScope(dataScope(basis),dataScope(current))||b.revision<a.revision||!a.acceptance||!equal(a.acceptance,b.acceptance)||!equal(a.definition,b.definition)||!equal(a.lines,b.lines)||!equal(a.override,b.override)||a.createdAt!==b.createdAt||a.issuedAt!==b.issuedAt||basis.balance.receipts.some(r=>!equal(r,current.balance.receipts.find(s=>s.id===r.id))))throw Error('GUEST_CARD_LINEAGE_MISMATCH');
}
export function guestCardProjection(raw:unknown,context:GuestCardContext):GuestCardProjection{
 const p=billingCardOwnerReadV3Schema.parse(raw);if(p.state==='unresolved')throw Error('UNRESOLVED_GUEST_CARD');
 const a=p.attempt,current=guestCardCurrent(p.current);guestCardLineage(context.basis,current);
 if(!sameScope(context.scope,dataScope(current))||a.id!==context.attemptId||a.command.operationId!==context.operationId||context.command&&!equal(prepareCardCommandSchema.parse(a.command),context.command))throw Error('GUEST_CARD_COMMAND_CHANGED');
 return p;
}
function fresh(card:GuestCardContext,data:GuestOwnerSnapshotV3){
 if(card.phase!=='ready'||!card.fresh||!card.projection||!sameScope(card.scope,dataScope(data)))return false;
 try{const current=guestCardCurrent(card.projection.current);guestCardLineage(card.basis,data);return equal(current.quote,data.quote)&&equal(current.balance,data.balance);}catch{return false;}
}
export function canStartGuestCard(card:GuestCardContext|undefined,data:GuestOwnerSnapshotV3){return guestCardEligible(data)&&data.balance.pendingAttemptIds.length===0&&!guestCardUnresolved(card)&&(!card||!card.projection&&['conflict','rejected'].includes(card.phase)||card.phase==='ready'&&['paid','failed','expired','stale'].includes(card.projection?.attempt.state??''));}
export function canDispatchGuestCard(card:GuestCardContext|undefined,data:GuestOwnerSnapshotV3){
 const a=card?.projection?.attempt;
 return Boolean(card&&a&&fresh(card,data)&&!card.checkoutInvoked&&a.state==='prepared'&&a.dispatchId===null&&a.sessionId===null&&a.balanceVersion===data.balance.revision&&guestCardEligible(data)&&a.command.selection.every(s=>s.amountMinor<=(data.balance.lines.find(l=>l.lineId===s.lineId)?.remainingMinor??0)));
}
/** Root supplies the sole actionable URL separately from the historical attempt. */
export function guestCheckoutUrl(card:GuestCardContext|undefined,data:GuestOwnerSnapshotV3):string|null{
 if(!card||!fresh(card,data)||!card.projection?.checkoutUrl||!guestCardEligible(data)||!currentCardCheckoutPermittedV3(card.projection.attempt,card.projection.current))return null;
 try{const u=new URL(card.projection.checkoutUrl);return u.origin==='https://checkout.stripe.com'&&!u.username&&!u.password?u.href:null;}catch{return null;}
}
