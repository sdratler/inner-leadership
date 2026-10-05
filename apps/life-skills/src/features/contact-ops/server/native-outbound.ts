import "server-only";
import {randomUUID} from "node:crypto";
import {z} from "zod";
import {AppError} from "../../../lib/errors.ts";
import {seal,type Keyring} from "../../identity/crypto.ts";
import type {IdentityStore,SqlSession} from "../../identity/store.ts";
import {systemClock,type Actor,type IdentityClock} from "../../identity/types.ts";
import {demoRecordBatch} from "../../demo/provenance.ts";
import {normalizePhone} from "../core/contact-resolution.ts";
import {dateOnly} from "../core/validation.ts";
import {ContactCutoverStore} from "./cutover-store.ts";
import {NativeContactDirectory} from "./native-directory.ts";
import {NativeCrmStore,crmProfileAad,crmProfileSchema} from "./native-store.ts";
import {OutboundProjectionStore,outboundAad,type NativeOutboundContext} from "./outbound-projection-store.ts";
import {privateDigest} from "./digests.ts";

const fieldsSchema=z.object({stage:z.string().min(1).max(120).optional(),nextAction:z.string().max(500).optional(),
 dueDate:z.string().refine(v=>v===""||dateOnly(v)).optional(),formSent:z.string().optional(),messageReceipt:z.string().optional(),
 bookingStatus:z.literal("Link sent; awaiting confirmed appointment").optional(),
 updateProvenance:z.enum(["private-app:practitioner-click","private-app:intake-sent","private-app:booking-link-sent"])}).strict();
const leadPattern=/^LS-(?:LEAD|WAPI)-[A-Za-z0-9_-]{1,80}$/;
/** Native recipient and send projection, in the existing private database.
 * No caller-supplied phone/person, Sheet fallback or provider dependency.
 * The durable prepared intent holds rollback until its outcome is reconciled.
 */
export class NativeOutboundStore {
 private readonly authority:ContactCutoverStore;
 private readonly directory:NativeContactDirectory;
 constructor(private readonly db:IdentityStore,private readonly keyring:Keyring,private readonly integrityKey:string,
  private readonly clock:IdentityClock=systemClock){
  this.authority=new ContactCutoverStore(db,keyring,integrityKey,clock);
  this.directory=new NativeContactDirectory(db,keyring,clock);
 }
 private scoped(tx:SqlSession):IdentityStore{return {transaction:work=>work(tx)};}
 private ledger(tx:SqlSession){return new OutboundProjectionStore(this.scoped(tx),this.keyring,this.integrityKey,this.clock);}
 private async recipient(tx:SqlSession,a:Actor,leadId:string){
  const result=await this.directory.listInTransaction(tx,a,{view:"all",search:"",today:this.clock.now().toISOString().slice(0,10),
   page:1,pageSize:2,leadId});
  if(result.items.length!==1)throw new AppError("NOT_FOUND");
  const row=result.items[0]!,refs=row.references.filter(ref=>ref.leadId===leadId);
  if(refs.length!==1||row.version===null)throw new AppError("CONFLICT");
  if(row.mode!=="live"||row.identityKind!=="adult"||row.archived||row.doNotContact||
   await demoRecordBatch(tx,a.workspaceId,"prospect",leadId)||await demoRecordBatch(tx,a.workspaceId,"person",row.personId))throw new AppError("FORBIDDEN");
  const phone=normalizePhone(refs[0]!.phone);if(!phone)throw new AppError("INVALID_REQUEST");
  return {row,phone};
 }
 prepare(a:Actor,leadId:string,epoch:number,message:string,fields:Record<string,string>,bindingSha256:string){
  if(!leadPattern.test(leadId)||!fieldsSchema.safeParse(fields).success||message!==message.trim()||!message||message.length>2000||
   !/^[a-f0-9]{64}$/.test(bindingSha256))throw new AppError("INVALID_REQUEST");
  return this.authority.withDestination(a,{destination:"native",intent:"write",expectedEpoch:epoch},async tx=>{
   const {row,phone}=await this.recipient(tx,a,leadId);
   const pending=await tx.query(`SELECT operation_id FROM ls_contact_ops.outbound_projections
    WHERE workspace_id=$1 AND legacy_lead_id=$2 AND state IN ('prepared','sent_pending') LIMIT 1`,[a.workspaceId,leadId]);
   if(pending.length)throw new AppError("CONFLICT");
   const operationId=randomUUID(),native:NativeOutboundContext={personId:row.personId,phone,bindingSha256,
    baseline:{stage:row.stage,nextAction:row.nextAction??"",dueDate:row.followUpDate??""}};
   const encrypted=seal(JSON.stringify({message,fields,native}),outboundAad(a.workspaceId,operationId,"fields"),this.keyring);
   await tx.query(`INSERT INTO ls_contact_ops.outbound_projections
    (workspace_id,operation_id,actor_account_id,legacy_lead_id,authority_epoch,request_digest,projection_ciphertext)
    VALUES($1,$2,$3,$4,$5,$6,$7)`,[a.workspaceId,operationId,a.id,leadId,epoch,
    privateDigest({leadId,message,fields,native,actor:a.id,authorityEpoch:epoch},this.integrityKey),encrypted]);
   return operationId;
  });
 }
 /** Fresh ordinary-session and exact recipient read immediately before transport. */
 request(a:Actor,operationId:string,epoch:number,bindingSha256:string){
  return this.authority.withDestination(a,{destination:"native",intent:"read",expectedEpoch:epoch},async tx=>{
   const record=await this.ledger(tx).read(a,operationId);
   if(!record?.native||record.state!=="prepared"||record.authorityEpoch!==epoch||record.native.bindingSha256!==bindingSha256)throw new AppError("CONFLICT");
   const {row,phone}=await this.recipient(tx,a,record.leadId);
   if(row.personId!==record.native.personId||phone!==record.native.phone)throw new AppError("CONFLICT");
   return {operationId,authorityEpoch:epoch,bindingSha256,leadId:record.leadId,phone,body:record.message,recordMode:"live" as const};
  });
 }
 /** Provider receipt, administrative profile update and projected marker commit
  * atomically. Preserve concurrent notes/owner/outcome edits; never overwrite a
  * concurrently changed field that this send intended to update. No second send.
  */
 project(a:Actor,operationId:string,epoch:number){
  return this.authority.withDestination(a,{destination:"native",intent:"write",expectedEpoch:epoch},async tx=>{
   const ledger=this.ledger(tx),record=await ledger.read(a,operationId);
   if(!record?.native||record.authorityEpoch!==epoch)throw new AppError("CONFLICT");
   if(record.state==="projected")return {projected:true as const};
   const receipt=record.receipt,parsed=fieldsSchema.safeParse(record.fields);
   if(record.state!=="sent_pending"||!parsed.success||receipt?.provider!=="whapi"||!receipt.providerMessageId||
    !receipt.sentAt||!Number.isFinite(Date.parse(receipt.sentAt)))throw new AppError("CONFLICT");
   const profiles=new NativeCrmStore(this.scoped(tx),this.keyring,this.integrityKey,this.clock);
   const current=await profiles.read(a,record.native.personId);if(!current)throw new AppError("NOT_FOUND");
   const p=current.profile,f=parsed.data;
   if(!p.legacyIds.includes(record.leadId)&&p.nativeInquiry?.leadId!==record.leadId&&p.whatsappInquiry?.leadId!==record.leadId)throw new AppError("CONFLICT");
   const actual={stage:p.stage,nextAction:p.nextAction??"",dueDate:p.followUpDate??""};
   for(const key of ["stage","nextAction","dueDate"] as const)
    if(f[key]!==undefined&&actual[key]!==record.native.baseline[key]&&actual[key]!==f[key])throw new AppError("CONFLICT");
   const outreach={...p.outreach?.[record.leadId],lastContact:receipt.sentAt,messageReceipt:receipt.providerMessageId,
    updateProvenance:f.updateProvenance,...(f.updateProvenance==="private-app:intake-sent"?{formSent:receipt.sentAt}:{}),
    ...(f.updateProvenance==="private-app:booking-link-sent"?{bookingStatus:"Link sent; awaiting confirmed appointment" as const}:{})};
   const updated=crmProfileSchema.parse({...p,...(f.stage===undefined?{}:{stage:f.stage}),
    ...(f.nextAction===undefined?{}:{nextAction:f.nextAction||null}),...(f.dueDate===undefined?{}:{followUpDate:f.dueDate||null}),
    outreach:{...p.outreach,[record.leadId]:outreach}});
   const rows=await tx.query(`UPDATE ls_contact_ops.profiles SET payload_ciphertext=$3,version=version+1,updated_at=clock_timestamp()
    WHERE workspace_id=$1 AND person_id=$2 AND version=$4 RETURNING version`,[a.workspaceId,p.personId,
    seal(JSON.stringify(updated),crmProfileAad(a.workspaceId,p.personId),this.keyring),current.version]);
   if(rows.length!==1)throw new AppError("CONFLICT");
   await ledger.projected(a,operationId);
   return {projected:true as const};
  });
 }
}
