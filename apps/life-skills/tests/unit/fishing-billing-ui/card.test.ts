import {describe,it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {BillingWorkflow} from '../../../src/features/fishing-billing-ui/workflow.ts';
import {CardControls} from '../../../src/features/fishing-billing-ui/owner-billing-panel.tsx';
import {cardCommand,type CardClient} from '../../../src/features/fishing-billing-ui/card-model.ts';
import {prepareStateCommand,dataScope,type BillingUiPorts,type CommandOutcome,type BillingData,type BillingOperationReceipt} from '../../../src/features/fishing-billing-ui/model.ts';
import {syntheticDateCashFixtures} from '../../../src/features/fishing-billing/fixtures-v2.ts';
import {syntheticId,syntheticOwner} from '../../../src/features/fishing-billing/fixtures.ts';
import {CARD_VERSION,cardAttemptSchema} from '../../../src/features/fishing-billing/card-contracts.ts';
import {BILLING_DTO_V2,projectBalanceV2} from '../../../src/features/fishing-billing/contracts-v2.ts';
import {changeBillingState} from '../../../src/features/fishing-billing/domain.ts';
import {createFishingBillingCardOwnerClient} from '../../../src/lib/fishing-billing-card-owner-client.ts';
import {fishingBillingCardOwnerHttp,type FishingBillingCardOwnerDeps} from '../../../src/lib/fishing-billing-card-owner-http.ts';
import {SESSION_COOKIE} from '../../../src/lib/security/session.ts';
import {AppError} from '../../../src/lib/errors.ts';
import type {Actor} from '../../../src/features/identity/types.ts';

const op=syntheticId(801),origin='https://synthetic-card-ui.invalid',url='https://checkout.stripe.com/c/pay/SYNTHETIC_ONLY';
function setup(){
 const f=syntheticDateCashFixtures(),base:BillingData={quote:f.quote,balance:f.balance};
 const command=cardCommand({operationId:op,quoteId:base.quote.id,expectedVersion:base.quote.revision,selection:[{lineId:base.quote.lines[1]!.id,amountMinor:20000}]},base);
 const quote={...base.quote,revision:6},prepared={version:CARD_VERSION,operationId:op,quoteId:quote.id,entityVersion:6,replayed:false,result:{attemptId:op,amountMinor:20000,allocations:command.selection}};
 const attempt=cardAttemptSchema.parse({version:CARD_VERSION,id:op,workspaceId:quote.workspaceId,quoteId:quote.id,familyId:quote.familyId,actorId:syntheticOwner,revision:1,balanceVersion:6,binding:{accountId:'acct_SYNTHETIC',livemode:false,apiVersion:'2026-09-30.endive',verifiedBindingId:'SYNTHETIC_ONLY'},command,requestDigest:'d'.repeat(64),preparation:prepared,createdAt:'2035-01-06T15:00:00Z',state:'prepared',dispatchId:null,sessionId:null,checkoutUrl:null,paymentIntentId:null});
 const preparedData={quote,balance:projectBalanceV2(quote,base.balance.receipts,[op]),receiptId:null};
 const current={...preparedData};
 const actor={id:syntheticOwner,workspaceId:quote.workspaceId,personId:syntheticId(99),role:'practitioner',state:'active',locale:'en',sessionDigest:'c'.repeat(64),expiresAt:Date.parse('2036-01-01T00:00:00Z')} as Actor;
 const cards={prepare:vi.fn<FishingBillingCardOwnerDeps['cards']['prepare']>(async()=>prepared),readAttempt:vi.fn<FishingBillingCardOwnerDeps['cards']['readAttempt']>(async()=>attempt),readPreparationReceipt:vi.fn<FishingBillingCardOwnerDeps['cards']['readPreparationReceipt']>(async()=>prepared),createCheckout:vi.fn<FishingBillingCardOwnerDeps['cards']['createCheckout']>(async()=>{attempt.state='open';attempt.dispatchId=syntheticId(802);attempt.sessionId='cs_test_SYNTHETIC';attempt.checkoutUrl=url;return attempt;})};
 const store={readBalanceV2:vi.fn<FishingBillingCardOwnerDeps['store']['readBalanceV2']>(async()=>current)};
 const deps:FishingBillingCardOwnerDeps={origin,actor:async()=>actor,csrf:()=>'b'.repeat(43),limits:{consume:async()=>({count:1,retryAfterMs:0})},rateLimitKey:'e'.repeat(32),cards,store};
 const requests:Request[]=[];
 const transport=vi.fn(async(input:Request)=>{
  requests.push(input.clone());const headers=new Headers(input.headers);headers.set('host','synthetic-card-ui.invalid');headers.set('x-forwarded-host','synthetic-card-ui.invalid');headers.set('x-forwarded-proto','https');headers.set('cookie',SESSION_COOKIE+'='+'a'.repeat(43));
  if(input.method==='POST'){headers.set('origin',origin);headers.set('sec-fetch-site','same-origin');}
  return fishingBillingCardOwnerHttp(new Request(input,{headers}),async()=>deps);
 });
 const client=createFishingBillingCardOwnerClient({origin,scope:dataScope(base),csrf:async()=>'b'.repeat(43),transport,readCurrent:async()=>current,timeoutMs:1000});
 const money:BillingUiPorts={recordCashDate:vi.fn(async():Promise<CommandOutcome>=>({kind:'unknown'})),reverseCash:vi.fn(async():Promise<CommandOutcome>=>({kind:'unknown'})),setState:vi.fn(async():Promise<CommandOutcome>=>({kind:'unknown'})),readOperation:vi.fn(async()=>null),readBalance:vi.fn(async()=>current),nextOperationId:vi.fn(()=>op)};
 const workflow=new BillingWorkflow(money,client);
 const cash={version:BILLING_DTO_V2,operationId:syntheticId(901),quoteId:quote.id,expectedVersion:6,receivedPrecision:'date' as const,receivedDate:'2035-01-06',timeZone:'America/New_York' as const,currency:'USD' as const,amountMinor:100,allocations:[{lineId:quote.lines[1]!.id,amountMinor:100}]};
 return {base,command,attempt,prepared,current,cards,store,deps,requests,transport,client,money,workflow,cash};
}
function render(f:ReturnType<typeof setup>,data:BillingData=f.workflow.currentFor(f.base),allowed=true){return renderToStaticMarkup(createElement(CardControls,{locale:'en',data,workflow:f.workflow,allowed,onPrepare:()=>{},onCheckout:()=>{}}));}
function pendingAfter(f:ReturnType<typeof setup>){
 const id=syntheticId(899),quote={...f.current.quote,revision:7},command={...f.command,operationId:id,expectedVersion:6};
 const preparation={...f.prepared,operationId:id,entityVersion:7,result:{...f.prepared.result,attemptId:id}};
 const attempt=cardAttemptSchema.parse({...f.attempt,id,command,preparation,revision:1,balanceVersion:7,state:'prepared',dispatchId:null,sessionId:null,checkoutUrl:null,paymentIntentId:null});
 f.current.quote=quote;f.current.balance=projectBalanceV2(quote,f.current.balance.receipts,[id]);
 f.cards.readAttempt.mockImplementation(async(_actor,_quoteId,attemptId)=>attemptId===id?attempt:f.attempt);
 return id;
}

describe('current pending lookup reachability',()=>{
 it('keeps a different current pending ID reachable after a retained terminal attempt',async()=>{
  const f=setup();await f.workflow.prepareCard(f.command,f.base);f.attempt.state='failed';f.current.balance=projectBalanceV2(f.current.quote,f.current.balance.receipts);await f.workflow.readCard(f.current);
  const id=pendingAfter(f),html=render(f,f.current),lookup=html.match(/<button[^>]*>Check existing attempt<\/button>/)?.[0];
  expect(html).toContain(id);expect(lookup).toBeDefined();expect(lookup).not.toContain('disabled');
  expect(await f.workflow.readCard(f.current,id)).toBe(true);expect(f.workflow.getSnapshot().card?.attemptId).toBe(id);
  expect(f.requests.map(r=>r.method)).toEqual(['POST','GET','GET']);expect(new URL(f.requests.at(-1)!.url).searchParams.get('id')).toBe(id);expect(f.cards.prepare).toHaveBeenCalledTimes(1);expect(f.cards.createCheckout).not.toHaveBeenCalled();expect(f.money.nextOperationId).not.toHaveBeenCalled();
 });
 it('shows only current pending references when the retained terminal context is foreign',async()=>{
  const f=setup();await f.workflow.prepareCard(f.command,f.base);f.attempt.state='expired';await f.workflow.readCard(f.current);
  const id=pendingAfter(f),other=structuredClone(f.current);other.quote.id=syntheticId(990);other.quote.familyId=syntheticId(991);other.balance=projectBalanceV2(other.quote,other.balance.receipts.map(r=>({...r,quoteId:other.quote.id,familyId:other.quote.familyId})),[id]);
  const html=render(f,other),lookup=html.match(/<button[^>]*>Check existing attempt<\/button>/)?.[0];
  expect(html).toContain(id);expect(html).not.toContain(op);expect(lookup).toBeDefined();expect(lookup).not.toContain('disabled');
  // Availability only: the actual injected client/server still owns scope.
  expect(f.cards.createCheckout).not.toHaveBeenCalled();
 });
 it('shows a current pending ID but cannot replace an unresolved original context',async()=>{
  const f=setup();f.store.readBalanceV2.mockRejectedValueOnce(new AppError('UNAVAILABLE'));await f.workflow.prepareCard(f.command,f.base);
  const id=pendingAfter(f),html=render(f,f.current),lookup=html.match(/<button[^>]*>Check existing attempt<\/button>/)?.[0];
  expect(html).toContain(id);expect(lookup).toBeDefined();expect(lookup).toContain('disabled');
  expect(await f.workflow.readCard(f.current,id)).toBe(false);expect(f.workflow.getSnapshot().card?.operationId).toBe(op);expect(f.workflow.clear()).toBe(false);expect(f.requests).toHaveLength(1);expect(f.cards.prepare).toHaveBeenCalledTimes(1);expect(f.cards.createCheckout).not.toHaveBeenCalled();
 });
});

describe('retained card workflow with actual Root client and HTTP / synthetic native ports',()=>{
 it('prepares the supplied operation once and never dispatches Checkout on preparation or GET',async()=>{
  const f=setup();expect(f.requests).toEqual([]);await f.workflow.prepareCard(f.command,f.base);
  expect(f.workflow.getSnapshot().card).toMatchObject({phase:'ready',operationId:op,command:f.command,projection:{attempt:{state:'prepared'}}});
  expect(await f.requests[0]!.json()).toEqual({action:'prepare',command:f.command});expect(f.cards.prepare).toHaveBeenCalledTimes(1);expect(f.cards.createCheckout).not.toHaveBeenCalled();
  expect(f.workflow.canCreateCheckout(f.base)).toBe(true);expect(f.workflow.checkoutUrl(f.base)).toBeNull();
  await f.workflow.readCard(f.workflow.currentFor(f.base));expect(f.requests.map(r=>r.method)).toEqual(['POST','GET']);expect(f.cards.createCheckout).not.toHaveBeenCalled();
  expect(f.workflow.currentFor(f.base).balance.paidMinor).toBe(85000);expect(f.workflow.currentFor(f.base).balance.remainingMinor).toBe(45000);
 });
 it('requires a separate deliberate dispatch and exposes only a current projected TEST link',async()=>{
  const f=setup();await f.workflow.prepareCard(f.command,f.base);await f.workflow.createCardCheckout(op,f.workflow.currentFor(f.base));
  expect(f.requests.map(r=>r.method)).toEqual(['POST','POST']);expect(await f.requests[1]!.json()).toEqual({action:'create_checkout',command:{quoteId:f.base.quote.id,attemptId:op}});
  expect(f.cards.createCheckout).toHaveBeenCalledTimes(1);expect(f.workflow.checkoutUrl(f.base)).toBe(url);
  expect(await f.workflow.createCardCheckout(op,f.base)).toBe(false);expect(f.cards.createCheckout).toHaveBeenCalledTimes(1);
  const html=render(f);expect(html).toContain(`href="${url}"`);expect(html).toContain('Open TEST Checkout');expect(html).toContain('no payment confirmed');
  expect(f.workflow.currentFor(f.base).balance.paidMinor).toBe(85000);expect(f.workflow.currentFor(f.base).balance.receipts).toEqual(f.base.balance.receipts);
 });
 it('recovers a late preparation failure by original operation only; null remains unresolved',async()=>{
  const f=setup();f.store.readBalanceV2.mockRejectedValueOnce(new AppError('FORBIDDEN'));
  await f.workflow.prepareCard(f.command,f.base);expect(f.workflow.getSnapshot().card?.phase).toBe('unknown');expect(f.workflow.clear()).toBe(false);
  f.cards.readPreparationReceipt.mockResolvedValueOnce(null);await f.workflow.readCard(f.base);
  expect(f.workflow.unresolved()).toBe(true);expect(f.workflow.getSnapshot().card).toMatchObject({operationId:op,command:f.command});
  expect(await f.workflow.prepareCard({...f.command,operationId:syntheticId(900)},f.base)).toBe(false);
  expect(await f.workflow.submit('cash',f.cash,f.current)).toBe(false);expect(await f.workflow.submit('state',prepareStateCommand('pause',f.current,syntheticId(902)),f.current)).toBe(false);
  await f.workflow.readCard(f.base);expect(f.workflow.getSnapshot().card?.phase).toBe('ready');
  expect(f.requests.map(r=>r.method)).toEqual(['POST','GET','GET']);expect(new URL(f.requests[1]!.url).searchParams.get('id')).toBe(op);expect(f.cards.prepare).toHaveBeenCalledTimes(1);expect(f.money.nextOperationId).not.toHaveBeenCalled();
 });
 it.each(['unknown','open'] as const)('preparation recovery inspects an already %s attempt instead of re-dispatching',async state=>{
  const f=setup();f.store.readBalanceV2.mockRejectedValueOnce(new AppError('UNAVAILABLE'));await f.workflow.prepareCard(f.command,f.base);
  f.attempt.state=state;f.attempt.dispatchId=syntheticId(802);if(state==='open'){f.attempt.sessionId='cs_test_SYNTHETIC';f.attempt.checkoutUrl=url;}
  await f.workflow.readCard(f.base);expect(f.workflow.getSnapshot().card?.projection?.attempt.state).toBe(state);
  expect(f.workflow.canCreateCheckout(f.base)).toBe(false);expect(await f.workflow.createCardCheckout(op,f.base)).toBe(false);expect(f.cards.createCheckout).not.toHaveBeenCalled();
  expect(f.workflow.unresolved()).toBe(state==='unknown');expect(f.workflow.checkoutUrl(f.base)).toBe(state==='open'?url:null);
 });
 it('retains UNKNOWN after dispatch invocation and GET never creates another Checkout',async()=>{
  const f=setup();await f.workflow.prepareCard(f.command,f.base);
  f.cards.createCheckout.mockImplementationOnce(async()=>{f.attempt.state='unknown';f.attempt.dispatchId=syntheticId(802);throw new AppError('FORBIDDEN');});
  await f.workflow.createCardCheckout(op,f.current);expect(f.workflow.unresolved()).toBe(true);expect(f.workflow.checkoutUrl(f.current)).toBeNull();
  await f.workflow.readCard(f.current);expect(f.workflow.getSnapshot().card?.projection?.attempt.state).toBe('unknown');expect(f.workflow.clear()).toBe(false);
  expect(await f.workflow.createCardCheckout(op,f.current)).toBe(false);expect(await f.workflow.submit('cash',f.cash,f.current)).toBe(false);
  expect(f.cards.createCheckout).toHaveBeenCalledTimes(1);expect(f.requests.map(r=>r.method)).toEqual(['POST','POST','GET']);
 });
 it('does not reset the invocation reservation even if a later attempt read reports prepared',async()=>{
  const f=setup();await f.workflow.prepareCard(f.command,f.base);f.cards.createCheckout.mockRejectedValueOnce(new AppError('UNAVAILABLE'));
  await f.workflow.createCardCheckout(op,f.current);await f.workflow.readCard(f.current);
  expect(f.workflow.getSnapshot().card).toMatchObject({phase:'ready',checkoutInvoked:true,projection:{attempt:{state:'prepared'}}});
  await f.workflow.readCard(f.current,op);expect(f.workflow.getSnapshot().card?.checkoutInvoked).toBe(true);
  expect(await f.workflow.createCardCheckout(op,f.current)).toBe(false);expect(f.cards.createCheckout).toHaveBeenCalledTimes(1);
 });
 it('keeps card context through a cash entry, invalidates its old link, and never infers paid from it',async()=>{
  const f=setup();await f.workflow.prepareCard(f.command,f.base);await f.workflow.createCardCheckout(op,f.current);
  const raw:Record<string,unknown>={...f.base.balance.receipts[1]!,id:syntheticId(903),operationId:f.cash.operationId,receivedDate:'2035-01-06',amountMinor:100,allocations:f.cash.allocations};
  const quote={...f.current.quote,revision:7},balance=projectBalanceV2(quote,[...f.current.balance.receipts,raw as typeof f.base.balance.receipts[number]]),next={quote,balance};
  const receipt:BillingOperationReceipt={version:BILLING_DTO_V2,sourceVersion:BILLING_DTO_V2,operationId:f.cash.operationId,entityId:quote.id,entityVersion:7,replayed:false,result:{...next,receiptId:syntheticId(903)}};
  f.money.recordCashDate=vi.fn(async():Promise<CommandOutcome>=>({kind:'confirmed',receipt,current:next}));
  await f.workflow.submit('cash',f.cash,f.current);expect(f.workflow.getSnapshot().phase).toBe('confirmed');expect(f.workflow.currentFor(f.base).balance.paidMinor).toBe(85100);
  expect(f.workflow.getSnapshot().card?.operationId).toBe(op);expect(f.workflow.checkoutUrl(next)).toBeNull();expect(render(f,next)).not.toContain('href=');
 });
 it('preserves state controls and mixed history while withholding a link after pause',async()=>{
  const f=setup();await f.workflow.prepareCard(f.command,f.base);await f.workflow.createCardCheckout(op,f.current);
  const command=prepareStateCommand('pause',f.current,syntheticId(904)),quote=changeBillingState(f.current.quote,6,{paused:true}),next={quote,balance:projectBalanceV2(quote,f.current.balance.receipts,[op])};
  const receipt:BillingOperationReceipt={version:BILLING_DTO_V2,sourceVersion:BILLING_DTO_V2,operationId:command.operationId,entityId:quote.id,entityVersion:7,replayed:false,result:{...next,receiptId:null}};
  f.money.setState=vi.fn(async():Promise<CommandOutcome>=>({kind:'confirmed',receipt,current:next}));
  await f.workflow.submit('state',command,f.current);expect(f.workflow.getSnapshot().phase).toBe('confirmed');expect(f.workflow.currentFor(f.base).balance.paused).toBe(true);
  expect(f.workflow.currentFor(f.base).balance.receipts).toEqual(f.base.balance.receipts);expect(f.workflow.checkoutUrl(next)).toBeNull();
 });
 it('checks an existing pending attempt without generating an ID or dispatching',async()=>{
  const f=setup();await f.workflow.readCard(f.current,op);
  expect(f.requests.map(r=>r.method)).toEqual(['GET']);expect(f.workflow.getSnapshot().card).toMatchObject({operationId:op,command:f.command});expect(f.cards.prepare).not.toHaveBeenCalled();expect(f.cards.createCheckout).not.toHaveBeenCalled();expect(f.money.nextOperationId).not.toHaveBeenCalled();
 });
 it.each(['family','workspace'] as const)('withholds a stale/foreign %s projection and never exposes its URL',async field=>{
  const f=setup();f.attempt.state='open';f.attempt.dispatchId=syntheticId(802);f.attempt.sessionId='cs_test_SYNTHETIC';f.attempt.checkoutUrl=url;
  if(field==='family')f.attempt.familyId=syntheticId(990);else f.attempt.workspaceId=syntheticId(990);
  await f.workflow.prepareCard(f.command,f.base);expect(f.workflow.unresolved()).toBe(true);expect(f.workflow.checkoutUrl(f.base)).toBeNull();expect(render(f)).not.toContain('href=');expect(f.workflow.currentFor(f.base)).toEqual(f.base);
 });
 it('rejects a stale current read without regressing a newer observed version',async()=>{
  const f=setup();await f.workflow.prepareCard(f.command,f.base);await f.workflow.createCardCheckout(op,f.current);
  const stale=structuredClone(f.current),quote={...f.current.quote,revision:7},newer={quote,balance:projectBalanceV2(quote,f.current.balance.receipts,[op])};
  f.store.readBalanceV2.mockResolvedValueOnce(stale);await f.workflow.readCard(newer);
  expect(f.workflow.unresolved()).toBe(true);expect(f.workflow.currentFor(f.base).balance.revision).toBe(7);expect(f.workflow.checkoutUrl(newer)).toBeNull();
 });
 it('rejects a reviewed draft after an asynchronous current-version change without posting',async()=>{
  const f=setup(),quote={...f.base.quote,revision:7},newer={quote,balance:projectBalanceV2(quote,f.base.balance.receipts)};
  expect(await f.workflow.prepareCard(f.command,newer)).toBe(false);expect(f.requests).toEqual([]);expect(f.cards.prepare).not.toHaveBeenCalled();
 });
 it('does not expose a late original-family result in another current scope',async()=>{
  const f=setup();let release!:()=>void;const barrier=new Promise<void>(resolve=>{release=resolve;});f.cards.prepare.mockImplementationOnce(async()=>{await barrier;return f.prepared;});
  const pending=f.workflow.prepareCard(f.command,f.base),other=structuredClone(f.base);other.quote.familyId=syntheticId(991);other.quote.id=syntheticId(992);other.balance=projectBalanceV2(other.quote,other.balance.receipts.map(r=>({...r,familyId:other.quote.familyId,quoteId:other.quote.id})));
  expect(render(f,other)).not.toContain(op);expect(render(f,other)).not.toContain('href=');release();await pending;
  expect(render(f,other)).not.toContain(op);expect(render(f,other)).not.toContain('href=');expect(await f.workflow.readCard(other)).toBe(false);
 });
 it('blocks duplicate prepare and preserves the original immutable selection during an async request',async()=>{
  const f=setup(),raw=structuredClone(f.command);let release!:()=>void;const barrier=new Promise<void>(resolve=>{release=resolve;});f.cards.prepare.mockImplementationOnce(async()=>{await barrier;return f.prepared;});
  const pending=f.workflow.prepareCard(raw,f.base);raw.selection[0]!.amountMinor=1;
  expect(await f.workflow.prepareCard({...f.command,operationId:syntheticId(995)},f.base)).toBe(false);release();await pending;
  expect(f.workflow.getSnapshot().card?.command?.selection[0]!.amountMinor).toBe(20000);expect(f.cards.prepare).toHaveBeenCalledTimes(1);
 });
});

describe('explicit default-off card presentation and link gates',()=>{
 it('renders without invoking any client, provider, navigation or ID generator',()=>{
  const f=setup(),html=render(f,f.base,false);expect(html).toContain('disabled');expect(html).not.toContain('href=');expect(f.requests).toEqual([]);expect(f.money.nextOperationId).not.toHaveBeenCalled();
  const absent=new BillingWorkflow(f.money);expect(absent.canPrepareCard(f.base)).toBe(false);expect(absent.checkoutUrl(f.base)).toBeNull();
 });
 it('withholds the link with capability off, non-open state or a changed current revision',async()=>{
  const f=setup();await f.workflow.prepareCard(f.command,f.base);await f.workflow.createCardCheckout(op,f.current);
  expect(render(f,f.current,false)).not.toContain('href=');
  const quote={...f.current.quote,revision:7},newer={quote,balance:projectBalanceV2(quote,f.current.balance.receipts,[op])};expect(render(f,newer)).not.toContain('href=');expect(f.workflow.canCreateCheckout(newer)).toBe(false);
  f.attempt.state='pending';f.attempt.checkoutUrl=null;await f.workflow.readCard(f.current);expect(render(f)).not.toContain('href=');expect(render(f)).toContain('no payment confirmed');
 });
 it('never uses a historical attempt URL from an untyped response',async()=>{
  const f=setup(),bad:CardClient={...f.client,readAttempt:async()=>({version:'JLFA-FISHING-OWNER-CARD-v1',state:'attempt',attempt:{...f.attempt,checkoutUrl:url},current:f.current,checkoutUrl:null})};
  const w=new BillingWorkflow(f.money,bad);await w.readCard(f.current,op);expect(w.unresolved()).toBe(true);expect(w.checkoutUrl(f.current)).toBeNull();
 });
 it('validates allocation amounts against actual outstanding quote lines',()=>{
  const f=setup();expect(()=>cardCommand({...f.command,selection:[{lineId:f.base.quote.lines[0]!.id,amountMinor:1}]},f.base)).toThrow();
  expect(()=>cardCommand({...f.command,selection:[{lineId:f.base.quote.lines[1]!.id,amountMinor:45001}]},f.base)).toThrow();
  expect(()=>cardCommand({...f.command,selection:[]},f.base)).toThrow();
 });
});
