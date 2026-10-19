import { randomUUID } from 'node:crypto';
import type { Actor } from '../fishing/contract.ts';
import { one } from '../identity/store.ts';
import { approvedOffer,digest,id,invariant,withdrawalProposal,type FamilyHostedAction } from './domain.ts';
import type { NativeContext,ProviderOperation,HostedResult,RefundResult,StripeTestHostedContext,StripeTestHostedDependencies,StripeTestHostedAction,StripeTestHostedObservation,StripeTestHostedPhase } from './ports.ts';
import { FishingPaymentStore } from './store.ts';

export class FishingPaymentService {
 readonly #stripeTestHosted:StripeTestHostedDependencies|undefined;
 constructor(readonly store:FishingPaymentStore,stripeTestHosted?:StripeTestHostedDependencies){
  this.#stripeTestHosted=stripeTestHosted?Object.freeze({...stripeTestHosted}):undefined;
 }
 private testHosted(){
  const d=this.#stripeTestHosted,m=this.store.deps.merchant;
  invariant(d&&d.provider.execution==='stripe_test_hosted_invoice'&&m&&!m.livemode&&m.apiVersion==='2026-09-30.endive'&&digest(d.provider.binding)===digest(m),'STRIPE_TEST_HOSTED_UNAVAILABLE');
  return d;
 }
 private async testHostedContext(raw:StripeTestHostedContext){
  const {validateStripeTestHostedContext}=await import('./stripe-test-hosted-provider.ts');
  return validateStripeTestHostedContext(raw,this.testHosted().provider.binding);
 }
 /** Existing fresh actor/authority is checked again after the Root dispatch
  * fence and after provider I/O. No transaction spans the external boundary. */
 private async currentTestHosted(c:NativeContext,context:StripeTestHostedContext,issuing:boolean){
  const op=await this.store.operation(c,context.operation.id),p=await this.store.purchase(c,op.purchaseId);
  invariant(digest(op)===digest(context.operation)&&digest(p.offer)===digest(context.offer)&&p.line.id===context.purchaseLineId&&c.actor.workspaceId===op.workspaceId,'STRIPE_TEST_HOSTED_CONTEXT_CHANGED');
  await this.store.access(c,p.offer,'read');
  if(issuing){invariant(c.now.getTime()<Date.parse(context.linkExpiresAt),'STRIPE_TEST_HOSTED_LINK_EXPIRED');await this.executionAuthority(c,{...op,state:'reserved'});}
 }
 private async testHostedCall(context:StripeTestHostedContext,action:StripeTestHostedAction):Promise<StripeTestHostedObservation>{
  const {provider}=this.testHosted(),controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
  try{
   const raw=await Promise.race([provider.perform(context,action,controller.signal),new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('STRIPE_TEST_HOSTED_UNAVAILABLE'));},15000);})]);
   const {validateStripeTestHostedObservation}=await import('./stripe-test-hosted-provider.ts');
   const observation=validateStripeTestHostedObservation(raw,context,'invoiceId'in action?action.invoiceId:undefined);
   if(action.phase==='create')invariant(observation.status==='draft'&&!observation.hasLine&&observation.paidCents===0,'STRIPE_TEST_HOSTED_UNAVAILABLE');
   if(action.phase==='add_line')invariant(observation.status==='draft'&&observation.hasLine&&observation.paidCents===0,'STRIPE_TEST_HOSTED_UNAVAILABLE');
   if(action.phase==='finalize')invariant(observation.status==='open'&&observation.hasLine&&observation.paidCents===0&&observation.url,'STRIPE_TEST_HOSTED_UNAVAILABLE');
   if(action.phase==='close')invariant(['void','paid'].includes(observation.status)&&observation.url===null,'STRIPE_TEST_HOSTED_UNAVAILABLE');
   return observation;
  }catch{throw Error('STRIPE_TEST_HOSTED_UNAVAILABLE');}finally{if(timer!==undefined)clearTimeout(timer);controller.abort();}
 }
 /** Root prepares native records only; no SDK call or implicit customer create. */
 async prepareStripeTestHosted(actor:Actor,commandId:string,purchaseId:string,dueId:string){
  id.parse(commandId);id.parse(purchaseId);id.parse(dueId);const {coordinator}=this.testHosted();
  const context=await this.testHostedContext(await coordinator.prepare(actor,commandId,purchaseId,dueId));
  invariant(context.operation.purchaseId===purchaseId&&context.operation.dueId===dueId,'STRIPE_TEST_HOSTED_CONTEXT_CHANGED');
  await this.store.read(actor,c=>this.currentTestHosted(c,context,true));
  return {operationId:context.operation.id,state:'prepared' as const};
 }
 /** One separately persisted phase, not an in-memory create→finalize chain.
  * Root's global consume fence also denies replay of cached claim commands. */
 async executeStripeTestHosted(actor:Actor,commandId:string,operationId:string,phase:StripeTestHostedPhase){
  id.parse(commandId);id.parse(operationId);invariant(['create','add_line','finalize','close'].includes(phase),'STRIPE_TEST_HOSTED_UNAVAILABLE');
  const {coordinator}=this.testHosted(),raw=await coordinator.claim(actor,commandId,operationId,phase);
  if(!raw)return {state:'not_claimed' as const};
  const claim=structuredClone(raw);id.parse(claim.id);const context=await this.testHostedContext(claim.context);
  invariant(context.operation.id===operationId&&claim.action.phase===phase&&(phase==='close'?['unknown','confirmed'].includes(context.operation.state):context.operation.state==='unknown'),'STRIPE_TEST_HOSTED_CONTEXT_CHANGED');
  if(!await coordinator.consume(actor,claim))return {state:'not_claimed' as const};
  if(phase==='close')await this.store.read(actor,async c=>{invariant(c.actor.role==='practitioner','NOT_FOUND');await coordinator.authorizeClosure(c,claim);});
  else await this.store.read(actor,c=>this.currentTestHosted(c,context,true));
  try{
   const observation=await this.testHostedCall(context,claim.action);
   // Commit observation before another phase may be claimed. Even an unknown
   // database reply must not expose the provider URL or trigger a new create.
   await coordinator.observe(claim,observation);return {state:'observed' as const};
  }catch{return {state:'unknown' as const};}
 }
 /** A lost create response without a durable ID stays UNKNOWN. No list/search,
  * create or idempotency-key replacement is available in this path. */
 async reconcileStripeTestHosted(actor:Actor,commandId:string,operationId:string){
  id.parse(commandId);id.parse(operationId);const {coordinator}=this.testHosted(),known=await coordinator.inspect(actor,operationId),context=await this.testHostedContext(known.context);
  invariant(context.operation.id===operationId,'STRIPE_TEST_HOSTED_CONTEXT_CHANGED');
  await this.store.read(actor,c=>this.currentTestHosted(c,context,false));
  if(!known.invoiceId)return {state:'unknown' as const};
  let observation:StripeTestHostedObservation;
  try{observation=await this.testHostedCall(context,{phase:'read',invoiceId:known.invoiceId});}catch{return {state:'unknown' as const};}
  await this.store.command(actor,commandId,'stripe-test.hosted.reconcile',{operationId,context:digest(context),observation:digest(observation)},c=>this.currentTestHosted(c,context,false),c=>coordinator.reconcile(c,context,observation));
  return {state:'observed' as const};
 }
 /** Closure recovery does not borrow revoked family/read access and cannot
  * redispatch void/create. Root returns only the already-consumed close claim. */
 async reconcileStripeTestHostedClosure(actor:Actor,operationId:string,closureDecisionId:string){
  id.parse(operationId);id.parse(closureDecisionId);const {coordinator}=this.testHosted(),raw=await coordinator.inspectClosure(actor,operationId,closureDecisionId);
  if(!raw)return {state:'unknown' as const};
  const claim=structuredClone(raw),context=await this.testHostedContext(claim.context);
  invariant(context.operation.id===operationId&&['unknown','confirmed'].includes(context.operation.state)&&claim.action.phase==='close'&&claim.action.closureDecisionId===closureDecisionId,'STRIPE_TEST_HOSTED_CONTEXT_CHANGED');
  const invoiceId=claim.action.invoiceId;
  await this.store.read(actor,async c=>{invariant(c.actor.role==='practitioner','NOT_FOUND');await coordinator.authorizeClosure(c,claim);});
  try{const observation=await this.testHostedCall(context,{phase:'read',invoiceId});await coordinator.observe(claim,observation);return {state:'observed' as const};}catch{return {state:'unknown' as const};}
 }
 /** Only this committed ordinary-family path can publish the hosted URL.
  * Root must atomically confirm its journal/mappings in publish(c,...). */
 async familyStripeTestHostedAction(actor:Actor,commandId:string,operationId:string):Promise<FamilyHostedAction|null>{
  id.parse(commandId);id.parse(operationId);const {coordinator}=this.testHosted(),known=await coordinator.inspect(actor,operationId),context=await this.testHostedContext(known.context);
  invariant(context.operation.id===operationId,'STRIPE_TEST_HOSTED_CONTEXT_CHANGED');
  await this.store.read(actor,c=>this.currentTestHosted(c,context,true));
  if(!known.invoiceId)return null;
  const observation=await this.testHostedCall(context,{phase:'read',invoiceId:known.invoiceId});
  if(observation.status!=='open'||!observation.hasLine||observation.paidCents!==0||!observation.url)return null;
  const result=await this.store.command(actor,commandId,'stripe-test.hosted.publish',{operationId},c=>this.currentTestHosted(c,context,true),c=>coordinator.publish(c,context,observation));
  if(!result)return null;
  // Validate cached command results too, after the transaction has committed.
  const due=context.offer.lines.find(l=>l.id===context.purchaseLineId)!.dues.find(d=>d.id===context.operation.dueId)!;
  invariant(result.purchaseId===context.operation.purchaseId&&result.dueIndex===due.index&&result.state==='ready'&&result.url===observation.url,'STRIPE_TEST_HOSTED_CONTEXT_CHANGED');
  return {purchaseId:result.purchaseId,dueIndex:result.dueIndex,state:'ready' as const,url:result.url};
 }
 private async executionAuthority(c:NativeContext,op:ProviderOperation){
  const p=await this.store.purchase(c,op.purchaseId);await this.store.access(c,p.offer,op.kind==='refund'?'refund':'hosted',op.kind==='refund');
  if(op.kind==='hosted_invoice')await this.store.assertHostedActivationAllowed(c,p.offer);
  invariant(op.providerAccountId===p.state.providerAccountId&&op.providerAccountId===this.store.deps.merchant?.accountId&&op.livemode===p.state.livemode&&!op.livemode,'MERCHANT_BINDING');
  if(op.state!=='reserved')return;
  if(op.kind==='refund'){const preview=await this.preview(c,op.purchaseId);invariant(preview.token===op.requestDigest&&preview.reviewedTermsId&&preview.amountCents===op.amountCents,'REFUND_APPROVAL_STALE');}
  else {const due=p.state.dues.find(d=>d.id===op.dueId),o=await this.store.loadOffer(c,p.offer.id);invariant(due&&due.paidCents===0&&o.state==='approved','DUE_NOT_PAYABLE');if(due.index===1||p.state.dues[0]?.state!=='paid')invariant(Date.parse(p.offer.expiresAt)>c.now.getTime(),'OFFER_EXPIRED');const current=await this.store.deps.authority.loadApprovedOffer(c.tx,c.actor,p.offer.id);invariant(current&&digest(approvedOffer(current))===digest(p.offer),'APPROVAL_CHANGED');}
 }
 private provider(){
  const {provider,merchant}=this.store.deps;
  invariant(provider?.execution==='synthetic'&&merchant?.verifiedBindingId&&!merchant.livemode&&digest(provider.binding)===digest(merchant),'HOSTED_PROVIDER_UNAVAILABLE');return provider;
 }
 async beginHosted(actor:Actor,commandId:string,purchaseId:string,dueId:string):Promise<ProviderOperation>{
  this.provider();
  const authorize=async(c:NativeContext)=>{const p=await this.store.purchase(c,purchaseId);await this.store.access(c,p.offer,'hosted');await this.store.assertHostedActivationAllowed(c,p.offer);invariant(p.state.providerAccountId===this.store.deps.merchant?.accountId&&!p.state.livemode,'MERCHANT_BINDING');
   const {state}=await this.store.loadOffer(c,p.offer.id),d=p.state.dues.find(x=>x.id===dueId);invariant(d,'WRONG_DUE');invariant(d.paidCents<d.amountCents,'DUE_ALREADY_PAID');
   invariant(state==='approved','OFFER_CANCELLED');
   // Later obligations remain collectible after the original offer expires.
   if(d.index===1||p.state.dues[0]?.state!=='paid')invariant(Date.parse(p.offer.expiresAt)>c.now.getTime(),'OFFER_EXPIRED');
   const current=await this.store.deps.authority.loadApprovedOffer(c.tx,c.actor,p.offer.id);invariant(current&&digest(approvedOffer(current))===digest(p.offer),'APPROVAL_CHANGED');
  };
  return this.store.command(actor,commandId,'hosted.prepare',{purchaseId,dueId},authorize,async c=>{
   const existing=await one<{operation:ProviderOperation}>(c.tx,"SELECT operation_json AS operation FROM ls_fishing_payments.operations WHERE workspace_id=$1 AND purchase_id=$2 AND due_id=$3 AND kind='hosted_invoice'",[c.actor.workspaceId,purchaseId,dueId]);if(existing)return existing.operation;
   const p=await this.store.purchase(c,purchaseId),due=p.state.dues.find(x=>x.id===dueId)!;
   // Partial external payments require reconciliation; never bill the full due again.
   invariant(due.paidCents===0,'PARTIAL_PAYMENT_REVIEW');
   const opId=randomUUID(),operation:ProviderOperation={id:opId,workspaceId:c.actor.workspaceId,purchaseId,dueId,refundPaymentId:null,kind:'hosted_invoice',providerAccountId:p.state.providerAccountId,livemode:p.state.livemode,amountCents:due.amountCents,currency:'USD',idempotencyKey:`rm:${c.actor.workspaceId}:${opId}`,state:'reserved',requestDigest:digest([p.offer.id,p.offer.revision,p.line.id,due]),result:null};
   await this.insertOperation(c,operation);return operation;
  });
 }
 private async insertOperation(c:NativeContext,o:ProviderOperation){await c.tx.query('INSERT INTO ls_fishing_payments.operations(workspace_id,id,purchase_id,kind,due_id,request_digest,operation_json) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)',[c.actor.workspaceId,o.id,o.purchaseId,o.kind,o.dueId,o.requestDigest,JSON.stringify(o)]);await this.store.event(c,'operation.reserved',o.id,1);}
 async executeSynthetic(actor:Actor,commandId:string,operationId:string):Promise<ProviderOperation>{
  const provider=this.provider();
  // Mark UNKNOWN and commit before the external boundary; no SQL lock over I/O.
  const reserved=await this.store.command(actor,commandId,'operation.start',{operationId},async c=>{await this.executionAuthority(c,await this.store.operation(c,operationId));},async c=>{
   const op=await this.store.operation(c,operationId);if(op.state!=='reserved')return {call:false,op};
   const unknown={...op,state:'unknown' as const};await c.tx.query('UPDATE ls_fishing_payments.operations SET operation_json=$3::jsonb WHERE workspace_id=$1 AND id=$2',[c.actor.workspaceId,op.id,JSON.stringify(unknown)]);return {call:true,op:unknown};
  });
  // A replayed start command must not call create twice; reload current state.
  if(!reserved.call)return reserved.op;
  const lease=await this.store.read(actor,async c=>{const op=await this.store.operation(c,operationId);await this.executionAuthority(c,op);return op;});
  if(lease.state==='confirmed')return lease;
  // Only the first caller owns create. A repeated command observes the same
  // UNKNOWN result and must reconcile; a durable dispatch token is consumed below.
  const canCall=await this.store.read(actor,async c=>{await c.tx.query('SELECT id FROM ls_fishing_payments.operations WHERE workspace_id=$1 AND id=$2 FOR UPDATE',[c.actor.workspaceId,operationId]);const op=await this.store.operation(c,operationId);await this.executionAuthority(c,{...op,state:'reserved'});if(op.state!=='unknown')return false;
   const marker=await c.tx.query("INSERT INTO ls_fishing_payments.outbox(id,workspace_id,topic,aggregate_id,revision,recorded_at) VALUES($1,$2,'operation.dispatch',$3,1,$4) ON CONFLICT DO NOTHING RETURNING id",[randomUUID(),c.actor.workspaceId,operationId,c.now]);return marker.length===1;});
  if(!canCall)return lease;
  try{return await this.confirmResult(actor,`result-${digest([commandId,operationId])}`,operationId,await provider.create(lease));}
  catch {return {...lease,state:'unknown',result:null};}
 }
 async reconcileOperation(actor:Actor,commandId:string,operationId:string):Promise<ProviderOperation>{
  const provider=this.provider(),op=await this.store.read(actor,async c=>{const op=await this.store.operation(c,operationId),p=await this.store.purchase(c,op.purchaseId);await this.store.access(c,p.offer,op.kind==='refund'?'refund':'hosted',op.kind==='refund');return op;});
  if(op.state==='confirmed')return op;
  const result=await provider.readOperation(op);return result?this.confirmResult(actor,commandId,operationId,result):op;
 }
 async familyHostedAction(actor:Actor,operationId:string):Promise<FamilyHostedAction|null>{return this.store.read(actor,async c=>{
  const op=await this.store.operation(c,operationId),p=await this.store.purchase(c,op.purchaseId);await this.store.access(c,p.offer,'hosted');
  if(op.kind!=='hosted_invoice'||op.state!=='confirmed'||op.result?.kind!=='hosted_invoice')return null;
  const due=p.state.dues.find(d=>d.id===op.dueId);if(!due||due.paidCents>=due.amountCents)return null;
  await this.executionAuthority(c,{...op,state:'reserved'});this.validateResult(op,op.result);
  return {purchaseId:p.state.purchaseId,dueIndex:due.index,state:'ready',url:op.result.url};
 });}
 private validateResult(op:ProviderOperation,r:HostedResult|RefundResult){
  invariant(r.kind===op.kind&&r.providerAccountId===op.providerAccountId&&r.livemode===op.livemode&&r.currency==='USD'&&r.amountCents===op.amountCents&&r.purchaseId===op.purchaseId&&r.idempotencyKey===op.idempotencyKey,'PROVIDER_RESULT_BINDING');id.parse(r.providerObjectId);
  if(r.kind==='hosted_invoice'){invariant(r.dueId===op.dueId,'WRONG_DUE');const url=new URL(r.url);invariant(url.protocol==='https:'&&['invoice.stripe.com','checkout.stripe.com'].includes(url.hostname)&&!url.username&&!url.password&&!url.port,'HOSTED_URL');}
 }
 private confirmResult(actor:Actor,key:string,operationId:string,result:HostedResult|RefundResult){
  return this.store.command(actor,key,'operation.result',{operationId,result},async c=>{const op=await this.store.operation(c,operationId),p=await this.store.purchase(c,op.purchaseId);await this.store.access(c,p.offer,op.kind==='refund'?'refund':'hosted',op.kind==='refund');this.validateResult(op,result);},async c=>{
   const op=await this.store.operation(c,operationId);if(op.state==='confirmed'){invariant(digest(op.result)===digest(result),'RESULT_CONFLICT');return op;}
   const next={...op,state:'confirmed' as const,result};await c.tx.query('UPDATE ls_fishing_payments.operations SET operation_json=$3::jsonb WHERE workspace_id=$1 AND id=$2',[c.actor.workspaceId,op.id,JSON.stringify(next)]);await this.store.event(c,'operation.confirmed',op.id,2);return next;
  });
 }
 async refundPreview(actor:Actor,purchaseId:string){return this.store.read(actor,c=>this.preview(c,purchaseId));}
 private async preview(c:NativeContext,purchaseId:string){const p=await this.store.purchase(c,purchaseId);await this.store.access(c,p.offer,'refund',true);
  const f=await this.store.deps.authority.withdrawalFacts(c.tx,c.actor,p.offer,p.line),proposal=withdrawalProposal(p.state.originalTotalCents,f.attended,p.line.mode,f.reason,f.multiChildPrestart);
  if(proposal.status!=='PROPOSAL_ONLY')return {proposal,token:null,amountCents:null};
  invariant(p.state.paidCents===p.state.originalTotalCents,'FULL_PREPAY_REQUIRED');
  const amountCents=proposal.refundCents-p.state.refundedCents;invariant(amountCents>0&&amountCents<=p.state.paidCents-p.state.refundedCents,'REFUND_BALANCE');
  return {proposal,amountCents,token:digest([purchaseId,p.state.revision,f,proposal]),reviewedTermsId:f.reviewedTermsId};
 }
 async approveRefund(actor:Actor,commandId:string,purchaseId:string,previewToken:string):Promise<ProviderOperation>{
  this.provider();
  return this.store.command(actor,commandId,'refund.approve',{purchaseId,previewToken},async c=>{const p=await this.store.purchase(c,purchaseId);await this.store.access(c,p.offer,'refund',true);},async c=>{
   const preview=await this.preview(c,purchaseId);invariant(preview.token===previewToken&&preview.amountCents&&preview.reviewedTermsId,'REFUND_APPROVAL_REQUIRED');
   const pending=await c.tx.query<{operation:ProviderOperation}>("SELECT operation_json AS operation FROM ls_fishing_payments.operations WHERE workspace_id=$1 AND purchase_id=$2 AND kind='refund'",[c.actor.workspaceId,purchaseId]);
   invariant(pending.every(x=>x.operation.state==='confirmed'&&x.operation.result?.kind==='refund'&&x.operation.result.status==='failed'),'PRIOR_REFUND_RECONCILE');
   const p=await this.store.purchase(c,purchaseId),payments=p.state.settlements.filter(x=>x.kind==='payment');invariant(payments.length===1,'MULTI_TRANSACTION_REFUND_REVIEW');
   const opId=randomUUID(),op:ProviderOperation={id:opId,kind:'refund',workspaceId:c.actor.workspaceId,purchaseId,dueId:p.state.dues[0]!.id,refundPaymentId:payments[0]!.canonicalTransactionId,providerAccountId:p.state.providerAccountId,livemode:p.state.livemode,amountCents:preview.amountCents,currency:'USD',idempotencyKey:`rm:${c.actor.workspaceId}:${opId}`,state:'reserved',requestDigest:previewToken,result:null};await this.insertOperation(c,op);await this.store.event(c,'refund.approved',op.id,1);return op;
  });
 }
 async reminderDraft(actor:Actor,commandId:string,purchaseId:string,dueId:string){
  return this.store.command(actor,commandId,'reminder.draft',{purchaseId,dueId},async c=>{const p=await this.store.purchase(c,purchaseId);await this.store.access(c,p.offer,'reminder',true);},async c=>{
   const p=await this.store.purchase(c,purchaseId),due=p.state.dues.find(d=>d.id===dueId);invariant(due,'WRONG_DUE');const policy=await this.store.deps.authority.reminderPolicy(c.tx,p.offer,c.now);
   invariant(policy.approvedPolicyId&&policy.copyVersion,'REMINDER_POLICY_REQUIRED');
   const eligible=due.paidCents<due.amountCents&&policy.parentAccountId===p.offer.payerAccountId&&policy.consented&&!policy.quietNow&&policy.eligibleNow&&!policy.stripeAlreadyNotifies&&!await this.store.hasUnknown(c,purchaseId);
   const existing=await one<{id:string}>(c.tx,'SELECT id FROM ls_fishing_payments.reminders WHERE workspace_id=$1 AND purchase_id=$2 AND due_id=$3 AND policy_id=$4',[c.actor.workspaceId,purchaseId,dueId,policy.approvedPolicyId]);
   const draft={id:existing?.id??randomUUID(),purchaseId,dueId,recipientAccountId:p.offer.payerAccountId,channel:policy.channel,policyId:policy.approvedPolicyId,copyVersion:policy.copyVersion,state:eligible?'draft':'suppressed',amountCents:Math.max(0,due.amountCents-due.paidCents),neverSent:true};
   const rows=await c.tx.query<{draft:typeof draft}>('INSERT INTO ls_fishing_payments.reminders(workspace_id,id,purchase_id,due_id,policy_id,draft_json,state) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7) ON CONFLICT(workspace_id,purchase_id,due_id,policy_id) DO UPDATE SET state=EXCLUDED.state,draft_json=EXCLUDED.draft_json RETURNING draft_json AS draft',[c.actor.workspaceId,draft.id,purchaseId,dueId,policy.approvedPolicyId,JSON.stringify(draft),draft.state]);return rows[0]!.draft;
  });
 }
 /** Rechecks current payment/consent/quiet time even for a retained queued draft.
  * Returns no send capability; MAIN owns an independently admitted delivery port. */
 async readReminderDraft(actor:Actor,reminderId:string){return this.store.read(actor,async c=>{
  const row=await one<{draft:{purchaseId:string;dueId:string;policyId:string;copyVersion:string;channel:'in_app'|'email'|'whatsapp';amountCents:number}}>(c.tx,'SELECT draft_json AS draft FROM ls_fishing_payments.reminders WHERE workspace_id=$1 AND id=$2',[c.actor.workspaceId,reminderId]);invariant(row,'NOT_FOUND');
  const p=await this.store.purchase(c,row.draft.purchaseId);await this.store.access(c,p.offer,'reminder',true);
  const due=p.state.dues.find(d=>d.id===row.draft.dueId),policy=await this.store.deps.authority.reminderPolicy(c.tx,p.offer,c.now);
  const amountCents=due?Math.max(0,due.amountCents-due.paidCents):null;
  return {...row.draft,amountCents,state:due&&amountCents!==null&&amountCents>0&&policy.approvedPolicyId===row.draft.policyId&&policy.copyVersion===row.draft.copyVersion&&policy.channel===row.draft.channel&&policy.parentAccountId===p.offer.payerAccountId&&policy.consented&&policy.eligibleNow&&!policy.quietNow&&!policy.stripeAlreadyNotifies&&!await this.store.hasUnknown(c,row.draft.purchaseId)?'draft':'suppressed',neverSent:true};
 });}
}
