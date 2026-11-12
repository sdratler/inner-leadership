import {z} from 'zod';
import {cardAttemptSchema,cardPreparationReceiptSchema,prepareCardCommandSchema} from '../features/fishing-billing/card-contracts.ts';
import {ownerServiceCurrentV4Schema,sameOwnerServiceValueV4} from './fishing-billing-owner-contract-v4.ts';

export const BILLING_CARD_OWNER_V4='JLFA-FISHING-OWNER-CARD-v4' as const;
export const FISHING_BILLING_CARD_OWNER_V4_PATH='/api/private/fishing-billing/card/v4';
export const OWNER_CARD_V4_MAX_RESPONSE_BYTES=4_200_000;
/** Preparation/recovery data only. Neither dispatch reservations nor provider
 * requests/URLs are browser capabilities in this unmounted protocol. */
export const ownerCardRequestV4Schema=z.object({version:z.literal(BILLING_CARD_OWNER_V4),intent:z.enum(['prepare','recover']),command:prepareCardCommandSchema}).strict();
export const ownerCardAttemptV4Schema=cardAttemptSchema.omit({checkoutUrl:true});
const projected={attempt:ownerCardAttemptV4Schema,current:ownerServiceCurrentV4Schema};
export const ownerCardReadV4Schema=z.discriminatedUnion('state',[
 z.object({version:z.literal(BILLING_CARD_OWNER_V4),state:z.literal('attempt'),...projected}).strict(),
 z.object({version:z.literal(BILLING_CARD_OWNER_V4),state:z.literal('prepared'),command:prepareCardCommandSchema,receipt:cardPreparationReceiptSchema,...projected}).strict(),
 z.object({version:z.literal(BILLING_CARD_OWNER_V4),state:z.literal('unresolved'),command:prepareCardCommandSchema}).strict(),
]).superRefine((v,c)=>{
 const fail=()=>c.addIssue({code:'custom',message:'OWNER_CARD_V4_SCOPE'});
 if(v.state!=='unresolved'){
  const a=v.attempt,q=v.current.quote,p=a.preparation;
  if(!q.acceptance||a.id!==a.command.operationId||a.quoteId!==q.id||a.command.quoteId!==q.id||a.workspaceId!==q.workspaceId||a.familyId!==q.familyId||
   p.operationId!==a.id||p.quoteId!==q.id||p.result.attemptId!==a.id||p.entityVersion!==a.command.expectedVersion+1||p.entityVersion>a.balanceVersion||a.balanceVersion>q.revision||
   p.result.amountMinor!==a.command.selection.reduce((n,l)=>n+l.amountMinor,0)||!sameOwnerServiceValueV4(p.result.allocations,a.command.selection)||
   new Set(a.command.selection.map(l=>l.lineId)).size!==a.command.selection.length||a.command.selection.some(l=>!q.lines.some(m=>m.id===l.lineId)))fail();
  if(v.state==='prepared'&&(!sameOwnerServiceValueV4(v.command,a.command)||v.receipt.operationId!==a.id||v.receipt.quoteId!==q.id||v.receipt.entityVersion!==p.entityVersion||!sameOwnerServiceValueV4(v.receipt.result,p.result)))fail();
 }
 if(new TextEncoder().encode(JSON.stringify(v)).byteLength>OWNER_CARD_V4_MAX_RESPONSE_BYTES)fail();
});
export type OwnerCardReadV4=z.infer<typeof ownerCardReadV4Schema>;
