import {describe,it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {syntheticGuestOwnerMoneyFixturesV3} from '../../fixtures/fishing-billing-owner-v3.ts';
import {syntheticId,syntheticOwner,syntheticAccepted} from '../../../src/features/fishing-billing/fixtures.ts';
import {syntheticDateCashFixtures} from '../../../src/features/fishing-billing/fixtures-v2.ts';
import {CARD_VERSION,cardPreparationReceiptSchema} from '../../../src/features/fishing-billing/card-contracts.ts';
import {BILLING_CARD_OWNER_V3,billingCardOwnerAttemptV3Schema,currentCardCheckoutPermittedV3} from '../../../src/lib/fishing-billing-card-owner-contract-v3.ts';
import {createFishingBillingCardOwnerClientV3} from '../../../src/lib/fishing-billing-card-owner-client-v3.ts';
import {createFishingBillingOwnerClientV3} from '../../../src/lib/fishing-billing-owner-client-v3.ts';
import {projectBillingCurrentLedgerV3} from '../../../src/lib/fishing-billing-current-ledger-v3.ts';
import {guestMoneyPorts,prepareStateCommand} from '../../../src/features/fishing-billing-ui/owner-model.ts';
import {guestCardPorts,guestCardCommand,guestCardCurrent,guestCardContext,guestCardProjection,type GuestCardPorts} from '../../../src/features/fishing-billing-ui/owner-card-model-v3.ts';
import {BillingWorkflow} from '../../../src/features/fishing-billing-ui/workflow.ts';
import {CardControls,OwnerBillingPanel} from '../../../src/features/fishing-billing-ui/owner-billing-panel.tsx';

// Test-only pure fixture + actual Root V3 client over injected synthetic wire.
// No Native store, real identity, provider, browser or live-payment proof.
const f=syntheticGuestOwnerMoneyFixturesV3(),id=syntheticId(3100),checkout='https://checkout.stripe.com/c/pay/SYNTHETIC_UI_ONLY';
const ok=(data:unknown)=>new Response(JSON.stringify({ok:true,requestId:syntheticId(3199),data}),{headers:{'content-type':'application/json'}});
const unavailable=()=>new Response(JSON.stringify({ok:false,requestId:syntheticId(3199),error:{code:'UNAVAILABLE'}}),{status:503,headers:{'content-type':'application/json'}});
function setup(){
 const base=f.accepted,command=guestCardCommand({operationId:id,quoteId:base.quote.id,expectedVersion:base.quote.revision,selection:[{lineId:base.quote.lines[0]!.id,amountMinor:10000},{lineId:base.quote.lines[1]!.id,amountMinor:15000}]},base);
 const receipt=cardPreparationReceiptSchema.parse({version:CARD_VERSION,operationId:id,quoteId:base.quote.id,entityVersion:4,replayed:false,result:{attemptId:id,amountMinor:25000,allocations:command.selection}});
 const frame=(data=base,pending:string[]=[id])=>projectBillingCurrentLedgerV3({source:{kind:'guest_successor',quote:data.quote},receipts:data.balance.receipts,exceptions:[],pendingAttemptIds:pending});
 let current=frame({...base,quote:{...base.quote,revision:4}}),attempt=billingCardOwnerAttemptV3Schema.parse({version:CARD_VERSION,id,workspaceId:base.quote.workspaceId,familyId:base.quote.familyId,quoteId:base.quote.id,actorId:syntheticOwner,revision:1,balanceVersion:4,binding:{accountId:'acct_SYNTHETIC',livemode:false,apiVersion:'2026-09-30.endive',verifiedBindingId:'SYNTHETIC_ONLY'},command,requestDigest:'d'.repeat(64),preparation:receipt,createdAt:'2035-01-02T12:00:00Z',state:'prepared',dispatchId:null,sessionId:null,paymentIntentId:null});
 const projection=(state:'prepared'|'attempt'='prepared')=>({version:BILLING_CARD_OWNER_V3,state,attempt,current,checkoutUrl:currentCardCheckoutPermittedV3(attempt,current)?checkout:null,...(state==='prepared'?{receipt:{...receipt,replayed:true}}:{})});
 const requests:Request[]=[];
 const transport=vi.fn(async(request:Request)=>{
  requests.push(request.clone());
  if(request.method==='POST'){
   const body=await request.json();if(body.action==='prepare')return ok(projection());
   attempt=billingCardOwnerAttemptV3Schema.parse({...attempt,revision:2,state:'open',dispatchId:syntheticId(3101),sessionId:'cs_SYNTHETIC_UI'});return ok(projection('attempt'));
  }
  return ok(projection(new URL(request.url).searchParams.get('kind')==='operation'?'prepared':'attempt'));
 });
 const client=createFishingBillingCardOwnerClientV3({origin:'https://synthetic-card-ui.invalid',scope:f.scope,csrf:async()=>'a'.repeat(43),transport,readCurrent:async()=>current});
 const money=createFishingBillingOwnerClientV3({origin:'https://synthetic-card-ui.invalid',scope:f.scope,csrf:async()=>'a'.repeat(43),transport:async()=>unavailable()});
 const nextOperationId=vi.fn(()=>id),moneyPorts=guestMoneyPorts(money,nextOperationId),ports=guestCardPorts(client),workflow=new BillingWorkflow(moneyPorts,null,ports);
 return {base,command,receipt,frame,projection,requests,transport,client,moneyPorts,ports,workflow,nextOperationId,setCurrent:(value:typeof current)=>{current=value;},setAttempt:(patch:Partial<typeof attempt>)=>{attempt=billingCardOwnerAttemptV3Schema.parse({...attempt,...patch});}};
}
function controls(s:ReturnType<typeof setup>,locale:'en'|'he'='en',allowed=true){return renderToStaticMarkup(createElement(CardControls,{locale,data:s.workflow.currentFor(s.base),workflow:s.workflow,allowed,onPrepare:()=>{},onCheckout:()=>{}}));}

describe('explicit V3 card UI consumer with real Root client / synthetic wire',()=>{
 it('keeps the generic original preparation distinct from the current guest frame and paid balance',async()=>{
  const s=setup();expect(s.ports.version).toBe(BILLING_CARD_OWNER_V3);expect(await s.workflow.prepareCard(s.command,s.base)).toBe(true);
  const c=s.workflow.getSnapshot().guestCard!;expect(c.command).toEqual(s.command);expect(c.projection!.attempt.version).toBe(CARD_VERSION);expect(c.projection!.current.source.kind).toBe('guest_successor');
  expect(c.projection!.attempt.preparation.result.amountMinor).toBe(25000);expect(s.workflow.currentFor(s.base).balance.paidMinor).toBe(0);expect(s.workflow.canCreateCheckout(s.base)).toBe(true);expect(s.workflow.checkoutUrl(s.base)).toBeNull();
  expect(await s.requests[0]!.json()).toEqual({version:BILLING_CARD_OWNER_V3,action:'prepare',command:s.command});expect(s.nextOperationId).not.toHaveBeenCalled();
 });
 it.each(['en','he'] as const)('renders separate preparation/checkout and a manually actionable current link in %s',async locale=>{
  const s=setup();await s.workflow.prepareCard(s.command,s.base);await s.workflow.createCardCheckout(id,s.base);
  expect(s.workflow.checkoutUrl(s.base)).toBe(checkout);expect(s.workflow.canCreateCheckout(s.base)).toBe(false);
  const html=controls(s,locale);expect(html).toContain(checkout);expect(html).toContain(locale==='en'?'Open TEST Checkout':'פתיחת TEST Checkout');expect(html).toContain(locale==='en'?'does not mark the family paid':'אינם מסמנים את המשפחה כמי ששילמה');expect(html).toContain('250.00');
  expect(s.requests).toHaveLength(2);expect(await s.requests[1]!.json()).toEqual({version:BILLING_CARD_OWNER_V3,action:'create_checkout',command:{quoteId:s.base.quote.id,attemptId:id}});
  const disabled=controls(s,locale,false);expect(disabled).not.toContain('href=');expect(disabled.match(/<button[^>]*>/g)!.every(tag=>tag.includes('disabled'))).toBe(true);
 });
 it('keeps original answers/key after lost preparation reply and null lookup, with no replacement save',async()=>{
  const s=setup();s.transport.mockImplementationOnce(async r=>{s.requests.push(r.clone());return unavailable();});
  await s.workflow.prepareCard(s.command,s.base);expect(s.workflow.getSnapshot().guestCard).toMatchObject({phase:'unknown',command:s.command,lookup:'operation'});expect(s.workflow.clear()).toBe(false);
  expect(await s.workflow.prepareCard({...s.command,operationId:syntheticId(3110)},s.base)).toBe(false);expect(await s.workflow.submit('state',prepareStateCommand('pause',s.base,syntheticId(3111)),s.base)).toBe(false);
  s.transport.mockImplementationOnce(async r=>{s.requests.push(r.clone());return ok({version:BILLING_CARD_OWNER_V3,state:'unresolved',quoteId:s.base.quote.id,operationId:id});});
  await s.workflow.readCard(s.base);expect(s.workflow.getSnapshot().guestCard!.phase).toBe('unknown');expect(s.workflow.canPrepareCard(s.base)).toBe(false);
  s.setCurrent(s.frame(f.later));await s.workflow.readCard(s.base);
  const c=s.workflow.getSnapshot().guestCard!;expect(c.phase).toBe('ready');expect(c.projection!.attempt.preparation.entityVersion).toBe(4);expect(c.projection!.current.source.quote.revision).toBe(5);
  expect(s.workflow.currentFor(s.base).balance.paidMinor).toBe(25000);expect(s.workflow.currentFor(s.base).balance.receipts).toHaveLength(2);expect(s.workflow.canCreateCheckout(s.base)).toBe(false);
  expect(s.requests.map(r=>r.method)).toEqual(['POST','GET','GET']);for(const r of s.requests.slice(1))expect(new URL(r.url).searchParams.get('id')).toBe(id);
 });
 it('holds one immutable preparation during an asynchronous reply and blocks all replacement commands',async()=>{
  const s=setup();let release!:(response:Response)=>void;const reply=new Promise<Response>(resolve=>{release=resolve;});s.transport.mockImplementationOnce(async()=>reply);
  const pending=s.workflow.prepareCard(s.command,s.base);expect(s.workflow.getSnapshot().guestCard).toMatchObject({phase:'preparing',command:s.command});
  expect(Object.isFrozen(s.workflow.getSnapshot().guestCard!.command!.selection)).toBe(true);expect(await s.workflow.prepareCard({...s.command,operationId:syntheticId(3120)},s.base)).toBe(false);
  expect(await s.workflow.createCardCheckout(id,s.base)).toBe(false);expect(s.workflow.clear()).toBe(false);expect(s.workflow.checkoutUrl(f.later)).toBeNull();
  release(ok(s.projection()));await pending;expect(s.workflow.getSnapshot().guestCard!.operationId).toBe(id);expect(s.transport).toHaveBeenCalledOnce();
 });
 it('uses a known preflight conflict full frame without presenting it as a saved preparation',async()=>{
  const s=setup();s.setCurrent(s.frame(f.later,[]));s.transport.mockResolvedValueOnce(new Response(JSON.stringify({ok:false,requestId:syntheticId(3199),error:{code:'CONFLICT'}}),{status:409,headers:{'content-type':'application/json'}}));
  await s.workflow.prepareCard(s.command,s.base);expect(s.workflow.getSnapshot().guestCard).toMatchObject({phase:'conflict',command:s.command,fresh:false});
  expect(s.workflow.getSnapshot().guestCard!.projection).toBeUndefined();expect(s.workflow.currentFor(s.base).balance.receipts).toHaveLength(2);expect(s.workflow.checkoutUrl(s.base)).toBeNull();expect(s.transport).toHaveBeenCalledOnce();
 });
 it('checks the original attempt after uncertain checkout without a second dispatch',async()=>{
  const s=setup();await s.workflow.prepareCard(s.command,s.base);
  s.transport.mockImplementationOnce(async r=>{s.requests.push(r.clone());s.setAttempt({state:'open',dispatchId:syntheticId(3101),sessionId:'cs_SYNTHETIC_UI'});return unavailable();});
  await s.workflow.createCardCheckout(id,s.base);expect(s.workflow.getSnapshot().guestCard).toMatchObject({phase:'unknown',checkoutInvoked:true,lookup:'attempt'});expect(s.workflow.checkoutUrl(s.base)).toBeNull();
  expect(await s.workflow.createCardCheckout(id,s.base)).toBe(false);await s.workflow.readCard(s.base);expect(s.workflow.checkoutUrl(s.base)).toBe(checkout);expect(s.requests.map(r=>r.method)).toEqual(['POST','POST','GET']);
  expect(await s.workflow.createCardCheckout(id,s.base)).toBe(false);
 });
 it.each(['paused','cancelled','cash','review'] as const)('does not expose a formerly eligible URL after %s current readback',async mode=>{
  const s=setup();await s.workflow.prepareCard(s.command,s.base);await s.workflow.createCardCheckout(id,s.base);
  const b=guestCardCurrent(s.projection().current),data=mode==='cash'?f.later:{...b,quote:{...b.quote,revision:5,paused:mode==='paused',state:mode==='cancelled'?'cancelled' as const:b.quote.state}};
  const frame=s.frame(data);s.setCurrent(mode==='review'?{...frame,balance:{...frame.balance,state:'review_required'},cardExceptions:[{id:syntheticId(3113),state:'open'}]}:frame);
  await s.workflow.readCard(s.base);expect(s.workflow.checkoutUrl(s.base)).toBeNull();expect(controls(s)).not.toContain('href=');expect(s.requests.filter(r=>r.method==='POST')).toHaveLength(2);
 });
 it('immediately removes eligibility during uncertain cash recording and retains both original references',async()=>{
  const s=setup();await s.workflow.prepareCard(s.command,s.base);await s.workflow.createCardCheckout(id,s.base);
  const data=s.workflow.currentFor(s.base),cash={...f.cashCommand,expectedVersion:data.balance.revision};await s.workflow.submit('cash',cash,data);
  expect(s.workflow.checkoutUrl(data)).toBeNull();expect(s.workflow.getSnapshot()).toMatchObject({phase:'unknown',command:cash,guestCard:{fresh:false,operationId:id}});expect(s.workflow.clear()).toBe(false);
 });
 it('does not use an old URL when a newer balance is supplied before readback',async()=>{
  const s=setup();await s.workflow.prepareCard(s.command,s.base);await s.workflow.createCardCheckout(id,s.base);expect(s.workflow.checkoutUrl(f.later)).toBeNull();expect(s.workflow.canCreateCheckout(f.later)).toBe(false);
 });
 it('never regresses a newer observed ledger or drops its receipts during original-attempt readback',async()=>{
  const s=setup();await s.workflow.prepareCard(s.command,s.base);
  await s.workflow.readCard(f.later);expect(s.workflow.getSnapshot().guestCard!.phase).toBe('unknown');expect(s.workflow.currentFor(s.base)).toEqual(f.later);
  s.setCurrent(s.frame({...s.base,quote:{...s.base.quote,revision:6}}));await s.workflow.readCard(f.later);
  expect(s.workflow.getSnapshot().guestCard!.phase).toBe('unknown');expect(s.workflow.currentFor(s.base)).toEqual(f.later);expect(s.workflow.checkoutUrl(f.later)).toBeNull();
 });
 it('does not recover an actionable URL from a historical field in an untyped attempt',async()=>{
  const s=setup();s.transport.mockResolvedValueOnce(ok({...s.projection(),attempt:{...s.projection().attempt,checkoutUrl:checkout}}));await s.workflow.prepareCard(s.command,s.base);
  expect(s.workflow.getSnapshot().guestCard!.phase).toBe('unknown');expect(s.workflow.checkoutUrl(s.base)).toBeNull();expect(s.workflow.clear()).toBe(false);
 });
 it('retains uncertain preparation on a failed recovery read and preserves the original full current',async()=>{
  const s=setup();s.transport.mockResolvedValueOnce(unavailable());await s.workflow.prepareCard(s.command,s.base);s.transport.mockRejectedValueOnce(Error('SYNTHETIC_CURRENT_UNAVAILABLE'));
  await s.workflow.readCard(s.base);expect(s.workflow.getSnapshot().guestCard).toMatchObject({phase:'unknown',command:s.command});expect(s.workflow.currentFor(s.base)).toEqual(s.base);expect(s.workflow.unresolved()).toBe(true);
 });
 it('rejects a different captured selection on original-operation recovery',async()=>{
  const s=setup();s.transport.mockResolvedValueOnce(unavailable());await s.workflow.prepareCard(s.command,s.base);
  const changed={...s.command,selection:[{lineId:s.command.selection[0]!.lineId,amountMinor:25000}]};s.setAttempt({command:changed,preparation:{...s.receipt,result:{...s.receipt.result,allocations:changed.selection}}});
  // Keep top-level receipt coherent, so rejection must include captured-answer binding.
  s.transport.mockResolvedValueOnce(ok({...s.projection(),receipt:{...s.receipt,result:{...s.receipt.result,allocations:changed.selection}}}));await s.workflow.readCard(s.base);
  expect(s.workflow.getSnapshot().guestCard).toMatchObject({phase:'unknown',command:s.command});expect(s.workflow.currentFor(s.base)).toEqual(s.base);
 });
 it('refuses a historical-account current frame rather than relabeling it guest',()=>{
  const s=setup(),historical=projectBillingCurrentLedgerV3({source:{kind:'historical_account',quote:syntheticAccepted()},receipts:[],exceptions:[],originalAccountSnapshot:syntheticAccepted()});
  expect(()=>guestCardCurrent(historical)).toThrow('GUEST_CARD_SOURCE_MISMATCH');expect(()=>guestCardProjection({...s.projection(),current:historical},guestCardContext(s.base,id,s.command))).toThrow();
 });
 it('rejects different immutable guest acceptance evidence while preserving uncertainty',async()=>{
  const s=setup();s.transport.mockResolvedValueOnce(unavailable());await s.workflow.prepareCard(s.command,s.base);
  const data={...s.base,quote:{...s.base.quote,revision:4,acceptance:{...s.base.quote.acceptance!,grantId:syntheticId(3114)}}};s.setCurrent(s.frame(data));await s.workflow.readCard(s.base);
  expect(s.workflow.getSnapshot().guestCard!.phase).toBe('unknown');expect(s.workflow.currentFor(s.base)).toEqual(s.base);
 });
 it('reads an existing pending reference without generating an operation or creating Checkout',async()=>{
  const s=setup(),data=guestCardCurrent(s.projection().current);expect(s.workflow.canPrepareCard(data)).toBe(false);expect(await s.workflow.readCard(data,id)).toBe(true);
  expect(s.workflow.getSnapshot().guestCard!.command).toEqual(s.command);expect(s.requests.map(r=>r.method)).toEqual(['GET']);expect(new URL(s.requests[0]!.url).searchParams.get('kind')).toBe('attempt');expect(s.nextOperationId).not.toHaveBeenCalled();
 });
 it('does not permit missing, unversioned or absent-money capabilities to activate card actions',async()=>{
  const s=setup(),bare=new BillingWorkflow(s.moneyPorts),wrong=new BillingWorkflow(s.moneyPorts,null,s.client as unknown as GuestCardPorts),noMoney=new BillingWorkflow(null,null,s.ports);
  for(const w of [bare,wrong,noMoney]){expect(w.hasCardClient(s.base)).toBe(false);expect(w.canPrepareCard(s.base)).toBe(false);expect(await w.prepareCard(s.command,s.base)).toBe(false);expect(w.checkoutUrl(s.base)).toBeNull();}
  expect(s.transport).not.toHaveBeenCalled();
 });
 it('keeps stale, duplicate and overallocated selections out of the injected transport',async()=>{
  const s=setup();for(const command of [{...s.command,expectedVersion:2},{...s.command,selection:[s.command.selection[0]!,s.command.selection[0]!]},{...s.command,selection:[{lineId:s.command.selection[0]!.lineId,amountMinor:999999}]}])expect(await s.workflow.prepareCard(command,s.base)).toBe(false);
  expect(s.transport).not.toHaveBeenCalled();
 });
 it('preserves the original operation across family/version changes without leaking a link',async()=>{
  const s=setup();s.transport.mockResolvedValueOnce(unavailable());await s.workflow.prepareCard(s.command,s.base);
  const other=syntheticDateCashFixtures();expect(s.workflow.checkoutUrl(other)).toBeNull();expect(s.workflow.canPrepareCard(other)).toBe(false);expect(s.workflow.canReadCard(other)).toBe(false);expect(s.workflow.clear()).toBe(false);expect(s.workflow.getSnapshot().guestCard!.command).toEqual(s.command);
 });
 it.each(['en','he'] as const)('renders the full current sibling ledger in the existing %s panel without effect',async locale=>{
  const s=setup();s.setCurrent(s.frame(f.later));await s.workflow.prepareCard(s.command,s.base);
  const before=s.transport.mock.calls.length,subject={familyId:s.base.quote.familyId,label:'SYNTHETIC family',children:s.base.quote.lines.map((l,i)=>({id:l.childId,name:i?'SYNTHETIC Noam':'SYNTHETIC Ari'}))};
  const html=renderToStaticMarkup(createElement(OwnerBillingPanel,{locale,view:{state:'ready',data:s.base},subject,workflow:s.workflow,cardAllowed:true}));
  expect(html).toContain('SYNTHETIC Ari');expect(html).toContain('SYNTHETIC Noam');expect(html).toContain('250.00');for(const r of f.later.balance.receipts)expect(html).toContain(r.id);
  expect(html).not.toContain('href=');expect(s.transport).toHaveBeenCalledTimes(before);
 });
});
