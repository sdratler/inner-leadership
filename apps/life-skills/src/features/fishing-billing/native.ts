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
import {planPaymentReminders,checkReminderDispatch,reminderSuppression,type DispatchPermission} from './reminders.ts';
import type {BillingStripeBinding} from './stripe-test.ts';
import {LEDGER_HISTORY_VERSION,ledgerHistoryQuerySchema,ledgerHistoryPageSchema} from './history-contracts.ts';
import {cardAttemptSchema,cardExceptionSchema} from './card-contracts.ts';
import {billingStateCommandV2Schema} from './state-contracts-v2.ts';
import {
 REMINDER_SERVICE_VERSION,reminderServiceBindingSchema,reminderBatchCommandSchema,reminderOutcomeLookupSchema,verifiedReminderOutcomeSchema,serviceDispatchPermissionSchema,
 reminderPlanningCommandSchema,reminderServicePlanSchema,
 type BillingReminderServiceConfiguration,type BillingReminderServiceOutbox,type ReminderBatchResult,
} from './reminder-service.ts';
import {
 BILLING_DTO_V2,ledgerReceiptV2Schema,cashDateCommandSchema,dateCashReceiptSchema,validateDateCash,
 projectBalanceV2,operationReceiptV2Schema,upgradeOperationReceipt,reversalCommandV2Schema,ledgerHistoryV2Schema,
 type LedgerReceiptV2,
} from './contracts-v2.ts';

export type BillingLedgerContext={tx:SqlSession;workspaceId:WorkspaceId;now:Date};
export type BillingContext=BillingLedgerContext&{actor:AccountFacts};
export type BillingAction='publish'|'create'|'read'|'issue'|'accept'|'cash'|'reverse'|'state'|'reminders'|'dispatch'|'card';
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
 reserve(context:BillingContext,input:{intent:ReminderIntent;amount:{currency:'USD';quoteId:string;familyId:string;revision:number;remainingMinor:number;lines:ReturnType<typeof projectBalance>['lines']}}):Promise<void>;
 reserveService?:BillingReminderServiceOutbox['reserveService'];
 readServiceOutcome?:BillingReminderServiceOutbox['readServiceOutcome'];
}
/** Root binds the actual service policy, database target, test account/mode and
 * current native family/child/period scope. No session impersonation or default
 * allow. The service capability is constructor-owned, never an HTTP DTO. */
export interface BillingFinancialServiceAuthority{
 authorize(context:BillingLedgerContext,binding:BillingStripeBinding,scope:BillingScope):Promise<void>;
}
export type BillingCardLedger={
 context:BillingLedgerContext;quote:FamilyOffer;receipts:LedgerReceiptV2[];balance:ReturnType<typeof projectBalanceV2>;
 advance(receipts?:LedgerReceipt[]):Promise<FamilyOffer>;
};
type QuoteRow={id:string;familyId:string;revision:number;ciphertext:string};
type CommandRow={actorId:string;action:string;quoteId:string|null;digest:string;ciphertext:string};
type IntentRow={id:string;quoteId:string;intentKey:string;audienceKey:string;scheduledAt:Date|string;ciphertext:string;state:ReminderIntent['state']};
const qSelect='SELECT id,family_id AS "familyId",revision,payload_ciphertext AS ciphertext FROM ls_fishing_billing.quotes';
const iSelect='SELECT id,quote_id AS "quoteId",intent_key AS "intentKey",audience_key AS "audienceKey",scheduled_at AS "scheduledAt",payload_ciphertext AS ciphertext,state FROM ls_fishing_billing.reminders';
const iPolicySelect=iSelect.replace(' FROM ',',policy_ciphertext AS "policyCiphertext" FROM ');
const aad=(kind:string,workspace:string,id:string)=>'ls_fishing_billing/v1/'+kind+'/'+workspace+'/'+id;
const scope=(q:FamilyOffer):BillingScope=>({programKey:'fishing_monthly_club',quoteId:q.id,familyId:q.familyId,childIds:[...new Set(q.lines.map(l=>l.childId))]});
const canonical=(value:unknown):string=>{
 if(value===null||typeof value!=='object')return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical((value as Record<string,unknown>)[k])).join(',')+'}';
};
const quoteResult=z.object({quote:familyOfferSchema,balance:operationReceiptSchema.shape.result.shape.balance,receiptId:billingId.nullable()}).strict();
const commandRecordSchema=z.object({
 version:z.literal('JLFA-BILLING-JOURNAL-v1'),workspaceId:billingId,operationId:billingId,actorId:billingId,
 action:z.string().min(1).max(40),quoteId:billingId.nullable(),digest:z.string().regex(/^[a-f0-9]{64}$/),result:z.unknown(),
}).strict();
export class FishingBillingStore{
 private readonly key:Buffer;
 private readonly reminderService:BillingReminderServiceConfiguration|null;
 constructor(
  readonly db:IdentityStore,readonly workspaceId:WorkspaceId,private readonly ring:Keyring,digestKey:Buffer,
  readonly authority:BillingAuthority,readonly clock:IdentityClock,
  private readonly outbox:BillingOutboxReservation|null=null,
  private readonly financialService:BillingFinancialServiceAuthority|null=null,
  reminderService:BillingReminderServiceConfiguration|null=null,
 ){
  requireBilling(digestKey.length>=32,'UNAVAILABLE');this.key=Buffer.from(digestKey);
  this.reminderService=reminderService?{binding:reminderServiceBindingSchema.parse(reminderService.binding),authority:reminderService.authority}:null;
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
 private async quote(c:BillingLedgerContext,id:string,write=false):Promise<FamilyOffer>{
  billingId.parse(id);
  const row=await one<QuoteRow>(c.tx,qSelect+' WHERE workspace_id=$1 AND id=$2'+(write?' FOR UPDATE':' FOR SHARE'),[c.workspaceId,id]);
  if(!row)throw new AppError('NOT_FOUND');
  const q=familyOfferSchema.parse(JSON.parse(unseal(row.ciphertext,aad('quote',c.workspaceId,id),this.ring)));
  requireBilling(q.id===row.id&&q.workspaceId===c.workspaceId&&q.familyId===row.familyId&&q.revision===row.revision,'UNAVAILABLE');
  return q;
 }
 private async receipts(c:BillingLedgerContext,quoteId:string){
  const rows=await c.tx.query<{id:string;ciphertext:string}>('SELECT id,payload_ciphertext AS ciphertext FROM ls_fishing_billing.receipts WHERE workspace_id=$1 AND quote_id=$2 ORDER BY id LIMIT 1001',[c.workspaceId,quoteId]);
  requireBilling(rows.length<=1000,'UNAVAILABLE');
  return rows.map(r=>{const parsed=ledgerReceiptSchema.safeParse(JSON.parse(unseal(r.ciphertext,aad('receipt',c.workspaceId,r.id),this.ring)));requireBilling(parsed.success,'UNAVAILABLE');return parsed.data!;});
 }
 private async receiptsV2(c:BillingLedgerContext,quoteId:string){
  const rows=await c.tx.query<{id:string;ciphertext:string}>('SELECT id,payload_ciphertext AS ciphertext FROM ls_fishing_billing.receipts WHERE workspace_id=$1 AND quote_id=$2 ORDER BY id LIMIT 1001',[c.workspaceId,quoteId]);
  requireBilling(rows.length<=1000,'UNAVAILABLE');
  return rows.map(row=>{
   const receipt=ledgerReceiptV2Schema.parse(JSON.parse(unseal(row.ciphertext,aad('receipt',c.workspaceId,row.id),this.ring)));
   requireBilling(receipt.id===row.id&&receipt.quoteId===quoteId,'UNAVAILABLE');return receipt;
  });
 }
 private async balance(c:BillingLedgerContext,q:FamilyOffer){
  const attempts=await c.tx.query<{id:string;state:string;revision:number;ciphertext:string}>('SELECT id,state,revision,payload_ciphertext AS ciphertext FROM ls_fishing_billing.card_attempts WHERE workspace_id=$1 AND quote_id=$2 ORDER BY id LIMIT 1001',[c.workspaceId,q.id]);
  requireBilling(attempts.length<=1000,'UNAVAILABLE');
  const pending=attempts.map(row=>{
   const a=cardAttemptSchema.parse(JSON.parse(unseal(row.ciphertext,'ls_fishing_billing/card/v1/attempt/'+c.workspaceId+'/'+row.id,this.ring)));
   requireBilling(a.id===row.id&&a.state===row.state&&a.revision===row.revision&&a.workspaceId===c.workspaceId&&a.quoteId===q.id&&a.familyId===q.familyId,'UNAVAILABLE');return a;
  }).filter(a=>['prepared','unknown','open','pending'].includes(a.state));
  const balance=projectBalanceV2(q,await this.receiptsV2(c,q.id),pending.map(a=>a.id));
  const exceptions=await c.tx.query<{id:string;state:string;ciphertext:string}>('SELECT id,state,payload_ciphertext AS ciphertext FROM ls_fishing_billing.card_exceptions WHERE workspace_id=$1 AND quote_id=$2 LIMIT 1001',[c.workspaceId,q.id]);
  requireBilling(exceptions.length<=1000,'UNAVAILABLE');let review=false;
  for(const row of exceptions){
   const e=cardExceptionSchema.parse(JSON.parse(unseal(row.ciphertext,'ls_fishing_billing/card/v1/exception/'+c.workspaceId+'/'+row.id,this.ring)));
   requireBilling(e.id===row.id&&e.workspaceId===c.workspaceId&&e.quoteId===q.id&&e.familyId===q.familyId&&e.state===row.state,'UNAVAILABLE');if(e.state==='open')review=true;
  }
  if(review)balance.state='review_required';
  return balance;
 }
 private async result(c:BillingLedgerContext,q:FamilyOffer,receiptId:string|null=null){
  const balance=await this.balance(c,q);
  const rows=await c.tx.query<IntentRow>(iSelect+' WHERE workspace_id=$1 AND quote_id=$2 ORDER BY id LIMIT 1001',[c.workspaceId,q.id]);
  requireBilling(rows.length<=1000,'UNAVAILABLE');
  balance.reminders=rows.map(r=>({id:r.id,state:r.state}));
  const legacy=quoteResult.safeParse({quote:q,balance:{...balance,version:BILLING_DTO_VERSION},receiptId});requireBilling(legacy.success,'UNAVAILABLE');return legacy.data!;
 }
 private async resultV2(c:BillingLedgerContext,q:FamilyOffer,receiptId:string|null=null){
  const balance=await this.balance(c,q);
  const reminders=await c.tx.query<{id:string;state:string}>('SELECT id,state FROM ls_fishing_billing.reminders WHERE workspace_id=$1 AND quote_id=$2 ORDER BY id LIMIT 1001',[c.workspaceId,q.id]);
  requireBilling(reminders.length<=1000,'UNAVAILABLE');
  return operationReceiptV2Schema.shape.result.parse({quote:q,balance:{...balance,reminders},receiptId});
 }
 private async previous<T>(c:BillingContext,id:string,action:string,body:unknown,parse:(v:unknown)=>T):Promise<T|null>{
  const row=await one<CommandRow>(c.tx,'SELECT actor_id AS "actorId",action,quote_id AS "quoteId",request_digest AS digest,result_ciphertext AS ciphertext FROM ls_fishing_billing.commands WHERE workspace_id=$1 AND operation_id=$2',[c.workspaceId,id]);
  if(!row)return null;
  const record=this.decodeCommand(c,id,row);
  requireBilling(row.actorId===c.actor.id&&row.action===action&&row.digest===this.digest(body),'CONFLICT');
  if(record.quoteId!==null){
   const current=await this.quote(c,record.quoteId);this.validateCommandResult(c,id,current,record.result);
  }
  return parse(record.result);
 }
 private decodeCommand(c:BillingContext,id:string,row:CommandRow){
  const record=commandRecordSchema.parse(JSON.parse(unseal(row.ciphertext,aad('command',c.workspaceId,id),this.ring)));
  requireBilling(record.workspaceId===c.workspaceId&&record.operationId===id&&record.actorId===row.actorId&&
   record.action===row.action&&record.quoteId===row.quoteId&&record.digest===row.digest,'UNAVAILABLE');
  return record;
 }
 private validateCommandResult(c:BillingContext,id:string,current:FamilyOffer,raw:unknown){
  const parsed=operationReceiptSchema.safeParse(raw);requireBilling(parsed.success,'UNAVAILABLE');const receipt=parsed.data!,result=receipt.result;
  requireBilling(receipt.operationId===id&&receipt.entityId===current.id&&receipt.entityVersion===result.quote.revision&&
   result.quote.id===current.id&&result.quote.workspaceId===c.workspaceId&&result.quote.familyId===current.familyId&&
   result.quote.definition.id===current.definition.id&&result.balance.quoteId===current.id&&result.balance.familyId===current.familyId&&
   result.balance.revision===receipt.entityVersion,'UNAVAILABLE');
  return receipt;
 }
 private async journal(c:BillingContext,id:string,action:string,quoteId:string|null,body:unknown,result:unknown){
  const digest=this.digest(body),record=commandRecordSchema.parse({version:'JLFA-BILLING-JOURNAL-v1',workspaceId:c.workspaceId,operationId:id,actorId:c.actor.id,action,quoteId,digest,result});
  await c.tx.query('INSERT INTO ls_fishing_billing.commands(workspace_id,operation_id,actor_id,action,quote_id,request_digest,result_ciphertext,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[c.workspaceId,id,c.actor.id,action,quoteId,digest,seal(JSON.stringify(record),aad('command',c.workspaceId,id),this.ring),c.now]);
 }
 private async saveQuote(c:BillingLedgerContext,before:FamilyOffer,after:FamilyOffer){
  requireBilling(after.revision===before.revision+1,'UNAVAILABLE');
  const row=await one(c.tx,'UPDATE ls_fishing_billing.quotes SET revision=$4,payload_ciphertext=$5 WHERE workspace_id=$1 AND id=$2 AND revision=$3 RETURNING id',[c.workspaceId,before.id,before.revision,after.revision,seal(JSON.stringify(after),aad('quote',c.workspaceId,after.id),this.ring)]);
  requireBilling(row,'CONFLICT');
 }
 private async receipt(c:BillingLedgerContext,r:LedgerReceiptV2){
  await c.tx.query('INSERT INTO ls_fishing_billing.receipts(workspace_id,id,quote_id,operation_id,original_receipt_id,payload_ciphertext,recorded_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[c.workspaceId,r.id,r.quoteId,r.operationId,r.originalReceiptId,seal(JSON.stringify(r),aad('receipt',c.workspaceId,r.id),this.ring),c.now]);
 }
 private async suppress(c:BillingLedgerContext,q:FamilyOffer){
  const b=await this.balance(c,q);
  const reason=q.state==='cancelled'?'cancelled':q.paused?'owner_paused':b.remainingMinor===0?'paid':null;
  if(!reason)return;
  const rows=await c.tx.query<IntentRow>(iSelect+" WHERE workspace_id=$1 AND quote_id=$2 AND state='queued' FOR UPDATE",[c.workspaceId,q.id]);
  for(const row of rows){
   const intent=this.decodeIntent(c,row);await this.saveIntent(c,{...intent,state:'suppressed',reason});
  }
 }
 private decodeIntent(c:BillingLedgerContext,row:IntentRow){
  const intent=reminderIntentSchema.parse(JSON.parse(unseal(row.ciphertext,aad('reminder',c.workspaceId,row.id),this.ring)));
  requireBilling(intent.id===row.id&&intent.quoteId===row.quoteId&&intent.state===row.state&&
   this.digest({key:intent.key})===row.intentKey&&this.digest({quoteId:intent.quoteId,guardianId:intent.guardianId})===row.audienceKey&&
   Date.parse(intent.scheduledAt)===new Date(row.scheduledAt).valueOf(),'UNAVAILABLE');return intent;
 }
 private async saveIntent(c:BillingLedgerContext,intent:ReminderIntent){
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
 async readBalanceV2(actor:Actor,quoteId:string){
  return this.context(actor,false,async c=>{
   this.owner(c);const q=await this.quote(c,quoteId);await this.authority.authorize(c,'read',scope(q));return this.resultV2(c,q);
  });
 }
 private validateV2Result(c:BillingContext,id:string,q:FamilyOffer,raw:unknown){
  const receipt=upgradeOperationReceipt(raw),r=receipt.result;
  requireBilling(receipt.operationId===id&&receipt.entityId===q.id&&receipt.entityVersion===r.quote.revision&&r.quote.id===q.id&&
   r.quote.workspaceId===c.workspaceId&&r.quote.familyId===q.familyId&&r.quote.definition.id===q.definition.id&&
   r.balance.quoteId===q.id&&r.balance.familyId===q.familyId&&r.balance.revision===receipt.entityVersion,'UNAVAILABLE');return receipt;
 }
 private async mutateV2(actor:Actor,action:'cash_date_v2'|'reverse_v2'|'state_v2',cmd:{operationId:string;expectedVersion:number;quoteId:string},work:(c:BillingContext,q:FamilyOffer,receipts:LedgerReceiptV2[])=>{quote:FamilyOffer;receipt:LedgerReceiptV2|null}){
  return this.context(actor,true,async c=>{
   this.owner(c);const q=await this.quote(c,cmd.quoteId,true);await this.authority.authorize(c,action==='cash_date_v2'?'cash':action==='reverse_v2'?'reverse':'state',scope(q));
   const old=await one<CommandRow>(c.tx,'SELECT actor_id AS "actorId",action,quote_id AS "quoteId",request_digest AS digest,result_ciphertext AS ciphertext FROM ls_fishing_billing.commands WHERE workspace_id=$1 AND operation_id=$2',[c.workspaceId,cmd.operationId]);
   if(old){const record=this.decodeCommand(c,cmd.operationId,old);requireBilling(record.actorId===c.actor.id&&record.action===action&&record.quoteId===q.id&&record.digest===this.digest(cmd),'CONFLICT');return {...this.validateV2Result(c,cmd.operationId,q,record.result),replayed:true};}
   requireBilling(q.revision===cmd.expectedVersion,'CONFLICT');
   const receipts=await this.receiptsV2(c,q.id),changed=work(c,q,receipts),r=changed.receipt,updated=familyOfferSchema.parse(changed.quote);
   projectBalanceV2(updated,[...receipts,...(r?[r]:[])]);
   if(r)await this.receipt(c,r);await this.saveQuote(c,q,updated);await this.suppress(c,updated);
   const result=operationReceiptV2Schema.parse({version:BILLING_DTO_V2,sourceVersion:BILLING_DTO_V2,operationId:cmd.operationId,entityId:q.id,entityVersion:updated.revision,replayed:false,result:await this.resultV2(c,updated,r?.id??null)});
   await this.journal(c,cmd.operationId,action,q.id,cmd,result);return result;
  });
 }
 async recordCashDate(actor:Actor,raw:unknown){
  const cmd=cashDateCommandSchema.parse(raw);
  return this.mutateV2(actor,'cash_date_v2',cmd,(c,q,receipts)=>({quote:{...q,revision:q.revision+1},receipt:validateDateCash(q,receipts,dateCashReceiptSchema.parse({
   id:randomUUID(),operationId:cmd.operationId,quoteId:q.id,familyId:q.familyId,kind:'cash',currency:'USD',
   amountMinor:cmd.amountMinor,allocations:cmd.allocations,originalReceiptId:null,actorId:c.actor.id,
   receivedPrecision:'date',receivedDate:cmd.receivedDate,timeZone:cmd.timeZone,recordedAt:c.now.toISOString(),reason:null,provider:null,
  }))}));
 }
 async reverseCashV2(actor:Actor,raw:unknown){
  const cmd=reversalCommandV2Schema.parse(raw);
  return this.mutateV2(actor,'reverse_v2',cmd,(c,q)=>({quote:{...q,revision:q.revision+1},receipt:ledgerReceiptSchema.parse({
   id:randomUUID(),operationId:cmd.operationId,quoteId:q.id,familyId:q.familyId,kind:'cash_reversal',currency:'USD',
   amountMinor:cmd.amountMinor,allocations:cmd.allocations,originalReceiptId:cmd.originalReceiptId,actorId:c.actor.id,
   receivedAt:c.now.toISOString(),recordedAt:c.now.toISOString(),reason:cmd.reason,provider:null,
  })}));
 }
 async setStateV2(actor:Actor,raw:unknown){
  const cmd=billingStateCommandV2Schema.parse(raw);
  return this.mutateV2(actor,'state_v2',cmd,(_c,q)=>({receipt:null,quote:changeBillingState(q,cmd.expectedVersion,{
   ...(cmd.paused!==undefined?{paused:cmd.paused}:{}),...(cmd.cancel?{cancel:true}:{}),
  })}));
 }
 async readOperationReceiptV2(actor:Actor,operationId:string){
  billingId.parse(operationId);
  return this.context(actor,false,async c=>{
   this.owner(c);const row=await one<CommandRow>(c.tx,'SELECT actor_id AS "actorId",action,quote_id AS "quoteId",request_digest AS digest,result_ciphertext AS ciphertext FROM ls_fishing_billing.commands WHERE workspace_id=$1 AND operation_id=$2',[c.workspaceId,operationId]);if(!row)return null;
   const record=this.decodeCommand(c,operationId,row);requireBilling(record.actorId===c.actor.id,'FORBIDDEN');if(!record.quoteId)return null;
   const q=await this.quote(c,record.quoteId);await this.authority.authorize(c,'read',scope(q));return {...this.validateV2Result(c,operationId,q,record.result),replayed:true};
  });
 }
 /** Owner-only immutable entries, not values inferred from payment totals.
  * Cursor is opaque but never authority: every page refreshes session/scope.
  * A new aggregate version conflicts so the reader restarts a coherent view. */
 async readLedgerHistory(actor:Actor,raw:unknown){return ledgerHistoryPageSchema.parse(await this.history(actor,raw,false));}
 async readLedgerHistoryV2(actor:Actor,raw:unknown){return ledgerHistoryV2Schema.parse(await this.history(actor,raw,true));}
 private async history(actor:Actor,raw:unknown,v2:boolean){
  const query=ledgerHistoryQuerySchema.parse(raw);
  return this.context(actor,false,async c=>{
   this.owner(c);const q=await this.quote(c,query.quoteId);await this.authority.authorize(c,'read',scope(q));
   const cursorSchema=z.object({workspaceId:billingId,quoteId:billingId,familyId:billingId,revision:z.number().int().positive(),recordedAt:z.string().datetime(),id:billingId}).strict();
   const cursorAad=aad(v2?'history_cursor_v2':'history_cursor',c.workspaceId,q.id);let cursor:z.infer<typeof cursorSchema>|null=null;
   if(query.cursor){
    try{
     const bytes=Buffer.from(query.cursor,'base64url');requireBilling(bytes.toString('base64url')===query.cursor);
     cursor=cursorSchema.parse(JSON.parse(unseal(bytes.toString('utf8'),cursorAad,this.ring)));
    }catch{throw new AppError('INVALID_REQUEST');}
    requireBilling(cursor.workspaceId===c.workspaceId&&cursor.quoteId===q.id&&cursor.familyId===q.familyId,'FORBIDDEN');
    requireBilling(cursor.revision===q.revision,'CONFLICT');
   }
   const rows=await c.tx.query<{id:string;ciphertext:string;recordedAt:Date}>('SELECT id,payload_ciphertext AS ciphertext,recorded_at AS "recordedAt" FROM ls_fishing_billing.receipts WHERE workspace_id=$1 AND quote_id=$2 AND ($3::timestamptz IS NULL OR recorded_at>$3::timestamptz OR (recorded_at=$3::timestamptz AND id>$4::uuid)) ORDER BY recorded_at,id LIMIT $5',[c.workspaceId,q.id,cursor?.recordedAt??null,cursor?.id??null,query.limit+1]);
   const selected=rows.slice(0,query.limit),items=selected.map(row=>{
    const parsed=(v2?ledgerReceiptV2Schema:ledgerReceiptSchema).safeParse(JSON.parse(unseal(row.ciphertext,aad('receipt',c.workspaceId,row.id),this.ring)));requireBilling(parsed.success,'UNAVAILABLE');const item=parsed.data!;
    requireBilling(item.id===row.id&&item.quoteId===q.id&&item.familyId===q.familyId&&Date.parse(item.recordedAt)===row.recordedAt.valueOf(),'UNAVAILABLE');return item;
   });
   const last=selected.at(-1),next=rows.length>query.limit&&last?{workspaceId:c.workspaceId,quoteId:q.id,familyId:q.familyId,revision:q.revision,recordedAt:last.recordedAt.toISOString(),id:last.id}:null;
   return {version:v2?'JLFA-FISHING-LEDGER-HISTORY-v2':LEDGER_HISTORY_VERSION,quoteId:q.id,familyId:q.familyId,asOfVersion:q.revision,items,nextCursor:next?Buffer.from(seal(JSON.stringify(next),cursorAad,this.ring)).toString('base64url'):null};
  });
 }
 private async cardLedger(c:BillingLedgerContext,q:FamilyOffer):Promise<BillingCardLedger>{
  const receipts=await this.receiptsV2(c,q.id);let advanced=false;
  return {context:c,quote:q,receipts,balance:await this.balance(c,q),advance:async(additions=[])=>{
   requireBilling(!advanced,'CONFLICT');
   requireBilling(additions.every(r=>r.kind!=='cash'&&r.kind!=='cash_reversal'));
   projectBalanceV2(q,[...receipts,...additions]);
   for(const receipt of additions)await this.receipt(c,ledgerReceiptSchema.parse(receipt));
   const updated=familyOfferSchema.parse({...q,revision:q.revision+1});
   await this.saveQuote(c,q,updated);await this.suppress(c,updated);advanced=true;return updated;
  }};
 }
 /** Transaction-bound extension port for this feature's card coordinator.
  * Callbacks are trusted server code; routes never deserialize callbacks or
  * authorization ports. No slow provider request may run under this lock. */
 async withCardActor<T>(actor:Actor,quoteId:string,work:(ledger:BillingCardLedger&{actor:AccountFacts})=>Promise<T>):Promise<T>{
  return this.context(actor,true,async c=>{
   requireBilling(c.actor.role==='practitioner'||c.actor.role==='parent','FORBIDDEN');
   const q=await this.quote(c,quoteId,true);await this.authority.authorize(c,'card',scope(q));
   return work({...await this.cardLedger(c,q),actor:c.actor});
  });
 }
 async withCardService<T>(binding:BillingStripeBinding,quoteId:string,work:(ledger:BillingCardLedger)=>Promise<T>):Promise<T>{
  requireBilling(this.financialService,'UNAVAILABLE');
  return this.db.transaction(async tx=>{
   await lockWorkspace(tx,this.workspaceId);
   const c:BillingLedgerContext={tx,workspaceId:this.workspaceId,now:this.clock.now()},q=await this.quote(c,quoteId,true);
   await this.financialService!.authorize(c,binding,scope(q));
   return work(await this.cardLedger(c,q));
  });
 }
 /** The original result is replay evidence, not the present-day balance. UI must
  * readBalance after resolving UNKNOWN rather than reuse a new operation ID. */
 async readOperationReceipt(actor:Actor,operationId:string):Promise<BillingOperationReceipt|null>{
  billingId.parse(operationId);
  return this.context(actor,false,async c=>{
   const row=await one<CommandRow>(c.tx,'SELECT actor_id AS "actorId",action,quote_id AS "quoteId",request_digest AS digest,result_ciphertext AS ciphertext FROM ls_fishing_billing.commands WHERE workspace_id=$1 AND operation_id=$2',[c.workspaceId,operationId]);
   if(!row)return null;
   const record=this.decodeCommand(c,operationId,row);
   requireBilling(record.actorId===c.actor.id,'FORBIDDEN');
   if(record.quoteId===null)return null; // Publication uses the separate owner-only lookup below.
   const q=await this.quote(c,record.quoteId!);await this.authority.authorize(c,'read',scope(q));
   return {...this.validateCommandResult(c,operationId,q,record.result),replayed:true};
  });
 }
 async readPublicationReceipt(actor:Actor,operationId:string){
  billingId.parse(operationId);
  return this.context(actor,false,async c=>{
   this.owner(c);await this.authority.authorize(c,'publish',{programKey:'fishing_monthly_club',familyId:null,childIds:[],quoteId:null});
   const row=await one<CommandRow>(c.tx,'SELECT actor_id AS "actorId",action,quote_id AS "quoteId",request_digest AS digest,result_ciphertext AS ciphertext FROM ls_fishing_billing.commands WHERE workspace_id=$1 AND operation_id=$2',[c.workspaceId,operationId]);
   if(!row)return null;
   const record=this.decodeCommand(c,operationId,row);requireBilling(record.actorId===c.actor.id,'FORBIDDEN');
   requireBilling(record.action==='publish'&&record.quoteId===null,'CONFLICT');
   const definition=publishedOfferSchema.parse(record.result);requireBilling(definition.publishedBy===record.actorId,'UNAVAILABLE');
   const saved=await one<{ciphertext:string}>(c.tx,'SELECT payload_ciphertext AS ciphertext FROM ls_fishing_billing.definitions WHERE workspace_id=$1 AND id=$2',[c.workspaceId,definition.id]);
   requireBilling(saved&&canonical(publishedOfferSchema.parse(JSON.parse(unseal(saved.ciphertext,aad('definition',c.workspaceId,definition.id),this.ring))))===canonical(definition),'UNAVAILABLE');
   return {operationId,definition,replayed:true as const};
  });
 }
 async queueReminders(actor:Actor,input:{quoteId:string;policy:ReminderPolicy;guardianId:string;channel:'email'|'whatsapp'}){
  const policy=reminderPolicySchema.parse(input.policy);billingId.parse(input.guardianId);
  return this.context(actor,true,async c=>{
   this.owner(c);const q=await this.quote(c,input.quoteId,true);await this.authority.authorize(c,'reminders',scope(q));
   const permission=await this.authority.reminderPermission(c,q,policy,input.guardianId,input.channel);
   requireBilling(permission.audience.guardianId===input.guardianId&&permission.audience.channel===input.channel&&permission.audience.audience==='individual','FORBIDDEN');
   requireBilling(permission.policyCurrent,'UNAVAILABLE');
   return this.queueIntents(c,q,policy,permission,await this.currentIntents(c,q));
  });
 }
 private async currentIntents(c:BillingLedgerContext,q:FamilyOffer){
  const rows=await c.tx.query<IntentRow>(iSelect+' WHERE workspace_id=$1 AND quote_id=$2 ORDER BY id LIMIT 1001',[c.workspaceId,q.id]);
  requireBilling(rows.length<=1000,'UNAVAILABLE');return rows.map(row=>this.decodeIntent(c,row));
 }
 private async queueIntents(c:BillingLedgerContext,q:FamilyOffer,policy:ReminderPolicy,permission:DispatchPermission,previous:ReminderIntent[]){
   if(!permission.ownerEnabled)return previous;
   // The owner and service paths share exactly the same deterministic planner.
   if(previous.some(i=>i.guardianId===permission.audience.guardianId&&i.state==='unknown'))return previous;
   const planned=planPaymentReminders({balance:await this.balance(c,q),policy,audience:permission.audience,newId:randomUUID});
   for(const intent of planned){
    const key=this.digest({key:intent.key});
    await c.tx.query('INSERT INTO ls_fishing_billing.reminders(workspace_id,id,quote_id,intent_key,state,payload_ciphertext,policy_ciphertext,scheduled_at,audience_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(workspace_id,intent_key) DO NOTHING',[c.workspaceId,intent.id,q.id,key,intent.state,seal(JSON.stringify(intent),aad('reminder',c.workspaceId,intent.id),this.ring),seal(JSON.stringify(policy),aad('reminder_policy',c.workspaceId,intent.id),this.ring),intent.scheduledAt,this.digest({quoteId:intent.quoteId,guardianId:intent.guardianId})]);
   }
   return this.currentIntents(c,q);
 }
 async reserveReminder(actor:Actor,id:string,dispatchId:string){
  billingId.parse(id);billingId.parse(dispatchId);
  return this.context(actor,true,async c=>{
   this.owner(c);
   const row=await one<IntentRow&{policyCiphertext:string}>(c.tx,iPolicySelect+' WHERE workspace_id=$1 AND id=$2 FOR UPDATE',[c.workspaceId,id]);
   if(!row)throw new AppError('NOT_FOUND');
   const intent=this.decodeIntent(c,row),q=await this.quote(c,intent.quoteId,true);
   await this.authority.authorize(c,'dispatch',scope(q));
   const unresolved=await c.tx.query<IntentRow>(iSelect+" WHERE workspace_id=$1 AND quote_id=$2 AND state='unknown' AND id<>$3 FOR UPDATE",[c.workspaceId,q.id,intent.id]);
   if(unresolved.some(r=>this.decodeIntent(c,r).guardianId===intent.guardianId))return {reserved:false as const,reason:'unresolved_dispatch'};
   const policy=reminderPolicySchema.parse(JSON.parse(unseal(row.policyCiphertext,aad('reminder_policy',c.workspaceId,id),this.ring)));
   const permission=await this.authority.reminderPermission(c,q,policy,intent.guardianId,intent.channel);
   const balance=await this.balance(c,q),eligibility=checkReminderDispatch(intent,balance,permission,c.now.toISOString());
   if(!eligibility.eligible){
    if(!['not_due','already_reserved','send_window_closed'].includes(eligibility.reason)&&intent.state==='queued')await this.saveIntent(c,{...intent,state:'suppressed',reason:eligibility.reason});
    return {reserved:false as const,reason:eligibility.reason};
   }
   requireBilling(this.outbox,'UNAVAILABLE');
   const reserved:ReminderIntent={...intent,state:'unknown',dispatchId,reason:'dispatch_reserved'};
   const amount={currency:'USD' as const,quoteId:q.id,familyId:q.familyId,revision:balance.revision,remainingMinor:eligibility.remainingMinor,lines:eligibility.lines};
   requireBilling(amount.lines.every(l=>l.remainingMinor>0)&&amount.remainingMinor===amount.lines.reduce((sum,l)=>sum+l.remainingMinor,0),'UNAVAILABLE');
   await this.saveIntent(c,reserved);await this.outbox!.reserve(c,{intent:reserved,amount});
   return {reserved:true as const,intent:reserved,remainingMinor:eligibility.remainingMinor};
  });
 }
 private async serviceContext<T>(operation:'scan'|'plan'|'outcome',work:(c:BillingLedgerContext,configuration:BillingReminderServiceConfiguration)=>Promise<T>):Promise<T>{
  const configuration=this.reminderService;requireBilling(configuration,'UNAVAILABLE');
  return this.db.transaction(async tx=>{
   await lockWorkspace(tx,this.workspaceId);const now=this.clock.now();requireBilling(Number.isFinite(now.valueOf()),'UNAVAILABLE');
   const c:BillingLedgerContext={tx,workspaceId:this.workspaceId,now};
   await configuration!.authority.authorize(c,configuration!.binding,operation,null,null);
   return work(c,configuration!);
  });
 }
 /** Service planning after real native acceptance. Policy, guardian and channel
  * come from the current constructor-owned resolver, never this command or a
  * remembered operator session. This cannot accept an offer or create a debt. */
 async queueReminderServiceIntents(raw:unknown){
  const command=reminderPlanningCommandSchema.parse(raw);requireBilling(this.outbox?.reserveService,'UNAVAILABLE');
  return this.serviceContext('plan',async(c,configuration)=>{
   const q=await this.quote(c,command.quoteId,true);requireBilling(q.state==='accepted'&&q.acceptance,'CONFLICT');
   await configuration.authority.authorize(c,configuration.binding,'plan',scope(q),null);
   requireBilling(typeof configuration.authority.plan==='function','UNAVAILABLE');
   const rawPlan=await configuration.authority.plan(c,configuration.binding,q);requireBilling(rawPlan,'UNAVAILABLE');
   const plan=reminderServicePlanSchema.parse(rawPlan),audience={quoteId:q.id,familyId:q.familyId,guardianId:plan.guardianId,channel:plan.channel};
   await configuration.authority.authorize(c,configuration.binding,'plan',scope(q),audience);
   const permission=serviceDispatchPermissionSchema.parse(await configuration.authority.permission(c,configuration.binding,q,plan.policy,audience));
   requireBilling(permission.audience.guardianId===plan.guardianId&&permission.audience.channel===plan.channel,'FORBIDDEN');
   requireBilling(permission.policyCurrent,'UNAVAILABLE');
   const previous=await this.currentIntents(c,q),base={version:REMINDER_SERVICE_VERSION,quoteId:q.id};
   if(previous.some(i=>i.guardianId===plan.guardianId&&i.state==='unknown'))return {...base,state:'blocked_unknown' as const,reason:'unresolved_dispatch',intents:previous};
   const reason=reminderSuppression(await this.balance(c,q),permission);
   if(reason)return {...base,state:reason==='send_window_closed'?'deferred' as const:'suppressed' as const,reason,intents:previous};
   return {...base,state:'queued' as const,reason:null,intents:await this.queueIntents(c,q,plan.policy,permission,previous)};
  });
 }
 /** Finite reservation bridge, not a worker or sender. The existing runtime
  * invokes it with a caller-selected bound. UNKNOWN is committed with the
  * existing outbox reservation in the SAME transaction before any transport. */
 async reserveReminderServiceBatch(raw:unknown):Promise<ReminderBatchResult>{
  const command=reminderBatchCommandSchema.parse(raw);requireBilling(this.outbox?.reserveService,'UNAVAILABLE');
  return this.serviceContext('scan',async(c,configuration)=>{
   const rows=await c.tx.query<IntentRow&{policyCiphertext:string}>(iPolicySelect+` AS due
    WHERE workspace_id=$1 AND state='queued' AND scheduled_at<=$2
    AND NOT EXISTS(SELECT 1 FROM ls_fishing_billing.reminders uncertain
     WHERE uncertain.workspace_id=due.workspace_id AND uncertain.quote_id=due.quote_id
     AND uncertain.audience_key=due.audience_key AND uncertain.state='unknown')
    ORDER BY scheduled_at,id LIMIT $3 FOR UPDATE OF due SKIP LOCKED`,[c.workspaceId,c.now,command.limit+1]);
   const results:ReminderBatchResult['results']=[];
   for(const row of rows.slice(0,command.limit)){
    const intent=this.decodeIntent(c,row),q=await this.quote(c,intent.quoteId,true);
    await configuration.authority.authorize(c,configuration.binding,'reserve',scope(q),intent);
    requireBilling(intent.familyId===q.familyId,'UNAVAILABLE');
    // The indexed SQL exclusion is only a prefilter. Authenticate the entire
    // bounded quote set before comparing guardian/state; a modified plaintext
    // audience key must never hide an original unresolved dispatch.
    const authenticated=await this.currentIntents(c,q);
    if(authenticated.some(item=>item.state==='unknown'&&item.guardianId===intent.guardianId)){
     results.push({intentId:intent.id,state:'blocked_unknown',reason:'unresolved_dispatch'});continue;
    }
    const policy=reminderPolicySchema.parse(JSON.parse(unseal(row.policyCiphertext,aad('reminder_policy',c.workspaceId,intent.id),this.ring)));
    requireBilling(policy.id===intent.policyId&&policy.revision===intent.policyRevision,'UNAVAILABLE');
    const permission=serviceDispatchPermissionSchema.parse(await configuration.authority.permission(c,configuration.binding,q,policy,intent));
    const balance=await this.balance(c,q),check=checkReminderDispatch(intent,balance,permission,c.now.toISOString());
    if(!check.eligible){
     const deferred=['not_due','already_reserved','send_window_closed'].includes(check.reason);
     if(!deferred)await this.saveIntent(c,{...intent,state:'suppressed',reason:check.reason});
     results.push({intentId:intent.id,state:deferred?'deferred':'suppressed',reason:check.reason});continue;
    }
    const dispatchId=randomUUID(),reserved:ReminderIntent={...intent,state:'unknown',dispatchId,reason:'dispatch_reserved'};
    const amount={currency:'USD' as const,quoteId:q.id,familyId:q.familyId,revision:balance.revision,remainingMinor:check.remainingMinor,lines:check.lines};
    requireBilling(amount.lines.every(l=>l.remainingMinor>0)&&amount.remainingMinor===amount.lines.reduce((sum,l)=>sum+l.remainingMinor,0),'UNAVAILABLE');
    await this.saveIntent(c,reserved);await this.outbox!.reserveService!(c,configuration.binding,{intent:reserved,amount});
    results.push({intentId:intent.id,state:'reserved',dispatchId,remainingMinor:check.remainingMinor});
   }
   return {version:REMINDER_SERVICE_VERSION,scanned:results.length,moreDue:rows.length>command.limit,results};
  });
 }
 /** Read the original existing-outbox receipt, not a caller-supplied delivery
  * assertion. New-send eligibility is deliberately not a late-fact prerequisite.
  * Current service/native authority still applies; unavailable stays unresolved. */
 async recordReminderServiceOutcome(raw:unknown){
  const lookup=reminderOutcomeLookupSchema.parse(raw);requireBilling(this.outbox?.readServiceOutcome,'UNAVAILABLE');
  return this.serviceContext('outcome',async(c,configuration)=>{
   const row=await one<IntentRow>(c.tx,iSelect+' WHERE workspace_id=$1 AND id=$2 FOR UPDATE',[c.workspaceId,lookup.intentId]);if(!row)throw new AppError('NOT_FOUND');
   const intent=this.decodeIntent(c,row),q=await this.quote(c,intent.quoteId,true);
   requireBilling(intent.familyId===q.familyId&&intent.dispatchId===lookup.dispatchId,'CONFLICT');
   await configuration.authority.authorize(c,configuration.binding,'outcome',scope(q),intent);
   const rawOutcome=await this.outbox!.readServiceOutcome!(c,configuration.binding,lookup);
   if(rawOutcome===null)return {version:REMINDER_SERVICE_VERSION,state:'unresolved' as const,intentId:intent.id};
   const outcome=verifiedReminderOutcomeSchema.parse(rawOutcome);
   requireBilling(outcome.intentId===intent.id&&outcome.dispatchId===intent.dispatchId&&outcome.guardianId===intent.guardianId&&
    outcome.channel===intent.channel&&outcome.outboxBindingId===configuration.binding.outboxBindingId,'UNAVAILABLE');
   const next=await this.applyReminderOutcome(c,intent,outcome);
   return {version:REMINDER_SERVICE_VERSION,state:'recorded' as const,intent:next,sourceReceiptId:outcome.sourceReceiptId};
  });
 }
 private async applyReminderOutcome(c:BillingLedgerContext,i:ReminderIntent,cmd:{dispatchId:string;state:'provider_accepted'|'delivered'|'failed';providerId:string|null}){
  requireBilling(i.dispatchId===cmd.dispatchId&&['unknown','provider_accepted','delivered','failed'].includes(i.state),'CONFLICT');
  requireBilling(cmd.state==='failed'||cmd.providerId,'INVALID_REQUEST');
  if(i.state==='delivered')requireBilling(cmd.state==='delivered'&&i.providerId===cmd.providerId,'CONFLICT');
  if(i.providerId)requireBilling(i.providerId===cmd.providerId,'CONFLICT');
  requireBilling(!(i.state==='provider_accepted'&&cmd.state==='failed'),'CONFLICT');
  const next:ReminderIntent={...i,state:cmd.state,providerId:cmd.providerId,reason:null};
  if(canonical(next)!==canonical(i))await this.saveIntent(c,next);return next;
 }
 /** A late real receipt may resolve UNKNOWN even after payment/cancellation.
  * No retry/fallback is performed. Provider accepted is distinct from delivered. */
 async recordReminderOutcome(actor:Actor,input:{id:string;dispatchId:string;state:'provider_accepted'|'delivered'|'failed';providerId:string|null}){
  const cmd=z.object({id:billingId,dispatchId:billingId,state:z.enum(['provider_accepted','delivered','failed']),providerId:z.string().min(1).max(200).nullable()}).strict().parse(input);
  return this.context(actor,true,async c=>{
   this.owner(c);const row=await one<IntentRow>(c.tx,iSelect+' WHERE workspace_id=$1 AND id=$2 FOR UPDATE',[c.workspaceId,cmd.id]);if(!row)throw new AppError('NOT_FOUND');
   const i=this.decodeIntent(c,row),q=await this.quote(c,i.quoteId,true);await this.authority.authorize(c,'dispatch',scope(q));
   return this.applyReminderOutcome(c,i,cmd);
  });
 }
}
