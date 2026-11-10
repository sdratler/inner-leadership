import 'server-only';
import {AppError} from '../../lib/errors.ts';
import {canonical} from '../contact-ops/core/validation.ts';
import {seal,unseal,type Keyring} from '../identity/crypto.ts';
import {lockWorkspace} from '../identity/data.ts';
import {one,type IdentityStore,type SqlSession} from '../identity/store.ts';
import type {WorkspaceId,IdentityClock} from '../identity/types.ts';
import {FishingBillingInquiryFamilyProposals} from '../../lib/fishing-billing-inquiry-family-proposal.ts';
import type {BillingLedgerContext} from './native.ts';
import {billingId,ledgerReceiptSchema,reminderIntentSchema,type LedgerReceipt} from './contracts.ts';
import {billingStripeBindingSchema,type BillingStripeBinding} from './card-binding.ts';
import {BILLING_SERVICE_V4,serviceFamilyOfferV4Schema,type ServiceFamilyOfferV4} from './guest-service-contract-v4.ts';
import {serviceGuestAadV4} from './guest-service-aad-v4.ts';
import {readIssuedServiceQuoteWithRowV4} from './guest-service-quote-readback-v4.ts';
import {readServiceAcceptanceDataV4} from './guest-service-acceptance-data-v4.ts';
import {readServiceCurrentFamilyDataV4,readServiceFinancialSnapshotV4} from './guest-service-financial-data-v4.ts';
import {projectServiceBalanceV4} from './guest-service-domain-v4.ts';
import type {ServiceOwnerSnapshotV4} from './guest-service-owner-financial-contract-v4.ts';
import type {ServiceCardReconciliationAuthorityV4,ServiceCardReconciliationScopeV4,ServiceCurrentCardLedgerV4} from './guest-service-current-card-contract-v4.ts';

type Context=Readonly<BillingLedgerContext>;
function fact(v:unknown,code:'UNAVAILABLE'|'CONFLICT'='UNAVAILABLE'):asserts v{if(!v)throw new AppError(code);}
function freeze<T>(v:T):T{if(v&&typeof v==='object'){for(const x of Object.values(v))freeze(x);Object.freeze(v);}return v;}
/** Explicit V4 actor-free reconciliation data/once-advance port. No runtime,
 * SDK, event processor, new ledger, worker, prepare/charge or send is installed.
 * The current V4 owner and this port use the SAME original-history readers and
 * money calculator, preserving existing receipt AAD and quote material. */
export class FishingServiceCurrentCardV4{
 private readonly commandKey:Buffer;private readonly ledgerKey:Buffer;private readonly now:()=>Date;
 private readonly authority:ServiceCardReconciliationAuthorityV4;
 constructor(private readonly db:IdentityStore,private readonly workspaceId:WorkspaceId,private readonly families:FishingBillingInquiryFamilyProposals,
  private readonly ring:Keyring,private readonly sourceKey:string,commandKey:Buffer,ledgerKey:Buffer,clock:IdentityClock,authority:ServiceCardReconciliationAuthorityV4){
  fact(billingId.safeParse(workspaceId).success&&sourceKey.length>=32&&commandKey.length>=32&&ledgerKey.length>=32&&typeof authority?.target==='function'&&typeof authority?.authorize==='function');
  this.commandKey=Buffer.from(commandKey);this.ledgerKey=Buffer.from(ledgerKey);this.now=clock.now.bind(clock);
  this.authority=Object.freeze({target:authority.target.bind(authority),authorize:authority.authorize.bind(authority)});
 }
 private currentNow(){const n=this.now();fact(n instanceof Date&&Number.isFinite(n.valueOf()));return new Date(n);}
 private async permission(c:Context,binding:Readonly<BillingStripeBinding>,scope?:ServiceCardReconciliationScopeV4){
  const view=Object.freeze({...c,now:this.currentNow()}),at=view.now.valueOf();await this.authority.target(view,binding);fact(view.now.valueOf()===at);
  if(scope){await this.authority.authorize(view,binding,scope);fact(view.now.valueOf()===at);}
 }
 private async ledger(c:Context,id:string){
  const view=Object.freeze({...c,now:this.currentNow()}),at=view.now.valueOf();
  const data=await readServiceAcceptanceDataV4(view,this.workspaceId,id,this.ring,this.sourceKey,this.commandKey);fact(data.original&&data.quote.acceptance);
  await readServiceCurrentFamilyDataV4(view,this.workspaceId,data.quote,this.ring,this.sourceKey,this.families);
  const snapshot=await readServiceFinancialSnapshotV4(view,this.workspaceId,data.quote,this.ring,this.ledgerKey);fact(view.now.valueOf()===at);return snapshot;
 }
 private async receiptRows(c:Context,id:string){const rows=await c.tx.query<{id:string;operationId:string;originalId:string|null;ciphertext:string;recordedAt:Date}>(
  'SELECT id,operation_id AS "operationId",original_receipt_id AS "originalId",payload_ciphertext AS ciphertext,recorded_at AS "recordedAt" FROM ls_fishing_billing.receipts WHERE workspace_id=$1 AND quote_id=$2 ORDER BY id LIMIT 1001 FOR SHARE',[this.workspaceId,id]);
  fact(rows.length<=1000);return rows.map(r=>({...r,recordedAt:r.recordedAt.toISOString()}));}
 private async suppressQueued(c:Context,s:ServiceOwnerSnapshotV4){
  const q=s.quote,reason=q.state==='cancelled'?'cancelled':q.paused?'owner_paused':s.balance.remainingMinor===0?'paid':null;if(!reason)return;
  const rows=await c.tx.query<{id:string;ciphertext:string}>("SELECT id,payload_ciphertext AS ciphertext FROM ls_fishing_billing.reminders WHERE workspace_id=$1 AND quote_id=$2 AND state='queued' ORDER BY id LIMIT 1001 FOR UPDATE",[this.workspaceId,q.id]);fact(rows.length<=1000);
  for(const row of rows){const i=reminderIntentSchema.parse(JSON.parse(unseal(row.ciphertext,'ls_fishing_billing/v1/reminder/'+this.workspaceId+'/'+row.id,this.ring)));
   fact(i.id===row.id&&i.quoteId===q.id&&i.familyId===q.familyId&&i.state==='queued');
   const after=reminderIntentSchema.parse({...i,state:'suppressed',reason});
   fact(await one(c.tx,"UPDATE ls_fishing_billing.reminders SET state='suppressed',payload_ciphertext=$3 WHERE workspace_id=$1 AND id=$2 AND quote_id=$4 AND state='queued' AND payload_ciphertext=$5 RETURNING id",[this.workspaceId,i.id,seal(JSON.stringify(after),'ls_fishing_billing/v1/reminder/'+this.workspaceId+'/'+i.id,this.ring),q.id,row.ciphertext]),'CONFLICT');
  }
 }
 async withCurrentCardServiceV4<T>(rawBinding:BillingStripeBinding,quoteId:string,work:(ledger:ServiceCurrentCardLedgerV4)=>Promise<T>):Promise<T>{
  billingId.parse(quoteId);const binding=Object.freeze(billingStripeBindingSchema.parse(rawBinding));
  return this.db.transaction(async physical=>{
   const original=physical.query,query=original.bind(physical),time=this.currentNow(),at=time.valueOf();let open=true,active=true,claimed=false,failed=false,completed=false;
   const guard=()=>fact(open&&physical.query===original&&c.tx===tx&&c.workspaceId===this.workspaceId&&c.now===time&&time.valueOf()===at);
   const tx:SqlSession=Object.freeze({query:async<R extends object>(sql:string,v:readonly unknown[]=[])=>{guard();const rows=await query<R>(sql,v);guard();return rows;}}),c=Object.freeze({workspaceId:this.workspaceId,now:time,tx});
   const pending=new Set<Promise<ServiceOwnerSnapshotV4>>(),queries=new Set<Promise<unknown>>();
   try{
    guard();await this.permission(c,binding);await lockWorkspace(tx,this.workspaceId);
    const initial=await this.ledger(c,quoteId),q=initial.quote;
    const scope:ServiceCardReconciliationScopeV4=Object.freeze({action:'reconcile',programKey:'fishing_monthly_club',quoteId:q.id,familyId:q.familyId,childIds:Object.freeze(q.lines.map(l=>l.childId)),offerSha256:q.offer.sha256,acceptanceId:q.acceptance!.id});
    await this.permission(c,binding,scope);
    const source=await readIssuedServiceQuoteWithRowV4(c,this.workspaceId,quoteId,this.ring,this.sourceKey);fact(canonical(source.quote)===canonical(q),'CONFLICT');
    const quoteKey=(r:typeof source.row)=>canonical({...r,createdAt:r.createdAt.toISOString()});
    let expectedQuote:ServiceFamilyOfferV4=q,expectedReceipts=initial.balance.receipts,physicalReceipts=await this.receiptRows(c,quoteId),physicalQuote=quoteKey(source.row);
    const stable=async()=>{
     const s=await this.ledger(c,quoteId),actual=await readIssuedServiceQuoteWithRowV4(c,this.workspaceId,quoteId,this.ring,this.sourceKey);
     fact(canonical(s.quote)===canonical(expectedQuote)&&quoteKey(actual.row)===physicalQuote&&canonical(s.balance.receipts)===canonical(expectedReceipts)&&canonical(await this.receiptRows(c,quoteId))===canonical(physicalReceipts),'CONFLICT');return s;
    };
    await stable();
    const advance=async(additions:LedgerReceipt[])=>{
     const actual=await readIssuedServiceQuoteWithRowV4(c,this.workspaceId,quoteId,this.ring,this.sourceKey),a=actual.row,b=source.row;
     fact(canonical(actual.quote)===canonical(q)&&a.revision===b.revision&&a.ciphertext===b.ciphertext&&a.familyId===b.familyId&&a.definitionId===b.definitionId&&a.createdAt.valueOf()===b.createdAt.valueOf()&&a.materialVersion===b.materialVersion,'CONFLICT');
     const live=await stable();
     fact(additions.every(r=>!['cash','cash_reversal'].includes(r.kind)&&r.actorId===null&&r.provider?.accountId===binding.accountId&&r.provider.mode==='test'&&r.recordedAt===time.toISOString()));
     const after=serviceFamilyOfferV4Schema.parse({...q,revision:q.revision+1});
     projectServiceBalanceV4(after,[...live.balance.receipts,...additions],live.balance.pendingAttemptIds);
     await this.permission(c,binding,scope);await stable();
     for(const r of additions)await tx.query('INSERT INTO ls_fishing_billing.receipts(workspace_id,id,quote_id,operation_id,original_receipt_id,payload_ciphertext,recorded_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[this.workspaceId,r.id,q.id,r.operationId,r.originalReceiptId,seal(JSON.stringify(r),'ls_fishing_billing/v1/receipt/'+this.workspaceId+'/'+r.id,this.ring),r.recordedAt]);
     const ciphertext=seal(JSON.stringify(after),serviceGuestAadV4('quote',this.workspaceId,q.id),this.ring);
     fact(await one(tx,'UPDATE ls_fishing_billing.quotes SET revision=$3,payload_ciphertext=$4 WHERE workspace_id=$1 AND id=$2 AND revision=$5 AND payload_ciphertext=$6 AND family_id=$7 AND definition_id=$8 AND created_at=$9 AND material_version=$10 RETURNING id',[this.workspaceId,q.id,after.revision,ciphertext,b.revision,b.ciphertext,b.familyId,b.definitionId,b.createdAt,BILLING_SERVICE_V4]),'CONFLICT');
     expectedQuote=after;physicalQuote=quoteKey({...b,revision:after.revision,ciphertext});expectedReceipts=[...live.balance.receipts,...additions].sort((a,b)=>a.id.localeCompare(b.id));physicalReceipts=await this.receiptRows(c,quoteId);
     const updated=await stable();await this.suppressQueued(c,updated);await this.permission(c,binding,scope);const result=await stable();guard();completed=true;return freeze(structuredClone(result));
    };
    const callbackTx:SqlSession=Object.freeze({query:<R extends object>(sql:string,v:readonly unknown[]=[])=>{
     const task=(async()=>{fact(active);const rows=await tx.query<R>(sql,v);fact(active);return rows;})().catch(error=>{failed=true;throw error;});
     queries.add(task);void task.then(()=>queries.delete(task),()=>queries.delete(task));return task;
    }});
    const ledger:ServiceCurrentCardLedgerV4={context:Object.freeze({...c,tx:callbackTx}),frame:freeze(structuredClone(initial)),advance:(raw=[])=>{
     // Claim and copy before the first await. Even a caught second call poisons
     // the transaction; an escaped first promise must finish before commit.
     let additions:LedgerReceipt[];try{fact(active&&!claimed,'CONFLICT');claimed=true;additions=raw.map(r=>ledgerReceiptSchema.parse(r));}catch(error){failed=true;return Promise.reject(error);}
     const task=advance(additions).catch(error=>{failed=true;throw error;});pending.add(task);void task.then(()=>pending.delete(task),()=>pending.delete(task));return task;
    }};
    const result=await work(ledger);active=false;fact(!failed&&queries.size===0&&(!claimed||completed),'CONFLICT');
    // Producer may finish its actual attempt/event rows after advance. Re-read
    // those rows through the common projector, while pinning immutable money.
    await stable();await this.suppressQueued(c,await stable());await this.permission(c,binding,scope);await stable();
    guard();fact(!failed&&(!claimed||completed),'CONFLICT');return result;
   }finally{
    active=false;await Promise.allSettled([...pending,...queries]);open=false;
   }
  });
 }
}
