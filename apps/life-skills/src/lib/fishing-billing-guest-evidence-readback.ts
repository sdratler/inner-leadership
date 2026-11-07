import 'server-only';
import {AppError} from './errors.ts';
import {unseal,type Keyring} from '../features/identity/crypto.ts';
import {one} from '../features/identity/store.ts';
import type {BillingLedgerContext} from '../features/fishing-billing/native.ts';
import {guestOperationEnvelopeSchema,guestFinancialEvidenceEnvelopeSchema} from '../features/fishing-billing/guest-native-v3.ts';
import {guestGrantLifecycleSchema,guestFinancialStatementSha256} from './fishing-billing-guest-grant-resolver.ts';
import {verifyGuestFamilyOffer,verifyGuestGrantRecord} from './fishing-billing-guest-material-v3.ts';

function requireFact(v:unknown):asserts v{if(!v)throw new AppError('UNAVAILABLE');}
const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const instant=(v:unknown)=>{const n=v instanceof Date?v.valueOf():typeof v==='string'?Date.parse(v):NaN;requireFact(Number.isFinite(n));return n;};
const aad=(kind:string,w:string,id:string)=>'ls_fishing_billing/guest/v3/'+kind+'/'+w+'/'+id;

/** Internal read-only integrity check. The caller MUST authenticate actual
 * current owner/native-family access before and after these reads in this TX.
 * It reads the actual Native envelopes; it cannot issue/accept/create debt,
 * establish identity/legal approval or authorize a guest. An expired/revoked
 * guest link does not erase properly authorized owner's financial history. */
export async function verifyStoredGuestFinancialEvidence(context:BillingLedgerContext,rawQuote:unknown,ring:Keyring):Promise<void>{
 const {tx,workspaceId}=context,q=verifyGuestFamilyOffer(rawQuote);requireFact(q.workspaceId===workspaceId);
 const obligations=await tx.query<{lineId:string;familyId:string;childId:string;periodId:string;startsAt:unknown;endsAt:unknown}>('SELECT line_id AS "lineId",family_id AS "familyId",child_id AS "childId",period_id AS "periodId",starts_at AS "startsAt",ends_at AS "endsAt" FROM ls_fishing_billing.obligations WHERE workspace_id=$1 AND quote_id=$2 LIMIT 11',[workspaceId,q.id]);
 if(!q.acceptance){
  requireFact(obligations.length===0);
  const rows=await tx.query('SELECT id FROM ls_fishing_billing.guest_financial_acceptances WHERE workspace_id=$1 AND quote_id=$2 LIMIT 1',[workspaceId,q.id]);requireFact(rows.length===0);return;
 }
 const a=q.acceptance;
 requireFact(obligations.length===q.lines.length&&q.lines.every(l=>obligations.some(o=>o.lineId===l.id&&o.familyId===q.familyId&&o.childId===l.childId&&o.periodId===l.period.id&&instant(o.startsAt)===instant(l.period.startsAt)&&instant(o.endsAt)===instant(l.period.endsAt))));
 const er=await one<{id:string;quoteId:string;grantId:string;operationId:string;action:string;issuedRevision:number;acceptedAt:unknown;ciphertext:string}>(tx,'SELECT id,quote_id AS "quoteId",grant_id AS "grantId",operation_id AS "operationId",action,issued_revision AS "issuedRevision",accepted_at AS "acceptedAt",evidence_ciphertext AS ciphertext FROM ls_fishing_billing.guest_financial_acceptances WHERE workspace_id=$1 AND id=$2',[workspaceId,a.id]);
 requireFact(er);
 const e=guestFinancialEvidenceEnvelopeSchema.parse(JSON.parse(unseal(er.ciphertext,aad('financial_acceptance',workspaceId,a.id),ring)));
 requireFact(e.workspaceId===workspaceId&&e.quoteId===q.id&&e.grantId===a.grantId&&e.operationId===a.operationId&&equal(e.acceptance,a));
 requireFact(er.id===a.id&&a.parent.privateEvidenceId===a.id&&er.quoteId===q.id&&er.grantId===a.grantId&&er.operationId===a.operationId&&er.action===e.action&&er.issuedRevision===a.offer.material.issuedRevision&&instant(er.acceptedAt)===instant(a.acceptedAt));
 const gr=await one<{id:string;quoteId:string;action:string;digest:string;state:string;issuedAt:unknown;expiresAt:unknown;ciphertext:string}>(tx,'SELECT id,quote_id AS "quoteId",action,token_digest AS digest,state,issued_at AS "issuedAt",expires_at AS "expiresAt",payload_ciphertext AS ciphertext FROM ls_fishing_billing.guest_grants WHERE workspace_id=$1 AND id=$2',[workspaceId,a.grantId]);
 requireFact(gr);
 const lifecycle=guestGrantLifecycleSchema.parse(JSON.parse(unseal(gr.ciphertext,'ls_fishing_billing/guest_grant/v3/'+workspaceId+'/'+a.grantId,ring))),g=verifyGuestGrantRecord(lifecycle.grant),use=lifecycle.use;
 requireFact(g.id===a.grantId&&g.action==='accept_financial_offer'&&g.offer.material.workspaceId===workspaceId&&equal(g.offer,a.offer)&&equal(g.displayBundle,a.displayed));
 requireFact(gr.id===g.id&&gr.quoteId===q.id&&gr.action===g.action&&gr.digest===g.tokenDigest&&gr.state===lifecycle.state&&instant(gr.issuedAt)===instant(g.issuedAt)&&instant(gr.expiresAt)===instant(g.expiresAt));
 requireFact(lifecycle.state!=='active'&&use&&use.operationId===a.operationId&&use.receiptId===a.id&&use.usedAt===a.acceptedAt);
 const c=e.currentEvidence,p=e.presentation;
 requireFact(c.workspaceId===workspaceId&&c.familyId===q.familyId&&c.quoteId===q.id&&c.grantId===g.id&&c.recipientBindingEvidenceId===g.recipientBindingEvidenceId&&c.assuranceEvidenceId===a.assuranceEvidenceId&&equal(c.admissionPolicy,g.admissionPolicy));
 requireFact(p.action==='accept_financial_offer'&&p.grantId===g.id&&p.displayBundleId===g.displayBundle.id&&p.displayBundleSha256===g.displayBundle.sha256&&p.locale===g.displayBundle.locale&&guestFinancialStatementSha256(p)===a.parent.statementSha256);
 const row=await one<{operationId:string;grantId:string;quoteId:string;action:string;digest:string;receiptId:string;recordedAt:unknown;ciphertext:string}>(tx,'SELECT operation_id AS "operationId",grant_id AS "grantId",quote_id AS "quoteId",action,request_digest AS digest,receipt_id AS "receiptId",recorded_at AS "recordedAt",receipt_ciphertext AS ciphertext FROM ls_fishing_billing.guest_operations WHERE workspace_id=$1 AND operation_id=$2',[workspaceId,a.operationId]);
 requireFact(row);
 const op=guestOperationEnvelopeSchema.parse(JSON.parse(unseal(row.ciphertext,aad('operation',workspaceId,a.operationId),ring))),r=op.receipt;
 requireFact(op.workspaceId===workspaceId&&op.operationId===a.operationId&&op.grantId===g.id&&op.quoteId===q.id&&op.action===g.action&&op.commandDigest===use.commandDigest);
 requireFact(row.operationId===op.operationId&&row.grantId===g.id&&row.quoteId===q.id&&row.action===op.action&&row.digest===op.commandDigest&&row.receiptId===a.id&&instant(row.recordedAt)===instant(a.acceptedAt));
 requireFact(r.operationId===a.operationId&&r.acceptanceId===a.id&&r.quoteId===q.id&&r.acceptedAt===a.acceptedAt&&r.acceptedRevision===a.offer.material.issuedRevision+1&&r.acceptedRevision<=q.revision&&!r.replayed);
}
