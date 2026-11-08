import {expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {randomUUID} from 'node:crypto';
import {AppError} from '../../src/lib/errors.ts';
import type {Actor} from '../../src/features/identity/types.ts';
import {syntheticAccepted,syntheticId,syntheticOwner,syntheticWorkspace,syntheticNow} from '../../src/features/fishing-billing/fixtures.ts';
import {CARD_VERSION,cardAttemptSchema,cardPreparationReceiptSchema,prepareCardCommandSchema} from '../../src/features/fishing-billing/card-contracts.ts';
import {syntheticGuestOwnerMoneyFixturesV3} from '../fixtures/fishing-billing-owner-v3.ts';
import {projectBillingCurrentLedgerV3} from '../../src/lib/fishing-billing-current-ledger-v3.ts';
import {currentLedgerFrameV3Schema,type CurrentLedgerSourceV3,type CurrentLedgerFrameV3} from '../../src/lib/fishing-billing-current-contract-v3.ts';
import {BILLING_CARD_OWNER_V3,FISHING_BILLING_CARD_OWNER_V3_PATH,OWNER_CARD_V3_MAX_RESPONSE_BYTES,billingCardOwnerReadV3Schema} from '../../src/lib/fishing-billing-card-owner-contract-v3.ts';
import {billingCardOwnerReadSchema} from '../../src/lib/fishing-billing-card-owner-contract.ts';
import {fishingBillingCardOwnerHttpV3,type FishingBillingCardOwnerDepsV3} from '../../src/lib/fishing-billing-card-owner-http-v3.ts';
import {createFishingBillingCardOwnerClientV3} from '../../src/lib/fishing-billing-card-owner-client-v3.ts';

// Protocol-only client/HTTP contract checks. Native card operations, owner
// authentication, proxy and rate store below are EXPLICIT MOCKS. Real financial
// Native saving is separately tested; this proves no card/provider/runtime flow.
const origin='https://fishing-card-v3.example.invalid',token='a'.repeat(43),csrf='b'.repeat(43);
const actor={id:syntheticOwner,workspaceId:syntheticWorkspace,personId:syntheticId(1100),role:'practitioner',state:'active',locale:'he',sessionDigest:'c'.repeat(64),expiresAt:Date.parse('2036-01-01')} as Actor;
function request(query='',body?:unknown,extra:Record<string,string>={}){
 return new Request(origin+FISHING_BILLING_CARD_OWNER_V3_PATH+query,{method:body===undefined?'GET':'POST',headers:{host:'fishing-card-v3.example.invalid','x-forwarded-host':'fishing-card-v3.example.invalid','x-forwarded-proto':'https',cookie:'__Host-ls-session='+token,...(body===undefined?{}:{origin,'sec-fetch-site':'same-origin','content-type':'application/json','x-csrf-token':csrf}),...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});
}
function setup(kind:CurrentLedgerSourceV3['kind']='guest_successor'){
 const f=syntheticGuestOwnerMoneyFixturesV3(),source:CurrentLedgerSourceV3=kind==='guest_successor'?{kind,quote:f.accepted.quote}:{kind,quote:syntheticAccepted()},q=source.quote;
 const command=prepareCardCommandSchema.parse({operationId:syntheticId(1110),quoteId:q.id,expectedVersion:q.revision,selection:[{lineId:q.lines[0]!.id,amountMinor:10000},{lineId:q.lines[1]!.id,amountMinor:15000}]}),receipt=cardPreparationReceiptSchema.parse({version:CARD_VERSION,operationId:command.operationId,quoteId:q.id,entityVersion:q.revision+1,replayed:false,result:{attemptId:command.operationId,amountMinor:25000,allocations:command.selection}});
 const frame=(revision=q.revision,paused=false,cancelled=false):CurrentLedgerFrameV3=>projectBillingCurrentLedgerV3({source:source.kind==='guest_successor'?{kind:source.kind,quote:{...source.quote,revision,paused,state:cancelled?'cancelled':source.quote.state}}:{kind:source.kind,quote:{...source.quote,revision,paused,state:cancelled?'cancelled':source.quote.state}},receipts:[],exceptions:[],pendingAttemptIds:revision>q.revision?[command.operationId]:[],...(source.kind==='historical_account'?{originalAccountSnapshot:source.quote}:{})});
 let current=frame(),attempt:ReturnType<typeof cardAttemptSchema.parse>|null=null;
 const makeAttempt=()=>cardAttemptSchema.parse({version:CARD_VERSION,id:command.operationId,workspaceId:q.workspaceId,quoteId:q.id,familyId:q.familyId,actorId:actor.id,revision:1,balanceVersion:receipt.entityVersion,binding:{accountId:'acct_SYNTHETIC',livemode:false,apiVersion:'2026-09-30.endive',verifiedBindingId:'SYNTHETIC_ONLY'},command,requestDigest:'d'.repeat(64),preparation:receipt,createdAt:syntheticNow,state:'prepared',dispatchId:null,sessionId:null,checkoutUrl:null,paymentIntentId:null});
 const cards={
  prepare:vi.fn<FishingBillingCardOwnerDepsV3['cards']['prepare']>(async(_actor,raw)=>{const input=prepareCardCommandSchema.parse(raw);if(JSON.stringify(input)!==JSON.stringify(command))throw new AppError('CONFLICT');const replayed=attempt!==null;if(!attempt){attempt=makeAttempt();current=frame(receipt.entityVersion);}return {...receipt,replayed};}),
  readAttempt:vi.fn<FishingBillingCardOwnerDepsV3['cards']['readAttempt']>(async()=>{if(!attempt)throw new AppError('NOT_FOUND');return attempt;}),
  readPreparationReceipt:vi.fn<FishingBillingCardOwnerDepsV3['cards']['readPreparationReceipt']>(async()=>attempt?{...receipt,replayed:true}:null),
  createCheckout:vi.fn<FishingBillingCardOwnerDepsV3['cards']['createCheckout']>(async()=>{if(!attempt)throw new AppError('NOT_FOUND');attempt=cardAttemptSchema.parse({...attempt,revision:2,state:'open',dispatchId:syntheticId(1111),sessionId:'cs_SYNTHETIC',checkoutUrl:'https://checkout.stripe.com/c/pay/cs_SYNTHETIC'});return attempt;}),
 };
 const deps:FishingBillingCardOwnerDepsV3={origin,actor:async value=>{if(value!==token)throw new AppError('UNAUTHENTICATED');return actor;},csrf:()=>csrf,limits:{consume:async()=>({count:1,retryAfterMs:0})},rateLimitKey:'e'.repeat(32),readCurrent:vi.fn(async()=>current),cards},load=async()=>deps;
 const transport=vi.fn(async(incoming:Request)=>{const headers=new Headers(incoming.headers);for(const [k,v] of Object.entries({host:'fishing-card-v3.example.invalid','x-forwarded-host':'fishing-card-v3.example.invalid','x-forwarded-proto':'https',cookie:'__Host-ls-session='+token,...(incoming.method==='POST'?{origin,'sec-fetch-site':'same-origin'}:{})}))headers.set(k,v);return fishingBillingCardOwnerHttpV3(new Request(incoming.clone(),{headers}),load);});
 const options={origin,scope:{quoteId:q.id,familyId:q.familyId,workspaceId:q.workspaceId},csrf:async()=>csrf,transport,readCurrent:async(quoteId:string)=>deps.readCurrent(actor,quoteId)};
 return {command,receipt,frame,cards,deps,load,transport,options,client:createFishingBillingCardOwnerClientV3(options),setCurrent:(value:CurrentLedgerFrameV3)=>{current=value;}};
}
it.each(['historical_account','guest_successor'] as const)('card-v3 protocol keeps %s current provenance and original generic preparation',async kind=>{
 const s=setup(kind),r=await s.client.prepare(s.command);expect(r.kind).toBe('prepared');if(r.kind!=='prepared')throw Error('EXPECTED_PREPARED');expect(r.data.current.source.kind).toBe(kind);expect(r.data.current.balance).toMatchObject({paidMinor:0,state:'unpaid'});expect(r.data.receipt.version).toBe(CARD_VERSION);expect(r.data.receipt.entityVersion).toBe(s.command.expectedVersion+1);expect(r.data.checkoutUrl).toBeNull();expect(billingCardOwnerReadSchema.safeParse(r.data).success).toBe(false);
 expect(s.cards.prepare).toHaveBeenCalledExactlyOnceWith(actor,s.command);const posted=await s.transport.mock.calls[0]![0].clone().json();expect(posted).toEqual({version:BILLING_CARD_OWNER_V3,action:'prepare',command:s.command});expect(billingCardOwnerReadV3Schema.parse(r.data)).toEqual(r.data);
});
it('card-v3 protocol recovers original preparation beside later paused current, without resurfacing historical checkout',async()=>{
 const s=setup();await s.client.prepare(s.command);expect((await s.client.createCheckout(s.command.operationId)).kind).toBe('attempt');s.setCurrent(s.frame(6,true));const recovered=await s.client.readOperation(s.command.operationId);expect(recovered?.receipt.entityVersion).toBe(4);expect(recovered?.current.source.quote).toMatchObject({revision:6,paused:true});expect(recovered?.checkoutUrl).toBeNull();expect((await s.client.prepare(s.command)).kind).toBe('prepared');expect(s.cards.prepare).toHaveBeenCalledTimes(2);expect(s.cards.createCheckout).toHaveBeenCalledOnce();
});
it.each(['FORBIDDEN','NOT_FOUND'] as const)('card-v3 protocol keeps a successful mocked preparation UNKNOWN if fresh current fails %s',async code=>{
 const s=setup();let reads=0;const actual=s.deps.readCurrent;s.deps.readCurrent=async(a,id)=>{if(++reads===2)throw new AppError(code);return actual(a,id);};expect(await s.client.prepare(s.command)).toEqual({kind:'unknown'});expect(s.cards.prepare).toHaveBeenCalledOnce();expect(s.transport).toHaveBeenCalledOnce();expect((await s.client.readOperation(s.command.operationId))?.receipt.operationId).toBe(s.command.operationId);expect(s.cards.prepare).toHaveBeenCalledOnce();
});
it.each(['CONFLICT','INVALID_REQUEST'] as const)('card-v3 protocol treats typed %s after mocked native invocation as uncertain, not failed save',async code=>{
 const s=setup(),save=s.cards.prepare.getMockImplementation()!;s.cards.prepare.mockImplementationOnce(async(a,c)=>{await save(a,c);throw new AppError(code);});expect(await s.client.prepare(s.command)).toEqual({kind:'unknown'});expect(s.transport).toHaveBeenCalledOnce();expect((await s.client.readOperation(s.command.operationId))?.receipt.operationId).toBe(s.command.operationId);
});
it('card-v3 protocol returns a known stale conflict before invoking preparation and leaves missing operation unresolved',async()=>{
 const s=setup();expect(await s.client.readOperation(s.command.operationId)).toBeNull();s.setCurrent(s.frame(5));const r=await s.client.prepare(s.command);expect(r.kind).toBe('conflict');if(r.kind!=='conflict')throw Error('EXPECTED_CONFLICT');expect(r.current.source.quote.revision).toBe(5);expect(s.cards.prepare).not.toHaveBeenCalled();expect(s.cards.readPreparationReceipt).toHaveBeenCalledTimes(3);
});
it('card-v3 protocol preserves checkout uncertainty and performs no automatic second dispatch or navigation',async()=>{
 const s=setup();await s.client.prepare(s.command);const dispatch=s.cards.createCheckout.getMockImplementation()!;s.cards.createCheckout.mockImplementationOnce(async(a,q,id)=>{await dispatch(a,q,id);throw new AppError('CONFLICT');});expect(await s.client.createCheckout(s.command.operationId)).toEqual({kind:'unknown'});expect(s.cards.createCheckout).toHaveBeenCalledOnce();const read=await s.client.readAttempt(s.command.operationId);expect(read.checkoutUrl).toBe('https://checkout.stripe.com/c/pay/cs_SYNTHETIC');expect(s.cards.createCheckout).toHaveBeenCalledOnce();
});
it.each(['session','parent','csrf','origin','legacy-version'] as const)('card-v3 protocol rejects %s before preparation',async mode=>{
 const s=setup();if(mode==='parent')s.deps.actor=async()=>({...actor,role:'parent'});const extra=mode==='session'?{cookie:''}:mode==='csrf'?{'x-csrf-token':'bad'}:mode==='origin'?{origin:'https://other.example.invalid'}:{};
 const response=await fishingBillingCardOwnerHttpV3(request('',{version:mode==='legacy-version'?'JLFA-FISHING-OWNER-CARD-v1':BILLING_CARD_OWNER_V3,action:'prepare',command:s.command},extra),s.load);expect(response.status).toBe(mode==='session'?401:mode==='legacy-version'?400:403);expect(s.cards.prepare).not.toHaveBeenCalled();expect(response.headers.get('cache-control')).toBe('private, no-store');
});
it.each(['paused','cancelled','review'] as const)('card-v3 protocol hides an old checkout for %s current',async mode=>{
 const s=setup();await s.client.prepare(s.command);await s.client.createCheckout(s.command.operationId);const base=s.frame(4,mode==='paused',mode==='cancelled');s.setCurrent(mode==='review'?currentLedgerFrameV3Schema.parse({...base,balance:{...base.balance,state:'review_required'},cardExceptions:[{id:randomUUID(),state:'open'}]}):base);expect((await s.client.readAttempt(s.command.operationId)).checkoutUrl).toBeNull();
});
it('card-v3 protocol rejects wrong prepared revisions, duplicate query keys and well-formed foreign current',async()=>{
 const s=setup();s.cards.prepare.mockResolvedValueOnce({...s.receipt,entityVersion:5});expect(await s.client.prepare(s.command)).toEqual({kind:'unknown'});expect(s.cards.readAttempt).not.toHaveBeenCalled();
 expect((await fishingBillingCardOwnerHttpV3(request('?kind=attempt&kind=operation&quoteId='+s.command.quoteId+'&id='+s.command.operationId),s.load)).status).toBe(400);
 const other=setup('historical_account');s.deps.readCurrent=other.deps.readCurrent;expect(await s.client.prepare(s.command)).toEqual({kind:'unknown'});expect(s.cards.prepare).toHaveBeenCalledOnce();
});
it('card-v3 protocol cancels an oversized response and does not emit a late POST after CSRF timeout',async()=>{
 const s=setup();let cancelled=false;s.transport.mockImplementationOnce(async()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(OWNER_CARD_V3_MAX_RESPONSE_BYTES+1));},cancel(){cancelled=true;}}),{headers:{'content-type':'application/json'}}));expect(await s.client.prepare(s.command)).toEqual({kind:'unknown'});expect(cancelled).toBe(true);
 let release:(value:string)=>void=()=>{};const pending=new Promise<string>(resolve=>{release=resolve;}),transport=vi.fn(s.transport.getMockImplementation()!),client=createFishingBillingCardOwnerClientV3({...s.options,transport,csrf:()=>pending,timeoutMs:1});expect(await client.prepare(s.command)).toEqual({kind:'unknown'});release(csrf);await Promise.resolve();await Promise.resolve();expect(transport).not.toHaveBeenCalled();
});
it('card-v3 protocol rejects an attempt without actual acceptance provenance or with an invalid checkout URL',async()=>{
 const s=setup(),r=await s.client.prepare(s.command);if(r.kind!=='prepared')throw Error('EXPECTED_PREPARED');const f=syntheticGuestOwnerMoneyFixturesV3(),unaccepted=projectBillingCurrentLedgerV3({source:{kind:'guest_successor',quote:{...f.unanswered.quote,revision:r.data.current.source.quote.revision}},receipts:[],exceptions:[]});
 expect(billingCardOwnerReadV3Schema.safeParse({...r.data,current:unaccepted}).success).toBe(false);expect(billingCardOwnerReadV3Schema.safeParse({...r.data,checkoutUrl:'not a URL'}).success).toBe(false);
});
