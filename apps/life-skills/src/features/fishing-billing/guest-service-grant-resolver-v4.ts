import 'server-only';
import {createHmac} from 'node:crypto';
import {z} from 'zod';
import {AppError} from '../../lib/errors.ts';
import {canonical} from '../contact-ops/core/validation.ts';
import {tokenDigest,unseal,type Keyring} from '../identity/crypto.ts';
import {lockWorkspace} from '../identity/data.ts';
import type {SqlSession} from '../identity/store.ts';
import type {WorkspaceId,IdentityClock} from '../identity/types.ts';
import type {BillingLedgerContext} from './native.ts';
import {billingId,billingInstant,sourceReferenceSchema} from './contracts.ts';
import {BILLING_SERVICE_V4,SERVICE_FINANCIAL_ACTION_V4,serviceGrantRecordV4Schema,serviceAcceptCommandV4Schema,servicePresentationV4Schema,serviceRecurringPresentationV4Schema,
 type ServiceGrantRecordV4,type ServiceAcceptCommandV4} from './guest-service-contract-v4.ts';
import {verifyServiceGrantRecordV4,validateServiceAcceptCommandV4,serviceFinancialStatementSha256V4} from './guest-service-material-v4.ts';
import {serviceGuestAadV4} from './guest-service-aad-v4.ts';
import {readIssuedServiceQuoteV4} from './guest-service-quote-readback-v4.ts';

const sha=z.string().regex(/^[a-f0-9]{64}$/),action=SERVICE_FINANCIAL_ACTION_V4;
export const serviceGrantLifecycleV4Schema=z.object({version:z.literal(BILLING_SERVICE_V4),grant:serviceGrantRecordV4Schema,state:z.enum(['active','consumed','revoked']),revokedAt:billingInstant.nullable(),
 use:z.object({operationId:billingId,commandDigest:sha,receiptId:billingId,usedAt:billingInstant}).strict().nullable(),
}).strict().superRefine((s,c)=>{
 if(s.state==='active'&&(s.revokedAt!==null||s.use!==null)||s.state==='consumed'&&(!s.use||s.revokedAt!==null)||s.state==='revoked'&&s.revokedAt===null||
  s.revokedAt&&Date.parse(s.revokedAt)<Date.parse(s.grant.issuedAt)||s.use&&(Date.parse(s.use.usedAt)<Date.parse(s.grant.issuedAt)||Date.parse(s.use.usedAt)>=Date.parse(s.grant.expiresAt))||
  s.use&&s.revokedAt&&Date.parse(s.revokedAt)<Date.parse(s.use.usedAt))c.addIssue({code:'custom',message:'SERVICE_GRANT_LIFECYCLE'});
});
export const serviceGuestCurrentEvidenceV4Schema=z.object({version:z.literal(BILLING_SERVICE_V4),workspaceId:billingId,familyId:billingId,quoteId:billingId,grantId:billingId,
 offerSnapshotSha256:sha,locale:z.enum(['en','he']),issuedByAccountId:billingId,recipientBindingEvidenceId:billingId,assuranceEvidenceId:billingId,
 financialTermsReleaseEvidenceId:billingId,admissionPolicy:sourceReferenceSchema,capacityEvidence:sourceReferenceSchema,
}).strict();
export const serviceGuestDisplayEvidenceV4Schema=z.object({presentation:servicePresentationV4Schema,recurringPresentation:serviceRecurringPresentationV4Schema.nullable()}).strict();
type Lifecycle=z.infer<typeof serviceGrantLifecycleV4Schema>;
type CurrentEvidence=z.infer<typeof serviceGuestCurrentEvidenceV4Schema>;
type DisplayEvidence=z.infer<typeof serviceGuestDisplayEvidenceV4Schema>;
export interface ServiceGuestGrantAuthorityV4{
 /** Actual current Academy/schema/purpose target BEFORE private lookup. No
  * configured owner ID, first practitioner, parsed JSON or hash is admission. */
 target(context:BillingLedgerContext):Promise<void>;
 /** Lock and recheck genuine current native family/children, original owner
  * issuance, guardian/recipient, exact financial terms release and actual
  * global sibling reservation in context.tx. Fresh mode additionally verifies
  * the complete current native service schedule. Replay checks current access
  * to the ORIGINAL agreement, not whether past activities remain future.
  * Locks/admission must remain valid through the caller's atomic commit. */
 current(context:BillingLedgerContext,grant:ServiceGrantRecordV4,mode:'fresh'|'replay'):Promise<CurrentEvidence>;
 /** Resolve the genuine grant/bundle/purpose/challenge-bound texts actually
  * shown in the parent's selected language. Exact immutable replay skips this
  * hook and verifies retained private evidence instead. Read-only/repeatable
  * before the native atomic writer consumes the one-use grant. */
 display(context:BillingLedgerContext,grant:ServiceGrantRecordV4,challenge:string):Promise<DisplayEvidence>;
}
type Row={id:string;quoteId:string;action:string;materialVersion:string|null;digest:string;state:string;issuedAt:Date;expiresAt:Date;ciphertext:string};
declare const capabilityBrand:unique symbol;
export type ResolvedServiceGuestGrantV4={readonly [capabilityBrand]:true};
type Facts=Readonly<{grant:ServiceGrantRecordV4;command:ServiceAcceptCommandV4;commandDigest:string;kind:'fresh'|'replay';originalReceiptId:string|null;
 currentEvidence:CurrentEvidence;display:DisplayEvidence|null;statementSha256:string|null}>;
function stored(condition:unknown):asserts condition{if(!condition)throw new AppError('UNAVAILABLE');}
function freeze<T>(value:T):T{if(value&&typeof value==='object'){for(const item of Object.values(value))freeze(item);Object.freeze(value);}return value;}
function precise(t:string){return Number.isFinite(Date.parse(t))&&!(/\.(\d+)/.exec(t)?.[1]?.slice(3)??'').replace(/0+$/,'');}

/** Actor-free, unmounted V4 resolution ONLY. Actual origin-authenticated quote
 * and exact-version grant SQL are read in the caller's real transaction. No
 * account, grant issue/revoke/consume, signature, obligation, hold, provider or
 * sender is installed. Capability is not serializable or transferable across
 * resolver/context/transaction instances; native atomic persistence is separate. */
export class FishingServiceGuestGrantResolverV4{
 private readonly key:Buffer;
 private readonly capabilities=new WeakMap<object,{context:BillingLedgerContext;tx:SqlSession;facts:Facts;lifecycle:Lifecycle}>();
 constructor(private readonly workspaceId:WorkspaceId,private readonly ring:Keyring,private readonly sourceIntegrityKey:string,key:Buffer,private readonly clock:IdentityClock,private readonly authority:ServiceGuestGrantAuthorityV4){
  stored(billingId.safeParse(workspaceId).success&&sourceIntegrityKey.length>=32&&key.length>=32&&authority);this.key=Buffer.from(key);
 }
 private context(c:BillingLedgerContext,tx:SqlSession){stored(c.workspaceId===this.workspaceId&&c.tx===tx);}
 private now(g:ServiceGrantRecordV4){const n=this.clock.now();stored(n instanceof Date&&Number.isFinite(n.valueOf())&&n.valueOf()>=Date.parse(g.issuedAt)&&n.valueOf()<Date.parse(g.expiresAt));return n;}
 private evidence(raw:unknown,g:ServiceGrantRecordV4){
  const e=serviceGuestCurrentEvidenceV4Schema.parse(raw),m=g.offer.material.financial,b=g.displayBundle;
  stored(e.workspaceId===this.workspaceId&&e.familyId===m.familyId&&e.quoteId===m.quoteId&&e.grantId===g.id&&e.offerSnapshotSha256===g.offer.sha256&&e.locale===b.locale&&
   e.issuedByAccountId===g.issuedByAccountId&&e.recipientBindingEvidenceId===g.recipientBindingEvidenceId&&e.financialTermsReleaseEvidenceId===b.financialTerms.releaseEvidenceId&&canonical(e.admissionPolicy)===canonical(g.admissionPolicy));
  return freeze(e);
 }
 private displayEvidence(raw:unknown,g:ServiceGrantRecordV4,command:ServiceAcceptCommandV4){
  const d=serviceGuestDisplayEvidenceV4Schema.parse(raw),p=d.presentation;
  stored(p.grantId===g.id&&p.displayBundleId===g.displayBundle.id&&p.displayBundleSha256===g.displayBundle.sha256&&p.locale===g.displayBundle.locale);
  validateServiceAcceptCommandV4(g.offer,g.displayBundle,command,p,d.recurringPresentation);return freeze(d);
 }
 private async load(c:BillingLedgerContext,digest:string){
  const tx=c.tx;this.context(c,tx);const data=Object.freeze({workspaceId:this.workspaceId,tx});
  const rows=await tx.query<Row>('SELECT id,quote_id AS "quoteId",action,material_version AS "materialVersion",token_digest AS digest,state,issued_at AS "issuedAt",expires_at AS "expiresAt",payload_ciphertext AS ciphertext FROM ls_fishing_billing.guest_grants WHERE workspace_id=$1 AND token_digest=$2 LIMIT 2 FOR UPDATE',[this.workspaceId,digest]);
  this.context(c,tx);
  stored(rows.length===1);const row=rows[0]!;
  // Purpose/version are selected BEFORE decryption, never a V3 fallback.
  stored(row.action===action&&row.materialVersion===BILLING_SERVICE_V4);
  const lifecycle=serviceGrantLifecycleV4Schema.parse(JSON.parse(unseal(row.ciphertext,serviceGuestAadV4('grant',this.workspaceId,row.id),this.ring))),g=freeze(verifyServiceGrantRecordV4(lifecycle.grant)),m=g.offer.material.financial;
  stored(g.id===row.id&&m.workspaceId===this.workspaceId&&m.quoteId===row.quoteId&&g.tokenDigest===digest&&row.digest===digest&&row.state===lifecycle.state&&
   row.issuedAt instanceof Date&&row.expiresAt instanceof Date&&row.issuedAt.valueOf()===Date.parse(g.issuedAt)&&row.expiresAt.valueOf()===Date.parse(g.expiresAt)&&
   precise(g.issuedAt)&&precise(g.expiresAt)&&(!lifecycle.use||precise(lifecycle.use.usedAt))&&(!lifecycle.revokedAt||precise(lifecycle.revokedAt))&&lifecycle.state!=='revoked');
  const n=this.now(g);stored(!lifecycle.use||Date.parse(lifecycle.use.usedAt)<=n.valueOf());
  const q=await readIssuedServiceQuoteV4(data,this.workspaceId,m.quoteId,this.ring,this.sourceIntegrityKey);this.context(c,tx);
  stored(canonical(q.offer)===canonical(g.offer));
  if(lifecycle.state==='active')stored(q.state==='issued'&&!q.paused&&q.acceptance===null&&q.revision===m.issuedRevision);
  this.now(g);
  return {g,lifecycle};
 }
 private async finalAdmission(c:BillingLedgerContext,tx:SqlSession,g:ServiceGrantRecordV4,kind:'fresh'|'replay',expected:CurrentEvidence){
  await this.authority.target(c);this.context(c,tx);
  const e=this.evidence(await this.authority.current(c,g,kind),g);this.context(c,tx);this.now(g);stored(canonical(e)===canonical(expected));
 }
 async resolve(c:BillingLedgerContext,rawToken:string,rawCommand:unknown):Promise<ResolvedServiceGuestGrantV4>{
  try{
   const tx=c.tx;this.context(c,tx);const command=freeze(serviceAcceptCommandV4Schema.parse(rawCommand)),digest=tokenDigest(rawToken);
   await this.authority.target(c);this.context(c,tx);await lockWorkspace(tx,this.workspaceId);this.context(c,tx);
   const {g,lifecycle}=await this.load(c,digest);this.context(c,tx);
   stored(command.expectedQuoteRevision===g.offer.material.financial.issuedRevision&&command.offerSnapshotSha256===g.offer.sha256&&command.displayBundleId===g.displayBundle.id&&command.displayBundleSha256===g.displayBundle.sha256);
   const commandDigest=createHmac('sha256',this.key).update(canonical({version:BILLING_SERVICE_V4,workspaceId:this.workspaceId,grantId:g.id,action,command})).digest('hex');
   const kind=lifecycle.state==='consumed'?'replay' as const:'fresh' as const;
   stored(!lifecycle.use||lifecycle.use.operationId===command.operationId&&lifecycle.use.commandDigest===commandDigest);
   const currentEvidence=this.evidence(await this.authority.current(c,g,kind),g);this.context(c,tx);this.now(g);
   const display=kind==='fresh'?this.displayEvidence(await this.authority.display(c,g,command.displayChallenge),g,command):null;
   this.context(c,tx);this.now(g);
   await this.finalAdmission(c,tx,g,kind,currentEvidence);
   const final=await this.load(c,digest);this.context(c,tx);stored(canonical(final.lifecycle)===canonical(lifecycle));
   const facts=freeze({grant:g,command,commandDigest,kind,originalReceiptId:lifecycle.use?.receiptId??null,currentEvidence,display,
    statementSha256:display?serviceFinancialStatementSha256V4(g.offer,g.displayBundle,display.presentation):null});
   const capability=Object.freeze({}) as ResolvedServiceGuestGrantV4;
   this.capabilities.set(capability,{context:c,tx,facts,lifecycle:freeze(lifecycle)});return capability;
  }catch{throw new AppError('UNAVAILABLE');}
 }
 /** Recheck actual current admission/expiry and identical locked facts before
  * any native writer mutation. Returning facts DOES NOT consume a grant or
  * resolve an UNKNOWN original operation. After own consumption, the caller
  * validates original private receipt/evidence rather than fabricating display. */
 async current(c:BillingLedgerContext,capability:ResolvedServiceGuestGrantV4):Promise<Facts>{
  try{
   const saved=this.capabilities.get(capability);stored(saved&&saved.context===c);this.context(c,saved.tx);
   await this.authority.target(c);this.context(c,saved.tx);
   const {g,lifecycle}=await this.load(c,saved.facts.grant.tokenDigest);this.context(c,saved.tx);stored(canonical(lifecycle)===canonical(saved.lifecycle));
   const e=this.evidence(await this.authority.current(c,g,saved.facts.kind),g);this.context(c,saved.tx);this.now(g);stored(canonical(e)===canonical(saved.facts.currentEvidence));
   if(saved.facts.kind==='fresh'){
    const d=this.displayEvidence(await this.authority.display(c,g,saved.facts.command.displayChallenge),g,saved.facts.command);this.context(c,saved.tx);this.now(g);stored(canonical(d)===canonical(saved.facts.display));
   }
   await this.finalAdmission(c,saved.tx,g,saved.facts.kind,e);
   const final=await this.load(c,g.tokenDigest);this.context(c,saved.tx);stored(canonical(final.lifecycle)===canonical(saved.lifecycle));
   return saved.facts;
  }catch{throw new AppError('UNAVAILABLE');}
 }
}
