import "server-only";
import {randomUUID} from "node:crypto";
import {AppError} from "../../lib/errors.ts";
import type {WorkspaceId} from "../../lib/ids.ts";
import {privateDigest} from "../contact-ops/server/digests.ts";
import {requirePractitioner} from "../cases/policy.ts";
import {seal,unseal,type Keyring} from "../identity/crypto.ts";
import {freshActor,lockWorkspace} from "../identity/data.ts";
import type {IdentityClock,Actor} from "../identity/types.ts";
import {systemClock} from "../identity/types.ts";
import type {IdentityStore,SqlSession} from "../identity/store.ts";
import {groupApplicationCommandSchema,groupApplicationFieldsSchema,type GroupApplicationCommand,type GroupApplicationRecord} from "./contract.ts";

type Row={id:string;requestDigest:string;payloadCiphertext:string;receivedAt:Date};
const aad=(workspace:string,id:string)=>`ls_service_interest/public_application/v1/${workspace}/${id}`;
const select=`SELECT id,request_digest AS "requestDigest",payload_ciphertext AS "payloadCiphertext",received_at AS "receivedAt"
 FROM ls_service_interest.public_applications`;

/** Public application receipt only. Never creates a Person, lead, case, enrollment, payment, booking or message. */
export class PublicGroupApplicationStore{
 constructor(private readonly db:IdentityStore,private readonly workspaceId:WorkspaceId,private readonly ring:Keyring,
  private readonly digestKey:string,private readonly clock:IdentityClock=systemClock){}
 private requestDigest(fields:GroupApplicationCommand["fields"]){return privateDigest({domain:"public-group-application/v1",workspace:this.workspaceId,fields},this.digestKey);}
 private contactDigest(phone:string){return privateDigest({domain:"public-group-application-contact/v1",workspace:this.workspaceId,phone},this.digestKey);}
 private decode(row:Row):GroupApplicationRecord{
  try{
   const fields=groupApplicationFieldsSchema.parse(JSON.parse(unseal(row.payloadCiphertext,aad(this.workspaceId,row.id),this.ring)));
   if(this.requestDigest(fields)!==row.requestDigest)throw new Error();
   return {id:row.id,source:"public_group_application",state:"owner_review",receivedAt:row.receivedAt.toISOString(),fields};
  }catch{throw new AppError("UNAVAILABLE");}
 }
 private async read(tx:SqlSession,id:string){const rows=await tx.query<Row>(select+" WHERE workspace_id=$1 AND id=$2",[this.workspaceId,id]);if(rows.length!==1)throw new AppError("UNAVAILABLE");return this.decode(rows[0]!);}
 async submit(input:GroupApplicationCommand){
  const parsed=groupApplicationCommandSchema.safeParse(input);if(!parsed.success)throw new AppError("INVALID_REQUEST");
  const command=parsed.data,requestDigest=this.requestDigest(command.fields),contactDigest=this.contactDigest(command.fields.parentPhone);
  return this.db.transaction(async tx=>{
   await lockWorkspace(tx,this.workspaceId);
   const prior=await tx.query<{applicationId:string;requestDigest:string}>(`SELECT application_id AS "applicationId",request_digest AS "requestDigest"
    FROM ls_service_interest.public_application_operations WHERE workspace_id=$1 AND operation_id=$2`,[this.workspaceId,command.operationId]);
   if(prior.length){if(prior.length!==1||prior[0]!.requestDigest!==requestDigest)throw new AppError("CONFLICT");return {saved:true as const,replayed:true,duplicate:true,item:await this.read(tx,prior[0]!.applicationId)};}
   const existing=await tx.query<{id:string}>(`SELECT id FROM ls_service_interest.public_applications WHERE workspace_id=$1 AND request_digest=$2`,[this.workspaceId,requestDigest]);
   if(existing.length>1)throw new AppError("UNAVAILABLE");
   if(existing.length===1)return {saved:true as const,replayed:false,duplicate:true,item:await this.read(tx,existing[0]!.id)};
   const now=this.clock.now(),id=randomUUID();
   {
    const recent=await tx.query<{contactCount:number;workspaceCount:number}>(`SELECT
     (SELECT count(*)::int FROM ls_service_interest.public_applications WHERE workspace_id=$1 AND contact_digest=$2 AND received_at>$3::timestamptz-interval '24 hours') AS "contactCount",
     (SELECT count(*)::int FROM ls_service_interest.public_applications WHERE workspace_id=$1 AND received_at>$3::timestamptz-interval '24 hours') AS "workspaceCount"`,[this.workspaceId,contactDigest,now]);
    if(!recent[0]||recent[0].contactCount>=4||recent[0].workspaceCount>=250)throw new AppError("RATE_LIMITED");
    await tx.query(`INSERT INTO ls_service_interest.public_applications
     (workspace_id,id,contact_digest,request_digest,payload_ciphertext,notice_version,notice_language,received_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[this.workspaceId,id,contactDigest,requestDigest,
      seal(JSON.stringify(command.fields),aad(this.workspaceId,id),this.ring),command.fields.permission.version,command.fields.permission.language,now]);
   }
   await tx.query(`INSERT INTO ls_service_interest.public_application_operations(workspace_id,operation_id,request_digest,application_id)
    VALUES($1,$2,$3,$4)`,[this.workspaceId,command.operationId,requestDigest,id]);
   return {saved:true as const,replayed:false,duplicate:false,item:await this.read(tx,id)};
  });
 }
 async list(actor:Actor):Promise<GroupApplicationRecord[]>{
  return this.db.transaction(async tx=>{await tx.query("SET TRANSACTION READ ONLY");requirePractitioner(await freshActor(tx,actor,this.clock.now()));
   const rows=await tx.query<Row>(select+" WHERE workspace_id=$1 ORDER BY received_at DESC,id DESC LIMIT 50",[actor.workspaceId]);return rows.map(row=>this.decode(row));});
 }
}
