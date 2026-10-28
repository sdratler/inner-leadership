import "server-only";
import {campaignAttributionSchema,type CampaignAttribution} from "./academy-campaign-contract.ts";
import {randomUUID} from "node:crypto";
import {z} from "zod";
import {AppError} from "../../lib/errors.ts";
import type {WorkspaceId} from "../../lib/ids.ts";
import {privateDigest} from "../contact-ops/server/digests.ts";
import {requirePractitioner} from "../cases/policy.ts";
import {seal,unseal,type Keyring} from "../identity/crypto.ts";
import {freshActor,lockWorkspace} from "../identity/data.ts";
import type {IdentityClock,Actor} from "../identity/types.ts";
import {systemClock} from "../identity/types.ts";
import type {IdentityStore,SqlSession} from "../identity/store.ts";
import {groupApplicationCommandSchema,groupApplicationReplaySchema,groupApplicationFieldsSchema,isFloridaGroupApplication,floridaProgramIdSchema,type FloridaProgramId,type GroupApplicationCommand,type GroupApplicationFields,type GroupApplicationRecord} from "./contract.ts";
import {queueInquiryEmail} from "./inquiry-email.ts";
import {isFreeFounderRegistration,type AcademyFounderStore} from './academy-founder-store.ts';

type Row={id:string;requestDigest:string;payloadCiphertext:string;receivedAt:Date};
const aad=(workspace:string,id:string)=>`ls_service_interest/public_application/v1/${workspace}/${id}`;
const select=`SELECT id,request_digest AS "requestDigest",payload_ciphertext AS "payloadCiphertext",received_at AS "receivedAt"
 FROM ls_service_interest.public_applications`;
export const reviewCursorSchema=z.string().min(64).max(2048).regex(/^[A-Za-z0-9_-]+$/);
const reviewQuerySchema=z.object({search:z.string().trim().max(200).default(""),cursor:reviewCursorSchema.optional()}).strict();
const cursorPayloadSchema=z.object({id:z.string().uuid(),searchDigest:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export type GroupApplicationReviewQuery=z.input<typeof reviewQuerySchema>;
export type GroupApplicationReviewPage={items:GroupApplicationRecord[];nextCursor:string|null};

/** Private inquiry only; optional administrative outbox is atomic and never sends here. */
export class PublicGroupApplicationStore{
 constructor(private readonly db:IdentityStore,private readonly workspaceId:WorkspaceId,private readonly ring:Keyring,
  private readonly digestKey:string,private readonly clock:IdentityClock=systemClock,private readonly emailQueueEnabled=false,private readonly founder?:AcademyFounderStore,
  private readonly reviewProgram:FloridaProgramId="sunday_fishing_academy"){floridaProgramIdSchema.parse(reviewProgram);}
 private inOwnerScope(item:GroupApplicationRecord){return isFloridaGroupApplication(item.fields)&&item.fields.programId===this.reviewProgram;}
 private cursorAad(actor:Actor){return `ls_service_interest/review_cursor/v1/${this.workspaceId}/${actor.id}/${this.reviewProgram}`;}
 private searchDigest(search:string){return privateDigest({domain:"public-group-review-search/v1",search},this.digestKey);}
 private readCursor(actor:Actor,cursor:string,search:string):string{
  try{
   const encoded=Buffer.from(cursor,"base64url");if(encoded.toString("base64url")!==cursor)throw new Error();
   const value=cursorPayloadSchema.parse(JSON.parse(unseal(encoded.toString("utf8"),this.cursorAad(actor),this.ring)));
   if(value.searchDigest!==this.searchDigest(search))throw new Error();return value.id;
  }catch{throw new AppError("INVALID_REQUEST");}
 }
 private nextCursor(actor:Actor,id:string,search:string){return Buffer.from(seal(JSON.stringify({id,searchDigest:this.searchDigest(search)}),this.cursorAad(actor),this.ring)).toString("base64url");}
 private requestDigest(fields:GroupApplicationFields){return privateDigest({domain:"public-group-application/v1",workspace:this.workspaceId,fields},this.digestKey);}
 private contactDigest(fields:GroupApplicationFields){return isFloridaGroupApplication(fields)?
  privateDigest({domain:"public-group-application-contact/v1",workspace:this.workspaceId,contact:fields.contact},this.digestKey):
  privateDigest({domain:"public-group-application-contact/v1",workspace:this.workspaceId,phone:fields.parentPhone},this.digestKey);}
 private decode(row:Row):GroupApplicationRecord{
  try{
   const fields=groupApplicationFieldsSchema.parse(JSON.parse(unseal(row.payloadCiphertext,aad(this.workspaceId,row.id),this.ring)));
   if(this.requestDigest(fields)!==row.requestDigest)throw new Error();
   return {id:row.id,source:"public_group_application",state:"owner_review",receivedAt:row.receivedAt.toISOString(),fields};
  }catch{throw new AppError("UNAVAILABLE");}
 }
 private async read(tx:SqlSession,id:string){const rows=await tx.query<Row>(select+" WHERE workspace_id=$1 AND id=$2",[this.workspaceId,id]);if(rows.length!==1)throw new AppError("UNAVAILABLE");return this.decode(rows[0]!);}
 async replaySaved(input:{operationId:string;fields:GroupApplicationFields},attribution:CampaignAttribution|null=null){
  const parsed=groupApplicationReplaySchema.safeParse(input);if(!parsed.success)throw new AppError("INVALID_REQUEST");
  if(!isFloridaGroupApplication(parsed.data.fields))throw new AppError("NOT_FOUND");
  const command=parsed.data,digest=this.requestDigest(command.fields);
  return this.db.transaction(async tx=>{
   await tx.query("SET TRANSACTION READ ONLY");
   const rows=await tx.query<{applicationId:string;requestDigest:string}>(`SELECT application_id AS "applicationId",request_digest AS "requestDigest"
    FROM ls_service_interest.public_application_operations WHERE workspace_id=$1 AND operation_id=$2`,[this.workspaceId,command.operationId]);
   if(rows.length===0)return null;if(rows.length!==1)throw new AppError("UNAVAILABLE");
   if(rows[0]!.requestDigest!==digest)throw new AppError("CONFLICT");if(this.founder)await this.founder.checkAttribution(tx,command.operationId,attribution);
   return {saved:true as const,replayed:true,duplicate:true,item:await this.read(tx,rows[0]!.applicationId),...(this.founder?{founder:await this.founder.publicResult(tx,rows[0]!.applicationId)}:{})};
  });
 }
 async submit(input:GroupApplicationCommand,continuation?:string,attribution:CampaignAttribution|null=null){
  if(attribution!==null)campaignAttributionSchema.parse(attribution);
  const parsed=groupApplicationCommandSchema.safeParse(input);
  if(!parsed.success){const prior=await this.replaySaved(input,attribution);if(prior)return prior;throw new AppError("INVALID_REQUEST");}
  if(!isFloridaGroupApplication(parsed.data.fields))throw new AppError("NOT_FOUND");
  const command=parsed.data,requestDigest=this.requestDigest(command.fields),contactDigest=this.contactDigest(command.fields);
  const free=isFreeFounderRegistration(command.fields);if(free&&(!this.founder||!continuation))throw new AppError('UNAVAILABLE');
  return this.db.transaction(async tx=>{
   await lockWorkspace(tx,this.workspaceId);
   const prior=await tx.query<{applicationId:string;requestDigest:string}>(`SELECT application_id AS "applicationId",request_digest AS "requestDigest"
    FROM ls_service_interest.public_application_operations WHERE workspace_id=$1 AND operation_id=$2`,[this.workspaceId,command.operationId]);
   if(prior.length){if(prior.length!==1||prior[0]!.requestDigest!==requestDigest)throw new AppError("CONFLICT");if(this.founder)await this.founder.checkAttribution(tx,command.operationId,attribution);return {saved:true as const,replayed:true,duplicate:true,item:await this.read(tx,prior[0]!.applicationId),...(this.founder?{founder:await this.founder.publicResult(tx,prior[0]!.applicationId)}:{})};}
   const existing=await tx.query<{id:string}>(`SELECT id FROM ls_service_interest.public_applications WHERE workspace_id=$1 AND request_digest=$2`,[this.workspaceId,requestDigest]);
   if(existing.length>1)throw new AppError("UNAVAILABLE");
   if(existing.length===1){
    const applicationId=existing[0]!.id;
    const aliases=await tx.query<{count:number}>("SELECT count(*)::int AS count FROM ls_service_interest.public_application_operations WHERE workspace_id=$1 AND application_id=$2",[this.workspaceId,applicationId]);
    if(!aliases[0]||aliases[0].count>=100)throw new AppError("RATE_LIMITED");
    // A new-key duplicate also needs an immutable operation receipt. Otherwise
    // that key could later submit different content and escape replay conflict.
    await tx.query("INSERT INTO ls_service_interest.public_application_operations(workspace_id,operation_id,request_digest,application_id) VALUES($1,$2,$3,$4)",
     [this.workspaceId,command.operationId,requestDigest,applicationId]);
    if(this.founder)await this.founder.bindAttribution(tx,command.operationId,applicationId,attribution);return {saved:true as const,replayed:false,duplicate:true,item:await this.read(tx,applicationId),...(this.founder?{founder:await this.founder.publicResult(tx,applicationId)}:{})};
   }
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
   const founder=free?await this.founder!.accept(tx,id,command.fields,continuation!):undefined;
   if(this.founder)await this.founder.bindAttribution(tx,command.operationId,id,attribution);
   const acknowledgment=!free&&this.emailQueueEnabled?await queueInquiryEmail(tx,this.workspaceId,id,command.fields,this.ring,now):undefined;
   return {saved:true as const,replayed:false,duplicate:false,item:await this.read(tx,id),...(founder?{founder}:{}),...(acknowledgment?{acknowledgment}:{})};
  });
 }
 async list(actor:Actor):Promise<GroupApplicationRecord[]>{
  // The older group-interest consumer has no continuation control. Traverse a
  // bounded 1,000-row window instead of calling a mixed-row LIMIT an empty CRM.
  const items:GroupApplicationRecord[]=[];let cursor:string|undefined;
  for(let pageIndex=0;pageIndex<5;pageIndex++){
   const page=await this.listPage(actor,{cursor});items.push(...page.items);
   if(items.length>=50||page.nextCursor===null)return items.slice(0,50);
   cursor=page.nextCursor;
  }
  throw new AppError("UNAVAILABLE");
 }
 /** Search encrypted inquiry fields only after fresh practitioner/workspace
  * authorization. Bound each scan, retaining a cursor even for an empty match
  * page so older inquiries are reachable without a plaintext search index. */
 async listPage(actor:Actor,input:GroupApplicationReviewQuery={}):Promise<GroupApplicationReviewPage>{
  if(actor.workspaceId!==this.workspaceId)throw new AppError("FORBIDDEN");
  const parsed=reviewQuerySchema.safeParse(input);if(!parsed.success)throw new AppError("INVALID_REQUEST");
  const {search}=parsed.data,needle=search.normalize("NFKC").toLocaleLowerCase();
  return this.db.transaction(async tx=>{
   await tx.query("SET TRANSACTION READ ONLY");requirePractitioner(await freshActor(tx,actor,this.clock.now()));
   const cursor=parsed.data.cursor?this.readCursor(actor,parsed.data.cursor,needle):undefined;
   if(cursor){const anchor=await tx.query("SELECT id FROM ls_service_interest.public_applications WHERE workspace_id=$1 AND id=$2",[this.workspaceId,cursor]);if(anchor.length!==1)throw new AppError("INVALID_REQUEST");}
   // Anchor on the stored timestamp, avoiding timestamp precision loss across
   // pages. The UUID and its subquery remain inside the authorized workspace.
   const rows=await tx.query<Row>(select+" WHERE workspace_id=$1"+(cursor?" AND (received_at,id)<(SELECT received_at,id FROM ls_service_interest.public_applications WHERE workspace_id=$1 AND id=$2)":"")+" ORDER BY received_at DESC,id DESC LIMIT 201",cursor?[this.workspaceId,cursor]:[this.workspaceId]);
   const items:GroupApplicationRecord[]=[];let scanned=0;
   while(scanned<Math.min(rows.length,200)&&items.length<50){
    const item=this.decode(rows[scanned++]!);
    // Scope is trusted server composition, never a browser program filter.
    if(this.inOwnerScope(item)&&(!needle||JSON.stringify({id:item.id,fields:item.fields}).normalize("NFKC").toLocaleLowerCase().includes(needle)))items.push(item);
   }
   // A scan may end on a retired row. Do not expose that row's identifier as
   // pagination metadata; bind the opaque cursor to this owner/program/search.
   return {items,nextCursor:scanned<rows.length?this.nextCursor(actor,rows[scanned-1]!.id,needle):null};
  });
 }
 async readForOwnerInTransaction(tx:SqlSession,actor:Actor,id:string):Promise<GroupApplicationRecord>{
  if(actor.workspaceId!==this.workspaceId)throw new AppError("FORBIDDEN");
  if(!z.string().uuid().safeParse(id).success)throw new AppError("INVALID_REQUEST");
  requirePractitioner(await freshActor(tx,actor,this.clock.now()));
  const rows=await tx.query<Row>(select+" WHERE workspace_id=$1 AND id=$2",[this.workspaceId,id]);
  if(rows.length===0)throw new AppError("NOT_FOUND");if(rows.length!==1)throw new AppError("UNAVAILABLE");const item=this.decode(rows[0]!);
  if(!this.inOwnerScope(item))throw new AppError("NOT_FOUND");return item;
 }
}
