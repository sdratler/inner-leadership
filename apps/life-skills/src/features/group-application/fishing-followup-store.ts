import "server-only";
import {z} from "zod";
import {AppError} from "../../lib/errors.ts";
import type {WorkspaceId} from "../../lib/ids.ts";
import {privateDigest} from "../contact-ops/server/digests.ts";
import {freshActor,lockWorkspace} from "../identity/data.ts";
import {seal,unseal,type Keyring} from "../identity/crypto.ts";
import type {Actor,IdentityClock} from "../identity/types.ts";
import {systemClock} from "../identity/types.ts";
import type {IdentityStore,SqlSession} from "../identity/store.ts";
import {PublicGroupApplicationStore} from "./store.ts";
import {AcademyCampaignStore} from "./academy-campaign-store.ts";
import {fishingFollowupCommandSchema,fishingFollowupStateSchema,
 type FishingFollowupCommand,type FishingFollowupState} from "./fishing-followup-contract.ts";

type Row={operationId:string;applicationId:string;actorAccountId:string;version:number;
 requestDigest:string;payloadCiphertext:string;recordedAt:Date};
const rowSql=`SELECT operation_id AS "operationId",application_id AS "applicationId",
 actor_account_id AS "actorAccountId",version,request_digest AS "requestDigest",
 payload_ciphertext AS "payloadCiphertext",recorded_at AS "recordedAt"
 FROM ls_service_interest.fishing_inquiry_followups`;
const aad=(workspace:string,operation:string)=>`ls_service_interest/fishing-followup/v1/${workspace}/${operation}`;
const savedSchema=z.object({expectedVersion:z.number().int().nonnegative(),state:fishingFollowupStateSchema}).strict();
const initial: FishingFollowupState={status:"new",note:"",nextAction:"Review inquiry",dueDate:null,waitingCondition:null};

/** Actions attach to the immutable Fishing application. No CRM cutover or Person promotion. */
export class FishingInquiryFollowupStore{
 private readonly applications:PublicGroupApplicationStore;
 constructor(private readonly db:IdentityStore,private readonly workspaceId:WorkspaceId,
  private readonly ring:Keyring,private readonly digestKey:string,private readonly ownerAccountId:string,
  private readonly clock:IdentityClock=systemClock){
  if(!z.string().uuid().safeParse(ownerAccountId).success)throw new AppError("UNAVAILABLE");
  this.applications=new PublicGroupApplicationStore(db,workspaceId,ring,digestKey,clock);
 }
 private async owner(tx:SqlSession,actor:Actor){
  if(actor.workspaceId!==this.workspaceId||actor.id!==this.ownerAccountId)throw new AppError("NOT_FOUND");
  const fresh=await freshActor(tx,actor,this.clock.now());
  if(fresh.id!==this.ownerAccountId||fresh.role!=="practitioner"||fresh.state!=="active")throw new AppError("NOT_FOUND");
 }
 private digest(input:{operationId:string;applicationId:string;actorAccountId:string;expectedVersion:number;state:FishingFollowupState}){
  return privateDigest({domain:"fishing-inquiry-followup/v1",workspace:this.workspaceId,...input},this.digestKey);
 }
 private decode(row:Row){
  try{
   const saved=savedSchema.parse(JSON.parse(unseal(row.payloadCiphertext,aad(this.workspaceId,row.operationId),this.ring)));
   if(row.actorAccountId!==this.ownerAccountId||row.version!==saved.expectedVersion+1||
    row.requestDigest!==this.digest({operationId:row.operationId,applicationId:row.applicationId,
     actorAccountId:row.actorAccountId,...saved}))throw new Error();
   return {operationId:row.operationId,applicationId:row.applicationId,actorAccountId:row.actorAccountId,
    version:row.version,recordedAt:row.recordedAt.toISOString(),...saved.state};
  }catch{throw new AppError("UNAVAILABLE");}
 }
 private async history(tx:SqlSession,id:string){
  const rows=await tx.query<Row>(rowSql+" WHERE workspace_id=$1 AND application_id=$2 ORDER BY version DESC LIMIT 101",
   [this.workspaceId,id]);
  if(rows.length>100)throw new AppError("UNAVAILABLE");
  return rows.map(row=>this.decode(row));
 }
 async read(actor:Actor,id:string){
  if(!z.string().uuid().safeParse(id).success)throw new AppError("INVALID_REQUEST");
  return this.db.transaction(async tx=>{
   await tx.query("SET TRANSACTION READ ONLY");await this.owner(tx,actor);
   const application=await this.applications.readForOwnerInTransaction(tx,actor,id);
   const history=await this.history(tx,id);
   const attribution=await new AcademyCampaignStore(this.workspaceId,this.ring,this.digestKey,()=>this.clock.now())
    .applicationAttribution(tx,id);
   return {application,attribution,followup:history[0]??{version:0,...initial},history};
  });
 }
 async followup(actor:Actor,input:FishingFollowupCommand){
  const command=fishingFollowupCommandSchema.parse(input);
  const state=fishingFollowupStateSchema.parse({status:command.status,note:command.note,
   nextAction:command.nextAction,dueDate:command.dueDate,waitingCondition:command.waitingCondition});
  const digest=this.digest({operationId:command.operationId,applicationId:command.applicationId,
   actorAccountId:actor.id,expectedVersion:command.expectedVersion,state});
  return this.db.transaction(async tx=>{
   await lockWorkspace(tx,this.workspaceId);await this.owner(tx,actor);
   const prior=await tx.query<Row>(rowSql+" WHERE workspace_id=$1 AND operation_id=$2",
    [this.workspaceId,command.operationId]);
   if(prior.length){
    if(prior.length!==1||prior[0]!.requestDigest!==digest||prior[0]!.actorAccountId!==actor.id)
     throw new AppError("CONFLICT");
    return {...this.decode(prior[0]!),replayed:true};
   }
   await this.applications.readForOwnerInTransaction(tx,actor,command.applicationId);
   const history=await this.history(tx,command.applicationId),version=(history[0]?.version??0)+1;
   if(command.expectedVersion!==version-1)throw new AppError("CONFLICT");
   const now=this.clock.now();
   await tx.query(`INSERT INTO ls_service_interest.fishing_inquiry_followups
    (workspace_id,operation_id,application_id,actor_account_id,version,request_digest,payload_ciphertext,recorded_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[this.workspaceId,command.operationId,command.applicationId,
    actor.id,version,digest,seal(JSON.stringify({expectedVersion:command.expectedVersion,state}),
     aad(this.workspaceId,command.operationId),this.ring),now]);
   return {operationId:command.operationId,applicationId:command.applicationId,actorAccountId:actor.id,
    version,recordedAt:now.toISOString(),...state,replayed:false};
  });
 }
}
