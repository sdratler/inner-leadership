import "server-only";
import {randomUUID} from "node:crypto";
import {AppError} from "../../lib/errors.ts";
import type {IdentityStore,SqlSession} from "../identity/store.ts";
import {freshActor,lockWorkspace} from "../identity/data.ts";
import {requirePractitioner} from "../cases/policy.ts";
import {seal,unseal,type Keyring} from "../identity/crypto.ts";
import {systemClock,type Actor,type IdentityClock} from "../identity/types.ts";
import {privateDigest} from "../contact-ops/server/digests.ts";
import {interestCommandSchema,interestFieldsSchema,type InterestCommand,type InterestRecord} from "./contract.ts";
type Row={id:string;recordedBy:string;ciphertext:string;createdAt:Date;requestDigest:string};
const aad=(workspace:string,id:string)=>`ls_service_interest/v1/${workspace}/${id}`;
const select=`SELECT id,recorded_by AS "recordedBy",payload_ciphertext AS ciphertext,
 created_at AS "createdAt",request_digest AS "requestDigest" FROM ls_service_interest.inquiries`;
/** No CRM fallback, contact creation, clinical joins, enrollment, invitations, payment or provider calls. */
export class GroupInterestStore{
 constructor(private readonly db:IdentityStore,private readonly ring:Keyring,private readonly key:string,
 private readonly clock:IdentityClock=systemClock){}
 private decode(workspace:string,row:Row):InterestRecord{
  try{
   const fields=interestFieldsSchema.parse(JSON.parse(unseal(row.ciphertext,aad(workspace,row.id),this.ring)));
   if(this.digest(workspace,fields)!==row.requestDigest)throw new Error();
   return {id:row.id,recordedBy:row.recordedBy,createdAt:row.createdAt.toISOString(),source:"owner_entered",state:"interest",fields};
  }catch{throw new AppError("UNAVAILABLE");}
 }
 private digest(workspace:string,fields:InterestCommand["fields"]){return privateDigest({domain:"group-interest/v1",workspace,fields},this.key);}
 private async read(tx:SqlSession,actor:Actor,id:string){
  const rows=await tx.query<Row>(select+" WHERE workspace_id=$1 AND id=$2",[actor.workspaceId,id]);
  if(rows.length!==1)throw new AppError("UNAVAILABLE");return this.decode(actor.workspaceId,rows[0]!);
 }
 async create(actor:Actor,input:InterestCommand){
  const parsed=interestCommandSchema.safeParse(input);if(!parsed.success)throw new AppError("INVALID_REQUEST");
  const command=parsed.data,hash=this.digest(actor.workspaceId,command.fields);
  return this.db.transaction(async tx=>{
   await lockWorkspace(tx,actor.workspaceId);
   requirePractitioner(await freshActor(tx,actor,this.clock.now()));
   const prior=await tx.query<{inquiryId:string;requestDigest:string;recordedBy:string}>(`SELECT inquiry_id AS "inquiryId",
    request_digest AS "requestDigest",recorded_by AS "recordedBy" FROM ls_service_interest.operations
    WHERE workspace_id=$1 AND operation_id=$2`,[actor.workspaceId,command.operationId]);
   if(prior.length){
    if(prior.length!==1||prior[0]!.requestDigest!==hash||prior[0]!.recordedBy!==actor.id)throw new AppError("CONFLICT");
    return {saved:true as const,replayed:true,duplicate:true,item:await this.read(tx,actor,prior[0]!.inquiryId)};
   }
   const existing=await tx.query<{id:string}>(`SELECT id FROM ls_service_interest.inquiries WHERE workspace_id=$1 AND request_digest=$2`,[actor.workspaceId,hash]);
   if(existing.length>1)throw new AppError("UNAVAILABLE");
   const id=existing[0]?.id??randomUUID();
   if(!existing.length)await tx.query(`INSERT INTO ls_service_interest.inquiries
    (workspace_id,id,recorded_by,request_digest,payload_ciphertext,created_at) VALUES($1,$2,$3,$4,$5,$6)`,
    [actor.workspaceId,id,actor.id,hash,seal(JSON.stringify(command.fields),aad(actor.workspaceId,id),this.ring),this.clock.now()]);
   await tx.query(`INSERT INTO ls_service_interest.operations(workspace_id,operation_id,recorded_by,request_digest,inquiry_id)
    VALUES($1,$2,$3,$4,$5)`,[actor.workspaceId,command.operationId,actor.id,hash,id]);
   return {saved:true as const,replayed:false,duplicate:existing.length===1,item:await this.read(tx,actor,id)};
  });
 }
 async list(actor:Actor){
  return this.db.transaction(async tx=>{
   await tx.query("SET TRANSACTION READ ONLY");requirePractitioner(await freshActor(tx,actor,this.clock.now()));
   const rows=await tx.query<Row>(select+" WHERE workspace_id=$1 ORDER BY created_at DESC,id DESC LIMIT 51",[actor.workspaceId]);
   return {items:rows.slice(0,50).map(row=>this.decode(actor.workspaceId,row)),hasMore:rows.length>50};
  });
 }
}
