import {expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {AppError} from '../../src/lib/errors.ts';
import {fishingBillingOwnerHttpV2,type FishingBillingOwnerHttpV2Deps} from '../../src/lib/fishing-billing-owner-http-v2.ts';
import {createFishingBillingOwnerClientV2} from '../../src/lib/fishing-billing-owner-client-v2.ts';
import {FISHING_BILLING_OWNER_V2_PATH} from '../../src/lib/fishing-billing-owner-contract-v2.ts';
import {BILLING_DTO_VERSION,operationReceiptSchema} from '../../src/features/fishing-billing/contracts.ts';
import {BILLING_DTO_V2,upgradeOperationReceipt,operationReceiptV2Schema} from '../../src/features/fishing-billing/contracts-v2.ts';
import {syntheticDateCashFixtures} from '../../src/features/fishing-billing/fixtures-v2.ts';
import {syntheticAccepted,syntheticId,syntheticOwner,syntheticWorkspace} from '../../src/features/fishing-billing/fixtures.ts';
import {projectBalance} from '../../src/features/fishing-billing/domain.ts';
import type {Actor} from '../../src/features/identity/types.ts';

const origin='https://fishing-owner-v2.example.invalid',token='a'.repeat(43),csrf='b'.repeat(43),f=syntheticDateCashFixtures();
const actor={id:syntheticOwner,workspaceId:syntheticWorkspace,personId:syntheticId(99),role:'practitioner',state:'active',locale:'en',sessionDigest:'c'.repeat(64),expiresAt:Date.parse('2036-01-01T00:00:00Z')} as Actor;
const current={quote:f.quote,balance:f.balance,receiptId:null};
const dateCommand={version:BILLING_DTO_V2,operationId:f.operation.operationId,expectedVersion:4,quoteId:f.quote.id,currency:'USD',amountMinor:20000,receivedPrecision:'date',receivedDate:'2035-01-05',timeZone:'America/New_York',allocations:[{lineId:f.quote.lines[1]!.id,amountMinor:20000}]};
function setup(){
 const store={
  readBalanceV2:vi.fn<FishingBillingOwnerHttpV2Deps['store']['readBalanceV2']>().mockResolvedValue(current),
  readOperationReceiptV2:vi.fn<FishingBillingOwnerHttpV2Deps['store']['readOperationReceiptV2']>().mockResolvedValue(f.operation),
  recordCashDate:vi.fn<FishingBillingOwnerHttpV2Deps['store']['recordCashDate']>().mockResolvedValue(f.operation),
  reverseCashV2:vi.fn<FishingBillingOwnerHttpV2Deps['store']['reverseCashV2']>().mockResolvedValue(f.operation),
  setStateV2:vi.fn<FishingBillingOwnerHttpV2Deps['store']['setStateV2']>().mockResolvedValue(f.operation),
 };
 const deps: FishingBillingOwnerHttpV2Deps={origin,actor:async()=>actor,csrf:()=>csrf,store,
  limits:{consume:async()=>({count:1,retryAfterMs:0})},rateLimitKey:'d'.repeat(32)};
 return {deps,store,load:async()=>deps};
}
function request(query='',body?:unknown,extra:Record<string,string>={}){
 return new Request(origin+FISHING_BILLING_OWNER_V2_PATH+query,{method:body===undefined?'GET':'POST',headers:{
  host:'fishing-owner-v2.example.invalid','x-forwarded-host':'fishing-owner-v2.example.invalid','x-forwarded-proto':'https',cookie:'__Host-ls-session='+token,
  ...(body===undefined?{}:{origin,'sec-fetch-site':'same-origin','content-type':'application/json','x-csrf-token':csrf}),...extra,
 },...(body===undefined?{}:{body:JSON.stringify(body)})});
}
it('saves the exact date command and exposes date precision without a fabricated instant',async()=>{
 const s=setup(),r=await fishingBillingOwnerHttpV2(request('',{action:'cash_date',command:dateCommand}),s.load),body=await r.json();
 expect(r.status).toBe(200);expect(s.store.recordCashDate).toHaveBeenCalledExactlyOnceWith(actor,dateCommand);
 const saved=body.data.current.balance.receipts.find((x:{kind:string})=>x.kind==='cash');
 expect(saved).toMatchObject({receivedDate:'2035-01-05',receivedPrecision:'date',timeZone:'America/New_York',recordedAt:'2035-01-06T15:00:00Z'});
 expect(saved).not.toHaveProperty('receivedAt');expect(body.data.current.balance.remainingMinor).toBe(45000);
});
it('rejects instant fields on the date-only command without calling the native save',async()=>{
 const s=setup();
 expect((await fishingBillingOwnerHttpV2(request('',{action:'cash_date',command:{...dateCommand,receivedAt:'2035-01-05T00:00:00Z'}}),s.load)).status).toBe(400);
 expect(s.store.recordCashDate).not.toHaveBeenCalled();
});
it('keeps original V1 recovery provenance while refreshing the mixed V2 balance',async()=>{
 const q=syntheticAccepted(),legacy=operationReceiptSchema.parse({version:BILLING_DTO_VERSION,operationId:f.operation.operationId,entityId:q.id,entityVersion:q.revision,replayed:true,result:{quote:q,balance:projectBalance(q,[]),receiptId:null}});
 const s=setup();s.store.readOperationReceiptV2.mockResolvedValue(upgradeOperationReceipt(legacy));
 const r=await fishingBillingOwnerHttpV2(request('?kind=operation&id='+legacy.operationId),s.load),body=await r.json();
 expect(r.status).toBe(200);expect(body.data.receipt.sourceVersion).toBe(BILLING_DTO_VERSION);
 expect(body.data.receipt.result.balance.remainingMinor).toBe(130000);expect(body.data.current.balance.remainingMinor).toBe(45000);
});
it('keeps missing V2 operation status unresolved',async()=>{
 const s=setup();s.store.readOperationReceiptV2.mockResolvedValue(null);
 const r=await fishingBillingOwnerHttpV2(request('?kind=operation&id='+f.operation.operationId),s.load);
 expect((await r.json()).data).toEqual({version:BILLING_DTO_V2,state:'unresolved',operationId:f.operation.operationId});
 expect(s.store.recordCashDate).not.toHaveBeenCalled();
});
it.each(['session','parent','csrf','origin'] as const)('preserves the %s access boundary for date cash',async mode=>{
 const s=setup();if(mode==='parent')s.deps.actor=async()=>({...actor,role:'parent'});
 const headers=mode==='session'?{cookie:''}:mode==='csrf'?{'x-csrf-token':'bad'}:mode==='origin'?{origin:'https://other.example.invalid'}:{};
 const r=await fishingBillingOwnerHttpV2(request('',{action:'cash_date',command:dateCommand},headers),s.load);
 expect(r.status).toBe(mode==='session'?401:403);expect(s.store.recordCashDate).not.toHaveBeenCalled();
});
it.each(['FORBIDDEN','NOT_FOUND'] as const)('retains uncertainty after a date save when the current read throws %s',async code=>{
 const s=setup();s.store.readBalanceV2.mockRejectedValue(new AppError(code));
 const r=await fishingBillingOwnerHttpV2(request('',{action:'cash_date',command:dateCommand}),s.load);
 expect(s.store.recordCashDate).toHaveBeenCalledOnce();expect(r.status).toBe(503);expect(await r.json()).toMatchObject({ok:false,error:{code:'UNAVAILABLE'}});
});
it('dispatches versioned owner state without writing off the date balance',async()=>{
 const s=setup(),id=syntheticId(910),q={...f.quote,revision:6,paused:true},b={...f.balance,revision:6,paused:true};
 const op=operationReceiptV2Schema.parse({...f.operation,operationId:id,entityVersion:6,result:{quote:q,balance:b,receiptId:null}});
 s.store.setStateV2.mockResolvedValue(op);s.store.readBalanceV2.mockResolvedValue({quote:q,balance:b,receiptId:null});
 const command={version:BILLING_DTO_V2,operationId:id,expectedVersion:5,quoteId:q.id,paused:true};
 const r=await fishingBillingOwnerHttpV2(request('',{action:'state',command}),s.load);
 expect(r.status).toBe(200);expect(s.store.setStateV2).toHaveBeenCalledExactlyOnceWith(actor,command);
 expect((await r.json()).data.current.balance).toMatchObject({paused:true,remainingMinor:45000});
});
it('sends date-only input through the inert V2 client and keeps503 unknown without retry',async()=>{
 const transport=vi.fn<(request:Request)=>Promise<Response>>(async()=>Response.json({ok:false,error:{code:'UNAVAILABLE'},requestId:syntheticId(900)},{status:503}));
 const c=createFishingBillingOwnerClientV2({origin,scope:{quoteId:f.quote.id,familyId:f.quote.familyId,workspaceId:f.quote.workspaceId},csrf:async()=>csrf,transport});
 expect(await c.recordCashDate(dateCommand)).toEqual({kind:'unknown'});expect(transport).toHaveBeenCalledOnce();
 const sent=transport.mock.calls[0]![0] as Request;
 expect(new URL(sent.url).pathname).toBe(FISHING_BILLING_OWNER_V2_PATH);
 expect((await sent.clone().json()).command).toEqual(dateCommand);
});
