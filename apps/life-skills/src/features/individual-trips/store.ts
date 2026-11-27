import 'server-only';
import { createHash,createHmac,randomUUID } from 'node:crypto';
import { AppError } from '../../lib/errors.ts';
import { seal,unseal } from '../identity/crypto.ts';
import { freshActor,lockWorkspace } from '../identity/data.ts';
import { one,type IdentityStore,type SqlSession } from '../identity/store.ts';
import type { IdentityConfig } from '../identity/config.ts';
import type { Actor,IdentityClock } from '../identity/types.ts';
import { TRIP_VERSION,tripCommandSchema,isInternalTripCommand,type TripActor,type TripCommand,type TripReply,type TripState } from './contract.ts';
import { initialTripState,applyTripCommand,projectTripState } from './engine.ts';
import type { TripRuntimeConfig } from './config.ts';
import { queueTripOperationalMail } from './operational-mail.ts';

function stable(value:unknown):string {
 if(value===null||typeof value!=='object')return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(stable).join(',')+']';
 return '{'+Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([key,v])=>JSON.stringify(key)+':'+stable(v)).join(',')+'}';
}
type StoredState={revision:number;payload:string};
type Membership={householdId:string;state:'active'|'revoked'};
export type TripNativeGuard=(tx:SqlSession)=>Promise<void>;
export class IndividualTripStore {
 constructor(readonly database:IdentityStore,readonly identity:IdentityConfig,readonly config:TripRuntimeConfig,readonly clock:IdentityClock,private readonly options:{queueMail?:boolean;onCommitted?:(actor:Actor,operationId:string)=>void}={}){
  if(config.workspaceId!==identity.workspaceId||config.origin!==identity.origin)throw new AppError('UNAVAILABLE');
 }
 private async scope(tx:SqlSession,actor:Actor,enroll=false):Promise<TripActor>{
  if(actor.workspaceId!==this.config.workspaceId)throw new AppError('NOT_FOUND');
  const current=await freshActor(tx,actor,this.clock.now());
  if(!current.emailVerifiedAt||!await one(tx,"SELECT id FROM ls_identity.people WHERE workspace_id=$1 AND id=$2 AND kind='adult'",[actor.workspaceId,current.personId]))throw new AppError('FORBIDDEN');
  if(current.role==='practitioner'){
   if(current.id!==this.config.ownerAccountId)throw new AppError('NOT_FOUND');
   return{accountId:current.id,role:'owner'};
  }
  if(current.role!=='parent')throw new AppError('NOT_FOUND');
  const member=await one<Membership>(tx,'SELECT household_id AS "householdId",state FROM ls_individual_trips.memberships WHERE workspace_id=$1 AND account_id=$2',[actor.workspaceId,current.id]);
  if(member?.state==='revoked'||!member&&!enroll)throw new AppError('NOT_FOUND');
  return{accountId:current.id,role:'parent',...(member?{householdId:member.householdId}:{})};
 }
 private async load(tx:SqlSession):Promise<TripState>{
  const row=await one<StoredState>(tx,'SELECT revision,payload_ciphertext AS payload FROM ls_individual_trips.state WHERE workspace_id=$1 FOR UPDATE',[this.config.workspaceId]);
  if(!row)return initialTripState();
  let state:TripState;
  try{
   const manifest=JSON.parse(unseal(row.payload,`individual-trips:${this.config.workspaceId}:${row.revision}`,this.identity.keyring)) as {format:string;count:number;sha256:string};
   if(manifest.format!=='encrypted-chunks-v1'||!Number.isInteger(manifest.count)||manifest.count<1||manifest.count>256)throw Error('INVALID_MANIFEST');
   const chunks=await tx.query<{index:number;payload:string}>('SELECT chunk_index AS index,payload_ciphertext AS payload FROM ls_individual_trips.state_chunks WHERE workspace_id=$1 AND revision=$2 ORDER BY chunk_index',[this.config.workspaceId,row.revision]);
   if(chunks.length!==manifest.count||chunks.some((chunk,index)=>chunk.index!==index))throw Error('MISSING_CHUNK');
   const bytes=Buffer.concat(chunks.map(chunk=>Buffer.from(unseal(chunk.payload,`trip-chunk:${this.config.workspaceId}:${row.revision}:${chunk.index}`,this.identity.keyring),'base64')));
   if(createHash('sha256').update(bytes).digest('hex')!==manifest.sha256)throw Error('INVALID_DIGEST');
   state=JSON.parse(bytes.toString('utf8')) as TripState;
  }catch{throw new AppError('UNAVAILABLE');}
  if(state.version!==TRIP_VERSION||state.revision!==row.revision||!Array.isArray(state.households)||!Array.isArray(state.offers)||!Array.isArray(state.creditLedger)||!Array.isArray(state.waitlist))throw new AppError('UNAVAILABLE');
  return state;
 }
 async read(actor:Actor,guard?:TripNativeGuard):Promise<ReturnType<typeof projectTripState>>{
  return this.database.transaction(async tx=>{
   await lockWorkspace(tx,this.identity.workspaceId);
   const scope=await this.scope(tx,actor);if(guard)await guard(tx);const state=await this.load(tx);
   if(scope.role==='parent'&&!state.households.some(h=>h.id===scope.householdId&&h.ownerAccountId===scope.accountId))throw new AppError('NOT_FOUND');
   return projectTripState(state,scope);
  });
 }
 async execute(actor:Actor,input:unknown,enrollmentConsent=false):Promise<TripReply>{return this.run(actor,input,false,enrollmentConsent);}
 async executeGuarded(actor:Actor,input:unknown,guard:TripNativeGuard):Promise<TripReply>{return this.run(actor,input,false,false,undefined,guard);}
 /** Only request-bound delivery or verified provider adapters may call this.
  * The browser command endpoint explicitly rejects every internal command. */
 async executeInternal(actor:Actor,input:unknown):Promise<TripReply>{return this.run(actor,input,true,false);}
 async recordManualDelivery(actor:Actor,input:unknown,reference:string):Promise<TripReply>{
  if(typeof reference!=='string'||reference.trim().length<1||reference.length>500)throw new AppError('INVALID_REQUEST');
  const command=tripCommandSchema.safeParse(input);if(!command.success||command.data.type!=='delivery.record_sent')throw new AppError('INVALID_REQUEST');
  return this.run(actor,command.data,true,false,reference.trim());
 }
 private async run(actor:Actor,input:unknown,internal:boolean,enrollmentConsent:boolean,deliveryReference?:string,guard?:TripNativeGuard):Promise<TripReply>{
  const parsed=tripCommandSchema.safeParse(input);if(!parsed.success)throw new AppError('INVALID_REQUEST');
  const command:TripCommand=parsed.data;
  if(isInternalTripCommand(command)!==internal)throw new AppError('FORBIDDEN');
  if(command.type==='household.create'&&!enrollmentConsent)throw new AppError('FORBIDDEN');
  const digest=createHmac('sha256',this.identity.lookupKey).update(stable({program:TRIP_VERSION,actor:actor.id,command,deliveryReference:deliveryReference??null})).digest('hex');
  const result=await this.database.transaction(async tx=>{
   // One native workspace lock orders household, seat, shared-resource and money
   // commands consistently; no external provider call occurs while it is held.
   await lockWorkspace(tx,this.identity.workspaceId);
   const scope=await this.scope(tx,actor,command.type==='household.create'&&enrollmentConsent);
   if(guard)await guard(tx);
   if(internal&&scope.role!=='owner')throw new AppError('FORBIDDEN');
   const receipt=await one<{actorId:string;digest:string;reply:string}>(tx,'SELECT actor_account_id AS "actorId",request_digest AS digest,reply_ciphertext AS reply FROM ls_individual_trips.operations WHERE workspace_id=$1 AND operation_id=$2',[this.config.workspaceId,command.operationId]);
   if(receipt){
    if(receipt.actorId!==actor.id||receipt.digest!==digest)throw new AppError('CONFLICT');
    return{...JSON.parse(unseal(receipt.reply,`trip-operation:${this.config.workspaceId}:${command.operationId}`,this.identity.keyring)) as TripReply,replayed:true};
   }
   const initial=await this.load(tx);
   const operationAt=this.clock.now();
   const {state,reply}=applyTripCommand(initial,scope,command,{now:operationAt,newId:randomUUID});
   if(command.type==='household.create'){
    const household=state.households.find(h=>h.id===reply.householdId&&h.ownerAccountId===actor.id);
    if(!household)throw new AppError('UNAVAILABLE');
    await tx.query("INSERT INTO ls_individual_trips.memberships(workspace_id,account_id,household_id,state,created_at) VALUES($1,$2,$3,'active',$4)",[actor.workspaceId,actor.id,household.id,this.clock.now()]);
   }
   const bytes=Buffer.from(JSON.stringify(state),'utf8'),count=Math.ceil(bytes.length/36000);
   if(count>256)throw new AppError('PAYLOAD_TOO_LARGE');
   // Preserve the shared crypto bound. Each independently authenticated chunk
   // contains base64 of original UTF-8 bytes, so split Unicode stays lossless.
   await tx.query('DELETE FROM ls_individual_trips.state_chunks WHERE workspace_id=$1',[this.config.workspaceId]);
   for(let index=0;index<count;index++)await tx.query('INSERT INTO ls_individual_trips.state_chunks(workspace_id,revision,chunk_index,payload_ciphertext) VALUES($1,$2,$3,$4)',[this.config.workspaceId,state.revision,index,seal(bytes.subarray(index*36000,(index+1)*36000).toString('base64'),`trip-chunk:${this.config.workspaceId}:${state.revision}:${index}`,this.identity.keyring)]);
   const ciphertext=seal(JSON.stringify({format:'encrypted-chunks-v1',count,sha256:createHash('sha256').update(bytes).digest('hex')}),`individual-trips:${this.config.workspaceId}:${state.revision}`,this.identity.keyring);
   await tx.query('INSERT INTO ls_individual_trips.state(workspace_id,revision,payload_ciphertext,updated_at) VALUES($1,$2,$3,$4) ON CONFLICT(workspace_id) DO UPDATE SET revision=EXCLUDED.revision,payload_ciphertext=EXCLUDED.payload_ciphertext,updated_at=EXCLUDED.updated_at',[this.config.workspaceId,state.revision,ciphertext,this.clock.now()]);
   await tx.query('INSERT INTO ls_individual_trips.operations(workspace_id,operation_id,actor_account_id,request_digest,reply_ciphertext,created_at) VALUES($1,$2,$3,$4,$5,$6)',[this.config.workspaceId,command.operationId,actor.id,digest,seal(JSON.stringify(reply),`trip-operation:${this.config.workspaceId}:${command.operationId}`,this.identity.keyring),operationAt]);
   if(deliveryReference&&command.type==='delivery.record_sent')await tx.query('INSERT INTO ls_individual_trips.delivery_receipts(workspace_id,operation_id,offer_id,actor_account_id,reference_ciphertext,sent_at) VALUES($1,$2,$3,$4,$5,$6)',[this.config.workspaceId,command.operationId,command.offerId,actor.id,seal(deliveryReference,`trip-delivery:${this.config.workspaceId}:${command.operationId}`,this.identity.keyring),command.sentAt]);
   if(this.options.queueMail)await queueTripOperationalMail(tx,{identity:this.identity,tripConfig:this.config,clock:this.clock},state,command,reply,actor.id);
   return{...reply,replayed:false};
  });
  if(!result.replayed)this.options.onCommitted?.(actor,command.operationId);
  return result;
 }
}
