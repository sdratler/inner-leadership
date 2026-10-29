import "server-only";
import {z} from "zod";
import {AppError} from "../../lib/errors.ts";
import type {WorkspaceId} from "../../lib/ids.ts";
import {freshActor,lockWorkspace} from "../identity/data.ts";
import {seal,unseal,type Keyring} from "../identity/crypto.ts";
import type {IdentityStore} from "../identity/store.ts";
import {systemClock,type Actor,type IdentityClock} from "../identity/types.ts";
import {inbound305InquirySchema,type Inbound305Inquiry} from "./inbound-contract.ts";
import {inboundBindingDigest} from "../contact-ops/server/inbound-store.ts";
import {privateDigest} from "../contact-ops/server/digests.ts";
import {CONVERSATION_305_LINE} from "./contract.ts";

type Row={bindingKey:string;eventKey:string;messageKey:string;payloadDigest:string;payloadCiphertext:string;occurredAt:Date;storedAt:Date;linkedConversationId?:string|null};
const aad=(w:string,b:string,e:string)=>`ls_service_interest/owner-305-inbound/v1/${w}/${b}/${e}`;
/** Exact provider binding; encrypted receipt only. Never creates a Person or task. */
export class Owner305InboundStore{
 constructor(private readonly db:IdentityStore,private readonly workspaceId:WorkspaceId,private readonly ring:Keyring,
  private readonly digestKey:string,private readonly bindingDigest:string,private readonly ownerAccountId:string,private readonly clock:IdentityClock=systemClock){
  if(!/^[a-f0-9]{64}$/.test(bindingDigest)||!z.string().uuid().safeParse(ownerAccountId).success)throw new AppError("UNAVAILABLE");
 }
 private key(domain:string,value:unknown){return privateDigest({domain,workspace:this.workspaceId,value},this.digestKey);}
 private binding(){return this.key("owner-305-binding/v1",this.bindingDigest);}
 private keys(inquiry:Inbound305Inquiry){const bindingKey=this.binding();return {bindingKey,
  eventKey:this.key("owner-305-event/v1",{bindingKey,id:inquiry.providerEventId}),
  messageKey:this.key("owner-305-message/v1",{bindingKey,id:inquiry.providerMessageId}),
  payloadDigest:this.key("owner-305-payload/v1",inquiry)};}
 async capture(input:unknown){const result=inbound305InquirySchema.safeParse(input);if(!result.success)throw new AppError("INVALID_REQUEST");
  const inquiry=result.data;if(inquiry.businessNumber!==CONVERSATION_305_LINE||inboundBindingDigest(inquiry)!==this.bindingDigest)throw new AppError("FORBIDDEN");
  const keys=this.keys(inquiry),cipher=seal(JSON.stringify(inquiry),aad(this.workspaceId,keys.bindingKey,keys.eventKey),this.ring);
  return this.db.transaction(async tx=>{await lockWorkspace(tx,this.workspaceId);
   const owner=await tx.query<{id:string}>("SELECT id FROM ls_identity.accounts WHERE workspace_id=$1 AND id=$2 AND role='practitioner' AND state='active'",[this.workspaceId,this.ownerAccountId]);
   if(owner.length!==1)throw new AppError("UNAVAILABLE");
   const rows=await tx.query<Row>(`SELECT binding_key AS "bindingKey",event_key AS "eventKey",message_key AS "messageKey",payload_digest AS "payloadDigest",payload_ciphertext AS "payloadCiphertext",occurred_at AS "occurredAt",stored_at AS "storedAt"
    FROM ls_service_interest.owner_305_inbound_receipts WHERE workspace_id=$1 AND binding_key=$2 AND (event_key=$3 OR message_key=$4)`,[this.workspaceId,keys.bindingKey,keys.eventKey,keys.messageKey]);
   if(rows.length){if(rows.length!==1||rows[0]!.eventKey!==keys.eventKey||rows[0]!.messageKey!==keys.messageKey||rows[0]!.payloadDigest!==keys.payloadDigest)throw new AppError("CONFLICT");
    return {replayed:true,storedAt:rows[0]!.storedAt.toISOString()};}
   const inserted=await tx.query<{storedAt:Date}>(`INSERT INTO ls_service_interest.owner_305_inbound_receipts(workspace_id,binding_key,event_key,message_key,payload_digest,payload_ciphertext,occurred_at)
    VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING stored_at AS "storedAt"`,[this.workspaceId,keys.bindingKey,keys.eventKey,keys.messageKey,keys.payloadDigest,cipher,inquiry.occurredAt]);
   return {replayed:false,storedAt:inserted[0]!.storedAt.toISOString()};});
 }
 async list(actor:Actor,before?:string){if(before!==undefined&&!/^[a-f0-9]{64}$/.test(before))throw new AppError("INVALID_REQUEST");if(actor.workspaceId!==this.workspaceId||actor.id!==this.ownerAccountId||!z.string().uuid().safeParse(this.ownerAccountId).success)throw new AppError("NOT_FOUND");
  return this.db.transaction(async tx=>{await tx.query("SET TRANSACTION READ ONLY");const fresh=await freshActor(tx,actor,this.clock.now());
   if(fresh.role!=="practitioner"||fresh.state!=="active")throw new AppError("NOT_FOUND");
   const rows=await tx.query<Row>(`SELECT r.binding_key AS "bindingKey",r.event_key AS "eventKey",r.message_key AS "messageKey",r.payload_digest AS "payloadDigest",r.payload_ciphertext AS "payloadCiphertext",r.occurred_at AS "occurredAt",r.stored_at AS "storedAt",l.conversation_id AS "linkedConversationId"
    FROM ls_service_interest.owner_305_inbound_receipts r LEFT JOIN ls_service_interest.owner_305_inbound_links l ON l.workspace_id=r.workspace_id AND l.binding_key=r.binding_key AND l.event_key=r.event_key
    WHERE r.workspace_id=$1 AND r.binding_key=$2 AND ($3::text IS NULL OR (r.stored_at,r.event_key) < (SELECT c.stored_at,c.event_key FROM ls_service_interest.owner_305_inbound_receipts c WHERE c.workspace_id=$1 AND c.binding_key=$2 AND c.event_key=$3)) ORDER BY r.stored_at DESC,r.event_key DESC LIMIT 101`,[this.workspaceId,this.binding(),before??null]);
   const items=rows.slice(0,100).map(row=>{try{const inquiry=inbound305InquirySchema.parse(JSON.parse(unseal(row.payloadCiphertext,aad(this.workspaceId,row.bindingKey,row.eventKey),this.ring)));
    const keys=this.keys(inquiry);if(inquiry.businessNumber!==CONVERSATION_305_LINE||inboundBindingDigest(inquiry)!==this.bindingDigest||keys.bindingKey!==row.bindingKey||keys.eventKey!==row.eventKey||keys.messageKey!==row.messageKey||keys.payloadDigest!==row.payloadDigest||row.occurredAt.toISOString()!==inquiry.occurredAt)throw Error();
    return {id:row.eventKey,linkedConversationId:row.linkedConversationId??null,fromNumber:inquiry.fromNumber,pushName:inquiry.pushName,messageText:inquiry.messageText,messageType:inquiry.messageType,occurredAt:inquiry.occurredAt,storedAt:row.storedAt.toISOString(),media:inquiry.media.map(({fileName,mimeType,sizeBytes})=>({fileName,mimeType,sizeBytes}))};
   }catch{throw new AppError("UNAVAILABLE");}});
   return {items,hasMore:rows.length>100,nextCursor:rows.length>100?items.at(-1)!.id:null};});
 }
}
