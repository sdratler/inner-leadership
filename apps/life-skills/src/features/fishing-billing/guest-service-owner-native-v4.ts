import 'server-only';
import {AppError} from '../../lib/errors.ts';
import {canonical} from '../contact-ops/core/validation.ts';
import {seal,type Keyring} from '../identity/crypto.ts';
import {one} from '../identity/store.ts';
import type {Actor,WorkspaceId,IdentityClock} from '../identity/types.ts';
import type {BillingContext} from './native.ts';
import {billingId} from './contracts.ts';
import {FishingProgramSourceNativeV3} from './program-source-native-v3.ts';
import {FishingBillingGuestOwnerStore} from '../../lib/fishing-billing-guest-owner-store.ts';
import {FishingGuestServiceMaterialNativeV4} from './guest-service-material-native-v4.ts';
import {BILLING_SERVICE_V4,type ServiceOfferBindingV4,type ServiceFamilyOfferV4} from './guest-service-contract-v4.ts';
import {issueServiceFinancialOfferV4} from './guest-service-domain-v4.ts';
import {serviceGuestAadV4} from './guest-service-aad-v4.ts';
import {SERVICE_OWNER_ISSUE_ACTION_V4,serviceOwnerIssueCommandV4Schema,serviceIssueEvidenceV4Schema,serviceOwnerIssueReceiptV4Schema as receiptSchema,
 type ServiceOwnerIssueCommandV4,type ServiceIssueEvidenceV4 as Evidence,type ServiceOwnerIssueReceiptV4 as Receipt} from './guest-service-owner-contract-v4.ts';
import {serviceOwnerIssueJournalV4Schema as journalSchema,serviceOwnerCommandDigestV4,decodeServiceIssueJournalV4,serviceIssueJournalRowV4,readIssuedServiceQuoteV4} from './guest-service-quote-readback-v4.ts';
export {serviceOwnerIssueCommandV4Schema,serviceIssueEvidenceV4Schema} from './guest-service-owner-contract-v4.ts';
export type {ServiceOwnerIssueCommandV4} from './guest-service-owner-contract-v4.ts';
const action=SERVICE_OWNER_ISSUE_ACTION_V4;
export interface ServiceOwnerIssueAuthorityV4{
 /** Actual V4 target/schema/configured owner admission, no role/default or V3
  * policy fallback. No provider/send/charge is performed by this interface. */
 target(context:Readonly<BillingContext>):Promise<void>;
 /** Resolve and lock genuine current native family/children/guardian/recipient,
  * exact terms release/parent-chosen locale and actual shared sibling capacity
  * in context.tx. Capacity must be genuine native provisional reservation,
  * not a proposed count/owner note. Recheck at terminal; replay/read resolve
  * current access to ORIGINAL material without issuing or reserving again. */
 current(context:Readonly<BillingContext>,request:Readonly<{phase:'fresh'|'terminal'|'replay'|'read';offer:ServiceOfferBindingV4;locale:'en'|'he'}>):Promise<Evidence>;
}
function fail(code:'UNAVAILABLE'|'CONFLICT'|'FORBIDDEN'='UNAVAILABLE'):never{throw new AppError(code);}
function freeze<T>(value:T):T{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}
/** Native owner issuer, ONE existing quote/command ledger. Requires the real
 * configured owner source, original unissued V3 provenance, current complete
 * V4 schedule and mandatory independently composed V4 admission. No grant,
 * acceptance, debt, sender, provider or 24h hold clock is created here. */
export class FishingGuestServiceOwnerNativeV4{
 constructor(private readonly workspaceId:WorkspaceId,private readonly programme:FishingProgramSourceNativeV3,private readonly basis:FishingBillingGuestOwnerStore,
  private readonly material:FishingGuestServiceMaterialNativeV4,private readonly authority:ServiceOwnerIssueAuthorityV4,
  private readonly ring:Keyring,private readonly key:string,private readonly clock:IdentityClock){billingId.parse(workspaceId);if(key.length<32||!authority)fail();}
 private request(actorId:string,command:ServiceOwnerIssueCommandV4){return serviceOwnerCommandDigestV4(this.workspaceId,this.key,actorId,command);}
 private now(){const n=this.clock.now();if(!(n instanceof Date)||!Number.isFinite(n.valueOf()))fail();return n.toISOString();}
 private context(c:Readonly<BillingContext>){if(c.workspaceId!==this.workspaceId||c.actor.workspaceId!==this.workspaceId)fail('FORBIDDEN');}
 private async permission(c:Readonly<BillingContext>,offer:ServiceOfferBindingV4,locale:'en'|'he',phase:'fresh'|'terminal'|'replay'|'read'){
  this.context(c);const view=Object.freeze({...c,actor:Object.freeze({...c.actor}),now:new Date(c.now)});
  await this.authority.target(view);
  const evidence=serviceIssueEvidenceV4Schema.parse(await this.authority.current(view,freeze({phase,offer:structuredClone(offer),locale}))),m=offer.material.financial;
  if(evidence.workspaceId!==this.workspaceId||evidence.actorId!==c.actor.id||evidence.quoteId!==m.quoteId||evidence.familyId!==m.familyId||evidence.materialSha256!==offer.sha256||evidence.locale!==locale)fail('FORBIDDEN');
  return evidence;
 }
 private async quote(c:Readonly<BillingContext>,id:string){
  this.context(c);return readIssuedServiceQuoteV4(c,this.workspaceId,id,this.ring,this.key);
 }
 private async original(c:Readonly<BillingContext>,command:ServiceOwnerIssueCommandV4):Promise<Receipt|null>{
  const row=await serviceIssueJournalRowV4(c,this.workspaceId,command.operationId);
  if(!row)return null;if(row.action!=='guest_service_issue_v4'||row.actorId!==c.actor.id||row.quoteId!==command.quoteId||row.requestDigest!==this.request(c.actor.id,command))fail('CONFLICT');
  const j=decodeServiceIssueJournalV4(row,this.workspaceId,this.ring,this.key),r=j.receipt;if(canonical(j.command)!==canonical(command))fail();
  const actual=await this.quote(c,command.quoteId);
  const evidence=await this.permission(c,r.quote.offer,command.locale,'replay');
  if(canonical(evidence)!==canonical(r.evidence)||canonical(await this.permission(c,r.quote.offer,command.locale,'replay'))!==canonical(evidence)||canonical(await this.quote(c,command.quoteId))!==canonical(actual))fail();return {...r,replayed:true};
 }
 async issue(actor:Actor,raw:unknown){
  const command=serviceOwnerIssueCommandV4Schema.parse(raw),principal=Object.freeze({...actor});
  // An explicit preflight denial starts no transaction. Like a rolled-back
  // current invocation, it never resolves a previously UNKNOWN operation.
  if(principal.workspaceId!==this.workspaceId)return {state:'rejected_current_attempt' as const,code:'FORBIDDEN' as const,version:BILLING_SERVICE_V4,action,workspaceId:this.workspaceId,actorId:principal.id,command};
  const outcome=await this.programme.withOwnerTransactionOutcome(principal,async c=>{
   this.context(c);await this.authority.target(Object.freeze({...c,actor:Object.freeze({...c.actor}),now:new Date(c.now)}));
   const prior=await this.original(c,command);if(prior)return prior;
   const data=await this.basis.readPristineServiceBasisInTransactionV4(c,principal,command.quoteId);
   if(data.quote.revision!==command.expectedQuoteRevision)fail('CONFLICT');
   const draft=await this.material.previewInTransaction(c,data,command.material);if(draft.sha256!==command.expectedDraftSha256)fail('CONFLICT');
   const issuedAt=this.now(),quote=issueServiceFinancialOfferV4(draft,command.expectedQuoteRevision,issuedAt,command.locale),evidence=await this.permission(c,quote.offer,command.locale,'fresh');
   // Authority may reserve actual seats in this TX, but must not change the
   // financial origin, source, quote state or scope behind this operation.
   const before=await this.basis.readPristineServiceBasisInTransactionV4(c,principal,command.quoteId);
   if(canonical(before)!==canonical(data))fail();
   const changed=await one(c.tx,'UPDATE ls_fishing_billing.quotes SET revision=$4,payload_ciphertext=$5,material_version=$6 WHERE workspace_id=$1 AND id=$2 AND revision=$3 AND material_version IS NULL RETURNING id',
    [this.workspaceId,command.quoteId,command.expectedQuoteRevision,quote.revision,seal(JSON.stringify(quote),serviceGuestAadV4('quote',this.workspaceId,quote.id),this.ring),BILLING_SERVICE_V4]);if(!changed)fail('CONFLICT');
   const receipt=receiptSchema.parse({version:BILLING_SERVICE_V4,action,workspaceId:this.workspaceId,actorId:c.actor.id,operationId:command.operationId,quote,evidence,issuedAt,replayed:false,financialState:'unaccepted',offerHoldClock:'awaiting_known_successful_send'});
   const journal=journalSchema.parse({version:BILLING_SERVICE_V4,kind:'owner_service_issue',workspaceId:this.workspaceId,actorId:c.actor.id,command,commandDigest:this.request(c.actor.id,command),draft,receipt});
   await c.tx.query('INSERT INTO ls_fishing_billing.commands(workspace_id,operation_id,actor_id,action,quote_id,request_digest,result_ciphertext,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
    [this.workspaceId,command.operationId,c.actor.id,'guest_service_issue_v4',quote.id,journal.commandDigest,seal(JSON.stringify(journal),serviceGuestAadV4('owner_issue',this.workspaceId,command.operationId),this.ring),issuedAt]);
   if(canonical(await this.material.previewInTransaction(c,data,command.material))!==canonical(draft)||canonical(await this.permission(c,quote.offer,command.locale,'terminal'))!==canonical(evidence)||canonical(await this.quote(c,quote.id))!==canonical(quote))fail();
   return receipt;
  });
  return {...outcome,version:BILLING_SERVICE_V4,action,workspaceId:this.workspaceId,actorId:principal.id,command};
 }
 /** Original issuance/material view, not a payable/balance proof. A financial
  * consumer must additionally authenticate actual stored acceptance evidence. */
 async readQuote(actor:Actor,id:string):Promise<ServiceFamilyOfferV4>{
  billingId.parse(id);return this.programme.withOwnerTransaction(actor,async c=>{
   this.context(c);await this.authority.target(Object.freeze({...c,actor:Object.freeze({...c.actor}),now:new Date(c.now)}));
   const quote=await this.quote(c,id),evidence=await this.permission(c,quote.offer,quote.messageLocaleAtIssue,'read');
   if(canonical(await this.permission(c,quote.offer,quote.messageLocaleAtIssue,'read'))!==canonical(evidence)||canonical(await this.quote(c,id))!==canonical(quote))fail();return quote;
  });
 }
}
