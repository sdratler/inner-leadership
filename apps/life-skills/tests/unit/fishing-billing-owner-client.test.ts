import {expect,it,vi} from 'vitest';
import {createFishingBillingOwnerClient} from '../../src/lib/fishing-billing-owner-client.ts';
import {BILLING_DTO_VERSION,operationReceiptSchema} from '../../src/features/fishing-billing/contracts.ts';
import {syntheticAccepted,syntheticBillingFixtures,syntheticId,syntheticNow} from '../../src/features/fishing-billing/fixtures.ts';
import {projectBalance} from '../../src/features/fishing-billing/domain.ts';

const origin='https://fishing-owner.example.invalid',quote=syntheticAccepted(),operationId=syntheticId(601);
const scope={quoteId:quote.id,familyId:quote.familyId,workspaceId:quote.workspaceId};
const receipt=operationReceiptSchema.parse({version:BILLING_DTO_VERSION,operationId,entityId:quote.id,entityVersion:quote.revision,replayed:true,result:{quote,balance:projectBalance(quote,[]),receiptId:null}});
const partial=syntheticBillingFixtures().twoChildPartial;
const current={quote:{...quote,revision:4},balance:{...partial.balance,revision:4},receiptId:null};
const command={operationId,expectedVersion:quote.revision,quoteId:quote.id,currency:'USD',amountMinor:20000,receivedAt:syntheticNow,allocations:[{lineId:quote.lines[1]!.id,amountMinor:20000}]};
const response=(data:unknown,status=200)=>Response.json({ok:true,data,requestId:syntheticId(900)},{status});
const error=(status:number,code:string)=>Response.json({ok:false,error:{code},requestId:syntheticId(900)},{status});
function setup(transport:(r:Request)=>Promise<Response>,timeoutMs=1000){
 return createFishingBillingOwnerClient({origin,scope,csrf:async()=>'b'.repeat(43),transport,timeoutMs});
}
it('treats postcommit503 as unknown and never generates or retries an operation',async()=>{
 const transport=vi.fn(async(r:Request)=>r.method==='POST'?error(503,'UNAVAILABLE'):response({version:BILLING_DTO_VERSION,state:'unresolved',operationId}));
 const client=setup(transport);
 expect(await client.recordCash(command)).toEqual({kind:'unknown'});
 expect(transport).toHaveBeenCalledTimes(1);
 const sent=transport.mock.calls[0]![0];expect(await sent.clone().json()).toMatchObject({action:'cash',command:{operationId}});
 expect(sent.credentials).toBe('same-origin');expect(sent.redirect).toBe('error');expect(sent.cache).toBe('no-store');expect(sent.headers.get('x-csrf-token')).toBe('b'.repeat(43));
 expect(await client.readOperation(operationId)).toBeNull();expect(transport).toHaveBeenCalledTimes(2);
 expect(transport.mock.calls.filter(([r])=>r.method==='POST')).toHaveLength(1);
});
it.each(['network','malformed','wrong_family','wrong_operation'] as const)('keeps %s outcomes unknown',async mode=>{
 const transport=vi.fn(async()=>{
  if(mode==='network')throw Error('synthetic connection lost after server commit');
  if(mode==='malformed')return Response.json({ok:true,data:'bad'});
  const badReceipt=mode==='wrong_operation'?{...receipt,operationId:syntheticId(602)}:receipt;
  const next=mode==='wrong_family'?{...current,quote:{...current.quote,familyId:syntheticId(88)},balance:{...current.balance,familyId:syntheticId(88)}}:current;
  return response({version:BILLING_DTO_VERSION,state:'confirmed',receipt:badReceipt,current:next});
 });
 expect(await setup(transport).recordCash(command)).toEqual({kind:'unknown'});expect(transport).toHaveBeenCalledOnce();
});
it('returns historical receipt and fresh scoped balance as distinct values',async()=>{
 const client=setup(async()=>response({version:BILLING_DTO_VERSION,state:'confirmed',receipt,current}));
 const saved=await client.readOperation(operationId);expect(saved?.receipt.result.balance.remainingMinor).toBe(130000);
 expect(saved?.current.balance.remainingMinor).toBe(45000);expect(saved?.current.quote.revision).toBe(4);
});
it('refreshes a409 conflict without resubmitting',async()=>{
 const transport=vi.fn(async(r:Request)=>r.method==='POST'?error(409,'CONFLICT'):response({version:BILLING_DTO_VERSION,state:'ready',current}));
 const outcome=await setup(transport).recordCash(command);
 expect(outcome).toMatchObject({kind:'conflict',current:{balance:{remainingMinor:45000}}});
 expect(transport.mock.calls.map(([r])=>r.method)).toEqual(['POST','GET']);
});
it.each([[400,'INVALID_REQUEST','INVALID_REQUEST'],[403,'FORBIDDEN','FORBIDDEN'],[401,'UNAUTHENTICATED','FORBIDDEN']] as const)('recognizes an authenticated precommit error envelope %i',async(status,code,expected)=>{
 expect(await setup(async()=>error(status,code)).recordCash(command)).toEqual({kind:'rejected',code:expected});
});
it('bounds a stalled response body and aborts without retry',async()=>{
 vi.useFakeTimers();
 try{
  const cancel=vi.fn(),body=new ReadableStream<Uint8Array>({cancel});
  const transport=vi.fn(async()=>new Response(body,{headers:{'content-type':'application/json'}}));
  const pending=setup(transport,10).recordCash(command);
  await vi.advanceTimersByTimeAsync(11);
  expect(await pending).toEqual({kind:'unknown'});expect(transport).toHaveBeenCalledOnce();expect(cancel).toHaveBeenCalledOnce();
 }finally{vi.useRealTimers();}
});
it('refuses local invalid or wrong-quote input before transport',async()=>{
 const transport=vi.fn(async()=>error(503,'UNAVAILABLE')),client=setup(transport);
 expect(await client.recordCash({...command,actorId:syntheticId(8)})).toEqual({kind:'rejected',code:'INVALID_REQUEST'});
 expect(await client.recordCash({...command,quoteId:syntheticId(9)})).toEqual({kind:'rejected',code:'FORBIDDEN'});
 expect(transport).not.toHaveBeenCalled();
});
