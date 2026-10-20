import {randomUUID} from 'node:crypto';
import {expect,test,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {AcademyCheckoutService} from '../../../src/features/fishing/academy-checkout-service.ts';
import {digest} from '../../../src/features/fishing-payments/domain.ts';
import type {Actor} from '../../../src/features/fishing/contract.ts';
import type {StripeTestCheckoutContext,CheckoutKnownBinding,CheckoutObservation,StripeTestCheckoutProvider} from '../../../src/features/fishing-payments/stripe-test-checkout-ports.ts';
import type {CheckoutNativeClaim} from '../../../src/features/fishing-payments/stripe-test-checkout-native.ts';
import {offerFixture} from '../fishing-payments/fixture.ts';
function fixture(){
 const now=Date.now(),offer=offerFixture('installments',now),line=offer.lines[0]!,schedule={id:randomUUID(),revision:1,sourceVersion:'SYNTHETIC',offerId:offer.id,offerRevision:offer.revision,purchaseLineId:line.id,learnerId:line.learnerId,currency:'USD' as const,mode:line.mode,totalCents:line.totalCents,dues:line.dues.map(d=>({id:d.id,index:d.index,amountCents:d.amountCents,dueAt:d.dueAt}))};
 const c:StripeTestCheckoutContext={offer,offerDigest:digest(offer),purchaseId:randomUUID(),purchaseLineId:line.id,dueId:line.dues[0]!.id,operationId:randomUUID(),generation:1,entryPoint:'registration',schedule,scheduleDigest:digest(schedule),authorizationVersion:'a'.repeat(64),customer:{bindingId:randomUUID(),revision:1,payerAccountId:offer.payerAccountId,customerId:'cus_SYNTHETIC',merchantBindingId:'SYNTHETIC',verifiedAt:new Date(now-1000).toISOString()},agreements:{approvalId:'SYNTHETIC_ONLY',documentSetId:'SYNTHETIC_ONLY',documentSetRevision:1,acceptanceId:randomUUID(),termsVersion:offer.terms.version,program:'sunday_fishing_academy',sessions:12,acceptedBy:offer.payerAccountId,acceptedAt:offer.terms.acceptedAt,language:'en'},window:{policyId:'SYNTHETIC',revision:1,sourceVersion:'SYNTHETIC',opensAt:new Date(now-60000).toISOString(),closesAt:offer.expiresAt},expiresAt:new Date(now+3600000).toISOString()};
 const k:CheckoutKnownBinding={id:randomUUID(),revision:1,sessionId:'cs_test_SYNTHETIC',contextDigest:digest(c),operationId:c.operationId,purchaseId:c.purchaseId,purchaseLineId:c.purchaseLineId,dueId:c.dueId,customerBindingId:c.customer.bindingId,offerDigest:c.offerDigest,scheduleDigest:c.scheduleDigest};
 const o:CheckoutObservation={contextDigest:digest(c),sessionId:k.sessionId,customerId:c.customer.customerId,status:'open',paymentStatus:'unpaid',amountCents:65000,expiresAt:Math.floor(Date.parse(c.expiresAt)/1000),invoiceId:null,paymentIntentId:null,url:'https://checkout.stripe.com/c/pay/cs_test_SYNTHETIC#opaque'};
 let known:CheckoutKnownBinding|null=null,consumed=false,loseCommit=false,denied=false,observation=o;
 const order:string[]=[];
 const claim=(phase:'create'|'expire'):CheckoutNativeClaim=>({context:c,known:phase==='create'?null:k,authorityRevision:'a'.repeat(64),dispatch:{id:randomUUID(),phase,operationId:c.operationId,generation:1,contextDigest:digest(c),requestDigest:'b'.repeat(64),idempotencyKey:'SYNTHETIC',effectDecisionId:'SYNTHETIC',sessionId:phase==='create'?null:k.sessionId}});
 const coord={prepare:vi.fn(async()=>c),inspect:vi.fn(async()=>({context:c,known})),claim:vi.fn(async(_a:Actor,_id:string,_op:string,phase:'create'|'expire')=>claim(phase)),consume:vi.fn(async()=>{if(consumed)return false;consumed=true;order.push('consume');return true;}),observe:vi.fn(async()=>{known=k;order.push('commit-pending');if(loseCommit){loseCommit=false;throw Error('LOST_COMMIT_REPLY');}}),reconcile:vi.fn(async()=>({state:'observed' as const})),redirect:vi.fn(async()=>{if(denied)throw Error('CURRENT_AUTH_DENIED');expect(known).toEqual(k);order.push('publish');return {state:'ready' as const,operationId:c.operationId,purchaseId:c.purchaseId,dueId:c.dueId,sessionId:k.sessionId,url:o.url!};}),inspectExpiry:vi.fn(async()=>claim('expire'))};
 const provider:StripeTestCheckoutProvider={execution:'stripe_test_checkout',binding:{accountId:'acct_SYNTHETIC',livemode:false,apiVersion:'2026-09-30.endive',verifiedBindingId:'SYNTHETIC'},perform:vi.fn(async(_c,action)=>{order.push(action.phase);return observation;})};
 const actor={id:offer.payerAccountId,workspaceId:offer.workspaceId,role:'parent'} as Actor,service=new AcademyCheckoutService(coord,provider,{now:()=>new Date(now)}),request=()=>service.request(actor,'same-command',c.purchaseId,c.dueId);
 return {c,k,o,coord,provider,actor,service,request,order,pending:()=>{known=k;consumed=true;},lostCommit:()=>{loseCommit=true;},deny:()=>{denied=true;},consume:()=>{consumed=true;},setObservation:(v:CheckoutObservation)=>{observation=v;}};
}
test('pending native binding commits before URL; repeated request performs no second create',async()=>{
 const f=fixture();expect((await f.request())?.url).toBe(f.o.url);expect(f.order).toEqual(['consume','create','commit-pending','read','publish']);await f.request();expect(f.order.filter(x=>x==='create')).toHaveLength(1);expect(f.coord.reconcile).toHaveBeenCalledTimes(2);
});
test('restart with committed known ID uses read/reconcile and cannot create again',async()=>{
 const f=fixture();f.pending();await f.request();expect(f.order).toEqual(['read','publish']);expect(f.coord.claim).not.toHaveBeenCalled();
});
test('consumed create without known ID remains unknown and cannot call provider',async()=>{
 const f=fixture();f.consume();expect(await f.request()).toBeNull();expect(f.provider.perform).not.toHaveBeenCalled();expect(f.coord.redirect).not.toHaveBeenCalled();
});
test('unknown provider response retains consume fence and cannot double-create',async()=>{
 const f=fixture();vi.mocked(f.provider.perform).mockRejectedValueOnce(Error('NETWORK_UNKNOWN'));await expect(f.request()).rejects.toThrow('NETWORK_UNKNOWN');expect(await f.request()).toBeNull();expect(f.provider.perform).toHaveBeenCalledTimes(1);
});
test('lost pending-commit response recovers by known ID without browser success or another create',async()=>{
 const f=fixture();f.lostCommit();await expect(f.request()).rejects.toThrow('LOST_COMMIT_REPLY');await f.request();expect(f.order.filter(x=>x==='create')).toHaveLength(1);expect(f.coord.redirect).toHaveBeenCalledTimes(1);
});
test('complete or expired provider readback cannot publish a stale checkout URL or claim enrollment',async()=>{
 for(const status of ['complete','expired'] as const){const f=fixture();f.pending();f.setObservation({...f.o,status,url:null});expect(await f.request()).toBeNull();expect(f.coord.reconcile).toHaveBeenCalledTimes(1);expect(f.coord.redirect).not.toHaveBeenCalled();}
});
test('tampered provider amount and changed current authority cannot publish',async()=>{
 const f=fixture();f.pending();f.setObservation({...f.o,amountCents:1});await expect(f.request()).rejects.toThrow();expect(f.coord.redirect).not.toHaveBeenCalled();const g=fixture();g.pending();g.deny();await expect(g.request()).rejects.toThrow('CURRENT_AUTH_DENIED');
});
test('expire-only rejects a still-current session before reserving a closure claim',async()=>{
 const f=fixture();f.pending();await expect(f.service.close(f.actor,'close',f.c.operationId,true)).rejects.toThrow();expect(f.coord.claim).not.toHaveBeenCalled();expect(f.provider.perform).not.toHaveBeenCalled();
});
test('closure retry reads the consumed expiry instead of dispatching it again',async()=>{
 const f=fixture();f.setObservation({...f.o,status:'expired',url:null});expect(await f.service.close(f.actor,'close',f.c.operationId,false)).toEqual({state:'closed'});expect(await f.service.close(f.actor,'close',f.c.operationId,false)).toEqual({state:'closed'});expect(f.order.filter(x=>x==='expire')).toHaveLength(1);expect(f.coord.inspectExpiry).toHaveBeenCalledTimes(1);
});
