import {describe,it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {syntheticGuestOwnerMoneyFixturesV3} from '../../fixtures/fishing-billing-owner-v3.ts';
import {syntheticDateCashFixtures} from '../../../src/features/fishing-billing/fixtures-v2.ts';
import {syntheticId} from '../../../src/features/fishing-billing/fixtures.ts';
import {OwnerBillingPanel,WorkflowNotice} from '../../../src/features/fishing-billing-ui/owner-billing-panel.tsx';
import {BillingWorkflow} from '../../../src/features/fishing-billing-ui/workflow.ts';
import {guestMoneyPorts,decodeData,prepareStateCommand,dataScope} from '../../../src/features/fishing-billing-ui/owner-model.ts';
import type {BillingUiPorts as LegacyPorts} from '../../../src/features/fishing-billing-ui/model.ts';
import {createFishingBillingOwnerClientV3} from '../../../src/lib/fishing-billing-owner-client-v3.ts';
import {OWNER_MONEY_V3,compactOwnerOperationResultV3,ownerMoneyReceiptV3Schema,type OwnerMoneyReceiptV3} from '../../../src/lib/fishing-billing-owner-contract-v3.ts';
import {BILLING_GUEST_V3} from '../../../src/lib/fishing-billing-guest-contract-v3.ts';
import {ownerCurrentV3Schema} from '../../../src/lib/fishing-billing-owner-contract-v3.ts';
import {projectGuestBalanceV3,changeGuestBillingState} from '../../../src/features/fishing-billing/guest-domain-v3.ts';
import {createFishingBillingCardOwnerClient} from '../../../src/lib/fishing-billing-card-owner-client.ts';

// This is deliberately the released PURE_DATA_NOT_NATIVE_OR_LIVE fixture,
// never a Native export, legal admission, real family or provider receipt.
const f=syntheticGuestOwnerMoneyFixturesV3();
const subject={familyId:f.scope.familyId,label:'SYNTHETIC guest family',children:f.accepted.quote.lines.map((l,i)=>({id:l.childId,name:i?'SYNTHETIC Noam':'SYNTHETIC Ari'}))};
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
const ok=(data:unknown)=>json({ok:true,requestId:syntheticId(2990),data});
const unavailable=()=>json({ok:false,requestId:syntheticId(2990),error:{code:'UNAVAILABLE'}},503);
function setup(transport:(request:Request)=>Promise<Response>,scope=f.scope){
 const nextOperationId=vi.fn(()=>f.cashCommand.operationId),client=createFishingBillingOwnerClientV3({origin:'https://synthetic-guest-ui.invalid',scope,csrf:async()=>'a'.repeat(43),transport});
 const ports=guestMoneyPorts(client,nextOperationId),workflow=new BillingWorkflow(ports);
 return {client,ports,workflow,nextOperationId};
}
function render(data=f.later,workflow=new BillingWorkflow(null),locale:'en'|'he'='en'){
 return renderToStaticMarkup(createElement(OwnerBillingPanel,{locale,view:{state:'ready',data},subject,workflow,cashAllowed:true,reversalAllowed:true,stateAllowed:true,cardAllowed:true}));
}
function summary(html:string){const at=html.indexOf('aria-label="Authoritative balance"');return html.slice(at,html.indexOf('<section',at));}
function stateReceipt(current:typeof f.paused,operationId:string):OwnerMoneyReceiptV3{
 return ownerMoneyReceiptV3Schema.parse({version:OWNER_MONEY_V3,operationId,action:'state',entityId:current.quote.id,entityVersion:current.quote.revision,recordedAt:f.original.recordedAt,replayed:false,result:compactOwnerOperationResultV3(current,null)});
}

describe('explicit guest V3 current/full versus original/compact UI boundary',()=>{
 it('consumes the released synthetic-only fixture with distinct command and quote versions',()=>{
  expect(f.evidenceKind).toBe('PURE_DATA_NOT_NATIVE_OR_LIVE');expect(f.syntheticOnly).toBe(true);
  expect(f.cashCommand.version).toBe(OWNER_MONEY_V3);expect(f.accepted.quote.version).toBe(BILLING_GUEST_V3);expect(f.accepted.balance.version).toBe(BILLING_GUEST_V3);
  expect(f.accepted.quote.acceptance).toMatchObject({kind:'guest_grant'});expect(f.accepted.quote.acceptance).not.toHaveProperty('actorId');
  expect(decodeData(f.later)).toEqual(f.later);expect(()=>decodeData(f.original.result)).toThrow();
 });
 it.each(['en','he'] as const)('renders current sibling balances and grant evidence in %s, never original summary as current',locale=>{
  const html=render(f.later,undefined,locale),amounts=locale==='en'?summary(html):html.slice(html.indexOf('aria-label="יתרה מאומתת"'),html.indexOf('<section',html.indexOf('aria-label="יתרה מאומתת"')));
  expect(amounts).toContain('250.00');expect(amounts).toContain('1,050.00');expect(amounts).not.toContain('200.00');
  expect(html).toContain('SYNTHETIC Ari');expect(html).toContain('SYNTHETIC Noam');expect(html).toContain(f.accepted.quote.acceptance!.grantId);
  expect(html).not.toContain('SYNTHETIC PARENT ONLY');expect(html).toContain(locale==='he'?'ראיות למענק גישה פרטי לאורח':'Private guest grant evidence');
 });
 it('renders all three current history entries, not just the two related correction facts',()=>{
  expect(f.correction.result.relatedReceipts).toHaveLength(2);expect(f.corrected.balance.receipts).toHaveLength(3);
  const history=render(f.corrected).match(/<ol[^>]*>[\s\S]*?<\/ol>/)![0];
  expect(history.match(/<li/g)).toHaveLength(3);for(const receipt of f.corrected.balance.receipts)expect(history).toContain(receipt.id);
  expect(history).toContain('2035-01-02</time>');expect(history).toContain('receipt time not recorded');
 });
 it('preserves nondebt, fully paid, paused, cancelled and unknown-reminder current projections',()=>{
  expect(render(f.unanswered)).toContain('No payment obligation');expect(render(f.full)).toContain('Paid');
  expect(render(f.paused)).toContain('Payment follow-up paused');expect(render(f.cancelled)).toContain('Offer cancelled');
  expect(render(f.unknownReminder)).toContain('Delivery unknown');
 });
 it('does not relabel a guest acceptance as an account actor or a V2 quote',()=>{
  const malformed=structuredClone(f.later);
  const raw:Record<string,unknown>={...malformed.quote,version:'JLFA-FISHING-BILLING-DTO-v1'};
  expect(()=>decodeData({...malformed,quote:raw})).toThrow();expect(f.later.quote.acceptance).not.toHaveProperty('actorId');
 });
});

describe('reviewed V3 client / injected synthetic wire with retained workflow',()=>{
 it('posts exact OWNER_MONEY answers once and uses separate current amounts after confirmation',async()=>{
  const requests:Request[]=[],x=setup(async request=>{requests.push(request.clone());return ok(f.recovered);});
  await x.workflow.submit('cash',f.cashCommand,f.accepted);
  expect(requests).toHaveLength(1);expect(await requests[0]!.json()).toEqual({action:'cash_date',command:f.cashCommand});expect(new URL(requests[0]!.url).pathname).toBe('/api/private/fishing-billing/v3');
  const state=x.workflow.getSnapshot();expect(state).toMatchObject({phase:'confirmed',receipt:{version:OWNER_MONEY_V3,result:{kind:'operation_snapshot',balance:{paidMinor:20000}}},data:{balance:{paidMinor:25000}}});
  expect(x.workflow.currentFor(f.accepted)).toEqual(f.later);expect(x.nextOperationId).not.toHaveBeenCalled();
  expect(summary(render(f.accepted,x.workflow))).toContain('250.00');
 });
 it('retains original answers/ID through 503, failed current read and null lookup without resending',async()=>{
  const requests:Request[]=[],replies=[unavailable(),unavailable(),ok(f.unresolved),ok(f.recovered)];
  // The unresolved transport must report the requested original operation.
  replies[2]=ok({...f.unresolved,operationId:f.cashCommand.operationId});
  const x=setup(async request=>{requests.push(request.clone());return replies.shift()!;});
  await x.workflow.submit('cash',f.cashCommand,f.accepted);expect(x.workflow.clear()).toBe(false);
  expect(await x.workflow.submit('cash',{...f.cashCommand,operationId:syntheticId(2980)},f.accepted)).toBe(false);
  await x.workflow.recover();await x.workflow.recover();expect(x.workflow.getSnapshot()).toMatchObject({phase:'unknown',command:f.cashCommand});expect(x.workflow.clear()).toBe(false);
  await x.workflow.recover();expect(x.workflow.getSnapshot().phase).toBe('confirmed');
  expect(requests.map(r=>r.method)).toEqual(['POST','GET','GET','GET']);for(const request of requests.slice(1))expect(new URL(request.url).searchParams.get('id')).toBe(f.cashCommand.operationId);
  expect(await requests[0]!.json()).toEqual({action:'cash_date',command:f.cashCommand});expect(x.nextOperationId).not.toHaveBeenCalled();
 });
 it('keeps a known original compact receipt while only refreshing temporarily unavailable current data',async()=>{
  const requests:Request[]=[],x=setup(async request=>{requests.push(request.clone());return ok({version:OWNER_MONEY_V3,state:'ready',current:f.later});});
  const save=vi.fn(async()=>({kind:'confirmed' as const,receipt:f.original,current:f.accepted}));
  const workflow=new BillingWorkflow(guestMoneyPorts({...x.client,recordCashDate:save},x.nextOperationId));
  await workflow.submit('cash',f.cashCommand,f.accepted);expect(workflow.getSnapshot()).toMatchObject({phase:'refresh_required',receipt:f.original});expect(workflow.clear()).toBe(false);
  expect(workflow.currentFor(f.accepted)).toEqual(f.accepted);
  const notice=renderToStaticMarkup(createElement(WorkflowNotice,{flow:workflow.getSnapshot(),workflow,locale:'en',showDetails:true}));
  expect(notice).toContain('Receipt confirmed · current balance unavailable');expect(notice).toContain('No additional entry is needed.');
  await workflow.refresh();expect(workflow.currentFor(f.accepted)).toEqual(f.later);expect(save).toHaveBeenCalledTimes(1);expect(requests.map(r=>r.method)).toEqual(['GET']);
 });
 it('uses the current complete history after correction while preserving original related facts',async()=>{
  const x=setup(async()=>ok({version:OWNER_MONEY_V3,state:'confirmed',receipt:f.correction,current:f.corrected}));
  await x.workflow.submit('reversal',f.correctionCommand,f.later);expect(x.workflow.getSnapshot().phase).toBe('confirmed');
  expect(x.workflow.currentFor(f.later).balance.receipts).toHaveLength(3);expect(f.correction.result.relatedReceipts).toHaveLength(2);
  expect(render(f.later,x.workflow)).toContain('SYNTHETIC correction');
 });
 it.each(['pause','resume','cancel'] as const)('uses the distinct V3 %s command without changing payment history',async action=>{
  const input=action==='resume'?f.paused:f.corrected,command=prepareStateCommand(action,input,syntheticId(2970)),quote=changeGuestBillingState(input.quote,input.quote.revision,action==='cancel'?{cancel:true}:{paused:action==='pause'});
  const current=ownerCurrentV3Schema.parse({quote,balance:projectGuestBalanceV3(quote,input.balance.receipts),receiptId:null}),receipt=stateReceipt(current,command.operationId),requests:Request[]=[];
  const x=setup(async request=>{requests.push(request.clone());return ok({version:OWNER_MONEY_V3,state:'confirmed',receipt,current});});
  await x.workflow.submit('state',command,input);expect(await requests[0]!.json()).toEqual({action:'state',command});expect(command.version).toBe(OWNER_MONEY_V3);
  expect(x.workflow.getSnapshot().phase).toBe('confirmed');expect(x.workflow.currentFor(input).balance.receipts).toEqual(input.balance.receipts);expect(x.workflow.currentFor(input).balance.paidMinor).toBe(input.balance.paidMinor);
 });
 it.each(['family','workspace'] as const)('keeps foreign %s readback unknown without leaking a current snapshot',async field=>{
  const scope={...f.scope,...(field==='family'?{familyId:syntheticId(2960)}:{workspaceId:syntheticId(2960)})},x=setup(async()=>ok(f.recovered),scope);
  await x.workflow.submit('cash',f.cashCommand,f.accepted);expect(x.workflow.getSnapshot().phase).toBe('unknown');expect(x.workflow.clear()).toBe(false);expect(x.workflow.currentFor(f.accepted)).toEqual(f.accepted);
 });
 it('rejects stale original/current lineage rather than substituting original summary as present state',async()=>{
  const x=setup(async()=>ok({version:OWNER_MONEY_V3,state:'confirmed',receipt:f.original,current:f.accepted}));
  await x.workflow.submit('cash',f.cashCommand,f.accepted);expect(x.workflow.getSnapshot().phase).toBe('unknown');expect(x.workflow.currentFor(f.accepted)).toEqual(f.accepted);
 });
 it('does not confirm an original receipt for different captured cash answers',async()=>{
  const command={...f.cashCommand,amountMinor:20001,allocations:f.cashCommand.allocations.map(a=>({...a,amountMinor:20001}))};
  const x=setup(async()=>ok(f.recovered));
  await x.workflow.submit('cash',command,f.accepted);
  expect(x.workflow.getSnapshot()).toMatchObject({phase:'unknown',command});expect(x.workflow.clear()).toBe(false);expect(x.workflow.currentFor(f.accepted)).toEqual(f.accepted);
 });
 it('retains the original operation during an async scope/version change and blocks a replacement',async()=>{
  let release!:(response:Response)=>void;const requests:Request[]=[],pendingReply=new Promise<Response>(resolve=>{release=resolve;});
  const x=setup(async request=>{requests.push(request.clone());return pendingReply;});
  const pending=x.workflow.submit('cash',f.cashCommand,f.accepted);
  expect(await x.workflow.submit('state',f.pauseCommand,f.corrected)).toBe(false);expect(x.workflow.clear()).toBe(false);
  const html=renderToStaticMarkup(createElement(WorkflowNotice,{locale:'en',workflow:x.workflow,flow:x.workflow.getSnapshot(),showDetails:false}));
  expect(html).toContain('Earlier operation needs verification');expect(html).not.toContain(f.cashCommand.operationId);
  release(ok(f.recovered));await pending;expect(x.workflow.getSnapshot().phase).toBe('confirmed');expect(x.workflow.currentFor(f.corrected).balance.revision).toBe(6);expect(requests).toHaveLength(1);
 });
 it('never sends guest commands through the legacy account port',async()=>{
  const legacy=syntheticDateCashFixtures(),post=vi.fn(async()=>({kind:'unknown' as const}));
  const ports:LegacyPorts={recordCashDate:post,reverseCash:post,readOperation:async()=>null,readBalance:async()=>legacy,nextOperationId:()=>syntheticId(2950)};
  const w=new BillingWorkflow(ports);expect(await w.submit('cash',f.cashCommand,f.accepted)).toBe(false);expect(post).not.toHaveBeenCalled();
  const x=setup(async()=>{throw Error('NO_WIRE');});expect(await x.workflow.submit('cash',f.cashCommand,legacy)).toBe(false);
 });
});

describe('guest card boundary remains disabled without the new transport',()=>{
 it.each(['en','he'] as const)('exposes no legacy card link/action with plain %s wording even with capability and historical client supplied',async locale=>{
  const legacy=syntheticDateCashFixtures(),transport=vi.fn(async()=>{throw Error('NO_CARD_REQUEST');});
  const card=createFishingBillingCardOwnerClient({origin:'https://synthetic-account-card.invalid',scope:dataScope(legacy),csrf:async()=>'a'.repeat(43),transport,readCurrent:async()=>({...legacy,receiptId:null})});
  const x=setup(async()=>{throw Error('NO_MONEY_REQUEST');}),workflow=new BillingWorkflow(x.ports,card);
  expect(workflow.canPrepareCard(f.pending)).toBe(false);expect(workflow.canCreateCheckout(f.pending)).toBe(false);expect(workflow.checkoutUrl(f.pending)).toBeNull();
  expect(await workflow.readCard(f.pending,f.pending.balance.pendingAttemptIds[0])).toBe(false);expect(await workflow.prepareCard({operationId:syntheticId(2999)},f.pending)).toBe(false);
  const html=render(f.pending,workflow,locale);
  expect(html).toContain(locale==='en'?'Card payment unavailable':'תשלום בכרטיס אינו זמין');expect(html).toContain(locale==='en'?'Card payment is unavailable for this offer.':'תשלום בכרטיס אינו זמין עבור הצעה זו.');
  expect(html).not.toContain('Guest card');expect(html).not.toContain('guest offer');expect(html).not.toContain('גביית כרטיס לאורח');expect(html).not.toContain('הצעת אורח');
  expect(html).not.toContain('Open TEST Checkout');expect(html).not.toContain('Check existing attempt');expect(transport).not.toHaveBeenCalled();
 });
});
