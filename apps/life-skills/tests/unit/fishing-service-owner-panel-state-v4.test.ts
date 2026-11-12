import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import {ServiceOwnerPanelStateV4} from '../../src/features/fishing-billing-ui/service-owner-panel-state-v4.ts';
import {createFishingBillingOwnerClientV4} from '../../src/lib/fishing-billing-owner-client-v4.ts';
import {BILLING_SERVICE_V4} from '../../src/features/fishing-billing/guest-service-contract-v4.ts';
import {prepareServiceOwnerStateV4} from '../../src/features/fishing-billing-ui/service-owner-model-v4.ts';
import {serviceOwnerUiFixtureV4,serviceOwnerConfirmedFixtureV4,serviceUiIdV4} from '../fixtures/fishing-service-owner-ui-v4.ts';
const network=vi.fn(()=>{throw Error('NO_REAL_NETWORK');});
beforeEach(()=>vi.stubGlobal('fetch',network));
afterEach(()=>{try{expect(network).not.toHaveBeenCalled();}finally{vi.unstubAllGlobals();}});
const ok=(data:unknown)=>Response.json({ok:true,data,requestId:serviceUiIdV4(999)});
function setup(){
 const f=serviceOwnerUiFixtureV4(),subject={familyId:f.scope.familyId,label:'SYNTHETIC family',children:f.current.quote.lines.map((l,i)=>({id:l.childId,name:'SYNTHETIC child '+i}))};
 const transport=vi.fn(async(request:Request)=>{const body=await request.clone().json();return ok(serviceOwnerConfirmedFixtureV4(body.operation,f.current));});
 const client=createFishingBillingOwnerClientV4({origin:'https://synthetic-panel.invalid',scope:f.scope,csrf:async()=>'a'.repeat(43),transport});
 let id=700;const nextOperationId=vi.fn(()=>serviceUiIdV4(id++)),reload=vi.fn(async()=>{});
 const source={state:'ready' as const,data:f.current,subject};
 const store=new ServiceOwnerPanelStateV4({scope:f.scope,client,source,capabilities:{cash:true,reversal:true,state:true},nextOperationId,reload});
 return {...f,subject,source,transport,client,nextOperationId,reload,store};
}
function fill(s:ReturnType<typeof setup>){
 expect(s.store.openCash()).toBe(true);expect(s.store.updateDraft({amount:'200.00',date:'2035-01-05',allocations:{[serviceUiIdV4(10)]:'200',[serviceUiIdV4(11)]:''}})).toBe(true);
}
it('requires real supplied ports, explicit own capabilities and an ID provider; never generates defaults',()=>{
 const s=setup();
 for(const input of [{client:null,nextOperationId:s.nextOperationId,capabilities:{cash:true}},{client:s.client,capabilities:{cash:true}},{client:s.client,nextOperationId:s.nextOperationId},
  {client:s.client,nextOperationId:s.nextOperationId,capabilities:Object.create({cash:true,state:true,reversal:true})}]){
  const store=new ServiceOwnerPanelStateV4({scope:s.scope,source:s.source,...input});expect(store.getSnapshot().capabilities).toEqual({cash:false,reversal:false,state:false});expect(store.openCash()).toBe(false);
 }
 expect(s.nextOperationId).not.toHaveBeenCalled();expect(s.transport).not.toHaveBeenCalled();
});
it('retains form fields and the reviewed original command across closure/remount reads without another ID',()=>{
 const s=setup();fill(s);expect(s.nextOperationId).not.toHaveBeenCalled();expect(s.store.getSnapshot().draft?.date).toBe('2035-01-05');
 expect(s.store.review()).toBe(true);const draft=s.store.getSnapshot().draft!;expect(s.nextOperationId).toHaveBeenCalledOnce();expect(s.store.closeForm()).toBe(true);
 expect(s.store.openCash()).toBe(true);expect(s.store.getSnapshot().draft).toEqual(draft);expect(s.store.getSnapshot().draft?.review?.serializedOperation).toBe(draft.review!.serializedOperation);
 expect(s.store.review()).toBe(true);expect(s.nextOperationId).toHaveBeenCalledOnce();expect(s.transport).not.toHaveBeenCalled();
});
it('leaves the received date empty and requires explicit date/allocation review',()=>{
 const s=setup();s.store.openCash();expect(s.store.getSnapshot().draft?.date).toBe('');s.store.updateDraft({amount:'200',allocations:{[serviceUiIdV4(10)]:'200'}});
 expect(s.store.review()).toBe(false);expect(s.store.getSnapshot().draft?.error).toBe('invalid');expect(s.transport).not.toHaveBeenCalled();
});
it('invalidates an unsubmitted review when current details advance, preserving entered fields until explicit review',()=>{
 const s=setup();fill(s);s.store.review();const original=s.store.getSnapshot().draft!;
 const pause=prepareServiceOwnerStateV4(s.current,serviceUiIdV4(710),'pause'),newer=serviceOwnerConfirmedFixtureV4(pause.operation,s.current);if(newer.state!=='confirmed')throw Error('FIXTURE');
 s.store.setSource({...s.source,data:newer.current});expect(s.store.getSnapshot().draft).toMatchObject({amount:original.amount,operationId:original.operationId,review:null,error:'changed'});
 expect(s.nextOperationId).toHaveBeenCalledOnce();expect(s.store.review()).toBe(true);expect(s.store.getSnapshot().draft?.review?.operation.command).toMatchObject({expectedVersion:4});expect(s.transport).not.toHaveBeenCalled();
});
it('confirms only after review and reserves the operation before a duplicate confirmation can dispatch',async()=>{
 const s=setup();fill(s);expect(await s.store.confirm()).toBe(false);expect(s.transport).not.toHaveBeenCalled();s.store.review();
 const first=s.store.confirm(),duplicate=s.store.confirm();expect(await duplicate).toBe(false);await first;
 expect(s.transport).toHaveBeenCalledOnce();expect(s.store.getSnapshot().flow.phase).toBe('confirmed');expect(s.store.getSnapshot().data?.balance.paidMinor).toBe(20000);
 expect(s.nextOperationId).toHaveBeenCalledOnce();
});
it('keeps UNKNOWN private and locked through rejection/unresolved recovery, then restores only exact-original confirmation',async()=>{
 const s=setup();fill(s);s.store.review();const original=s.store.getSnapshot().draft!.review!;s.transport.mockRejectedValueOnce(Error('synthetic unknown'));await s.store.confirm();
 expect(s.store.getSnapshot()).toMatchObject({state:'pending',data:null,subject:null,draft:null,formOpen:false});expect(s.store.getSnapshot().flow).toMatchObject({phase:'unknown',pending:original});
 expect(s.store.openCash()).toBe(false);expect(s.store.openState('pause')).toBe(false);expect(s.store.updateDraft({amount:'999'})).toBe(false);expect(s.store.review()).toBe(false);expect(await s.store.reload()).toBe(false);
 s.store.closeForm();s.store.setSource(s.source);expect(s.store.getSnapshot().flow.phase).toBe('unknown');
 s.transport.mockResolvedValueOnce(ok({version:BILLING_SERVICE_V4,state:'rejected_current_attempt',operation:original.operation,code:'CONFLICT'}));await s.store.recover();expect(s.store.getSnapshot().flow).toMatchObject({phase:'unknown',lastRecovery:'rejected_current_attempt'});
 s.transport.mockResolvedValueOnce(ok({version:BILLING_SERVICE_V4,state:'unresolved',operation:original.operation}));await s.store.recover();expect(s.store.getSnapshot().flow).toMatchObject({phase:'unknown',lastRecovery:'unresolved'});
 await s.store.recover();expect(s.store.getSnapshot().flow.phase).toBe('confirmed');expect(s.store.getSnapshot().draft?.review?.serializedOperation).toBe(original.serializedOperation);
 expect(s.store.getSnapshot().draft?.amount).toBe('200.00');expect(s.store.getSnapshot().data?.balance.paidMinor).toBe(20000);expect(s.nextOperationId).toHaveBeenCalledOnce();expect(s.reload).not.toHaveBeenCalled();
 const bodies=await Promise.all(s.transport.mock.calls.map(([request])=>request.clone().json()));expect(bodies.map(b=>b.intent)).toEqual(['execute','recover','recover','recover']);expect(bodies.every(b=>JSON.stringify(b.operation)===original.serializedOperation)).toBe(true);
});
it('requires Root current readback after a known rejection before editing or allocating another ID',async()=>{
 const s=setup();fill(s);s.store.review();const original=s.store.getSnapshot().draft!.review!;
 s.transport.mockResolvedValueOnce(ok({version:BILLING_SERVICE_V4,state:'rejected_current_attempt',operation:original.operation,code:'CONFLICT'}));await s.store.confirm();
 expect(s.store.getSnapshot()).toMatchObject({state:'pending',data:null,flow:{phase:'rejected_current_attempt'}});expect(s.store.openCash()).toBe(false);expect(s.store.review()).toBe(false);
 expect(await s.store.reload()).toBe(true);expect(s.reload).toHaveBeenCalledOnce();expect(s.nextOperationId).toHaveBeenCalledOnce();
 s.store.setSource(s.source);expect(s.store.getSnapshot().flow.phase).toBe('idle');expect(s.store.openCash()).toBe(true);expect(s.store.getSnapshot().draft?.amount).toBe('200.00');s.store.review();expect(s.nextOperationId).toHaveBeenCalledTimes(2);
});
it('hides private details after a failed explicit reload instead of retaining a stale readable account',async()=>{
 const s=setup(),store=new ServiceOwnerPanelStateV4({scope:s.scope,client:s.client,source:s.source,reload:async()=>{throw Error('SYNTHETIC current read unavailable');}});
 expect(store.getSnapshot().state).toBe('ready');expect(await store.reload()).toBe(false);expect(store.getSnapshot()).toMatchObject({state:'unavailable',data:null,subject:null,draft:null});
});
it('redacts invalid or unavailable context and never restores private data from a late result',async()=>{
 const s=setup();fill(s);s.store.review();let release!:(response:Response)=>void;s.transport.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
 const started=s.store.confirm();await vi.waitFor(()=>expect(s.transport).toHaveBeenCalledOnce());s.store.setSource({state:'unavailable'});
 expect(s.store.getSnapshot()).toMatchObject({state:'unavailable',data:null,subject:null,draft:null,flow:{phase:'idle'}});
 release(ok(serviceOwnerConfirmedFixtureV4((await s.transport.mock.calls[0]![0].clone().json()).operation,s.current)));await started;
 expect(s.store.getSnapshot().state).toBe('unavailable');expect(s.store.getSnapshot().data).toBeNull();
 expect(s.store.setSource({...s.source,subject:{...s.subject,familyId:serviceUiIdV4(1234)}})).toBe(false);expect(s.store.getSnapshot().subject).toBeNull();
});
it('disposes only on explicit authenticated-context teardown, aborting and ignoring late outcomes',async()=>{
 const s=setup();fill(s);s.store.review();let release!:(response:Response)=>void;s.transport.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
 const started=s.store.confirm();await vi.waitFor(()=>expect(s.transport).toHaveBeenCalledOnce());const operation=(await s.transport.mock.calls[0]![0].clone().json()).operation;s.store.dispose();
 expect(s.transport.mock.calls[0]![0].signal.aborted).toBe(true);release(ok(serviceOwnerConfirmedFixtureV4(operation,s.current)));await started;
 expect(s.store.getSnapshot()).toMatchObject({state:'inactive',data:null,subject:null,draft:null,flow:{phase:'inactive'}});expect(s.store.openCash()).toBe(false);expect(await s.store.recover()).toBe(false);expect(s.store.setSource(s.source)).toBe(false);
});
it('corrects only the selected original cash allocations and retains its history and original acceptance',async()=>{
 const s=setup(),cash=serviceOwnerConfirmedFixtureV4(s.cash,s.current);if(cash.state!=='confirmed'||!('result' in cash.receipt))throw Error('FIXTURE');
 const store=new ServiceOwnerPanelStateV4({scope:s.scope,client:s.client,source:{...s.source,data:cash.current},capabilities:{reversal:true},nextOperationId:s.nextOperationId});
 expect(store.openReversal(cash.receipt.result.receipt.id)).toBe(true);expect(Object.keys(store.getSnapshot().draft!.allocations)).toEqual([serviceUiIdV4(10)]);
 store.updateDraft({amount:'50',reason:'SYNTHETIC correction',allocations:{[serviceUiIdV4(10)]:'50'}});expect(store.review()).toBe(true);
 s.transport.mockImplementationOnce(async request=>ok(serviceOwnerConfirmedFixtureV4((await request.json()).operation,cash.current)));await store.confirm();
 expect(store.getSnapshot().flow.phase).toBe('confirmed');expect(store.getSnapshot().data?.balance.paidMinor).toBe(15000);
 expect(store.getSnapshot().data?.balance.receipts[0]).toEqual(cash.current.balance.receipts[0]);expect(store.getSnapshot().data?.quote.acceptance).toEqual(s.current.quote.acceptance);
});
it.each(['pause','resume','cancel'] as const)('reviews and confirms the V4 %s record without a provider action or financial-history rewrite',async action=>{
 const s=setup(),pause=serviceOwnerConfirmedFixtureV4(prepareServiceOwnerStateV4(s.current,serviceUiIdV4(720),'pause').operation,s.current);if(pause.state!=='confirmed')throw Error('FIXTURE');
 const basis=action==='resume'?pause.current:s.current,store=new ServiceOwnerPanelStateV4({scope:s.scope,client:s.client,source:{...s.source,data:basis},capabilities:{state:true},nextOperationId:s.nextOperationId});
 expect(store.openState(action)).toBe(true);expect(s.nextOperationId).not.toHaveBeenCalled();expect(store.review()).toBe(true);expect(s.transport).not.toHaveBeenCalled();
 s.transport.mockImplementationOnce(async request=>ok(serviceOwnerConfirmedFixtureV4((await request.json()).operation,basis)));await store.confirm();
 expect(store.getSnapshot().flow.phase).toBe('confirmed');expect(store.getSnapshot().data?.quote.acceptance).toEqual(basis.quote.acceptance);expect(store.getSnapshot().data?.balance.receipts).toEqual(basis.balance.receipts);
 expect(s.transport).toHaveBeenCalledOnce();expect(s.nextOperationId).toHaveBeenCalledOnce();
});
