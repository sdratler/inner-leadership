import {describe,it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {BILLING_DTO_VERSION,familyOfferSchema,type LedgerReceipt} from '../../../src/features/fishing-billing/contracts.ts';
import {dateCashReceiptSchema,type LedgerReceiptV2} from '../../../src/features/fishing-billing/contracts-v2.ts';
import {syntheticDefinition,syntheticDraft,syntheticAccepted,syntheticReceipt,syntheticId,syntheticNow,syntheticOwner,syntheticWorkspace} from '../../../src/features/fishing-billing/fixtures.ts';
import {BILLING_GUEST_V3,guestOwnerSnapshotV3Schema,type GuestFamilyOffer} from '../../../src/lib/fishing-billing-guest-contract-v3.ts';
import {bindGuestIssuedMaterial,bindGuestDisplayBundle,verifyGuestFinancialAcceptance} from '../../../src/lib/fishing-billing-guest-material-v3.ts';
import {createGuestFamilyOffer,issueGuestFamilyOffer,acceptGuestFamilyOffer,changeGuestBillingState,projectGuestBalanceV3,validateGuestCashReceipt,validateGuestReversal} from '../../../src/features/fishing-billing/guest-domain-v3.ts';

/** Entirely synthetic. No source approval, actual parent, money or provider. */
function creation(){
 const source=syntheticDraft();
 return {operationId:syntheticId(900),id:source.id,familyId:source.familyId,definitionId:source.definition.id,override:null,
  children:source.lines.map(l=>({lineId:l.id,childId:l.childId,period:l.period,groupId:l.groupId,dueAt:l.dueAt}))};
}
function evidence(issued:GuestFamilyOffer,acceptedAt=syntheticNow){
 const offer=bindGuestIssuedMaterial({workspaceId:issued.workspaceId,familyId:issued.familyId,quoteId:issued.id,issuedRevision:issued.revision,
  definition:issued.definition,lines:issued.lines,createdAt:issued.createdAt,issuedAt:issued.issuedAt,override:issued.override});
 const displayed=bindGuestDisplayBundle({id:syntheticId(910),version:'SYNTHETIC-UNRELEASED',locale:'he',offerSnapshotSha256:offer.sha256,
  documents:[{purpose:'financial_terms',source:issued.definition.terms,displayedTextSha256:'b'.repeat(64),releaseEvidenceId:syntheticId(911)}]});
 return verifyGuestFinancialAcceptance({version:BILLING_GUEST_V3,id:syntheticId(912),kind:'guest_grant',grantId:syntheticId(913),offer,displayed,
  parent:{submittedName:'SYNTHETIC PARENT ONLY',guardianAuthorityAttested:true,financialTermsAffirmed:true,statementSha256:'c'.repeat(64),privateEvidenceId:syntheticId(914)},
  assuranceEvidenceId:syntheticId(915),operationId:syntheticId(916),acceptedAt});
}
function setup(now=syntheticNow,acceptedAt=now){
 const draft=createGuestFamilyOffer(syntheticDefinition(),creation(),{workspaceId:syntheticWorkspace,actorId:syntheticOwner,now});
 const issued=issueGuestFamilyOffer(draft,1,now),acceptance=evidence(issued,acceptedAt),quote=acceptGuestFamilyOffer(issued,2,acceptance);
 return {draft,issued,acceptance,quote};
}
function dateCash(quote:GuestFamilyOffer,amountMinor=20000){
 return dateCashReceiptSchema.parse({id:syntheticId(920),operationId:syntheticId(921),quoteId:quote.id,familyId:quote.familyId,
  kind:'cash',amountMinor,currency:'USD',allocations:[{lineId:quote.lines[1]!.id,amountMinor}],originalReceiptId:null,actorId:syntheticOwner,
  provider:null,reason:null,receivedPrecision:'date',receivedDate:'2035-01-05',timeZone:'America/New_York',recordedAt:'2035-01-06T15:00:00Z'});
}
function reverse(original:LedgerReceiptV2,amountMinor=5000):LedgerReceipt{
 return {...syntheticReceipt('cash',11,amountMinor,930),kind:'cash_reversal',originalReceiptId:original.id,reason:'SYNTHETIC correction',
  receivedAt:'2035-01-07T15:00:00Z',recordedAt:'2035-01-07T15:00:00Z'};
}

describe('new guest offers and genuine-evidence binding',()=>{
 it('creates a distinct USD/test draft and never fabricates an accepting account',()=>{
  const f=setup();expect(f.draft.version).toBe(BILLING_GUEST_V3);expect(f.draft.acceptance).toBeNull();
  expect(f.draft.definition).toEqual(syntheticDefinition());expect(f.draft.lines.map(l=>l.amountMinor)).toEqual([65000,65000]);
  expect(f.quote.acceptance).toEqual(f.acceptance);expect('actorId' in f.quote.acceptance!).toBe(false);
  expect(familyOfferSchema.safeParse(f.quote).success).toBe(false);
 });
 it('keeps explicit family overrides and their real issuing owner separate from acceptance',()=>{
  const command=creation(),override={reason:'SYNTHETIC reviewed override',amounts:command.children.map(l=>({lineId:l.lineId,amountMinor:60000}))};
  const q=createGuestFamilyOffer(syntheticDefinition(),{...command,override},{workspaceId:syntheticWorkspace,actorId:syntheticOwner,now:syntheticNow});
  expect(q.lines.map(l=>l.amountMinor)).toEqual([60000,60000]);expect(q.override?.actorId).toBe(syntheticOwner);expect(q.acceptance).toBeNull();
 });
 it.each(['partial','duplicate','foreign'])('denies %s override line sets',kind=>{
  const c=creation(),amounts=c.children.map(l=>({lineId:l.lineId,amountMinor:60000}));
  if(kind==='partial')amounts.pop();if(kind==='duplicate')amounts[1]!.lineId=amounts[0]!.lineId;if(kind==='foreign')amounts[1]!.lineId=syntheticId(999);
  expect(()=>createGuestFamilyOffer(syntheticDefinition(),{...c,override:{reason:'SYNTHETIC',amounts}},{workspaceId:syntheticWorkspace,actorId:syntheticOwner,now:syntheticNow})).toThrow();
 });
 it('denies definition mismatch, invalid currency and creation before publication',()=>{
  const c={workspaceId:syntheticWorkspace,actorId:syntheticOwner,now:syntheticNow};
  expect(()=>createGuestFamilyOffer(syntheticDefinition(),{...creation(),definitionId:syntheticId(999)},c)).toThrow();
  expect(()=>createGuestFamilyOffer({...syntheticDefinition(),currency:'ILS'},creation(),c)).toThrow();
  expect(()=>createGuestFamilyOffer(syntheticDefinition(),creation(),{...c,now:'2030-01-01T00:00:00Z'})).toThrow();
 });
 it('does not invent due dates or missing policy while drafting',()=>{
  const d=syntheticDefinition();d.policies.renewal=null;const c=creation();c.children[0]!.dueAt=null;
  const q=createGuestFamilyOffer(d,c,{workspaceId:syntheticWorkspace,actorId:syntheticOwner,now:syntheticNow});
  expect(q.lines[0]!.dueAt).toBeNull();expect(projectGuestBalanceV3(q,[]).missingPolicy).toEqual(expect.arrayContaining(['renewal','payment_due']));
  const issued=issueGuestFamilyOffer(q,1,syntheticNow);expect(()=>evidence(issued)).toThrow();
 });
 it('issues and accepts only the exact current revision and state',()=>{
  const f=setup();expect(()=>issueGuestFamilyOffer(f.draft,2,syntheticNow)).toThrow();
  expect(()=>issueGuestFamilyOffer(f.issued,2,syntheticNow)).toThrow();expect(()=>issueGuestFamilyOffer(f.draft,1,'2035-01-02T14:59:59Z')).toThrow();
  expect(()=>acceptGuestFamilyOffer(f.issued,1,f.acceptance)).toThrow();expect(()=>acceptGuestFamilyOffer(f.quote,3,f.acceptance)).toThrow();
  expect(()=>acceptGuestFamilyOffer({...f.issued,revision:3},3,f.acceptance)).toThrow();
 });
 it.each(['workspaceId','familyId','id'] as const)('denies current quote %s changes under original evidence',field=>{
  const f=setup();expect(()=>acceptGuestFamilyOffer({...f.issued,[field]:syntheticId(999)},2,f.acceptance)).toThrow();
 });
 it.each(['child','period','line','amount','source','terms','created','issued'])('denies changed %s material',field=>{
  const f=setup(),q=structuredClone(f.issued);
  if(field==='child')q.lines[0]!.childId=syntheticId(999);if(field==='period')q.lines[0]!.period.id=syntheticId(999);
  if(field==='line')q.lines[0]!.id=syntheticId(999);
  if(field==='amount'){q.lines[0]!.amountMinor=60000;q.override={actorId:syntheticOwner,reason:'SYNTHETIC changed amount'};}
  if(field==='source')q.definition.source.id='SYNTHETIC-OTHER';if(field==='terms')q.definition.terms.sha256='d'.repeat(64);
  if(field==='created')q.createdAt='2035-01-02T14:59:59Z';if(field==='issued')q.issuedAt='2035-01-02T15:00:00.001Z';
  expect(()=>acceptGuestFamilyOffer(q,2,f.acceptance)).toThrow();
 });
 it.each(['material','locale','document','documentVersion','privacyOnly','empty'])('denies tampered %s evidence',field=>{
  const f=setup(),a=structuredClone(f.acceptance);
  if(field==='material')a.offer.material.familyId=syntheticId(999);if(field==='locale')a.displayed.locale='en';
  if(field==='document')a.displayed.documents[0]!.displayedTextSha256='e'.repeat(64);
  if(field==='documentVersion')a.displayed.version='SYNTHETIC-OTHER';if(field==='privacyOnly')a.displayed.documents[0]!.purpose='privacy_for_completion';
  if(field==='empty')a.displayed.documents=[];
  expect(()=>acceptGuestFamilyOffer(f.issued,2,a)).toThrow();
 });
 it('denies a rehashed wrong financial source, not only an old digest',()=>{
  const f=setup(),documents=f.acceptance.displayed.documents.map(d=>({...d,source:{id:'SYNTHETIC-FOREIGN',sha256:'d'.repeat(64)}}));
  const displayed=bindGuestDisplayBundle({id:f.acceptance.displayed.id,version:f.acceptance.displayed.version,locale:f.acceptance.displayed.locale,offerSnapshotSha256:f.acceptance.offer.sha256,documents});
  expect(()=>acceptGuestFamilyOffer(f.issued,2,{...f.acceptance,displayed})).toThrow();
 });
 it('denies V1 account acceptance, wrong versions and accepting-account extra fields',()=>{
  const f=setup(),old=syntheticAccepted();
  expect(()=>projectGuestBalanceV3(old,[])).toThrow();expect(()=>acceptGuestFamilyOffer(old,2,f.acceptance)).toThrow();
  expect(()=>acceptGuestFamilyOffer(f.issued,2,old.acceptance)).toThrow();
  expect(()=>acceptGuestFamilyOffer(f.issued,2,{...f.acceptance,version:BILLING_DTO_VERSION})).toThrow();
  expect(()=>acceptGuestFamilyOffer(f.issued,2,{...f.acceptance,actorId:syntheticOwner})).toThrow();
  expect(familyOfferSchema.parse(old)).toEqual(old);
 });
 it('denies acceptance before issue and cancelled issue without creating a replacement debt',()=>{
  const f=setup();expect(()=>evidence(f.issued,'2035-01-02T14:59:59Z')).toThrow();
  const q=changeGuestBillingState(f.issued,2,{cancel:true});expect(()=>acceptGuestFamilyOffer(q,3,f.acceptance)).toThrow();
  expect(projectGuestBalanceV3(q,[]).dueMinor).toBe(0);
 });
});

describe('one ledger across true guest evidence and mixed receipt precision',()=>{
 it('has no debt before acceptance, then exact unpaid child/period amounts',()=>{
  const f=setup();for(const q of [f.draft,f.issued])expect(projectGuestBalanceV3(q,[])).toMatchObject({state:'no_debt',quotedMinor:130000,dueMinor:0,remainingMinor:0});
  const b=projectGuestBalanceV3(f.quote,[],[syntheticId(940)]);expect(b).toMatchObject({version:BILLING_GUEST_V3,state:'unpaid',dueMinor:130000,remainingMinor:130000,pendingAttemptIds:[syntheticId(940)]});
  expect(b.lines.map(l=>[l.childId,l.period.id,l.dueMinor])).toEqual(f.quote.lines.map(l=>[l.childId,l.period.id,65000]));
  expect(()=>projectGuestBalanceV3(f.issued,[syntheticReceipt('cash',10,10000,941)])).toThrow();
 });
 it('preserves mixed instant card/date-only cash and allocates partial sibling balances',()=>{
  const f=setup(),card=syntheticReceipt('card',10,65000,942),date=dateCash(f.quote),old=[card,date],before=JSON.stringify(old);
  expect(validateGuestCashReceipt(f.quote,[card],date)).toEqual(date);
  const b=projectGuestBalanceV3(f.quote,old);expect(b).toMatchObject({state:'partial',paidMinor:85000,remainingMinor:45000});
  expect(b.lines.map(l=>l.paidMinor)).toEqual([65000,20000]);expect(b.receipts).toEqual(old);
  expect('receivedAt' in b.receipts[1]!).toBe(false);expect(JSON.stringify(old)).toBe(before);
  expect(guestOwnerSnapshotV3Schema.parse({quote:f.quote,balance:b,receiptId:date.id}).balance).toEqual(b);
 });
 it('accepts partial/full cash and preserves actual instant receipts',()=>{
  const f=setup(),a=syntheticReceipt('cash',10,65000,943),b=syntheticReceipt('cash',11,65000,944);
  expect(validateGuestCashReceipt(f.quote,[],a)).toEqual(a);expect(validateGuestCashReceipt(f.quote,[a],b)).toEqual(b);
  expect(projectGuestBalanceV3(f.quote,[a,b])).toMatchObject({state:'paid',paidMinor:130000,remainingMinor:0});
 });
 it('keeps two explicitly offered periods for the same child independent',()=>{
  const command=creation(),first=command.children[0]!,second=command.children[1]!;
  second.childId=first.childId;second.period={id:syntheticId(970),startsAt:'2035-02-01T05:00:00Z',endsAt:'2035-03-01T05:00:00Z',timeZone:'America/New_York'};second.dueAt='2035-02-05T22:00:00Z';
  const draft=createGuestFamilyOffer(syntheticDefinition(),command,{workspaceId:syntheticWorkspace,actorId:syntheticOwner,now:syntheticNow});
  const issued=issueGuestFamilyOffer(draft,1,syntheticNow),q=acceptGuestFamilyOffer(issued,2,evidence(issued));
  const b=projectGuestBalanceV3(q,[syntheticReceipt('cash',10,20000,971)]);
  expect(b.lines.map(l=>[l.childId,l.period.id,l.paidMinor,l.remainingMinor])).toEqual([[first.childId,first.period.id,20000,45000],[first.childId,second.period.id,0,65000]]);
 });
 it('settles both siblings with explicit date-only cash while retaining all received dates',()=>{
  const f=setup(),partial=dateCash(f.quote),first={...dateCash(f.quote,65000),id:syntheticId(972),operationId:syntheticId(973),allocations:[{lineId:f.quote.lines[0]!.id,amountMinor:65000}]};
  const remainder={...dateCash(f.quote,45000),id:syntheticId(974),operationId:syntheticId(975)};
  expect(validateGuestCashReceipt(f.quote,[partial],first)).toEqual(first);expect(validateGuestCashReceipt(f.quote,[partial,first],remainder)).toEqual(remainder);
  const b=projectGuestBalanceV3(f.quote,[partial,first,remainder]);expect(b).toMatchObject({state:'paid',paidMinor:130000,remainingMinor:0});
  expect(b.receipts.every(r=>'receivedDate' in r&&r.receivedDate==='2035-01-05'&&!('receivedAt' in r))).toBe(true);
 });
 it('does not allocate cash beyond a selected child remaining amount',()=>{
  const f=setup(),old=[dateCash(f.quote)],receipt={...syntheticReceipt('cash',11,46000,945),receivedAt:'2035-01-07T15:00:00Z',recordedAt:'2035-01-07T15:00:00Z'};
  expect(()=>validateGuestCashReceipt(f.quote,old,receipt)).toThrow();expect(projectGuestBalanceV3(f.quote,old).remainingMinor).toBe(110000);
 });
 it('retains unallocated cash and permits a linked unallocated correction without moving child money',()=>{
  const f=setup(),cash={...syntheticReceipt('cash',10,65000,946),amountMinor:70000};
  expect(validateGuestCashReceipt(f.quote,[],cash)).toEqual(cash);
  const correction={...reverse(cash),allocations:[]};expect(validateGuestReversal(f.quote,[cash],correction)).toEqual(correction);
  expect(projectGuestBalanceV3(f.quote,[cash,correction])).toMatchObject({paidMinor:65000,unallocatedMinor:0,remainingMinor:65000});
 });
 it('reverses date-only cash append-only and retains the original date evidence',()=>{
  const f=setup(),card=syntheticReceipt('card',10,65000,947),date=dateCash(f.quote),correction=reverse(date),before=JSON.stringify(date);
  expect(validateGuestReversal(f.quote,[card,date],correction)).toEqual(correction);
  const b=projectGuestBalanceV3(f.quote,[card,date,correction]);expect(b).toMatchObject({paidMinor:80000,remainingMinor:50000});
  expect(b.receipts[1]).toEqual(date);expect(JSON.stringify(date)).toBe(before);
 });
 it.each(['foreignQuote','foreignFamily','unknownLine','duplicateId','duplicateOperation'])('denies %s receipt data',kind=>{
  const f=setup(),a=syntheticReceipt('cash',10,10000,948),b=syntheticReceipt('cash',11,10000,949);
  if(kind==='foreignQuote')b.quoteId=syntheticId(999);if(kind==='foreignFamily')b.familyId=syntheticId(999);
  if(kind==='unknownLine')b.allocations[0]!.lineId=syntheticId(999);if(kind==='duplicateId')b.id=a.id;if(kind==='duplicateOperation')b.operationId=a.operationId;
  expect(()=>projectGuestBalanceV3(f.quote,[a,b])).toThrow();
 });
 it.each(['orphan','wrongKind','overReturn','wrongLine','cumulative'])('denies %s cash corrections',kind=>{
  const f=setup(),date=dateCash(f.quote),r=reverse(date),old:LedgerReceiptV2[]=[date];
  if(kind==='orphan')r.originalReceiptId=syntheticId(999);
  if(kind==='wrongKind'){const card=syntheticReceipt('card',11,20000,950);old[0]=card;r.originalReceiptId=card.id;}
  if(kind==='overReturn'){r.amountMinor=21000;r.allocations[0]!.amountMinor=21000;}
  if(kind==='wrongLine')r.allocations[0]!.lineId=f.quote.lines[0]!.id;
  if(kind==='cumulative')old.push({...reverse(date,18000),id:syntheticId(951),operationId:syntheticId(952)});
  expect(()=>validateGuestReversal(f.quote,old,r)).toThrow();
 });
 it('preserves verified card/refund/dispute arithmetic and provider fact uniqueness',()=>{
  const f=setup(),card=syntheticReceipt('card',10,65000,953),refund={...syntheticReceipt('card',10,10000,954),kind:'refund' as const,originalReceiptId:card.id,reason:'SYNTHETIC refund'};
  expect(projectGuestBalanceV3(f.quote,[card,refund])).toMatchObject({state:'partial',paidMinor:55000,remainingMinor:75000});
  const dispute={...refund,kind:'dispute' as const};expect(projectGuestBalanceV3(f.quote,[card,dispute]).state).toBe('review_required');
  expect(()=>projectGuestBalanceV3(f.quote,[card,{...syntheticReceipt('card',11,10000,955),provider:card.provider}])).toThrow();
  expect(()=>projectGuestBalanceV3(f.quote,[card,{...refund,provider:{...refund.provider!,accountId:'acct_FOREIGN'}}])).toThrow();
 });
 it('retains late card facts and debt after cancellation rather than writing them off',()=>{
  const f=setup(),q=changeGuestBillingState(f.quote,3,{cancel:true}),card=syntheticReceipt('card',10,65000,956);
  expect(projectGuestBalanceV3(q,[card])).toMatchObject({cancelled:true,dueMinor:130000,paidMinor:65000,remainingMinor:65000});
  expect(()=>validateGuestCashReceipt(q,[],syntheticReceipt('cash',10,10000,957))).toThrow();
 });
 it('records an explicit cash correction after cancellation without deleting the obligation',()=>{
  const f=setup(),q=changeGuestBillingState(f.quote,3,{cancel:true}),cash=dateCash(f.quote),correction=reverse(cash);
  expect(validateGuestReversal(q,[cash],correction)).toEqual(correction);
  expect(projectGuestBalanceV3(q,[cash,correction])).toMatchObject({cancelled:true,dueMinor:130000,paidMinor:15000,remainingMinor:115000});
 });
 it('pauses/resumes without changing acceptance, receipts, remaining debt or cancelled state',()=>{
  const f=setup(),cash=syntheticReceipt('cash',10,10000,958),paused=changeGuestBillingState(f.quote,3,{paused:true});
  const b=projectGuestBalanceV3(paused,[cash]);expect(b).toMatchObject({paused:true,paidMinor:10000,remainingMinor:120000});
  const resumed=changeGuestBillingState(paused,4,{paused:false}),cancelled=changeGuestBillingState(resumed,5,{cancel:true});
  expect(resumed.acceptance).toEqual(f.acceptance);expect(projectGuestBalanceV3(resumed,[cash]).receipts).toEqual([cash]);
  expect(changeGuestBillingState(cancelled,6,{paused:false}).state).toBe('cancelled');
  expect(()=>changeGuestBillingState(f.quote,2,{cancel:true})).toThrow();expect(()=>changeGuestBillingState(f.quote,3,{})).toThrow();
  expect(()=>changeGuestBillingState(f.quote,3,{cancel:true,writeOff:true})).toThrow();
 });
});

describe('actual receipt chronology and Florida calendar precision',()=>{
 it('uses the acceptance Florida date across UTC midnight without inventing a receive instant',()=>{
  const f=setup('2035-01-02T04:59:00Z'),date={...dateCash(f.quote),receivedDate:'2035-01-01',recordedAt:'2035-01-02T05:01:00Z'};
  expect(validateGuestCashReceipt(f.quote,[],date)).toEqual(date);expect('receivedAt' in projectGuestBalanceV3(f.quote,[date]).receipts[0]!).toBe(false);
  expect(()=>validateGuestCashReceipt(f.quote,[],{...date,receivedDate:'2034-12-31'})).toThrow();
 });
 it.each(['2035-03-11T06:59:00Z','2035-11-04T05:30:00Z','2035-11-04T06:30:00Z'])('retains date precision across DST at %s',now=>{
  const f=setup(now),date=now.slice(0,10),cash={...dateCash(f.quote),receivedDate:date,recordedAt:now};
  expect(validateGuestCashReceipt(f.quote,[],cash)).toEqual(cash);expect('receivedAt' in cash).toBe(false);
 });
 it('preserves provider whole-second precision but rejects earlier cash instants',()=>{
  const f=setup(syntheticNow,'2035-01-02T15:00:00.500Z'),card={...syntheticReceipt('card',10,10000,960),recordedAt:'2035-01-02T15:00:01Z'};
  expect(projectGuestBalanceV3(f.quote,[card]).paidMinor).toBe(10000);
  expect(()=>projectGuestBalanceV3(f.quote,[{...card,receivedAt:'2035-01-02T14:59:59Z'}])).toThrow();
  expect(()=>projectGuestBalanceV3(f.quote,[{...card,kind:'cash',actorId:syntheticOwner,provider:null}])).toThrow();
 });
 it('denies recording before acceptance, receiving before original, and correction before original recording',()=>{
  const f=setup(syntheticNow,'2035-01-02T15:00:00.500Z'),card=syntheticReceipt('card',10,10000,961);
  expect(()=>projectGuestBalanceV3(f.quote,[card])).toThrow();
  const g=setup(),cash={...syntheticReceipt('cash',11,20000,962),receivedAt:'2035-01-04T15:00:00Z',recordedAt:'2035-01-06T15:00:00Z'};
  expect(()=>validateGuestReversal(g.quote,[cash],{...reverse(cash),receivedAt:'2035-01-03T15:00:00Z'})).toThrow();
  const date=dateCash(g.quote);expect(()=>validateGuestReversal(g.quote,[date],{...reverse(date),recordedAt:'2035-01-04T15:00:00Z',receivedAt:'2035-01-04T15:00:00Z'})).toThrow();
 });
 it.each(['future','invalid','fractional'])('denies %s date-cash data',kind=>{
  const f=setup(),cash=dateCash(f.quote);
  const bad=kind==='future'?{...cash,receivedDate:'2035-01-07'}:kind==='invalid'?{...cash,receivedDate:'2035-02-30'}:{...cash,amountMinor:20000.5};
  expect(()=>validateGuestCashReceipt(f.quote,[],bad)).toThrow();
 });
});
