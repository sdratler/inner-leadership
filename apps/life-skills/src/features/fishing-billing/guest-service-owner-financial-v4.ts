import 'server-only';
import {createHmac,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {AppError} from '../../lib/errors.ts';
import {canonical} from '../contact-ops/core/validation.ts';
import {seal,unseal,type Keyring} from '../identity/crypto.ts';
import type {Actor,WorkspaceId,IdentityClock} from '../identity/types.ts';
import {one,type SqlSession} from '../identity/store.ts';
import type {BillingContext} from './native.ts';
import {billingId,reminderIntentSchema} from './contracts.ts';
import {ledgerReceiptV2Schema,dateCashReceiptSchema,newYorkDate,type LedgerReceiptV2} from './contracts-v2.ts';
import {BILLING_SERVICE_V4,type ServiceFamilyOfferV4} from './guest-service-contract-v4.ts';
import {type ServiceOwnerSnapshotV4} from './guest-service-owner-financial-contract-v4.ts';
import {projectServiceBalanceV4} from './guest-service-domain-v4.ts';
import {FishingProgramSourceNativeV3} from './program-source-native-v3.ts';
import {FishingBillingInquiryFamilyProposals} from '../../lib/fishing-billing-inquiry-family-proposal.ts';
import {readIssuedServiceQuoteV4,readIssuedServiceQuoteWithRowV4} from './guest-service-quote-readback-v4.ts';
import {readServiceAcceptanceDataV4} from './guest-service-acceptance-data-v4.ts';
import {readServiceCurrentFamilyDataV4,readServiceFinancialSnapshotV4} from './guest-service-financial-data-v4.ts';
import {serviceGuestAadV4} from './guest-service-aad-v4.ts';
import {serviceFamilyOfferV4Schema} from './guest-service-contract-v4.ts';
import {serviceOwnerMoneyCommandV4Schema,serviceOwnerMoneyReceiptV4Schema,serviceOwnerMoneyOutcomeV4Schema,serviceMoneySnapshotV4,type ServiceOwnerMoneyCommandV4} from './guest-service-owner-money-contract-v4.ts';
import {serviceStateCommandV4Schema,serviceStateReceiptV4Schema,serviceStateOutcomeV4Schema,type ServiceStateCommandV4} from './guest-service-owner-state-contract-v4.ts';
import {serviceStateColumnsV4,decodeServiceStateJournalV4,serviceStateCommandDigestV4,serviceStateResultDigestV4,serviceStateJournalV4Schema,type ServiceStateRowV4} from './guest-service-state-data-v4.ts';

export type ServiceOwnerFinancialScopeV4=Readonly<{action:'read'|'cash_date'|'reverse_cash'|'state';programKey:'fishing_monthly_club';quoteId:string;familyId:string;childIds:readonly string[];offerSha256:string}>;
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
const moneyJournalSchema=z.object({version:z.literal(BILLING_SERVICE_V4),kind:z.literal('owner_service_money'),workspaceId:billingId,actorId:billingId,input:serviceOwnerMoneyCommandV4Schema,
 commandDigest:z.string().regex(/^[a-f0-9]{64}$/),resultDigest:z.string().regex(/^[a-f0-9]{64}$/),receipt:serviceOwnerMoneyReceiptV4Schema}).strict();
/** Current genuinely authenticated OWNER history/balance and manual cash. No grant token
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
 private async permission(c:Readonly<BillingContext>,q?:ServiceFamilyOfferV4,action:ServiceOwnerFinancialScopeV4['action']='read'){
  const view=Object.freeze({...c,now:new Date(c.now)}),at=view.now.valueOf();await this.authority.target(view);stored(view.now.valueOf()===at);
  if(q){const scope=Object.freeze({action,programKey:'fishing_monthly_club' as const,quoteId:q.id,familyId:q.familyId,childIds:Object.freeze(q.lines.map(l=>l.childId)),offerSha256:q.offer.sha256});
   await this.authority.authorize(view,scope);stored(view.now.valueOf()===at);
  }
 }
 private currentFamily(c:Readonly<BillingContext>,q:ServiceFamilyOfferV4){return readServiceCurrentFamilyDataV4(c,this.workspaceId,q,this.ring,this.sourceKey,this.families);}
 private async withCurrent<T>(actor:Actor,id:string,work:(c:Readonly<BillingContext>,data:Awaited<ReturnType<typeof readServiceAcceptanceDataV4>>)=>Promise<T>){
  billingId.parse(id);return this.programme.withOwnerTransaction(actor,base=>this.inCurrent(base,id,'read',async(c,data)=>({result:await work(c,data),quote:data.quote})));
 }
 private async inCurrent<T>(base:Readonly<BillingContext>,id:string,action:ServiceOwnerFinancialScopeV4['action'],work:(c:Readonly<BillingContext>,data:Awaited<ReturnType<typeof readServiceAcceptanceDataV4>>)=>Promise<{result:T;quote:ServiceFamilyOfferV4}>){
   const tx=base.tx,physical=tx.query,time=base.now,at=time.valueOf(),query=physical.bind(tx);let open=true;
   const guard=()=>stored(open&&base.workspaceId===this.workspaceId&&base.actor.workspaceId===this.workspaceId&&base.tx===tx&&tx.query===physical&&base.now===time&&time.valueOf()===at&&c.now.valueOf()===currentAt);
   const now=this.now();stored(now instanceof Date&&Number.isFinite(now.valueOf()));
   const pinned:SqlSession=Object.freeze({query:async<R extends object>(sql:string,v:readonly unknown[]=[])=>{guard();const rows=await query<R>(sql,v);guard();return rows;}});
   const c=Object.freeze({workspaceId:this.workspaceId,actor:base.actor,now:new Date(now),tx:pinned});
   const currentAt=c.now.valueOf();
   try{
    guard();await this.permission(c);const q=await readIssuedServiceQuoteV4(c,this.workspaceId,id,this.ring,this.sourceKey);
    await this.permission(c,q,action);await this.currentFamily(c,q);
    const data=await readServiceAcceptanceDataV4(Object.freeze({...c,now:this.now()}),this.workspaceId,id,this.ring,this.sourceKey,this.commandKey);stored(canonical(data.quote)===canonical(q));
    const {result,quote:after}=await work(c,data);
    await this.permission(c,after,action);await this.currentFamily(c,after);
    stored(canonical(await readServiceAcceptanceDataV4(Object.freeze({...c,now:this.now()}),this.workspaceId,id,this.ring,this.sourceKey,this.commandKey).then(d=>d.quote))===canonical(after));
    guard();return result;
   }finally{open=false;}
 }
 /** Exact original receipt resolves only that operation. Its original unpaid
  * state is not the current balance and never resolves a provider outcome. */
 async readOriginalAcceptance(actor:Actor,quoteId:string,operationId:string){
  billingId.parse(operationId);return this.withCurrent(actor,quoteId,async(_c,data)=>{
   stored(data.original&&data.original.receipt.operationId===operationId);return data.original.receipt;
  });
 }
 async readSnapshot(actor:Actor,id:string):Promise<ServiceOwnerSnapshotV4>{
  return this.withCurrent(actor,id,(c,data)=>this.snapshot(c,data.quote));
 }
 private snapshot(c:Readonly<BillingContext>,q:ServiceFamilyOfferV4){return readServiceFinancialSnapshotV4(c,this.workspaceId,q,this.ring,this.ledgerKey);}
 private hmac(value:unknown){return createHmac('sha256',this.ledgerKey).update(canonical(value)).digest('hex');}
 private moneyDigest(actorId:string,input:ServiceOwnerMoneyCommandV4){return this.hmac({domain:'owner-service-money-command/v4',workspaceId:this.workspaceId,actorId,input});}
 private resultDigest(commandDigest:string,receipt:z.infer<typeof serviceOwnerMoneyReceiptV4Schema>){return this.hmac({domain:'owner-service-money-result/v4',workspaceId:this.workspaceId,commandDigest,receipt});}
 private parseMoney(raw:unknown){const parsed=serviceOwnerMoneyCommandV4Schema.safeParse(raw);if(!parsed.success)throw new AppError('INVALID_REQUEST');return parsed.data;}
 private async previousMoney(c:Readonly<BillingContext>,input:ServiceOwnerMoneyCommandV4,current:ServiceOwnerSnapshotV4){
  const cmd=input.command,row=await one<{actorId:string;action:string;quoteId:string;digest:string;recordedAt:Date;exactTime:boolean;ciphertext:string}>(c.tx,
   'SELECT actor_id AS "actorId",action,quote_id AS "quoteId",request_digest AS digest,created_at AS "recordedAt",created_at=date_trunc(\'milliseconds\',created_at) AS "exactTime",result_ciphertext AS ciphertext FROM ls_fishing_billing.commands WHERE workspace_id=$1 AND operation_id=$2 FOR SHARE',[this.workspaceId,cmd.operationId]);
  if(!row)return null;
  const digest=this.moneyDigest(c.actor.id,input);
  if(row.actorId!==c.actor.id||row.action!=='service_'+input.action+'_v4'||row.quoteId!==cmd.quoteId||row.digest!==digest)throw new AppError('CONFLICT');
  const j=moneyJournalSchema.parse(JSON.parse(unseal(row.ciphertext,serviceGuestAadV4('owner_money',this.workspaceId,cmd.operationId),this.ring))),r=j.receipt,q=current.quote,b=r.result.balance;
  stored(j.workspaceId===this.workspaceId&&j.actorId===c.actor.id&&canonical(j.input)===canonical(input)&&j.commandDigest===digest&&j.resultDigest===this.resultDigest(digest,r));
  stored(row.exactTime===true&&Date.parse(r.recordedAt)===row.recordedAt.valueOf()&&Date.parse(r.recordedAt)<=c.now.valueOf()&&!r.replayed&&r.workspaceId===this.workspaceId&&r.actorId===c.actor.id&&r.operationId===cmd.operationId&&r.action===input.action&&r.entityVersion===cmd.expectedVersion+1);
  stored(r.quoteId===q.id&&r.familyId===q.familyId&&r.offerSha256===q.offer.sha256&&r.acceptanceId===q.acceptance?.id&&r.entityVersion<=q.revision&&b.lines.length===q.lines.length&&new Set(b.lines.map(l=>l.lineId)).size===q.lines.length);
  for(const l of q.lines)stored(b.lines.some(x=>x.lineId===l.id&&x.childId===l.childId&&canonical(x.period)===canonical(l.period)&&x.groupId===l.groupId&&x.quotedMinor===l.amountMinor&&x.dueMinor===l.amountMinor&&x.dueAt===l.dueAt));
  for(const receipt of [r.result.receipt,...(r.result.originalCashReceipt?[r.result.originalCashReceipt]:[])])stored(current.balance.receipts.some(actual=>canonical(actual)===canonical(receipt)));
  const receipt=r.result.receipt;stored(receipt.amountMinor===cmd.amountMinor&&canonical(receipt.allocations)===canonical(cmd.allocations));
  if(input.action==='cash_date')stored('receivedDate' in receipt&&receipt.receivedDate===input.command.receivedDate&&receipt.timeZone===input.command.timeZone);
  else stored(receipt.originalReceiptId===input.command.originalReceiptId&&receipt.reason===input.command.reason);
  return serviceOwnerMoneyReceiptV4Schema.parse({...r,replayed:true});
 }
 /** Exact input is required for recovery. Missing remains unresolved; this
  * read never retries money, grants, delivery or a different operation. */
 async readMoneyOperation(actor:Actor,raw:unknown){
  const input=this.parseMoney(raw);return this.withCurrent(actor,input.command.quoteId,async(c,data)=>this.previousMoney(c,input,await this.snapshot(c,data.quote)));
 }
 private async suppressQueued(c:Readonly<BillingContext>,q:ServiceFamilyOfferV4,balance:ServiceOwnerSnapshotV4['balance']){
  const reason=q.state==='cancelled'?'cancelled':q.paused?'owner_paused':q.acceptance&&balance.remainingMinor===0?'paid':null;if(!reason)return;
  const rows=await c.tx.query<{id:string;ciphertext:string}>("SELECT id,payload_ciphertext AS ciphertext FROM ls_fishing_billing.reminders WHERE workspace_id=$1 AND quote_id=$2 AND state='queued' ORDER BY id LIMIT 1001 FOR UPDATE",[this.workspaceId,q.id]);stored(rows.length<=1000);
  for(const row of rows){
   const i=reminderIntentSchema.parse(JSON.parse(unseal(row.ciphertext,'ls_fishing_billing/v1/reminder/'+this.workspaceId+'/'+row.id,this.ring)));
   stored(i.id===row.id&&i.quoteId===q.id&&i.familyId===q.familyId&&i.state==='queued');
   const after=reminderIntentSchema.parse({...i,state:'suppressed',reason});
   stored(await one(c.tx,"UPDATE ls_fishing_billing.reminders SET state='suppressed',payload_ciphertext=$3 WHERE workspace_id=$1 AND id=$2 AND quote_id=$4 AND state='queued' AND payload_ciphertext=$5 RETURNING id",[this.workspaceId,i.id,seal(JSON.stringify(after),'ls_fishing_billing/v1/reminder/'+this.workspaceId+'/'+i.id,this.ring),q.id,row.ciphertext]));
  }
 }
 private async mutateMoney(actor:Actor,raw:unknown){
  const input=this.parseMoney(raw),cmd=input.command,principal=Object.freeze({...actor});
  const outcome=await this.programme.withOwnerTransactionOutcome(principal,base=>this.inCurrent(base,cmd.quoteId,input.action,async(c,data)=>{
   const q=data.quote,before=await this.snapshot(c,q),prior=await this.previousMoney(c,input,before);if(prior)return {result:prior,quote:q};
   if(q.revision!==cmd.expectedVersion)throw new AppError('CONFLICT');
   if(!data.original||input.action==='cash_date'&&q.state!=='accepted')throw new AppError('CONFLICT');
   const recordedAt=c.now.toISOString(),common={id:randomUUID(),operationId:cmd.operationId,quoteId:q.id,familyId:q.familyId,currency:'USD',amountMinor:cmd.amountMinor,allocations:cmd.allocations,actorId:c.actor.id,recordedAt,provider:null};
   let receipt:LedgerReceiptV2;
   if(input.action==='cash_date'){
    const m=input.command;
    if(m.receivedDate>newYorkDate(recordedAt)||m.receivedDate<newYorkDate(q.acceptance!.acceptedAt)||m.allocations.some(a=>a.amountMinor>(before.balance.lines.find(l=>l.lineId===a.lineId)?.remainingMinor??0)))throw new AppError('INVALID_REQUEST');
    receipt=dateCashReceiptSchema.parse({...common,kind:'cash',originalReceiptId:null,reason:null,receivedPrecision:'date',receivedDate:m.receivedDate,timeZone:m.timeZone});
   }else{
    const original=before.balance.receipts.find(r=>r.id===input.command.originalReceiptId);if(original?.kind!=='cash')throw new AppError('INVALID_REQUEST');
    receipt=ledgerReceiptV2Schema.parse({...common,kind:'cash_reversal',originalReceiptId:original.id,reason:input.command.reason,receivedAt:recordedAt});
   }
   const after=serviceFamilyOfferV4Schema.parse({...q,revision:q.revision+1}),balance=projectServiceBalanceV4(after,[...before.balance.receipts,receipt],before.balance.pendingAttemptIds);
   const {row,quote:actual}=await readIssuedServiceQuoteWithRowV4(c,this.workspaceId,q.id,this.ring,this.sourceKey);stored(canonical(actual)===canonical(q));
   await c.tx.query('INSERT INTO ls_fishing_billing.receipts(workspace_id,id,quote_id,operation_id,original_receipt_id,payload_ciphertext,recorded_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[this.workspaceId,receipt.id,q.id,receipt.operationId,receipt.originalReceiptId,seal(JSON.stringify(receipt),'ls_fishing_billing/v1/receipt/'+this.workspaceId+'/'+receipt.id,this.ring),recordedAt]);
   const changed=await one(c.tx,'UPDATE ls_fishing_billing.quotes SET revision=$3,payload_ciphertext=$4 WHERE workspace_id=$1 AND id=$2 AND revision=$5 AND payload_ciphertext=$6 AND family_id=$7 AND definition_id=$8 AND created_at=$9 AND material_version=$10 RETURNING id',
    [this.workspaceId,q.id,after.revision,seal(JSON.stringify(after),serviceGuestAadV4('quote',this.workspaceId,q.id),this.ring),row.revision,row.ciphertext,row.familyId,row.definitionId,row.createdAt,BILLING_SERVICE_V4]);if(!changed)throw new AppError('CONFLICT');
   await this.suppressQueued(c,after,balance);
   const current=await this.snapshot(c,after),result=serviceMoneySnapshotV4(current,receipt.id);
   const operation=serviceOwnerMoneyReceiptV4Schema.parse({version:BILLING_SERVICE_V4,workspaceId:this.workspaceId,actorId:c.actor.id,action:input.action,operationId:cmd.operationId,quoteId:q.id,familyId:q.familyId,offerSha256:q.offer.sha256,acceptanceId:q.acceptance!.id,entityVersion:after.revision,recordedAt,replayed:false,result});
   const commandDigest=this.moneyDigest(c.actor.id,input),journal=moneyJournalSchema.parse({version:BILLING_SERVICE_V4,kind:'owner_service_money',workspaceId:this.workspaceId,actorId:c.actor.id,input,commandDigest,resultDigest:this.resultDigest(commandDigest,operation),receipt:operation});
   await c.tx.query('INSERT INTO ls_fishing_billing.commands(workspace_id,operation_id,actor_id,action,quote_id,request_digest,result_ciphertext,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[this.workspaceId,cmd.operationId,c.actor.id,'service_'+input.action+'_v4',q.id,commandDigest,seal(JSON.stringify(journal),serviceGuestAadV4('owner_money',this.workspaceId,cmd.operationId),this.ring),recordedAt]);
   stored(canonical(await this.previousMoney(c,input,current))===canonical({...operation,replayed:true}));
   return {result:operation,quote:after};
  }));
  return serviceOwnerMoneyOutcomeV4Schema.parse({...outcome,version:BILLING_SERVICE_V4,workspaceId:this.workspaceId,actorId:principal.id,input});
 }
 recordCashDate(actor:Actor,raw:unknown){return this.mutateMoney(actor,{action:'cash_date',command:raw});}
 reverseCash(actor:Actor,raw:unknown){return this.mutateMoney(actor,{action:'reverse_cash',command:raw});}
 private parseState(raw:unknown){const parsed=serviceStateCommandV4Schema.safeParse(raw);if(!parsed.success)throw new AppError('INVALID_REQUEST');return parsed.data;}
 private async previousState(c:Readonly<BillingContext>,command:ServiceStateCommandV4,q:ServiceFamilyOfferV4){
  const row=await one<ServiceStateRowV4>(c.tx,'SELECT '+serviceStateColumnsV4+' FROM ls_fishing_billing.commands WHERE workspace_id=$1 AND operation_id=$2 FOR SHARE',[this.workspaceId,command.operationId]);if(!row)return null;
  if(row.actorId!==c.actor.id||row.action!=='service_state_v4'||row.quoteId!==command.quoteId||row.digest!==serviceStateCommandDigestV4(this.workspaceId,c.actor.id,command,this.sourceKey))throw new AppError('CONFLICT');
  const j=decodeServiceStateJournalV4(row,this.workspaceId,this.ring,this.sourceKey),r=j.receipt;
  stored(canonical(j.command)===canonical(command)&&r.familyId===q.familyId&&r.offerSha256===q.offer.sha256&&r.after.revision<=q.revision&&Date.parse(r.recordedAt)<=c.now.valueOf()&&(r.acceptanceId===null||r.acceptanceId===q.acceptance?.id));
  return serviceStateReceiptV4Schema.parse({...r,replayed:true});
 }
 /** Read only this original owner-state operation. NULL is unresolved, never
  * a rejected or successful different operation. Current uses readSnapshot. */
 async readStateOperation(actor:Actor,raw:unknown){const command=this.parseState(raw);return this.withCurrent(actor,command.quoteId,(c,data)=>this.previousState(c,command,data.quote));}
 async setState(actor:Actor,raw:unknown){
  const command=this.parseState(raw),principal=Object.freeze({...actor});
  const outcome=await this.programme.withOwnerTransactionOutcome(principal,base=>this.inCurrent(base,command.quoteId,'state',async(c,data)=>{
   const q=data.quote;await this.snapshot(c,q);const prior=await this.previousState(c,command,q);if(prior)return {result:prior,quote:q};
   if(q.revision!==command.expectedQuoteRevision||q.state==='cancelled')throw new AppError('CONFLICT');
   const after=serviceFamilyOfferV4Schema.parse({...q,revision:q.revision+1,paused:command.paused??q.paused,state:command.cancel?'cancelled':q.state}),recordedAt=c.now.toISOString();
   const receipt=serviceStateReceiptV4Schema.parse({version:BILLING_SERVICE_V4,action:command.action,workspaceId:this.workspaceId,actorId:c.actor.id,operationId:command.operationId,quoteId:q.id,familyId:q.familyId,offerSha256:q.offer.sha256,acceptanceId:q.acceptance?.id??null,recordedAt,replayed:false,
    before:{revision:q.revision,state:q.state,paused:q.paused},after:{revision:after.revision,state:after.state,paused:after.paused}});
   const {row,quote:actual}=await readIssuedServiceQuoteWithRowV4(c,this.workspaceId,q.id,this.ring,this.sourceKey);stored(canonical(actual)===canonical(q));
   const changed=await one(c.tx,'UPDATE ls_fishing_billing.quotes SET revision=$3,payload_ciphertext=$4 WHERE workspace_id=$1 AND id=$2 AND revision=$5 AND payload_ciphertext=$6 AND family_id=$7 AND definition_id=$8 AND created_at=$9 AND material_version=$10 RETURNING id',
    [this.workspaceId,q.id,after.revision,seal(JSON.stringify(after),serviceGuestAadV4('quote',this.workspaceId,q.id),this.ring),row.revision,row.ciphertext,row.familyId,row.definitionId,row.createdAt,BILLING_SERVICE_V4]);if(!changed)throw new AppError('CONFLICT');
   const commandDigest=serviceStateCommandDigestV4(this.workspaceId,c.actor.id,command,this.sourceKey),journal=serviceStateJournalV4Schema.parse({version:BILLING_SERVICE_V4,kind:'owner_service_state',workspaceId:this.workspaceId,actorId:c.actor.id,command,commandDigest,resultDigest:serviceStateResultDigestV4(this.workspaceId,commandDigest,receipt,this.sourceKey),receipt});
   await c.tx.query('INSERT INTO ls_fishing_billing.commands(workspace_id,operation_id,actor_id,action,quote_id,request_digest,result_ciphertext,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[this.workspaceId,command.operationId,c.actor.id,'service_state_v4',q.id,commandDigest,seal(JSON.stringify(journal),serviceGuestAadV4('owner_state',this.workspaceId,command.operationId),this.ring),recordedAt]);
   const current=await this.snapshot(c,after);await this.suppressQueued(c,after,current.balance);
   stored(canonical(await this.previousState(c,command,after))===canonical({...receipt,replayed:true}));return {result:receipt,quote:after};
  }));
  return serviceStateOutcomeV4Schema.parse({...outcome,version:BILLING_SERVICE_V4,workspaceId:this.workspaceId,actorId:principal.id,command});
 }
}
