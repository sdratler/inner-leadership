import 'server-only';
import {syntheticDefinition,syntheticDraft,syntheticId,syntheticNow,syntheticOwner,syntheticWorkspace} from '../../src/features/fishing-billing/fixtures.ts';
import {dateCashReceiptSchema,ledgerReceiptV2Schema,type LedgerReceiptV2} from '../../src/features/fishing-billing/contracts-v2.ts';
import {createGuestFamilyOffer,issueGuestFamilyOffer,acceptGuestFamilyOffer,changeGuestBillingState,projectGuestBalanceV3} from '../../src/features/fishing-billing/guest-domain-v3.ts';
import {BILLING_GUEST_V3,type GuestFamilyOffer} from '../../src/lib/fishing-billing-guest-contract-v3.ts';
import {bindGuestIssuedMaterial,bindGuestDisplayBundle} from '../../src/lib/fishing-billing-guest-material-v3.ts';
import {OWNER_MONEY_V3,ownerCurrentV3Schema,ownerMoneyReceiptV3Schema,billingOwnerReadV3Schema,compactOwnerOperationResultV3} from '../../src/lib/fishing-billing-owner-contract-v3.ts';

/** TEST DATA ONLY. Pure, deterministic, server-side fixture construction; no
 * native journal/export, real parent, source/legal approval, session, provider
 * or effect evidence. Never import this module in production/client code. The
 * actual Native/HTTP/client memory proofs are separate executed tests. */
export function syntheticGuestOwnerMoneyFixturesV3(){
 const oldCommandShape=syntheticDraft(),draft=createGuestFamilyOffer(syntheticDefinition(),{
  operationId:syntheticId(960),id:syntheticId(961),familyId:oldCommandShape.familyId,definitionId:oldCommandShape.definition.id,override:null,
  children:oldCommandShape.lines.map(l=>({lineId:l.id,childId:l.childId,groupId:l.groupId,period:l.period,dueAt:l.dueAt})),
 },{workspaceId:syntheticWorkspace,actorId:syntheticOwner,now:syntheticNow}),issued=issueGuestFamilyOffer(draft,1,syntheticNow);
 const offer=bindGuestIssuedMaterial({workspaceId:issued.workspaceId,familyId:issued.familyId,quoteId:issued.id,issuedRevision:issued.revision,definition:issued.definition,lines:issued.lines,createdAt:issued.createdAt,issuedAt:issued.issuedAt,override:issued.override});
 const displayed=bindGuestDisplayBundle({id:syntheticId(962),version:'SYNTHETIC-UI-ONLY-NOT-RELEASED',locale:'he',offerSnapshotSha256:offer.sha256,documents:[{purpose:'financial_terms',source:issued.definition.terms,displayedTextSha256:'b'.repeat(64),releaseEvidenceId:syntheticId(963)}]});
 const accepted=acceptGuestFamilyOffer(issued,2,{version:BILLING_GUEST_V3,id:syntheticId(964),kind:'guest_grant',grantId:syntheticId(965),offer,displayed,parent:{submittedName:'SYNTHETIC PARENT ONLY',guardianAuthorityAttested:true,financialTermsAffirmed:true,statementSha256:'c'.repeat(64),privateEvidenceId:syntheticId(964)},assuranceEvidenceId:syntheticId(966),operationId:syntheticId(967),acceptedAt:syntheticNow});
 const snapshot=(quote:GuestFamilyOffer,receipts:LedgerReceiptV2[],pendingAttemptIds:string[]=[],reminders:ReturnType<typeof ownerCurrentV3Schema.parse>['balance']['reminders']=[])=>ownerCurrentV3Schema.parse({quote,balance:{...projectGuestBalanceV3(quote,receipts,pendingAttemptIds),reminders},receiptId:null});
 const cash=(n:number,line:number,amountMinor:number)=>dateCashReceiptSchema.parse({id:syntheticId(n),operationId:syntheticId(n+1000),quoteId:accepted.id,familyId:accepted.familyId,kind:'cash',currency:'USD',amountMinor,allocations:[{lineId:accepted.lines[line]!.id,amountMinor}],actorId:syntheticOwner,provider:null,reason:null,originalReceiptId:null,receivedPrecision:'date',receivedDate:'2035-01-02',timeZone:'America/New_York',recordedAt:syntheticNow});
 const first=cash(970,0,20000),second=cash(971,1,5000),partial=snapshot({...accepted,revision:4},[first]),later=snapshot({...accepted,revision:5},[first,second]);
 const original=ownerMoneyReceiptV3Schema.parse({version:OWNER_MONEY_V3,operationId:first.operationId,action:'cash_date',entityId:accepted.id,entityVersion:4,recordedAt:syntheticNow,replayed:false,result:compactOwnerOperationResultV3(partial,first.id)});
 const reversal=ledgerReceiptV2Schema.parse({id:syntheticId(972),operationId:syntheticId(1972),quoteId:accepted.id,familyId:accepted.familyId,kind:'cash_reversal',currency:'USD',amountMinor:5000,allocations:[{lineId:accepted.lines[0]!.id,amountMinor:5000}],actorId:syntheticOwner,provider:null,reason:'SYNTHETIC correction',originalReceiptId:first.id,receivedAt:syntheticNow,recordedAt:syntheticNow});
 const corrected=snapshot({...accepted,revision:6},[first,second,reversal]),correction=ownerMoneyReceiptV3Schema.parse({version:OWNER_MONEY_V3,operationId:reversal.operationId,action:'reverse_cash',entityId:accepted.id,entityVersion:6,recordedAt:syntheticNow,replayed:false,result:compactOwnerOperationResultV3(corrected,reversal.id)}),paused=snapshot(changeGuestBillingState(corrected.quote,6,{paused:true}),corrected.balance.receipts),cancelled=snapshot(changeGuestBillingState(paused.quote,7,{cancel:true}),corrected.balance.receipts);
 const full=snapshot({...accepted,revision:4},[cash(973,0,65000),cash(974,1,65000)]),pending=snapshot(later.quote,later.balance.receipts,[syntheticId(975)]),unknownReminder=snapshot(later.quote,later.balance.receipts,[],[{id:syntheticId(976),state:'unknown'}]);
 return {version:OWNER_MONEY_V3,syntheticOnly:true as const,evidenceKind:'PURE_DATA_NOT_NATIVE_OR_LIVE' as const,
  scope:{quoteId:accepted.id,familyId:accepted.familyId,workspaceId:accepted.workspaceId},
  unanswered:snapshot(issued,[]),accepted:snapshot(accepted,[]),partial,later,corrected,paused,cancelled,full,pending,unknownReminder,
  original,correction,recovered:billingOwnerReadV3Schema.parse({version:OWNER_MONEY_V3,state:'confirmed',receipt:{...original,replayed:true},current:later}),
  unresolved:billingOwnerReadV3Schema.parse({version:OWNER_MONEY_V3,state:'unresolved',operationId:syntheticId(977)}),
  cashCommand:{version:OWNER_MONEY_V3,operationId:first.operationId,expectedVersion:accepted.revision,quoteId:accepted.id,currency:'USD' as const,amountMinor:first.amountMinor,allocations:first.allocations,receivedPrecision:'date' as const,receivedDate:first.receivedDate,timeZone:first.timeZone},
  correctionCommand:{version:OWNER_MONEY_V3,operationId:reversal.operationId,expectedVersion:later.quote.revision,quoteId:accepted.id,originalReceiptId:first.id,amountMinor:reversal.amountMinor,allocations:reversal.allocations,reason:reversal.reason!},
  pauseCommand:{version:OWNER_MONEY_V3,operationId:syntheticId(1978),expectedVersion:corrected.quote.revision,quoteId:accepted.id,paused:true},
 };
}
