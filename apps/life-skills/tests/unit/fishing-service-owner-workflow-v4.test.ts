import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import {createFishingBillingOwnerClientV4,prepareServiceOwnerOperationV4} from '../../src/lib/fishing-billing-owner-client-v4.ts';
import {ServiceOwnerBillingWorkflowV4} from '../../src/features/fishing-billing-ui/service-owner-workflow-v4.ts';
import {prepareServiceOwnerCashV4,prepareServiceOwnerReversalV4,prepareServiceOwnerStateV4,serviceOwnerAmountsV4,serviceOwnerDataV4} from '../../src/features/fishing-billing-ui/service-owner-model-v4.ts';
import {BILLING_SERVICE_V4} from '../../src/features/fishing-billing/guest-service-contract-v4.ts';
import {serviceOwnerUiFixtureV4,serviceOwnerConfirmedFixtureV4,serviceUiIdV4} from '../fixtures/fishing-service-owner-ui-v4.ts';

const ok=(data:unknown)=>Response.json({ok:true,data,requestId:serviceUiIdV4(999)});
const network=vi.fn(()=>{throw Error('NO_REAL_NETWORK');});
beforeEach(()=>vi.stubGlobal('fetch',network));
afterEach(()=>{try{expect(network).not.toHaveBeenCalled();}finally{vi.unstubAllGlobals();}});
function setup(){
 const f=serviceOwnerUiFixtureV4(),pending=prepareServiceOwnerOperationV4(f.cash),transport=vi.fn(async(request:Request)=>{
  if(request.method!=='POST')throw Error('WORKFLOW_MUST_NOT_REPLACE_RECOVERY_WITH_CURRENT_GET');return ok(serviceOwnerConfirmedFixtureV4(f.cash,f.current));
 });
 const client=createFishingBillingOwnerClientV4({origin:'https://synthetic-workflow.invalid',scope:f.scope,csrf:async()=>'a'.repeat(43),transport});
 const workflow=new ServiceOwnerBillingWorkflowV4(f.scope,client);return {...f,pending,transport,client,workflow};
}
it('is disabled with absent ports, accepts explicit V4 only and keeps per-child periods separate',async()=>{
 const s=setup(),off=new ServiceOwnerBillingWorkflowV4(s.scope,null);
 expect(await off.submit(s.pending,s.current)).toBe(false);expect(s.transport).not.toHaveBeenCalled();
 expect(serviceOwnerDataV4(s.current).balance.lines.map(l=>l.period.id)).toEqual([serviceUiIdV4(30),serviceUiIdV4(31)]);
 expect(()=>serviceOwnerDataV4({...s.current,version:'JLFA-FISHING-BILLING-GUEST-v3'})).toThrow();
 expect(()=>serviceOwnerDataV4({...s.current,balance:{...s.current.balance,paidMinor:5}})).toThrow('SERVICE_UI_LEDGER_MISMATCH');
});
it('prepares V4 cash using existing USD/allocation/date helpers without manufacturing an instant',()=>{
 const s=setup(),pending=prepareServiceOwnerCashV4(s.current,serviceUiIdV4(300),{amount:'200.00',allocations:{[s.current.quote.lines[1]!.id]:'150.00'},date:'2035-01-05'});
 expect(pending.operation).toMatchObject({action:'cash_date',command:{version:BILLING_SERVICE_V4,amountMinor:20000,receivedPrecision:'date',receivedDate:'2035-01-05',timeZone:'America/New_York',allocations:[{lineId:serviceUiIdV4(11),amountMinor:15000}]}});
 expect(pending.serializedOperation).not.toContain('receivedAt');
 expect(()=>prepareServiceOwnerCashV4(s.current,serviceUiIdV4(301),{amount:'1e2',allocations:{},date:'2035-01-05'})).toThrow();
 expect(()=>prepareServiceOwnerCashV4(s.current,serviceUiIdV4(301),{amount:'200',allocations:{[serviceUiIdV4(999)]:'200'},date:'2035-01-05'})).toThrow();
 expect(()=>prepareServiceOwnerCashV4(s.current,serviceUiIdV4(301),{amount:'200',allocations:{[serviceUiIdV4(10)]:'201'},date:'2035-01-05'})).toThrow();
});
it('reserves one mutation before subscriber reentry and prevents reusing an operation after clear',async()=>{
 const s=setup();let nested:Promise<boolean>|undefined;s.workflow.subscribe(()=>{if(s.workflow.getSnapshot().phase==='submitting')nested=s.workflow.submit(s.pending,s.current);});
 expect(await s.workflow.submit(s.pending,s.current)).toBe(true);expect(await nested).toBe(false);expect(s.transport).toHaveBeenCalledOnce();
 expect(s.workflow.getSnapshot().phase).toBe('confirmed');expect(s.workflow.currentFor(s.current)?.balance.paidMinor).toBe(20000);
 expect(s.workflow.clear()).toBe(true);expect(await s.workflow.submit(s.pending,s.current)).toBe(false);expect(s.transport).toHaveBeenCalledOnce();
});
it('keeps UNKNOWN locked across current-attempt rejection and unresolved recovery, then accepts only original confirmation',async()=>{
 const s=setup();s.transport.mockRejectedValueOnce(Error('synthetic disconnected after submission'));
 await s.workflow.submit(s.pending,s.current);expect(s.workflow.getSnapshot().phase).toBe('unknown');expect(s.workflow.currentFor(s.current)).toBeNull();expect(s.workflow.clear()).toBe(false);
 const other=prepareServiceOwnerOperationV4({...s.cash,command:{...s.cash.command,operationId:serviceUiIdV4(201)}});
 expect(await s.workflow.submit(other,s.current)).toBe(false);expect(s.transport).toHaveBeenCalledOnce();
 s.transport.mockResolvedValueOnce(ok({version:BILLING_SERVICE_V4,state:'rejected_current_attempt',operation:s.pending.operation,code:'CONFLICT'}));
 await s.workflow.recover();expect(s.workflow.getSnapshot()).toMatchObject({phase:'unknown',pending:s.pending,lastRecovery:'rejected_current_attempt'});expect(s.workflow.clear()).toBe(false);
 s.transport.mockResolvedValueOnce(ok({version:BILLING_SERVICE_V4,state:'unresolved',operation:s.pending.operation}));
 await s.workflow.recover();expect(s.workflow.getSnapshot()).toMatchObject({phase:'unknown',lastRecovery:'unresolved'});
 await s.workflow.recover();expect(s.workflow.getSnapshot().phase).toBe('confirmed');expect(s.workflow.currentFor(s.current)?.balance.paidMinor).toBe(20000);
 const bodies=await Promise.all(s.transport.mock.calls.map(([request])=>request.clone().json()));
 expect(bodies.map(b=>b.intent)).toEqual(['execute','recover','recover','recover']);expect(bodies.every(b=>JSON.stringify(b.operation)===s.pending.serializedOperation)).toBe(true);
});
it('resumes a preserved UNKNOWN without another execute or operation ID generation',async()=>{
 const s=setup(),resumed=new ServiceOwnerBillingWorkflowV4(s.scope,s.client,s.pending);
 expect(await resumed.submit(s.pending,s.current)).toBe(false);expect(resumed.clear()).toBe(false);await resumed.recover();
 expect(resumed.getSnapshot().phase).toBe('confirmed');expect((await s.transport.mock.calls[0]![0].clone().json()).intent).toBe('recover');
});
it('keeps private current data absent after teardown and ignores a late successful result',async()=>{
 const s=setup();let release!:(response:Response)=>void;s.transport.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
 const result=s.workflow.submit(s.pending,s.current);await vi.waitFor(()=>expect(s.transport).toHaveBeenCalledOnce());s.workflow.dispose();
 expect(s.transport.mock.calls[0]![0].signal.aborted).toBe(true);expect(s.workflow.getSnapshot()).toEqual({phase:'inactive'});expect(s.workflow.currentFor(s.current)).toBeNull();
 release(ok(serviceOwnerConfirmedFixtureV4(s.cash,s.current)));await result;
 expect(s.workflow.getSnapshot()).toEqual({phase:'inactive'});expect(await s.workflow.recover()).toBe(false);
});
it('does not let an uncorrelated receipt or an inconsistent current balance unlock UNKNOWN',async()=>{
 const s=setup();s.transport.mockRejectedValueOnce(Error('unknown'));await s.workflow.submit(s.pending,s.current);
 const other={...s.cash,command:{...s.cash.command,operationId:serviceUiIdV4(202)}};s.transport.mockResolvedValueOnce(ok(serviceOwnerConfirmedFixtureV4(other,s.current)));
 await s.workflow.recover();expect(s.workflow.getSnapshot().phase).toBe('unknown');
 const bad=structuredClone(serviceOwnerConfirmedFixtureV4(s.cash,s.current));if(bad.state!=='confirmed')throw Error('FIXTURE');bad.current.balance.paidMinor=9;
 s.transport.mockResolvedValueOnce(ok(bad));await s.workflow.recover();expect(s.workflow.getSnapshot().phase).toBe('unknown');expect(s.workflow.currentFor(s.current)).toBeNull();
});
it('preserves original/current separation when a later accepted pause advances the current revision',async()=>{
 const s=setup(),cash=serviceOwnerConfirmedFixtureV4(s.cash,s.current);if(cash.state!=='confirmed')throw Error('FIXTURE');
 const pause=prepareServiceOwnerStateV4(cash.current,serviceUiIdV4(400),'pause'),paused=serviceOwnerConfirmedFixtureV4(pause.operation,cash.current);if(paused.state!=='confirmed')throw Error('FIXTURE');
 s.transport.mockResolvedValueOnce(ok({...cash,current:paused.current}));await s.workflow.submit(s.pending,s.current);
 const state=s.workflow.getSnapshot();if(state.phase!=='confirmed')throw Error('EXPECTED_CONFIRMATION');
 expect(state.data.receipt).toEqual(cash.receipt);expect(state.data.current.quote.revision).toBe(5);expect(state.data.current.quote.paused).toBe(true);expect(state.data.current.quote.acceptance).toEqual(s.current.quote.acceptance);
});
it('prepares exact V4 state and cash reversal commands and reuses bilingual amount formatting',()=>{
 const s=setup(),saved=serviceOwnerConfirmedFixtureV4(s.cash,s.current);if(saved.state!=='confirmed'||!('result' in saved.receipt))throw Error('FIXTURE');
 const originalReceiptId=saved.receipt.result.receipt.id;
 const reversal=prepareServiceOwnerReversalV4(saved.current,serviceUiIdV4(500),originalReceiptId,{amount:'50',allocations:{[serviceUiIdV4(10)]:'50'},reason:'SYNTHETIC owner correction'});
 expect(reversal.operation).toMatchObject({action:'reverse_cash',command:{version:BILLING_SERVICE_V4,expectedVersion:4,originalReceiptId:saved.receipt.result.receipt.id,amountMinor:5000}});
 expect(()=>prepareServiceOwnerReversalV4(saved.current,serviceUiIdV4(501),originalReceiptId,{amount:'201',allocations:{},reason:'SYNTHETIC'})).toThrow();
 const state=prepareServiceOwnerStateV4(s.current,serviceUiIdV4(502),'pause');expect(state.operation).toMatchObject({action:'state',command:{version:BILLING_SERVICE_V4,expectedQuoteRevision:3,paused:true}});
 expect(()=>prepareServiceOwnerStateV4(s.current,serviceUiIdV4(503),'resume')).toThrow('SERVICE_STATE_UNCHANGED');
 expect(()=>prepareServiceOwnerStateV4(s.current,serviceUiIdV4(503),'unknown' as 'pause')).toThrow('SERVICE_STATE_ACTION');
 for(const locale of ['en','he'] as const){const view=serviceOwnerAmountsV4(saved.current,locale);expect(view.version).toBe(BILLING_SERVICE_V4);expect(view.lines).toHaveLength(2);expect(view.lines[0]!.period).not.toEqual(view.lines[1]!.period);expect(view.paid).toContain('200');}
});
it('adopts a genuinely newer same-lineage current head and never falls back to older displayed amounts',async()=>{
 const s=setup();await s.workflow.submit(s.pending,s.current);const state=s.workflow.getSnapshot();if(state.phase!=='confirmed')throw Error('FIXTURE');
 const pause=prepareServiceOwnerStateV4(state.data.current,serviceUiIdV4(600),'pause'),reply=serviceOwnerConfirmedFixtureV4(pause.operation,state.data.current);if(reply.state!=='confirmed')throw Error('FIXTURE');
 expect(s.workflow.currentFor(reply.current)?.quote.revision).toBe(5);expect(s.workflow.currentFor(s.current)?.quote.revision).toBe(5);
});
it('confirms a V4 reversal while retaining original cash bytes and per-child ledger arithmetic',async()=>{
 const s=setup(),cash=serviceOwnerConfirmedFixtureV4(s.cash,s.current);if(cash.state!=='confirmed'||!('result' in cash.receipt))throw Error('FIXTURE');
 const pending=prepareServiceOwnerReversalV4(cash.current,serviceUiIdV4(601),cash.receipt.result.receipt.id,{amount:'50',allocations:{[serviceUiIdV4(10)]:'50'},reason:'SYNTHETIC correction'});
 const reversed=serviceOwnerConfirmedFixtureV4(pending.operation,cash.current);s.transport.mockResolvedValueOnce(ok(reversed));await s.workflow.submit(pending,cash.current);
 const current=s.workflow.currentFor(cash.current);expect(current?.balance.paidMinor).toBe(15000);expect(current?.balance.receipts[0]).toEqual(cash.current.balance.receipts[0]);
 expect(current?.quote.acceptance).toEqual(s.current.quote.acceptance);
});
it.each(['pause','resume','cancel'] as const)('uses the original V4 state contract for %s without V3 expectedVersion coercion',async action=>{
 const s=setup(),paused=serviceOwnerConfirmedFixtureV4(prepareServiceOwnerStateV4(s.current,serviceUiIdV4(602),'pause').operation,s.current);if(paused.state!=='confirmed')throw Error('FIXTURE');
 const basis=action==='resume'?paused.current:s.current,pending=prepareServiceOwnerStateV4(basis,serviceUiIdV4(603),action),reply=serviceOwnerConfirmedFixtureV4(pending.operation,basis);
 s.transport.mockResolvedValueOnce(ok(reply));await s.workflow.submit(pending,basis);expect(s.workflow.getSnapshot().phase).toBe('confirmed');
 const body=await s.transport.mock.calls[0]![0].clone().json();expect(body.operation.action).toBe('state');expect(body.operation.command.expectedQuoteRevision).toBe(basis.quote.revision);
 expect(body.operation.command).not.toHaveProperty('expectedVersion');expect(s.workflow.currentFor(basis)?.quote.acceptance).toEqual(s.current.quote.acceptance);
});
