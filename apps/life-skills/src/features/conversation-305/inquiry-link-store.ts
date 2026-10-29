import "server-only";
import {z} from "zod";
import {AppError} from "../../lib/errors.ts";
import type {WorkspaceId} from "../../lib/ids.ts";
import {freshActor,lockWorkspace} from "../identity/data.ts";
import type {Keyring} from "../identity/crypto.ts";
import type {IdentityStore,SqlSession} from "../identity/store.ts";
import type {Actor,IdentityClock} from "../identity/types.ts";
import {systemClock} from "../identity/types.ts";
import {privateDigest} from "../contact-ops/server/digests.ts";
import {PublicGroupApplicationStore} from "../group-application/store.ts";
import {inquiryLinkCommandSchema,type InquiryLinkCommand} from "./inquiry-links.ts";

type LinkRow={operationId:string;conversationId:string;ownerAccountId:string;version:number;requestDigest:string;bnaId:string|null;fishingId:string|null;linked:boolean;recordedAt:Date};
const columns=`operation_id AS "operationId",conversation_id AS "conversationId",owner_account_id AS "ownerAccountId",version,request_digest AS "requestDigest",bna_inquiry_id AS "bnaId",fishing_application_id AS "fishingId",linked,recorded_at AS "recordedAt"`;
/** Explicit owner choices only; no phone matching, Person creation or messaging. */
export class Owner305InquiryLinkStore{
 constructor(private db:IdentityStore,private workspace:WorkspaceId,private ring:Keyring,private digestKey:string,
  private ownerId:string,private fishingOwnerId:string,private clock:IdentityClock=systemClock){}
 private async authorize(tx:SqlSession,actor:Actor,conversationId:string){
  if(actor.workspaceId!==this.workspace||actor.id!==this.ownerId)throw new AppError("NOT_FOUND");
  const fresh=await freshActor(tx,actor,this.clock.now());if(fresh.role!=="practitioner"||fresh.state!=="active")throw new AppError("NOT_FOUND");
  const rows=await tx.query("SELECT id FROM ls_service_interest.owner_305_conversations WHERE workspace_id=$1 AND owner_account_id=$2 AND id=$3",[this.workspace,actor.id,conversationId]);
  if(rows.length!==1)throw new AppError("NOT_FOUND");
 }
 private async target(tx:SqlSession,actor:Actor,target:InquiryLinkCommand["target"]){
  if(target.kind==="bna_inquiry"){
   const rows=await tx.query("SELECT id FROM ls_service_interest.bna_inquiries WHERE workspace_id=$1 AND owner_account_id=$2 AND id=$3 AND program_key IN ('bna_torah_mornings','bna_learning_coop')",[this.workspace,actor.id,target.id]);
   if(rows.length!==1)throw new AppError("NOT_FOUND");return;
  }
  if(!this.fishingOwnerId||actor.id!==this.fishingOwnerId)throw new AppError("NOT_FOUND");
  await new PublicGroupApplicationStore(this.db,this.workspace,this.ring,this.digestKey,this.clock).readForOwnerInTransaction(tx,actor,target.id);
 }
 private asResult(row:LinkRow){return {operationId:row.operationId,conversationId:row.conversationId,version:row.version,linked:row.linked,
  target:row.bnaId?{kind:"bna_inquiry" as const,id:row.bnaId}:{kind:"fishing_inquiry" as const,id:row.fishingId!},recordedAt:row.recordedAt.toISOString()};}
 async list(actor:Actor,conversationId:string){
  if(!z.string().uuid().safeParse(conversationId).success)throw new AppError("INVALID_REQUEST");
  return this.db.transaction(async tx=>{await tx.query("SET TRANSACTION READ ONLY");await this.authorize(tx,actor,conversationId);
   const rows=await tx.query<LinkRow>(`SELECT ${columns} FROM (SELECT DISTINCT ON (COALESCE(bna_inquiry_id,fishing_application_id),bna_inquiry_id IS NULL) * FROM ls_service_interest.owner_305_inquiry_link_events
    WHERE workspace_id=$1 AND conversation_id=$2 AND owner_account_id=$3 AND (fishing_application_id IS NULL OR $4::boolean) ORDER BY COALESCE(bna_inquiry_id,fishing_application_id),bna_inquiry_id IS NULL,version DESC) latest ORDER BY recorded_at DESC,operation_id DESC LIMIT 101`,[this.workspace,conversationId,actor.id,Boolean(this.fishingOwnerId&&actor.id===this.fishingOwnerId)]);
   if(rows.length>100)throw new AppError("UNAVAILABLE");return {items:rows.map(row=>this.asResult(row))};
  });
 }
 async save(actor:Actor,input:InquiryLinkCommand){
  const command=inquiryLinkCommandSchema.parse(input),digest=privateDigest({domain:"owner-305-inquiry-link/v1",workspace:this.workspace,actor:actor.id,command},this.digestKey);
  return this.db.transaction(async tx=>{await lockWorkspace(tx,this.workspace);await this.authorize(tx,actor,command.conversationId);
   if(command.target.kind==="fishing_inquiry"&&(!this.fishingOwnerId||actor.id!==this.fishingOwnerId))throw new AppError("NOT_FOUND");
   const prior=await tx.query<LinkRow>(`SELECT ${columns} FROM ls_service_interest.owner_305_inquiry_link_events WHERE workspace_id=$1 AND operation_id=$2`,[this.workspace,command.operationId]);
   if(prior.length){if(prior.length!==1||prior[0]!.requestDigest!==digest||prior[0]!.ownerAccountId!==actor.id||prior[0]!.conversationId!==command.conversationId)throw new AppError("CONFLICT");return {...this.asResult(prior[0]!),replayed:true};}
   await this.target(tx,actor,command.target);
   const bnaId=command.target.kind==="bna_inquiry"?command.target.id:null,fishingId=command.target.kind==="fishing_inquiry"?command.target.id:null;
   const latest=await tx.query<LinkRow>(`SELECT ${columns} FROM ls_service_interest.owner_305_inquiry_link_events WHERE workspace_id=$1 AND conversation_id=$2 AND bna_inquiry_id IS NOT DISTINCT FROM $3::uuid AND fishing_application_id IS NOT DISTINCT FROM $4::uuid ORDER BY version DESC LIMIT 1`,[this.workspace,command.conversationId,bnaId,fishingId]);
   const current=latest[0];if((current?.version??0)!==command.expectedVersion||Boolean(current?.linked)===command.linked)throw new AppError("CONFLICT");
   const version=command.expectedVersion+1,now=this.clock.now();
   await tx.query(`INSERT INTO ls_service_interest.owner_305_inquiry_link_events(workspace_id,operation_id,conversation_id,owner_account_id,version,request_digest,bna_inquiry_id,fishing_application_id,linked,recorded_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[this.workspace,command.operationId,command.conversationId,actor.id,version,digest,bnaId,fishingId,command.linked,now]);
   return {operationId:command.operationId,conversationId:command.conversationId,version,target:command.target,linked:command.linked,recordedAt:now.toISOString(),replayed:false};
  });
 }
}
