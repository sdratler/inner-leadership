import {z} from 'zod';
import {billingId} from '../features/fishing-billing/contracts.ts';
import {cardAttemptSchema,cardPreparationReceiptSchema,prepareCardCommandSchema} from '../features/fishing-billing/card-contracts.ts';
import {currentLedgerFrameV3Schema,type CurrentLedgerFrameV3} from './fishing-billing-current-contract-v3.ts';

/** Explicit owner transport version. Existing generic card attempt/preparation
 * records keep CARD_VERSION; historical quote/V1/V2 owner DTOs stay unchanged. */
export const BILLING_CARD_OWNER_V3='JLFA-FISHING-OWNER-CARD-v3' as const;
export const FISHING_BILLING_CARD_OWNER_V3_PATH='/api/private/fishing-billing/card/v3';
export const OWNER_CARD_V3_MAX_RESPONSE_BYTES=4_200_000;
export const billingCardOwnerCommandV3Schema=z.discriminatedUnion('action',[
 z.object({version:z.literal(BILLING_CARD_OWNER_V3),action:z.literal('prepare'),command:prepareCardCommandSchema}).strict(),
 z.object({version:z.literal(BILLING_CARD_OWNER_V3),action:z.literal('create_checkout'),command:z.object({quoteId:billingId,attemptId:billingId}).strict()}).strict(),
]);
export const billingCardOwnerAttemptV3Schema=cardAttemptSchema.omit({checkoutUrl:true});
type Attempt=z.infer<typeof billingCardOwnerAttemptV3Schema>;
/** A historical URL is not actionable. Native current permission remains a
 * prerequisite; this shape/amount check supplies no payment or legal approval. */
export function currentCardCheckoutPermittedV3(a:Attempt,current:CurrentLedgerFrameV3):boolean{
 const q=current.source.quote,b=current.balance;
 return a.state==='open'&&a.balanceVersion===q.revision&&q.state==='accepted'&&current.payableBasis!==null&&!q.paused&&!b.cancelled&&
  ['unpaid','partial'].includes(b.state)&&b.remainingMinor>0&&!b.excessMinor&&!b.missingPolicy.length&&a.command.selection.every(s=>s.amountMinor<=(b.lines.find(l=>l.lineId===s.lineId)?.remainingMinor??0));
}
const projected={attempt:billingCardOwnerAttemptV3Schema,current:currentLedgerFrameV3Schema,checkoutUrl:z.string().url().nullable()};
export const billingCardOwnerReadV3Schema=z.discriminatedUnion('state',[
 z.object({version:z.literal(BILLING_CARD_OWNER_V3),state:z.literal('attempt'),...projected}).strict(),
 z.object({version:z.literal(BILLING_CARD_OWNER_V3),state:z.literal('prepared'),receipt:cardPreparationReceiptSchema,...projected}).strict(),
 z.object({version:z.literal(BILLING_CARD_OWNER_V3),state:z.literal('unresolved'),quoteId:billingId,operationId:billingId}).strict(),
]).superRefine((v,c)=>{
 const fail=()=>c.addIssue({code:'custom',message:'OWNER_CARD_CURRENT_SCOPE'});
 if(v.state!=='unresolved'){
  const a=v.attempt,q=v.current.source.quote;
  if(q.acceptance===null||v.current.payableBasis===null)fail();
  if(a.id!==a.command.operationId||a.quoteId!==q.id||a.command.quoteId!==q.id||a.workspaceId!==q.workspaceId||a.familyId!==q.familyId||a.preparation.quoteId!==q.id||a.preparation.operationId!==a.id||a.preparation.result.attemptId!==a.id||a.preparation.entityVersion!==a.command.expectedVersion+1||a.preparation.entityVersion>a.balanceVersion||a.balanceVersion>q.revision||a.preparation.result.amountMinor!==a.command.selection.reduce((s,l)=>s+l.amountMinor,0)||JSON.stringify(a.preparation.result.allocations)!==JSON.stringify(a.command.selection)||new Set(a.command.selection.map(s=>s.lineId)).size!==a.command.selection.length||a.command.selection.some(s=>!q.lines.some(l=>l.id===s.lineId)))fail();
  if(v.state==='prepared'&&(v.receipt.operationId!==a.id||v.receipt.quoteId!==q.id||v.receipt.entityVersion!==a.preparation.entityVersion||JSON.stringify(v.receipt.result)!==JSON.stringify(a.preparation.result)))fail();
  if(v.checkoutUrl){try{const u=new URL(v.checkoutUrl);if(u.origin!=='https://checkout.stripe.com'||u.username||u.password||!currentCardCheckoutPermittedV3(a,v.current))fail();}catch{fail();}}
 }
 if(new TextEncoder().encode(JSON.stringify(v)).byteLength>OWNER_CARD_V3_MAX_RESPONSE_BYTES)fail();
});
export type BillingCardOwnerCommandV3=z.infer<typeof billingCardOwnerCommandV3Schema>;
export type BillingCardOwnerReadV3=z.infer<typeof billingCardOwnerReadV3Schema>;
