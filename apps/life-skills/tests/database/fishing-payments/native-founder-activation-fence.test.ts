/** SOURCE-ONLY until Root admits a fresh exact PROGRAM database recipe.
 * Actual password/session/guardian/fit/hold authority; synthetic merchant,
 * transport and explicitly inserted historical records, never Stripe proof.
 * No migration, trigger bypass, provider/network or permissive authority port.
 */
import {createHmac,randomUUID} from 'node:crypto';
import {afterEach,expect,test,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import type {Actor,ApprovedOffer,SqlSession} from '../../../src/features/fishing/contract.ts';
import {seal} from '../../../src/features/identity/crypto.ts';
import {approvedOffer,digest,initialPayment,POLICY_VERSION,type SettlementFact} from '../../../src/features/fishing-payments/domain.ts';
import type {ProviderOperation,ReceiptReadback} from '../../../src/features/fishing-payments/ports.ts';
import {FishingPaymentStore} from '../../../src/features/fishing-payments/store.ts';
import {FishingPaymentService} from '../../../src/features/fishing-payments/service.ts';
import {programFixture,type ProgramFixture} from '../fishing/native-program-fixture.ts';

const fixtures:ProgramFixture[]=[];
afterEach(async()=>{vi.restoreAllMocks();await Promise.all(fixtures.splice(0).map(f=>f.close()));});
type Fixture={f:ProgramFixture;parent:Actor;offer:ApprovedOffer;purchaseId:string};
async function fixture(mode:'prepay'|'installments'='prepay'):Promise<Fixture>{
 const f=await programFixture();fixtures.push(f);await f.createPlan();const family=await f.family(),p=await f.prepare(family,mode);
 const row=(await f.pool.query('SELECT offer_json AS offer FROM ls_fishing_payments.offers WHERE workspace_id=$1 AND id=$2',[f.workspaceId,p.offer.id])).rows[0];
 return {f,parent:family.parent,offer:approvedOffer(row.offer),purchaseId:p.purchaseId};
}
async function campaign(x:Fixture,qualifyingEvent='verified_full_payment'){
 const id='synthetic-founder-'+randomUUID();await x.f.pool.query('INSERT INTO ls_fishing_payments.campaigns(workspace_id,id,policy_json) VALUES($1,$2,$3::jsonb)',[x.f.workspaceId,id,JSON.stringify({version:POLICY_VERSION,qualifyingEvent,approvedDecisionId:'SYNTHETIC_LEGACY_NOT_ACTIVATION_PERMISSION'})]);return id;
}
async function associate(x:Fixture,campaignId:string){await x.f.pool.query('UPDATE ls_fishing_payments.offers SET campaign_id=$3 WHERE workspace_id=$1 AND id=$2',[x.f.workspaceId,x.offer.id,campaignId]);}
async function oldFounderRow(x:Fixture,campaignId:string){await x.f.pool.query("INSERT INTO ls_fishing_payments.founder_households(workspace_id,campaign_id,household_id,state,offer_id) VALUES($1,$2,$3,'reserved',$4)",[x.f.workspaceId,campaignId,x.offer.householdId,x.offer.id]);}
async function protectedRows(x:Fixture){
 const rows=await Promise.all(['ls_fishing_stage.seat_reservations','ls_fishing_payments.reminders','ls_fishing_payments.founder_households'].map(async table=>[table,(await x.f.pool.query(`SELECT to_jsonb(t) AS row FROM ${table} t WHERE workspace_id=$1 ORDER BY to_jsonb(t)::text`,[x.f.workspaceId])).rows]));return Object.fromEntries(rows);
}
async function activationRows(x:Fixture){
 const rows=await Promise.all(['offers','purchases','operations','commands','outbox','settlements'].map(async table=>[table,(await x.f.pool.query(`SELECT to_jsonb(t) AS row FROM ls_fishing_payments.${table} t WHERE workspace_id=$1 ORDER BY to_jsonb(t)::text`,[x.f.workspaceId])).rows]));return {...Object.fromEntries(rows),protected:await protectedRows(x)};
}
async function cache(x:Fixture,actor:Actor,action:string,commandId:string,body:unknown,result:unknown){
 await x.f.pool.query('INSERT INTO ls_fishing_payments.commands(workspace_id,actor_id,action,command_id,digest,result_json,created_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,clock_timestamp())',[x.f.workspaceId,actor.id,action,commandId,digest(body),JSON.stringify(result)]);
}
/** Append a labelled historical snapshot; never UPDATE immutable approvals.
 * The new receipt says fixture.historical.offer, not a native approval action.
 * Existing real synthetic guardian/fit/terms/12 holds remain authoritative.
 */
async function historicalFounder(base:Fixture,issued:boolean):Promise<Fixture>{
 const {f}=base,offer=approvedOffer({...base.offer,id:randomUUID(),lines:base.offer.lines.map(line=>({...line,totalCents:165000,discountBasis:'founder_initial_primary_prepay',eligibility:{...line.eligibility,kind:'verified_founder'},dues:line.dues.map(d=>({...d,amountCents:165000}))}))});
 const purchaseId=randomUUID(),commandId=randomUUID(),action='fixture.historical.offer',hash=digest({fixture:'SYNTHETIC_HISTORY_NOT_NATIVE_APPROVAL',offerId:offer.id}),key=`${f.owner.id}:${commandId}:${action}:${hash}`;
 await f.db.transaction(async tx=>{
  await tx.query('INSERT INTO ls_fishing_stage.command_receipts(workspace_id,actor_id,command_id,action,request_sha256,result_ciphertext,recorded_at) VALUES($1,$2,$3,$4,$5,$6,clock_timestamp())',[f.workspaceId,f.owner.id,commandId,action,hash,seal(JSON.stringify({id:offer.id,revision:1,state:'offer'}),`fishing-program:v1:receipt:${f.workspaceId}:${key}`,f.ring)]);
  await tx.query('INSERT INTO ls_fishing_stage.offer_approvals(workspace_id,id,revision,digest,payload_ciphertext,policy_approval_id,actor_id,command_id,recorded_at) VALUES($1,$2,1,$3,$4,$5,$6,$7,clock_timestamp())',[f.workspaceId,offer.id,digest(offer),seal(JSON.stringify(offer),`fishing-program:v1:offer:${f.workspaceId}:${offer.id}`,f.ring),f.policyId,f.owner.id,commandId]);
  await tx.query('UPDATE ls_fishing_stage.seat_reservations SET offer_id=$3,revision=revision+1 WHERE workspace_id=$1 AND hold_id=$2',[f.workspaceId,offer.lines[0]!.capacity.reservationId,offer.id]);
  if(issued){
   await tx.query("INSERT INTO ls_fishing_payments.offers(workspace_id,id,revision,digest,offer_json,campaign_id,state) VALUES($1,$2,1,$3,$4::jsonb,NULL,'approved')",[f.workspaceId,offer.id,digest(offer),JSON.stringify(offer)]);
   await tx.query('INSERT INTO ls_fishing_payments.purchases(workspace_id,id,offer_id,line_id,revision,state_json) VALUES($1,$2,$3,$4,1,$5::jsonb)',[f.workspaceId,purchaseId,offer.id,offer.lines[0]!.id,JSON.stringify(initialPayment(offer,offer.lines[0]!,purchaseId,f.merchant))]);
  }
 });return {...base,offer,purchaseId};
}
async function historicalOperation(x:Fixture,kind:'hosted_invoice'|'refund'='hosted_invoice',refundPaymentId:string|null=null):Promise<ProviderOperation>{
 const id=randomUUID(),due=x.offer.lines[0]!.dues[0]!,amountCents=kind==='refund'?10000:due.amountCents,key=`rm:${x.f.workspaceId}:${id}`;
 const common={providerAccountId:x.f.merchant.accountId,livemode:false,currency:'USD' as const,amountCents,purchaseId:x.purchaseId,idempotencyKey:key};
 const result=kind==='refund'?{...common,kind:'refund' as const,providerObjectId:`re_${id}`,status:'succeeded' as const}:{...common,kind:'hosted_invoice' as const,providerObjectId:`in_${id}`,dueId:due.id,url:`https://invoice.stripe.com/i/SYNTHETIC_${id}`};
 const op:ProviderOperation={id,kind,workspaceId:x.f.workspaceId,purchaseId:x.purchaseId,dueId:due.id,refundPaymentId,providerAccountId:x.f.merchant.accountId,livemode:false,amountCents,currency:'USD',idempotencyKey:key,state:'confirmed',requestDigest:digest({synthetic:'HISTORICAL_OUTCOME_NOT_APPROVAL',id}),result};
 await x.f.pool.query('INSERT INTO ls_fishing_payments.operations(workspace_id,id,purchase_id,kind,due_id,request_digest,operation_json) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)',[x.f.workspaceId,id,x.purchaseId,kind,due.id,op.requestDigest,JSON.stringify(op)]);return op;
}
function fact(x:Fixture,op:ProviderOperation,change:Partial<SettlementFact>={}):SettlementFact{
 return {canonicalTransactionId:op.kind==='refund'?op.result!.providerObjectId:`pi_${op.id}`,providerReceiptId:'SYNTHETIC_DELAYED_RECEIPT',relatedProviderObjectId:op.result!.providerObjectId,operationId:op.id,purchaseId:x.purchaseId,purchaseLineId:x.offer.lines[0]!.id,dueId:op.dueId!,providerAccountId:x.f.merchant.accountId,livemode:false,currency:'USD',kind:op.kind==='refund'?'refund':'payment',cents:op.amountCents,feeCents:null,originalPaymentId:op.refundPaymentId,occurredAt:new Date(Date.now()-60000).toISOString(),...change};
}
async function receipt(x:Fixture,op:ProviderOperation,facts:readonly SettlementFact[],dues:ReceiptReadback['dues']=[]){
 const eventId='evt_founder_fence_'+randomUUID(),created=Math.floor(Date.now()/1000),secret='whsec_SYNTHETIC_FOUNDER_FENCE_ONLY',eventType=op.kind==='refund'?'refund.updated':'invoice.paid';
 const body=Buffer.from(JSON.stringify({id:eventId,object:'event',type:eventType,account:x.f.merchant.accountId,livemode:false,api_version:x.f.merchant.apiVersion,created,data:{object:{id:op.result!.providerObjectId}}}));
 const signature=`t=${created},v1=${createHmac('sha256',secret).update(`${created}.`).update(body).digest('hex')}`,commandId=randomUUID();
 await x.f.inbox.acceptSynthetic(body,signature,secret);x.f.provider.readback={receiptId:eventId,resolvedObjectId:op.result!.providerObjectId,providerAccountId:x.f.merchant.accountId,livemode:false,readAt:new Date().toISOString(),facts,dues};
 await x.f.inbox.processSynthetic(x.f.owner,commandId,eventId);return {eventId,commandId,body,signature,secret};
}

test.each(['approved_offer','verified_full_payment'])('canonical founder issue denied before old %s policy and cached success',async policy=>{
 const x=await historicalFounder(await fixture(),false),campaignId=await campaign(x,policy),key=randomUUID();
 await cache(x,x.f.owner,'offer.issue',key,{offerId:x.offer.id,revision:1,campaignId},{purchaseIds:[x.purchaseId]});const before=await activationRows(x);
 for(const commandId of [randomUUID(),key])await expect(x.f.paymentStore.registerApprovedOffer(x.f.owner,commandId,x.offer.id,1,campaignId)).rejects.toThrow('FOUNDER_ACTIVATION_BLOCKED');
 // A missing campaign, caller null or nonempty old approval cannot unlock it.
 await expect(x.f.paymentStore.registerApprovedOffer(x.f.owner,randomUUID(),x.offer.id,1,null)).rejects.toThrow('FOUNDER_ACTIVATION_BLOCKED');
 expect(await activationRows(x)).toEqual(before);expect(x.f.provider.calls).toBe(0);
});

test('validated campaign alone blocks ordinary issue before the existing-offer shortcut',async()=>{
 const x=await fixture(),campaignId=await campaign(x),before=await activationRows(x);
 await expect(x.f.paymentStore.registerApprovedOffer(x.f.owner,randomUUID(),x.offer.id,1,campaignId)).rejects.toThrow('FOUNDER_ACTIVATION_BLOCKED');
 await expect(x.f.paymentStore.registerApprovedOffer(x.f.owner,randomUUID(),x.offer.id,1,'unknown_campaign')).rejects.toThrow('NOT_FOUND');
 expect(await activationRows(x)).toEqual(before);
});

test.each(['prepay','installments'] as const)('historical %s campaign cannot replay issue/hosted/start or expose confirmed URL',async mode=>{
 const x=await fixture(mode),due=x.offer.lines[0]!.dues[0]!,prepareKey=randomUUID(),startKey=randomUUID();
 const op=await x.f.payments.beginHosted(x.parent,prepareKey,x.purchaseId,due.id),confirmed=await x.f.payments.executeSynthetic(x.parent,startKey,op.id);
 expect(confirmed.state).toBe('confirmed');expect(await x.f.payments.familyHostedAction(x.parent,op.id)).toMatchObject({state:'ready'});
 const issued=(await x.f.pool.query("SELECT command_id AS id FROM ls_fishing_payments.commands WHERE workspace_id=$1 AND actor_id=$2 AND action='offer.issue' AND digest=$3",[x.f.workspaceId,x.f.owner.id,digest({offerId:x.offer.id,revision:1,campaignId:null})])).rows[0];expect(issued).toBeDefined();
 const campaignId=await campaign(x);await associate(x,campaignId);await oldFounderRow(x,campaignId);const before=await activationRows(x),calls=x.f.provider.calls;
 for(const key of [issued.id,randomUUID()])await expect(x.f.paymentStore.registerApprovedOffer(x.f.owner,key,x.offer.id,1,null)).rejects.toThrow('FOUNDER_ACTIVATION_BLOCKED');
 for(const key of [prepareKey,randomUUID()])await expect(x.f.payments.beginHosted(x.parent,key,x.purchaseId,due.id)).rejects.toThrow('FOUNDER_ACTIVATION_BLOCKED');
 for(const key of [startKey,randomUUID()])await expect(x.f.payments.executeSynthetic(x.parent,key,op.id)).rejects.toThrow('FOUNDER_ACTIVATION_BLOCKED');
 await expect(x.f.payments.familyHostedAction(x.parent,op.id)).rejects.toThrow('FOUNDER_ACTIVATION_BLOCKED');
 expect(await activationRows(x)).toEqual(before);expect(x.f.provider.calls).toBe(calls);
});

test('canonical founder history is blocked without a campaign or inventory row',async()=>{
 const x=await historicalFounder(await fixture(),true),op=await historicalOperation(x),before=await activationRows(x);
 await expect(x.f.payments.beginHosted(x.parent,randomUUID(),x.purchaseId,op.dueId!)).rejects.toThrow('FOUNDER_ACTIVATION_BLOCKED');
 await expect(x.f.payments.executeSynthetic(x.parent,randomUUID(),op.id)).rejects.toThrow('FOUNDER_ACTIVATION_BLOCKED');
 await expect(x.f.payments.familyHostedAction(x.parent,op.id)).rejects.toThrow('FOUNDER_ACTIVATION_BLOCKED');
 expect(await activationRows(x)).toEqual(before);expect(x.f.provider.calls).toBe(0);
});

test('final dispatch reloads campaign association after the committed UNKNOWN start',async()=>{
 const x=await fixture(),campaignId=await campaign(x),due=x.offer.lines[0]!.dues[0]!,op=await x.f.payments.beginHosted(x.parent,randomUUID(),x.purchaseId,due.id),before=await protectedRows(x);let transactions=0;
 const store=new FishingPaymentStore({...x.f.paymentStore.deps,database:{async transaction<T>(work:(tx:SqlSession)=>Promise<T>):Promise<T>{if(++transactions===3)await associate(x,campaignId);return x.f.db.transaction(work);}}}),service=new FishingPaymentService(store);
 await expect(service.executeSynthetic(x.parent,randomUUID(),op.id)).rejects.toThrow('FOUNDER_ACTIVATION_BLOCKED');expect(transactions).toBe(3);expect(x.f.provider.calls).toBe(0);
 expect((await x.f.pool.query("SELECT count(*)::int AS n FROM ls_fishing_payments.outbox WHERE workspace_id=$1 AND topic='operation.dispatch'",[x.f.workspaceId])).rows[0].n).toBe(0);
 expect((await x.f.pool.query('SELECT operation_json AS op FROM ls_fishing_payments.operations WHERE workspace_id=$1 AND id=$2',[x.f.workspaceId,op.id])).rows[0].op.state).toBe('unknown');expect(await protectedRows(x)).toEqual(before);
});

test('fresh cross-workspace, guardian and session checks precede founder classification',async()=>{
 const x=await fixture(),op=await historicalOperation(x),campaignId=await campaign(x);await associate(x,campaignId);const other=await programFixture();fixtures.push(other);
 const gate=vi.spyOn(x.f.paymentStore,'assertHostedActivationAllowed'),before=await activationRows(x);
 await expect(x.f.payments.beginHosted(other.owner,randomUUID(),x.purchaseId,op.dueId!)).rejects.toThrow('NOT_FOUND');
 await x.f.pool.query('UPDATE ls_education.guardian_authorities SET active=false WHERE workspace_id=$1 AND learner_id=$2 AND account_id=$3',[x.f.workspaceId,x.offer.lines[0]!.learnerId,x.parent.id]);
 await expect(x.f.payments.familyHostedAction(x.parent,op.id)).rejects.toThrow();await expect(x.f.paymentStore.registerApprovedOffer(x.f.owner,randomUUID(),x.offer.id,1)).rejects.toThrow();
 await x.f.pool.query('UPDATE ls_identity.sessions SET revoked_at=clock_timestamp() WHERE token_digest=$1',[x.parent.sessionDigest]);
 await expect(x.f.payments.executeSynthetic(x.parent,randomUUID(),op.id)).rejects.toThrow();expect(gate).not.toHaveBeenCalled();expect(await activationRows(x)).toEqual(before);expect(x.f.provider.calls).toBe(0);
});

test('UNKNOWN founder outcome remains passively reconcilable after restart, without another create or URL',async()=>{
 const x=await fixture(),due=x.offer.lines[0]!.dues[0]!,op=await x.f.payments.beginHosted(x.parent,randomUUID(),x.purchaseId,due.id),key=randomUUID();x.f.provider.loseResponse=true;
 expect((await x.f.payments.executeSynthetic(x.parent,key,op.id)).state).toBe('unknown');const campaignId=await campaign(x);await associate(x,campaignId);await oldFounderRow(x,campaignId);const before=await protectedRows(x),restarted=new FishingPaymentService(new FishingPaymentStore(x.f.paymentStore.deps)),read=vi.spyOn(x.f.provider,'readOperation');
 for(const commandId of [key,randomUUID()])await expect(restarted.executeSynthetic(x.parent,commandId,op.id)).rejects.toThrow('FOUNDER_ACTIVATION_BLOCKED');
 expect((await restarted.reconcileOperation(x.parent,randomUUID(),op.id)).state).toBe('confirmed');expect(read).toHaveBeenCalledTimes(1);expect(x.f.provider.calls).toBe(1);
 await expect(restarted.familyHostedAction(x.parent,op.id)).rejects.toThrow('FOUNDER_ACTIVATION_BLOCKED');expect(await protectedRows(x)).toEqual(before);expect((await x.f.paymentStore.readPayment(x.f.owner,x.purchaseId))!.paidCents).toBe(0);
});

test('delayed duplicate cash, fee enrichment and historical refund reconcile without founder promotion',async()=>{
 const x=await fixture(),op=await historicalOperation(x),campaignId=await campaign(x);await associate(x,campaignId);await oldFounderRow(x,campaignId);
 const reminderId=randomUUID();await x.f.pool.query("INSERT INTO ls_fishing_payments.reminders(workspace_id,id,purchase_id,due_id,policy_id,draft_json,state) VALUES($1,$2,$3,$4,'SYNTHETIC_RETAINED_POLICY',$5::jsonb,'suppressed')",[x.f.workspaceId,reminderId,x.purchaseId,op.dueId,JSON.stringify({id:reminderId,purchaseId:x.purchaseId,dueId:op.dueId,recipientAccountId:x.parent.id,channel:'in_app',policyId:'SYNTHETIC_RETAINED_POLICY',copyVersion:'synthetic-v1',state:'suppressed',amountCents:175000,neverSent:true})]);
 const before=await protectedRows(x),money=fact(x,op),first=await receipt(x,op,[money]);expect((await x.f.paymentStore.readPayment(x.f.owner,x.purchaseId))!).toMatchObject({state:'paid',paidCents:175000,feesCents:null});expect(await protectedRows(x)).toEqual(before);
 await x.f.inbox.acceptSynthetic(first.body,first.signature,first.secret);await x.f.inbox.processSynthetic(x.f.owner,first.commandId,first.eventId);await x.f.inbox.processSynthetic(x.f.owner,randomUUID(),first.eventId);
 await receipt(x,op,[{...money,feeCents:100}]);await receipt(x,op,[],[{purchaseId:x.purchaseId,operationId:op.id,dueId:op.dueId!,state:'failed'}]);
 expect((await x.f.pool.query('SELECT count(*)::int AS n FROM ls_fishing_payments.settlements WHERE workspace_id=$1',[x.f.workspaceId])).rows[0].n).toBe(1);expect((await x.f.paymentStore.readPayment(x.f.owner,x.purchaseId))!).toMatchObject({state:'paid',paidCents:175000,feesCents:100});
 // An already-observed refund is a historical cash fact, not new refund terms.
 const refund=await historicalOperation(x,'refund',money.canonicalTransactionId),result=refund.result;if(result?.kind!=='refund')throw Error('SYNTHETIC_REFUND_OUTCOME_REQUIRED');await x.f.pool.query('UPDATE ls_fishing_payments.operations SET operation_json=$3::jsonb WHERE workspace_id=$1 AND id=$2',[x.f.workspaceId,refund.id,JSON.stringify({...refund,state:'unknown',result:null})]);x.f.provider.results.set(refund.idempotencyKey,result);
 const recovered=await x.f.payments.reconcileOperation(x.f.owner,randomUUID(),refund.id);expect(recovered.state).toBe('confirmed');await receipt(x,recovered,[fact(x,recovered,{feeCents:0})]);
 expect((await x.f.paymentStore.readPayment(x.f.owner,x.purchaseId))!).toMatchObject({state:'refund_recorded',paidCents:175000,refundedCents:10000,feesCents:100});expect(await protectedRows(x)).toEqual(before);expect(x.f.provider.calls).toBe(0);
 expect((await x.f.pool.query('SELECT processed_at FROM ls_fishing_payments.inbox WHERE provider_account_id=$1 AND event_id=$2',[x.f.merchant.accountId,first.eventId])).rows[0].processed_at).not.toBeNull();
});
