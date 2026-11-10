import 'server-only';
import {randomUUID} from 'node:crypto';
import {AppError} from '../../lib/errors.ts';
import {canonical} from '../contact-ops/core/validation.ts';
import {seal,unseal,type Keyring} from '../identity/crypto.ts';
import {one,type IdentityStore,type SqlSession} from '../identity/store.ts';
import type {WorkspaceId,IdentityClock} from '../identity/types.ts';
import type {BillingLedgerContext} from './native.ts';
import {billingId} from './contracts.ts';
import {BILLING_SERVICE_V4,SERVICE_FINANCIAL_ACTION_V4,serviceAcceptCommandV4Schema,serviceAcceptanceReceiptV4Schema,
 type ServiceGrantRecordV4,type ServiceAcceptCommandV4,type ServiceAcceptanceReceiptV4,type ServiceAcceptanceOutcomeV4} from './guest-service-contract-v4.ts';
import {verifyServiceFinancialAcceptanceV4} from './guest-service-material-v4.ts';
import {acceptServiceFinancialOfferV4} from './guest-service-domain-v4.ts';
import {readIssuedServiceQuoteWithRowV4} from './guest-service-quote-readback-v4.ts';
import {serviceGuestAadV4} from './guest-service-aad-v4.ts';
import {FishingServiceGuestGrantResolverV4,serviceGrantLifecycleV4Schema} from './guest-service-grant-resolver-v4.ts';
import {readServiceAcceptanceDataV4,readServiceGuestOperationRowV4,verifyServiceGuestEvidenceV4,serviceGuestOperationV4Schema} from './guest-service-acceptance-data-v4.ts';
export {serviceGuestOperationV4Schema,serviceGuestFinancialEvidenceV4Schema} from './guest-service-acceptance-data-v4.ts';

const action=SERVICE_FINANCIAL_ACTION_V4;
type Facts=Awaited<ReturnType<FishingServiceGuestGrantResolverV4['current']>>;
type GrantRow={id:string;quoteId:string;action:string;materialVersion:string|null;digest:string;state:string;issuedAt:Date;expiresAt:Date;exactTimes:boolean;ciphertext:string};
type RejectedCode='UNAVAILABLE'|'CONFLICT'|'FORBIDDEN'|'NOT_FOUND'|'UNAUTHENTICATED'|'INVALID_REQUEST';
class NativeAcceptanceRejection extends Error{constructor(readonly code:RejectedCode){super(code);}}
function stored(condition:unknown):asserts condition{if(!condition)throw new AppError('UNAVAILABLE');}
function same(a:unknown,b:unknown){return canonical(a)===canonical(b);}
function instant(row:Date,expected:string){stored(row instanceof Date&&Number.isFinite(row.valueOf())&&row.valueOf()===Date.parse(expected));}

/** Actual atomic V4 acceptance in the ONE existing quote/obligation ledger.
 * Mandatory constructor-owned resolver supplies genuine target/current/display
 * admission; this class creates no owner session, grant or permission and has
 * no provider/sender/hold-clock path. All private evidence is retained encrypted.
 * No V3 grant/signature/ciphertext is converted or tried as decoder fallback. */
export class FishingServiceGuestNativeV4{
 private readonly commandKey:Buffer;
 constructor(private readonly db:IdentityStore,private readonly workspaceId:WorkspaceId,private readonly ring:Keyring,private readonly sourceIntegrityKey:string,
  commandKey:Buffer,private readonly clock:IdentityClock,private readonly resolver:FishingServiceGuestGrantResolverV4){
  stored(billingId.safeParse(workspaceId).success&&sourceIntegrityKey.length>=32&&commandKey.length>=32&&resolver);this.commandKey=Buffer.from(commandKey);
 }
 private now(g:ServiceGrantRecordV4){const n=this.clock.now();stored(n instanceof Date&&Number.isFinite(n.valueOf())&&n.valueOf()>=Date.parse(g.issuedAt)&&n.valueOf()<Date.parse(g.expiresAt));return n.toISOString();}
 private quote(c:BillingLedgerContext,id:string){return readIssuedServiceQuoteWithRowV4(c,this.workspaceId,id,this.ring,this.sourceIntegrityKey);}
 private async grant(c:BillingLedgerContext,f:Facts){
  const g=f.grant,row=await one<GrantRow>(c.tx,'SELECT id,quote_id AS "quoteId",action,material_version AS "materialVersion",token_digest AS digest,state,issued_at AS "issuedAt",expires_at AS "expiresAt",(issued_at=date_trunc(\'milliseconds\',issued_at) AND expires_at=date_trunc(\'milliseconds\',expires_at)) AS "exactTimes",payload_ciphertext AS ciphertext FROM ls_fishing_billing.guest_grants WHERE workspace_id=$1 AND id=$2 FOR UPDATE',[this.workspaceId,g.id]);
  stored(row&&row.action===action&&row.materialVersion===BILLING_SERVICE_V4&&row.exactTimes===true);
  const lifecycle=serviceGrantLifecycleV4Schema.parse(JSON.parse(unseal(row.ciphertext,serviceGuestAadV4('grant',this.workspaceId,g.id),this.ring)));
  stored(same(lifecycle.grant,g)&&row.id===g.id&&row.quoteId===g.offer.material.financial.quoteId&&row.digest===g.tokenDigest&&row.state===lifecycle.state);
  instant(row.issuedAt,g.issuedAt);instant(row.expiresAt,g.expiresAt);return {row,lifecycle};
 }
 private operation(c:BillingLedgerContext,id:string){return readServiceGuestOperationRowV4(c,this.workspaceId,id);}
 private evidence(raw:unknown,g:ServiceGrantRecordV4,command:ServiceAcceptCommandV4,commandDigest:string,r:ServiceAcceptanceReceiptV4){
  return verifyServiceGuestEvidenceV4(raw,this.workspaceId,g,command,commandDigest,r);
 }
 private async original(c:BillingLedgerContext,f:Facts,receiptId:string):Promise<ServiceAcceptanceReceiptV4>{
  const frame=await readServiceAcceptanceDataV4(Object.freeze({...c,now:this.clock.now()}),this.workspaceId,f.grant.offer.material.financial.quoteId,this.ring,this.sourceIntegrityKey,this.commandKey),o=frame.original;
  stored(o&&o.receipt.acceptanceId===receiptId&&same(o.grant,f.grant)&&same(o.evidence.command,f.command)&&o.evidence.commandDigest===f.commandDigest);
  this.now(f.grant);return serviceAcceptanceReceiptV4Schema.parse({...o.receipt,replayed:true});
 }
 private async work(c:BillingLedgerContext,rawToken:string,command:ServiceAcceptCommandV4){
  const cap=await this.resolver.resolve(c,rawToken,command),first=await this.resolver.current(c,cap);
  if(first.kind==='replay'){
   stored(first.originalReceiptId);const receipt=await this.original(c,first,first.originalReceiptId);
   const final=await this.resolver.current(c,cap);stored(same(first,final));return receipt;
  }
  const g=first.grant,{quote,row:before}=await this.quote(c,g.offer.material.financial.quoteId),original=await this.grant(c,first);
  stored(quote.state==='issued'&&!quote.paused&&quote.acceptance===null&&quote.revision===command.expectedQuoteRevision&&original.lifecycle.state==='active'&&!original.lifecycle.use);
  if(await this.operation(c,command.operationId))throw new AppError('CONFLICT');
  const existing=await c.tx.query('SELECT 1 FROM ls_fishing_billing.guest_financial_acceptances WHERE workspace_id=$1 AND quote_id=$2 UNION ALL SELECT 1 FROM ls_fishing_billing.obligations WHERE workspace_id=$1 AND quote_id=$2 UNION ALL SELECT 1 FROM ls_fishing_billing.receipts WHERE workspace_id=$1 AND quote_id=$2 LIMIT 1',[this.workspaceId,quote.id]);stored(existing.length===0);
  const f=await this.resolver.current(c,cap);stored(f.kind==='fresh'&&same(first,f)&&f.display&&f.statementSha256);
  const id=randomUUID(),acceptedAt=this.now(g),acceptance=verifyServiceFinancialAcceptanceV4({version:BILLING_SERVICE_V4,kind:'service_guest_grant',action,id,grantId:g.id,offer:g.offer,displayed:g.displayBundle,
   parent:{...command.parent,statementSha256:f.statementSha256,privateEvidenceId:id},assuranceEvidenceId:f.currentEvidence.assuranceEvidenceId,operationId:command.operationId,acceptedAt,
   recurring:command.recurring,recurringPrivateEvidenceId:command.recurring.kind==='one_time_only'?null:id},f.display.presentation,f.display.recurringPresentation);
  const accepted=acceptServiceFinancialOfferV4(quote,command.expectedQuoteRevision,acceptance,f.display.presentation,f.display.recurringPresentation),receipt=serviceAcceptanceReceiptV4Schema.parse({version:BILLING_SERVICE_V4,action,operationId:command.operationId,acceptanceId:id,quoteId:quote.id,acceptedRevision:accepted.revision,acceptedAt,replayed:false,paymentStateAtAcceptance:'unpaid'});
  const evidence=this.evidence({version:BILLING_SERVICE_V4,workspaceId:this.workspaceId,quoteId:quote.id,grantId:g.id,operationId:command.operationId,action,command,commandDigest:f.commandDigest,acceptance,currentEvidence:f.currentEvidence,display:f.display},g,command,f.commandDigest,receipt);
  const journal=serviceGuestOperationV4Schema.parse({version:BILLING_SERVICE_V4,workspaceId:this.workspaceId,quoteId:quote.id,grantId:g.id,operationId:command.operationId,action,commandDigest:f.commandDigest,receipt});
  // Journal first: the evidence composite FK binds actual purpose/version and
  // receipt ID. Then all siblings, quote and one-use grant commit together.
  await c.tx.query('INSERT INTO ls_fishing_billing.guest_operations(workspace_id,operation_id,grant_id,quote_id,action,request_digest,receipt_id,receipt_ciphertext,recorded_at,material_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
   [this.workspaceId,command.operationId,g.id,quote.id,action,f.commandDigest,id,seal(JSON.stringify(journal),serviceGuestAadV4('operation',this.workspaceId,command.operationId),this.ring),acceptedAt,BILLING_SERVICE_V4]);
  await c.tx.query('INSERT INTO ls_fishing_billing.guest_financial_acceptances(workspace_id,id,quote_id,grant_id,operation_id,action,issued_revision,evidence_ciphertext,accepted_at,material_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
   [this.workspaceId,id,quote.id,g.id,command.operationId,action,quote.revision,seal(JSON.stringify(evidence),serviceGuestAadV4('financial_acceptance',this.workspaceId,id),this.ring),acceptedAt,BILLING_SERVICE_V4]);
  for(const l of accepted.lines)await c.tx.query('INSERT INTO ls_fishing_billing.obligations(workspace_id,quote_id,line_id,family_id,child_id,period_id,starts_at,ends_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[this.workspaceId,quote.id,l.id,quote.familyId,l.childId,l.period.id,l.period.startsAt,l.period.endsAt]);
  const changed=await c.tx.query('UPDATE ls_fishing_billing.quotes SET revision=$3,payload_ciphertext=$4 WHERE workspace_id=$1 AND id=$2 AND revision=$5 AND payload_ciphertext=$6 AND family_id=$7 AND definition_id=$8 AND created_at=$9 AND material_version=$10 RETURNING id',
   [this.workspaceId,quote.id,accepted.revision,seal(JSON.stringify(accepted),serviceGuestAadV4('quote',this.workspaceId,quote.id),this.ring),before.revision,before.ciphertext,before.familyId,before.definitionId,before.createdAt,BILLING_SERVICE_V4]);stored(changed.length===1);
  const consumed=serviceGrantLifecycleV4Schema.parse({...original.lifecycle,state:'consumed',use:{operationId:command.operationId,commandDigest:f.commandDigest,receiptId:id,usedAt:acceptedAt}});
  const used=await c.tx.query('UPDATE ls_fishing_billing.guest_grants SET state=$6,payload_ciphertext=$7 WHERE workspace_id=$1 AND id=$2 AND quote_id=$3 AND action=$4 AND state=$5 AND payload_ciphertext=$8 AND expires_at>$9 AND token_digest=$10 AND issued_at=$11 AND expires_at=$12 AND material_version=$13 RETURNING id',
   [this.workspaceId,g.id,quote.id,action,'active','consumed',seal(JSON.stringify(consumed),serviceGuestAadV4('grant',this.workspaceId,g.id),this.ring),original.row.ciphertext,acceptedAt,g.tokenDigest,g.issuedAt,g.expiresAt,BILLING_SERVICE_V4]);stored(used.length===1);
  stored(same(await this.original(c,f,id),{...receipt,replayed:true}));
  await this.resolver.confirmConsumption(c,cap,{receiptId:id,acceptedAt});return receipt;
 }
 private async transaction(rawToken:string,command:ServiceAcceptCommandV4){
  let callbackFailure:unknown;
  try{return await this.db.transaction(async session=>{
   callbackFailure=undefined;let open=true;const physical=session.query,query=physical.bind(session),time=this.clock.now(),at=time instanceof Date?time.valueOf():NaN;
   const guard=()=>stored(open&&session.query===physical&&c&&c.workspaceId===this.workspaceId&&c.tx===tx&&c.now===time&&time.valueOf()===at&&Number.isFinite(at));
   const tx:SqlSession=Object.freeze({query:async<R extends object>(sql:string,v:readonly unknown[]=[])=>{guard();const rows=await query<R>(sql,v);guard();return rows;}});
   const c:BillingLedgerContext=Object.freeze({workspaceId:this.workspaceId,tx,now:time});
   try{guard();const result=await this.work(c,rawToken,command);guard();return result;}
   catch(error){callbackFailure=error;throw error;}finally{open=false;}
  });}catch(error){
   // Only the observed real callback rejection returned unchanged by the SQL
   // adapter proves THIS attempt rejected. Driver/postCOMMIT errors, including
   // same-coded AppErrors, stay uncertain. No previous UNKNOWN is cleared here.
   if(error===callbackFailure&&error instanceof AppError&&['UNAVAILABLE','CONFLICT','FORBIDDEN','NOT_FOUND','UNAUTHENTICATED','INVALID_REQUEST'].includes(error.code))throw new NativeAcceptanceRejection(error.code as RejectedCode);
   throw new AppError('UNAVAILABLE');
  }
 }
 async acceptFinancialOfferOutcome(rawToken:string,rawCommand:unknown):Promise<ServiceAcceptanceOutcomeV4>{
  const command=serviceAcceptCommandV4Schema.parse(rawCommand),correlation={version:BILLING_SERVICE_V4,action,workspaceId:this.workspaceId,command};
  try{return {...correlation,state:'committed' as const,receipt:await this.transaction(rawToken,command)};}
  catch(error){if(error instanceof NativeAcceptanceRejection)return {...correlation,state:'rejected_current_attempt' as const,code:error.code};throw error;}
 }
 async acceptFinancialOffer(rawToken:string,rawCommand:unknown):Promise<ServiceAcceptanceReceiptV4>{
  const result=await this.acceptFinancialOfferOutcome(rawToken,rawCommand);if(result.state==='committed')return result.receipt;throw new AppError(result.code);
 }
}
