import {BILLING_DTO_VERSION,type BillingBalance,type FamilyOffer} from './contracts.ts';
import {projectBalance,issueFamilyOffer} from './domain.ts';
import {syntheticBillingFixtures,syntheticDraft,syntheticAccepted,syntheticReceipt,syntheticId,syntheticOwner,syntheticNow} from './fixtures.ts';
export type SyntheticBillingView =
 | {state:'loading'}
 | {state:'forbidden';error:{code:'FORBIDDEN'}}
 | {state:'unavailable';error:{code:'UNAVAILABLE'};reason:'not_integrated'}
 | {state:'conflict';error:{code:'CONFLICT'};current:{quote:FamilyOffer;balance:BillingBalance}}
 | {state:'unknown';operationId:string;nextAction:'read_operation_then_refresh_balance'}
 | {state:'ready';data:{quote:FamilyOffer;balance:BillingBalance};cardState?:'pending'|'failed'};
/** Serialized data-only view fixtures, separate from production client imports.
 * Unknown/absent operation receipts never mean it is safe to use a new key. */
export function serializedBillingViewFixtures():string{
 const f=syntheticBillingFixtures(),q=syntheticAccepted(),original=syntheticReceipt('cash',10,20000,310);
 const reversal={...syntheticReceipt('cash',10,10000,311),kind:'cash_reversal' as const,originalReceiptId:original.id,reason:'SYNTHETIC correction',actorId:syntheticOwner,recordedAt:syntheticNow};
 const unready=syntheticDraft();unready.definition.policies.renewal=null;unready.lines.forEach(l=>l.dueAt=null);
 const policyNotReady=issueFamilyOffer(unready,1,syntheticNow);
 const views:Record<string,SyntheticBillingView>={
  loading:{state:'loading'},forbiddenCrossFamily:{state:'forbidden',error:{code:'FORBIDDEN'}},
  unavailable:{state:'unavailable',error:{code:'UNAVAILABLE'},reason:'not_integrated'},
  stale:{state:'conflict',error:{code:'CONFLICT'},current:f.twoChildPartial},
  unknownOperation:{state:'unknown',operationId:syntheticId(300),nextAction:'read_operation_then_refresh_balance'},
  unanswered:{state:'ready',data:f.unanswered},twoChildPartial:{state:'ready',data:f.twoChildPartial},
  policyNotReady:{state:'ready',data:{quote:policyNotReady,balance:projectBalance(policyNotReady,[])}},
  fullCash:{state:'ready',data:f.fullCash},pendingCard:{state:'ready',data:f.pendingCard,cardState:'pending'},
  failedCard:{state:'ready',data:{quote:q,balance:projectBalance(q,[])},cardState:'failed'},
  reversal:{state:'ready',data:{quote:q,balance:projectBalance(q,[original,reversal])}},
  paused:{state:'ready',data:{quote:f.paused.quote,balance:projectBalance(f.paused.quote,[])}},
  cancelled:{state:'ready',data:{quote:f.cancelled.quote,balance:projectBalance(f.cancelled.quote,[])}},
  excess:{state:'ready',data:f.overpayment},
 };
 return JSON.stringify({version:BILLING_DTO_VERSION,syntheticOnly:true,views});
}
