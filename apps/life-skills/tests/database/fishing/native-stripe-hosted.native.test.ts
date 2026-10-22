/** Real disposable SQL and ordinary sessions; ALL provider observations and
 * admission/customer evidence here are synthetic. No SDK or network runs. */
import {randomUUID} from 'node:crypto';
import {afterEach,expect,test,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {programFixture,type ProgramFixture} from './native-program-fixture.ts';
import {NativeFishingProgram} from '../../../src/features/fishing/native-program.ts';
import {NativeStripeHostedCoordinator,type NativeStripeHostedPolicy} from '../../../src/features/fishing/native-stripe-hosted-bindings.ts';
import {FishingPaymentStore} from '../../../src/features/fishing-payments/store.ts';
import {FishingPaymentService} from '../../../src/features/fishing-payments/service.ts';
import {digest} from '../../../src/features/fishing-payments/domain.ts';
import type {StripeTestHostedBinding,StripeTestHostedProvider,StripeTestHostedAction,StripeTestHostedContext,StripeTestHostedObservation} from '../../../src/features/fishing-payments/ports.ts';
const fixtures:ProgramFixture[]=[];afterEach(async()=>{await Promise.all(fixtures.splice(0).map(f=>f.close()));});
async function fixture(){
 const f=await programFixture({termsDocument:'SYNTHETIC HOSTED TERMS ONLY',confirmation:{kind:'all_native_dues_paid'}});fixtures.push(f);await f.createPlan();const family=await f.family(),prepared=await f.prepare(family,'installments');
 const merchant:StripeTestHostedBinding={...f.merchant,livemode:false,apiVersion:'2026-09-30.endive'},program=new NativeFishingProgram(f.db,f.ring,{childAccountsEnabled:false,merchant}),store=new FishingPaymentStore({database:f.db,clock:{now:()=>new Date()},merchant,authority:{...program.paymentApprovalAuthority(),withdrawalFacts:async()=>{throw Error('POLICY_REQUIRED');},reminderPolicy:async()=>{throw Error('POLICY_REQUIRED');}}});
 const bindingId=randomUUID(),customerId='cus_SYNTHETIC_'+randomUUID().replaceAll('-',''),invoiceId='in_SYNTHETIC_'+randomUUID().replaceAll('-','');
 await f.pool.query("INSERT INTO ls_fishing_payments.customer_bindings(workspace_id,id,revision,payer_account_id,provider_account_id,livemode,customer_id,merchant_binding_id,api_version,provenance_reference,verified_at) VALUES($1,$2,1,$3,$4,false,$5,$6,$7,'SYNTHETIC_NOT_PROVIDER_VERIFIED',clock_timestamp()-interval '1 minute')",[f.workspaceId,bindingId,family.parent.id,merchant.accountId,customerId,merchant.verifiedBindingId,merchant.apiVersion]);
 let admitted=true,closure=false,revision='a'.repeat(64),status:StripeTestHostedObservation['status']='draft',hasLine=false;let laterDuePolicy:StripeTestHostedContext['laterDuePolicy']=null;
 const policy:NativeStripeHostedPolicy={hosted:async(_c,p)=>{if(!admitted)throw Error('NO_SYNTHETIC_ADMISSION');return {revision,linkExpiresAt:p.offer.expiresAt,laterDuePolicy};},closure:async()=>{if(!closure)throw Error('NO_SYNTHETIC_CLOSURE');return {decisionId:'SYNTHETIC_OWNER_CLOSURE',revision:'c'.repeat(64)};}};
 const coordinator=new NativeStripeHostedCoordinator(store,program,policy),calls:StripeTestHostedAction[]=[],lost=new Set<string>();let hook:((context:StripeTestHostedContext,action:StripeTestHostedAction)=>Promise<void>)|null=null;
 const provider:StripeTestHostedProvider={execution:'stripe_test_hosted_invoice',binding:merchant,perform:async(c,a)=>{
  calls.push(structuredClone(a));if(a.phase==='create'){status='draft';hasLine=false;}if(a.phase==='add_line')hasLine=true;if(a.phase==='finalize')status='open';if(a.phase==='close')status='void';if(hook)await hook(c,a);if(lost.delete(a.phase))throw Error('SYNTHETIC_LOST_REPLY');
  return {contextDigest:digest(c),invoiceId,customerId,status,hasLine,amountDueCents:hasLine?c.operation.amountCents:0,paidCents:0,remainingCents:status==='void'?0:hasLine?c.operation.amountCents:0,url:status==='open'?'https://invoice.stripe.com/i/SYNTHETIC_'+c.operation.id:null};
 }};
 const payments=new FishingPaymentService(store,{provider,coordinator}),purchase=(await store.readPayment(f.owner,prepared.purchaseId))!,dueId=purchase.dues[0]!.id;
 const prepare=(key=randomUUID())=>payments.prepareStripeTestHosted(family.parent,key,prepared.purchaseId,dueId),phase=(id:string,p:Exclude<StripeTestHostedAction['phase'],'read'>,actor=family.parent,key=randomUUID())=>payments.executeStripeTestHosted(actor,key,id,p),publish=(id:string,key=randomUUID())=>payments.familyStripeTestHostedAction(family.parent,key,id);
 const all=async()=>{const {operationId}=await prepare();for(const p of ['create','add_line','finalize'] as const)expect(await phase(operationId,p)).toEqual({state:'observed'});return operationId;};
 const protectedRows=async()=>Promise.all(['ls_fishing_payments.purchases','ls_fishing_payments.inbox','ls_fishing_payments.settlements','ls_fishing_stage.enrollments','ls_payments.charges','ls_payments.credit_events','ls_calendar.tasks','ls_contact_ops.outbound_projections','ls_identity.auth_mail_outbox'].map(async table=>({table,rows:(await f.pool.query(`SELECT to_jsonb(t) AS row FROM ${table} t WHERE ${table==='ls_fishing_payments.inbox'?'provider_account_id':'workspace_id'}=$1 ORDER BY to_jsonb(t)::text`,[table==='ls_fishing_payments.inbox'?f.merchant.accountId:f.workspaceId])).rows})));
 const revokeGuardian=()=>f.pool.query('UPDATE ls_education.guardian_authorities SET active=false WHERE workspace_id=$1 AND learner_id=$2',[f.workspaceId,family.learnerId]);
 return {...f,createFamily:f.family,family,prepared,merchant,program,store,coordinator,provider,payments,bindingId,invoiceId,dueId,calls,lost,prepare,phase,publish,all,protectedRows,revokeGuardian,admit:(v:boolean)=>{admitted=v;},closeAllowed:()=>{closure=true;},changePolicy:()=>{revision='b'.repeat(64);},laterPolicy:(value:StripeTestHostedContext['laterDuePolicy'])=>{laterDuePolicy=value;},hook:(value:typeof hook)=>{hook=value;}};
}

test('native phase receipts commit between effects, concurrent retries dispatch once, mappings precede ordinary family URL and no cash/enrollment/send is written',async()=>{
 const f=await fixture(),before=await f.protectedRows(),prepareKey=randomUUID(),{operationId}=await f.prepare(prepareKey);
 for(const p of ['create','add_line','finalize'] as const){const key=randomUUID(),results=await Promise.all(Array.from({length:4},()=>f.phase(operationId,p,f.family.parent,key)));expect(results.filter(r=>r.state==='observed')).toHaveLength(1);expect(f.calls.filter(c=>c.phase===p)).toHaveLength(1);expect((await f.pool.query("SELECT result_json FROM ls_fishing_payments.commands WHERE workspace_id=$1 AND action='stripe-test.hosted.observation' AND command_id=$2",[f.workspaceId,operationId+':'+p])).rows).toHaveLength(1);expect((await f.prepare(prepareKey)).operationId).toBe(operationId);}
 expect((await f.pool.query('SELECT id FROM ls_fishing_payments.object_bindings WHERE workspace_id=$1',[f.workspaceId])).rows).toEqual([]);const key=randomUUID(),ready=await f.publish(operationId,key);expect(ready).toEqual({purchaseId:f.prepared.purchaseId,dueIndex:1,state:'ready',url:'https://invoice.stripe.com/i/SYNTHETIC_'+operationId});expect(await f.publish(operationId,key)).toEqual(ready);
 expect((await f.pool.query('SELECT invoice_id,object_kind FROM ls_fishing_payments.object_bindings WHERE workspace_id=$1',[f.workspaceId])).rows).toEqual([{invoice_id:f.invoiceId,object_kind:'invoice'}]);const op=(await f.store.read(f.owner,c=>f.store.operation(c,operationId)));expect(op.state).toBe('confirmed');expect(Object.keys(op).sort()).toEqual(['id','kind','workspaceId','purchaseId','dueId','refundPaymentId','providerAccountId','livemode','amountCents','currency','idempotencyKey','state','requestDigest','result'].sort());expect(op.amountCents).toBe(65000);expect((await f.prepare(prepareKey)).operationId).toBe(operationId);expect(await f.protectedRows()).toEqual(before);
});

test('lost create without durably known ID stays UNKNOWN across fresh commands, never searches or recreates',async()=>{
 const f=await fixture(),{operationId}=await f.prepare();f.lost.add('create');expect(await f.phase(operationId,'create')).toEqual({state:'unknown'});expect(await f.phase(operationId,'create')).toEqual({state:'not_claimed'});expect(await f.payments.reconcileStripeTestHosted(f.family.parent,randomUUID(),operationId)).toEqual({state:'unknown'});await expect(f.phase(operationId,'add_line')).rejects.toThrow();expect(await f.publish(operationId)).toBeNull();expect(f.calls.map(c=>c.phase)).toEqual(['create']);expect((await f.prepare()).operationId).toBe(operationId);expect((await f.store.read(f.owner,c=>f.store.operation(c,operationId))).state).toBe('unknown');
});

test('lost add-line and finalize replies recover only the durably known invoice by GET without repeating either mutation',async()=>{
 const f=await fixture(),{operationId}=await f.prepare();await f.phase(operationId,'create');for(const p of ['add_line','finalize'] as const){f.lost.add(p);expect(await f.phase(operationId,p)).toEqual({state:'unknown'});expect(await f.phase(operationId,p)).toEqual({state:'not_claimed'});expect(await f.payments.reconcileStripeTestHosted(f.family.parent,randomUUID(),operationId)).toEqual({state:'observed'});}expect((await f.publish(operationId))?.state).toBe('ready');expect(f.calls.map(c=>c.phase)).toEqual(['create','add_line','read','finalize','read','read']);
});

test('cached publication rechecks close-pending and immutable mapping revocation before returning a URL',async()=>{
 const f=await fixture(),op=await f.all(),key=randomUUID();expect((await f.publish(op,key))?.state).toBe('ready');f.closeAllowed();await f.coordinator.claim(f.owner,randomUUID(),op,'close');await expect(f.publish(op,key)).rejects.toThrow();expect(f.calls.filter(c=>c.phase==='close')).toEqual([]);
 const g=await fixture(),other=await g.all(),otherKey=randomUUID();await g.publish(other,otherKey);await g.pool.query('UPDATE ls_fishing_payments.object_bindings SET revoked_at=clock_timestamp(),revision=revision+1 WHERE workspace_id=$1',[g.workspaceId]);await expect(g.publish(other,otherKey)).rejects.toThrow();
});

test('guardian/customer revocation and inactive cohort block cached family URL but separate owner cleanup can reconcile a lost void reply',async()=>{
 const f=await fixture(),op=await f.all(),key=randomUUID();await f.publish(op,key);await f.revokeGuardian();await f.pool.query('UPDATE ls_fishing_payments.customer_bindings SET revoked_at=clock_timestamp(),revision=revision+1 WHERE workspace_id=$1',[f.workspaceId]);await f.pool.query('UPDATE ls_fishing_stage.cohorts SET active=false WHERE workspace_id=$1',[f.workspaceId]);await expect(f.publish(op,key)).rejects.toThrow();await expect(f.phase(op,'close',f.owner)).rejects.toThrow();f.closeAllowed();f.lost.add('close');expect(await f.phase(op,'close',f.owner)).toEqual({state:'unknown'});expect(await f.payments.reconcileStripeTestHostedClosure(f.owner,op,'SYNTHETIC_OWNER_CLOSURE')).toEqual({state:'observed'});expect(await f.phase(op,'close',f.owner)).toEqual({state:'not_claimed'});expect(f.calls.filter(c=>c.phase==='close')).toHaveLength(1);await expect(f.payments.reconcileStripeTestHostedClosure(f.family.parent,op,'SYNTHETIC_OWNER_CLOSURE')).rejects.toThrow();expect((await f.store.read(f.owner,c=>f.store.operation(c,op))).state).toBe('confirmed');
});

test('fresh policy, fit, customer and actual ordinary-family authority gate each phase and all cached preparations',async()=>{
 const f=await fixture(),prepareKey=randomUUID(),{operationId}=await f.prepare(prepareKey),other=await f.createFamily();await expect(f.payments.prepareStripeTestHosted(other.parent,randomUUID(),f.prepared.purchaseId,f.dueId)).rejects.toThrow();f.admit(false);await expect(f.phase(operationId,'create')).rejects.toThrow();f.admit(true);f.changePolicy();await expect(f.phase(operationId,'create')).rejects.toThrow();await expect(f.prepare(prepareKey)).rejects.toThrow();expect(f.calls).toEqual([]);
 const g=await fixture(),op=(await g.prepare()).operationId;await g.program.recordFit(g.owner,{commandId:randomUUID(),id:randomUUID(),stageId:g.ref.stageId,learnerId:g.family.learnerId,purpose:'enrollment',decision:'rejected',targetOccurrenceId:null,targetRevision:null,note:'PRIVATE_NEW_REVIEW'});await expect(g.phase(op,'create')).rejects.toThrow();expect(g.calls).toEqual([]);
});

test('observation retains a known ID after in-flight guardian revocation without granting URL or another phase',async()=>{
 const f=await fixture(),{operationId}=await f.prepare();f.hook(async(_c,a)=>{if(a.phase==='create')await f.revokeGuardian();});expect(await f.phase(operationId,'create')).toEqual({state:'observed'});expect((await f.pool.query("SELECT result_json->>'invoiceId' AS invoice FROM ls_fishing_payments.commands WHERE workspace_id=$1 AND action='stripe-test.hosted.observation'",[f.workspaceId])).rows).toEqual([{invoice:f.invoiceId}]);await expect(f.phase(operationId,'add_line')).rejects.toThrow();await expect(f.publish(operationId)).rejects.toThrow();expect(f.calls.map(c=>c.phase)).toEqual(['create']);
});

test('no default admission and no invented later-installment expiry policy can prepare a hosted operation',async()=>{
 const f=await fixture(),coordinator=new NativeStripeHostedCoordinator(f.store,f.program);await expect(coordinator.prepare(f.family.parent,randomUUID(),f.prepared.purchaseId,f.dueId)).rejects.toThrow();const state=(await f.store.readPayment(f.owner,f.prepared.purchaseId))!;await expect(f.payments.prepareStripeTestHosted(f.family.parent,randomUUID(),f.prepared.purchaseId,state.dues[1]!.id)).rejects.toThrow();f.laterPolicy({id:'SYNTHETIC_APPROVED_LATER_POLICY',revision:1,sourceVersion:'SYNTHETIC_ONLY'});expect((await f.payments.prepareStripeTestHosted(f.family.parent,randomUUID(),f.prepared.purchaseId,state.dues[1]!.id)).state).toBe('prepared');expect(f.calls).toEqual([]);
});
