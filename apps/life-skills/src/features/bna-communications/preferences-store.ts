import "server-only";
import {z} from "zod";
import {AppError} from "../../lib/errors.ts";
import type {WorkspaceId} from "../../lib/ids.ts";
import {privateDigest} from "../contact-ops/server/digests.ts";
import {freshActor,lockWorkspace} from "../identity/data.ts";
import {seal,unseal,type Keyring} from "../identity/crypto.ts";
import type {Actor,IdentityClock} from "../identity/types.ts";
import type {IdentityStore,SqlSession} from "../identity/store.ts";
import type {BnaInquiryStore} from "../bna-inquiry/store.ts";
import {bnaEmailRecipientKey} from "./acknowledgment-store.ts";
import {bnaEmailProgram} from "./delivery-policy.ts";
import {bnaOwnerPreferenceCommand,bnaRecipientPreferenceCommand,bnaPreferenceCapability,bnaPreferenceToken,BNA_PREFERENCE_NOTICE,recipientBnaPreferences,
 type BnaOwnerPreferenceCommand,type BnaRecipientPreferenceCommand,type BnaPreferenceContext,type BnaPreferenceSnapshot} from "./preferences-contract.ts";

const eventSchema=z.strictObject({version:z.literal(1),source:z.enum(["owner","recipient"]),
 programKey:bnaEmailProgram.nullable(),
 command:z.union([bnaOwnerPreferenceCommand,bnaRecipientPreferenceCommand]),recordedAt:z.iso.datetime(),
 notice:z.strictObject({version:z.literal(BNA_PREFERENCE_NOTICE.version),language:z.enum(["en","he"]),text:z.string()}).optional()});
type Event=z.infer<typeof eventSchema>;
type Row={recipientKey:string;version:number;operationId:string;inquiryId:string;ownerAccountId:string;actorAccountId:string|null;
 source:"owner"|"recipient";programKey:BnaPreferenceContext["program"]|null;requestDigest:string;ciphertext:string;recordedAt:Date};
const columns=`recipient_key AS "recipientKey",version,operation_id AS "operationId",inquiry_id AS "inquiryId",owner_account_id AS "ownerAccountId",
 actor_account_id AS "actorAccountId",source,program_key AS "programKey",request_digest AS "requestDigest",payload_ciphertext AS ciphertext,recorded_at AS "recordedAt"`;
const globalActions=new Set(["pause_all","resume_all","withdraw_all","unsubscribe_all","record_invalid","resolve_invalid","record_complaint","resolve_complaint"]);
const DAY=86_400_000;

/** Shares only the canonical adult email key, never merges People/programs.
 * Service B0/S0 delivery and Fishing WhatsApp consent are independent. */
export class BnaPreferenceStore{
 constructor(private readonly db:IdentityStore,private readonly workspace:WorkspaceId,private readonly ownerAccountId:string,
  private readonly ring:Keyring,private readonly key:string,private readonly clock:IdentityClock,
  private readonly inquiries:Pick<BnaInquiryStore,"communicationContext">,
  private readonly replyReviews?:{pendingInTransaction(tx:SqlSession,recipientKey:string,program:BnaPreferenceContext['program']):Promise<boolean>}){}
 private aad(operation:string){return `ls_service_interest/bna-email-preference/v1/${this.workspace}/${operation}`;}
 private tokenAad(){return `ls_service_interest/bna-email-preference-capability/v1/${this.workspace}/${this.ownerAccountId}`;}
 private digest(recipientKey:string,event:Event,actor:string|null){return privateDigest({domain:"bna-email-preference-event/v1",workspace:this.workspace,recipientKey,actor,event},this.key);}
 private async owner(tx:SqlSession,actor:Actor){
  if(actor.workspaceId!==this.workspace||actor.id!==this.ownerAccountId)throw new AppError("NOT_FOUND");
  const current=await freshActor(tx,actor,this.clock.now());
  if(current.id!==this.ownerAccountId||current.state!=="active"||current.role!=="practitioner")throw new AppError("NOT_FOUND");
 }
 private async context(tx:SqlSession,id:string){
  const context=await this.inquiries.communicationContext(tx,id);
  if(context.originalPermissionAt&&(!Number.isFinite(Date.parse(context.originalPermissionAt))||Date.parse(context.originalPermissionAt)>this.clock.now().getTime()))throw new AppError("UNAVAILABLE");
  return {...context,recipientKey:bnaEmailRecipientKey(this.workspace,context.recipient,this.key)};
 }
 private decode(row:Row){try{
  const event=eventSchema.parse(JSON.parse(unseal(row.ciphertext,this.aad(row.operationId),this.ring)));
  const ownerCommand=bnaOwnerPreferenceCommand.safeParse(event.command);
  const recipientCommand=bnaRecipientPreferenceCommand.safeParse(event.command);
  if(row.ownerAccountId!==this.ownerAccountId||event.source!==row.source||event.programKey!==row.programKey||event.command.operationId!==row.operationId||event.command.inquiryId!==row.inquiryId||
   event.command.expectedVersion!==row.version-1||event.recordedAt!==row.recordedAt.toISOString()||this.digest(row.recipientKey,event,row.actorAccountId)!==row.requestDigest||
   (event.source==="owner"?(!ownerCommand.success||row.actorAccountId!==this.ownerAccountId):(!recipientCommand.success||row.actorAccountId!==null))||
   (globalActions.has(event.command.action)?row.programKey!==null:row.programKey===null))throw Error();
  if(event.command.action==="set_preferences"){
   const c=event.command;if(!event.notice||event.notice.version!==c.noticeVersion||event.notice.language!==c.noticeLanguage||event.notice.text!==BNA_PREFERENCE_NOTICE[c.noticeLanguage])throw Error();
  }else if(event.notice)throw Error();
  return event;
 }catch{throw new AppError("UNAVAILABLE");}}
 private async rows(tx:SqlSession,recipientKey:string){
  const rows=await tx.query<Row>(`SELECT ${columns} FROM ls_service_interest.bna_email_preference_events WHERE workspace_id=$1 AND recipient_key=$2 ORDER BY version LIMIT 10001`,[this.workspace,recipientKey]);
  if(rows.length>10000)throw new AppError("UNAVAILABLE");
  rows.forEach((row,i)=>{if(row.version!==i+1||row.recordedAt>this.clock.now()||i>0&&rows[i-1]!.recordedAt>row.recordedAt)throw new AppError("UNAVAILABLE");});
  return rows.map(row=>({row,event:this.decode(row)}));
 }
 private snapshot(context:BnaPreferenceContext,rows:Awaited<ReturnType<BnaPreferenceStore["rows"]>>):BnaPreferenceSnapshot{
  let permissionGrantedAt=context.originalPermissionAt,locale=context.locale,globalWithdraw=0,grant=0,withdraw=false;
  let globalPaused=false,localPaused=false,replyPending=false,invalidRecipient=false,complaint=false;
  for(const {row,event} of rows){const action=event.command.action;
   if(row.programKey!==null&&row.programKey!==context.program)continue;
   if(action==="withdraw_all"||action==="unsubscribe_all")globalWithdraw=row.version;
   else if(action==="pause_all")globalPaused=true;else if(action==="resume_all")globalPaused=false;
   else if(action==="record_invalid")invalidRecipient=true;else if(action==="resolve_invalid")invalidRecipient=false;
   else if(action==="record_complaint")complaint=true;else if(action==="resolve_complaint")complaint=false;
   else if(action==="pause_relationship")localPaused=true;else if(action==="resume_relationship")localPaused=false;
   else if(action==="record_reply")replyPending=true;else if(action==="triage_reply")replyPending=false;
   else if(action==="withdraw_relationship")withdraw=true;
   else if(action==="set_preferences"){
    locale=event.command.locale;
    if(event.command.updates){
     // Changing language while already subscribed must not restart a sequence.
     if(!permissionGrantedAt||withdraw||globalWithdraw>grant)permissionGrantedAt=event.recordedAt;
     grant=row.version;withdraw=false;
    }else withdraw=true;
   }
  }
  return {version:rows.at(-1)?.row.version??0,program:context.program,locale,permissionGrantedAt,
   withdrawn:withdraw||globalWithdraw>grant,paused:globalPaused||localPaused,replyPending,invalidRecipient,complaint};
 }
 private async withReplyReviews(tx:SqlSession,context:BnaPreferenceContext&{recipientKey:string},rows:Awaited<ReturnType<BnaPreferenceStore['rows']>>){
  const snapshot=this.snapshot(context,rows);if(this.replyReviews&&await this.replyReviews.pendingInTransaction(tx,context.recipientKey,context.program))snapshot.replyPending=true;return snapshot;
 }
 async readOwner(actor:Actor,inquiryId:string){return this.db.transaction(async tx=>{
  await tx.query("SET TRANSACTION READ ONLY");await this.owner(tx,actor);const context=await this.context(tx,inquiryId),rows=await this.rows(tx,context.recipientKey);
  return {preferences:await this.withReplyReviews(tx,context,rows),history:rows.slice(-100).reverse().map(({row,event})=>({version:row.version,operationId:row.operationId,
   scope:row.programKey??"all_bna_email",source:row.source,action:event.command.action,recordedAt:event.recordedAt,
   note:"note" in event.command?event.command.note:null})),hasMoreHistory:rows.length>100};
 });}
 /** Server-internal, within the calendar's existing transaction and workspace
  * lock. The caller authorizes the owner/worker; no browser supplies these facts. */
 async readForCalendar(tx:SqlSession,inquiryId:string){
  const context=await this.context(tx,inquiryId);
  return {context,preferences:await this.withReplyReviews(tx,context,await this.rows(tx,context.recipientKey))};
 }
 async capabilityForCalendar(tx:SqlSession,inquiryId:string){
  const context=await this.context(tx,inquiryId),now=this.clock.now();
  const payload=bnaPreferenceCapability.parse({version:1,workspaceId:this.workspace,ownerAccountId:this.ownerAccountId,inquiryId,
   recipientKey:context.recipientKey,program:context.program,issuedAt:now.toISOString(),expiresAt:new Date(now.getTime()+30*DAY).toISOString()});
  return Buffer.from(seal(JSON.stringify(payload),this.tokenAad(),this.ring)).toString("base64url");
 }
 /** Capability lives in the URL fragment, never a query/path, and exposes no
  * name, address, child field, note or other program's history. GET never writes.
  * Granting permission expires after30days; withdrawal stays usable afterward. */
 async issueCapability(actor:Actor,inquiryId:string){return this.db.transaction(async tx=>{
  await tx.query("SET TRANSACTION READ ONLY");await this.owner(tx,actor);const context=await this.context(tx,inquiryId),now=this.clock.now();
  const payload=bnaPreferenceCapability.parse({version:1,workspaceId:this.workspace,ownerAccountId:this.ownerAccountId,inquiryId,
   recipientKey:context.recipientKey,program:context.program,issuedAt:now.toISOString(),expiresAt:new Date(now.getTime()+30*DAY).toISOString()});
  return {token:Buffer.from(seal(JSON.stringify(payload),this.tokenAad(),this.ring)).toString("base64url"),expiresAt:payload.expiresAt};
 });}
 private capability(token:string){try{
  bnaPreferenceToken.parse(token);const bytes=Buffer.from(token,"base64url");if(bytes.toString("base64url")!==token)throw Error();
  const payload=bnaPreferenceCapability.parse(JSON.parse(unseal(bytes.toString("utf8"),this.tokenAad(),this.ring))),now=this.clock.now().getTime();
  if(payload.workspaceId!==this.workspace||payload.ownerAccountId!==this.ownerAccountId||Date.parse(payload.issuedAt)>now||
   Date.parse(payload.expiresAt)-Date.parse(payload.issuedAt)!==30*DAY)throw Error();return payload;
 }catch{throw new AppError("NOT_FOUND");}}
 private async recipientContext(tx:SqlSession,token:string){const cap=this.capability(token),context=await this.context(tx,cap.inquiryId);
  if(context.recipientKey!==cap.recipientKey||context.program!==cap.program)throw new AppError("NOT_FOUND");return context;}
 async readRecipient(token:string){return this.db.transaction(async tx=>{await tx.query("SET TRANSACTION READ ONLY");
  const context=await this.recipientContext(tx,token),snapshot=await this.withReplyReviews(tx,context,await this.rows(tx,context.recipientKey));
  return {inquiryId:context.inquiryId,preferences:recipientBnaPreferences(snapshot),notice:BNA_PREFERENCE_NOTICE,
   canSubscribe:Date.parse(this.capability(token).expiresAt)>this.clock.now().getTime()};
 });}
 private async append(tx:SqlSession,context:Awaited<ReturnType<BnaPreferenceStore["context"]>>,command:BnaOwnerPreferenceCommand|BnaRecipientPreferenceCommand,source:"owner"|"recipient",canGrant=true){
  const actor=source==="owner"?this.ownerAccountId:null;
  const prior=await tx.query<Row>(`SELECT ${columns} FROM ls_service_interest.bna_email_preference_events WHERE workspace_id=$1 AND operation_id=$2`,[this.workspace,command.operationId]);
  if(prior.length){const row=prior[0]!,event=this.decode(row);
   if(row.recipientKey!==context.recipientKey||row.actorAccountId!==actor||event.source!==source||JSON.stringify(event.command)!==JSON.stringify(command))throw new AppError("CONFLICT");
   return {preferences:await this.withReplyReviews(tx,context,await this.rows(tx,context.recipientKey)),replayed:true};
  }
  if(command.action==="set_preferences"&&command.updates&&!canGrant)throw new AppError("FORBIDDEN");
  const rows=await this.rows(tx,context.recipientKey),version=rows.at(-1)?.row.version??0;
  if(command.expectedVersion!==version)throw new AppError("CONFLICT");
  const programKey=globalActions.has(command.action)?null:context.program;
  const now=this.clock.now(),event:Event={version:1,source,programKey,command,recordedAt:now.toISOString(),...(command.action==="set_preferences"?
   {notice:{version:BNA_PREFERENCE_NOTICE.version,language:command.noticeLanguage,text:BNA_PREFERENCE_NOTICE[command.noticeLanguage]}}:{})};
  await tx.query(`INSERT INTO ls_service_interest.bna_email_preference_events(workspace_id,recipient_key,version,operation_id,inquiry_id,owner_account_id,
   actor_account_id,source,program_key,request_digest,payload_ciphertext,recorded_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
   [this.workspace,context.recipientKey,version+1,command.operationId,context.inquiryId,this.ownerAccountId,actor,source,programKey,
    this.digest(context.recipientKey,event,actor),seal(JSON.stringify(event),this.aad(command.operationId),this.ring),now]);
  return {preferences:await this.withReplyReviews(tx,context,await this.rows(tx,context.recipientKey)),replayed:false};
 }
 async updateOwner(actor:Actor,input:BnaOwnerPreferenceCommand){const command=bnaOwnerPreferenceCommand.parse(input);
  return this.db.transaction(async tx=>{await lockWorkspace(tx,this.workspace);await this.owner(tx,actor);
   return this.append(tx,await this.context(tx,command.inquiryId),command,"owner");});}
 async updateRecipient(token:string,input:BnaRecipientPreferenceCommand){const command=bnaRecipientPreferenceCommand.parse(input);
  return this.db.transaction(async tx=>{await lockWorkspace(tx,this.workspace);const context=await this.recipientContext(tx,token);
   if(context.inquiryId!==command.inquiryId)throw new AppError("NOT_FOUND");
   return this.append(tx,context,command,"recipient",Date.parse(this.capability(token).expiresAt)>this.clock.now().getTime());});}
}
