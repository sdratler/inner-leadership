import 'server-only';
import {createHmac,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {AppError} from './errors.ts';
import {freshActor,lockWorkspace} from '../features/identity/data.ts';
import {seal,unseal,type Keyring} from '../features/identity/crypto.ts';
import {one,type IdentityStore,type SqlSession} from '../features/identity/store.ts';
import type {Actor,IdentityClock,WorkspaceId} from '../features/identity/types.ts';
import type {BillingAuthority,BillingContext,BillingScope} from '../features/fishing-billing/native.ts';
import {billingId,createFamilyOfferSchema,commandSchema,publishedOfferSchema,reminderIntentSchema} from '../features/fishing-billing/contracts.ts';
import {ledgerReceiptV2Schema,newYorkDate,type LedgerReceiptV2} from '../features/fishing-billing/contracts-v2.ts';
import {cardAttemptSchema,cardExceptionSchema} from '../features/fishing-billing/card-contracts.ts';
import {createGuestFamilyOffer,issueGuestFamilyOffer,projectGuestBalanceV3,validateGuestCashReceipt,validateGuestReversal,changeGuestBillingState} from '../features/fishing-billing/guest-domain-v3.ts';
import {BILLING_GUEST_V3,guestFamilyOfferSchema,type GuestFamilyOffer,type GuestOwnerSnapshotV3} from './fishing-billing-guest-contract-v3.ts';
import {verifyGuestFamilyOffer} from './fishing-billing-guest-material-v3.ts';
import {verifyStoredGuestFinancialEvidence} from './fishing-billing-guest-evidence-readback.ts';
import {OWNER_MONEY_V3,ownerCurrentV3Schema,compactOwnerOperationResultV3,billingOwnerCommandV3Schema,ownerMoneyReceiptV3Schema,sameGuestOwnerLineage,type BillingOwnerCommandV3,type OwnerMoneyReceiptV3} from './fishing-billing-owner-contract-v3.ts';
import {ANCHORED_OFFER_V3,anchoredOfferCommandV3Schema,anchoredOfferReceiptV3Schema,deriveAnchoredOfferPeriodsV3,verifyAnchoredOfferReceiptV3,
 type AnchoredOfferCommandV3,type ChildPeriodNativeAuthorityV3} from '../features/fishing-billing/child-period-provenance-v3.ts';

const receiptSchema=z.object({
 version:z.literal(BILLING_GUEST_V3),operationId:billingId,action:z.enum(['create','issue']),
 entityId:billingId,entityVersion:z.number().int().positive(),quote:guestFamilyOfferSchema,replayed:z.boolean(),
}).strict().refine(r=>r.entityId===r.quote.id&&r.entityVersion===r.quote.revision,'GUEST_OWNER_RECEIPT_SCOPE');
type Receipt=z.infer<typeof receiptSchema>;
const quoteJournalSchema=z.object({
 version:z.literal(BILLING_GUEST_V3),kind:z.literal('owner_quote'),workspaceId:billingId,
 operationId:billingId,actorId:billingId,action:z.enum(['create','issue']),quoteId:billingId,
 digest:z.string().regex(/^[a-f0-9]{64}$/),receipt:receiptSchema,
}).strict();
const moneyJournalSchema=z.object({
 version:z.literal(OWNER_MONEY_V3),kind:z.literal('owner_money'),workspaceId:billingId,
 operationId:billingId,actorId:billingId,action:z.enum(['cash_date','reverse_cash','state']),quoteId:billingId,
 digest:z.string().regex(/^[a-f0-9]{64}$/),receipt:ownerMoneyReceiptV3Schema,
}).strict();
const anchoredJournalSchema=z.object({
 version:z.literal(ANCHORED_OFFER_V3),kind:z.literal('owner_anchored_quote'),workspaceId:billingId,
 operationId:billingId,actorId:billingId,action:z.literal('create_anchored'),quoteId:billingId,
 digest:z.string().regex(/^[a-f0-9]{64}$/),command:anchoredOfferCommandV3Schema,receipt:anchoredOfferReceiptV3Schema,
}).strict();
const journalSchema=z.discriminatedUnion('kind',[quoteJournalSchema,moneyJournalSchema,anchoredJournalSchema]);
const canonical=(v:unknown):string=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical((v as Record<string,unknown>)[k])).join(',')+'}';
const unavailable=()=>new AppError('UNAVAILABLE');
const requireFact=(v:unknown)=>{if(!v)throw unavailable();};
const quoteAad=(w:string,id:string)=>'ls_fishing_billing/guest/v3/quote/'+w+'/'+id;
// Existing account journal table/AAD, actual owner account, new strict payload.
// Older decoders fail closed instead of treating this as an account acceptance.
const commandAad=(w:string,id:string)=>'ls_fishing_billing/v1/command/'+w+'/'+id;
const scope=(q:GuestFamilyOffer):BillingScope=>({programKey:'fishing_monthly_club',familyId:q.familyId,quoteId:q.id,childIds:[...new Set(q.lines.map(l=>l.childId))]});
type QuoteRow={id:string;familyId:string;definitionId:string;revision:number;createdAt:Date;ciphertext:string};
type JournalRow={actorId:string;action:string;quoteId:string;digest:string;ciphertext:string;createdAt:Date};

/** Unmounted owner planning/current readback and cash/correction/state writes
 * for NEW guest quotes in the existing ledger. Actual Academy source/family/
 * child/policy authority is mandatory. No grant/parent account, guest acceptance,
 * obligation creation, sender/provider, enrollment, migration, runtime fallback
 * or historical conversion is supplied. Issuance creates no debt; money facts
 * require the separate existing financial acceptance. */
export class FishingBillingGuestOwnerStore{
 private readonly key:Buffer;
 private readonly transactions=new WeakMap<object,SqlSession>();
 constructor(private readonly db:IdentityStore,private readonly workspaceId:WorkspaceId,
  private readonly ring:Keyring,digestKey:Buffer,private readonly clock:IdentityClock,
  private readonly authority:BillingAuthority,private readonly childPeriods:ChildPeriodNativeAuthorityV3|null=null){
  billingId.parse(workspaceId);requireFact(digestKey.length>=32);this.key=Buffer.from(digestKey);
 }
 private now(){const n=this.clock.now();requireFact(n instanceof Date&&Number.isFinite(n.valueOf()));return n;}
 private contextCurrent(c:BillingContext){requireFact(c.workspaceId===this.workspaceId&&this.transactions.get(c)===c.tx);}
 private tx(c:BillingContext){this.contextCurrent(c);return c.tx;}
 private hmac(v:unknown){return createHmac('sha256',this.key).update(canonical(v)).digest('hex');}
 private digest(action:'create'|'issue'|'create_anchored',command:unknown){return this.hmac({version:BILLING_GUEST_V3,kind:'owner_quote',workspaceId:this.workspaceId,action,command});}
 private async owner(c:BillingContext,actor:Actor){
  this.contextCurrent(c);
  c.now=this.now();const fresh=await freshActor(c.tx,actor,c.now);
  this.contextCurrent(c);
  requireFact(fresh.workspaceId===this.workspaceId&&fresh.role==='practitioner'&&fresh.state==='active');c.actor=fresh;
 }
 private async current(c:BillingContext,actor:Actor,action:'create'|'issue'|'read'|'cash'|'reverse'|'state',s:BillingScope){
  await this.owner(c,actor);
  // Authority receives the SAME real SQL transaction through a frozen value
  // snapshot, never our mutable owner/clock context or caller's scope array.
  // Retaining the view cannot replace the journal owner/time or shrink the
  // child set used by the final authorization. Date is copied independently.
  const view={...c,actor:{...c.actor},now:new Date(c.now)},scopeView={...s,childIds:[...s.childIds]};
  Object.freeze(view.actor);Object.freeze(view);Object.freeze(scopeView.childIds);Object.freeze(scopeView);
  await this.authority.authorize(view,action,scopeView);await this.owner(c,actor);
 }
 private async context<T>(actor:Actor,work:(c:BillingContext)=>Promise<T>,moneyErrors=false):Promise<T>{
  let callbackError:unknown;
  try{
   requireFact(actor.workspaceId===this.workspaceId);
   return await this.db.transaction(async tx=>{
    callbackError=undefined;
    await lockWorkspace(tx,this.workspaceId);
    const c:BillingContext={tx,workspaceId:this.workspaceId,now:this.now(),actor:await freshActor(tx,actor,this.now())};
    this.transactions.set(c,tx);
    try{await this.owner(c,actor);return await work(c);}catch(error){callbackError=error;throw error;}finally{this.transactions.delete(c);}
   });
  }catch(error){
   // Only a known error actually raised by the transaction callback denotes a
   // rejected work/rollback path. A driver may throw an identically coded error
   // AFTER COMMIT: that outcome must stay uncertain and recover the same op.
   if(moneyErrors&&callbackError===error&&error instanceof AppError&&['CONFLICT','INVALID_REQUEST'].includes(error.code))throw error;throw unavailable();
  }
 }
 private async quoteRecord(c:BillingContext,id:string){
  this.contextCurrent(c);
  const r=await one<QuoteRow>(this.tx(c),'SELECT id,family_id AS "familyId",definition_id AS "definitionId",revision,created_at AS "createdAt",payload_ciphertext AS ciphertext FROM ls_fishing_billing.quotes WHERE workspace_id=$1 AND id=$2 FOR UPDATE',[this.workspaceId,billingId.parse(id)]);
  if(!r)throw unavailable();const q=verifyGuestFamilyOffer(JSON.parse(unseal(r.ciphertext,quoteAad(this.workspaceId,id),this.ring)));
  requireFact(q.workspaceId===this.workspaceId&&q.id===r.id&&q.familyId===r.familyId&&q.definition.id===r.definitionId&&q.revision===r.revision&&Date.parse(q.createdAt)===r.createdAt.valueOf());return {row:r,quote:q};
 }
 private async quote(c:BillingContext,id:string){return (await this.quoteRecord(c,id)).quote;}
 private async commandRecord(c:BillingContext,id:string){
  const row=await one<JournalRow>(this.tx(c),'SELECT actor_id AS "actorId",action,quote_id AS "quoteId",request_digest AS digest,created_at AS "createdAt",result_ciphertext AS ciphertext FROM ls_fishing_billing.commands WHERE workspace_id=$1 AND operation_id=$2',[this.workspaceId,id]);
  if(!row)return null;
  const record=journalSchema.parse(JSON.parse(unseal(row.ciphertext,commandAad(this.workspaceId,id),this.ring)));
  requireFact(record.workspaceId===this.workspaceId&&record.operationId===id&&record.actorId===row.actorId&&row.action==='guest_'+record.action&&record.quoteId===row.quoteId&&record.digest===row.digest);
  if(record.kind==='owner_money')requireFact(Date.parse(record.receipt.recordedAt)===row.createdAt.valueOf());
  if(record.kind==='owner_anchored_quote'){
   const receipt=verifyAnchoredOfferReceiptV3(record.receipt,record.command);
   requireFact(record.quoteId===receipt.entityId&&record.operationId===receipt.operationId&&record.command.operationId===id&&
    receipt.quote.workspaceId===this.workspaceId&&!receipt.replayed&&record.digest===this.digest('create_anchored',record.command)&&
    (!receipt.quote.override||receipt.quote.override.actorId===record.actorId)&&Date.parse(receipt.quote.createdAt)===row.createdAt.valueOf());
  }
  return {row,record};
 }
 private async previous(c:BillingContext,actor:Actor,operationId:string,action:'create'|'issue',command:unknown,quoteId:string):Promise<Receipt|null>{
  const found=await this.commandRecord(c,operationId);if(!found)return null;
  const {row:r,record:j}=found;if(j.kind!=='owner_quote')throw unavailable();
  const receipt=j.receipt,q=verifyGuestFamilyOffer(receipt.quote);
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
  const record=quoteJournalSchema.parse({version:BILLING_GUEST_V3,kind:'owner_quote',workspaceId:this.workspaceId,operationId:command.operationId,actorId:c.actor.id,action,quoteId:q.id,digest,receipt});
  await this.tx(c).query('INSERT INTO ls_fishing_billing.commands(workspace_id,operation_id,actor_id,action,quote_id,request_digest,result_ciphertext,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[this.workspaceId,command.operationId,c.actor.id,'guest_'+action,q.id,digest,seal(JSON.stringify(record),commandAad(this.workspaceId,command.operationId),this.ring),c.now]);return receipt;
 }
 private async firstPeriods(c:BillingContext,command:AnchoredOfferCommandV3){
  if(!this.childPeriods)throw unavailable();
  const view=Object.freeze({...c,actor:Object.freeze({...c.actor}),now:new Date(c.now)});
  const children=Object.freeze(command.children.map(child=>Object.freeze({...child})));
  const facts=await this.childPeriods.firstEligibleLessons(view,Object.freeze({quoteId:command.id,familyId:command.familyId,children}));
  this.contextCurrent(c);
  return deriveAnchoredOfferPeriodsV3(command,this.workspaceId,facts);
 }
 private async anchoredRecord(c:BillingContext,q:GuestFamilyOffer){
  const rows=await this.tx(c).query<{operationId:string}>('SELECT operation_id AS "operationId" FROM ls_fishing_billing.commands WHERE workspace_id=$1 AND quote_id=$2 AND action=$3 LIMIT 2 FOR SHARE',[this.workspaceId,q.id,'guest_create_anchored']);
  if(rows.length===0)return null;requireFact(rows.length===1);
  const found=await this.commandRecord(c,rows[0]!.operationId);requireFact(found?.record.kind==='owner_anchored_quote');
  if(!found||found.record.kind!=='owner_anchored_quote')throw unavailable();
  verifyAnchoredOfferReceiptV3(found.record.receipt,found.record.command,q);return found.record;
 }
 /** Strict prospective path: dates come from actual native lesson facts, not
  * request fields. Quote and encrypted source provenance share one commit. */
 async createAnchoredOffer(actor:Actor,raw:unknown){
  const command=anchoredOfferCommandV3Schema.parse(raw);
  return this.context(actor,async c=>{
   const s:BillingScope={programKey:'fishing_monthly_club',quoteId:command.id,familyId:command.familyId,childIds:command.children.map(child=>child.childId)};
   await this.current(c,actor,'create',s);
   const prior=await this.commandRecord(c,command.operationId);
   if(prior){
    const j=prior.record;requireFact(j.kind==='owner_anchored_quote');if(j.kind!=='owner_anchored_quote')throw unavailable();
    requireFact(j.actorId===c.actor.id&&j.quoteId===command.id&&j.digest===this.digest('create_anchored',command));
    const q=await this.quote(c,command.id);verifyAnchoredOfferReceiptV3(j.receipt,command,q);
    await this.current(c,actor,'read',scope(q));return {...j.receipt,replayed:true};
   }
   const row=await one<{id:string;publishedAt:Date;ciphertext:string}>(this.tx(c),'SELECT id,published_at AS "publishedAt",payload_ciphertext AS ciphertext FROM ls_fishing_billing.definitions WHERE workspace_id=$1 AND id=$2 FOR SHARE',[this.workspaceId,command.definitionId]);if(!row)throw unavailable();
   const definition=publishedOfferSchema.parse(JSON.parse(unseal(row.ciphertext,'ls_fishing_billing/v1/definition/'+this.workspaceId+'/'+command.definitionId,this.ring)));
   requireFact(definition.id===row.id&&definition.id===command.definitionId&&Date.parse(definition.publishedAt)===row.publishedAt.valueOf());
   const periods=await this.firstPeriods(c,command);
   const quote=createGuestFamilyOffer(definition,{operationId:command.operationId,id:command.id,familyId:command.familyId,definitionId:command.definitionId,override:command.override,children:command.children.map((child,index)=>({
    lineId:child.lineId,childId:child.childId,groupId:child.groupId,dueAt:child.dueAt,period:periods[index]!.period,
   }))},{workspaceId:this.workspaceId,actorId:c.actor.id,now:c.now.toISOString()});
   const receipt=verifyAnchoredOfferReceiptV3({version:ANCHORED_OFFER_V3,operationId:command.operationId,action:'create_anchored',entityId:quote.id,entityVersion:1,quote,periods,replayed:false},command);
   await this.tx(c).query('INSERT INTO ls_fishing_billing.quotes(workspace_id,id,family_id,definition_id,revision,payload_ciphertext,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[this.workspaceId,quote.id,quote.familyId,quote.definition.id,quote.revision,seal(JSON.stringify(quote),quoteAad(this.workspaceId,quote.id),this.ring),c.now]);
   const record=anchoredJournalSchema.parse({version:ANCHORED_OFFER_V3,kind:'owner_anchored_quote',workspaceId:this.workspaceId,operationId:command.operationId,actorId:c.actor.id,action:'create_anchored',quoteId:quote.id,digest:this.digest('create_anchored',command),command,receipt});
   await this.tx(c).query('INSERT INTO ls_fishing_billing.commands(workspace_id,operation_id,actor_id,action,quote_id,request_digest,result_ciphertext,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[this.workspaceId,command.operationId,c.actor.id,'guest_create_anchored',quote.id,record.digest,seal(JSON.stringify(record),commandAad(this.workspaceId,command.operationId),this.ring),c.now]);
   await this.current(c,actor,'create',s);
   requireFact(canonical(await this.firstPeriods(c,command))===canonical(periods));
   await this.owner(c,actor);return receipt;
  });
 }
 /** Original scheduling provenance, including after later issuance/cancellation.
  * Financial acceptance/balance still requires the existing current-ledger
  * evidence reader; this read does not certify current lesson eligibility. */
 async readAnchoredOffer(actor:Actor,id:string){
  return this.context(actor,async c=>{
   const quote=await this.quote(c,id);await this.current(c,actor,'read',scope(quote));
   const record=await this.anchoredRecord(c,quote);if(!record)throw unavailable();
   await this.current(c,actor,'read',scope(quote));return {version:ANCHORED_OFFER_V3,quote,periods:record.receipt.periods};
  });
 }
 async issueAnchoredOffer(actor:Actor,raw:unknown){return this.issueOfferInternal(actor,raw,true);}
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
 async issueOffer(actor:Actor,raw:unknown):Promise<Receipt>{return this.issueOfferInternal(actor,raw,false);}
 private async issueOfferInternal(actor:Actor,raw:unknown,requireAnchored:boolean):Promise<Receipt>{
  const cmd=commandSchema.extend({quoteId:billingId}).strict().parse(raw);
  return this.context(actor,async c=>{
   const before=await this.quote(c,cmd.quoteId);await this.current(c,actor,'issue',scope(before));
   const original=await this.anchoredRecord(c,before);if(requireAnchored&&!original)throw unavailable();
   const old=await this.previous(c,actor,cmd.operationId,'issue',cmd,cmd.quoteId);if(old)return old;
   if(original)requireFact(canonical(await this.firstPeriods(c,original.command))===canonical(original.receipt.periods));
   await this.current(c,actor,'issue',scope(before));const q=issueGuestFamilyOffer(before,cmd.expectedVersion,c.now.toISOString());
   const changed=await one(this.tx(c),'UPDATE ls_fishing_billing.quotes SET revision=$4,payload_ciphertext=$5 WHERE workspace_id=$1 AND id=$2 AND revision=$3 RETURNING id',[this.workspaceId,q.id,before.revision,q.revision,seal(JSON.stringify(q),quoteAad(this.workspaceId,q.id),this.ring)]);requireFact(changed);
   const receipt=await this.journal(c,'issue',cmd,q);
   if(original){
    await this.current(c,actor,'issue',scope(q));
    requireFact(canonical(await this.firstPeriods(c,original.command))===canonical(original.receipt.periods));
    await this.owner(c,actor);
   }
   return receipt;
  });
 }
 async readQuote(actor:Actor,id:string):Promise<GuestFamilyOffer>{
  return this.context(actor,async c=>{const q=await this.quote(c,id);await this.current(c,actor,'read',scope(q));return q;});
 }
 /** Current OWNER read, separate from original immutable operation receipts.
  * Uses actual Native evidence and one shared ledger; never a payment/consent
  * upgrade, grant access, sender or HTTP/runtime mounting. */
 async readSnapshot(actor:Actor,id:string):Promise<GuestOwnerSnapshotV3>{
  return this.context(actor,async c=>this.snapshot(c,actor,await this.quote(c,id)));
 }
 private async snapshot(c:BillingContext,actor:Actor,q:GuestFamilyOffer):Promise<GuestOwnerSnapshotV3>{
   await this.current(c,actor,'read',scope(q));
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
   await this.current(c,actor,'read',scope(q));return ownerCurrentV3Schema.parse({quote:q,balance,receiptId:null});
 }
 private moneyDigest(input:BillingOwnerCommandV3){return this.hmac({version:OWNER_MONEY_V3,kind:'owner_money',workspaceId:this.workspaceId,action:input.action,command:input.command});}
 private async previousMoney(c:BillingContext,input:BillingOwnerCommandV3,current:GuestOwnerSnapshotV3):Promise<OwnerMoneyReceiptV3|null>{
  const found=await this.commandRecord(c,input.command.operationId);if(!found)return null;
  const j=found.record;
  if(j.kind!=='owner_money'||j.actorId!==c.actor.id||j.action!==input.action||j.quoteId!==input.command.quoteId||j.digest!==this.moneyDigest(input))throw new AppError('CONFLICT');
  requireFact(j.receipt.operationId===input.command.operationId&&j.receipt.action===input.action&&j.receipt.entityId===j.quoteId&&!j.receipt.replayed&&sameGuestOwnerLineage(j.receipt.result,current));
  return {...j.receipt,replayed:true};
 }
 private async suppressQueued(c:BillingContext,q:GuestFamilyOffer,balance:GuestOwnerSnapshotV3['balance']){
  const reason=q.state==='cancelled'?'cancelled':q.paused?'owner_paused':q.acceptance&&balance.remainingMinor===0?'paid':null;if(!reason)return;
  const rows=await this.tx(c).query<{id:string;ciphertext:string}>("SELECT id,payload_ciphertext AS ciphertext FROM ls_fishing_billing.reminders WHERE workspace_id=$1 AND quote_id=$2 AND state='queued' ORDER BY id LIMIT 1001 FOR UPDATE",[this.workspaceId,q.id]);requireFact(rows.length<=1000);
  for(const row of rows){
   const i=reminderIntentSchema.parse(JSON.parse(unseal(row.ciphertext,'ls_fishing_billing/v1/reminder/'+this.workspaceId+'/'+row.id,this.ring)));
   requireFact(i.id===row.id&&i.quoteId===q.id&&i.familyId===q.familyId&&i.state==='queued');
   const after=reminderIntentSchema.parse({...i,state:'suppressed',reason});
   const changed=await one(this.tx(c),"UPDATE ls_fishing_billing.reminders SET state='suppressed',payload_ciphertext=$3 WHERE workspace_id=$1 AND id=$2 AND quote_id=$4 AND state='queued' AND payload_ciphertext=$5 RETURNING id",[this.workspaceId,i.id,seal(JSON.stringify(after),'ls_fishing_billing/v1/reminder/'+this.workspaceId+'/'+i.id,this.ring),q.id,row.ciphertext]);requireFact(changed);
  }
 }
 private async mutateMoney(actor:Actor,raw:unknown):Promise<OwnerMoneyReceiptV3>{
  const parsed=billingOwnerCommandV3Schema.safeParse(raw);if(!parsed.success)throw new AppError('INVALID_REQUEST');const input=parsed.data,cmd=input.command;
  return this.context(actor,async c=>{
   const {quote:q,row}=await this.quoteRecord(c,cmd.quoteId),before=await this.snapshot(c,actor,q);
   const prior=await this.previousMoney(c,input,before);if(prior)return prior;
   if(q.revision!==cmd.expectedVersion)throw new AppError('CONFLICT');
   await this.current(c,actor,input.action==='cash_date'?'cash':input.action==='reverse_cash'?'reverse':'state',scope(q));
   const recordedAt=c.now.toISOString(),actorId=c.actor.id;let receipt:LedgerReceiptV2|null=null,after:GuestFamilyOffer;
   if(input.action==='cash_date'){
    const m=input.command;
    if(m.receivedDate>newYorkDate(recordedAt))throw new AppError('INVALID_REQUEST');
    receipt=validateGuestCashReceipt(q,before.balance.receipts,{id:randomUUID(),operationId:m.operationId,quoteId:q.id,familyId:q.familyId,kind:'cash',currency:'USD',amountMinor:m.amountMinor,allocations:m.allocations,originalReceiptId:null,actorId,receivedPrecision:'date',receivedDate:m.receivedDate,timeZone:m.timeZone,recordedAt,reason:null,provider:null});
    after=verifyGuestFamilyOffer({...q,revision:q.revision+1});
   }else if(input.action==='reverse_cash'){
    const m=input.command;
    receipt=validateGuestReversal(q,before.balance.receipts,{id:randomUUID(),operationId:m.operationId,quoteId:q.id,familyId:q.familyId,kind:'cash_reversal',currency:'USD',amountMinor:m.amountMinor,allocations:m.allocations,originalReceiptId:m.originalReceiptId,actorId,receivedAt:recordedAt,recordedAt,reason:m.reason,provider:null});
    after=verifyGuestFamilyOffer({...q,revision:q.revision+1});
   }else after=changeGuestBillingState(q,cmd.expectedVersion,{paused:input.command.paused,cancel:input.command.cancel});
   if(receipt)await this.tx(c).query('INSERT INTO ls_fishing_billing.receipts(workspace_id,id,quote_id,operation_id,original_receipt_id,payload_ciphertext,recorded_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[this.workspaceId,receipt.id,q.id,receipt.operationId,receipt.originalReceiptId,seal(JSON.stringify(receipt),'ls_fishing_billing/v1/receipt/'+this.workspaceId+'/'+receipt.id,this.ring),recordedAt]);
   const saved=await one(this.tx(c),'UPDATE ls_fishing_billing.quotes SET revision=$3,payload_ciphertext=$4 WHERE workspace_id=$1 AND id=$2 AND revision=$5 AND payload_ciphertext=$6 AND family_id=$7 AND definition_id=$8 AND created_at=$9 RETURNING id',[this.workspaceId,q.id,after.revision,seal(JSON.stringify(after),quoteAad(this.workspaceId,q.id),this.ring),row.revision,row.ciphertext,row.familyId,row.definitionId,row.createdAt]);if(!saved)throw new AppError('CONFLICT');
   const balance=projectGuestBalanceV3(after,receipt?[...before.balance.receipts,receipt]:before.balance.receipts,before.balance.pendingAttemptIds);await this.suppressQueued(c,after,balance);
   const current=await this.snapshot(c,actor,after),result=compactOwnerOperationResultV3(current,receipt?.id??null),operation=ownerMoneyReceiptV3Schema.parse({version:OWNER_MONEY_V3,operationId:cmd.operationId,action:input.action,entityId:q.id,entityVersion:after.revision,recordedAt,replayed:false,result}),digest=this.moneyDigest(input);
   const record=moneyJournalSchema.parse({version:OWNER_MONEY_V3,kind:'owner_money',workspaceId:this.workspaceId,operationId:cmd.operationId,actorId,action:input.action,quoteId:q.id,digest,receipt:operation});
   await this.tx(c).query('INSERT INTO ls_fishing_billing.commands(workspace_id,operation_id,actor_id,action,quote_id,request_digest,result_ciphertext,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[this.workspaceId,cmd.operationId,actorId,'guest_'+input.action,q.id,digest,seal(JSON.stringify(record),commandAad(this.workspaceId,cmd.operationId),this.ring),recordedAt]);return operation;
  },true);
 }
 recordCashDate(actor:Actor,raw:unknown){return this.mutateMoney(actor,{action:'cash_date',command:raw});}
 reverseCash(actor:Actor,raw:unknown){return this.mutateMoney(actor,{action:'reverse_cash',command:raw});}
 setState(actor:Actor,raw:unknown){return this.mutateMoney(actor,{action:'state',command:raw});}
 async readMoneyOperationReceipt(actor:Actor,id:string):Promise<OwnerMoneyReceiptV3|null>{
  billingId.parse(id);return this.context(actor,async c=>{
   const found=await this.commandRecord(c,id);if(!found)return null;
   const j=found.record;requireFact(j.kind==='owner_money'&&j.actorId===c.actor.id);if(j.kind!=='owner_money')throw unavailable();
   const current=await this.snapshot(c,actor,await this.quote(c,j.quoteId));requireFact(j.receipt.operationId===id&&j.receipt.action===j.action&&j.receipt.entityId===j.quoteId&&!j.receipt.replayed&&sameGuestOwnerLineage(j.receipt.result,current));return {...j.receipt,replayed:true};
  });
 }
}
