import 'server-only';
import {createHmac,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {AppError} from '../../lib/errors.ts';
import {freshActor,lockWorkspace} from '../identity/data.ts';
import {seal,unseal,type Keyring} from '../identity/crypto.ts';
import {one,type IdentityStore,type SqlSession} from '../identity/store.ts';
import type {Actor,AccountFacts,IdentityClock,WorkspaceId} from '../identity/types.ts';
import {
 BILLING_DTO_VERSION,billingId,publishedOfferSchema,familyOfferSchema,ledgerReceiptSchema,
 createFamilyOfferSchema,cashCommandSchema,reversalCommandSchema,acceptanceCommandSchema,commandSchema,
 operationReceiptSchema,reminderPolicySchema,reminderIntentSchema,
 type FamilyOffer,type LedgerReceipt,type BillingOperationReceipt,type ReminderIntent,type ReminderPolicy,
} from './contracts.ts';
import {
 requireBilling,createFamilyOffer,issueFamilyOffer,acceptFamilyOffer,changeBillingState,projectBalance,
 validateCashReceipt,validateReversal,
} from './domain.ts';
import {planPaymentReminders,checkReminderDispatch,type DispatchPermission} from './reminders.ts';

export type BillingContext={tx:SqlSession;actor:AccountFacts;workspaceId:WorkspaceId;now:Date};
export type BillingAction='publish'|'create'|'read'|'issue'|'accept'|'cash'|'reverse'|'state'|'reminders'|'dispatch';
export type BillingScope={programKey:'fishing_monthly_club';familyId:string|null;childIds:string[];quoteId:string|null};
/** Mandatory server port: freshly resolve actual native Academy program,
 * family/children/guardian access under this transaction. No network, caller
 * approved flags, inquiry-as-authority, retired Sheet or unconfigured fallback. */
export interface BillingAuthority{
 authorize(context:BillingContext,action:BillingAction,scope:BillingScope):Promise<void>;
 reminderPermission(context:BillingContext,quote:FamilyOffer,policy:ReminderPolicy,guardianId:string,channel:'email'|'whatsapp'):Promise<DispatchPermission>;
}
/** Root supplies its existing encrypted outbox's reservation, not another sender.
 * Write ONLY in the supplied transaction; no provider/network effects here.
 * A worker must durably reserve UNKNOWN before its non-idempotent transport.
 * Payment after reservation is an explicit in-flight race, never retractable. */
export interface BillingOutboxReservation{
 reserve(context:BillingContext,input:{intent:ReminderIntent;balance:ReturnType<typeof projectBalance>}):Promise<void>;
}
type QuoteRow={id:string;familyId:string;revision:number;ciphertext:string};
type CommandRow={actorId:string;action:string;quoteId:string|null;digest:string;ciphertext:string};
type IntentRow={id:string;ciphertext:string;state:ReminderIntent['state']};
const qSelect='SELECT id,family_id AS "familyId",revision,payload_ciphertext AS ciphertext FROM ls_fishing_billing.quotes';
const iSelect='SELECT id,payload_ciphertext AS ciphertext,state FROM ls_fishing_billing.reminders';
const aad=(kind:string,workspace:string,id:string)=>'ls_fishing_billing/v1/'+kind+'/'+workspace+'/'+id;
const scope=(q:FamilyOffer):BillingScope=>({programKey:'fishing_monthly_club',quoteId:q.id,familyId:q.familyId,childIds:[...new Set(q.lines.map(l=>l.childId))]});
const canonical=(value:unknown):string=>{
 if(value===null||typeof value!=='object')return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical((value as Record<string,unknown>)[k])).join(',')+'}';
};
const quoteResult=z.object({quote:familyOfferSchema,balance:operationReceiptSchema.shape.result.shape.balance,receiptId:billingId.nullable()}).strict();
export class FishingBillingStore{
 private readonly key:Buffer;
 constructor(
  readonly db:IdentityStore,readonly workspaceId:WorkspaceId,private readonly ring:Keyring,digestKey:Buffer,
  readonly authority:BillingAuthority,readonly clock:IdentityClock,
  private readonly outbox:BillingOutboxReservation|null=null,
 ){
  requireBilling(digestKey.length>=32,'UNAVAILABLE');this.key=Buffer.from(digestKey);
 }
 private digest(value:unknown){return createHmac('sha256',this.key).update(canonical(value)).digest('hex');}
 private async context<T>(actor:Actor,mutating:boolean,work:(c:BillingContext)=>Promise<T>):Promise<T>{
  requireBilling(actor.workspaceId===this.workspaceId,'FORBIDDEN');
  return this.db.transaction(async tx=>{
   if(mutating)await lockWorkspace(tx,this.workspaceId);
   const now=this.clock.now(),current=await freshActor(tx,actor,now);
   requireBilling(current.workspaceId===this.workspaceId&&current.state==='active','FORBIDDEN');
   return work({tx,actor:current,workspaceId:this.workspaceId,now});
  });
 }
 private owner(c:BillingContext){requireBilling(c.actor.role==='practitioner','FORBIDDEN');}
 private async quote(c:BillingContext,id:string,write=false):Promise<FamilyOffer>{
  billingId.parse(id);
  const row=await one<QuoteRow>(c.tx,qSelect+' WHERE workspace_id=$1 AND id=$2'+(write?' FOR UPDATE':' FOR SHARE'),[c.workspaceId,id]);
  if(!row)throw new AppError('NOT_FOUND');
  const q=familyOfferSchema.parse(JSON.parse(unseal(row.ciphertext,aad('quote',c.workspaceId,id),this.ring)));
  requireBilling(q.id===row.id&&q.workspaceId===c.workspaceId&&q.familyId===row.familyId&&q.revision===row.revision,'UNAVAILABLE');
  return q;
 }
 private async receipts(c:BillingContext,quoteId:string){
  const rows=await c.tx.query<{id:string;ciphertext:string}>('SELECT id,payload_ciphertext AS ciphertext FROM ls_fishing_billing.receipts WHERE workspace_id=$1 AND quote_id=$2 ORDER BY id LIMIT 1001',[c.workspaceId,quoteId]);
  requireBilling(rows.length<=1000,'UNAVAILABLE');
  return rows.map(r=>ledgerReceiptSchema.parse(JSON.parse(unseal(r.ciphertext,aad('receipt',c.workspaceId,r.id),this.ring))));
 }
 private async result(c:BillingContext,q:FamilyOffer,receiptId:string|null=null){
  const balance=projectBalance(q,await this.receipts(c,q.id));
  const rows=await c.tx.query<IntentRow>(iSelect+' WHERE workspace_id=$1 AND quote_id=$2 ORDER BY id LIMIT 1001',[c.workspaceId,q.id]);
  requireBilling(rows.length<=1000,'UNAVAILABLE');
  balance.reminders=rows.map(r=>({id:r.id,state:r.state}));
  return quoteResult.parse({quote:q,balance,receiptId});
 }
 private async previous<T>(c:BillingContext,id:string,action:string,body:unknown,parse:(v:unknown)=>T):Promise<T|null>{
  const row=await one<CommandRow>(c.tx,'SELECT actor_id AS "actorId",action,quote_id AS "quoteId",request_digest AS digest,result_ciphertext AS ciphertext FROM ls_fishing_billing.commands WHERE workspace_id=$1 AND operation_id=$2',[c.workspaceId,id]);
  if(!row)return null;
  requireBilling(row.actorId===c.actor.id&&row.action===action&&row.digest===this.digest(body),'CONFLICT');
  return parse(JSON.parse(unseal(row.ciphertext,aad('command',c.workspaceId,id),this.ring)));
 }
 private async journal(c:BillingContext,id:string,action:string,quoteId:string|null,body:unknown,result:unknown){
  await c.tx.query('INSERT INTO ls_fishing_billing.commands(workspace_id,operation_id,actor_id,action,quote_id,request_digest,result_ciphertext,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[c.workspaceId,id,c.actor.id,action,quoteId,this.digest(body),seal(JSON.stringify(result),aad('command',c.workspaceId,id),this.ring),c.now]);
 }
 private async saveQuote(c:BillingContext,before:FamilyOffer,after:FamilyOffer){
  requireBilling(after.revision===before.revision+1,'UNAVAILABLE');
  const row=await one(c.tx,'UPDATE ls_fishing_billing.quotes SET revision=$4,payload_ciphertext=$5 WHERE workspace_id=$1 AND id=$2 AND revision=$3 RETURNING id',[c.workspaceId,before.id,before.revision,after.revision,seal(JSON.stringify(after),aad('quote',c.workspaceId,after.id),this.ring)]);
  requireBilling(row,'CONFLICT');
 }
 private async receipt(c:BillingContext,r:LedgerReceipt){
  await c.tx.query('INSERT INTO ls_fishing_billing.receipts(workspace_id,id,quote_id,operation_id,original_receipt_id,payload_ciphertext,recorded_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[c.workspaceId,r.id,r.quoteId,r.operationId,r.originalReceiptId,seal(JSON.stringify(r),aad('receipt',c.workspaceId,r.id),this.ring),c.now]);
 }
 private async suppress(c:BillingContext,q:FamilyOffer){
  const b=projectBalance(q,await this.receipts(c,q.id));
  const reason=q.state==='cancelled'?'cancelled':q.paused?'owner_paused':b.remainingMinor===0?'paid':null;
  if(!reason)return;
  const rows=await c.tx.query<IntentRow>(iSelect+" WHERE workspace_id=$1 AND quote_id=$2 AND state='queued' FOR UPDATE",[c.workspaceId,q.id]);
  for(const row of rows){
   const intent=this.decodeIntent(c,row);await this.saveIntent(c,{...intent,state:'suppressed',reason});
  }
 }
 private decodeIntent(c:BillingContext,row:IntentRow){
  const intent=reminderIntentSchema.parse(JSON.parse(unseal(row.ciphertext,aad('reminder',c.workspaceId,row.id),this.ring)));
  requireBilling(intent.id===row.id&&intent.state===row.state,'UNAVAILABLE');return intent;
 }
 private async saveIntent(c:BillingContext,intent:ReminderIntent){
  await c.tx.query('UPDATE ls_fishing_billing.reminders SET state=$3,payload_ciphertext=$4 WHERE workspace_id=$1 AND id=$2',[c.workspaceId,intent.id,intent.state,seal(JSON.stringify(intent),aad('reminder',c.workspaceId,intent.id),this.ring)]);
 }
 async publishOffer(actor:Actor,raw:unknown){
  const c=z.object({operationId:billingId,offer:publishedOfferSchema.omit({publishedAt:true,publishedBy:true})}).strict().parse(raw);
  return this.context(actor,true,async ctx=>{
   this.owner(ctx);await this.authority.authorize(ctx,'publish',{programKey:'fishing_monthly_club',familyId:null,childIds:[],quoteId:null});
   const old=await this.previous(ctx,c.operationId,'publish',c,v=>publishedOfferSchema.parse(v));
   if(old)return {definition:old,replayed:true};
   const definition=publishedOfferSchema.parse({...c.offer,publishedBy:ctx.actor.id,publishedAt:ctx.now.toISOString()});
   await ctx.tx.query('INSERT INTO ls_fishing_billing.definitions(workspace_id,id,payload_ciphertext,published_at) VALUES($1,$2,$3,$4)',[ctx.workspaceId,definition.id,seal(JSON.stringify(definition),aad('definition',ctx.workspaceId,definition.id),this.ring),ctx.now]);
   await this.journal(ctx,c.operationId,'publish',null,c,definition);return {definition,replayed:false};
  });
 }
 async createOffer(actor:Actor,raw:unknown):Promise<BillingOperationReceipt>{
  const cmd=createFamilyOfferSchema.parse(raw);
  return this.context(actor,true,async c=>{
   this.owner(c);
   await this.authority.authorize(c,'create',{programKey:'fishing_monthly_club',familyId:cmd.familyId,childIds:[...new Set(cmd.children.map(l=>l.childId))],quoteId:cmd.id});
   const old=await this.previous(c,cmd.operationId,'create',cmd,v=>operationReceiptSchema.parse(v));
   if(old)return {...old,replayed:true};
   const row=await one<{ciphertext:string}>(c.tx,'SELECT payload_ciphertext AS ciphertext FROM ls_fishing_billing.definitions WHERE workspace_id=$1 AND id=$2',[c.workspaceId,cmd.definitionId]);if(!row)throw new AppError('NOT_FOUND');
   const definition=publishedOfferSchema.parse(JSON.parse(unseal(row.ciphertext,aad('definition',c.workspaceId,cmd.definitionId),this.ring)));
   const q=createFamilyOffer(definition,cmd,{workspaceId:c.workspaceId,actorId:c.actor.id,now:c.now.toISOString()});
   await c.tx.query('INSERT INTO ls_fishing_billing.quotes(workspace_id,id,family_id,definition_id,revision,payload_ciphertext,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[c.workspaceId,q.id,q.familyId,q.definition.id,q.revision,seal(JSON.stringify(q),aad('quote',c.workspaceId,q.id),this.ring),c.now]);
   const receipt=operationReceiptSchema.parse({version:BILLING_DTO_VERSION,operationId:cmd.operationId,entityId:q.id,entityVersion:q.revision,replayed:false,result:await this.result(c,q)});
   await this.journal(c,cmd.operationId,'create',q.id,cmd,receipt);return receipt;
  });
 }
 private async mutate(actor:Actor,action:BillingAction,cmd:{operationId:string;expectedVersion:number;quoteId:string},body:unknown,work:(c:BillingContext,q:FamilyOffer)=>Promise<{quote:FamilyOffer;receiptId:string|null}>){
  return this.context(actor,true,async c=>{
   if(action!=='accept')this.owner(c);
   else requireBilling(c.actor.role==='parent'||c.actor.role==='practitioner','FORBIDDEN');
   const q=await this.quote(c,cmd.quoteId,true);await this.authority.authorize(c,action,scope(q));
   const old=await this.previous(c,cmd.operationId,action,body,v=>operationReceiptSchema.parse(v));
   if(old)return {...old,replayed:true};
   requireBilling(q.revision===cmd.expectedVersion,'CONFLICT');
   const changed=await work(c,q);await this.saveQuote(c,q,changed.quote);await this.suppress(c,changed.quote);
   const receipt=operationReceiptSchema.parse({version:BILLING_DTO_VERSION,operationId:cmd.operationId,entityId:q.id,entityVersion:changed.quote.revision,replayed:false,result:await this.result(c,changed.quote,changed.receiptId)});
   await this.journal(c,cmd.operationId,action,q.id,body,receipt);return receipt;
  });
 }
 async issueOffer(actor:Actor,raw:unknown){
  const cmd=commandSchema.extend({quoteId:billingId}).strict().parse(raw);
  return this.mutate(actor,'issue',cmd,cmd,async(c,q)=>({quote:issueFamilyOffer(q,cmd.expectedVersion,c.now.toISOString()),receiptId:null}));
 }
 async acceptOffer(actor:Actor,raw:unknown){
  const cmd=acceptanceCommandSchema.parse(raw);
  return this.mutate(actor,'accept',cmd,cmd,async(c,q)=>{
   const accepted=acceptFamilyOffer(q,cmd.expectedVersion,c.actor.id,cmd.terms,c.now.toISOString());
   for(const line of accepted.lines)await c.tx.query('INSERT INTO ls_fishing_billing.obligations(workspace_id,quote_id,line_id,family_id,child_id,period_id,starts_at,ends_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[c.workspaceId,q.id,line.id,q.familyId,line.childId,line.period.id,line.period.startsAt,line.period.endsAt]);
   return {quote:accepted,receiptId:null};
  });
 }
 async recordCash(actor:Actor,raw:unknown){
  const cmd=cashCommandSchema.parse(raw);
  return this.mutate(actor,'cash',cmd,cmd,async(c,q)=>{
   const r=validateCashReceipt(q,await this.receipts(c,q.id),ledgerReceiptSchema.parse({
    id:randomUUID(),operationId:cmd.operationId,quoteId:q.id,familyId:q.familyId,kind:'cash',currency:'USD',
    amountMinor:cmd.amountMinor,allocations:cmd.allocations,originalReceiptId:null,actorId:c.actor.id,
    receivedAt:cmd.receivedAt,recordedAt:c.now.toISOString(),reason:null,provider:null,
   }));
   await this.receipt(c,r);return {quote:familyOfferSchema.parse({...q,revision:q.revision+1}),receiptId:r.id};
  });
 }
 async reverseCash(actor:Actor,raw:unknown){
  const cmd=reversalCommandSchema.parse(raw);
  return this.mutate(actor,'reverse',cmd,cmd,async(c,q)=>{
   const r=validateReversal(q,await this.receipts(c,q.id),ledgerReceiptSchema.parse({
    id:randomUUID(),operationId:cmd.operationId,quoteId:q.id,familyId:q.familyId,kind:'cash_reversal',currency:'USD',
    amountMinor:cmd.amountMinor,allocations:cmd.allocations,originalReceiptId:cmd.originalReceiptId,actorId:c.actor.id,
    receivedAt:c.now.toISOString(),recordedAt:c.now.toISOString(),reason:cmd.reason,provider:null,
   }));
   await this.receipt(c,r);return {quote:familyOfferSchema.parse({...q,revision:q.revision+1}),receiptId:r.id};
  });
 }
 async setState(actor:Actor,raw:unknown){
  const cmd=commandSchema.extend({quoteId:billingId,paused:z.boolean().optional(),cancel:z.literal(true).optional()}).strict().parse(raw);
  return this.mutate(actor,'state',cmd,cmd,async(_c,q)=>({quote:changeBillingState(q,cmd.expectedVersion,{...(cmd.paused!==undefined?{paused:cmd.paused}:{}),...(cmd.cancel?{cancel:true}:{})}),receiptId:null}));
 }
 async readBalance(actor:Actor,quoteId:string){
  return this.context(actor,false,async c=>{
   const q=await this.quote(c,quoteId);await this.authority.authorize(c,'read',scope(q));return this.result(c,q);
  });
 }
 /** The original result is replay evidence, not the present-day balance. UI must
  * readBalance after resolving UNKNOWN rather than reuse a new operation ID. */
 async readOperationReceipt(actor:Actor,operationId:string):Promise<BillingOperationReceipt|null>{
  billingId.parse(operationId);
  return this.context(actor,false,async c=>{
   const row=await one<CommandRow>(c.tx,'SELECT actor_id AS "actorId",action,quote_id AS "quoteId",request_digest AS digest,result_ciphertext AS ciphertext FROM ls_fishing_billing.commands WHERE workspace_id=$1 AND operation_id=$2',[c.workspaceId,operationId]);
   if(!row||!row.quoteId)return null;
   const q=await this.quote(c,row.quoteId);await this.authority.authorize(c,'read',scope(q));requireBilling(row.actorId===c.actor.id,'FORBIDDEN');
   return {...operationReceiptSchema.parse(JSON.parse(unseal(row.ciphertext,aad('command',c.workspaceId,operationId),this.ring))),replayed:true};
  });
 }
 async queueReminders(actor:Actor,input:{quoteId:string;policy:ReminderPolicy;guardianId:string;channel:'email'|'whatsapp'}){
  const policy=reminderPolicySchema.parse(input.policy);billingId.parse(input.guardianId);
  return this.context(actor,true,async c=>{
   this.owner(c);const q=await this.quote(c,input.quoteId,true);await this.authority.authorize(c,'reminders',scope(q));
   const permission=await this.authority.reminderPermission(c,q,policy,input.guardianId,input.channel);
   requireBilling(permission.audience.guardianId===input.guardianId&&permission.audience.channel===input.channel&&permission.audience.audience==='individual','FORBIDDEN');
   requireBilling(permission.policyCurrent,'UNAVAILABLE');
   const existing=await c.tx.query<IntentRow>(iSelect+' WHERE workspace_id=$1 AND quote_id=$2 ORDER BY id LIMIT 1001',[c.workspaceId,q.id]);
   requireBilling(existing.length<=1000,'UNAVAILABLE');
   const previous=existing.map(r=>this.decodeIntent(c,r));
   if(!permission.ownerEnabled)return previous;
   // An uncertain earlier send blocks cross-channel or new-policy fallback.
   if(previous.some(i=>i.guardianId===input.guardianId&&i.state==='unknown'))return previous;
   const planned=planPaymentReminders({balance:projectBalance(q,await this.receipts(c,q.id)),policy,audience:permission.audience,newId:randomUUID});
   for(const intent of planned){
    const key=this.digest({key:intent.key});
    await c.tx.query('INSERT INTO ls_fishing_billing.reminders(workspace_id,id,quote_id,intent_key,state,payload_ciphertext,policy_ciphertext) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(workspace_id,intent_key) DO NOTHING',[c.workspaceId,intent.id,q.id,key,intent.state,seal(JSON.stringify(intent),aad('reminder',c.workspaceId,intent.id),this.ring),seal(JSON.stringify(policy),aad('reminder_policy',c.workspaceId,intent.id),this.ring)]);
   }
   return (await c.tx.query<IntentRow>(iSelect+' WHERE workspace_id=$1 AND quote_id=$2 ORDER BY id',[c.workspaceId,q.id])).map(r=>this.decodeIntent(c,r));
  });
 }
 async reserveReminder(actor:Actor,id:string,dispatchId:string){
  billingId.parse(id);billingId.parse(dispatchId);
  return this.context(actor,true,async c=>{
   this.owner(c);
   const row=await one<IntentRow&{policyCiphertext:string}>(c.tx,'SELECT id,payload_ciphertext AS ciphertext,state,policy_ciphertext AS "policyCiphertext" FROM ls_fishing_billing.reminders WHERE workspace_id=$1 AND id=$2 FOR UPDATE',[c.workspaceId,id]);
   if(!row)throw new AppError('NOT_FOUND');
   const intent=this.decodeIntent(c,row),q=await this.quote(c,intent.quoteId,true);
   await this.authority.authorize(c,'dispatch',scope(q));
   const unresolved=await c.tx.query<IntentRow>(iSelect+" WHERE workspace_id=$1 AND quote_id=$2 AND state='unknown' AND id<>$3 FOR UPDATE",[c.workspaceId,q.id,intent.id]);
   if(unresolved.some(r=>this.decodeIntent(c,r).guardianId===intent.guardianId))return {reserved:false as const,reason:'unresolved_dispatch'};
   const policy=reminderPolicySchema.parse(JSON.parse(unseal(row.policyCiphertext,aad('reminder_policy',c.workspaceId,id),this.ring)));
   const permission=await this.authority.reminderPermission(c,q,policy,intent.guardianId,intent.channel);
   const balance=projectBalance(q,await this.receipts(c,q.id)),eligibility=checkReminderDispatch(intent,balance,permission,c.now.toISOString());
   if(!eligibility.eligible){
    if(!['not_due','already_reserved','send_window_closed'].includes(eligibility.reason)&&intent.state==='queued')await this.saveIntent(c,{...intent,state:'suppressed',reason:eligibility.reason});
    return {reserved:false as const,reason:eligibility.reason};
   }
   requireBilling(this.outbox,'UNAVAILABLE');
   const reserved:ReminderIntent={...intent,state:'unknown',dispatchId,reason:'dispatch_reserved'};
   await this.saveIntent(c,reserved);await this.outbox!.reserve(c,{intent:reserved,balance});
   return {reserved:true as const,intent:reserved,remainingMinor:eligibility.remainingMinor};
  });
 }
 /** A late real receipt may resolve UNKNOWN even after payment/cancellation.
  * No retry/fallback is performed. Provider accepted is distinct from delivered. */
 async recordReminderOutcome(actor:Actor,input:{id:string;dispatchId:string;state:'provider_accepted'|'delivered'|'failed';providerId:string|null}){
  const cmd=z.object({id:billingId,dispatchId:billingId,state:z.enum(['provider_accepted','delivered','failed']),providerId:z.string().min(1).max(200).nullable()}).strict().parse(input);
  return this.context(actor,true,async c=>{
   this.owner(c);const row=await one<IntentRow>(c.tx,iSelect+' WHERE workspace_id=$1 AND id=$2 FOR UPDATE',[c.workspaceId,cmd.id]);if(!row)throw new AppError('NOT_FOUND');
   const i=this.decodeIntent(c,row),q=await this.quote(c,i.quoteId,true);await this.authority.authorize(c,'dispatch',scope(q));
   requireBilling(i.dispatchId===cmd.dispatchId&&['unknown','provider_accepted','delivered','failed'].includes(i.state),'CONFLICT');
   requireBilling(cmd.state==='failed'||cmd.providerId,'INVALID_REQUEST');
   if(i.state==='delivered')requireBilling(cmd.state==='delivered'&&i.providerId===cmd.providerId,'CONFLICT');
   if(i.providerId)requireBilling(i.providerId===cmd.providerId,'CONFLICT');
   requireBilling(!(i.state==='provider_accepted'&&cmd.state==='failed'),'CONFLICT');
   const next:ReminderIntent={...i,state:cmd.state,providerId:cmd.providerId,reason:null};await this.saveIntent(c,next);return next;
  });
 }
}
