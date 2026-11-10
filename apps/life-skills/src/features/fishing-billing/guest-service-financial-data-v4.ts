import 'server-only';
import {createHmac} from 'node:crypto';
import {AppError} from '../../lib/errors.ts';
import {canonical} from '../contact-ops/core/validation.ts';
import {unseal,type Keyring} from '../identity/crypto.ts';
import type {WorkspaceId} from '../identity/types.ts';
import type {SqlSession} from '../identity/store.ts';
import type {BillingLedgerContext} from './native.ts';
import {reminderIntentSchema} from './contracts.ts';
import {ledgerReceiptV2Schema} from './contracts-v2.ts';
import {cardAttemptSchema,cardExceptionSchema} from './card-contracts.ts';
import {BILLING_SERVICE_V4,type ServiceFamilyOfferV4} from './guest-service-contract-v4.ts';
import {serviceOwnerSnapshotV4Schema,type ServiceOwnerSnapshotV4} from './guest-service-owner-financial-contract-v4.ts';
import {projectServiceBalanceV4} from './guest-service-domain-v4.ts';
import {FishingBillingInquiryFamilyProposals} from '../../lib/fishing-billing-inquiry-family-proposal.ts';
import {readProgramSourceInTransactionV3} from './program-source-readback-v3.ts';
function stored(condition:unknown):asserts condition{if(!condition)throw new AppError('UNAVAILABLE');}
/** DATA only, not owner/service/guardian/resource/provider/send authority.
 * Caller admits its real current owner OR independent service before lookup.
 * Every view pins the actual transaction/query/workspace/Date and is revoked
 * after completion. The owner and actor-free service share these exact readers. */
async function dataView<T>(c:BillingLedgerContext,workspaceId:WorkspaceId,work:(view:BillingLedgerContext)=>Promise<T>){
 const tx=c.tx,physical=tx.query,time=c.now,at=time.valueOf(),query=physical.bind(tx);let open=true;
 const guard=()=>stored(open&&c.workspaceId===workspaceId&&c.tx===tx&&tx.query===physical&&c.now===time&&time.valueOf()===at&&Number.isFinite(at));
 const pinned:SqlSession=Object.freeze({query:async<R extends object>(sql:string,v:readonly unknown[]=[])=>{guard();const rows=await query<R>(sql,v);guard();return rows;}});
 const view=Object.freeze({workspaceId,now:new Date(at),tx:pinned});
 try{guard();const result=await work(view);guard();return result;}finally{open=false;}
}
export async function readServiceCurrentFamilyDataV4(c:BillingLedgerContext,workspaceId:WorkspaceId,q:ServiceFamilyOfferV4,ring:Keyring,sourceKey:string,families:FishingBillingInquiryFamilyProposals){
 return dataView(c,workspaceId,async c=>{
  for(const l of q.lines){stored(l.groupId);
   const p=await readProgramSourceInTransactionV3(c,workspaceId,l.groupId,'progression',l.childId,ring,sourceKey);stored(p&&p.record.command.kind==='progression');
   const f=p.record.command.fields;stored(f.familyId===q.familyId);
   const current=await families.readCurrentDataInTransaction(c.tx,{proposalId:f.proposalId,reference:f.reference,expectedEpoch:f.expectedEpoch,lock:'shared'});
   stored(current.proposal.workspaceId===workspaceId&&current.proposal.command.selection.familyId===q.familyId&&current.proposal.command.selection.children.some(child=>child.nativeChildId===l.childId));
  }
  });
}
export async function readServiceFinancialSnapshotV4(c:BillingLedgerContext,workspaceId:WorkspaceId,q:ServiceFamilyOfferV4,ring:Keyring,ledgerKey:Buffer):Promise<ServiceOwnerSnapshotV4>{
 return dataView(c,workspaceId,async c=>{
   const id=q.id;
   const rows=await c.tx.query<{id:string;operationId:string;originalId:string|null;recordedAt:Date;exactTime:boolean;ciphertext:string}>('SELECT id,operation_id AS "operationId",original_receipt_id AS "originalId",recorded_at AS "recordedAt",recorded_at=date_trunc(\'milliseconds\',recorded_at) AS "exactTime",payload_ciphertext AS ciphertext FROM ls_fishing_billing.receipts WHERE workspace_id=$1 AND quote_id=$2 ORDER BY id LIMIT 1001',[workspaceId,id]);stored(rows.length<=1000);
   const receipts=rows.map(row=>{const r=ledgerReceiptV2Schema.parse(JSON.parse(unseal(row.ciphertext,'ls_fishing_billing/v1/receipt/'+workspaceId+'/'+row.id,ring)));
    stored(row.exactTime===true&&r.id===row.id&&r.operationId===row.operationId&&r.originalReceiptId===row.originalId&&r.quoteId===q.id&&r.familyId===q.familyId&&Date.parse(r.recordedAt)===row.recordedAt.valueOf()&&Date.parse(r.recordedAt)<=c.now.valueOf());return r;
   });
   const attempts=await c.tx.query<{id:string;state:string;revision:number;ciphertext:string}>('SELECT id,state,revision,payload_ciphertext AS ciphertext FROM ls_fishing_billing.card_attempts WHERE workspace_id=$1 AND quote_id=$2 ORDER BY id LIMIT 1001',[workspaceId,id]);stored(attempts.length<=1000);
   const cards=attempts.map(row=>{const a=cardAttemptSchema.parse(JSON.parse(unseal(row.ciphertext,'ls_fishing_billing/card/v1/attempt/'+workspaceId+'/'+row.id,ring)));
    stored(a.id===row.id&&a.state===row.state&&a.revision===row.revision&&a.workspaceId===workspaceId&&a.quoteId===q.id&&a.familyId===q.familyId&&Date.parse(a.createdAt)<=c.now.valueOf());return a;
   });
   const balance=projectServiceBalanceV4(q,receipts,cards.filter(a=>['prepared','unknown','open','pending'].includes(a.state)).map(a=>a.id));
   // An attempt's claimed paid state is not a money receipt. Retain a review
   // conflict rather than suggesting another payment or inventing settlement.
   if(cards.some(a=>a.state==='review_required'||a.state==='paid'&&!receipts.some(r=>r.kind==='card'&&r.provider?.accountId===a.binding.accountId&&r.provider.transactionId===a.paymentIntentId&&r.amountMinor>=a.preparation.result.amountMinor)))balance.state='review_required';
   const exceptions=await c.tx.query<{id:string;state:string;ciphertext:string}>('SELECT id,state,payload_ciphertext AS ciphertext FROM ls_fishing_billing.card_exceptions WHERE workspace_id=$1 AND quote_id=$2 ORDER BY id LIMIT 1001',[workspaceId,id]);stored(exceptions.length<=1000);
   for(const row of exceptions){const e=cardExceptionSchema.parse(JSON.parse(unseal(row.ciphertext,'ls_fishing_billing/card/v1/exception/'+workspaceId+'/'+row.id,ring)));
    stored(e.id===row.id&&e.state===row.state&&e.workspaceId===workspaceId&&e.quoteId===q.id&&e.familyId===q.familyId&&Date.parse(e.recordedAt)<=c.now.valueOf());if(e.state==='open')balance.state='review_required';
   }
   const reminders=await c.tx.query<{id:string;state:string;intentKey:string;audienceKey:string;scheduledAt:Date;exactTime:boolean;ciphertext:string}>('SELECT id,state,intent_key AS "intentKey",audience_key AS "audienceKey",scheduled_at AS "scheduledAt",scheduled_at=date_trunc(\'milliseconds\',scheduled_at) AS "exactTime",payload_ciphertext AS ciphertext FROM ls_fishing_billing.reminders WHERE workspace_id=$1 AND quote_id=$2 ORDER BY id LIMIT 1001',[workspaceId,id]);stored(reminders.length<=1000);
   const hmac=(v:unknown)=>createHmac('sha256',ledgerKey).update(canonical(v)).digest('hex');
   balance.reminders=reminders.map(row=>{const i=reminderIntentSchema.parse(JSON.parse(unseal(row.ciphertext,'ls_fishing_billing/v1/reminder/'+workspaceId+'/'+row.id,ring)));
    stored(row.exactTime===true&&i.id===row.id&&i.state===row.state&&i.quoteId===q.id&&i.familyId===q.familyId&&hmac({key:i.key})===row.intentKey&&hmac({quoteId:q.id,guardianId:i.guardianId})===row.audienceKey&&Date.parse(i.scheduledAt)===row.scheduledAt.valueOf());return {id:i.id,state:i.state};
   });
   return serviceOwnerSnapshotV4Schema.parse({version:BILLING_SERVICE_V4,quote:q,balance,receiptId:null});
  });
}
