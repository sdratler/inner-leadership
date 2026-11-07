import 'server-only';
import {createHmac} from 'node:crypto';
import {z} from 'zod';
import {AppError} from './errors.ts';
import {freshActor,lockWorkspace} from '../features/identity/data.ts';
import {seal,unseal,type Keyring} from '../features/identity/crypto.ts';
import {one,type IdentityStore,type SqlSession} from '../features/identity/store.ts';
import type {Actor,IdentityClock,WorkspaceId} from '../features/identity/types.ts';
import type {BillingAuthority,BillingContext,BillingScope} from '../features/fishing-billing/native.ts';
import {billingId,createFamilyOfferSchema,commandSchema,publishedOfferSchema,reminderIntentSchema} from '../features/fishing-billing/contracts.ts';
import {ledgerReceiptV2Schema} from '../features/fishing-billing/contracts-v2.ts';
import {cardAttemptSchema,cardExceptionSchema} from '../features/fishing-billing/card-contracts.ts';
import {createGuestFamilyOffer,issueGuestFamilyOffer,projectGuestBalanceV3} from '../features/fishing-billing/guest-domain-v3.ts';
import {BILLING_GUEST_V3,guestFamilyOfferSchema,guestOwnerSnapshotV3Schema,type GuestFamilyOffer,type GuestOwnerSnapshotV3} from './fishing-billing-guest-contract-v3.ts';
import {verifyGuestFamilyOffer} from './fishing-billing-guest-material-v3.ts';
import {verifyStoredGuestFinancialEvidence} from './fishing-billing-guest-evidence-readback.ts';

const receiptSchema=z.object({
 version:z.literal(BILLING_GUEST_V3),operationId:billingId,action:z.enum(['create','issue']),
 entityId:billingId,entityVersion:z.number().int().positive(),quote:guestFamilyOfferSchema,replayed:z.boolean(),
}).strict().refine(r=>r.entityId===r.quote.id&&r.entityVersion===r.quote.revision,'GUEST_OWNER_RECEIPT_SCOPE');
type Receipt=z.infer<typeof receiptSchema>;
const journalSchema=z.object({
 version:z.literal(BILLING_GUEST_V3),kind:z.literal('owner_quote'),workspaceId:billingId,
 operationId:billingId,actorId:billingId,action:z.enum(['create','issue']),quoteId:billingId,
 digest:z.string().regex(/^[a-f0-9]{64}$/),receipt:receiptSchema,
}).strict();
const canonical=(v:unknown):string=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical((v as Record<string,unknown>)[k])).join(',')+'}';
const unavailable=()=>new AppError('UNAVAILABLE');
const requireFact=(v:unknown)=>{if(!v)throw unavailable();};
const quoteAad=(w:string,id:string)=>'ls_fishing_billing/guest/v3/quote/'+w+'/'+id;
// Existing account journal table/AAD, actual owner account, new strict payload.
// Older decoders fail closed instead of treating this as an account acceptance.
const commandAad=(w:string,id:string)=>'ls_fishing_billing/v1/command/'+w+'/'+id;
const scope=(q:GuestFamilyOffer):BillingScope=>({programKey:'fishing_monthly_club',familyId:q.familyId,quoteId:q.id,childIds:[...new Set(q.lines.map(l=>l.childId))]});
type QuoteRow={id:string;familyId:string;definitionId:string;revision:number;createdAt:Date;ciphertext:string};
type JournalRow={actorId:string;action:string;quoteId:string;digest:string;ciphertext:string};

/** Unmounted owner-only creation/issuance of NEW guest quotes in the existing
 * ledger. Actual Academy source/family/child/policy authority is mandatory.
 * No guest grant/parent account, acceptance, obligation, sender, provider,
 * enrollment, migration, runtime fallback or historical conversion is supplied.
 * Issuance is not debt or permission to collect; guest acceptance is separate. */
export class FishingBillingGuestOwnerStore{
 private readonly key:Buffer;
 private readonly transactions=new WeakMap<object,SqlSession>();
 constructor(private readonly db:IdentityStore,private readonly workspaceId:WorkspaceId,
  private readonly ring:Keyring,digestKey:Buffer,private readonly clock:IdentityClock,
  private readonly authority:BillingAuthority){
  billingId.parse(workspaceId);requireFact(digestKey.length>=32);this.key=Buffer.from(digestKey);
 }
 private now(){const n=this.clock.now();requireFact(n instanceof Date&&Number.isFinite(n.valueOf()));return n;}
 private contextCurrent(c:BillingContext){requireFact(c.workspaceId===this.workspaceId&&this.transactions.get(c)===c.tx);}
 private tx(c:BillingContext){this.contextCurrent(c);return c.tx;}
 private hmac(v:unknown){return createHmac('sha256',this.key).update(canonical(v)).digest('hex');}
 private digest(action:'create'|'issue',command:unknown){return this.hmac({version:BILLING_GUEST_V3,kind:'owner_quote',workspaceId:this.workspaceId,action,command});}
 private async owner(c:BillingContext,actor:Actor){
  this.contextCurrent(c);
  c.now=this.now();const fresh=await freshActor(c.tx,actor,c.now);
  this.contextCurrent(c);
  requireFact(fresh.workspaceId===this.workspaceId&&fresh.role==='practitioner'&&fresh.state==='active');c.actor=fresh;
 }
 private async current(c:BillingContext,actor:Actor,action:'create'|'issue'|'read',s:BillingScope){
  await this.owner(c,actor);
  // Authority receives the SAME real SQL transaction through a frozen value
  // snapshot, never our mutable owner/clock context or caller's scope array.
  // Retaining the view cannot replace the journal owner/time or shrink the
  // child set used by the final authorization. Date is copied independently.
  const view={...c,actor:{...c.actor},now:new Date(c.now)},scopeView={...s,childIds:[...s.childIds]};
  Object.freeze(view.actor);Object.freeze(view);Object.freeze(scopeView.childIds);Object.freeze(scopeView);
  await this.authority.authorize(view,action,scopeView);await this.owner(c,actor);
 }
 private async context<T>(actor:Actor,work:(c:BillingContext)=>Promise<T>):Promise<T>{
  try{
   requireFact(actor.workspaceId===this.workspaceId);
   return await this.db.transaction(async tx=>{
    await lockWorkspace(tx,this.workspaceId);
    const c:BillingContext={tx,workspaceId:this.workspaceId,now:this.now(),actor:await freshActor(tx,actor,this.now())};
    this.transactions.set(c,tx);
    try{await this.owner(c,actor);return await work(c);}finally{this.transactions.delete(c);}
   });
  }catch{throw unavailable();}
 }
 private async quote(c:BillingContext,id:string){
  this.contextCurrent(c);
  const r=await one<QuoteRow>(this.tx(c),'SELECT id,family_id AS "familyId",definition_id AS "definitionId",revision,created_at AS "createdAt",payload_ciphertext AS ciphertext FROM ls_fishing_billing.quotes WHERE workspace_id=$1 AND id=$2 FOR UPDATE',[this.workspaceId,billingId.parse(id)]);
  if(!r)throw unavailable();const q=verifyGuestFamilyOffer(JSON.parse(unseal(r.ciphertext,quoteAad(this.workspaceId,id),this.ring)));
  requireFact(q.workspaceId===this.workspaceId&&q.id===r.id&&q.familyId===r.familyId&&q.definition.id===r.definitionId&&q.revision===r.revision&&Date.parse(q.createdAt)===r.createdAt.valueOf());return q;
 }
 private async previous(c:BillingContext,actor:Actor,operationId:string,action:'create'|'issue',command:unknown,quoteId:string):Promise<Receipt|null>{
  const r=await one<JournalRow>(this.tx(c),'SELECT actor_id AS "actorId",action,quote_id AS "quoteId",request_digest AS digest,result_ciphertext AS ciphertext FROM ls_fishing_billing.commands WHERE workspace_id=$1 AND operation_id=$2',[this.workspaceId,operationId]);
  if(!r)return null;
  const j=journalSchema.parse(JSON.parse(unseal(r.ciphertext,commandAad(this.workspaceId,operationId),this.ring))),receipt=j.receipt,q=verifyGuestFamilyOffer(receipt.quote);
  requireFact(j.workspaceId===this.workspaceId&&j.operationId===operationId&&j.actorId===c.actor.id&&j.actorId===r.actorId&&j.action===action&&r.action==='guest_'+action&&j.quoteId===quoteId&&r.quoteId===quoteId&&j.digest===r.digest&&j.digest===this.digest(action,command));
  requireFact(receipt.operationId===operationId&&receipt.action===action&&receipt.entityId===quoteId&&q.workspaceId===this.workspaceId&&!receipt.replayed);
  const actual=await this.quote(c,quoteId);
  requireFact(actual.revision>=q.revision&&actual.familyId===q.familyId&&actual.createdAt===q.createdAt&&canonical(actual.definition)===canonical(q.definition)&&canonical(actual.lines)===canonical(q.lines)&&canonical(actual.override)===canonical(q.override));
  if(action==='issue')requireFact(actual.issuedAt===q.issuedAt&&q.state==='issued'&&q.acceptance===null);
  else requireFact(q.state==='draft'&&q.acceptance===null&&q.issuedAt===null);
  await this.current(c,actor,'read',scope(actual));return {...receipt,replayed:true};
 }
 private async journal(c:BillingContext,action:'create'|'issue',command:{operationId:string},q:GuestFamilyOffer):Promise<Receipt>{
  const receipt=receiptSchema.parse({version:BILLING_GUEST_V3,operationId:command.operationId,action,entityId:q.id,entityVersion:q.revision,quote:q,replayed:false}),digest=this.digest(action,command);
  const record=journalSchema.parse({version:BILLING_GUEST_V3,kind:'owner_quote',workspaceId:this.workspaceId,operationId:command.operationId,actorId:c.actor.id,action,quoteId:q.id,digest,receipt});
  await this.tx(c).query('INSERT INTO ls_fishing_billing.commands(workspace_id,operation_id,actor_id,action,quote_id,request_digest,result_ciphertext,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[this.workspaceId,command.operationId,c.actor.id,'guest_'+action,q.id,digest,seal(JSON.stringify(record),commandAad(this.workspaceId,command.operationId),this.ring),c.now]);return receipt;
 }
 async createOffer(actor:Actor,raw:unknown):Promise<Receipt>{
  const cmd=createFamilyOfferSchema.parse(raw);
  return this.context(actor,async c=>{
   const s:BillingScope={programKey:'fishing_monthly_club',quoteId:cmd.id,familyId:cmd.familyId,childIds:[...new Set(cmd.children.map(l=>l.childId))]};
   await this.current(c,actor,'create',s);const old=await this.previous(c,actor,cmd.operationId,'create',cmd,cmd.id);if(old)return old;
   const row=await one<{id:string;publishedAt:Date;ciphertext:string}>(this.tx(c),'SELECT id,published_at AS "publishedAt",payload_ciphertext AS ciphertext FROM ls_fishing_billing.definitions WHERE workspace_id=$1 AND id=$2 FOR SHARE',[this.workspaceId,cmd.definitionId]);if(!row)throw unavailable();
   const d=publishedOfferSchema.parse(JSON.parse(unseal(row.ciphertext,'ls_fishing_billing/v1/definition/'+this.workspaceId+'/'+cmd.definitionId,this.ring)));
   requireFact(d.id===cmd.definitionId&&d.id===row.id&&Date.parse(d.publishedAt)===row.publishedAt.valueOf());
   await this.current(c,actor,'create',s);
   const q=createGuestFamilyOffer(d,cmd,{workspaceId:this.workspaceId,actorId:c.actor.id,now:c.now.toISOString()});
   await this.tx(c).query('INSERT INTO ls_fishing_billing.quotes(workspace_id,id,family_id,definition_id,revision,payload_ciphertext,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[this.workspaceId,q.id,q.familyId,q.definition.id,q.revision,seal(JSON.stringify(q),quoteAad(this.workspaceId,q.id),this.ring),c.now]);
   return this.journal(c,'create',cmd,q);
  });
 }
 async issueOffer(actor:Actor,raw:unknown):Promise<Receipt>{
  const cmd=commandSchema.extend({quoteId:billingId}).strict().parse(raw);
  return this.context(actor,async c=>{
   const before=await this.quote(c,cmd.quoteId);await this.current(c,actor,'issue',scope(before));
   const old=await this.previous(c,actor,cmd.operationId,'issue',cmd,cmd.quoteId);if(old)return old;
   await this.current(c,actor,'issue',scope(before));const q=issueGuestFamilyOffer(before,cmd.expectedVersion,c.now.toISOString());
   const changed=await one(this.tx(c),'UPDATE ls_fishing_billing.quotes SET revision=$4,payload_ciphertext=$5 WHERE workspace_id=$1 AND id=$2 AND revision=$3 RETURNING id',[this.workspaceId,q.id,before.revision,q.revision,seal(JSON.stringify(q),quoteAad(this.workspaceId,q.id),this.ring)]);requireFact(changed);
   return this.journal(c,'issue',cmd,q);
  });
 }
 async readQuote(actor:Actor,id:string):Promise<GuestFamilyOffer>{
  return this.context(actor,async c=>{const q=await this.quote(c,id);await this.current(c,actor,'read',scope(q));return q;});
 }
 /** Current OWNER read, separate from original immutable operation receipts.
  * Uses actual Native evidence and one shared ledger; never a payment/consent
  * upgrade, grant access, sender or HTTP/runtime mounting. */
 async readSnapshot(actor:Actor,id:string):Promise<GuestOwnerSnapshotV3>{
  return this.context(actor,async c=>{
   const q=await this.quote(c,id);await this.current(c,actor,'read',scope(q));
   requireFact(Date.parse(q.createdAt)<=c.now.valueOf()&&(!q.issuedAt||Date.parse(q.issuedAt)<=c.now.valueOf())&&(!q.acceptance||Date.parse(q.acceptance.acceptedAt)<=c.now.valueOf()));
   await verifyStoredGuestFinancialEvidence(c,q,this.ring);
   const rows=await this.tx(c).query<{id:string;operationId:string;originalId:string|null;recordedAt:Date;ciphertext:string}>('SELECT id,operation_id AS "operationId",original_receipt_id AS "originalId",recorded_at AS "recordedAt",payload_ciphertext AS ciphertext FROM ls_fishing_billing.receipts WHERE workspace_id=$1 AND quote_id=$2 ORDER BY id LIMIT 1001',[this.workspaceId,q.id]);requireFact(rows.length<=1000);
   const receipts=rows.map(row=>{
    const r=ledgerReceiptV2Schema.parse(JSON.parse(unseal(row.ciphertext,'ls_fishing_billing/v1/receipt/'+this.workspaceId+'/'+row.id,this.ring)));
    requireFact(r.id===row.id&&r.operationId===row.operationId&&r.originalReceiptId===row.originalId&&r.quoteId===q.id&&r.familyId===q.familyId&&Date.parse(r.recordedAt)===row.recordedAt.valueOf()&&Date.parse(r.recordedAt)<=c.now.valueOf());return r;
   });
   const attempts=await this.tx(c).query<{id:string;state:string;revision:number;ciphertext:string}>('SELECT id,state,revision,payload_ciphertext AS ciphertext FROM ls_fishing_billing.card_attempts WHERE workspace_id=$1 AND quote_id=$2 ORDER BY id LIMIT 1001',[this.workspaceId,q.id]);requireFact(attempts.length<=1000);
   const pending=attempts.map(row=>{
    const a=cardAttemptSchema.parse(JSON.parse(unseal(row.ciphertext,'ls_fishing_billing/card/v1/attempt/'+this.workspaceId+'/'+row.id,this.ring)));
    requireFact(a.id===row.id&&a.state===row.state&&a.revision===row.revision&&a.workspaceId===this.workspaceId&&a.quoteId===q.id&&a.familyId===q.familyId);return a;
   }).filter(a=>['prepared','unknown','open','pending'].includes(a.state)).map(a=>a.id);
   const balance=projectGuestBalanceV3(q,receipts,pending);
   const exceptions=await this.tx(c).query<{id:string;state:string;ciphertext:string}>('SELECT id,state,payload_ciphertext AS ciphertext FROM ls_fishing_billing.card_exceptions WHERE workspace_id=$1 AND quote_id=$2 LIMIT 1001',[this.workspaceId,q.id]);requireFact(exceptions.length<=1000);
   for(const row of exceptions){
    const e=cardExceptionSchema.parse(JSON.parse(unseal(row.ciphertext,'ls_fishing_billing/card/v1/exception/'+this.workspaceId+'/'+row.id,this.ring)));
    requireFact(e.id===row.id&&e.state===row.state&&e.workspaceId===this.workspaceId&&e.quoteId===q.id&&e.familyId===q.familyId);if(e.state==='open')balance.state='review_required';
   }
   // Authenticate the complete bounded intent set BEFORE selecting statuses.
   const reminders=await this.tx(c).query<{id:string;state:string;intentKey:string;audienceKey:string;scheduledAt:Date;ciphertext:string}>('SELECT id,state,intent_key AS "intentKey",audience_key AS "audienceKey",scheduled_at AS "scheduledAt",payload_ciphertext AS ciphertext FROM ls_fishing_billing.reminders WHERE workspace_id=$1 AND quote_id=$2 ORDER BY id LIMIT 1001',[this.workspaceId,q.id]);requireFact(reminders.length<=1000);
   balance.reminders=reminders.map(row=>{
    const i=reminderIntentSchema.parse(JSON.parse(unseal(row.ciphertext,'ls_fishing_billing/v1/reminder/'+this.workspaceId+'/'+row.id,this.ring)));
    requireFact(i.id===row.id&&i.state===row.state&&i.quoteId===q.id&&i.familyId===q.familyId&&this.hmac({key:i.key})===row.intentKey&&this.hmac({quoteId:i.quoteId,guardianId:i.guardianId})===row.audienceKey&&Date.parse(i.scheduledAt)===row.scheduledAt.valueOf());return {id:i.id,state:i.state};
   });
   await this.current(c,actor,'read',scope(q));return guestOwnerSnapshotV3Schema.parse({quote:q,balance,receiptId:null});
  });
 }
}
