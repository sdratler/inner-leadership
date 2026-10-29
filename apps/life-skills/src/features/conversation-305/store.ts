import "server-only";
import {randomUUID} from "node:crypto";
import {z} from "zod";
import {AppError} from "../../lib/errors.ts";
import type {WorkspaceId} from "../../lib/ids.ts";
import {lockWorkspace,freshActor} from "../identity/data.ts";
import {seal,unseal,type Keyring} from "../identity/crypto.ts";
import type {Actor,IdentityClock} from "../identity/types.ts";
import {systemClock} from "../identity/types.ts";
import type {IdentityStore,SqlSession} from "../identity/store.ts";
import {privateDigest} from "../contact-ops/server/digests.ts";
import {CONVERSATION_305_LINE,conversationCommandSchema,conversationClassification,
 type ConversationCommand,type ConversationFollowup} from "./contract.ts";

type ConversationRow={id:string;ownerAccountId:string;metadataCiphertext:string;createdAt:Date};
type RevisionRow={operationId:string;conversationId:string;ownerAccountId:string;version:number;requestDigest:string;payloadCiphertext:string;recordedAt:Date};
const metadataSchema=z.object({lineNumber:z.literal(CONVERSATION_305_LINE),channel:z.enum(["phone","whatsapp","sms","other"]),contactHint:z.string().min(1).max(160)}).strict();
const followupSchema=z.object({classification:conversationClassification,note:z.string().min(1).max(5000),
 nextAction:z.string().min(1).max(500).nullable(),dueDate:z.iso.date().nullable(),waitingCondition:z.string().min(1).max(500).nullable()}).strict();
const metadataAad=(workspace:string,id:string)=>`ls_service_interest/owner-305-conversation/v1/${workspace}/${id}`;
const revisionAad=(workspace:string,operation:string)=>`ls_service_interest/owner-305-revision/v1/${workspace}/${operation}`;
export class Owner305ConversationStore{
 constructor(private readonly db:IdentityStore,private readonly workspaceId:WorkspaceId,private readonly ring:Keyring,
  private readonly digestKey:string,private readonly ownerAccountId:string,private readonly clock:IdentityClock=systemClock,private readonly inboundBindingDigest:string|null=null){}
 private inboundBinding(){if(!this.inboundBindingDigest||!/^[a-f0-9]{64}$/.test(this.inboundBindingDigest))throw new AppError("UNAVAILABLE");
  return privateDigest({domain:"owner-305-binding/v1",workspace:this.workspaceId,value:this.inboundBindingDigest},this.digestKey);}
 private digest(actor:Actor,command:ConversationCommand){return privateDigest({domain:"owner-305-conversation-operation/v1",workspace:this.workspaceId,actor:actor.id,command},this.digestKey);}
 private metadata(row:ConversationRow){try{const metadata=metadataSchema.parse(JSON.parse(unseal(row.metadataCiphertext,metadataAad(this.workspaceId,row.id),this.ring)));
  return {id:row.id,ownerAccountId:row.ownerAccountId,createdAt:row.createdAt.toISOString(),...metadata};
 }catch{throw new AppError("UNAVAILABLE");}}
 private revision(row:RevisionRow){try{const followup=followupSchema.parse(JSON.parse(unseal(row.payloadCiphertext,revisionAad(this.workspaceId,row.operationId),this.ring)));
  return {operationId:row.operationId,conversationId:row.conversationId,ownerAccountId:row.ownerAccountId,
   version:row.version,recordedAt:row.recordedAt.toISOString(),...followup};
 }catch{throw new AppError("UNAVAILABLE");}}
 private async owner(tx:SqlSession,actor:Actor){if(actor.workspaceId!==this.workspaceId||
  !z.string().uuid().safeParse(this.ownerAccountId).success||actor.id!==this.ownerAccountId)throw new AppError("NOT_FOUND");
  const fresh=await freshActor(tx,actor,this.clock.now());if(fresh.role!=="practitioner"||fresh.state!=="active")throw new AppError("NOT_FOUND");}
 private async record(tx:SqlSession,actor:Actor,id:string){
  const rows=await tx.query<ConversationRow>(`SELECT id,owner_account_id AS "ownerAccountId",metadata_ciphertext AS "metadataCiphertext",created_at AS "createdAt"
   FROM ls_service_interest.owner_305_conversations WHERE workspace_id=$1 AND id=$2 AND owner_account_id=$3 AND line_number=$4`,
   [this.workspaceId,id,actor.id,CONVERSATION_305_LINE]);
  if(rows.length!==1)throw new AppError("NOT_FOUND");return this.metadata(rows[0]!);
 }
 private async history(tx:SqlSession,id:string){const rows=await tx.query<RevisionRow>(`SELECT operation_id AS "operationId",conversation_id AS "conversationId",
  owner_account_id AS "ownerAccountId",version,request_digest AS "requestDigest",payload_ciphertext AS "payloadCiphertext",recorded_at AS "recordedAt"
  FROM ls_service_interest.owner_305_conversation_revisions WHERE workspace_id=$1 AND conversation_id=$2 ORDER BY version DESC LIMIT 101`,[this.workspaceId,id]);
  if(!rows.length)throw new AppError("UNAVAILABLE");return {items:rows.slice(0,100).map(row=>this.revision(row)),hasMore:rows.length>100};}
 private cursorAad(actor:Actor){return `ls_service_interest/owner-305-cursor/v1/${this.workspaceId}/${actor.id}`;}
 private cursorId(actor:Actor,cursor:string){try{if(!/^[A-Za-z0-9_-]{64,2048}$/.test(cursor))throw Error();const bytes=Buffer.from(cursor,"base64url");if(bytes.toString("base64url")!==cursor)throw Error();return z.strictObject({id:z.string().uuid()}).parse(JSON.parse(unseal(bytes.toString("utf8"),this.cursorAad(actor),this.ring))).id;}catch{throw new AppError("INVALID_REQUEST");}}
 private encodeCursor(actor:Actor,id:string){return Buffer.from(seal(JSON.stringify({id}),this.cursorAad(actor),this.ring)).toString("base64url");}
 async list(actor:Actor,cursor?:string){return this.db.transaction(async tx=>{await tx.query("SET TRANSACTION READ ONLY");await this.owner(tx,actor);
  const anchor=cursor===undefined?null:this.cursorId(actor,cursor);
  if(anchor){const found=await tx.query(`SELECT id FROM ls_service_interest.owner_305_conversations WHERE workspace_id=$1 AND owner_account_id=$2 AND line_number=$3 AND id=$4`,[this.workspaceId,actor.id,CONVERSATION_305_LINE,anchor]);if(found.length!==1)throw new AppError("INVALID_REQUEST");}
  const rows=await tx.query<ConversationRow & {operationId:string;conversationId:string;version:number;requestDigest:string;payloadCiphertext:string;recordedAt:Date}>(`SELECT c.id,c.owner_account_id AS "ownerAccountId",c.metadata_ciphertext AS "metadataCiphertext",c.created_at AS "createdAt",
   r.operation_id AS "operationId",r.conversation_id AS "conversationId",r.version,r.request_digest AS "requestDigest",
   r.payload_ciphertext AS "payloadCiphertext",r.recorded_at AS "recordedAt"
   FROM ls_service_interest.owner_305_conversations c JOIN LATERAL(
    SELECT * FROM ls_service_interest.owner_305_conversation_revisions r
    WHERE r.workspace_id=c.workspace_id AND r.conversation_id=c.id ORDER BY r.version DESC LIMIT 1) r ON true
   WHERE c.workspace_id=$1 AND c.owner_account_id=$2 AND c.line_number=$3 AND ($4::uuid IS NULL OR (c.created_at,c.id)<(SELECT anchor.created_at,anchor.id FROM ls_service_interest.owner_305_conversations anchor WHERE anchor.workspace_id=$1 AND anchor.owner_account_id=$2 AND anchor.line_number=$3 AND anchor.id=$4)) ORDER BY c.created_at DESC,c.id DESC LIMIT 101`,
   [this.workspaceId,actor.id,CONVERSATION_305_LINE,anchor]);
  const items=rows.slice(0,100).map(row=>({...this.metadata(row),followup:this.revision(row)}));
  return {lineNumber:CONVERSATION_305_LINE,items,hasMore:rows.length>100,nextCursor:rows.length>100?this.encodeCursor(actor,items.at(-1)!.id):null};
 });}
 async read(actor:Actor,id:string){if(!z.string().uuid().safeParse(id).success)throw new AppError("INVALID_REQUEST");
  return this.db.transaction(async tx=>{await tx.query("SET TRANSACTION READ ONLY");await this.owner(tx,actor);
   const record=await this.record(tx,actor,id),history=await this.history(tx,id);
   const links=this.inboundBindingDigest?await tx.query<{eventKey:string}>(`SELECT event_key AS "eventKey" FROM ls_service_interest.owner_305_inbound_links WHERE workspace_id=$1 AND binding_key=$2 AND conversation_id=$3`,[this.workspaceId,this.inboundBinding(),id]):[];
   if(links.length>1)throw new AppError("UNAVAILABLE");
   return {...record,sourceReceiptKey:links[0]?.eventKey??null,followup:history.items[0]!,history:history.items,hasMoreHistory:history.hasMore};});}
 async save(actor:Actor,input:ConversationCommand){const command=conversationCommandSchema.parse(input),digest=this.digest(actor,command),now=this.clock.now();
  return this.db.transaction(async tx=>{await lockWorkspace(tx,this.workspaceId);await this.owner(tx,actor);
   if(command.kind==="create"){
    const prior=await tx.query<{conversationId:string;creationDigest:string}>(`SELECT o.conversation_id AS "conversationId",o.creation_digest AS "creationDigest"
     FROM ls_service_interest.owner_305_conversation_operations o JOIN ls_service_interest.owner_305_conversations c
     ON c.workspace_id=o.workspace_id AND c.id=o.conversation_id WHERE o.workspace_id=$1 AND o.operation_id=$2 AND c.owner_account_id=$3`,
     [this.workspaceId,command.operationId,actor.id]);
    if(prior.length){if(prior.length!==1||prior[0]!.creationDigest!==digest)throw new AppError("CONFLICT");
     return {saved:true as const,id:prior[0]!.conversationId,replayed:true};}
    const used=await tx.query<{operationId:string}>(`SELECT operation_id AS "operationId" FROM ls_service_interest.owner_305_conversation_revisions
     WHERE workspace_id=$1 AND operation_id=$2`,[this.workspaceId,command.operationId]);
    if(used.length)throw new AppError("CONFLICT");
    let binding:string|null=null;if(command.sourceReceiptKey){if(command.channel!=="whatsapp")throw new AppError("INVALID_REQUEST");binding=this.inboundBinding();
     const receipt=await tx.query<{eventKey:string}>(`SELECT event_key AS "eventKey" FROM ls_service_interest.owner_305_inbound_receipts WHERE workspace_id=$1 AND binding_key=$2 AND event_key=$3`,[this.workspaceId,binding,command.sourceReceiptKey]);
     if(receipt.length!==1)throw new AppError("NOT_FOUND");
     const linked=await tx.query<{conversationId:string}>(`SELECT conversation_id AS "conversationId" FROM ls_service_interest.owner_305_inbound_links WHERE workspace_id=$1 AND binding_key=$2 AND event_key=$3`,[this.workspaceId,binding,command.sourceReceiptKey]);
     if(linked.length)throw new AppError("CONFLICT");}
    const id=randomUUID(),metadata=metadataSchema.parse({lineNumber:CONVERSATION_305_LINE,channel:command.channel,contactHint:command.contactHint});
    await tx.query(`INSERT INTO ls_service_interest.owner_305_conversations(workspace_id,id,owner_account_id,line_number,metadata_ciphertext,creation_digest,created_at)
     VALUES($1,$2,$3,$4,$5,$6,$7)`,[this.workspaceId,id,actor.id,CONVERSATION_305_LINE,seal(JSON.stringify(metadata),metadataAad(this.workspaceId,id),this.ring),digest,now]);
    await tx.query(`INSERT INTO ls_service_interest.owner_305_conversation_operations(workspace_id,operation_id,creation_digest,conversation_id) VALUES($1,$2,$3,$4)`,
     [this.workspaceId,command.operationId,digest,id]);
    if(binding&&command.sourceReceiptKey)await tx.query(`INSERT INTO ls_service_interest.owner_305_inbound_links(workspace_id,binding_key,event_key,conversation_id) VALUES($1,$2,$3,$4)`,[this.workspaceId,binding,command.sourceReceiptKey,id]);
    await this.insertRevision(tx,actor,id,command.operationId,1,digest,command.followup,now);
    return {saved:true as const,id,replayed:false};
   }
   const prior=await tx.query<RevisionRow>(`SELECT operation_id AS "operationId",conversation_id AS "conversationId",owner_account_id AS "ownerAccountId",version,
    request_digest AS "requestDigest",payload_ciphertext AS "payloadCiphertext",recorded_at AS "recordedAt"
    FROM ls_service_interest.owner_305_conversation_revisions WHERE workspace_id=$1 AND operation_id=$2`,[this.workspaceId,command.operationId]);
   if(prior.length){if(prior.length!==1||prior[0]!.requestDigest!==digest||prior[0]!.conversationId!==command.conversationId||prior[0]!.ownerAccountId!==actor.id)throw new AppError("CONFLICT");
    return {saved:true as const,id:command.conversationId,replayed:true,followup:this.revision(prior[0]!)};}
   await this.record(tx,actor,command.conversationId);
   const latest=await tx.query<{version:number}>(`SELECT version FROM ls_service_interest.owner_305_conversation_revisions
    WHERE workspace_id=$1 AND conversation_id=$2 ORDER BY version DESC LIMIT 1`,[this.workspaceId,command.conversationId]);
   if(latest.length!==1||latest[0]!.version!==command.expectedVersion)throw new AppError("CONFLICT");
   await this.insertRevision(tx,actor,command.conversationId,command.operationId,command.expectedVersion+1,digest,command.followup,now);
   return {saved:true as const,id:command.conversationId,replayed:false};
  });
 }
 private async insertRevision(tx:SqlSession,actor:Actor,id:string,operationId:string,version:number,digest:string,followup:ConversationFollowup,now:Date){
  await tx.query(`INSERT INTO ls_service_interest.owner_305_conversation_revisions(workspace_id,operation_id,conversation_id,owner_account_id,
   version,request_digest,payload_ciphertext,recorded_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
   [this.workspaceId,operationId,id,actor.id,version,digest,seal(JSON.stringify(followup),revisionAad(this.workspaceId,operationId),this.ring),now]);
 }
}
