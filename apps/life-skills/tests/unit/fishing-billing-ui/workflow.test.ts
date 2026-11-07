import {describe,it,expect,vi} from 'vitest';
import {BillingWorkflow} from '../../../src/features/fishing-billing-ui/workflow.ts';
import {inputUsd,parseUsd,receivedDate,floridaDate,ownerOperationResult,preparationTicket,editedPreparation,samePreparation,dataScope,unallocatedAmount,type BillingOperationReceipt,type BillingUiPorts,type BillingData,type CommandOutcome} from '../../../src/features/fishing-billing-ui/model.ts';
import {syntheticAccepted,syntheticReceipt,syntheticId,syntheticNow} from '../../../src/features/fishing-billing/fixtures.ts';
import {projectBalanceV2,dateCashReceiptSchema,BILLING_DTO_V2} from '../../../src/features/fishing-billing/contracts-v2.ts';
import {createFishingBillingOwnerClientV2} from '../../../src/lib/fishing-billing-owner-client-v2.ts';
import {BILLING_DTO_VERSION} from '../../../src/features/fishing-billing/contracts.ts';
const op=syntheticId(500);
function snapshot(revision:number,withCash=false):BillingData{
 const quote={...syntheticAccepted(),revision};
 const cash:Record<string,unknown>={...syntheticReceipt('cash',11,20000,51),operationId:op};delete cash.receivedAt;
 const dateCash=dateCashReceiptSchema.parse({...cash,receivedPrecision:'date',receivedDate:'2035-01-02',timeZone:'America/New_York'});
 const receipts=[syntheticReceipt('card',10,65000,50),...(withCash?[dateCash]:[])];
 return {quote,balance:projectBalanceV2(quote,receipts)};
}
const command=()=>({version:BILLING_DTO_V2,receivedPrecision:'date' as const,receivedDate:'2035-01-02',timeZone:'America/New_York' as const,operationId:op,expectedVersion:3,quoteId:syntheticId(7),amountMinor:20000,currency:'USD' as const,allocations:[{lineId:syntheticId(11),amountMinor:20000}]});
function receipt():BillingOperationReceipt{
 const data=snapshot(4,true);
 return {version:BILLING_DTO_V2,sourceVersion:BILLING_DTO_V2,operationId:op,entityId:data.quote.id,entityVersion:4,replayed:true,result:{...data,receiptId:syntheticId(51)}};
}
function ports():BillingUiPorts{
 return {recordCashDate:vi.fn(async():Promise<CommandOutcome>=>({kind:'confirmed',receipt:receipt(),current:snapshot(4,true)})),reverseCash:vi.fn(async():Promise<CommandOutcome>=>({kind:'unknown'})),readOperation:vi.fn(async()=>({receipt:receipt(),current:snapshot(5,true)})),readBalance:vi.fn(async()=>snapshot(5,true)),nextOperationId:()=>op};
}
describe('owner billing operation lifecycle',()=>{
 it('records once and displays separate current readback, not historical receipt balance',async()=>{
  const p=ports();p.recordCashDate=vi.fn(async():Promise<CommandOutcome>=>({kind:'confirmed',receipt:receipt(),current:snapshot(5,true)}));
  const w=new BillingWorkflow(p);await w.submit('cash',command(),snapshot(3));
  expect(p.recordCashDate).toHaveBeenCalledTimes(1);expect(w.getSnapshot()).toMatchObject({phase:'confirmed',data:{balance:{revision:5,remainingMinor:45000}}});
  expect(p.readBalance).not.toHaveBeenCalled();expect(w.clear()).toBe(true);expect(w.currentFor(snapshot(3)).balance.revision).toBe(5);
 });
 it('blocks double click while a request is in flight',async()=>{
  let release!:(v:CommandOutcome)=>void;const p=ports();p.recordCashDate=vi.fn(()=>new Promise<CommandOutcome>(resolve=>{release=resolve;}));
  const w=new BillingWorkflow(p),pending=w.submit('cash',command(),snapshot(3));
  expect(await w.submit('cash',{...command(),operationId:syntheticId(501)},snapshot(3))).toBe(false);
  release({kind:'unknown'});await pending;expect(p.recordCashDate).toHaveBeenCalledTimes(1);
 });
 it('retains an unknown request and same ID after timeout/null lookup, without replay',async()=>{
  const p=ports();p.recordCashDate=vi.fn(async()=>{throw Error('NETWORK');});p.readOperation=vi.fn(async()=>null);
  const w=new BillingWorkflow(p);await w.submit('cash',command(),snapshot(3));await w.recover();
  expect(p.readOperation).toHaveBeenCalledWith(op);expect(w.getSnapshot()).toMatchObject({phase:'unknown',command:command()});
  expect(w.clear()).toBe(false);expect(await w.submit('cash',{...command(),operationId:syntheticId(501)},snapshot(3))).toBe(false);expect(p.recordCashDate).toHaveBeenCalledTimes(1);
 });
 it('recovers the original operation and a fresh balance without issuing another receipt',async()=>{
  const p=ports();p.recordCashDate=vi.fn(async():Promise<CommandOutcome>=>({kind:'unknown'}));const w=new BillingWorkflow(p);
  await w.submit('cash',command(),snapshot(3));await w.recover();
  expect(w.getSnapshot()).toMatchObject({phase:'confirmed',data:{balance:{revision:5}}});expect(p.recordCashDate).toHaveBeenCalledTimes(1);
 });
 it('treats unavailable rejection as unknown, never permission for a new operation',async()=>{
  const p=ports();p.recordCashDate=vi.fn(async():Promise<CommandOutcome>=>({kind:'rejected',code:'UNAVAILABLE'}));const w=new BillingWorkflow(p);
  await w.submit('cash',command(),snapshot(3));expect(w.getSnapshot().phase).toBe('unknown');expect(w.clear()).toBe(false);
  expect(await w.submit('cash',{...command(),operationId:syntheticId(501)},snapshot(3))).toBe(false);
  await w.recover();expect(p.readOperation).toHaveBeenCalledWith(op);expect(p.recordCashDate).toHaveBeenCalledTimes(1);expect(w.getSnapshot()).toMatchObject({phase:'confirmed',data:{balance:{revision:5}}});
 });
 it('keeps known receipt separate when current readback is stale, then refreshes only',async()=>{
  const p=ports();p.recordCashDate=vi.fn(async():Promise<CommandOutcome>=>({kind:'confirmed',receipt:receipt(),current:snapshot(3)}));const w=new BillingWorkflow(p);
  await w.submit('cash',command(),snapshot(3));expect(w.getSnapshot().phase).toBe('refresh_required');
  expect(w.clear()).toBe(false);await w.refresh();expect(w.getSnapshot()).toMatchObject({phase:'confirmed',data:{balance:{revision:5}}});expect(p.recordCashDate).toHaveBeenCalledTimes(1);
 });
 it.each(['operation','family','quote'] as const)('rejects a mismatched %s receipt without exposing it',async kind=>{
  const r=receipt();if(kind==='operation')r.operationId=syntheticId(999);if(kind==='family')r.result.quote.familyId=syntheticId(999);if(kind==='quote')r.entityId=syntheticId(999);
  const p=ports();p.recordCashDate=vi.fn(async():Promise<CommandOutcome>=>({kind:'confirmed',receipt:r,current:snapshot(4,true)}));const w=new BillingWorkflow(p);
  await w.submit('cash',command(),snapshot(3));expect(w.getSnapshot().phase).toBe('unknown');expect(w.currentFor(snapshot(3)).balance.revision).toBe(3);
 });
 it('uses a refreshed conflict snapshot and requires review before a new command',async()=>{
  const p=ports();p.recordCashDate=vi.fn(async():Promise<CommandOutcome>=>({kind:'conflict',current:snapshot(5,true)}));const w=new BillingWorkflow(p);
  await w.submit('cash',command(),snapshot(3));expect(w.getSnapshot().phase).toBe('conflict');w.clear();expect(w.currentFor(snapshot(3)).balance.revision).toBe(5);
  expect(await w.submit('cash',command(),snapshot(5,true))).toBe(false);expect(p.recordCashDate).toHaveBeenCalledTimes(1);
 });
 it('has no default transport when the integration is absent',async()=>{
  const w=new BillingWorkflow(null);expect(await w.submit('cash',command(),snapshot(3))).toBe(false);expect(w.getSnapshot().phase).toBe('idle');
 });
 it('never replaces a newer authorized balance with a stale conflict response',async()=>{
  const p=ports(),w=new BillingWorkflow(p);await w.submit('cash',command(),snapshot(3));w.clear();
  p.recordCashDate=vi.fn(async():Promise<CommandOutcome>=>({kind:'conflict',current:snapshot(3)}));
  await w.submit('cash',{...command(),operationId:syntheticId(501),expectedVersion:4},snapshot(4,true));
  expect(w.getSnapshot().phase).toBe('unknown');expect(w.currentFor(snapshot(3)).balance.revision).toBe(4);
  expect(w.clear()).toBe(false);
 });
 it('binds to the actual reviewed V2 client and recovers a 503 with the same operation',async()=>{
  const bodies:unknown[]=[],reads:string[]=[];
  const client=createFishingBillingOwnerClientV2({origin:'https://synthetic.invalid',scope:dataScope(snapshot(3)),csrf:async()=>'a'.repeat(43),transport:async request=>{
   const id=syntheticId(900);
   if(request.method==='POST'){
    bodies.push(await request.json());
    return new Response(JSON.stringify({ok:false,error:{code:'UNAVAILABLE'},requestId:id}),{status:503,headers:{'content-type':'application/json'}});
   }
   const url=new URL(request.url);reads.push(url.searchParams.get('id')!);
   return new Response(JSON.stringify({ok:true,requestId:id,data:{version:BILLING_DTO_V2,state:'confirmed',receipt:receipt(),current:{...snapshot(5,true),receiptId:null}}}),{headers:{'content-type':'application/json'}});
  }});
  const w=new BillingWorkflow({...client,nextOperationId:()=>op});await w.submit('cash',command(),snapshot(3));
  expect(w.getSnapshot().phase).toBe('unknown');expect(w.clear()).toBe(false);
  expect(bodies).toEqual([{action:'cash_date',command:command()}]);expect((bodies[0] as {command:object}).command).not.toHaveProperty('receivedAt');
  await w.recover();expect(reads).toEqual([op]);expect(bodies).toHaveLength(1);
  expect(w.getSnapshot()).toMatchObject({phase:'confirmed',data:{balance:{revision:5,remainingMinor:45000}}});
 });
 it('preserves an upgraded historical V1 operation and its exact receipt timestamp',async()=>{
  const q={...syntheticAccepted(),revision:4},oldCash={...syntheticReceipt('cash',11,20000,51),operationId:op};
  const legacy=receipt();legacy.sourceVersion=BILLING_DTO_VERSION;legacy.result={quote:q,balance:projectBalanceV2(q,[syntheticReceipt('card',10,65000,50),oldCash]),receiptId:oldCash.id};
  const p=ports();p.recordCashDate=vi.fn(async():Promise<CommandOutcome>=>({kind:'confirmed',receipt:legacy,current:snapshot(5,true)}));
  const w=new BillingWorkflow(p);await w.submit('cash',command(),snapshot(3));
  expect(w.getSnapshot()).toMatchObject({phase:'confirmed',receipt:{sourceVersion:BILLING_DTO_VERSION}});
  expect(legacy.result.balance.receipts[1]).toHaveProperty('receivedAt',syntheticNow);
  expect(legacy.result.balance.receipts[1]).not.toHaveProperty('receivedDate');
 });
});
describe('presentation-only money/date and root read adapter',()=>{
 it('discards the real deferred date resolver result after same-dialog editing',async()=>{
  let release!:(value:{receivedAt:string;observedAt:string})=>void;
  const resolver:(date:string)=>Promise<{receivedAt:string;observedAt:string}|null>=vi.fn(()=>new Promise<{receivedAt:string;observedAt:string}>(resolve=>{release=resolve;}));
  let ticket=preparationTicket(dataScope(snapshot(3)),3,{}),reviewed:string|null=null;
  const captured=ticket;
  const pending=resolver('2035-01-02').then(result=>{if(result&&samePreparation(ticket,captured))reviewed=result.receivedAt;});
  ticket=editedPreparation(ticket);release({receivedAt:syntheticNow,observedAt:syntheticNow});await pending;
  expect(reviewed).toBeNull();expect(samePreparation(ticket,captured)).toBe(false);
 });
 it.each(['reopen','family','workspace','revision'] as const)('discards a deferred date result after dialog %s changes',async change=>{
  const context={},original=preparationTicket(dataScope(snapshot(3)),3,context);
  let current=original,release!:()=>void,accepted=false;
  const pending=new Promise<void>(resolve=>{release=resolve;}).then(()=>{accepted=samePreparation(current,original);});
  const scope={...original.scope};if(change==='family')scope.familyId=syntheticId(999);if(change==='workspace')scope.workspaceId=syntheticId(999);
  // Closing destroys the old ticket; reopening always creates a new generation,
  // even for the same quote and date. A changed context also gets a new token.
  current=change==='reopen'?preparationTicket(scope,3,context):{...original,scope,revision:change==='revision'?4:3};
  release();await pending;expect(accepted).toBe(false);
 });
 it.each(['-1','1e3','0.001','NaN','1,000.00','0'])('rejects ambiguous or nonpositive amount %s',v=>expect(parseUsd(v)).toBeNull());
 it('preserves integer cents without floating decimal drift',()=>{expect(parseUsd('200.05')).toBe(20005);expect(inputUsd(20005)).toBe('200.05');});
 it('retains an explicit unallocated remainder without inventing a child allocation',()=>{
  expect(unallocatedAmount(40000,[{amountMinor:30000}])).toBe(10000);
  expect(unallocatedAmount(10000,[])).toBe(10000);
  expect(()=>unallocatedAmount(10000,[{amountMinor:10001}])).toThrow('INVALID_ALLOCATION_TOTAL');
 });
 it('keeps server instant-to-Florida dates separate from literal calendar dates',()=>{
  expect(floridaDate('2035-01-03T02:00:00Z')).toBe('2035-01-02');
  expect(receivedDate('2035-01-05')).toBe('2035-01-05');
  expect(()=>receivedDate('2035-02-30')).toThrow();
  expect(()=>receivedDate('2035-01-05T00:00:00Z')).toThrow();
  expect(command()).not.toHaveProperty('receivedAt');
 });
 it('consumes the reviewed owner contract with unresolved distinct from confirmed',()=>{
  expect(ownerOperationResult({version:BILLING_DTO_V2,state:'unresolved',operationId:op})).toBeNull();
  const d=snapshot(5,true),read=ownerOperationResult({version:BILLING_DTO_V2,state:'confirmed',receipt:receipt(),current:{...d,receiptId:null}});
  expect(read!.current.balance.revision).toBe(5);expect(read!.receipt.result.balance.revision).toBe(4);
 });
});
