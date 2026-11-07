/** SYNTHETIC ONLY. Dates, policy references, persons and amounts are fixtures,
 * never approved business defaults or real customer/provider evidence. */
import {BILLING_DTO_VERSION,publishedOfferSchema,type LedgerReceipt} from './contracts.ts';
import {createFamilyOffer,issueFamilyOffer,acceptFamilyOffer,projectBalance,changeBillingState} from './domain.ts';
export const syntheticId=(n:number)=>'00000000-0000-4000-8000-'+n.toString(16).padStart(12,'0');
export const syntheticNow='2035-01-02T15:00:00.000Z';
export const syntheticOwner=syntheticId(1),syntheticGuardian=syntheticId(2),syntheticWorkspace=syntheticId(3),syntheticFamily=syntheticId(4);
export function syntheticDefinition(){
 const ref={id:'SYNTHETIC-UNAPPROVED-POLICY',sha256:'a'.repeat(64)};
 return publishedOfferSchema.parse({
  version:BILLING_DTO_VERSION,id:syntheticId(5),programKey:'fishing_monthly_club',environment:'test',
  currency:'USD',unitAmountMinor:65000,effectiveAt:'2035-01-01T00:00:00Z',publishedAt:'2034-12-01T00:00:00Z',
  publishedBy:syntheticOwner,source:ref,terms:ref,policies:Object.fromEntries(['service_period','proration','renewal','cancellation','weather','payment_due'].map(k=>[k,ref])),
 });
}
export function syntheticDraft(){
 return createFamilyOffer(syntheticDefinition(),{
  operationId:syntheticId(6),id:syntheticId(7),familyId:syntheticFamily,definitionId:syntheticId(5),override:null,
  children:[10,11].map(n=>({
   lineId:syntheticId(n),childId:syntheticId(n+10),groupId:null,
   period:{id:syntheticId(30),startsAt:'2035-01-01T05:00:00Z',endsAt:'2035-02-01T05:00:00Z',timeZone:'America/New_York'},
   dueAt:'2035-01-05T22:00:00Z',
  })),
 },{workspaceId:syntheticWorkspace,actorId:syntheticOwner,now:syntheticNow});
}
export function syntheticAccepted(){
 const q=issueFamilyOffer(syntheticDraft(),1,syntheticNow);
 return acceptFamilyOffer(q,2,syntheticGuardian,q.definition.terms,syntheticNow);
}
export function syntheticReceipt(kind:'cash'|'card',line:number,amountMinor:number,n:number):LedgerReceipt{
 return {id:syntheticId(n),operationId:syntheticId(n+1000),quoteId:syntheticId(7),familyId:syntheticFamily,
  kind,amountMinor,currency:'USD',allocations:[{lineId:syntheticId(line),amountMinor}],
  originalReceiptId:null,actorId:kind==='cash'?syntheticOwner:null,receivedAt:syntheticNow,recordedAt:syntheticNow,reason:null,
  provider:kind==='card'?{accountId:'acct_SYNTHETIC',mode:'test',transactionId:'pi_SYNTHETIC'+n}:null};
}
export function syntheticBillingFixtures(){
 const accepted=syntheticAccepted(),partialReceipts=[syntheticReceipt('card',10,65000,50),syntheticReceipt('cash',11,20000,51)];
 const issued=issueFamilyOffer(syntheticDraft(),1,syntheticNow);
 return {
  version:BILLING_DTO_VERSION,syntheticOnly:true as const,
  unanswered:{quote:issued,balance:projectBalance(issued,[])},
  twoChildPartial:{quote:accepted,balance:projectBalance(accepted,partialReceipts)},
  fullCash:{quote:accepted,balance:projectBalance(accepted,[syntheticReceipt('cash',10,65000,52),syntheticReceipt('cash',11,65000,53)])},
  pendingCard:{quote:accepted,balance:projectBalance(accepted,[],[syntheticId(60)])},
  overpayment:{quote:accepted,balance:projectBalance(accepted,[...partialReceipts,syntheticReceipt('card',10,65000,54)])},
  paused:{quote:changeBillingState(accepted,3,{paused:true})},
  cancelled:{quote:changeBillingState(accepted,3,{cancel:true})},
  unavailable:{version:BILLING_DTO_VERSION,state:'unavailable' as const,reason:'not_integrated' as const,missingPolicy:[]},
  unknownReminder:{state:'unknown' as const,providerId:null,retryPermitted:false as const},
 };
}

