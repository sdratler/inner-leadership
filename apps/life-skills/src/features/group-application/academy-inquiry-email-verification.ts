import 'server-only';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {AppError} from '../../lib/errors.ts';
import type {WorkspaceId} from '../../lib/ids.ts';
import {opaqueToken,tokenDigest,canonicalEmail,blindEmail,seal,unseal,type Keyring} from '../identity/crypto.ts';
import {lockWorkspace} from '../identity/data.ts';
import type {IdentityStore,SqlSession} from '../identity/store.ts';
import {systemClock,type IdentityClock} from '../identity/types.ts';
import {decodeStoredGroupApplication,type StoredGroupApplicationRow} from './group-application-record.ts';
import {isTrip390Interest} from './contract.ts';
import {isCurrentTrip390Interest} from './academy-trip390-contract.ts';

export const INQUIRY_EMAIL_CONTROL_PURPOSE='fishing_inquiry_email_control_v1' as const;
export const INQUIRY_EMAIL_CONTROL_VERSION='JLFA-INQUIRY-EMAIL-CONTROL-v1' as const;
const uuid=z.string().uuid(),post=z.object({method:z.literal('POST'),token:z.string().regex(/^[A-Za-z0-9_-]{43}$/)}).strict();
// A required security setting, no selected duration/default or payment clock.
// The upper bound reuses the existing identity email-change token's24h cap.
const lifetime=z.number().int().min(1000).max(24*60*60*1000);

export type InquiryEmailControlConfig={workspaceId:WorkspaceId;keyring:Keyring;requestDigestKey:string;lookupKey:Buffer;securityLifetimeMs:number};
/** Secret, server-only handoff to Root's future ENCRYPTED transactional outbox.
 * Never return/log this action in HTTP, previews or public saved responses.
 * This component neither composes a URL nor selects/constructs a transport. */
export type InquiryEmailControlDelivery=Readonly<{
 purpose:typeof INQUIRY_EMAIL_CONTROL_PURPOSE;version:typeof INQUIRY_EMAIL_CONTROL_VERSION;
 verificationId:string;deliveryIntentId:string;workspaceId:WorkspaceId;applicationId:string;
 recipient:string;messageLanguage:'en'|'he';token:string;expiresAt:string;
 sourceDigest:string;requestVersion:string;offerVersion:string;
}>;
export type EnqueueInquiryEmailControl=(tx:SqlSession,action:InquiryEmailControlDelivery)=>Promise<void>;
export type IssueInquiryEmailControl=Readonly<{state:'queued'|'already_issued'|'already_confirmed';verificationId:string;deliveryIntentId:string;expiresAt:string}|{state:'closed'}>;
export type InquiryEmailControlEvidence=Readonly<{
 kind:'inquiry_mailbox_control_only';purpose:typeof INQUIRY_EMAIL_CONTROL_PURPOSE;version:typeof INQUIRY_EMAIL_CONTROL_VERSION;
 verificationId:string;workspaceId:WorkspaceId;applicationId:string;emailBlind:string;sourceDigest:string;
 requestVersion:string;offerVersion:string;messageLanguage:'en'|'he';verifiedAt:string;
}>;
type Binding={reference:string;email:string;emailBlind:string;sourceDigest:string;requestVersion:string;offerVersion:string;locale:'en'|'he'};
const hex=z.string().regex(/^[a-f0-9]{64}$/),instant=z.string().datetime().refine(value=>new Date(value).toISOString()===value);
const issuance=z.object({workspaceId:uuid,id:uuid,applicationId:uuid,purpose:z.literal(INQUIRY_EMAIL_CONTROL_PURPOSE),version:z.literal(INQUIRY_EMAIL_CONTROL_VERSION),sourceKind:z.literal('public_group_application'),sourceDigest:hex,requestVersion:z.string().min(1).max(100),offerVersion:z.string().min(1).max(100),emailBlind:hex,locale:z.enum(['en','he']),tokenDigest:hex,deliveryIntentId:uuid,issuedAt:instant,expiresAt:instant}).strict();
type Issuance=z.infer<typeof issuance>;
const delivery=z.object({purpose:z.literal(INQUIRY_EMAIL_CONTROL_PURPOSE),version:z.literal(INQUIRY_EMAIL_CONTROL_VERSION),verificationId:uuid,deliveryIntentId:uuid,workspaceId:uuid,applicationId:uuid,recipient:z.string().min(1).max(320),messageLanguage:z.enum(['en','he']),token:z.string().regex(/^[A-Za-z0-9_-]{43}$/),expiresAt:instant,sourceDigest:hex,requestVersion:z.string().min(1).max(100),offerVersion:z.string().min(1).max(100)}).strict();
const lifecycle=z.object({issuance, state:z.enum(['issued','consumed','revoked']),consumedAt:instant.nullable(),revokedAt:instant.nullable()}).strict().refine(value=>value.state==='issued'?!value.consumedAt&&!value.revokedAt:value.state==='consumed'?!!value.consumedAt&&!value.revokedAt:!!value.revokedAt);
type Lifecycle=z.infer<typeof lifecycle>;
type Row=Omit<Issuance,'issuedAt'|'expiresAt'> & {issuedAt:Date;expiresAt:Date;consumedAt:Date|null;revokedAt:Date|null;issuanceCiphertext:string;lifecycleCiphertext:string};
const selection=`SELECT workspace_id AS "workspaceId",id,delivery_intent_id AS "deliveryIntentId",application_id AS "applicationId",purpose,version,source_kind AS "sourceKind",source_request_digest AS "sourceDigest",request_version AS "requestVersion",offer_version AS "offerVersion",email_blind AS "emailBlind",message_language AS locale,token_digest AS "tokenDigest",issued_at AS "issuedAt",expires_at AS "expiresAt",consumed_at AS "consumedAt",revoked_at AS "revokedAt",issuance_ciphertext AS "issuanceCiphertext",lifecycle_ciphertext AS "lifecycleCiphertext" FROM ls_service_interest.inquiry_email_control_verifications`;

/** GET/link scanners receive only static instructions. No token lookup, PII,
 * state mutation, account/session, guardian assurance or send permission. */
export function inquiryEmailControlPreview(){return {state:'explicit_confirmation_required',proves:'nothing_before_confirmation'} as const;}

/** New local-only proposal. Root owns route authorization/origin/rate guards,
 * future payload/version, delivery admission and migration numbering/activation.
 * Existing inquiry bytes and historical ACK/SENT/UNKNOWN payloads are untouched.
 * A token is consumed once; its dated evidence says ONLY that its bound mailbox
 * was controlled. It is not guardian, family, account, enrollment or payment proof.
 */
export class InquiryEmailControlVerification{
 constructor(private readonly db:IdentityStore,private readonly config:InquiryEmailControlConfig,private readonly clock:IdentityClock=systemClock){
  uuid.parse(config.workspaceId);lifetime.parse(config.securityLifetimeMs);
  if(config.lookupKey.length!==32||config.requestDigestKey.length<32)throw new AppError('UNAVAILABLE');
 }
 private async now(tx:SqlSession){
  const at=this.clock.now();if(!Number.isFinite(at.getTime()))throw new AppError('UNAVAILABLE');
  const rows=await tx.query<{at:Date}>('SELECT GREATEST($1::timestamptz,clock_timestamp()) AS at',[at]);
  if(rows.length!==1)throw new AppError('UNAVAILABLE');return rows[0]!.at;
 }
 private async binding(tx:SqlSession,reference:string):Promise<Binding>{
  const rows=await tx.query<StoredGroupApplicationRow>(`SELECT id,request_digest AS "requestDigest",payload_ciphertext AS "payloadCiphertext",received_at AS "receivedAt" FROM ls_service_interest.public_applications WHERE workspace_id=$1 AND id=$2`,[this.config.workspaceId,reference]);
  if(rows.length!==1)throw new AppError('NOT_FOUND');
  // This decoder is the canonical AEAD+keyed-request-integrity path. Do not
  // reproduce its digest/AAD recipe, infer a Person or trust browser fields.
  const row=rows[0]!,item=decodeStoredGroupApplication(this.config.workspaceId,row,this.config.keyring,this.config.requestDigestKey);
  if(item.source!=='public_group_application'||!isTrip390Interest(item.fields)||!isCurrentTrip390Interest(item.fields))throw new AppError('NOT_FOUND');
  const email=canonicalEmail(item.fields.email);
  return {reference:item.id,email,emailBlind:blindEmail(email,this.config.lookupKey),sourceDigest:row.requestDigest,requestVersion:item.fields.version,offerVersion:item.fields.offerVersion,locale:item.fields.messageLanguage};
 }
 private matches(row:Row,binding:Binding){
  return row.purpose===INQUIRY_EMAIL_CONTROL_PURPOSE&&row.version===INQUIRY_EMAIL_CONTROL_VERSION&&row.sourceKind==='public_group_application'&&row.applicationId===binding.reference&&row.sourceDigest===binding.sourceDigest&&row.emailBlind===binding.emailBlind&&row.requestVersion===binding.requestVersion&&row.offerVersion===binding.offerVersion&&row.locale===binding.locale;
 }
 private aad(kind:'issuance'|'lifecycle',id:string){return `ls_service_interest/inquiry_email_control/${kind}/v1/${this.config.workspaceId}/${id}`;}
 private encodeLifecycle(value:Lifecycle){return seal(JSON.stringify(lifecycle.parse(value)),this.aad('lifecycle',value.issuance.id),this.config.keyring);}
 /** The SQL columns are indexes, never proof. Join both AEAD records, every
  * original binding and exact SQL instants before trusting any lifecycle flag.
  * This rejects field edits, not a privileged rollback of complete old sealed
  * database snapshots. General compromised-database rollback immunity is absent. */
 private async authenticated(tx:SqlSession,row:Row,at:Date):Promise<Lifecycle|null>{
  let original:Issuance,state:Lifecycle;
  try{
   original=issuance.parse(JSON.parse(unseal(row.issuanceCiphertext,this.aad('issuance',row.id),this.config.keyring)));
   state=lifecycle.parse(JSON.parse(unseal(row.lifecycleCiphertext,this.aad('lifecycle',row.id),this.config.keyring)));
  }catch{return null;}
  if(original.workspaceId!==this.config.workspaceId||JSON.stringify(state.issuance)!==JSON.stringify(original))return null;
  const indexed={workspaceId:row.workspaceId,id:row.id,applicationId:row.applicationId,purpose:row.purpose,version:row.version,sourceKind:row.sourceKind,sourceDigest:row.sourceDigest,requestVersion:row.requestVersion,offerVersion:row.offerVersion,emailBlind:row.emailBlind,locale:row.locale,tokenDigest:row.tokenDigest,deliveryIntentId:row.deliveryIntentId,issuedAt:row.issuedAt.toISOString(),expiresAt:row.expiresAt.toISOString()};
  if(JSON.stringify(indexed)!==JSON.stringify(original))return null;
  const issued=Date.parse(original.issuedAt),expiry=Date.parse(original.expiresAt),consumed=state.consumedAt===null?null:Date.parse(state.consumedAt),revoked=state.revokedAt===null?null:Date.parse(state.revokedAt);
  if(issued>at.getTime()||expiry<=issued||expiry-issued>24*60*60*1000||consumed!==null&&(consumed<issued||consumed>=expiry||consumed>at.getTime())||revoked!==null&&(revoked<issued||revoked>at.getTime()||consumed!==null&&consumed>revoked))return null;
  // PostgreSQL has microseconds, JS Date has milliseconds. Exact SQL equality
  // prevents sub-millisecond index/time tampering from being rounded away.
  const exact=await tx.query<{valid:boolean}>(`SELECT issued_at=$3::timestamptz AND expires_at=$4::timestamptz AND consumed_at IS NOT DISTINCT FROM $5::timestamptz AND revoked_at IS NOT DISTINCT FROM $6::timestamptz AND issuance_ciphertext=$7 AND lifecycle_ciphertext=$8 AS valid FROM ls_service_interest.inquiry_email_control_verifications WHERE workspace_id=$1 AND id=$2`,[this.config.workspaceId,row.id,original.issuedAt,original.expiresAt,state.consumedAt,state.revokedAt,row.issuanceCiphertext,row.lifecycleCiphertext]);
  return exact.length===1&&exact[0]!.valid?state:null;
 }
 private result(original:Issuance,state:'queued'|'already_issued'|'already_confirmed'):IssueInquiryEmailControl{return {state,verificationId:original.id,deliveryIntentId:original.deliveryIntentId,expiresAt:original.expiresAt};}
 private async revokeRow(tx:SqlSession,row:Row,state:Lifecycle,at:Date){
  if(state.state==='revoked')return;
  const next:Lifecycle={...state,state:'revoked',revokedAt:at.toISOString()};
  await tx.query(`UPDATE ls_service_interest.inquiry_email_control_verifications SET revoked_at=$3,lifecycle_ciphertext=$4 WHERE workspace_id=$1 AND id=$2 AND issuance_ciphertext=$5 AND lifecycle_ciphertext=$6`,[this.config.workspaceId,row.id,at,this.encodeLifecycle(next),row.issuanceCiphertext,row.lifecycleCiphertext]);
 }

 /** Secret server-only queue/pre-send port. Uses the caller's existing SQL
  * transaction and workspace lock, never another transaction or transport.
  * True means this exact issued action is current, not permission to send. */
 async isDeliveryCurrent(tx:SqlSession,action:InquiryEmailControlDelivery):Promise<boolean>{
  const parsed=delivery.safeParse(action);if(!parsed.success)return false;const item=parsed.data;
  if(item.workspaceId!==this.config.workspaceId||canonicalEmail(item.recipient)!==item.recipient)return false;
  await lockWorkspace(tx,this.config.workspaceId);
  const at=await this.now(tx),rows=await tx.query<Row>(selection+' WHERE workspace_id=$1 AND id=$2 AND purpose=$3',[this.config.workspaceId,item.verificationId,INQUIRY_EMAIL_CONTROL_PURPOSE]);
  if(rows.length!==1)return false;const row=rows[0]!,state=await this.authenticated(tx,row,at);
  if(!state||state.state!=='issued'||row.expiresAt<=at)return false;
  let binding:Binding;try{binding=await this.binding(tx,row.applicationId);}catch(error){if(error instanceof AppError&&(error.code==='NOT_FOUND'||error.code==='UNAVAILABLE'))return false;throw error;}
  const original=state.issuance;
  if(!(this.matches(row,binding)&&item.applicationId===original.applicationId&&item.deliveryIntentId===original.deliveryIntentId&&item.expiresAt===original.expiresAt&&tokenDigest(item.token)===original.tokenDigest&&item.recipient===binding.email&&blindEmail(item.recipient,this.config.lookupKey)===original.emailBlind&&item.messageLanguage===original.locale&&item.sourceDigest===original.sourceDigest&&item.requestVersion===original.requestVersion&&item.offerVersion===original.offerVersion))return false;
  // This must remain the final awaited operation: source/authentication IO may
  // have crossed expiry. A later provider boundary must perform its own check.
  const finalAt=await this.now(tx);return row.expiresAt>finalAt;
 }

 /** Issue only for an already durable inquiry. Verification+enqueue are one
  * new SQL transaction; a queue failure rolls them back, never the saved lead.
  * Retries return the existing intent, never mint/queue another token. Expired
  * or revoked attempts stay closed; no automatic resend/cadence is invented. */
 async issue(reference:string,enqueue:EnqueueInquiryEmailControl):Promise<IssueInquiryEmailControl>{
  uuid.parse(reference);
  return this.db.transaction(async tx=>{
   await lockWorkspace(tx,this.config.workspaceId);
   const at=await this.now(tx),binding=await this.binding(tx,reference);
   const prior=await tx.query<Row>(selection+' WHERE workspace_id=$1 AND application_id=$2 AND purpose=$3 FOR UPDATE',[this.config.workspaceId,reference,INQUIRY_EMAIL_CONTROL_PURPOSE]);
   if(prior.length>1)throw new AppError('UNAVAILABLE');
   if(prior.length){
    const row=prior[0]!,state=await this.authenticated(tx,row,at);
    if(!state)return {state:'closed'};
    if(!this.matches(row,binding)){await this.revokeRow(tx,row,state,at);return {state:'closed'};}
    if(state.state==='revoked'||state.state==='issued'&&row.expiresAt<=at)return {state:'closed'};
    return this.result(state.issuance,state.state==='consumed'?'already_confirmed':'already_issued');
   }
   const id=randomUUID(),intentId=randomUUID(),token=opaqueToken(),expiresAt=new Date(at.getTime()+this.config.securityLifetimeMs);
   const original:Issuance={workspaceId:this.config.workspaceId,id,applicationId:reference,purpose:INQUIRY_EMAIL_CONTROL_PURPOSE,version:INQUIRY_EMAIL_CONTROL_VERSION,sourceKind:'public_group_application',sourceDigest:binding.sourceDigest,requestVersion:binding.requestVersion,offerVersion:binding.offerVersion,emailBlind:binding.emailBlind,locale:binding.locale,tokenDigest:tokenDigest(token),deliveryIntentId:intentId,issuedAt:at.toISOString(),expiresAt:expiresAt.toISOString()};
   const issuanceCiphertext=seal(JSON.stringify(issuance.parse(original)),this.aad('issuance',id),this.config.keyring),lifecycleCiphertext=this.encodeLifecycle({issuance:original,state:'issued',consumedAt:null,revokedAt:null});
   await tx.query(`INSERT INTO ls_service_interest.inquiry_email_control_verifications(workspace_id,id,application_id,purpose,version,source_kind,source_request_digest,request_version,offer_version,email_blind,message_language,token_digest,delivery_intent_id,issued_at,expires_at,issuance_ciphertext,lifecycle_ciphertext) VALUES($1,$2,$3,$4,$5,'public_group_application',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,[this.config.workspaceId,id,reference,INQUIRY_EMAIL_CONTROL_PURPOSE,INQUIRY_EMAIL_CONTROL_VERSION,binding.sourceDigest,binding.requestVersion,binding.offerVersion,binding.emailBlind,binding.locale,original.tokenDigest,intentId,at,expiresAt,issuanceCiphertext,lifecycleCiphertext]);
   await enqueue(tx,{purpose:INQUIRY_EMAIL_CONTROL_PURPOSE,version:INQUIRY_EMAIL_CONTROL_VERSION,verificationId:id,deliveryIntentId:intentId,workspaceId:this.config.workspaceId,applicationId:reference,recipient:binding.email,messageLanguage:binding.locale,token,expiresAt:expiresAt.toISOString(),sourceDigest:binding.sourceDigest,requestVersion:binding.requestVersion,offerVersion:binding.offerVersion});
   return {state:'queued',verificationId:id,deliveryIntentId:intentId,expiresAt:expiresAt.toISOString()};
  });
 }

 /** Root must call only after its POST/origin/rate/body defenses. A GET value
  * is rejected before opening a transaction. Raw token never enters SQL/logs. */
 async confirmPost(input:unknown):Promise<{state:'confirmed'|'already_used'|'not_available'}>{
  const parsed=post.safeParse(input);if(!parsed.success)throw new AppError('INVALID_REQUEST');
  const digest=tokenDigest(parsed.data.token);
  return this.db.transaction(async tx=>{
   await lockWorkspace(tx,this.config.workspaceId);
   const at=await this.now(tx),rows=await tx.query<Row>(selection+' WHERE workspace_id=$1 AND token_digest=$2 AND purpose=$3 FOR UPDATE',[this.config.workspaceId,digest,INQUIRY_EMAIL_CONTROL_PURPOSE]);
   if(!rows.length)return {state:'not_available' as const};if(rows.length!==1)throw new AppError('UNAVAILABLE');
   const row=rows[0]!,state=await this.authenticated(tx,row,at);
   if(!state||state.state==='revoked')return {state:'not_available' as const};
   const binding=await this.binding(tx,row.applicationId);
   if(!this.matches(row,binding)){await this.revokeRow(tx,row,state,at);return {state:'not_available' as const};}
   if(row.expiresAt<=at)return {state:'not_available' as const};
   if(state.state==='consumed')return {state:'already_used' as const};
   const next:Lifecycle={...state,state:'consumed',consumedAt:at.toISOString()};
   const changed=await tx.query<{id:string}>(`UPDATE ls_service_interest.inquiry_email_control_verifications SET consumed_at=$4,lifecycle_ciphertext=$9 WHERE workspace_id=$1 AND id=$2 AND token_digest=$3 AND purpose=$5 AND version=$6 AND email_blind=$7 AND source_request_digest=$8 AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>GREATEST($4::timestamptz,clock_timestamp()) AND issuance_ciphertext=$10 AND lifecycle_ciphertext=$11 RETURNING id`,[this.config.workspaceId,row.id,digest,at,INQUIRY_EMAIL_CONTROL_PURPOSE,INQUIRY_EMAIL_CONTROL_VERSION,binding.emailBlind,binding.sourceDigest,this.encodeLifecycle(next),row.issuanceCiphertext,row.lifecycleCiphertext]);
   if(changed.length>1)throw new AppError('UNAVAILABLE');
   return {state:changed.length===1?'confirmed' as const:'not_available' as const};
  });
 }

 /** Private server readback, not a public GET/token-preview endpoint. Proof
  * stays dated after token expiry, but source/email drift or revocation blocks
  * it. Root decides later offer eligibility; this method grants no send/pay. */
 async readEvidence(reference:string,authorize?:(tx:SqlSession)=>Promise<void>):Promise<InquiryEmailControlEvidence|null>{
  uuid.parse(reference);
  return this.db.transaction(async tx=>{
   await tx.query('SET TRANSACTION READ ONLY');
   if(authorize)await authorize(tx);
   try{
   const at=await this.now(tx),binding=await this.binding(tx,reference),rows=await tx.query<Row>(selection+' WHERE workspace_id=$1 AND application_id=$2 AND purpose=$3',[this.config.workspaceId,reference,INQUIRY_EMAIL_CONTROL_PURPOSE]);
   if(rows.length>1)throw new AppError('UNAVAILABLE');const row=rows[0];
   if(!row||!this.matches(row,binding))return null;
   const state=await this.authenticated(tx,row,at);if(!state||state.state!=='consumed'||!state.consumedAt)return null;
   return {kind:'inquiry_mailbox_control_only',purpose:INQUIRY_EMAIL_CONTROL_PURPOSE,version:INQUIRY_EMAIL_CONTROL_VERSION,verificationId:row.id,workspaceId:this.config.workspaceId,applicationId:reference,emailBlind:row.emailBlind,sourceDigest:row.sourceDigest,requestVersion:row.requestVersion,offerVersion:row.offerVersion,messageLanguage:row.locale,verifiedAt:state.consumedAt};
   }finally{if(authorize)await authorize(tx);}
  });
 }

 /** Root-owned trusted revocation seam, never mount directly as public input. */
 async revoke(reference:string):Promise<void>{
  uuid.parse(reference);
  await this.db.transaction(async tx=>{
   await lockWorkspace(tx,this.config.workspaceId);const at=await this.now(tx),rows=await tx.query<Row>(selection+' WHERE workspace_id=$1 AND application_id=$2 AND purpose=$3 FOR UPDATE',[this.config.workspaceId,reference,INQUIRY_EMAIL_CONTROL_PURPOSE]);
   if(rows.length>1)throw new AppError('UNAVAILABLE');const row=rows[0];if(!row)return;
   const state=await this.authenticated(tx,row,at);if(!state)throw new AppError('UNAVAILABLE');
   await this.revokeRow(tx,row,state,at);
  });
 }
}
