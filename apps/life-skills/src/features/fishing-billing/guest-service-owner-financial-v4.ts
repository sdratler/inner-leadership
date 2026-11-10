import 'server-only';
import {createHmac} from 'node:crypto';
import {AppError} from '../../lib/errors.ts';
import {canonical} from '../contact-ops/core/validation.ts';
import {unseal,type Keyring} from '../identity/crypto.ts';
import type {Actor,WorkspaceId,IdentityClock} from '../identity/types.ts';
import type {SqlSession} from '../identity/store.ts';
import type {BillingContext} from './native.ts';
import {billingId,reminderIntentSchema} from './contracts.ts';
import {ledgerReceiptV2Schema} from './contracts-v2.ts';
import {cardAttemptSchema,cardExceptionSchema} from './card-contracts.ts';
import {BILLING_SERVICE_V4,type ServiceFamilyOfferV4} from './guest-service-contract-v4.ts';
import {serviceOwnerSnapshotV4Schema,type ServiceOwnerSnapshotV4} from './guest-service-owner-financial-contract-v4.ts';
import {projectServiceBalanceV4} from './guest-service-domain-v4.ts';
import {FishingProgramSourceNativeV3} from './program-source-native-v3.ts';
import {FishingBillingInquiryFamilyProposals} from '../../lib/fishing-billing-inquiry-family-proposal.ts';
import {readProgramSourceInTransactionV3} from './program-source-readback-v3.ts';
import {readIssuedServiceQuoteV4} from './guest-service-quote-readback-v4.ts';
import {readServiceAcceptanceDataV4} from './guest-service-acceptance-data-v4.ts';

export type ServiceOwnerFinancialScopeV4=Readonly<{action:'read';programKey:'fishing_monthly_club';quoteId:string;familyId:string;childIds:readonly string[];offerSha256:string}>;
export interface ServiceOwnerFinancialAuthorityV4{
 /** Actual current Academy/schema/read admission before ANY private lookup.
  * The programme component separately enforces the genuine configured owner,
  * adult native subject, non-demo account and pinned current session. */
 target(context:Readonly<BillingContext>):Promise<void>;
 /** Current owner financial access under these SAME native locks. Historical
  * evidence never becomes fresh guardian/legal/provider/seat permission. */
 authorize(context:Readonly<BillingContext>,scope:ServiceOwnerFinancialScopeV4):Promise<void>;
}
function stored(condition:unknown):asserts condition{if(!condition)throw new AppError('UNAVAILABLE');}
/** Current genuinely authenticated OWNER history/balance only. No grant token
 * or parent/student login is substituted for the existing owner session. The
 * original acceptance can be read after expiry/revocation without renewing a
 * grant or changing original consent, debt, receipt, reservation or provider.
 * Same existing receipt/attempt/exception/reminder tables and money calculator. */
export class FishingServiceBillingOwnerV4{
 private readonly commandKey:Buffer;private readonly ledgerKey:Buffer;private readonly now:()=>Date;
 constructor(private readonly workspaceId:WorkspaceId,private readonly programme:FishingProgramSourceNativeV3,private readonly families:FishingBillingInquiryFamilyProposals,
  private readonly ring:Keyring,private readonly sourceKey:string,commandKey:Buffer,ledgerKey:Buffer,clock:IdentityClock,private readonly authority:ServiceOwnerFinancialAuthorityV4){
  stored(billingId.safeParse(workspaceId).success&&sourceKey.length>=32&&commandKey.length>=32&&ledgerKey.length>=32&&authority);
  this.commandKey=Buffer.from(commandKey);this.ledgerKey=Buffer.from(ledgerKey);this.now=clock.now.bind(clock);
 }
 private async permission(c:Readonly<BillingContext>,q?:ServiceFamilyOfferV4){
  const view=Object.freeze({...c,now:new Date(c.now)}),at=view.now.valueOf();await this.authority.target(view);stored(view.now.valueOf()===at);
  if(q){const scope=Object.freeze({action:'read' as const,programKey:'fishing_monthly_club' as const,quoteId:q.id,familyId:q.familyId,childIds:Object.freeze(q.lines.map(l=>l.childId)),offerSha256:q.offer.sha256});
   await this.authority.authorize(view,scope);stored(view.now.valueOf()===at);
  }
 }
 private async currentFamily(c:Readonly<BillingContext>,q:ServiceFamilyOfferV4){
  for(const l of q.lines){stored(l.groupId);
   const p=await readProgramSourceInTransactionV3(c,this.workspaceId,l.groupId,'progression',l.childId,this.ring,this.sourceKey);stored(p&&p.record.command.kind==='progression');
   const f=p.record.command.fields;stored(f.familyId===q.familyId);
   const current=await this.families.readCurrentDataInTransaction(c.tx,{proposalId:f.proposalId,reference:f.reference,expectedEpoch:f.expectedEpoch,lock:'shared'});
   stored(current.proposal.workspaceId===this.workspaceId&&current.proposal.command.selection.familyId===q.familyId&&current.proposal.command.selection.children.some(child=>child.nativeChildId===l.childId));
  }
 }
 private async withCurrent<T>(actor:Actor,id:string,work:(c:Readonly<BillingContext>,data:Awaited<ReturnType<typeof readServiceAcceptanceDataV4>>)=>Promise<T>){
  billingId.parse(id);return this.programme.withOwnerTransaction(actor,async base=>{
   const tx=base.tx,physical=tx.query,time=base.now,at=time.valueOf(),query=physical.bind(tx);let open=true;
   const guard=()=>stored(open&&base.workspaceId===this.workspaceId&&base.actor.workspaceId===this.workspaceId&&base.tx===tx&&tx.query===physical&&base.now===time&&time.valueOf()===at);
   const now=this.now();stored(now instanceof Date&&Number.isFinite(now.valueOf()));
   const pinned:SqlSession=Object.freeze({query:async<R extends object>(sql:string,v:readonly unknown[]=[])=>{guard();const rows=await query<R>(sql,v);guard();return rows;}});
   const c=Object.freeze({workspaceId:this.workspaceId,actor:base.actor,now:new Date(now),tx:pinned});
   try{
    guard();await this.permission(c);const q=await readIssuedServiceQuoteV4(c,this.workspaceId,id,this.ring,this.sourceKey);
    await this.permission(c,q);await this.currentFamily(c,q);
    const data=await readServiceAcceptanceDataV4(Object.freeze({...c,now:this.now()}),this.workspaceId,id,this.ring,this.sourceKey,this.commandKey);stored(canonical(data.quote)===canonical(q));
    const result=await work(c,data);
    await this.permission(c,q);await this.currentFamily(c,q);stored(canonical(await readIssuedServiceQuoteV4(c,this.workspaceId,id,this.ring,this.sourceKey))===canonical(q));
    guard();return result;
   }finally{open=false;}
  });
 }
 /** Exact original receipt resolves only that operation. Its original unpaid
  * state is not the current balance and never resolves a provider outcome. */
 async readOriginalAcceptance(actor:Actor,quoteId:string,operationId:string){
  billingId.parse(operationId);return this.withCurrent(actor,quoteId,async(_c,data)=>{
   stored(data.original&&data.original.receipt.operationId===operationId);return data.original.receipt;
  });
 }
 async readSnapshot(actor:Actor,id:string):Promise<ServiceOwnerSnapshotV4>{
  return this.withCurrent(actor,id,async(c,data)=>{
   const q=data.quote;
   const rows=await c.tx.query<{id:string;operationId:string;originalId:string|null;recordedAt:Date;exactTime:boolean;ciphertext:string}>('SELECT id,operation_id AS "operationId",original_receipt_id AS "originalId",recorded_at AS "recordedAt",recorded_at=date_trunc(\'milliseconds\',recorded_at) AS "exactTime",payload_ciphertext AS ciphertext FROM ls_fishing_billing.receipts WHERE workspace_id=$1 AND quote_id=$2 ORDER BY id LIMIT 1001',[this.workspaceId,id]);stored(rows.length<=1000);
   const receipts=rows.map(row=>{const r=ledgerReceiptV2Schema.parse(JSON.parse(unseal(row.ciphertext,'ls_fishing_billing/v1/receipt/'+this.workspaceId+'/'+row.id,this.ring)));
    stored(row.exactTime===true&&r.id===row.id&&r.operationId===row.operationId&&r.originalReceiptId===row.originalId&&r.quoteId===q.id&&r.familyId===q.familyId&&Date.parse(r.recordedAt)===row.recordedAt.valueOf()&&Date.parse(r.recordedAt)<=c.now.valueOf());return r;
   });
   const attempts=await c.tx.query<{id:string;state:string;revision:number;ciphertext:string}>('SELECT id,state,revision,payload_ciphertext AS ciphertext FROM ls_fishing_billing.card_attempts WHERE workspace_id=$1 AND quote_id=$2 ORDER BY id LIMIT 1001',[this.workspaceId,id]);stored(attempts.length<=1000);
   const cards=attempts.map(row=>{const a=cardAttemptSchema.parse(JSON.parse(unseal(row.ciphertext,'ls_fishing_billing/card/v1/attempt/'+this.workspaceId+'/'+row.id,this.ring)));
    stored(a.id===row.id&&a.state===row.state&&a.revision===row.revision&&a.workspaceId===this.workspaceId&&a.quoteId===q.id&&a.familyId===q.familyId&&Date.parse(a.createdAt)<=c.now.valueOf());return a;
   });
   const balance=projectServiceBalanceV4(q,receipts,cards.filter(a=>['prepared','unknown','open','pending'].includes(a.state)).map(a=>a.id));
   // An attempt's claimed paid state is not a money receipt. Retain a review
   // conflict rather than suggesting another payment or inventing settlement.
   if(cards.some(a=>a.state==='review_required'||a.state==='paid'&&!receipts.some(r=>r.kind==='card'&&r.provider?.accountId===a.binding.accountId&&r.provider.transactionId===a.paymentIntentId&&r.amountMinor>=a.preparation.result.amountMinor)))balance.state='review_required';
   const exceptions=await c.tx.query<{id:string;state:string;ciphertext:string}>('SELECT id,state,payload_ciphertext AS ciphertext FROM ls_fishing_billing.card_exceptions WHERE workspace_id=$1 AND quote_id=$2 ORDER BY id LIMIT 1001',[this.workspaceId,id]);stored(exceptions.length<=1000);
   for(const row of exceptions){const e=cardExceptionSchema.parse(JSON.parse(unseal(row.ciphertext,'ls_fishing_billing/card/v1/exception/'+this.workspaceId+'/'+row.id,this.ring)));
    stored(e.id===row.id&&e.state===row.state&&e.workspaceId===this.workspaceId&&e.quoteId===q.id&&e.familyId===q.familyId&&Date.parse(e.recordedAt)<=c.now.valueOf());if(e.state==='open')balance.state='review_required';
   }
   const reminders=await c.tx.query<{id:string;state:string;intentKey:string;audienceKey:string;scheduledAt:Date;exactTime:boolean;ciphertext:string}>('SELECT id,state,intent_key AS "intentKey",audience_key AS "audienceKey",scheduled_at AS "scheduledAt",scheduled_at=date_trunc(\'milliseconds\',scheduled_at) AS "exactTime",payload_ciphertext AS ciphertext FROM ls_fishing_billing.reminders WHERE workspace_id=$1 AND quote_id=$2 ORDER BY id LIMIT 1001',[this.workspaceId,id]);stored(reminders.length<=1000);
   const hmac=(v:unknown)=>createHmac('sha256',this.ledgerKey).update(canonical(v)).digest('hex');
   balance.reminders=reminders.map(row=>{const i=reminderIntentSchema.parse(JSON.parse(unseal(row.ciphertext,'ls_fishing_billing/v1/reminder/'+this.workspaceId+'/'+row.id,this.ring)));
    stored(row.exactTime===true&&i.id===row.id&&i.state===row.state&&i.quoteId===q.id&&i.familyId===q.familyId&&hmac({key:i.key})===row.intentKey&&hmac({quoteId:q.id,guardianId:i.guardianId})===row.audienceKey&&Date.parse(i.scheduledAt)===row.scheduledAt.valueOf());return {id:i.id,state:i.state};
   });
   return serviceOwnerSnapshotV4Schema.parse({version:BILLING_SERVICE_V4,quote:q,balance,receiptId:null});
  });
 }
}
