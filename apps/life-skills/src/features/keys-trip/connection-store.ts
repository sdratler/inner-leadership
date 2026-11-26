import 'server-only';
import {createHmac,timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import {AppError} from '../../lib/errors.ts';
import type {WorkspaceId} from '../../lib/ids.ts';
import {privateDigest} from '../contact-ops/server/digests.ts';
import {lockWorkspace} from '../identity/data.ts';
import {seal,unseal,type Keyring} from '../identity/crypto.ts';
import {systemClock,type IdentityClock} from '../identity/types.ts';
import type {IdentityStore,SqlSession} from '../identity/store.ts';
import {decodeStoredGroupApplication,type StoredGroupApplicationRow} from '../group-application/group-application-record.ts';
import {appendFishingFollowupInTransaction,decodeFishingFollowupRecord,fishingFollowupRowSql} from '../group-application/fishing-followup-record.ts';
import {KEYS_TRIP,KEYS_CONSENT,isKeysInterest,keysCurrentContact,keysOwnerUpdateSchema,type KeysInterest} from './contract.ts';

export const KEYS_CONNECTION_PATH='/api/private/keys-chat';
const MAX_GRANT_MS=31*24*60*60*1000,REQUEST_TTL_MS=90_000;
const pin=z.string().min(1).max(200).regex(/^[A-Za-z0-9_.:@/-]+$/);
const uuid=z.string().uuid();
const cursor=z.string().min(40).max(2048).regex(/^[A-Za-z0-9_-]+$/);
const argsSchema=z.discriminatedUnion('operation',[
 z.object({operation:z.literal('get_trip'),arguments:z.object({}).strict()}).strict(),
 z.object({operation:z.literal('list_inquiries'),arguments:z.object({cursor:cursor.optional(),limit:z.number().int().min(1).max(25).default(20)}).strict()}).strict(),
 z.object({operation:z.literal('get_inquiry'),arguments:z.object({applicationId:uuid}).strict()}).strict(),
 z.object({operation:z.literal('pickup_summary'),arguments:z.object({cursor:cursor.optional()}).strict()}).strict(),
 z.object({operation:z.literal('update_inquiry'),arguments:keysOwnerUpdateSchema}).strict(),
]);
const envelopeSchema=z.object({version:z.literal(1),grantId:uuid,siteId:pin,userId:pin,email:z.email().max(254),issuedAt:z.number().int().nonnegative(),nonce:uuid,command:argsSchema}).strict();
type Envelope=z.infer<typeof envelopeSchema>;
export type KeysConnectionGrant=Readonly<{key:string;grantId:string;siteId:string;userId:string;email:string;notBefore:number;expiresAt:number}>;
/** This is a distinct, explicitly configured service grant. Never a browser Actor/session. */
export function parseKeysConnectionConfig(env:Record<string,string|undefined>):KeysConnectionGrant|null{
 if(env.LS_KEYS_CHAT_ENABLED!=='true')return null;
 try{
  const key=z.string().regex(/^[A-Za-z0-9_-]{43,86}$/).parse(env.LS_KEYS_CHAT_HMAC_KEY);
  const bytes=Buffer.from(key,'base64url');if(bytes.length<32||bytes.length>64||bytes.toString('base64url')!==key)throw new Error();
  const grantId=uuid.parse(env.LS_KEYS_CHAT_GRANT_ID),siteId=pin.parse(env.LS_KEYS_CHAT_SITE_ID),userId=pin.parse(env.LS_KEYS_CHAT_OWNER_USER_ID);
  const email=z.email().max(254).parse(env.LS_KEYS_CHAT_OWNER_EMAIL).toLowerCase();
  const notBefore=Date.parse(z.iso.datetime().parse(env.LS_KEYS_CHAT_NOT_BEFORE)),expiresAt=Date.parse(z.iso.datetime().parse(env.LS_KEYS_CHAT_EXPIRES_AT));
  if(expiresAt<=notBefore||expiresAt-notBefore>MAX_GRANT_MS)throw new Error();
  return Object.freeze({key,grantId,siteId,userId,email,notBefore,expiresAt});
 }catch{throw new AppError('UNAVAILABLE');}
}
export function keysConnectionSignature(key:string,body:string){return createHmac('sha256',Buffer.from(key,'base64url')).update('JLFA-KEYS-CHAT-v1\nPOST\n'+KEYS_CONNECTION_PATH+'\n'+body).digest('hex');}
type FollowupRow=Parameters<typeof decodeFishingFollowupRecord>[1];
const initial={version:0,status:'new' as const,note:'',nextAction:'Review inquiry',dueDate:null,waitingCondition:null};
type Application=ReturnType<typeof decodeStoredGroupApplication>&{fields:KeysInterest};

/** Reads and changes only this trip, in the existing encrypted inquiry/followup tables.
 * HMAC verification, consumed nonces and fresh real-owner authorization precede every
 * operation. The shared followup transaction writer preserves canonical hashes/AAD. */
export class KeysConnectionStore{
 constructor(private readonly db:IdentityStore,private readonly workspaceId:WorkspaceId,private readonly ring:Keyring,private readonly digestKey:string,private readonly ownerAccountId:string,private readonly grant:KeysConnectionGrant,private readonly clock:IdentityClock=systemClock){
  if(!uuid.safeParse(workspaceId).success||!uuid.safeParse(ownerAccountId).success)throw new AppError('UNAVAILABLE');
 }
 private get recordConfig(){return {workspaceId:this.workspaceId,ownerAccountId:this.ownerAccountId,ring:this.ring,digestKey:this.digestKey};}
 private validGrant(envelope:Envelope){
  const now=this.clock.now().getTime();
  if(now<this.grant.notBefore||now>=this.grant.expiresAt||Math.abs(now-envelope.issuedAt)>REQUEST_TTL_MS||envelope.grantId!==this.grant.grantId||envelope.siteId!==this.grant.siteId||envelope.userId!==this.grant.userId||envelope.email.toLowerCase()!==this.grant.email)throw new AppError('UNAUTHENTICATED');
 }
 private async owner(tx:SqlSession,envelope:Envelope){
  this.validGrant(envelope);
  const rows=await tx.query<{id:string}>(`SELECT id FROM ls_identity.accounts WHERE workspace_id=$1 AND id=$2 AND role='practitioner' AND state='active' AND email_verified_at IS NOT NULL AND clock_timestamp()>=$3::timestamptz AND clock_timestamp()<$4::timestamptz FOR SHARE`,[this.workspaceId,this.ownerAccountId,new Date(this.grant.notBefore),new Date(this.grant.expiresAt)]);
  if(rows.length!==1)throw new AppError('UNAUTHENTICATED');
 }
 private async consumeNonce(tx:SqlSession,envelope:Envelope){
  const key=privateDigest({domain:'keys-chat-nonce/v1',workspace:this.workspaceId,grant:this.grant.grantId,nonce:envelope.nonce},this.digestKey);
  const added=await tx.query<{key_digest:string}>(`INSERT INTO ls_identity.rate_counters(key_digest,window_start,window_ms,count,expires_at) VALUES($1,statement_timestamp(),180000,1,statement_timestamp()+interval '3 minutes') ON CONFLICT(key_digest) DO NOTHING RETURNING key_digest`,[key]);
  if(added.length!==1)throw new AppError('CONFLICT');
  const rateKey=privateDigest({domain:'keys-chat-rate/v1',workspace:this.workspaceId,grant:this.grant.grantId},this.digestKey);
  const rate=await tx.query<{count:number}>(`INSERT INTO ls_identity.rate_counters(key_digest,window_start,window_ms,count,expires_at) VALUES($1,statement_timestamp(),60000,1,statement_timestamp()+interval '1 minute') ON CONFLICT(key_digest) DO UPDATE SET count=CASE WHEN ls_identity.rate_counters.expires_at<=statement_timestamp() THEN 1 ELSE LEAST(ls_identity.rate_counters.count+1,1000000) END,window_start=CASE WHEN ls_identity.rate_counters.expires_at<=statement_timestamp() THEN statement_timestamp() ELSE ls_identity.rate_counters.window_start END,expires_at=CASE WHEN ls_identity.rate_counters.expires_at<=statement_timestamp() THEN statement_timestamp()+interval '1 minute' ELSE ls_identity.rate_counters.expires_at END RETURNING count`,[rateKey]);
  if(rate.length!==1||rate[0]!.count>30)throw new AppError('RATE_LIMITED');
 }
 private decode(row:StoredGroupApplicationRow):Application{
  const app=decodeStoredGroupApplication(this.workspaceId,row,this.ring,this.digestKey);
  if(!isKeysInterest(app.fields)||app.fields.tripId!==KEYS_TRIP.id)throw new AppError('NOT_FOUND');
  return {...app,fields:app.fields};
 }
 private async application(tx:SqlSession,id:string){
  const rows=await tx.query<StoredGroupApplicationRow>(`SELECT id,request_digest AS "requestDigest",payload_ciphertext AS "payloadCiphertext",received_at AS "receivedAt" FROM ls_service_interest.public_applications WHERE workspace_id=$1 AND id=$2 AND notice_version=$3`,[this.workspaceId,id,KEYS_CONSENT.version]);
  if(rows.length!==1)throw new AppError('NOT_FOUND');return this.decode(rows[0]!);
 }
 private cursorAad(){return `keys-chat/cursor/v1/${this.workspaceId}/${this.ownerAccountId}/${this.grant.grantId}/${KEYS_TRIP.id}`;}
 private readCursor(value?:string){
  if(value===undefined)return null;
  try{const bytes=Buffer.from(value,'base64url');if(bytes.toString('base64url')!==value)throw new Error();return uuid.parse(JSON.parse(unseal(bytes.toString('utf8'),this.cursorAad(),this.ring)).id);}catch{throw new AppError('INVALID_REQUEST');}
 }
 private nextCursor(id:string){return Buffer.from(seal(JSON.stringify({id}),this.cursorAad(),this.ring)).toString('base64url');}
 private async page(tx:SqlSession,limit:number,after?:string){
  const rows=await tx.query<StoredGroupApplicationRow>(`SELECT id,request_digest AS "requestDigest",payload_ciphertext AS "payloadCiphertext",received_at AS "receivedAt" FROM ls_service_interest.public_applications WHERE workspace_id=$1 AND notice_version=$2 AND ($3::uuid IS NULL OR id>$3::uuid) ORDER BY id LIMIT $4`,[this.workspaceId,KEYS_CONSENT.version,this.readCursor(after),limit+1]);
  const apps=rows.slice(0,limit).map(row=>this.decode(row));
  const nextCursor=rows.length>limit&&apps.length?this.nextCursor(apps[apps.length-1]!.id):null;
  const ids=apps.map(app=>app.id);
  const latest=ids.length?await tx.query<FollowupRow>(`SELECT DISTINCT ON(application_id) operation_id AS "operationId",application_id AS "applicationId",actor_account_id AS "actorAccountId",version,request_digest AS "requestDigest",payload_ciphertext AS "payloadCiphertext",recorded_at AS "recordedAt" FROM ls_service_interest.fishing_inquiry_followups WHERE workspace_id=$1 AND application_id=ANY($2::uuid[]) ORDER BY application_id,version DESC`,[this.workspaceId,ids]):[];
  const byId=new Map(latest.map(row=>[row.applicationId,decodeFishingFollowupRecord(this.recordConfig,row)]));
  return {items:apps.map(application=>{const followup=byId.get(application.id)??initial;return {application,followup,currentContact:keysCurrentContact(application.fields,'keysContactCorrection' in followup?followup.keysContactCorrection:undefined)};}),nextCursor};
 }
 async executeSigned(rawBody:string,signature:string){
  if(!/^[a-f0-9]{64}$/.test(signature)||!timingSafeEqual(Buffer.from(signature,'hex'),Buffer.from(keysConnectionSignature(this.grant.key,rawBody),'hex')))throw new AppError('UNAUTHENTICATED');
  let envelope:Envelope;try{envelope=envelopeSchema.parse(JSON.parse(rawBody));}catch{throw new AppError('INVALID_REQUEST');}
  this.validGrant(envelope);
  return this.db.transaction(async tx=>{
   await lockWorkspace(tx,this.workspaceId);await this.owner(tx,envelope);await this.consumeNonce(tx,envelope);
   const command=envelope.command;
   if(command.operation==='get_trip')return {trip:KEYS_TRIP,consent:KEYS_CONSENT,scope:'Nonbinding interest only. No price or confirmed pickup is advertised.'};
   if(command.operation==='list_inquiries')return this.page(tx,command.arguments.limit,command.arguments.cursor);
   if(command.operation==='get_inquiry'){
    const application=await this.application(tx,command.arguments.applicationId);
    const rows=await tx.query<FollowupRow>(fishingFollowupRowSql+' WHERE workspace_id=$1 AND application_id=$2 ORDER BY version DESC LIMIT 21',[this.workspaceId,application.id]);
    const history=rows.slice(0,20).map(row=>decodeFishingFollowupRecord(this.recordConfig,row)),followup=history[0]??initial;
    return {application,followup,currentContact:keysCurrentContact(application.fields,'keysContactCorrection' in followup?followup.keysContactCorrection:undefined),history,hasMoreHistory:rows.length>20};
   }
   if(command.operation==='pickup_summary'){
    const page=await this.page(tx,500,command.arguments.cursor),areas:Record<string,{requests:number;boys:number}>={};let boys=0;
    for(const item of page.items){const n=item.application.fields.children.length;boys+=n;for(const area of item.currentContact.pickupPreferences.length?item.currentContact.pickupPreferences:['discuss']){areas[area]??={requests:0,boys:0};areas[area]!.requests++;areas[area]!.boys+=n;}}
    return {tripId:KEYS_TRIP.id,requests:page.items.length,boyInterests:boys,pickupAreas:areas,complete:page.nextCursor===null,nextCursor:page.nextCursor,meaning:'Interest requests only; pickup preferences overlap and are not booked seats. A partial page must not be presented as the complete total.'};
   }
   const input=command.arguments;
   return {saved:true,followup:await appendFishingFollowupInTransaction(tx,this.recordConfig,{operationId:input.operationId,applicationId:input.applicationId,expectedVersion:input.expectedVersion,status:input.status,note:input.note,nextAction:input.nextAction,dueDate:input.dueDate,waitingCondition:input.waitingCondition,...(input.contactCorrection?{keysContactCorrection:input.contactCorrection}:{})},this.clock.now(),async(inner,id)=>{await this.owner(inner,envelope);return this.application(inner,id);})};
  });
 }
}
