import {describe,it,expect} from 'vitest';
import {
 BILLING_DTO_VERSION,familyOfferSchema,cashCommandSchema,ledgerReceiptSchema,type LedgerReceipt,
} from '../../../src/features/fishing-billing/contracts.ts';
import {
 createFamilyOffer,issueFamilyOffer,acceptFamilyOffer,projectBalance,validateCashReceipt,validateReversal,changeBillingState,
} from '../../../src/features/fishing-billing/domain.ts';
import {syntheticDraft,syntheticAccepted,syntheticDefinition,syntheticNow,syntheticId,syntheticReceipt,syntheticBillingFixtures} from '../../../src/features/fishing-billing/fixtures.ts';
import {planPaymentReminders,checkReminderDispatch,type DispatchPermission} from '../../../src/features/fishing-billing/reminders.ts';
const clone=<T>(value:T):T=>structuredClone(value);
describe('monthly offer, obligation and append-only ledger',()=>{
 it('does not turn an inquiry, draft or issued offer into debt',()=>{
  for(const q of [syntheticDraft(),issueFamilyOffer(syntheticDraft(),1,syntheticNow)]){
   expect(projectBalance(q,[])).toMatchObject({state:'no_debt',quotedMinor:130000,dueMinor:0,remainingMinor:0});
  }
 });
 it('freezes the issued price/terms and does not mutate a prior definition',()=>{
  const definition=syntheticDefinition(),q=syntheticDraft();definition.unitAmountMinor=99999;
  expect(q.definition.unitAmountMinor).toBe(65000);expect(q.lines.map(l=>l.amountMinor)).toEqual([65000,65000]);
 });
 it('accepts only the exact issued revision and acknowledged terms',()=>{
  const q=issueFamilyOffer(syntheticDraft(),1,syntheticNow);
  expect(()=>acceptFamilyOffer(q,1,syntheticId(2),q.definition.terms,syntheticNow)).toThrow('CONFLICT');
  expect(()=>acceptFamilyOffer(q,2,syntheticId(2),{...q.definition.terms,sha256:'b'.repeat(64)},syntheticNow)).toThrow();
  expect(projectBalance(syntheticAccepted(),[])).toMatchObject({state:'unpaid',dueMinor:130000,remainingMinor:130000});
 });
 it('requires sourced new-model policy and a real due instant before acceptance',()=>{
  for(const missing of ['policy','due']){
   const q=issueFamilyOffer(syntheticDraft(),1,syntheticNow);
   if(missing==='policy')q.definition.policies.renewal=null;else q.lines[0]!.dueAt=null;
   expect(()=>acceptFamilyOffer(q,2,syntheticId(2),q.definition.terms,syntheticNow)).toThrow('UNAVAILABLE');
  }
 });
 it('supports an explicit actor/reason override and a no-charge child without fabricated receipt',()=>{
  const q=syntheticDraft();
  const command={operationId:syntheticId(80),id:q.id,familyId:q.familyId,definitionId:q.definition.id,
   children:q.lines.map(l=>({lineId:l.id,childId:l.childId,period:l.period,groupId:l.groupId,dueAt:l.dueAt})),
   override:{reason:'Synthetic owner-authorized family amount',amounts:q.lines.map((l,i)=>({lineId:l.id,amountMinor:i===0?0:50000}))}};
  const draft=createFamilyOffer(q.definition,command,{workspaceId:q.workspaceId,actorId:syntheticId(1),now:syntheticNow});
  const issued=issueFamilyOffer(draft,1,syntheticNow),accepted=acceptFamilyOffer(issued,2,syntheticId(2),issued.definition.terms,syntheticNow);
  expect(projectBalance(accepted,[]).dueMinor).toBe(50000);expect(draft.override?.actorId).toBe(syntheticId(1));
  expect(()=>createFamilyOffer(q.definition,{...command,override:{...command.override,amounts:command.override.amounts.slice(1)}},{workspaceId:q.workspaceId,actorId:syntheticId(1),now:syntheticNow})).toThrow();
 });
 it('rejects duplicate child/period and duplicate lines',()=>{
  const q=syntheticDraft();q.lines[1]!.childId=q.lines[0]!.childId;
  expect(()=>familyOfferSchema.parse(q)).toThrow();
 });
 it('uses the USD monthly version without inheriting trip390 or four-lesson grants',()=>{
  expect(syntheticAccepted().definition).toMatchObject({programKey:'fishing_monthly_club',environment:'test',unitAmountMinor:65000});
  expect(()=>familyOfferSchema.parse({...syntheticAccepted(),definition:{...syntheticDefinition(),currency:'ILS'}})).toThrow();
 });
 it('calculates one verified card child plus partial cash on the second',()=>{
  const f=syntheticBillingFixtures().twoChildPartial.balance;
  expect(f).toMatchObject({version:BILLING_DTO_VERSION,dueMinor:130000,paidMinor:85000,remainingMinor:45000,state:'partial'});
 });
 it('allows full cash, records real excess separately and never makes negative debt',()=>{
  const q=syntheticAccepted(),r={...syntheticReceipt('cash',10,65000,90),amountMinor:70000};
  validateCashReceipt(q,[],r);
  expect(projectBalance(q,[r])).toMatchObject({unallocatedMinor:5000,excessMinor:5000,remainingMinor:65000,state:'overpaid'});
 });
 it.each(['zero','fraction','negative','currency','actor','duplicate','future'] as const)('rejects invalid cash provenance/amount: %s',kind=>{
  const r:Record<string,unknown>=clone(syntheticReceipt('cash',10,20000,91));
  if(kind==='zero')r.amountMinor=0;if(kind==='fraction')r.amountMinor=0.1;if(kind==='negative')r.amountMinor=-1;
  if(kind==='currency')r.currency='ILS';if(kind==='actor')r.actorId=null;
  if(kind==='duplicate')r.allocations=[{lineId:syntheticId(10),amountMinor:10000},{lineId:syntheticId(10),amountMinor:10000}];
  if(kind==='future')r.receivedAt='2035-01-03T00:00:00Z';
  expect(()=>ledgerReceiptSchema.parse(r)).toThrow();
 });
 it('rejects cross-family/line allocation, unaccepted cash and excess cash allocations',()=>{
  const q=syntheticAccepted(),r=syntheticReceipt('cash',10,65000,92);
  for(const bad of [{...r,familyId:syntheticId(999)},{...r,allocations:[{lineId:syntheticId(999),amountMinor:65000}]}])expect(()=>validateCashReceipt(q,[],bad)).toThrow();
  expect(()=>validateCashReceipt(syntheticDraft(),[],r)).toThrow();
  expect(()=>validateCashReceipt(q,[r],syntheticReceipt('cash',10,1,93))).toThrow();
 });
 it('retains the original receipt and enforces cumulative reversal conservation',()=>{
  const q=syntheticAccepted(),r=syntheticReceipt('cash',10,65000,94);
  const reverse:LedgerReceipt={...syntheticReceipt('cash',10,20000,95),kind:'cash_reversal',originalReceiptId:r.id,reason:'Synthetic correction'};
  validateReversal(q,[r],reverse);expect(projectBalance(q,[reverse,r])).toMatchObject({paidMinor:45000,remainingMinor:85000});
  expect(r.amountMinor).toBe(65000);
  expect(()=>validateReversal(q,[r,reverse],{...reverse,id:syntheticId(96),operationId:syntheticId(1096),amountMinor:50000,allocations:[{lineId:syntheticId(10),amountMinor:50000}]})).toThrow();
 });
 it('rejects missing original, wrong-method return and duplicate transaction under different receipts',()=>{
  const q=syntheticAccepted(),r=syntheticReceipt('card',10,65000,97);
  expect(()=>projectBalance(q,[r,{...r,id:syntheticId(98),operationId:syntheticId(1098)}])).toThrow();
  expect(()=>projectBalance(q,[{...syntheticReceipt('cash',10,100,99),kind:'cash_reversal',originalReceiptId:r.id,reason:'Correction'}])).toThrow();
 });
 it('preserves late card/cash overpayment and cancellation debt for review',()=>{
  expect(syntheticBillingFixtures().overpayment.balance).toMatchObject({excessMinor:65000,state:'overpaid'});
  const q=changeBillingState(syntheticAccepted(),3,{cancel:true});
  expect(projectBalance(q,[])).toMatchObject({cancelled:true,dueMinor:130000,remainingMinor:130000});
 });
 it('does not accept caller-supplied actor/workspace or noninteger cash commands',()=>{
  const cmd={operationId:syntheticId(100),expectedVersion:3,quoteId:syntheticId(7),amountMinor:20000,currency:'USD',receivedAt:syntheticNow,allocations:[{lineId:syntheticId(10),amountMinor:20000}]};
  expect(()=>cashCommandSchema.parse({...cmd,actorId:syntheticId(1)})).toThrow();
  expect(()=>cashCommandSchema.parse({...cmd,amountMinor:0.01})).toThrow();
 });
});
const audience={guardianId:syntheticId(2),channel:'email' as const,audience:'individual' as const,locale:'he' as const,verified:true,consented:true,active:true};
const policy={id:'SYNTHETIC-REMINDER',revision:1,source:{id:'SYNTHETIC',sha256:'a'.repeat(64)},timeZone:'America/New_York' as const,offsetsMinutes:[0,1440]};
const permission:DispatchPermission={audience,sendWindowOpen:true,ownerEnabled:true,policyCurrent:true};
const intents=()=>planPaymentReminders({balance:projectBalance(syntheticAccepted(),[]),policy,audience,newId:()=>syntheticId(200)});
describe('payment reminder intent eligibility',()=>{
 it('deduplicates siblings with the same guardian, channel and due date',()=>{
  expect(intents()).toHaveLength(2);expect(intents()[0]!.locale).toBe('he');
  const scannedAgain=planPaymentReminders({balance:projectBalance(syntheticAccepted(),[]),policy,audience,newId:()=>syntheticId(202)});
  expect(scannedAgain[0]!.id).not.toBe(intents()[0]!.id);
  expect(scannedAgain.map(i=>i.key)).toEqual(intents().map(i=>i.key));
 });
 it('uses approved offsets and exact due instants, including Florida DST offsets',()=>{
  const q=syntheticAccepted();q.lines[0]!.dueAt='2035-03-11T17:00:00-04:00';q.lines[1]!.dueAt=q.lines[0]!.dueAt;
  const plans=planPaymentReminders({balance:projectBalance(q,[]),policy,audience,newId:()=>syntheticId(201)});
  expect(plans[0]!.scheduledAt).toBe('2035-03-11T21:00:00.000Z');
 });
 it('recalculates actual partial outstanding amounts just before dispatch',()=>{
  const b=syntheticBillingFixtures().twoChildPartial.balance;
  expect(checkReminderDispatch(intents()[0]!,b,permission,'2035-01-06T00:00:00Z')).toMatchObject({eligible:true,remainingMinor:45000});
 });
 it.each(['paid','cancel','pause','window','consent','policy','no_debt'] as const)('suppresses %s before dispatch',kind=>{
  let b=projectBalance(syntheticAccepted(),[]);const p=clone(permission);
  if(kind==='paid')b=syntheticBillingFixtures().fullCash.balance;
  if(kind==='cancel')b.cancelled=true;if(kind==='pause')b.paused=true;
  if(kind==='window')p.sendWindowOpen=false;if(kind==='consent')p.audience.consented=false;
  if(kind==='policy')p.policyCurrent=false;if(kind==='no_debt')b=projectBalance(syntheticDraft(),[]);
  expect(checkReminderDispatch(intents()[0]!,b,p,'2035-01-06T00:00:00Z').eligible).toBe(false);
 });
 it('does not retry unknown or provider-accepted outcomes',()=>{
  for(const state of ['unknown','provider_accepted','delivered'] as const)expect(checkReminderDispatch({...intents()[0]!,state},projectBalance(syntheticAccepted(),[]),permission,'2035-01-06T00:00:00Z')).toEqual({eligible:false,reason:'already_reserved'});
 });
 it('rejects group audiences, changed locale and cross-family/guardian dispatch',()=>{
  const b=projectBalance(syntheticAccepted(),[]),i=intents()[0]!;
  for(const bad of [{...i,audience:'group'},{...i,familyId:syntheticId(999)},{...i,guardianId:syntheticId(999)},{...i,locale:'en'}])expect(()=>checkReminderDispatch(bad as typeof i,b,permission,'2035-01-06T00:00:00Z')).toThrow();
 });
 it('leaves future intents inert and invalidates obsolete due-date intents',()=>{
  const i=intents()[0]!,b=projectBalance(syntheticAccepted(),[]);
  expect(checkReminderDispatch(i,b,permission,syntheticNow)).toMatchObject({eligible:false,reason:'not_due'});
  b.lines.forEach(l=>l.dueAt='2035-02-01T00:00:00Z');
  expect(checkReminderDispatch(i,b,permission,'2035-01-06T00:00:00Z')).toMatchObject({eligible:false,reason:'obsolete_due_date'});
 });
});

