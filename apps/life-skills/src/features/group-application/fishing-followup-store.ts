import "server-only";
import {z} from "zod";
import {AppError} from "../../lib/errors.ts";
import type {WorkspaceId} from "../../lib/ids.ts";
import {freshActor} from "../identity/data.ts";
import type {Keyring} from "../identity/crypto.ts";
import type {Actor,IdentityClock} from "../identity/types.ts";
import {systemClock} from "../identity/types.ts";
import type {IdentityStore,SqlSession} from "../identity/store.ts";
import {PublicGroupApplicationStore} from "./store.ts";
import {AcademyCampaignStore} from "./academy-campaign-store.ts";
import {appendFishingFollowupInTransaction,decodeFishingFollowupRecord,fishingFollowupRowSql as rowSql,type FishingFollowupRow as Row} from './fishing-followup-record.ts';
import type {FishingFollowupCommand,FishingFollowupState} from './fishing-followup-contract.ts';

const initial: FishingFollowupState={status:"new",note:"",nextAction:"Review inquiry",dueDate:null,waitingCondition:null};

/** Actions attach to the immutable Fishing application. No CRM cutover or Person promotion. */
export class FishingInquiryFollowupStore{
 private readonly applications:PublicGroupApplicationStore;
 constructor(private readonly db:IdentityStore,private readonly workspaceId:WorkspaceId,
  private readonly ring:Keyring,private readonly digestKey:string,private readonly ownerAccountId:string,
  private readonly clock:IdentityClock=systemClock){
  if(!z.string().uuid().safeParse(ownerAccountId).success)throw new AppError("UNAVAILABLE");
  this.applications=new PublicGroupApplicationStore(db,workspaceId,ring,digestKey,clock,false,undefined,'sunday_fishing_academy',false,ownerAccountId);
 }
 private async owner(tx:SqlSession,actor:Actor){
  if(actor.workspaceId!==this.workspaceId||actor.id!==this.ownerAccountId)throw new AppError("NOT_FOUND");
  const fresh=await freshActor(tx,actor,this.clock.now());
  if(fresh.id!==this.ownerAccountId||fresh.role!=="practitioner"||fresh.state!=="active")throw new AppError("NOT_FOUND");
 }
 private recordConfig(){return {workspaceId:this.workspaceId,ownerAccountId:this.ownerAccountId,ring:this.ring,digestKey:this.digestKey};}
 private decode(row:Row){return decodeFishingFollowupRecord(this.recordConfig(),row);}
 private async history(tx:SqlSession,id:string,before?:number){
  const rows=await tx.query<Row>(rowSql+" WHERE workspace_id=$1 AND application_id=$2 AND ($3::integer IS NULL OR version<$3) ORDER BY version DESC LIMIT 101",
   [this.workspaceId,id,before??null]);
  return {items:rows.slice(0,100).map(row=>this.decode(row)),hasMore:rows.length>100};
 }
 async listPage(actor:Actor,cursor?:string){
  await this.db.transaction(async tx=>{await tx.query("SET TRANSACTION READ ONLY");await this.owner(tx,actor);});
  const page=await this.applications.listPage(actor,cursor?{cursor}:{});
  return this.db.transaction(async tx=>{
   await tx.query("SET TRANSACTION READ ONLY");await this.owner(tx,actor);
   const ids=page.items.map(item=>item.id);
   if(!ids.length)return {items:[],nextCursor:page.nextCursor};
   const rows=await tx.query<Row>(`SELECT DISTINCT ON (application_id) operation_id AS "operationId",application_id AS "applicationId",
    actor_account_id AS "actorAccountId",version,request_digest AS "requestDigest",payload_ciphertext AS "payloadCiphertext",recorded_at AS "recordedAt"
    FROM ls_service_interest.fishing_inquiry_followups WHERE workspace_id=$1 AND application_id=ANY($2::uuid[])
    ORDER BY application_id,version DESC`,[this.workspaceId,ids]);
   const latest=new Map(rows.map(row=>[row.applicationId,this.decode(row)]));
   const attribution=await new AcademyCampaignStore(this.workspaceId,this.ring,this.digestKey,()=>this.clock.now()).applicationAttributions(tx,ids);
   return {items:page.items.map(application=>({application,attribution:attribution.get(application.id)??null,
    followup:latest.get(application.id)??{version:0,...initial}})),nextCursor:page.nextCursor};
  });
 }
 async read(actor:Actor,id:string,before?:number){
  if(!z.string().uuid().safeParse(id).success||before!==undefined&&(!Number.isSafeInteger(before)||before<1||before>2147483647))throw new AppError("INVALID_REQUEST");
  return this.db.transaction(async tx=>{
   await tx.query("SET TRANSACTION READ ONLY");await this.owner(tx,actor);
   const application=await this.applications.readForOwnerInTransaction(tx,actor,id);
   const history=await this.history(tx,id,before),latest=before===undefined?history:await this.history(tx,id);
   const attribution=await new AcademyCampaignStore(this.workspaceId,this.ring,this.digestKey,()=>this.clock.now())
    .applicationAttribution(tx,id);
   return {application,attribution,followup:latest.items[0]??{version:0,...initial},history:history.items,hasMoreHistory:history.hasMore};
  });
 }
 async followup(actor:Actor,input:FishingFollowupCommand){
  return this.db.transaction(tx=>appendFishingFollowupInTransaction(tx,this.recordConfig(),input,this.clock.now(),async(current,applicationId)=>{
   await this.owner(current,actor);
   return this.applications.readForOwnerInTransaction(current,actor,applicationId);
  }));
 }
}
