import 'server-only';
import {z} from 'zod';
import {AppError} from '../../lib/errors.ts';
import {canonical} from '../contact-ops/core/validation.ts';
import {unseal,type Keyring} from '../identity/crypto.ts';
import {one} from '../identity/store.ts';
import type {WorkspaceId} from '../identity/types.ts';
import type {BillingLedgerContext} from './native.ts';
import {billingId} from './contracts.ts';
import {BILLING_SERVICE_V4,SERVICE_FINANCIAL_ACTION_V4,serviceAcceptCommandV4Schema,serviceFinancialAcceptanceV4Schema,serviceAcceptanceReceiptV4Schema,
 type ServiceGrantRecordV4,type ServiceAcceptCommandV4,type ServiceAcceptanceReceiptV4} from './guest-service-contract-v4.ts';
import {serviceGrantLifecycleV4Schema,serviceGuestCurrentEvidenceV4Schema,serviceGuestDisplayEvidenceV4Schema,serviceGuestCommandDigestV4} from './guest-service-grant-resolver-v4.ts';
import {verifyServiceGrantRecordV4,verifyServiceFinancialAcceptanceV4} from './guest-service-material-v4.ts';
import {readIssuedServiceQuoteWithRowV4} from './guest-service-quote-readback-v4.ts';
import {serviceGuestAadV4} from './guest-service-aad-v4.ts';
import {readServicePreAcceptanceStateV4} from './guest-service-state-data-v4.ts';

const action=SERVICE_FINANCIAL_ACTION_V4,sha=z.string().regex(/^[a-f0-9]{64}$/);
export type ServiceGuestOperationRowV4={operationId:string;grantId:string;quoteId:string;action:string;materialVersion:string|null;digest:string;receiptId:string;recordedAt:Date;exactTime:boolean;ciphertext:string};
type GrantRow={id:string;quoteId:string;action:string;materialVersion:string|null;digest:string;state:string;issuedAt:Date;expiresAt:Date;exactTimes:boolean;ciphertext:string};
type EvidenceRow={id:string;quoteId:string;grantId:string;operationId:string;action:string;materialVersion:string|null;issuedRevision:number;acceptedAt:Date;exactTime:boolean;ciphertext:string};
export const serviceGuestOperationV4Schema=z.object({version:z.literal(BILLING_SERVICE_V4),workspaceId:billingId,operationId:billingId,grantId:billingId,quoteId:billingId,
 action:z.literal(action),commandDigest:sha,receipt:serviceAcceptanceReceiptV4Schema,
}).strict();
export const serviceGuestFinancialEvidenceV4Schema=z.object({version:z.literal(BILLING_SERVICE_V4),workspaceId:billingId,quoteId:billingId,grantId:billingId,operationId:billingId,
 action:z.literal(action),command:serviceAcceptCommandV4Schema,commandDigest:sha,acceptance:serviceFinancialAcceptanceV4Schema,currentEvidence:serviceGuestCurrentEvidenceV4Schema,display:serviceGuestDisplayEvidenceV4Schema,
}).strict();
function stored(condition:unknown):asserts condition{if(!condition)throw new AppError('UNAVAILABLE');}
function same(a:unknown,b:unknown){return canonical(a)===canonical(b);}
function precise(t:string){return Number.isFinite(Date.parse(t))&&!(/\.(\d+)/.exec(t)?.[1]?.slice(3)??'').replace(/0+$/,'');}
function instant(row:Date,expected:string){stored(row instanceof Date&&Number.isFinite(row.valueOf())&&precise(expected)&&row.valueOf()===Date.parse(expected));}
/** ONE original financial/display/command integrity verifier. Actual access,
 * guardian/legal/seat/provider authority is supplied separately by the caller. */
export function verifyServiceGuestEvidenceV4(raw:unknown,workspaceId:WorkspaceId,g:ServiceGrantRecordV4,command:ServiceAcceptCommandV4,commandDigest:string,r:ServiceAcceptanceReceiptV4){
 const e=serviceGuestFinancialEvidenceV4Schema.parse(raw),a=verifyServiceFinancialAcceptanceV4(e.acceptance,e.display.presentation,e.display.recurringPresentation),p=e.currentEvidence,m=g.offer.material.financial;
 stored(e.workspaceId===workspaceId&&e.quoteId===m.quoteId&&e.grantId===g.id&&e.operationId===command.operationId&&same(e.command,command)&&e.commandDigest===commandDigest);
 stored(a.id===r.acceptanceId&&a.operationId===command.operationId&&a.grantId===g.id&&same(a.offer,g.offer)&&same(a.displayed,g.displayBundle));
 stored(a.parent.privateEvidenceId===a.id&&a.parent.submittedName===command.parent.submittedName&&a.parent.guardianAuthorityAttested===command.parent.guardianAuthorityAttested&&
  a.parent.financialTermsAffirmed===command.parent.financialTermsAffirmed&&a.parent.serviceScheduleAffirmed===command.parent.serviceScheduleAffirmed&&same(a.recurring,command.recurring)&&
  a.recurringPrivateEvidenceId===(a.recurring.kind==='one_time_only'?null:a.id));
 stored(p.workspaceId===workspaceId&&p.familyId===m.familyId&&p.quoteId===m.quoteId&&p.grantId===g.id&&p.offerSnapshotSha256===g.offer.sha256&&p.locale===g.displayBundle.locale&&
  p.issuedByAccountId===g.issuedByAccountId&&p.recipientBindingEvidenceId===g.recipientBindingEvidenceId&&p.financialTermsReleaseEvidenceId===g.displayBundle.financialTerms.releaseEvidenceId&&same(p.admissionPolicy,g.admissionPolicy)&&a.assuranceEvidenceId===p.assuranceEvidenceId);
 stored(command.expectedQuoteRevision>=m.issuedRevision&&r.quoteId===m.quoteId&&r.operationId===command.operationId&&r.acceptedAt===a.acceptedAt&&r.acceptedRevision===command.expectedQuoteRevision+1&&!r.replayed);return e;
}
export function readServiceGuestOperationRowV4(c:BillingLedgerContext,workspaceId:WorkspaceId,id:string){
 stored(c.workspaceId===workspaceId);return one<ServiceGuestOperationRowV4>(c.tx,'SELECT operation_id AS "operationId",grant_id AS "grantId",quote_id AS "quoteId",action,material_version AS "materialVersion",request_digest AS digest,receipt_id AS "receiptId",recorded_at AS "recordedAt",recorded_at=date_trunc(\'milliseconds\',recorded_at) AS "exactTime",receipt_ciphertext AS ciphertext FROM ls_fishing_billing.guest_operations WHERE workspace_id=$1 AND operation_id=$2',[workspaceId,id]);
}
/** Shared server-only DATA readback in the caller's actual locked transaction.
 * Caller MUST establish genuine owner or exact-purpose guest admission before
 * lookup and current family/access through commit. History authenticates the
 * ORIGINAL issuance/use-time window even after expiry/revocation; it does NOT
 * admit an expired token, refresh a grant, create acceptance or resolve a
 * provider outcome. Guest callers additionally enforce CURRENT grant expiry.
 * No V3 decoder/cast, synthetic account or alternate financial ledger. */
async function readPinnedServiceAcceptanceDataV4(c:BillingLedgerContext,workspaceId:WorkspaceId,id:string,ring:Keyring,sourceKey:string,commandKey:Buffer){
 stored(c.workspaceId===workspaceId&&billingId.safeParse(id).success&&commandKey.length>=32&&c.now instanceof Date&&Number.isFinite(c.now.valueOf()));
 const frame=await readIssuedServiceQuoteWithRowV4(c,workspaceId,id,ring,sourceKey),q=frame.quote,a=q.acceptance;
 stored(Date.parse(q.createdAt)<=c.now.valueOf()&&q.issuedAt!==null&&Date.parse(q.issuedAt)<=c.now.valueOf());
 if(!a){
  await readServicePreAcceptanceStateV4(c,workspaceId,q,q.revision,{state:q.state==='cancelled'?'cancelled':'issued',paused:q.paused},ring,sourceKey);
  const existing=await c.tx.query('SELECT 1 FROM ls_fishing_billing.guest_operations WHERE workspace_id=$1 AND quote_id=$2 UNION ALL SELECT 1 FROM ls_fishing_billing.guest_financial_acceptances WHERE workspace_id=$1 AND quote_id=$2 UNION ALL SELECT 1 FROM ls_fishing_billing.obligations WHERE workspace_id=$1 AND quote_id=$2 UNION ALL SELECT 1 FROM ls_fishing_billing.receipts WHERE workspace_id=$1 AND quote_id=$2 LIMIT 1',[workspaceId,id]);
  stored(existing.length===0);return {...frame,original:null};
 }
 stored(Date.parse(a.acceptedAt)<=c.now.valueOf());
 const gr=await one<GrantRow>(c.tx,'SELECT id,quote_id AS "quoteId",action,material_version AS "materialVersion",token_digest AS digest,state,issued_at AS "issuedAt",expires_at AS "expiresAt",(issued_at=date_trunc(\'milliseconds\',issued_at) AND expires_at=date_trunc(\'milliseconds\',expires_at)) AS "exactTimes",payload_ciphertext AS ciphertext FROM ls_fishing_billing.guest_grants WHERE workspace_id=$1 AND id=$2 FOR SHARE',[workspaceId,a.grantId]);
 stored(gr&&gr.action===action&&gr.materialVersion===BILLING_SERVICE_V4&&gr.exactTimes===true);
 const lifecycle=serviceGrantLifecycleV4Schema.parse(JSON.parse(unseal(gr.ciphertext,serviceGuestAadV4('grant',workspaceId,a.grantId),ring))),g=verifyServiceGrantRecordV4(lifecycle.grant),use=lifecycle.use;
 stored(g.id===a.grantId&&gr.id===g.id&&gr.quoteId===q.id&&gr.digest===g.tokenDigest&&gr.state===lifecycle.state&&same(g.offer,q.offer)&&
  use&&lifecycle.state!=='active'&&use.receiptId===a.id&&use.operationId===a.operationId&&use.usedAt===a.acceptedAt&&(!lifecycle.revokedAt||precise(lifecycle.revokedAt)&&Date.parse(lifecycle.revokedAt)<=c.now.valueOf()));
 instant(gr.issuedAt,g.issuedAt);instant(gr.expiresAt,g.expiresAt);stored(precise(use.usedAt));
 const row=await readServiceGuestOperationRowV4(c,workspaceId,a.operationId);stored(row&&row.action===action&&row.materialVersion===BILLING_SERVICE_V4&&row.exactTime===true);
 const op=serviceGuestOperationV4Schema.parse(JSON.parse(unseal(row.ciphertext,serviceGuestAadV4('operation',workspaceId,a.operationId),ring))),r=op.receipt;
 stored(op.workspaceId===workspaceId&&op.operationId===a.operationId&&op.operationId===row.operationId&&op.grantId===g.id&&op.grantId===row.grantId&&op.quoteId===q.id&&op.quoteId===row.quoteId&&
  op.commandDigest===row.digest&&row.digest===use.commandDigest&&row.receiptId===a.id&&r.acceptanceId===a.id&&r.acceptedAt===use.usedAt);instant(row.recordedAt,r.acceptedAt);
 const er=await one<EvidenceRow>(c.tx,'SELECT id,quote_id AS "quoteId",grant_id AS "grantId",operation_id AS "operationId",action,material_version AS "materialVersion",issued_revision AS "issuedRevision",accepted_at AS "acceptedAt",accepted_at=date_trunc(\'milliseconds\',accepted_at) AS "exactTime",evidence_ciphertext AS ciphertext FROM ls_fishing_billing.guest_financial_acceptances WHERE workspace_id=$1 AND id=$2',[workspaceId,a.id]);
 stored(er&&er.action===action&&er.materialVersion===BILLING_SERVICE_V4&&er.exactTime===true);
 const raw=serviceGuestFinancialEvidenceV4Schema.parse(JSON.parse(unseal(er.ciphertext,serviceGuestAadV4('financial_acceptance',workspaceId,a.id),ring))),expected=serviceGuestCommandDigestV4(workspaceId,g.id,raw.command,commandKey);
 const evidence=verifyServiceGuestEvidenceV4(raw,workspaceId,g,raw.command,expected,r);
 await readServicePreAcceptanceStateV4(c,workspaceId,q,raw.command.expectedQuoteRevision,{state:'issued',paused:false},ring,sourceKey);
 stored(expected===op.commandDigest&&same(a,evidence.acceptance)&&er.id===a.id&&er.quoteId===q.id&&er.grantId===g.id&&er.operationId===a.operationId&&er.issuedRevision===g.offer.material.financial.issuedRevision&&q.revision>=r.acceptedRevision);instant(er.acceptedAt,r.acceptedAt);
 const obligations=await c.tx.query<{lineId:string;familyId:string;childId:string;periodId:string;startsAt:Date;endsAt:Date;exactTimes:boolean}>('SELECT line_id AS "lineId",family_id AS "familyId",child_id AS "childId",period_id AS "periodId",starts_at AS "startsAt",ends_at AS "endsAt",(starts_at=date_trunc(\'milliseconds\',starts_at) AND ends_at=date_trunc(\'milliseconds\',ends_at)) AS "exactTimes" FROM ls_fishing_billing.obligations WHERE workspace_id=$1 AND quote_id=$2 LIMIT 11',[workspaceId,id]);
 stored(obligations.length===q.lines.length);
 for(const l of q.lines){const matches=obligations.filter(o=>o.lineId===l.id&&o.familyId===q.familyId&&o.childId===l.childId&&o.periodId===l.period.id);stored(matches.length===1&&matches[0]!.exactTimes===true);instant(matches[0]!.startsAt,l.period.startsAt);instant(matches[0]!.endsAt,l.period.endsAt);}
 return {...frame,original:{grant:g,lifecycle,receipt:r,evidence}};
}
export async function readServiceAcceptanceDataV4(c:BillingLedgerContext,workspaceId:WorkspaceId,id:string,ring:Keyring,sourceKey:string,commandKey:Buffer){
 const tx=c.tx,physical=tx.query,time=c.now,at=time.valueOf(),query=physical.bind(tx);let open=true;
 const guard=()=>stored(open&&c.workspaceId===workspaceId&&c.tx===tx&&tx.query===physical&&c.now===time&&time.valueOf()===at&&Number.isFinite(at));
 const owned=Object.freeze({workspaceId,now:new Date(at),tx:Object.freeze({query:async<R extends object>(sql:string,v:readonly unknown[]=[])=>{
  guard();const rows=await query<R>(sql,v);guard();return rows;
 }})});
 try{guard();const result=await readPinnedServiceAcceptanceDataV4(owned,workspaceId,id,ring,sourceKey,commandKey);guard();return result;}finally{open=false;}
}
