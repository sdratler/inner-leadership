import 'server-only';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {asId} from '../../lib/ids.ts';
import {lockWorkspace} from '../identity/data.ts';
import type {Actor} from '../identity/types.ts';
import type {SqlSession} from '../identity/store.ts';
import {one} from '../identity/store.ts';
import {digest,invariant,type FamilyHostedAction} from '../fishing-payments/domain.ts';
import {FishingPaymentStore} from '../fishing-payments/store.ts';
import type {NativeContext,PurchaseRecord,ProviderOperation,StripeTestHostedBinding,StripeTestHostedContext,StripeTestHostedClaim,StripeTestHostedObservation,StripeTestHostedPhase,StripeTestHostedCoordinator} from '../fishing-payments/ports.ts';
import {validateStripeTestHostedContext,validateStripeTestHostedObservation} from '../fishing-payments/stripe-test-hosted-provider.ts';
import {NativeFishingProgram} from './native-program.ts';

const opaque=z.string().regex(/^[A-Za-z0-9_.:-]{1,160}$/),sha=z.string().regex(/^[a-f0-9]{64}$/),uuid=z.uuid(),instant=z.iso.datetime({offset:true}),pid=(p:string)=>z.string().regex(new RegExp(`^${p}_[A-Za-z0-9_]{1,150}$`));
const bindingSchema=z.strictObject({accountId:pid('acct'),livemode:z.literal(false),apiVersion:z.literal('2026-09-30.endive'),verifiedBindingId:opaque});
const laterDuePolicySchema=z.strictObject({id:opaque,revision:z.number().int().positive(),sourceVersion:opaque});
const admissionSchema=z.strictObject({revision:sha,linkExpiresAt:instant,laterDuePolicy:laterDuePolicySchema.nullable()}),closureSchema=z.strictObject({decisionId:opaque,revision:sha});
const customerSchema=z.object({id:uuid,revision:z.number().int().positive(),payerAccountId:uuid,customerId:pid('cus'),merchantBindingId:opaque,apiVersion:z.literal('2026-09-30.endive'),verifiedAt:z.date(),revokedAt:z.date().nullable()});
const resultSchema=z.strictObject({kind:z.literal('hosted_invoice'),providerObjectId:pid('in'),url:z.url().max(2048),providerAccountId:pid('acct'),livemode:z.literal(false),currency:z.literal('USD'),amountCents:z.number().int().positive(),purchaseId:uuid,dueId:opaque,idempotencyKey:opaque});
const operationSchema=z.strictObject({id:uuid,kind:z.literal('hosted_invoice'),workspaceId:uuid,purchaseId:uuid,dueId:opaque,refundPaymentId:z.null(),providerAccountId:pid('acct'),livemode:z.literal(false),amountCents:z.number().int().positive().max(100000000),currency:z.literal('USD'),idempotencyKey:opaque,state:z.enum(['reserved','unknown','confirmed']),requestDigest:sha,result:resultSchema.nullable()});
const actionSchema=z.discriminatedUnion('phase',[z.strictObject({phase:z.literal('create')}),z.strictObject({phase:z.literal('add_line'),invoiceId:pid('in')}),z.strictObject({phase:z.literal('finalize'),invoiceId:pid('in')}),z.strictObject({phase:z.literal('close'),invoiceId:pid('in'),closureDecisionId:opaque})]);
const claimSchema=z.strictObject({id:uuid,context:z.unknown(),action:actionSchema});
const customerColumns='id,revision,payer_account_id AS "payerAccountId",customer_id AS "customerId",merchant_binding_id AS "merchantBindingId",api_version AS "apiVersion",verified_at AS "verifiedAt",revoked_at AS "revokedAt"';
const actions={intent:'stripe-test.hosted.intent',phase:'stripe-test.hosted.phase',observation:'stripe-test.hosted.observation',read:'stripe-test.hosted.read',published:'stripe-test.hosted.published',closure:'stripe-test.hosted.closure-authority'} as const;
type Purpose='prepare'|'dispatch'|'inspect'|'publish';
type Customer=z.infer<typeof customerSchema>;
export interface NativeStripeHostedPolicy{
 /** Trusted Root server capability. Independently verified merchant/account,
  * explicit effect admission and actual approved expiry are required. There is
  * no flag/marker/default or invented later-installment grace policy here. */
 hosted(c:NativeContext,purchase:PurchaseRecord,customer:Customer,purpose:Purpose,dueId:string):Promise<z.infer<typeof admissionSchema>>;
 /** Separate explicit operator decision/effect admission for this known
  * invoice. It may permit closure after guardian/customer revocation, not a new
  * charge, refund, recreated invoice or family-access grant. */
 closure(c:NativeContext,purchase:PurchaseRecord,invoiceId:string,customer:Customer):Promise<z.infer<typeof closureSchema>>;
}
type StoredJournal={actorId:string;value:unknown;hash:string;at:Date};
/** No SDK, environment, secrets, scheduling or new tables. Provider phase
 * observations use existing immutable-by-command PAY receipts; the legacy
 * operation_json shape stays exact for the reviewed native receipt resolver. */
export class NativeStripeHostedCoordinator implements StripeTestHostedCoordinator{
 readonly #binding:StripeTestHostedBinding;
 constructor(private readonly store:FishingPaymentStore,private readonly program:NativeFishingProgram,private readonly policy:NativeStripeHostedPolicy|null=null){this.#binding=Object.freeze(bindingSchema.parse(store.deps.merchant));}
 private async journal(tx:SqlSession,workspace:string,action:string,key:string):Promise<StoredJournal|null>{
  const rows=await tx.query<{actorId:string;value:unknown;hash:string;at:Date}>(`SELECT actor_id AS "actorId",result_json AS value,digest AS hash,created_at AS at FROM ls_fishing_payments.commands WHERE workspace_id=$1 AND action=$2 AND command_id=$3 AND octet_length(result_json::text)<=131072 ORDER BY actor_id LIMIT 2 FOR SHARE`,[workspace,action,key]);invariant(rows.length<=1,'CONFLICT');const row=rows[0];if(!row)return null;invariant(digest(row.value)===row.hash&&row.at instanceof Date,'UNAVAILABLE');return row;
 }
 private async save(c:{tx:SqlSession;actor:{id:string;workspaceId:string};now:Date},action:string,key:string,value:unknown){
  opaque.parse(key);invariant(Buffer.byteLength(JSON.stringify(value))<=131072,'UNAVAILABLE');const old=await this.journal(c.tx,c.actor.workspaceId,action,key);if(old){invariant(old.hash===digest(value),'CONFLICT');return;}
  await c.tx.query('INSERT INTO ls_fishing_payments.commands(workspace_id,actor_id,action,command_id,digest,result_json,created_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)',[c.actor.workspaceId,c.actor.id,action,key,digest(value),JSON.stringify(value),c.now]);
 }
 private async operation(c:NativeContext,id:string){
  const row=await one<{purchaseId:string;kind:string;dueId:string;hash:string;value:unknown}>(c.tx,'SELECT purchase_id AS "purchaseId",kind,due_id AS "dueId",request_digest AS hash,operation_json AS value FROM ls_fishing_payments.operations WHERE workspace_id=$1 AND id=$2 AND octet_length(operation_json::text)<=131072 FOR UPDATE',[c.actor.workspaceId,uuid.parse(id)]);invariant(row,'NOT_FOUND');const op=operationSchema.parse(row.value);invariant(op.workspaceId===c.actor.workspaceId&&op.id===id&&op.purchaseId===row.purchaseId&&op.kind===row.kind&&op.dueId===row.dueId&&op.requestDigest===row.hash&&op.providerAccountId===this.#binding.accountId,'CONFLICT');return op;
 }
 private async customer(c:NativeContext,p:PurchaseRecord,historicalId?:string){
  const rows=await c.tx.query(`SELECT ${customerColumns} FROM ls_fishing_payments.customer_bindings WHERE workspace_id=$1 AND payer_account_id=$2 AND provider_account_id=$3 AND livemode=false AND ${historicalId?'id=$4':'revoked_at IS NULL'} ORDER BY id LIMIT 2 FOR SHARE`,historicalId?[c.actor.workspaceId,p.offer.payerAccountId,this.#binding.accountId,uuid.parse(historicalId)]:[c.actor.workspaceId,p.offer.payerAccountId,this.#binding.accountId]);invariant(rows.length===1,'APPROVAL_REQUIRED');const customer=customerSchema.parse(rows[0]);invariant(customer.verifiedAt<=c.now&&customer.merchantBindingId===this.#binding.verifiedBindingId&&customer.apiVersion===this.#binding.apiVersion&&(!customer.revokedAt||!!historicalId),'APPROVAL_REQUIRED');return customer;
 }
 private async payable(c:NativeContext,p:PurchaseRecord,op:Pick<ProviderOperation,'dueId'|'amountCents'>){
  await this.store.access(c,p.offer,'hosted');await this.store.assertHostedActivationAllowed(c,p.offer);const due=p.state.dues.find(d=>d.id===op.dueId);invariant(due&&due.paidCents===0&&p.state.providerAccountId===this.#binding.accountId&&!p.state.livemode&&op.amountCents===due.amountCents,'DUE_NOT_PAYABLE');const issued=await this.store.loadOffer(c,p.offer.id);invariant(issued.state==='approved','OFFER_CANCELLED');if(due.index===1||p.state.dues[0]?.state!=='paid')invariant(Date.parse(p.offer.expiresAt)>c.now.valueOf(),'OFFER_EXPIRED');return due;
 }
 private async context(c:NativeContext,operationId:string,purpose:Purpose|'close'){
  const op=await this.operation(c,operationId),p=await this.store.purchase(c,op.purchaseId),intent=await this.journal(c.tx,c.actor.workspaceId,actions.intent,op.id);invariant(intent,'APPROVAL_REQUIRED');const old=validateStripeTestHostedContext(intent.value,this.#binding);invariant(old.operation.id===op.id&&old.operation.purchaseId===p.state.purchaseId&&old.purchaseLineId===p.line.id&&digest(old.offer)===digest(p.offer),'CONFLICT');
  const customer=await this.customer(c,p,purpose==='close'?old.customer.bindingId:undefined);invariant(customer.id===old.customer.bindingId&&customer.customerId===old.customer.customerId,'CONFLICT');invariant(this.policy,'APPROVAL_REQUIRED');let admission:z.infer<typeof admissionSchema>;
  if(purpose==='close'){await this.program.stripeHostedClosureOfferInTransaction(c,p.offer.id);admission={revision:old.authorizationVersion,linkExpiresAt:old.linkExpiresAt,laterDuePolicy:old.laterDuePolicy};}
  else{if(purpose==='dispatch'||purpose==='publish'||purpose==='prepare')await this.payable(c,p,op);else await this.store.access(c,p.offer,'read');admission=admissionSchema.parse(await this.policy.hosted(c,p,customer,purpose,op.dueId!));invariant(admission.linkExpiresAt===old.linkExpiresAt,'CONFLICT');}
  const context=validateStripeTestHostedContext({offer:p.offer,purchaseLineId:p.line.id,operation:op,customer:{bindingId:customer.id,revision:customer.revision,payerAccountId:customer.payerAccountId,customerId:customer.customerId,merchantBindingId:customer.merchantBindingId,verifiedAt:customer.verifiedAt.toISOString()},authorizationVersion:purpose==='close'?old.authorizationVersion:digest({admission,customer:{id:customer.id,revision:customer.revision},offer:digest(p.offer),operation:op.requestDigest}),linkExpiresAt:admission.linkExpiresAt,laterDuePolicy:admission.laterDuePolicy},this.#binding);
  if(purpose!=='close')invariant(context.authorizationVersion===old.authorizationVersion,'CONFLICT');
  if(purpose==='prepare'||purpose==='dispatch'||purpose==='publish')invariant(!await this.journal(c.tx,c.actor.workspaceId,actions.phase,op.id+':close'),'APPROVAL_REQUIRED');
  return {context,purchase:p,customer};
 }
 private async known(c:NativeContext,opId:string){
  let id:string|null=null;for(const phase of ['create','add_line','finalize','close'] as const){const saved=await this.journal(c.tx,c.actor.workspaceId,actions.observation,opId+':'+phase);if(saved){const object=z.object({invoiceId:pid('in')}).parse(saved.value);invariant(id===null||id===object.invoiceId,'CONFLICT');id=object.invoiceId;}}return id;
 }
 async prepare(actor:Actor,commandId:string,purchaseId:string,dueId:string):Promise<StripeTestHostedContext>{
  const prepared=await this.store.command(actor,commandId,'stripe-test.hosted.prepare',{purchaseId,dueId},async c=>{const p=await this.store.purchase(c,purchaseId),due=p.state.dues.find(d=>d.id===dueId);invariant(due&&this.policy,'APPROVAL_REQUIRED');await this.payable(c,p,{dueId,amountCents:due.amountCents});const customer=await this.customer(c,p),admission=admissionSchema.parse(await this.policy.hosted(c,p,customer,'prepare',dueId));invariant(Date.parse(admission.linkExpiresAt)>c.now.valueOf(),'OFFER_EXPIRED');},async c=>{
   const rows=await c.tx.query<{id:string}>("SELECT id FROM ls_fishing_payments.operations WHERE workspace_id=$1 AND purchase_id=$2 AND due_id=$3 AND kind='hosted_invoice' FOR UPDATE",[c.actor.workspaceId,purchaseId,dueId]);invariant(rows.length<=1,'UNAVAILABLE');if(rows[0])return (await this.context(c,rows[0].id,'prepare')).context;
   const p=await this.store.purchase(c,purchaseId),due=p.state.dues.find(d=>d.id===dueId);invariant(due&&due.paidCents===0&&p.state.providerAccountId===this.#binding.accountId&&!p.state.livemode,'DUE_NOT_PAYABLE');const customer=await this.customer(c,p);invariant(this.policy,'APPROVAL_REQUIRED');const admission=admissionSchema.parse(await this.policy.hosted(c,p,customer,'prepare',dueId));invariant(Date.parse(admission.linkExpiresAt)>c.now.valueOf(),'OFFER_EXPIRED');
   const operation:ProviderOperation={id:randomUUID(),kind:'hosted_invoice',workspaceId:c.actor.workspaceId,purchaseId,dueId,refundPaymentId:null,providerAccountId:this.#binding.accountId,livemode:false,currency:'USD',amountCents:due.amountCents,idempotencyKey:'',state:'reserved',requestDigest:digest([p.offer.id,p.offer.revision,p.line.id,due]),result:null};const op={...operation,idempotencyKey:`rm:${operation.workspaceId}:${operation.id}`};await this.payable(c,p,op);
   const prepared=validateStripeTestHostedContext({offer:p.offer,purchaseLineId:p.line.id,operation:op,customer:{bindingId:customer.id,revision:customer.revision,payerAccountId:customer.payerAccountId,customerId:customer.customerId,merchantBindingId:customer.merchantBindingId,verifiedAt:customer.verifiedAt.toISOString()},authorizationVersion:digest({admission,customer:{id:customer.id,revision:customer.revision},offer:digest(p.offer),operation:op.requestDigest}),linkExpiresAt:admission.linkExpiresAt,laterDuePolicy:admission.laterDuePolicy},this.#binding);
   await c.tx.query('INSERT INTO ls_fishing_payments.operations(workspace_id,id,purchase_id,kind,due_id,request_digest,operation_json) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)',[c.actor.workspaceId,op.id,purchaseId,op.kind,dueId,op.requestDigest,JSON.stringify(op)]);await this.save(c,actions.intent,op.id,prepared);await this.store.event(c,'operation.reserved',op.id,1);return prepared;
  });
  // The receipt preserves the original result. Current state and authority
  // must be reloaded even when that receipt was created before a later phase.
  return this.store.read(actor,async c=>{await lockWorkspace(c.tx,c.actor.workspaceId);return (await this.context(c,prepared.operation.id,'prepare')).context;});
 }
 async claim(actor:Actor,commandId:string,operationId:string,phase:StripeTestHostedPhase):Promise<StripeTestHostedClaim|null>{
  return this.store.command(actor,commandId,'stripe-test.hosted.claim.request',{operationId,phase},async c=>{await this.context(c,operationId,phase==='close'?'close':'dispatch');},async c=>{
   const current=await this.context(c,operationId,phase==='close'?'close':'dispatch');let context=current.context;const {purchase,customer}=current,key=operationId+':'+phase,old=await this.journal(c.tx,c.actor.workspaceId,actions.phase,key);if(old)return this.parseClaim(old.value);
   const known=await this.known(c,operationId);let action:StripeTestHostedClaim['action'];
   if(phase==='create'){invariant(context.operation.state==='reserved'&&!known,'CONFLICT');const next={...context.operation,state:'unknown' as const};await c.tx.query('UPDATE ls_fishing_payments.operations SET operation_json=$3::jsonb WHERE workspace_id=$1 AND id=$2',[c.actor.workspaceId,operationId,JSON.stringify(next)]);context={...context,operation:next};action={phase:'create'};}
   else if(phase==='close'){invariant(known&&context.operation.state!=='reserved'&&(!context.operation.result||context.operation.result.providerObjectId===known)&&this.policy,'CONFLICT');const decision=closureSchema.parse(await this.policy.closure(c,purchase,known,customer));await this.save(c,actions.closure,operationId,{...decision,invoiceId:known});action={phase:'close',invoiceId:known,closureDecisionId:decision.decisionId};}
   else{invariant(known&&context.operation.state==='unknown','CONFLICT');const prior=await this.journal(c.tx,c.actor.workspaceId,actions.observation,operationId+':'+(phase==='add_line'?'create':'add_line'));invariant(prior,'CONFLICT');const observed=validateStripeTestHostedObservation(prior.value,context,known);invariant(observed.status==='draft'&&observed.hasLine===(phase==='finalize'),'CONFLICT');action={phase,invoiceId:known};}
   const claim={id:randomUUID(),context,action};await this.save(c,actions.phase,key,claim);return claim;
  });
 }
 private parseClaim(raw:unknown):StripeTestHostedClaim{const parsed=claimSchema.parse(raw);return {...parsed,context:validateStripeTestHostedContext(parsed.context,this.#binding)};}
 async consume(actor:Actor,claim:StripeTestHostedClaim){
  return this.store.read(actor,async c=>{await lockWorkspace(c.tx,c.actor.workspaceId);const saved=await this.journal(c.tx,c.actor.workspaceId,actions.phase,claim.context.operation.id+':'+claim.action.phase);invariant(saved&&saved.hash===digest(claim),'CONFLICT');if(claim.action.phase==='close')await this.authorizeClosure(c,claim);else{const current=await this.context(c,claim.context.operation.id,'dispatch');invariant(digest(current.context)===digest(claim.context),'CONFLICT');}
   const topic=claim.action.phase==='create'?'operation.dispatch':'stripe-test.hosted.'+claim.action.phase+'.dispatch',rows=await c.tx.query('INSERT INTO ls_fishing_payments.outbox(id,workspace_id,topic,aggregate_id,revision,recorded_at) VALUES($1,$2,$3,$4,1,$5) ON CONFLICT DO NOTHING RETURNING id',[randomUUID(),c.actor.workspaceId,topic,claim.context.operation.id,c.now]);return rows.length===1;
  });
 }
 async observe(raw:StripeTestHostedClaim,observation:StripeTestHostedObservation){
  const claim=this.parseClaim(raw),workspace=asId(claim.context.operation.workspaceId,'workspace');await this.store.deps.database.transaction(async tx=>{await lockWorkspace(tx,workspace);const key=claim.context.operation.id+':'+claim.action.phase,saved=await this.journal(tx,workspace,actions.phase,key);invariant(saved&&saved.hash===digest(claim),'CONFLICT');const topic=claim.action.phase==='create'?'operation.dispatch':'stripe-test.hosted.'+claim.action.phase+'.dispatch',fence=await one(tx,'SELECT id FROM ls_fishing_payments.outbox WHERE workspace_id=$1 AND topic=$2 AND aggregate_id=$3 AND revision=1 FOR SHARE',[workspace,topic,claim.context.operation.id]);invariant(fence,'CONFLICT');const checked=validateStripeTestHostedObservation(observation,claim.context,'invoiceId'in claim.action?claim.action.invoiceId:undefined);
   if(claim.action.phase==='create')invariant(checked.status==='draft'&&!checked.hasLine,'CONFLICT');if(claim.action.phase==='add_line')invariant(checked.status==='draft'&&checked.hasLine,'CONFLICT');if(claim.action.phase==='finalize')invariant(checked.status==='open'&&checked.hasLine&&checked.url,'CONFLICT');if(claim.action.phase==='close')invariant(checked.status==='void'||checked.status==='paid','CONFLICT');await this.save({tx,actor:{id:saved.actorId,workspaceId:workspace},now:this.store.deps.clock.now()},actions.observation,key,checked);
  });
 }
 async inspect(actor:Actor,operationId:string){return this.store.read(actor,async c=>{await lockWorkspace(c.tx,c.actor.workspaceId);const {context}=await this.context(c,operationId,'inspect');return {context,invoiceId:await this.known(c,operationId)};});}
 async authorizeClosure(c:NativeContext,raw:StripeTestHostedClaim){
  const claim=this.parseClaim(raw);invariant(claim.action.phase==='close','FORBIDDEN');const current=await this.context(c,claim.context.operation.id,'close'),invoice=await this.known(c,claim.context.operation.id),saved=await this.journal(c.tx,c.actor.workspaceId,actions.phase,claim.context.operation.id+':close'),authority=await this.journal(c.tx,c.actor.workspaceId,actions.closure,claim.context.operation.id);invariant(saved&&saved.hash===digest(claim)&&invoice===claim.action.invoiceId&&authority&&this.policy,'APPROVAL_REQUIRED');
  const prior=z.strictObject({decisionId:opaque,revision:sha,invoiceId:pid('in')}).parse(authority.value),decision=closureSchema.parse(await this.policy.closure(c,current.purchase,invoice,current.customer));invariant(prior.decisionId===claim.action.closureDecisionId&&prior.invoiceId===invoice&&prior.revision===decision.revision&&prior.decisionId===decision.decisionId,'APPROVAL_REQUIRED');
  invariant(digest(current.context.offer)===digest(claim.context.offer)&&digest(current.context.operation)===digest(claim.context.operation)&&current.context.purchaseLineId===claim.context.purchaseLineId&&current.context.customer.bindingId===claim.context.customer.bindingId&&current.context.customer.customerId===claim.context.customer.customerId&&current.context.customer.merchantBindingId===claim.context.customer.merchantBindingId&&current.context.customer.payerAccountId===claim.context.customer.payerAccountId&&current.context.customer.verifiedAt===claim.context.customer.verifiedAt&&current.context.customer.revision>=claim.context.customer.revision,'CONFLICT');
 }
 async inspectClosure(actor:Actor,operationId:string,closureDecisionId:string){
  return this.store.read(actor,async c=>{await lockWorkspace(c.tx,c.actor.workspaceId);const saved=await this.journal(c.tx,c.actor.workspaceId,actions.phase,operationId+':close');if(!saved)return null;const claim=this.parseClaim(saved.value);invariant(claim.action.phase==='close'&&claim.action.closureDecisionId===closureDecisionId,'FORBIDDEN');await this.authorizeClosure(c,claim);const fence=await one(c.tx,"SELECT id FROM ls_fishing_payments.outbox WHERE workspace_id=$1 AND topic='stripe-test.hosted.close.dispatch' AND aggregate_id=$2 AND revision=1 FOR SHARE",[c.actor.workspaceId,operationId]);return fence?claim:null;});
 }
 async reconcile(c:NativeContext,context:StripeTestHostedContext,observation:StripeTestHostedObservation){
  const current=await this.context(c,context.operation.id,'inspect'),known=await this.known(c,context.operation.id);invariant(known&&digest(current.context)===digest(context),'CONFLICT');const checked=validateStripeTestHostedObservation(observation,context,known);await this.save(c,actions.read,context.operation.id+':'+digest(checked),checked);
  for(const phase of ['add_line','finalize'] as const){const key=context.operation.id+':'+phase,claimRow=await this.journal(c.tx,c.actor.workspaceId,actions.phase,key),done=await this.journal(c.tx,c.actor.workspaceId,actions.observation,key);if(!claimRow||done)continue;const claim=this.parseClaim(claimRow.value),fence=await one(c.tx,'SELECT id FROM ls_fishing_payments.outbox WHERE workspace_id=$1 AND topic=$2 AND aggregate_id=$3 AND revision=1 FOR SHARE',[c.actor.workspaceId,'stripe-test.hosted.'+phase+'.dispatch',context.operation.id]);invariant(fence&&digest(claim.context)===digest(context),'CONFLICT');
   if(phase==='add_line'&&checked.status==='draft'&&checked.hasLine||phase==='finalize'&&checked.status==='open'&&checked.hasLine&&checked.url)await this.save(c,actions.observation,key,checked);
  }
 }
 async authorizePublication(c:NativeContext,context:StripeTestHostedContext){
  const current=await this.context(c,context.operation.id,'publish');invariant(digest(current.context)===digest(context),'CONFLICT');invariant(!await this.journal(c.tx,c.actor.workspaceId,actions.phase,context.operation.id+':close'),'APPROVAL_REQUIRED');
  if(context.operation.state==='confirmed'){
   const op=context.operation,invoice=op.result?.kind==='hosted_invoice'?op.result.providerObjectId:null;invariant(invoice&&invoice===await this.known(c,op.id),'CONFLICT');
   const binding=await one<{customerId:string;purchaseId:string;hostedId:string;operationId:string;invoiceId:string;revokedAt:Date|null}>(c.tx,"SELECT customer_binding_id AS \"customerId\",purchase_id AS \"purchaseId\",hosted_operation_id AS \"hostedId\",operation_id AS \"operationId\",invoice_id AS \"invoiceId\",revoked_at AS \"revokedAt\" FROM ls_fishing_payments.object_bindings WHERE workspace_id=$1 AND provider_account_id=$2 AND livemode=false AND object_kind='invoice' AND object_id=$3 FOR SHARE",[c.actor.workspaceId,this.#binding.accountId,invoice]);
   invariant(binding&&binding.customerId===current.customer.id&&binding.purchaseId===op.purchaseId&&binding.hostedId===op.id&&binding.operationId===op.id&&binding.invoiceId===invoice&&!binding.revokedAt,'APPROVAL_REQUIRED');
  }
 }
 async publish(c:NativeContext,context:StripeTestHostedContext,observation:StripeTestHostedObservation):Promise<FamilyHostedAction|null>{
  await this.authorizePublication(c,context);
  const current=await this.context(c,context.operation.id,'publish'),known=await this.known(c,context.operation.id);invariant(known&&digest(current.context)===digest(context),'CONFLICT');const checked=validateStripeTestHostedObservation(observation,context,known);if(checked.status!=='open'||!checked.hasLine||checked.paidCents!==0||!checked.url||Date.parse(context.linkExpiresAt)<=c.now.valueOf())return null;
  const finalize=await this.journal(c.tx,c.actor.workspaceId,actions.observation,context.operation.id+':finalize');invariant(finalize&&z.object({invoiceId:pid('in'),status:z.literal('open'),hasLine:z.literal(true)}).parse(finalize.value).invoiceId===known,'CONFLICT');const closing=await this.journal(c.tx,c.actor.workspaceId,actions.phase,context.operation.id+':close');if(closing)return null;
  const customer=current.customer,op=context.operation,provenance='hosted:'+context.authorizationVersion;
  await c.tx.query("INSERT INTO ls_fishing_payments.object_bindings(workspace_id,id,revision,provider_account_id,livemode,customer_binding_id,purchase_id,hosted_operation_id,operation_id,invoice_id,object_kind,object_id,provenance_reference,verified_at) VALUES($1,$2,1,$3,false,$4,$5,$6,$6,$7,'invoice',$7,$8,$9) ON CONFLICT DO NOTHING",[c.actor.workspaceId,randomUUID(),this.#binding.accountId,customer.id,op.purchaseId,op.id,known,provenance,c.now]);
  const mapping=await one<{customerId:string;purchaseId:string;hostedId:string;operationId:string;invoiceId:string;revokedAt:Date|null}>(c.tx,'SELECT customer_binding_id AS "customerId",purchase_id AS "purchaseId",hosted_operation_id AS "hostedId",operation_id AS "operationId",invoice_id AS "invoiceId",revoked_at AS "revokedAt" FROM ls_fishing_payments.object_bindings WHERE workspace_id=$1 AND provider_account_id=$2 AND livemode=false AND object_kind=\'invoice\' AND object_id=$3 FOR SHARE',[c.actor.workspaceId,this.#binding.accountId,known]);invariant(mapping&&mapping.customerId===customer.id&&mapping.purchaseId===op.purchaseId&&mapping.hostedId===op.id&&mapping.operationId===op.id&&mapping.invoiceId===known&&!mapping.revokedAt,'CONFLICT');
  const result={kind:'hosted_invoice' as const,providerObjectId:known,url:checked.url,providerAccountId:this.#binding.accountId,livemode:false,currency:'USD' as const,amountCents:op.amountCents,purchaseId:op.purchaseId,dueId:op.dueId!,idempotencyKey:op.idempotencyKey};if(op.state==='confirmed')invariant(digest(op.result)===digest(result),'CONFLICT');else{invariant(op.state==='unknown','CONFLICT');await c.tx.query('UPDATE ls_fishing_payments.operations SET operation_json=$3::jsonb WHERE workspace_id=$1 AND id=$2',[c.actor.workspaceId,op.id,JSON.stringify({...op,state:'confirmed',result})]);await this.store.event(c,'operation.confirmed',op.id,1);}
  const due=current.purchase.line.dues.find(d=>d.id===op.dueId)!;const action={purchaseId:op.purchaseId,dueIndex:due.index,state:'ready' as const,url:checked.url};await this.save(c,actions.published,op.id,action);return action;
 }
}
