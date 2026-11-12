import {prepareCardCommandSchema,type PrepareCardCommand} from '../fishing-billing/card-contracts.ts';
import {billingCardOwnerReadSchema,type BillingCardOwnerRead} from '../../lib/fishing-billing-card-owner-contract.ts';
import type {createFishingBillingCardOwnerClient} from '../../lib/fishing-billing-card-owner-client.ts';
import {scopedData,sameScope,type BillingData,type Scope} from './model.ts';

export type CardClient=ReturnType<typeof createFishingBillingCardOwnerClient>;
export type CardCommand=PrepareCardCommand;
export type CardProjection=Extract<BillingCardOwnerRead,{state:'prepared'|'attempt'}>;
export type CardContext={
 readonly scope:Scope;readonly operationId:string;readonly attemptId:string;
 readonly command:CardCommand|null;
 phase:'preparing'|'dispatching'|'reading'|'unknown'|'ready'|'conflict'|'rejected';
 lookup:'operation'|'attempt';checkoutInvoked:boolean;fresh:boolean;
 projection?:CardProjection;code?:'INVALID_REQUEST'|'FORBIDDEN';
};
const terminal=new Set(['paid','failed','expired','stale']);
export function cardUnresolved(card:CardContext|undefined){return Boolean(card&&(['preparing','dispatching','reading','unknown'].includes(card.phase)||card.projection?.attempt.state==='unknown'||card.projection?.attempt.state==='review_required'));}
export function cardEligible(data:BillingData){
 return data.quote.state==='accepted'&&!data.quote.paused&&!data.balance.cancelled&&data.balance.remainingMinor>0&&!data.balance.excessMinor&&!data.balance.missingPolicy.length&&data.balance.state!=='review_required';
}
export function canStartCard(card:CardContext|undefined,data:BillingData){
 return cardEligible(data)&&data.balance.pendingAttemptIds.length===0&&!cardUnresolved(card)&&(!card||(!card.projection&&['conflict','rejected'].includes(card.phase))||(card.phase==='ready'&&terminal.has(card.projection?.attempt.state??'')));
}
export function cardCommand(raw:unknown,data:BillingData):CardCommand{
 const c=prepareCardCommandSchema.parse(raw);
 if(c.quoteId!==data.quote.id||c.expectedVersion!==data.balance.revision||!cardEligible(data)||new Set(c.selection.map(a=>a.lineId)).size!==c.selection.length||c.selection.some(a=>a.amountMinor>(data.balance.lines.find(l=>l.lineId===a.lineId)?.remainingMinor??0)))throw Error('INVALID_CARD_SELECTION');
 c.selection.forEach(Object.freeze);Object.freeze(c.selection);return Object.freeze(c);
}
export function cardProjection(raw:unknown,context:CardContext):CardProjection{
 const p=billingCardOwnerReadSchema.parse(raw);if(p.state==='unresolved')throw Error('UNRESOLVED_CARD');
 const a=p.attempt,d=scopedData(p.current,context.scope),prepared=a.preparation;
 if(a.id!==context.attemptId||a.command.operationId!==context.operationId||a.workspaceId!==context.scope.workspaceId||a.familyId!==context.scope.familyId||a.quoteId!==context.scope.quoteId||a.command.quoteId!==context.scope.quoteId||prepared.operationId!==context.operationId||prepared.quoteId!==a.quoteId||prepared.result.attemptId!==a.id||prepared.entityVersion!==a.command.expectedVersion+1||prepared.entityVersion>a.balanceVersion||a.balanceVersion>d.balance.revision||prepared.result.amountMinor!==a.command.selection.reduce((s,x)=>s+x.amountMinor,0)||JSON.stringify(prepared.result.allocations)!==JSON.stringify(a.command.selection)||a.command.selection.some(x=>!d.quote.lines.some(l=>l.id===x.lineId)))throw Error('INVALID_CARD_PROJECTION');
 if(context.command&&JSON.stringify(prepareCardCommandSchema.parse(a.command))!==JSON.stringify(context.command))throw Error('CARD_COMMAND_CHANGED');
 if(p.state==='prepared'&&(p.receipt.operationId!==context.operationId||p.receipt.entityVersion!==prepared.entityVersion||p.receipt.quoteId!==a.quoteId||JSON.stringify(p.receipt.result)!==JSON.stringify(prepared.result)))throw Error('INVALID_CARD_RECEIPT');
 return p;
}
export function canDispatchCard(card:CardContext|undefined,data:BillingData){
 const a=card?.projection?.attempt;
 return Boolean(card&&a&&card.phase==='ready'&&card.fresh&&!card.checkoutInvoked&&sameScope(card.scope,{quoteId:data.quote.id,familyId:data.quote.familyId,workspaceId:data.quote.workspaceId})&&a.state==='prepared'&&a.dispatchId===null&&a.sessionId===null&&a.balanceVersion===data.balance.revision&&card.projection!.current.quote.revision===data.balance.revision&&cardEligible(data)&&a.preparation.result.amountMinor<=data.balance.remainingMinor&&a.command.selection.every(x=>x.amountMinor<=(data.balance.lines.find(l=>l.lineId===x.lineId)?.remainingMinor??0)));
}
/** Only the fresh, separately projected URL is considered. Never inspect an
 * historical attempt URL, derive a URL from a session ID, or navigate here. */
export function currentCheckoutUrl(card:CardContext|undefined,data:BillingData):string|null{
 if(!card||card.phase!=='ready'||!card.fresh||!card.projection?.checkoutUrl||card.projection.attempt.state!=='open'||!sameScope(card.scope,{quoteId:data.quote.id,familyId:data.quote.familyId,workspaceId:data.quote.workspaceId})||card.projection.current.quote.revision!==data.balance.revision||card.projection.attempt.balanceVersion!==data.balance.revision||!cardEligible(data))return null;
 try{const u=new URL(card.projection.checkoutUrl);return u.origin==='https://checkout.stripe.com'&&!u.username&&!u.password?u.href:null;}catch{return null;}
}
