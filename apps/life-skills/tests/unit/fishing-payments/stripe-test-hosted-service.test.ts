/** AUTHORED ONLY, Source131. Unit orchestration doubles, NOT native transaction,
 * ordinary login, permission or provider proof. Root implements/tests coordinator. */
import {randomUUID} from 'node:crypto';
import {expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {digest,initialPayment,type FamilyHostedAction} from '../../../src/features/fishing-payments/domain.ts';
import type {Actor} from '../../../src/features/fishing/contract.ts';
import type {FishingPaymentStore} from '../../../src/features/fishing-payments/store.ts';
import {FishingPaymentService} from '../../../src/features/fishing-payments/service.ts';
import type {NativeContext,StripeTestHostedBinding,StripeTestHostedClaim,StripeTestHostedContext,StripeTestHostedCoordinator,StripeTestHostedDependencies,StripeTestHostedObservation,StripeTestHostedPhase} from '../../../src/features/fishing-payments/ports.ts';
import {offerFixture} from './fixture.ts';

const NOW=Date.parse('2027-01-05T15:00:00Z');
function fixture(){
 const binding:StripeTestHostedBinding={accountId:'acct_SYNTHETIC',livemode:false,apiVersion:'2026-09-30.endive',verifiedBindingId:'SYNTHETIC_BOUND_MERCHANT'};
 const offer=offerFixture('prepay',NOW),line=offer.lines[0]!,due=line.dues[0]!,opId=randomUUID(),purchaseId=randomUUID();
 let context:StripeTestHostedContext={offer,purchaseLineId:line.id,operation:{id:opId,kind:'hosted_invoice',workspaceId:offer.workspaceId,purchaseId,dueId:due.id,refundPaymentId:null,providerAccountId:binding.accountId,livemode:false,amountCents:due.amountCents,currency:'USD',idempotencyKey:`rm:${offer.workspaceId}:${opId}`,state:'unknown',requestDigest:digest([offer.id,offer.revision,line.id,due]),result:null},customer:{bindingId:randomUUID(),revision:1,payerAccountId:offer.payerAccountId,customerId:'cus_SYNTHETIC',merchantBindingId:binding.verifiedBindingId,verifiedAt:new Date(NOW-1000).toISOString()},authorizationVersion:'a'.repeat(64),linkExpiresAt:offer.expiresAt,laterDuePolicy:null};
 const actor={workspaceId:offer.workspaceId,id:offer.operatorAccountId,role:'practitioner',sessionDigest:'SYNTHETIC_UNIT_SESSION'} as unknown as Actor;
 let revoked=false,now=NOW,inTransaction=false,knownId:string|null='in_SYNTHETIC';const dispatched=new Set<string>(),events:string[]=[];
 const native={actor:actor as unknown as NativeContext['actor'],now:new Date(now),tx:{query:vi.fn(async()=>[])}} as NativeContext;
 const cache=new Map<string,{hash:string;result:unknown}>(),commandResults:unknown[]=[];
 const read=vi.fn(async<T>(_actor:Actor,work:(c:NativeContext)=>Promise<T>)=>{
  inTransaction=true;events.push('transaction');try{return await work({...native,now:new Date(now)});}finally{inTransaction=false;events.push('commit');}
 });
 const store={deps:{merchant:binding,clock:{now:()=>new Date(now)},authority:{loadApprovedOffer:vi.fn(async()=>context.offer)}},read,
  command:vi.fn(async<T>(a:Actor,key:string,action:string,body:unknown,authorize:(c:NativeContext)=>Promise<void>,work:(c:NativeContext)=>Promise<T>)=>read(a,async c=>{
   await authorize(c);events.push('cache-lookup');const old=cache.get(action+key),hash=digest(body);if(old){if(old.hash!==hash)throw Error('COMMAND_CONFLICT');return old.result as T;}
   const result=await work(c);commandResults.push(result);cache.set(action+key,{hash,result});return result;
  })),
  operation:vi.fn(async()=>context.operation),purchase:vi.fn(async()=>({offer:context.offer,line:context.offer.lines[0]!,state:initialPayment(context.offer,context.offer.lines[0]!,purchaseId,binding)})),
  access:vi.fn(async()=>{if(revoked)throw Error('NOT_FOUND');}),assertHostedActivationAllowed:vi.fn(async()=>{}),loadOffer:vi.fn(async()=>({offer:context.offer,state:'approved'}))};
 const observation=(status:StripeTestHostedObservation['status']='draft'):StripeTestHostedObservation=>({contextDigest:digest(context),invoiceId:'in_SYNTHETIC',customerId:context.customer.customerId,status,hasLine:status!=='draft',amountDueCents:status==='draft'?0:due.amountCents,paidCents:status==='paid'?due.amountCents:0,remainingCents:status==='open'?due.amountCents:0,url:status==='open'?'https://invoice.stripe.com/i/SYNTHETIC':null});
 const coordinator:StripeTestHostedCoordinator={
  prepare:vi.fn(async()=>context),
  claim:vi.fn(async(_actor:Actor,_command:string,_op:string,phase:StripeTestHostedPhase)=>({id:'SYNTHETIC_PHASE_CLAIM',context,action:phase==='create'?{phase}:phase==='close'?{phase,invoiceId:'in_SYNTHETIC',closureDecisionId:'SYNTHETIC_OWNER_CLOSURE'}:{phase,invoiceId:'in_SYNTHETIC'}} as StripeTestHostedClaim)),
  consume:vi.fn(async(_actor:Actor,claim:StripeTestHostedClaim)=>{const key=claim.context.operation.id+claim.action.phase;if(dispatched.has(key))return false;dispatched.add(key);events.push('global-dispatch-consumed');return true;}),
  authorizeClosure:vi.fn(async()=>{expect(inTransaction).toBe(true);events.push('separate-closure-authority');}),
  inspectClosure:vi.fn(async()=>({id:'SYNTHETIC_PHASE_CLAIM',context,action:{phase:'close' as const,invoiceId:'in_SYNTHETIC',closureDecisionId:'SYNTHETIC_OWNER_CLOSURE'}})),
  observe:vi.fn(async()=>{expect(inTransaction).toBe(false);events.push('durable-observation');}),
  inspect:vi.fn(async()=>({context,invoiceId:knownId})),
  reconcile:vi.fn(async()=>{expect(inTransaction).toBe(true);events.push('reconciled-known-object');}),
  authorizePublication:vi.fn(async()=>{expect(inTransaction).toBe(true);events.push('publication-authorized');}),
  publish:vi.fn(async(_c:NativeContext,_context:StripeTestHostedContext,o:StripeTestHostedObservation):Promise<FamilyHostedAction>=>{expect(inTransaction).toBe(true);events.push('native-mappings-committed-with-result');return {purchaseId,dueIndex:1,state:'ready',url:o.url!};}),
 };
 const perform=vi.fn<StripeTestHostedDependencies['provider']['perform']>(async(_context,action)=>{
  expect(inTransaction).toBe(false);events.push('provider:'+action.phase);
  return observation(action.phase==='read'?'open':action.phase==='close'?'void':'draft');
 });
 const provider:StripeTestHostedDependencies['provider']={execution:'stripe_test_hosted_invoice',binding,perform};
 const service=new FishingPaymentService(store as unknown as FishingPaymentStore,{provider,coordinator});
 return {service,store,coordinator,provider,perform,actor,opId,purchaseId,due,events,commandResults,observation,getContext:()=>context,setContext:(c:StripeTestHostedContext)=>{context=c;},setKnown:(id:string|null)=>{knownId=id;},revoke:()=>{revoked=true;},advance:()=>{now=Date.parse(context.linkExpiresAt);},inTransaction:()=>inTransaction};
}

it('prepares only native records and returns no customer, provider object or URL',async()=>{
 const f=fixture();await expect(f.service.prepareStripeTestHosted(f.actor,'prepare',f.purchaseId,f.due.id)).resolves.toEqual({operationId:f.opId,state:'prepared'});expect(f.perform).not.toHaveBeenCalled();expect(f.store.assertHostedActivationAllowed).toHaveBeenCalled();
});
it('keeps synthetic methods and refund execution gated by their original provider',async()=>{
 const f=fixture();await expect(f.service.executeSynthetic(f.actor,'synthetic',f.opId)).rejects.toThrow('HOSTED_PROVIDER_UNAVAILABLE');await expect(f.service.approveRefund(f.actor,'refund',f.purchaseId,'preview')).rejects.toThrow('HOSTED_PROVIDER_UNAVAILABLE');expect(f.perform).not.toHaveBeenCalled();expect(f.coordinator.claim).not.toHaveBeenCalled();
});
it('uses UNKNOWN/global dispatch, no SQL lock over I/O, and observes before advancing',async()=>{
 const f=fixture(),result=await f.service.executeStripeTestHosted(f.actor,'create',f.opId,'create');expect(result).toEqual({state:'observed'});expect(JSON.stringify(result)).not.toContain('https:');
 expect(f.events.indexOf('global-dispatch-consumed')).toBeLessThan(f.events.indexOf('provider:create'));expect(f.events.indexOf('provider:create')).toBeLessThan(f.events.indexOf('durable-observation'));expect(f.perform).toHaveBeenCalledTimes(1);expect(f.coordinator.publish).not.toHaveBeenCalled();
});
it('replayed and different command IDs cannot redispatch the same claimed phase',async()=>{
 const f=fixture();await f.service.executeStripeTestHosted(f.actor,'same',f.opId,'create');await expect(f.service.executeStripeTestHosted(f.actor,'same',f.opId,'create')).resolves.toEqual({state:'not_claimed'});await expect(f.service.executeStripeTestHosted(f.actor,'different',f.opId,'create')).resolves.toEqual({state:'not_claimed'});expect(f.perform).toHaveBeenCalledTimes(1);
});
it('lost create response stays unknown; reconciliation without a saved ID cannot create/search',async()=>{
 const f=fixture();f.perform.mockRejectedValueOnce(Error('SYNTHETIC_PRIVATE_SDK_CAUSE'));await expect(f.service.executeStripeTestHosted(f.actor,'create',f.opId,'create')).resolves.toEqual({state:'unknown'});
 f.setKnown(null);await expect(f.service.reconcileStripeTestHosted(f.actor,'recover',f.opId)).resolves.toEqual({state:'unknown'});expect(f.perform).toHaveBeenCalledTimes(1);expect(f.coordinator.observe).not.toHaveBeenCalled();
});
it('failed observation persistence does not expose a link or automatically retry a phase',async()=>{
 const f=fixture();vi.mocked(f.coordinator.observe).mockRejectedValueOnce(Error('SYNTHETIC_COMMIT_REPLY_UNKNOWN'));await expect(f.service.executeStripeTestHosted(f.actor,'create',f.opId,'create')).resolves.toEqual({state:'unknown'});await expect(f.service.executeStripeTestHosted(f.actor,'retry',f.opId,'create')).resolves.toEqual({state:'not_claimed'});expect(f.perform).toHaveBeenCalledTimes(1);
});
it('known-object reconciliation only reads and records inside a freshly authorized transaction',async()=>{
 const f=fixture();await expect(f.service.reconcileStripeTestHosted(f.actor,'reconcile',f.opId)).resolves.toEqual({state:'observed'});expect(f.perform.mock.calls[0]![1]).toEqual({phase:'read',invoiceId:'in_SYNTHETIC'});expect(f.coordinator.reconcile).toHaveBeenCalledTimes(1);expect(f.coordinator.claim).not.toHaveBeenCalled();expect(f.coordinator.publish).not.toHaveBeenCalled();
});
it('reconciliation command persists a concrete JSON result when the coordinator returns void',async()=>{
 const f=fixture();vi.mocked(f.coordinator.reconcile).mockResolvedValue(undefined);
 await expect(f.service.reconcileStripeTestHosted(f.actor,'serializable-reconcile',f.opId)).resolves.toEqual({state:'observed'});
 expect(f.commandResults).toEqual([{state:'observed'}]);expect(JSON.stringify(f.commandResults[0])).toBe('{"state":"observed"}');
 await expect(f.service.reconcileStripeTestHosted(f.actor,'serializable-reconcile',f.opId)).resolves.toEqual({state:'observed'});
 expect(f.commandResults).toHaveLength(1);expect(f.coordinator.reconcile).toHaveBeenCalledTimes(1);
});
it('publishes only after known-invoice readback and the mapping transaction commits',async()=>{
 const f=fixture(),result=await f.service.familyStripeTestHostedAction(f.actor,'publish',f.opId);expect(result).toEqual({purchaseId:f.purchaseId,dueIndex:1,state:'ready',url:'https://invoice.stripe.com/i/SYNTHETIC'});
 expect(f.events.indexOf('provider:read')).toBeLessThan(f.events.indexOf('native-mappings-committed-with-result'));expect(f.events.at(-1)).toBe('commit');expect(Object.keys(result!).sort()).toEqual(['dueIndex','purchaseId','state','url']);
});
it('mapping transaction failure cannot return the observed hosted URL',async()=>{
 const f=fixture();vi.mocked(f.coordinator.publish).mockRejectedValueOnce(Error('SYNTHETIC_BINDING_COMMIT_FAILED'));await expect(f.service.familyStripeTestHostedAction(f.actor,'publish',f.opId)).rejects.toThrow('SYNTHETIC_BINDING_COMMIT_FAILED');expect(f.perform).toHaveBeenCalledTimes(1);
});
it('reauthorizes publication in the current transaction before returning a cached URL',async()=>{
 const f=fixture();const first=await f.service.familyStripeTestHostedAction(f.actor,'same-publish',f.opId);f.events.length=0;
 await expect(f.service.familyStripeTestHostedAction(f.actor,'same-publish',f.opId)).resolves.toEqual(first);
 expect(f.coordinator.authorizePublication).toHaveBeenCalledTimes(2);expect(f.coordinator.publish).toHaveBeenCalledTimes(1);expect(f.perform).toHaveBeenCalledTimes(2);
 expect(f.events.indexOf('publication-authorized')).toBeLessThan(f.events.indexOf('cache-lookup'));
});
it.each(['CLOSE_PENDING','CUSTOMER_REVOKED','LINK_POLICY_REVOKED'])('a cached URL cannot bypass fresh Root publication denial: %s',async reason=>{
 const f=fixture();await f.service.familyStripeTestHostedAction(f.actor,'same-publish',f.opId);f.events.length=0;
 vi.mocked(f.coordinator.authorizePublication).mockRejectedValueOnce(Error(reason));
 await expect(f.service.familyStripeTestHostedAction(f.actor,'same-publish',f.opId)).rejects.toThrow(reason);
 expect(f.coordinator.authorizePublication).toHaveBeenCalledTimes(2);expect(f.coordinator.publish).toHaveBeenCalledTimes(1);expect(f.events).not.toContain('cache-lookup');
});
it('revocation during provider read denies publication without weakening ordinary authority',async()=>{
 const f=fixture();f.perform.mockImplementationOnce(async()=>{expect(f.inTransaction()).toBe(false);f.revoke();return f.observation('open');});await expect(f.service.familyStripeTestHostedAction(f.actor,'publish',f.opId)).rejects.toThrow('NOT_FOUND');expect(f.coordinator.publish).not.toHaveBeenCalled();
});
it('revoked ordinary access denies issue and readback before another SDK call',async()=>{
 const f=fixture();f.revoke();await expect(f.service.executeStripeTestHosted(f.actor,'create',f.opId,'create')).rejects.toThrow('NOT_FOUND');await expect(f.service.reconcileStripeTestHosted(f.actor,'read',f.opId)).rejects.toThrow('NOT_FOUND');expect(f.perform).not.toHaveBeenCalled();
});
it('stale closure uses a distinct Root owner decision even after guardian revocation',async()=>{
 const f=fixture(),c=f.getContext(),op=c.operation;
 f.setContext({...c,operation:{...op,state:'confirmed',result:{kind:'hosted_invoice',providerObjectId:'in_SYNTHETIC',url:'https://invoice.stripe.com/i/SYNTHETIC',providerAccountId:op.providerAccountId,livemode:false,currency:'USD',amountCents:op.amountCents,purchaseId:op.purchaseId,dueId:op.dueId!,idempotencyKey:op.idempotencyKey}}});f.revoke();
 await expect(f.service.executeStripeTestHosted(f.actor,'close',f.opId,'close')).resolves.toEqual({state:'observed'});expect(f.coordinator.authorizeClosure).toHaveBeenCalledTimes(1);expect(f.store.access).not.toHaveBeenCalled();expect(f.perform.mock.calls[0]![1]).toMatchObject({phase:'close',closureDecisionId:'SYNTHETIC_OWNER_CLOSURE'});expect(f.coordinator.publish).not.toHaveBeenCalled();
});
it('denied distinct closure authority never reaches the provider',async()=>{
 const f=fixture(),c=f.getContext(),op=c.operation;
 f.setContext({...c,operation:{...op,state:'confirmed',result:{kind:'hosted_invoice',providerObjectId:'in_SYNTHETIC',url:'https://invoice.stripe.com/i/SYNTHETIC',providerAccountId:op.providerAccountId,livemode:false,currency:'USD',amountCents:op.amountCents,purchaseId:op.purchaseId,dueId:op.dueId!,idempotencyKey:op.idempotencyKey}}});
 vi.mocked(f.coordinator.authorizeClosure).mockRejectedValueOnce(Error('CLOSURE_EFFECT_NOT_ADMITTED'));await expect(f.service.executeStripeTestHosted(f.actor,'close',f.opId,'close')).rejects.toThrow('CLOSURE_EFFECT_NOT_ADMITTED');expect(f.perform).not.toHaveBeenCalled();
});
it('Root may close a known open invoice left UNKNOWN by failed mapping publication',async()=>{
 const f=fixture();f.revoke();await expect(f.service.executeStripeTestHosted(f.actor,'close-unknown',f.opId,'close')).resolves.toEqual({state:'observed'});expect(f.getContext().operation.state).toBe('unknown');expect(f.coordinator.authorizeClosure).toHaveBeenCalledTimes(1);expect(f.store.access).not.toHaveBeenCalled();expect(f.coordinator.publish).not.toHaveBeenCalled();
});
it('lost closure reply reconciles by known-ID GET after revocation without another void dispatch',async()=>{
 const f=fixture(),c=f.getContext(),op=c.operation;
 f.setContext({...c,operation:{...op,state:'confirmed',result:{kind:'hosted_invoice',providerObjectId:'in_SYNTHETIC',url:'https://invoice.stripe.com/i/SYNTHETIC',providerAccountId:op.providerAccountId,livemode:false,currency:'USD',amountCents:op.amountCents,purchaseId:op.purchaseId,dueId:op.dueId!,idempotencyKey:op.idempotencyKey}}});
 f.perform.mockRejectedValueOnce(Error('SYNTHETIC_VOID_REPLY_LOST'));await expect(f.service.executeStripeTestHosted(f.actor,'close',f.opId,'close')).resolves.toEqual({state:'unknown'});f.revoke();f.perform.mockResolvedValueOnce(f.observation('void'));
 await expect(f.service.reconcileStripeTestHostedClosure(f.actor,f.opId,'SYNTHETIC_OWNER_CLOSURE')).resolves.toEqual({state:'observed'});expect(f.perform.mock.calls[1]![1]).toEqual({phase:'read',invoiceId:'in_SYNTHETIC'});expect(f.coordinator.consume).toHaveBeenCalledTimes(1);expect(f.store.access).not.toHaveBeenCalled();expect(f.coordinator.publish).not.toHaveBeenCalled();
});
it('expired links, paid invoice and incorrect provider DTO never produce a family URL',async()=>{
 const expired=fixture();expired.advance();await expect(expired.service.familyStripeTestHostedAction(expired.actor,'expired',expired.opId)).rejects.toThrow('STRIPE_TEST_HOSTED_LINK_EXPIRED');expect(expired.perform).not.toHaveBeenCalled();
 const paid=fixture();paid.perform.mockResolvedValueOnce(paid.observation('paid'));await expect(paid.service.familyStripeTestHostedAction(paid.actor,'paid',paid.opId)).resolves.toBeNull();expect(paid.coordinator.publish).not.toHaveBeenCalled();
 const wrong=fixture();wrong.perform.mockResolvedValueOnce({...wrong.observation('open'),invoiceId:'in_OTHER'});await expect(wrong.service.familyStripeTestHostedAction(wrong.actor,'wrong',wrong.opId)).rejects.toThrow();expect(wrong.coordinator.publish).not.toHaveBeenCalled();
});
