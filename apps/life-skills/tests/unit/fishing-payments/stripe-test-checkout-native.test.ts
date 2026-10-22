/** Source183 AUTHORING ONLY, UNRUN. SQL/authority/transaction doubles test
 * coordinator decisions only; no native atomicity, identity or provider proof. */
import {randomUUID} from 'node:crypto';
import {expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import type {Actor,SqlSession} from '../../../src/features/fishing/contract.ts';
import type {NativeContext,ProviderOperation,PurchaseRecord} from '../../../src/features/fishing-payments/ports.ts';
import {digest,initialPayment} from '../../../src/features/fishing-payments/domain.ts';
import type {FishingPaymentStore} from '../../../src/features/fishing-payments/store.ts';
import {NativeStripeCheckoutCoordinator,checkoutNativeJournalActions as A,type NativeStripeCheckoutPolicy,type CheckoutNativeAdmission} from '../../../src/features/fishing-payments/stripe-test-checkout-native.ts';
import type {CheckoutObservation,StripeTestCheckoutContext} from '../../../src/features/fishing-payments/stripe-test-checkout-ports.ts';
import {offerFixture} from './fixture.ts';
const NOW=Date.parse('2027-01-05T15:00:00Z'),urls={successUrl:'https://life-skills.bneineviimacademy.org/en/account',cancelUrl:'https://life-skills.bneineviimacademy.org/en/florida/apply'};
const merchant={accountId:'acct_SYNTHETIC_NATIVE',livemode:false as const,apiVersion:'2026-09-30.endive' as const,verifiedBindingId:'SYNTHETIC_NOT_PROVIDER_VERIFIED'};
type Row={actorId:string;value:unknown;hash:string;at:Date;workspace:string;action:string;key:string};
function fixture(){
 const offer=offerFixture('installments',NOW),line=offer.lines[0]!,purchaseId=randomUUID(),p:PurchaseRecord={offer,line,state:initialPayment(offer,line,purchaseId,merchant)};
 const parent={id:offer.payerAccountId,workspaceId:offer.workspaceId,role:'parent'} as Actor,owner={id:offer.operatorAccountId,workspaceId:offer.workspaceId,role:'practitioner'} as Actor;
 const customer={id:randomUUID(),revision:1,payerAccountId:offer.payerAccountId,customerId:'cus_SYNTHETIC_NATIVE',merchantBindingId:merchant.verifiedBindingId,apiVersion:merchant.apiVersion,verifiedAt:new Date(NOW-3600000),revokedAt:null as Date|null};
 const operations=new Map<string,ProviderOperation>(),journals:Row[]=[],fences=new Set<string>(),cache=new Map<string,{hash:string;value:unknown}>(),events:string[]=[];
 let admitted=true,closure=false,revision='a'.repeat(64),now=NOW;
 const admission:CheckoutNativeAdmission={revision,effectDecisionId:'SYNTHETIC_EFFECT_CAPABILITY_ONLY',entryPoint:'registration',schedule:{id:randomUUID(),revision:1,sourceVersion:'SYNTHETIC_EXPLICIT_SCHEDULE',offerId:offer.id,offerRevision:offer.revision,purchaseLineId:line.id,learnerId:line.learnerId,currency:'USD',mode:line.mode,totalCents:line.totalCents,dues:line.dues.map(d=>({id:d.id,index:d.index,amountCents:d.amountCents,dueAt:d.dueAt}))},agreements:{approvalId:'SYNTHETIC_NOT_LEGAL_APPROVAL',documentSetId:'SYNTHETIC_12_SESSION_EN_HE',documentSetRevision:1,acceptanceId:randomUUID(),termsVersion:offer.terms.version,program:'sunday_fishing_academy',sessions:12,acceptedBy:offer.payerAccountId,acceptedAt:offer.terms.acceptedAt,language:'en'},window:{policyId:'SYNTHETIC_WINDOW',revision:1,sourceVersion:'SYNTHETIC_ONLY',opensAt:new Date(NOW-60000).toISOString(),closesAt:offer.expiresAt},expiresAt:new Date(NOW+3600000).toISOString()};
 const tx:SqlSession={query:async<T extends object>(sql:string,v:readonly unknown[]=[])=>{
  let rows:object[]=[];
  if(sql.includes('FROM ls_fishing_payments.commands'))rows=journals.filter(r=>r.workspace===v[0]&&r.action===v[1]&&r.key===v[2]);
  else if(sql.startsWith('INSERT INTO ls_fishing_payments.commands'))journals.push({workspace:String(v[0]),actorId:String(v[1]),action:String(v[2]),key:String(v[3]),hash:String(v[4]),value:JSON.parse(String(v[5])),at:new Date((v[6] as Date).valueOf())});
  else if(sql.includes('FROM ls_fishing_payments.operations')&&sql.includes('purchase_id=$2'))rows=[...operations.values()].filter(o=>o.workspaceId===v[0]&&o.purchaseId===v[1]&&o.dueId===v[2]).map(o=>({id:o.id}));
  else if(sql.includes('FROM ls_fishing_payments.operations')){const o=operations.get(String(v[1]));if(o&&o.workspaceId===v[0])rows=[{purchaseId:o.purchaseId,kind:o.kind,dueId:o.dueId,hash:o.requestDigest,value:o}];}
  else if(sql.startsWith('INSERT INTO ls_fishing_payments.operations')){const o=JSON.parse(String(v[6])) as ProviderOperation;if([...operations.values()].some(x=>x.purchaseId===o.purchaseId&&x.dueId===o.dueId))throw Error('UNIQUE_DUE');operations.set(o.id,o);}
  else if(sql.startsWith('UPDATE ls_fishing_payments.operations'))operations.set(String(v[1]),JSON.parse(String(v[2])) as ProviderOperation);
  else if(sql.includes('FROM ls_fishing_payments.customer_bindings')){if(v[0]===offer.workspaceId&&v[1]===customer.payerAccountId&&v[2]===merchant.accountId&&(v.length===4?v[3]===customer.id:!customer.revokedAt))rows=[customer];}
  else if(sql.startsWith('INSERT INTO ls_fishing_payments.outbox')){const key=String(v[2])+':'+String(v[3]);if(!fences.has(key)){fences.add(key);rows=[{id:v[0]}];}}
  else if(sql.includes('FROM ls_fishing_payments.outbox')){if(fences.has(String(v[1])+':'+String(v[2])))rows=[{id:'SYNTHETIC_FENCE'}];}
  else if(sql.includes('FROM ls_identity.accounts')){if(v[1]===owner.id)rows=[{id:owner.id}];}
  else if(sql.includes('FROM ls_identity.workspaces')){if(v[0]===offer.workspaceId)rows=[{id:offer.workspaceId}];}
  else throw Error('UNHANDLED_UNIT_SQL');
  return rows as T[];
 }};
 const policy:NativeStripeCheckoutPolicy={load:async()=>{events.push('current-policy');if(!admitted)throw Error('SYNTHETIC_CURRENT_DENIAL');return {...admission,revision};},expire:async()=>{if(!closure)throw Error('SYNTHETIC_CLOSURE_DENIED');return {decisionId:'SYNTHETIC_FINANCIAL_OWNER_EXPIRY',revision:'e'.repeat(64)};},promotion:async()=>{throw Error('NO_SYNTHETIC_PROMOTION_PROOF');}};
 const context=(actor:Actor):NativeContext=>({tx,actor,now:new Date(now)});
 const store={deps:{merchant,clock:{now:()=>new Date(now)},database:{transaction:async<T>(work:(t:SqlSession)=>Promise<T>)=>work(tx)},authority:{loadApprovedOffer:async()=>offer}},read:async<T>(actor:Actor,work:(c:NativeContext)=>Promise<T>)=>work(context(actor)),command:async<T>(actor:Actor,id:string,action:string,body:unknown,authorize:(c:NativeContext)=>Promise<void>,work:(c:NativeContext)=>Promise<T>)=>{const c=context(actor);await authorize(c);events.push('cache-read');const key=actor.id+':'+action+':'+id,old=cache.get(key),hash=digest(body);if(old){if(old.hash!==hash)throw Error('COMMAND_CONFLICT');return old.value as T;}const result=await work(c);cache.set(key,{hash,value:result});return result;},access:async(c:NativeContext)=>{if(c.actor.workspaceId!==offer.workspaceId||![parent.id,owner.id].includes(c.actor.id))throw Error('NOT_FOUND');},assertHostedActivationAllowed:async()=>{},loadOffer:async()=>({offer,state:'approved'}),purchase:async(c:NativeContext,id:string)=>{if(id!==purchaseId||c.actor.workspaceId!==offer.workspaceId)throw Error('NOT_FOUND');return p;},event:async()=>{}} as unknown as FishingPaymentStore;
 const coordinator=new NativeStripeCheckoutCoordinator(store,policy,urls),prepare=(key=randomUUID())=>coordinator.prepare(parent,key,purchaseId,line.dues[0]!.id);
 const observed=(c:StripeTestCheckoutContext):CheckoutObservation=>({contextDigest:digest(c),sessionId:'cs_test_SYNTHETIC_NATIVE',customerId:customer.customerId,status:'open',paymentStatus:'unpaid',amountCents:65000,expiresAt:Math.floor(Date.parse(c.expiresAt)/1000),invoiceId:null,paymentIntentId:null,url:'https://checkout.stripe.com/c/pay/cs_test_SYNTHETIC_NATIVE#opaque%2F%3D'});
 const started=async()=>{const c=await prepare(),claim=await coordinator.claim(parent,randomUUID(),c.operationId,'create');expect(await coordinator.consume(parent,claim)).toBe(true);return {c,claim,o:observed(c)};};
 const ready=async()=>{const s=await started();await coordinator.observe(s.claim,s.o);const known=(await coordinator.inspect(parent,s.c.operationId)).known!;return {...s,known};};
 return {offer,p,parent,owner,customer,store,policy,coordinator,operations,journals,fences,events,prepare,observed,started,ready,deny:()=>{admitted=false;},allowClosure:()=>{closure=true;},changePolicy:()=>{revision='b'.repeat(64);},advance:(minutes:number)=>{now=NOW+minutes*60000;},expire:()=>{now=NOW+3600000;}};
}

it('requires actual injected policy/customer capability and never supplies a default admission',async()=>{
 const f=fixture(),missing=new NativeStripeCheckoutCoordinator(f.store,null,urls);await expect(missing.prepare(f.parent,randomUUID(),f.p.state.purchaseId,f.p.line.dues[0]!.id)).rejects.toThrow();expect(f.operations.size).toBe(0);f.customer.revokedAt=new Date(NOW);await expect(f.prepare()).rejects.toThrow();expect(f.operations.size).toBe(0);
});
it('reuses the unique due and preserves the exact legacy operation JSON; only three650 dues exist',async()=>{
 const f=fixture(),c=await f.prepare(),again=await f.prepare();expect(again).toEqual(c);expect(f.operations.size).toBe(1);expect(c.schedule.dues.map(d=>d.amountCents)).toEqual([65000,65000,65000]);expect(f.p.state.paidCents).toBe(0);
 expect(Object.keys(f.operations.get(c.operationId)!)).toEqual(['id','kind','workspaceId','purchaseId','dueId','refundPaymentId','providerAccountId','livemode','amountCents','currency','idempotencyKey','state','requestDigest','result']);
});
it('commits UNKNOWN before a globally consumed create fence, independent of actor/command replay',async()=>{
 const f=fixture(),{c,claim}=await f.started();expect(f.operations.get(c.operationId)?.state).toBe('unknown');expect(f.fences.has('operation.dispatch:'+c.operationId)).toBe(true);expect(await f.coordinator.consume(f.owner,claim)).toBe(false);expect(await f.coordinator.claim(f.owner,randomUUID(),c.operationId,'create')).toEqual(claim);
});
it('the existing invoice dispatch fence prevents another Checkout create',async()=>{
 const f=fixture(),c=await f.prepare(),claim=await f.coordinator.claim(f.parent,randomUUID(),c.operationId,'create');f.fences.add('operation.dispatch:'+c.operationId);expect(await f.coordinator.consume(f.parent,claim)).toBe(false);await expect(f.coordinator.observe(claim,f.observed(c))).rejects.toThrow();
});
it('commits a pending cs_ with null invoice before redirect; a new coordinator recovers without browser return',async()=>{
 const f=fixture(),s=await f.ready(),restarted=new NativeStripeCheckoutCoordinator(f.store,f.policy,urls),saved=await restarted.inspect(f.owner,s.c.operationId);expect(saved.known).toEqual(s.known);expect(f.operations.get(s.c.operationId)?.result).toBeNull();
 expect((await restarted.redirect(f.parent,randomUUID(),s.c,s.known,s.o)).url).toBe(s.o.url);expect(f.journals.some(r=>r.action===A.pending)).toBe(true);expect(f.p.state.paidCents).toBe(0);
});
it('an existing known session with29minutes remaining recovers while a new create still requires30minutes',async()=>{
 const f=fixture(),s=await f.ready();f.advance(31);expect(await f.prepare()).toEqual(s.c);expect((await f.coordinator.redirect(f.parent,randomUUID(),s.c,s.known,s.o)).url).toBe(s.o.url);await expect(f.coordinator.claim(f.parent,randomUUID(),s.c.operationId,'create')).rejects.toThrow();expect(f.operations.size).toBe(1);
});
it('lost creation without a committed ID cannot be reconciled by guessed ID, searched or recreated',async()=>{
 const f=fixture(),s=await f.started();expect((await f.coordinator.inspect(f.owner,s.c.operationId)).known).toBeNull();await expect(f.coordinator.reconcile(f.owner,randomUUID(),s.c.operationId,s.o)).rejects.toThrow();expect(await f.coordinator.consume(f.owner,s.claim)).toBe(false);expect(f.operations.size).toBe(1);
});
it('rejects changed observation amount/customer and session collisions before a publication',async()=>{
 const f=fixture(),s=await f.started();await expect(f.coordinator.observe(s.claim,{...s.o,amountCents:100})).rejects.toThrow();await expect(f.coordinator.observe(s.claim,{...s.o,customerId:'cus_FOREIGN'})).rejects.toThrow();await f.coordinator.observe(s.claim,s.o);await expect(f.coordinator.observe(s.claim,{...s.o,sessionId:'cs_test_COLLISION'})).rejects.toThrow();
});
it('reauthorizes cached publication and cannot return its old URL after native policy revocation/change',async()=>{
 const f=fixture(),s=await f.ready(),key=randomUUID();await f.coordinator.redirect(f.parent,key,s.c,s.known,s.o);f.events.length=0;f.deny();await expect(f.coordinator.redirect(f.parent,key,s.c,s.known,s.o)).rejects.toThrow();expect(f.events).not.toContain('cache-read');
 const g=fixture(),r=await g.ready();g.changePolicy();await expect(g.coordinator.redirect(g.parent,randomUUID(),r.c,r.known,r.o)).rejects.toThrow();
});
it('an observed complete-unpaid session closes publication and never allocates money',async()=>{
 const f=fixture(),s=await f.ready(),key=randomUUID();await f.coordinator.redirect(f.parent,key,s.c,s.known,s.o);const complete={...s.o,status:'complete' as const,url:null};await f.coordinator.reconcile(f.owner,randomUUID(),s.c.operationId,complete);await expect(f.coordinator.redirect(f.parent,key,s.c,s.known,s.o)).rejects.toThrow();await expect(f.coordinator.promote(f.owner,randomUUID(),s.c.operationId,complete,'evt_SYNTHETIC')).rejects.toThrow();expect(f.p.state.paidCents).toBe(0);expect(f.operations.get(s.c.operationId)?.state).toBe('unknown');
});
it('expiry requires the separate current financial owner decision and fences cached URLs immediately',async()=>{
 const f=fixture(),s=await f.ready();await expect(f.coordinator.claim(f.owner,randomUUID(),s.c.operationId,'expire')).rejects.toThrow();f.allowClosure();const expiry=await f.coordinator.claim(f.owner,randomUUID(),s.c.operationId,'expire');await expect(f.coordinator.redirect(f.parent,randomUUID(),s.c,s.known,s.o)).rejects.toThrow();f.deny();expect(await f.coordinator.consume(f.owner,expiry)).toBe(true);expect(await f.coordinator.consume(f.owner,expiry)).toBe(false);expect(await f.coordinator.inspectExpiry(f.owner,s.c.operationId)).toEqual(expiry);expect(f.operations.get(s.c.operationId)?.state).toBe('unknown');
});
it('expired cached redirects and unrecorded provider DTOs never authorize publication',async()=>{
 const f=fixture(),s=await f.ready(),key=randomUUID();await f.coordinator.redirect(f.parent,key,s.c,s.known,s.o);f.expire();await expect(f.coordinator.redirect(f.parent,key,s.c,s.known,s.o)).rejects.toThrow();const g=fixture(),r=await g.ready();await expect(g.coordinator.redirect(g.parent,randomUUID(),r.c,r.known,{...r.o,url:r.o.url+'-unrecorded'})).rejects.toThrow();
});
