import 'server-only';
import {createHash,createHmac} from 'node:crypto';
import {z} from 'zod';
import {AppError} from './errors.ts';
import {tokenDigest,unseal,type Keyring} from '../features/identity/crypto.ts';
import {lockWorkspace} from '../features/identity/data.ts';
import {one,type SqlSession} from '../features/identity/store.ts';
import type {IdentityClock,WorkspaceId} from '../features/identity/types.ts';
import type {BillingLedgerContext} from '../features/fishing-billing/native.ts';
import {billingId,billingInstant,sourceReferenceSchema} from '../features/fishing-billing/contracts.ts';
import {guestGrantRecordSchema,guestAcceptCommandSchema,guestCompletionCommandSchema,BILLING_GUEST_V3,type GuestGrantRecord} from './fishing-billing-guest-contract-v3.ts';
import {verifyGuestGrantRecord} from './fishing-billing-guest-material-v3.ts';

export const guestGrantLifecycleSchema=z.object({
 version:z.literal(BILLING_GUEST_V3),grant:guestGrantRecordSchema,state:z.enum(['active','consumed','revoked']),revokedAt:billingInstant.nullable(),
 use:z.object({operationId:billingId,commandDigest:z.string().regex(/^[a-f0-9]{64}$/),receiptId:billingId,usedAt:billingInstant}).strict().nullable(),
}).strict().superRefine((s,c)=>{
 const fail=()=>c.addIssue({code:'custom',message:'GRANT_LIFECYCLE'});
 if(s.state==='active'&&(s.revokedAt||s.use)||s.state==='consumed'&&(!s.use||s.revokedAt)||s.state==='revoked'&&!s.revokedAt)fail();
 if(s.revokedAt&&Date.parse(s.revokedAt)<Date.parse(s.grant.issuedAt))fail();
 if(s.use&&(Date.parse(s.use.usedAt)<Date.parse(s.grant.issuedAt)||Date.parse(s.use.usedAt)>=Date.parse(s.grant.expiresAt)))fail();
 if(s.use&&s.revokedAt&&Date.parse(s.revokedAt)<Date.parse(s.use.usedAt))fail();
});
type Lifecycle=z.infer<typeof guestGrantLifecycleSchema>;
type Command=z.infer<typeof guestAcceptCommandSchema>|z.infer<typeof guestCompletionCommandSchema>;
const sha=z.string().regex(/^[a-f0-9]{64}$/),text=z.string().min(1).max(2000).refine(t=>t.trim().length>0);
/** Server evidence references, not browser claims. The authority must resolve
 * actual existing records in this transaction; parsing cannot create them. */
export const guestCurrentEvidenceSchema=z.object({
 workspaceId:billingId,familyId:billingId,quoteId:billingId,grantId:billingId,
 recipientBindingEvidenceId:billingId,assuranceEvidenceId:billingId,admissionPolicy:sourceReferenceSchema,
}).strict();
const presentationScope={grantId:billingId,displayBundleId:billingId,displayBundleSha256:sha,locale:z.enum(['en','he']),evidenceId:billingId};
export const guestPresentationEvidenceSchema=z.discriminatedUnion('action',[
 z.object({...presentationScope,action:z.literal('accept_financial_offer'),affirmation:z.object({
  version:z.string().min(1).max(200),guardianAuthorityText:text,financialTermsText:text,
 }).strict()}).strict(),
 z.object({...presentationScope,action:z.literal('submit_private_completion')}).strict(),
]);
type CurrentEvidence=z.infer<typeof guestCurrentEvidenceSchema>;
type PresentationEvidence=z.infer<typeof guestPresentationEvidenceSchema>;
export interface BillingGuestGrantAuthority{
 /** Current server target/schema/service admission before any grant read.
  * Missing actual database/program binding must deny, never choose a fallback. */
 target(context:BillingLedgerContext):Promise<void>;
 /** Re-resolve actual current Academy family/children/inquiry, owner issue
  * authority, assurance and current policy/document release in this TX.
  * Even exact-operation replay requires current access and unexpired grant. */
 current(context:BillingLedgerContext,grant:GuestGrantRecord,mode:'fresh'|'replay'):Promise<CurrentEvidence>;
 /** Verify the actual purpose/grant/bundle-bound presentation challenge, not a
  * browser boolean. Presentation/attestation is never proof of legal validity.
  * Return the exact statement text actually shown with this challenge, not a
  * replacement/current translation. Validation is read-only and repeatable
  * until the native transaction consumes the grant. Exact replay skips it. */
 display(context:BillingLedgerContext,grant:GuestGrantRecord,challenge:string):Promise<PresentationEvidence>;
}
type Row={id:string;quoteId:string;action:string;digest:string;state:string;issuedAt:Date;expiresAt:Date;ciphertext:string};
declare const guestCapabilityBrand:unique symbol;
export type ResolvedBillingGuestGrant={readonly [guestCapabilityBrand]:true};
type Facts=Readonly<{grant:GuestGrantRecord;command:Command;commandDigest:string;kind:'fresh'|'replay';originalReceiptId:string|null;
 currentEvidence:CurrentEvidence;presentation:PresentationEvidence|null;statementSha256:string|null}>;
function freeze<T>(value:T):T{if(value&&typeof value==='object'){for(const item of Object.values(value))freeze(item);Object.freeze(value);}return value;}
function canonical(v:unknown):string{return v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical((v as Record<string,unknown>)[k])).join(',')+'}';}
const unavailable=()=>new AppError('UNAVAILABLE');
/** One canonical recipe for fresh acceptance and original-evidence readback.
 * The native caller retains these exact server-resolved texts in encrypted
 * evidence; this hash alone proves neither display nor identity nor approval. */
export function guestFinancialStatementSha256(raw:unknown):string{
 const p=guestPresentationEvidenceSchema.parse(raw);if(p.action!=='accept_financial_offer')throw unavailable();
 return createHash('sha256').update(canonical({locale:p.locale,...p.affirmation})).digest('hex');
}

/** Unmounted, actor-free grant resolution only. No owner/parent session is
 * fabricated. No issue/consume/revoke, acceptance/obligation/journal write,
 * account creation, scheduler or provider is installed. The caller must run
 * resolution and its separately reviewed atomic mutation in the SAME TX.
 * Native grant schema/migration and actual authority remain separate gates. */
export class FishingBillingGuestGrantResolver{
 private readonly key:Buffer;
 private readonly capabilities=new WeakMap<object,{context:BillingLedgerContext;tx:SqlSession;facts:Facts;lifecycle:Lifecycle}>();
 constructor(private readonly workspaceId:WorkspaceId,private readonly ring:Keyring,digestKey:Buffer,
  private readonly clock:IdentityClock,private readonly authority:BillingGuestGrantAuthority){
  billingId.parse(workspaceId);if(digestKey.length<32)throw unavailable();this.key=Buffer.from(digestKey);
 }
 private now(g:GuestGrantRecord){
  const now=this.clock.now();if(!(now instanceof Date)||!Number.isFinite(now.valueOf())||now.valueOf()<Date.parse(g.issuedAt)||now.valueOf()>=Date.parse(g.expiresAt))throw unavailable();return now;
 }
 private context(c:BillingLedgerContext,tx:SqlSession){if(c.workspaceId!==this.workspaceId||c.tx!==tx)throw unavailable();}
 private currentEvidence(raw:unknown,g:GuestGrantRecord){
  const e=guestCurrentEvidenceSchema.parse(raw),m=g.offer.material;
  if(e.workspaceId!==this.workspaceId||e.familyId!==m.familyId||e.quoteId!==m.quoteId||e.grantId!==g.id||e.recipientBindingEvidenceId!==g.recipientBindingEvidenceId||canonical(e.admissionPolicy)!==canonical(g.admissionPolicy))throw unavailable();
  return freeze(e);
 }
 private presentation(raw:unknown,g:GuestGrantRecord){
  const e=guestPresentationEvidenceSchema.parse(raw),b=g.displayBundle;
  if(e.action!==g.action||e.grantId!==g.id||e.displayBundleId!==b.id||e.displayBundleSha256!==b.sha256||e.locale!==b.locale)throw unavailable();return freeze(e);
 }
 private async load(context:BillingLedgerContext,digest:string,action:GuestGrantRecord['action']){
  const row=await one<Row>(context.tx,'SELECT id,quote_id AS "quoteId",action,token_digest AS digest,state,issued_at AS "issuedAt",expires_at AS "expiresAt",payload_ciphertext AS ciphertext FROM ls_fishing_billing.guest_grants WHERE workspace_id=$1 AND token_digest=$2 FOR UPDATE',[this.workspaceId,digest]);
  if(!row)throw unavailable();
  const lifecycle=guestGrantLifecycleSchema.parse(JSON.parse(unseal(row.ciphertext,'ls_fishing_billing/guest_grant/v3/'+this.workspaceId+'/'+row.id,this.ring))),g=freeze(verifyGuestGrantRecord(lifecycle.grant));
  if(g.id!==row.id||g.offer.material.workspaceId!==this.workspaceId||g.offer.material.quoteId!==row.quoteId||g.action!==action||row.action!==action||g.tokenDigest!==digest||row.digest!==digest||row.state!==lifecycle.state||row.issuedAt.valueOf()!==Date.parse(g.issuedAt)||row.expiresAt.valueOf()!==Date.parse(g.expiresAt)||lifecycle.state==='revoked')throw unavailable();
  const now=this.now(g);if(lifecycle.use&&Date.parse(lifecycle.use.usedAt)>now.valueOf())throw unavailable();return {lifecycle,g};
 }
 async resolve(context:BillingLedgerContext,rawToken:string,action:GuestGrantRecord['action'],rawCommand:unknown):Promise<ResolvedBillingGuestGrant>{
  try{
   const tx=context.tx;this.context(context,tx);
   const digest=tokenDigest(rawToken),command=action==='accept_financial_offer'?guestAcceptCommandSchema.parse(rawCommand):action==='submit_private_completion'?guestCompletionCommandSchema.parse(rawCommand):null;
   if(!command)throw unavailable();await this.authority.target(context);this.context(context,tx);await lockWorkspace(tx,this.workspaceId);this.context(context,tx);
   const {lifecycle,g}=await this.load(context,digest,action);this.context(context,tx);
   if(command.displayBundleId!==g.displayBundle.id||command.displayBundleSha256!==g.displayBundle.sha256||'expectedVersion' in command&&command.expectedVersion!==g.offer.material.issuedRevision)throw unavailable();
   const commandDigest=createHmac('sha256',this.key).update(canonical({version:BILLING_GUEST_V3,workspaceId:this.workspaceId,grantId:g.id,action,command})).digest('hex');
   const kind=lifecycle.state==='consumed'?'replay' as const:'fresh' as const;
   if(lifecycle.use&&(lifecycle.use.operationId!==command.operationId||lifecycle.use.commandDigest!==commandDigest))throw unavailable();
   const currentEvidence=this.currentEvidence(await this.authority.current(context,g,kind),g);this.context(context,tx);this.now(g);
   let presentation:PresentationEvidence|null=null;
   if(kind==='fresh'){presentation=this.presentation(await this.authority.display(context,g,command.displayChallenge),g);this.context(context,tx);this.now(g);}
   // Native persistence must retain presentation alongside the submitted name
   // in its encrypted evidence record. Its real record ID is privateEvidenceId;
   // recipient binding is not silently relabelled as assurance evidence.
   const statementSha256=presentation?.action==='accept_financial_offer'?guestFinancialStatementSha256(presentation):null;
   const facts=freeze({grant:g,command,commandDigest,kind,originalReceiptId:lifecycle.use?.receiptId??null,currentEvidence,presentation,statementSha256}),capability=Object.freeze({}) as ResolvedBillingGuestGrant;
   this.capabilities.set(capability,{context,tx,facts,lifecycle:freeze(lifecycle)});return capability;
  }catch{throw unavailable();}
 }
 /** Current clock/policy is rechecked when the native caller consumes facts.
  * A capability from another resolver, workspace, TX/context or purpose denies.
  * Returning facts does NOT consume a one-use grant: native atomic journal/use
  * constraints and a final current check remain required before commit. */
 async current(context:BillingLedgerContext,capability:ResolvedBillingGuestGrant,action:GuestGrantRecord['action']):Promise<Facts>{
  try{
   const saved=this.capabilities.get(capability);if(!saved||saved.context!==context||saved.facts.grant.action!==action)throw unavailable();this.context(context,saved.tx);
   await this.authority.target(context);this.context(context,saved.tx);
   const current=await this.load(context,saved.facts.grant.tokenDigest,action);this.context(context,saved.tx);
   if(canonical(current.lifecycle)!==canonical(saved.lifecycle))throw unavailable();
   const evidence=this.currentEvidence(await this.authority.current(context,current.g,saved.facts.kind),current.g);this.context(context,saved.tx);this.now(current.g);
   if(canonical(evidence)!==canonical(saved.facts.currentEvidence))throw unavailable();
   if(saved.facts.kind==='fresh'){
    const display=this.presentation(await this.authority.display(context,current.g,saved.facts.command.displayChallenge),current.g);this.context(context,saved.tx);this.now(current.g);
    if(canonical(display)!==canonical(saved.facts.presentation))throw unavailable();
   }
   return saved.facts;
  }catch{throw unavailable();}
 }
}
