import 'server-only';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {AppError} from '../../lib/errors.ts';
import {seal,unseal,type Keyring} from '../identity/crypto.ts';
import {one,type IdentityStore} from '../identity/store.ts';
import type {IdentityClock,WorkspaceId} from '../identity/types.ts';
import type {BillingLedgerContext} from './native.ts';
import {billingId} from './contracts.ts';
import {acceptGuestFamilyOffer} from './guest-domain-v3.ts';
import {
 BILLING_GUEST_V3,guestAcceptCommandSchema,guestAcceptanceReceiptSchema,guestFinancialAcceptanceSchema,
 type GuestGrantRecord,
} from '../../lib/fishing-billing-guest-contract-v3.ts';
import {verifyGuestFamilyOffer,verifyGuestFinancialAcceptance} from '../../lib/fishing-billing-guest-material-v3.ts';
import {
 FishingBillingGuestGrantResolver,guestGrantLifecycleSchema,guestCurrentEvidenceSchema,
 guestPresentationEvidenceSchema,guestFinancialStatementSha256,
} from '../../lib/fishing-billing-guest-grant-resolver.ts';

type Facts=Awaited<ReturnType<FishingBillingGuestGrantResolver['current']>>;
type Receipt=z.infer<typeof guestAcceptanceReceiptSchema>;
type QuoteRow={id:string;familyId:string;definitionId:string;revision:number;createdAt:unknown;ciphertext:string};
type GrantRow={id:string;quoteId:string;action:string;digest:string;state:string;issuedAt:unknown;expiresAt:unknown;ciphertext:string};
type OperationRow={operationId:string;grantId:string;quoteId:string;action:string;digest:string;receiptId:string;recordedAt:unknown;ciphertext:string};
type EvidenceRow={id:string;quoteId:string;grantId:string;operationId:string;action:string;issuedRevision:number;acceptedAt:unknown;ciphertext:string};
const action='accept_financial_offer' as const;
const sha=z.string().regex(/^[a-f0-9]{64}$/);
export const guestOperationEnvelopeSchema=z.object({
 version:z.literal(BILLING_GUEST_V3),workspaceId:billingId,operationId:billingId,grantId:billingId,
 quoteId:billingId,action:z.literal(action),commandDigest:sha,receipt:guestAcceptanceReceiptSchema,
}).strict();
export const guestFinancialEvidenceEnvelopeSchema=z.object({
 version:z.literal(BILLING_GUEST_V3),workspaceId:billingId,quoteId:billingId,grantId:billingId,operationId:billingId,
 action:z.literal(action),acceptance:guestFinancialAcceptanceSchema,currentEvidence:guestCurrentEvidenceSchema,
 presentation:guestPresentationEvidenceSchema,
}).strict();
type Evidence=z.infer<typeof guestFinancialEvidenceEnvelopeSchema>;
const aad=(kind:'quote'|'operation'|'financial_acceptance',workspace:string,id:string)=>'ls_fishing_billing/guest/v3/'+kind+'/'+workspace+'/'+id;
const grantAad=(workspace:string,id:string)=>'ls_fishing_billing/guest_grant/v3/'+workspace+'/'+id;
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
function stored(condition:unknown):asserts condition{if(!condition)throw new AppError('UNAVAILABLE');}
function instant(value:unknown){
 const n=value instanceof Date?value.valueOf():typeof value==='string'?Date.parse(value):NaN;
 stored(Number.isFinite(n));return n;
}

/** Unmounted financial-purpose consumer. The actual Root resolver supplies
 * current native/parent/document authority; this class never issues a quote,
 * grant, account or permission. Its DB/clock/keyring/resolver are constructor-
 * owned, with no environment fallback, network, completion data or sender. */
export class FishingBillingGuestNativeV3{
 constructor(private readonly db:IdentityStore,private readonly workspaceId:WorkspaceId,
  private readonly ring:Keyring,private readonly clock:IdentityClock,private readonly resolver:FishingBillingGuestGrantResolver){billingId.parse(workspaceId);}

 private async quote(c:BillingLedgerContext,id:string){
  const row=await one<QuoteRow>(c.tx,'SELECT id,family_id AS "familyId",definition_id AS "definitionId",revision,created_at AS "createdAt",payload_ciphertext AS ciphertext FROM ls_fishing_billing.quotes WHERE workspace_id=$1 AND id=$2 FOR UPDATE',[this.workspaceId,id]);
  stored(row);
  const quote=verifyGuestFamilyOffer(JSON.parse(unseal(row.ciphertext,aad('quote',this.workspaceId,id),this.ring)));
  stored(quote.workspaceId===this.workspaceId&&quote.id===row.id&&quote.id===id&&quote.familyId===row.familyId&&quote.definition.id===row.definitionId&&quote.revision===row.revision&&instant(row.createdAt)===instant(quote.createdAt));
  return {row,quote};
 }

 private async grant(c:BillingLedgerContext,f:Facts){
  const g=f.grant,row=await one<GrantRow>(c.tx,'SELECT id,quote_id AS "quoteId",action,token_digest AS digest,state,issued_at AS "issuedAt",expires_at AS "expiresAt",payload_ciphertext AS ciphertext FROM ls_fishing_billing.guest_grants WHERE workspace_id=$1 AND id=$2 FOR UPDATE',[this.workspaceId,g.id]);
  stored(row);
  const lifecycle=guestGrantLifecycleSchema.parse(JSON.parse(unseal(row.ciphertext,grantAad(this.workspaceId,g.id),this.ring)));
  stored(same(lifecycle.grant,g)&&g.offer.material.workspaceId===this.workspaceId&&row.id===g.id&&row.quoteId===g.offer.material.quoteId&&row.action===action&&g.action===action&&row.digest===g.tokenDigest&&row.state===lifecycle.state&&instant(row.issuedAt)===instant(g.issuedAt)&&instant(row.expiresAt)===instant(g.expiresAt));
  return {row,lifecycle};
 }

 private operation(c:BillingLedgerContext,id:string){
  return one<OperationRow>(c.tx,'SELECT operation_id AS "operationId",grant_id AS "grantId",quote_id AS "quoteId",action,request_digest AS digest,receipt_id AS "receiptId",recorded_at AS "recordedAt",receipt_ciphertext AS ciphertext FROM ls_fishing_billing.guest_operations WHERE workspace_id=$1 AND operation_id=$2',[this.workspaceId,id]);
 }

 private validateEvidence(raw:unknown,g:GuestGrantRecord,command:z.infer<typeof guestAcceptCommandSchema>,receipt:Receipt):Evidence{
  const e=guestFinancialEvidenceEnvelopeSchema.parse(raw),a=verifyGuestFinancialAcceptance(e.acceptance),current=e.currentEvidence,p=e.presentation;
  stored(e.workspaceId===this.workspaceId&&e.quoteId===g.offer.material.quoteId&&e.grantId===g.id&&e.operationId===command.operationId);
  stored(a.id===receipt.acceptanceId&&a.parent.privateEvidenceId===a.id&&a.operationId===command.operationId&&a.grantId===g.id&&same(a.offer,g.offer)&&same(a.displayed,g.displayBundle));
  stored(a.parent.submittedName===command.parent.submittedName&&a.parent.guardianAuthorityAttested===command.parent.guardianAuthorityAttested&&a.parent.financialTermsAffirmed===command.parent.financialTermsAffirmed);
  stored(current.workspaceId===this.workspaceId&&current.familyId===g.offer.material.familyId&&current.quoteId===e.quoteId&&current.grantId===g.id&&current.recipientBindingEvidenceId===g.recipientBindingEvidenceId&&same(current.admissionPolicy,g.admissionPolicy)&&a.assuranceEvidenceId===current.assuranceEvidenceId);
  stored(p.action===action&&p.grantId===g.id&&p.displayBundleId===g.displayBundle.id&&p.displayBundleSha256===g.displayBundle.sha256&&p.locale===g.displayBundle.locale&&guestFinancialStatementSha256(p)===a.parent.statementSha256);
  stored(receipt.quoteId===e.quoteId&&receipt.operationId===e.operationId&&receipt.acceptedAt===a.acceptedAt&&receipt.acceptedRevision===a.offer.material.issuedRevision+1&&!receipt.replayed);
  return e;
 }

 private async replay(c:BillingLedgerContext,f:Facts):Promise<Receipt>{
  const command=guestAcceptCommandSchema.parse(f.command),g=f.grant,{lifecycle}=await this.grant(c,f),use=lifecycle.use;
  stored(lifecycle.state==='consumed'&&use&&use.operationId===command.operationId&&use.commandDigest===f.commandDigest&&use.receiptId===f.originalReceiptId);
  const row=await this.operation(c,command.operationId);stored(row);
  const op=guestOperationEnvelopeSchema.parse(JSON.parse(unseal(row.ciphertext,aad('operation',this.workspaceId,command.operationId),this.ring))),r=op.receipt;
  stored(op.workspaceId===this.workspaceId&&op.operationId===row.operationId&&op.operationId===command.operationId&&op.grantId===row.grantId&&op.grantId===g.id&&op.quoteId===row.quoteId&&op.quoteId===g.offer.material.quoteId&&op.action===row.action&&row.action===action&&op.commandDigest===row.digest&&row.digest===f.commandDigest&&row.receiptId===r.acceptanceId&&r.acceptanceId===use.receiptId&&r.acceptedAt===use.usedAt&&instant(row.recordedAt)===instant(r.acceptedAt));
  const er=await one<EvidenceRow>(c.tx,'SELECT id,quote_id AS "quoteId",grant_id AS "grantId",operation_id AS "operationId",action,issued_revision AS "issuedRevision",accepted_at AS "acceptedAt",evidence_ciphertext AS ciphertext FROM ls_fishing_billing.guest_financial_acceptances WHERE workspace_id=$1 AND id=$2',[this.workspaceId,r.acceptanceId]);
  stored(er);
  const e=this.validateEvidence(JSON.parse(unseal(er.ciphertext,aad('financial_acceptance',this.workspaceId,er.id),this.ring)),g,command,r);
  stored(er.id===r.acceptanceId&&er.quoteId===op.quoteId&&er.grantId===g.id&&er.operationId===command.operationId&&er.action===action&&er.issuedRevision===g.offer.material.issuedRevision&&instant(er.acceptedAt)===instant(r.acceptedAt));
  const {quote}=await this.quote(c,op.quoteId);
  stored(quote.acceptance&&same(quote.acceptance,e.acceptance)&&quote.revision>=r.acceptedRevision&&quote.familyId===g.offer.material.familyId);
  const obligations=await c.tx.query<{lineId:string;familyId:string;childId:string;periodId:string;startsAt:unknown;endsAt:unknown}>('SELECT line_id AS "lineId",family_id AS "familyId",child_id AS "childId",period_id AS "periodId",starts_at AS "startsAt",ends_at AS "endsAt" FROM ls_fishing_billing.obligations WHERE workspace_id=$1 AND quote_id=$2',[this.workspaceId,quote.id]);
  stored(obligations.length===quote.lines.length&&quote.lines.every(l=>obligations.some(o=>o.lineId===l.id&&o.familyId===quote.familyId&&o.childId===l.childId&&o.periodId===l.period.id&&instant(o.startsAt)===instant(l.period.startsAt)&&instant(o.endsAt)===instant(l.period.endsAt))));
  // Original retained evidence is verified above, not rebuilt from the replay's
  // null presentation or newly resolved current assurance evidence.
  return guestAcceptanceReceiptSchema.parse({...r,replayed:true});
 }

 private acceptedTime(g:GuestGrantRecord){
  const now=this.clock.now();stored(now instanceof Date&&Number.isFinite(now.valueOf()));
  stored(now.valueOf()>=instant(g.issuedAt)&&now.valueOf()<instant(g.expiresAt));return now.toISOString();
 }

 async acceptFinancialOffer(rawToken:string,rawCommand:unknown):Promise<Receipt>{
  try{return await this.db.transaction(async tx=>{
   const c:BillingLedgerContext={tx,workspaceId:this.workspaceId,now:this.clock.now()};
   const cap=await this.resolver.resolve(c,rawToken,action,rawCommand),first=await this.resolver.current(c,cap,action);
   if(first.kind==='replay'){
    const final=await this.resolver.current(c,cap,action);stored(final.kind==='replay');return this.replay(c,final);
   }
   const command=guestAcceptCommandSchema.parse(first.command),g=first.grant,{row:before,quote}=await this.quote(c,g.offer.material.quoteId),original=await this.grant(c,first);
   stored(quote.state==='issued'&&quote.revision===command.expectedVersion&&quote.acceptance===null&&quote.familyId===g.offer.material.familyId&&original.lifecycle.state==='active'&&!original.lifecycle.use);
   stored(!await this.operation(c,command.operationId));
   const prior=await c.tx.query('SELECT 1 AS present FROM ls_fishing_billing.guest_financial_acceptances WHERE workspace_id=$1 AND quote_id=$2 UNION ALL SELECT 1 FROM ls_fishing_billing.obligations WHERE workspace_id=$1 AND quote_id=$2 UNION ALL SELECT 1 FROM ls_fishing_billing.receipts WHERE workspace_id=$1 AND quote_id=$2 LIMIT 1',[this.workspaceId,quote.id]);stored(prior.length===0);
   const id=randomUUID();
   // Final current check precedes every own write. Rechecking after consumption
   // would invalidate the resolver's intentionally unchanged lifecycle/quote.
   const f=await this.resolver.current(c,cap,action);stored(f.kind==='fresh'&&same(f,first)&&f.presentation?.action===action&&f.statementSha256);
   const acceptedAt=this.acceptedTime(g),acceptance=verifyGuestFinancialAcceptance({
    version:BILLING_GUEST_V3,id,kind:'guest_grant',grantId:g.id,offer:g.offer,displayed:g.displayBundle,
    parent:{...command.parent,statementSha256:guestFinancialStatementSha256(f.presentation),privateEvidenceId:id},
    assuranceEvidenceId:f.currentEvidence.assuranceEvidenceId,operationId:command.operationId,acceptedAt,
   });
   stored(acceptance.parent.statementSha256===f.statementSha256);
   const accepted=acceptGuestFamilyOffer(quote,command.expectedVersion,acceptance),receipt=guestAcceptanceReceiptSchema.parse({version:BILLING_GUEST_V3,operationId:command.operationId,acceptanceId:id,quoteId:quote.id,acceptedRevision:accepted.revision,acceptedAt,replayed:false,paymentStateAtAcceptance:'unpaid'});
   const evidence=this.validateEvidence({version:BILLING_GUEST_V3,workspaceId:this.workspaceId,quoteId:quote.id,grantId:g.id,operationId:command.operationId,action,acceptance,currentEvidence:f.currentEvidence,presentation:f.presentation},g,command,receipt);
   const journal=guestOperationEnvelopeSchema.parse({version:BILLING_GUEST_V3,workspaceId:this.workspaceId,operationId:command.operationId,grantId:g.id,quoteId:quote.id,action,commandDigest:f.commandDigest,receipt});
   // Journal FIRST: evidence's composite FK binds the actual stored receipt ID.
   await tx.query('INSERT INTO ls_fishing_billing.guest_operations(workspace_id,operation_id,grant_id,quote_id,action,request_digest,receipt_id,receipt_ciphertext,recorded_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[this.workspaceId,command.operationId,g.id,quote.id,action,f.commandDigest,id,seal(JSON.stringify(journal),aad('operation',this.workspaceId,command.operationId),this.ring),acceptedAt]);
   await tx.query('INSERT INTO ls_fishing_billing.guest_financial_acceptances(workspace_id,id,quote_id,grant_id,operation_id,issued_revision,evidence_ciphertext,accepted_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[this.workspaceId,id,quote.id,g.id,command.operationId,g.offer.material.issuedRevision,seal(JSON.stringify(evidence),aad('financial_acceptance',this.workspaceId,id),this.ring),acceptedAt]);
   for(const l of accepted.lines)await tx.query('INSERT INTO ls_fishing_billing.obligations(workspace_id,quote_id,line_id,family_id,child_id,period_id,starts_at,ends_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[this.workspaceId,quote.id,l.id,quote.familyId,l.childId,l.period.id,l.period.startsAt,l.period.endsAt]);
   const updated=await tx.query('UPDATE ls_fishing_billing.quotes SET revision=$3,payload_ciphertext=$4 WHERE workspace_id=$1 AND id=$2 AND revision=$5 AND payload_ciphertext=$6 AND family_id=$7 AND definition_id=$8 AND created_at=$9 RETURNING id',[this.workspaceId,quote.id,accepted.revision,seal(JSON.stringify(accepted),aad('quote',this.workspaceId,quote.id),this.ring),before.revision,before.ciphertext,before.familyId,before.definitionId,before.createdAt]);stored(updated.length===1);
   const consumed=guestGrantLifecycleSchema.parse({...original.lifecycle,state:'consumed',use:{operationId:command.operationId,commandDigest:f.commandDigest,receiptId:id,usedAt:acceptedAt}});
   const used=await tx.query('UPDATE ls_fishing_billing.guest_grants SET state=$6,payload_ciphertext=$7 WHERE workspace_id=$1 AND id=$2 AND quote_id=$3 AND action=$4 AND state=$5 AND payload_ciphertext=$8 AND expires_at>$9 AND token_digest=$10 AND issued_at=$11 AND expires_at=$12 RETURNING id',[this.workspaceId,g.id,quote.id,action,'active','consumed',seal(JSON.stringify(consumed),grantAad(this.workspaceId,g.id),this.ring),original.row.ciphertext,acceptedAt,g.tokenDigest,g.issuedAt,g.expiresAt]);stored(used.length===1);
   return receipt;
  });}catch(error){if(error instanceof AppError)throw error;throw new AppError('UNAVAILABLE');}
 }
}
