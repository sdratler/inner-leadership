import 'server-only';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {AppError} from '../../lib/errors.ts';
import type {WorkspaceId} from '../../lib/ids.ts';
import {privateDigest} from '../contact-ops/server/digests.ts';
import {freshActor,lockWorkspace} from '../identity/data.ts';
import {seal,type Keyring} from '../identity/crypto.ts';
import {systemClock,type Actor,type IdentityClock} from '../identity/types.ts';
import type {IdentityStore,SqlSession} from '../identity/store.ts';
import {decodeStoredGroupApplication,groupApplicationRequestDigest,groupApplicationPayloadAad,type StoredGroupApplicationRow} from '../group-application/group-application-record.ts';
import {FishingInquiryFollowupStore} from '../group-application/fishing-followup-store.ts';
import {keysCommandSchema,keysOwnerUpdateSchema,keysCurrentContact,isKeysInterest,KEYS_CONSENT,KEYS_TRIP,type KeysCommand,type KeysOwnerUpdate,type KeysInterest} from './contract.ts';
import {keysHasPassed} from './config.ts';

/** Reuses the immutable encrypted Fishing inquiry and followup stores.
 * No mail intent, CRM promotion, enrollment, reservation or payment is created. */
export class KeysInterestStore{
 private readonly followups:FishingInquiryFollowupStore;
 constructor(private readonly db:IdentityStore,private readonly workspaceId:WorkspaceId,private readonly ring:Keyring,private readonly digestKey:string,private readonly ownerAccountId:string,private readonly clock:IdentityClock=systemClock){
  if(!z.string().uuid().safeParse(ownerAccountId).success)throw new AppError('UNAVAILABLE');
  this.followups=new FishingInquiryFollowupStore(db,workspaceId,ring,digestKey,ownerAccountId,clock);
 }
 private async owner(tx:SqlSession,actor:Actor){
  if(actor.workspaceId!==this.workspaceId||actor.id!==this.ownerAccountId)throw new AppError('NOT_FOUND');
  const current=await freshActor(tx,actor,this.clock.now());
  if(current.id!==this.ownerAccountId||current.role!=='practitioner'||current.state!=='active')throw new AppError('NOT_FOUND');
 }
 private async saved(tx:SqlSession,id:string){
  const rows=await tx.query<StoredGroupApplicationRow>('SELECT id,request_digest AS "requestDigest",payload_ciphertext AS "payloadCiphertext",received_at AS "receivedAt" FROM ls_service_interest.public_applications WHERE workspace_id=$1 AND id=$2',[this.workspaceId,id]);
  if(rows.length!==1)throw new AppError('UNAVAILABLE');
  const item=decodeStoredGroupApplication(this.workspaceId,rows[0]!,this.ring,this.digestKey);
  if(!isKeysInterest(item.fields)||item.fields.tripId!==KEYS_TRIP.id)throw new AppError('UNAVAILABLE');
  return {...item,fields:item.fields};
 }
 async submit(input:KeysCommand){
  const parsed=keysCommandSchema.safeParse(input);if(!parsed.success)throw new AppError('INVALID_REQUEST');
  const command=parsed.data,requestDigest=groupApplicationRequestDigest(this.workspaceId,command.fields,this.digestKey);
  const contactDigest=privateDigest({domain:'public-group-application-contact/v1',workspace:this.workspaceId,contact:command.fields.email},this.digestKey);
  return this.db.transaction(async tx=>{
   await lockWorkspace(tx,this.workspaceId);
   const prior=await tx.query<{applicationId:string;requestDigest:string}>('SELECT application_id AS "applicationId",request_digest AS "requestDigest" FROM ls_service_interest.public_application_operations WHERE workspace_id=$1 AND operation_id=$2',[this.workspaceId,command.operationId]);
   if(prior.length){if(prior.length!==1||prior[0]!.requestDigest!==requestDigest)throw new AppError('CONFLICT');return {saved:true as const,replayed:true,duplicate:true,item:await this.saved(tx,prior[0]!.applicationId)};}
   const existing=await tx.query<{id:string}>('SELECT id FROM ls_service_interest.public_applications WHERE workspace_id=$1 AND request_digest=$2',[this.workspaceId,requestDigest]);
   if(existing.length>1)throw new AppError('UNAVAILABLE');
   if(existing.length){
    const id=existing[0]!.id,count=await tx.query<{n:number}>('SELECT count(*)::int AS n FROM ls_service_interest.public_application_operations WHERE workspace_id=$1 AND application_id=$2',[this.workspaceId,id]);
    if(count.length!==1||count[0]!.n>=100)throw new AppError('RATE_LIMITED');
    await tx.query('INSERT INTO ls_service_interest.public_application_operations(workspace_id,operation_id,request_digest,application_id) VALUES($1,$2,$3,$4)',[this.workspaceId,command.operationId,requestDigest,id]);
    return {saved:true as const,replayed:false,duplicate:true,item:await this.saved(tx,id)};
   }
   const now=this.clock.now();
   // An old open form cannot create a new trip inquiry after the advertised
   // New York date. Existing exact retries above still resolve their outcome.
   if(keysHasPassed(now))throw new AppError('NOT_FOUND');
   const id=randomUUID();
   const counts=await tx.query<{contactCount:number;workspaceCount:number}>(`SELECT (SELECT count(*)::int FROM ls_service_interest.public_applications WHERE workspace_id=$1 AND contact_digest=$2 AND received_at>$3::timestamptz-interval '24 hours') AS "contactCount",(SELECT count(*)::int FROM ls_service_interest.public_applications WHERE workspace_id=$1 AND received_at>$3::timestamptz-interval '24 hours') AS "workspaceCount"`,[this.workspaceId,contactDigest,now]);
   if(counts.length!==1||counts[0]!.contactCount>=4||counts[0]!.workspaceCount>=250)throw new AppError('RATE_LIMITED');
   await tx.query('INSERT INTO ls_service_interest.public_applications(workspace_id,id,contact_digest,request_digest,payload_ciphertext,notice_version,notice_language,received_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[this.workspaceId,id,contactDigest,requestDigest,seal(JSON.stringify(command.fields),groupApplicationPayloadAad(this.workspaceId,id),this.ring),KEYS_CONSENT.version,'en',now]);
   await tx.query('INSERT INTO ls_service_interest.public_application_operations(workspace_id,operation_id,request_digest,application_id) VALUES($1,$2,$3,$4)',[this.workspaceId,command.operationId,requestDigest,id]);
   return {saved:true as const,replayed:false,duplicate:false,item:await this.saved(tx,id)};
  });
 }
 async read(actor:Actor,id:string,before?:number){
  const result=await this.followups.read(actor,id,before);
  if(!isKeysInterest(result.application.fields)||result.application.fields.tripId!==KEYS_TRIP.id)throw new AppError('NOT_FOUND');
  return {...result,application:{...result.application,fields:result.application.fields},currentContact:keysCurrentContact(result.application.fields,result.followup.keysContactCorrection)};
 }
 async listPage(actor:Actor,cursor?:string){
  const page=await this.followups.listPage(actor,cursor);
  const items=page.items.flatMap(item=>isKeysInterest(item.application.fields)&&item.application.fields.tripId===KEYS_TRIP.id?[{...item,application:{...item.application,fields:item.application.fields},currentContact:keysCurrentContact(item.application.fields,item.followup.keysContactCorrection)}]:[]);
  return {items,nextCursor:page.nextCursor};
 }
 async update(actor:Actor,input:KeysOwnerUpdate){
  const parsed=keysOwnerUpdateSchema.safeParse(input);if(!parsed.success)throw new AppError('INVALID_REQUEST');
  const command=parsed.data;
  // Confirm the exact owner and trip before handing a command to the shared
  // transactional writer, which rechecks the session under its workspace lock.
  await this.db.transaction(async tx=>{await tx.query('SET TRANSACTION READ ONLY');await this.owner(tx,actor);await this.saved(tx,command.applicationId);});
  return this.followups.followup(actor,{operationId:command.operationId,applicationId:command.applicationId,expectedVersion:command.expectedVersion,status:command.status,note:command.note,nextAction:command.nextAction,dueDate:command.dueDate,waitingCondition:command.waitingCondition,...(command.contactCorrection?{keysContactCorrection:command.contactCorrection}:{})});
 }
 async summary(actor:Actor){
  const areas:Record<string,{families:number;boys:number}>={};let cursor:string|undefined,families=0,boys=0,pages=0;
  do{const page=await this.listPage(actor,cursor);pages++;for(const item of page.items){families++;boys+=item.application.fields.children.length;for(const area of item.currentContact.pickupPreferences.length?item.currentContact.pickupPreferences:['discuss']){areas[area]??={families:0,boys:0};areas[area]!.families++;areas[area]!.boys+=item.application.fields.children.length;}}cursor=page.nextCursor??undefined;}while(cursor&&pages<20);
  return {tripId:KEYS_TRIP.id,families,boys,pickupAreas:areas,complete:cursor===undefined,nextCursor:cursor??null,meaning:'Counts are interest requests and requested child places, not distinct families or confirmed participants. Pickup areas overlap and do not represent booked seats.'};
 }
}
export type KeysInterestRecord={id:string;source:'public_group_application';state:'owner_review';receivedAt:string;fields:KeysInterest};
