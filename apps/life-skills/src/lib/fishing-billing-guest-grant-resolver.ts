import 'server-only';
import {createHmac} from 'node:crypto';
import {z} from 'zod';
import {AppError} from './errors.ts';
import {tokenDigest,unseal,type Keyring} from '../features/identity/crypto.ts';
import {lockWorkspace} from '../features/identity/data.ts';
import {one} from '../features/identity/store.ts';
import type {IdentityClock,WorkspaceId} from '../features/identity/types.ts';
import type {BillingLedgerContext} from '../features/fishing-billing/native.ts';
import {billingId,billingInstant} from '../features/fishing-billing/contracts.ts';
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
export interface BillingGuestGrantAuthority{
 /** Current server target/schema/service admission before any grant read.
  * Missing actual database/program binding must deny, never choose a fallback. */
 target(context:BillingLedgerContext):Promise<void>;
 /** Re-resolve actual current Academy family/children/inquiry, owner issue
  * authority, assurance and current policy/document release in this TX.
  * Even exact-operation replay requires current access and unexpired grant. */
 current(context:BillingLedgerContext,grant:GuestGrantRecord,mode:'fresh'|'replay'):Promise<void>;
 /** Verify the actual purpose/grant/bundle-bound presentation challenge, not a
  * browser boolean. Presentation/attestation is never proof of legal validity.
  * Only fresh mutations need a new display check; exact replay uses its receipt. */
 display(context:BillingLedgerContext,grant:GuestGrantRecord,challenge:string):Promise<void>;
}
type Row={id:string;quoteId:string;action:string;digest:string;state:string;issuedAt:Date;expiresAt:Date;ciphertext:string};
declare const guestCapabilityBrand:unique symbol;
export type ResolvedBillingGuestGrant={readonly [guestCapabilityBrand]:true};
type Facts=Readonly<{grant:GuestGrantRecord;command:Command;commandDigest:string;kind:'fresh'|'replay';originalReceiptId:string|null}>;
function freeze<T>(value:T):T{if(value&&typeof value==='object'){for(const item of Object.values(value))freeze(item);Object.freeze(value);}return value;}
function canonical(v:unknown):string{return v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical((v as Record<string,unknown>)[k])).join(',')+'}';}
const unavailable=()=>new AppError('UNAVAILABLE');

/** Unmounted, actor-free grant resolution only. No owner/parent session is
 * fabricated. No issue/consume/revoke, acceptance/obligation/journal write,
 * account creation, scheduler or provider is installed. The caller must run
 * resolution and its separately reviewed atomic mutation in the SAME TX.
 * Native grant schema/migration and actual authority remain separate gates. */
export class FishingBillingGuestGrantResolver{
 private readonly key:Buffer;
 private readonly capabilities=new WeakMap<object,{context:BillingLedgerContext;facts:Facts;lifecycle:Lifecycle}>();
 constructor(private readonly workspaceId:WorkspaceId,private readonly ring:Keyring,digestKey:Buffer,
  private readonly clock:IdentityClock,private readonly authority:BillingGuestGrantAuthority){
  billingId.parse(workspaceId);if(digestKey.length<32)throw unavailable();this.key=Buffer.from(digestKey);
 }
 private now(g:GuestGrantRecord){
  const now=this.clock.now();if(!(now instanceof Date)||!Number.isFinite(now.valueOf())||now.valueOf()<Date.parse(g.issuedAt)||now.valueOf()>=Date.parse(g.expiresAt))throw unavailable();return now;
 }
 private async load(context:BillingLedgerContext,digest:string,action:GuestGrantRecord['action']){
  const row=await one<Row>(context.tx,'SELECT id,quote_id AS "quoteId",action,token_digest AS digest,state,issued_at AS "issuedAt",expires_at AS "expiresAt",payload_ciphertext AS ciphertext FROM ls_fishing_billing.guest_grants WHERE workspace_id=$1 AND token_digest=$2 FOR UPDATE',[this.workspaceId,digest]);
  if(!row)throw unavailable();
  const lifecycle=guestGrantLifecycleSchema.parse(JSON.parse(unseal(row.ciphertext,'ls_fishing_billing/guest_grant/v3/'+this.workspaceId+'/'+row.id,this.ring))),g=verifyGuestGrantRecord(lifecycle.grant);
  if(g.id!==row.id||g.offer.material.workspaceId!==this.workspaceId||g.offer.material.quoteId!==row.quoteId||g.action!==action||row.action!==action||g.tokenDigest!==digest||row.digest!==digest||row.state!==lifecycle.state||row.issuedAt.valueOf()!==Date.parse(g.issuedAt)||row.expiresAt.valueOf()!==Date.parse(g.expiresAt)||lifecycle.state==='revoked')throw unavailable();
  const now=this.now(g);if(lifecycle.use&&Date.parse(lifecycle.use.usedAt)>now.valueOf())throw unavailable();return {lifecycle,g};
 }
 async resolve(context:BillingLedgerContext,rawToken:string,action:GuestGrantRecord['action'],rawCommand:unknown):Promise<ResolvedBillingGuestGrant>{
  try{
   if(context.workspaceId!==this.workspaceId)throw unavailable();
   const digest=tokenDigest(rawToken),command=action==='accept_financial_offer'?guestAcceptCommandSchema.parse(rawCommand):action==='submit_private_completion'?guestCompletionCommandSchema.parse(rawCommand):null;
   if(!command)throw unavailable();await this.authority.target(context);await lockWorkspace(context.tx,this.workspaceId);
   const {lifecycle,g}=await this.load(context,digest,action);
   if(command.displayBundleId!==g.displayBundle.id||command.displayBundleSha256!==g.displayBundle.sha256||'expectedVersion' in command&&command.expectedVersion!==g.offer.material.issuedRevision)throw unavailable();
   const commandDigest=createHmac('sha256',this.key).update(canonical({version:BILLING_GUEST_V3,workspaceId:this.workspaceId,grantId:g.id,action,command})).digest('hex');
   const kind=lifecycle.state==='consumed'?'replay' as const:'fresh' as const;
   if(lifecycle.use&&(lifecycle.use.operationId!==command.operationId||lifecycle.use.commandDigest!==commandDigest))throw unavailable();
   await this.authority.current(context,g,kind);this.now(g);
   if(kind==='fresh'){await this.authority.display(context,g,command.displayChallenge);this.now(g);}
   const facts=freeze({grant:g,command,commandDigest,kind,originalReceiptId:lifecycle.use?.receiptId??null}),capability=Object.freeze({}) as ResolvedBillingGuestGrant;
   this.capabilities.set(capability,{context,facts,lifecycle});return capability;
  }catch{throw unavailable();}
 }
 /** Current clock/policy is rechecked when the native caller consumes facts.
  * A capability from another resolver, workspace, TX/context or purpose denies.
  * Returning facts does NOT consume a one-use grant: native atomic journal/use
  * constraints and a final current check remain required before commit. */
 async current(context:BillingLedgerContext,capability:ResolvedBillingGuestGrant,action:GuestGrantRecord['action']):Promise<Facts>{
  try{
   const saved=this.capabilities.get(capability);if(!saved||saved.context!==context||context.workspaceId!==this.workspaceId||saved.facts.grant.action!==action)throw unavailable();
   await this.authority.target(context);
   const current=await this.load(context,saved.facts.grant.tokenDigest,action);
   if(canonical(current.lifecycle)!==canonical(saved.lifecycle))throw unavailable();
   await this.authority.current(context,current.g,saved.facts.kind);this.now(current.g);return saved.facts;
  }catch{throw unavailable();}
 }
}
