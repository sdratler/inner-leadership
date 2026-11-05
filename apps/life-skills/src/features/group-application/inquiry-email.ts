import "server-only";
import {loadSignupPopulation} from "./academy-signup-population-runtime.ts";
import {assertSignupWorkerAdmission,signupRecipientDigest,SignupEmailNotAttemptedError,type SignupWorkerAdmission} from "./academy-signup-worker-admission.ts";
import {randomUUID} from "node:crypto";
import {z} from "zod";
import {AppError} from "../../lib/errors.ts";
import type {WorkspaceId} from "../../lib/ids.ts";
import {seal,unseal,type Keyring} from "../identity/crypto.ts";
import {freshActor,lockWorkspace} from "../identity/data.ts";
import {requirePractitioner} from "../cases/policy.ts";
import type {Actor,IdentityClock} from "../identity/types.ts";
import {one,type IdentityStore,type SqlSession} from "../identity/store.ts";
import type {AuthEmailTransport} from "../../providers/email/transport.ts";
import {GmailAuthTransport,parseGmailAuthConfig} from "../../providers/email/gmail.ts";
import {groupApplicationFieldsSchema,isFloridaGroupApplication,isSchoolInquiry,isTrip390Interest,type GroupApplicationFields} from "./contract.ts";
import {INQUIRY_EMAIL_FROM,INQUIRY_EMAIL_PURPOSE,inquiryEmailContent} from "./inquiry-email-copy.ts";

import {decodeStoredGroupApplication,type StoredGroupApplicationRow} from './group-application-record.ts';
import {isCurrentTrip390Interest} from './academy-trip390-contract.ts';
import {academy650AckContent,ACADEMY650_ACK_COPY_VERSION,ACADEMY650_ACK_OFFER_VERSION} from './academy650-r2-ack.ts';
import {trip390EmailContent,TRIP390_EMAIL_VERSION} from './academy-trip390-email.ts';
import {ACADEMY650_ACK_FORM,TRIP390_ACK_FORM,assertTrip390AckAdmission,loadTrip390AckAdmission,trip390AckRequestAllowed,type Trip390AckAdmission,type Trip390AckFacts} from './academy-trip390-ack-admission.ts';
const legacyPayloadSchema=z.object({purpose:z.literal(INQUIRY_EMAIL_PURPOSE),reference:z.string().uuid(),recipient:z.email().max(254),locale:z.enum(["en","he"])}).strict();
const tripPayloadSchema=z.object({version:z.literal(2),purpose:z.literal(INQUIRY_EMAIL_PURPOSE),reference:z.string().uuid(),recipient:z.email().max(254),locale:z.enum(['en','he']),copyVersion:z.literal(TRIP390_EMAIL_VERSION),contentSha256:z.string().regex(/^[a-f0-9]{64}$/),subject:z.string().min(1).max(300),text:z.string().min(1).max(12000),html:z.string().min(1).max(24000)}).strict();
const r2PayloadSchema=tripPayloadSchema.extend({
 version:z.literal(3),requestVersion:z.literal(ACADEMY650_ACK_FORM),offerVersion:z.literal(ACADEMY650_ACK_OFFER_VERSION),
 copyVersion:z.literal(ACADEMY650_ACK_COPY_VERSION),childIds:z.array(z.string().uuid()).min(1).max(10).refine(ids=>new Set(ids).size===ids.length),
});
const scopedPayloadSchema=z.discriminatedUnion('version',[tripPayloadSchema,r2PayloadSchema]);
const payloadSchema=z.union([legacyPayloadSchema,scopedPayloadSchema]);
const aad=(workspace:string,id:string)=>`ls_service_interest/inquiry_email/v1/${workspace}/${id}`;
export function inquiryEmailQueueEnabled(env:Record<string,string|undefined>){return env.LS_INQUIRY_EMAIL_QUEUE_ENABLED==="true";}
export function createInquiryEmailTransport(env:Record<string,string|undefined>,sendFetch:typeof fetch=fetch,signup?:{policy:SignupWorkerAdmission;now:()=>Date}){
 const controlled=signup?.policy.population.mode==='controlled_test';
 if(env.LS_ACADEMY_SIGNUP_CONTROLLED_SEND_ENABLED==='true'&&!controlled)throw new AppError("UNAVAILABLE");
 const requireSignup=()=>{
  if(!signup||env.LS_INQUIRY_EMAIL_QUEUE_ENABLED!=='true')throw new SignupEmailNotAttemptedError();
  try{assertSignupWorkerAdmission(signup.policy,env.LS_IDENTITY_WORKSPACE_ID??'',signup.now());}catch{throw new SignupEmailNotAttemptedError();}
  const p=signup.policy,current=loadSignupPopulation(env,signup.now());
  if(!current||JSON.stringify(current)!==JSON.stringify(p))throw new SignupEmailNotAttemptedError();
  // loadSignupPopulation rechecks each mode's exact broad or isolated flags,
  // source bytes, current expiry and target binding. No policy grants generic mail.
  if(controlled&&(env.LS_ACADEMY_SIGNUP_CONTROLLED_SEND_ENABLED!=='true'||env.LS_INQUIRY_EMAIL_SEND_ENABLED==='true'||env.LS_ACADEMY_FOUNDER_EMAIL_APPROVED==='true'))throw new SignupEmailNotAttemptedError();
 };
 if(signup)requireSignup();
 else if(env.LS_INQUIRY_EMAIL_SEND_ENABLED!=="true")throw new AppError("UNAVAILABLE");
 if(env.LS_AUTH_EMAIL_PROVIDER!=="gmail"||env.LS_AUTH_EMAIL_FROM!==INQUIRY_EMAIL_FROM)throw new AppError("UNAVAILABLE");
 const beforeMessageSend=(message:Parameters<AuthEmailTransport['send']>[0])=>{
  requireSignup();const p=signup!.policy,digest=signupRecipientDigest(message.to);
  if(message.from!==p.sender||p.population.mode==='controlled_test'&&digest!==p.population.recipientSha256||p.population.mode==='references'&&!p.population.families.some(f=>f.recipientSha256===digest))throw new SignupEmailNotAttemptedError();
 };
 const config=parseGmailAuthConfig(env),adapter=new GmailAuthTransport(config,sendFetch,"JLFA Office",signup?beforeMessageSend:undefined);
 const transport:AuthEmailTransport=signup?{nonIdempotent:true,send:message=>{
  requireSignup();const p=signup!.policy,digest=signupRecipientDigest(message.to);
  if(message.from!==p.sender||p.population.mode==='controlled_test'&&digest!==p.population.recipientSha256||p.population.mode==='references'&&!p.population.families.some(f=>f.recipientSha256===digest))throw new SignupEmailNotAttemptedError();
  return adapter.send(message);
 }}:adapter;
 return {transport,from:config.from};
}
// One display token, never used as identity. An ambiguous salutation uses the packet fallback.
function receiptGreetingName(display:string):string|null{
 const parts=display.trim().split(/\s+/u);
 const first=parts[0];
 if(!first||!/^\p{L}[\p{L}\p{M}'’\-]*$/u.test(first)||/^(?:mr|mrs|ms|dr|rabbi|family|household|משפחת|הרב|דוקטור)$/iu.test(first))return null;
 return first;
}
function intendedPayload(reference:string,fields:GroupApplicationFields,verifyHistorical=false){
 if(isTrip390Interest(fields)){
  if(isCurrentTrip390Interest(fields)&&fields.version===ACADEMY650_ACK_FORM&&fields.offerVersion===ACADEMY650_ACK_OFFER_VERSION){
   const content=academy650AckContent({reference,parentFirstName:receiptGreetingName(fields.guardianName),
    children:fields.children.map(({id,name})=>({id,name})),messageLanguage:fields.messageLanguage});
   return r2PayloadSchema.parse({version:3,purpose:INQUIRY_EMAIL_PURPOSE,reference,recipient:fields.email,locale:fields.messageLanguage,
    requestVersion:fields.version,offerVersion:fields.offerVersion,copyVersion:content.version,childIds:fields.children.map(c=>c.id),
    contentSha256:content.contentSha256,subject:content.subject,text:content.text,html:content.html});
  }
  // Verify already sealed V2 bytes only. New saves and all operation replays cannot issue a historical intent.
  if(!verifyHistorical||fields.version!==TRIP390_ACK_FORM)return null;
  const content=trip390EmailContent({version:TRIP390_EMAIL_VERSION,kind:'ack',reference,parentName:fields.guardianName,children:fields.children.map(({id,name})=>({id,name})),messageLanguage:fields.messageLanguage});
  return tripPayloadSchema.parse({version:2,purpose:INQUIRY_EMAIL_PURPOSE,reference,recipient:fields.email,locale:fields.messageLanguage,copyVersion:content.version,contentSha256:content.contentSha256,subject:content.subject,text:content.text,html:content.html});
 }
 if(!isFloridaGroupApplication(fields)||fields.programId!=="sunday_fishing_academy")return null;
 // Only a supplied, validated confirmation address may override an email
 // contact. Phone-only remains valid; never infer an address from a number.
 const supplied=!isSchoolInquiry(fields)?(fields.academyRegistration?.receiptEmail??fields.academyIntake?.confirmationEmail):undefined;
 const recipient=supplied??fields.contact;
 if(!z.email().max(254).safeParse(recipient).success){if(supplied!==undefined)throw new AppError("INVALID_REQUEST");return null;}
 return payloadSchema.parse({purpose:INQUIRY_EMAIL_PURPOSE,reference,recipient,locale:fields.language});
}
/** Same transaction as the native inquiry and operation receipt. No network. */
export async function queueInquiryEmail(tx:SqlSession,workspace:WorkspaceId,reference:string,fields:GroupApplicationFields,ring:Keyring,now:Date){
 const payload=intendedPayload(reference,fields);if(!payload)return "not_requested" as const;
 const id=randomUUID();
 await tx.query(`INSERT INTO ls_service_interest.inquiry_email_outbox(workspace_id,id,application_id,purpose,payload_ciphertext,created_at)
  VALUES($1,$2,$3,$4,$5,$6)`,[workspace,id,reference,INQUIRY_EMAIL_PURPOSE,seal(JSON.stringify(payload),aad(workspace,id),ring),now]);
 return "queued" as const;
}
type Row={id:string;applicationId:string;purpose:string;ciphertext:string;state:"queued"|"unknown"|"sent"|"canceled"};
export type Trip390AckCursor={createdAt:string;id:string};
type TripRow=Row&{createdAt:Date;reservedAt:Date|null;founderId:string|null};
/** Private worker capability. Caller supplies the separately permitted transport; never called by public HTTP. */
export class InquiryEmailOutbox{
 constructor(private readonly db:IdentityStore,private readonly workspace:WorkspaceId,private readonly ring:Keyring,private readonly clock:IdentityClock,private readonly digestKey?:string){}
 private freshTripPolicy(policy:Trip390AckAdmission,env:Readonly<Record<string,string|undefined>>){
  if(!this.digestKey||this.digestKey.length<32)throw new AppError('UNAVAILABLE');
  assertTrip390AckAdmission(policy,this.workspace,this.clock.now());
  const current=loadTrip390AckAdmission(env,this.clock.now());
  if(!current||JSON.stringify(current)!==JSON.stringify(policy))throw new SignupEmailNotAttemptedError();
 }
 private async tripTarget(tx:SqlSession,id:string,policy:Trip390AckAdmission){
  const row=await one<TripRow>(tx,`SELECT id,application_id AS "applicationId",purpose,payload_ciphertext AS ciphertext,state,
   created_at AS "createdAt",reserved_at AS "reservedAt",founder_id AS "founderId" FROM ls_service_interest.inquiry_email_outbox WHERE workspace_id=$1 AND id=$2 FOR UPDATE`,[this.workspace,id]);
  if(!row||row.founderId!==null||row.purpose!==INQUIRY_EMAIL_PURPOSE)return null;
  const payload=scopedPayloadSchema.safeParse(JSON.parse(unseal(row.ciphertext,aad(this.workspace,id),this.ring)));
  if(!payload.success)return null;
  const application=await one<StoredGroupApplicationRow>(tx,`SELECT id,request_digest AS "requestDigest",payload_ciphertext AS "payloadCiphertext",received_at AS "receivedAt" FROM ls_service_interest.public_applications WHERE workspace_id=$1 AND id=$2`,[this.workspace,row.applicationId]);
  if(!application||application.id!==row.applicationId||!this.digestKey)return null;
  // Same canonical AEAD + keyed request integrity as the ordinary owner read.
  // Invalid stored data is held, never converted to provider authority.
  const decoded=decodeStoredGroupApplication(this.workspace,application,this.ring,this.digestKey);
  const fields=decoded.fields;
  if(!isTrip390Interest(fields)||(fields.version!==TRIP390_ACK_FORM&&fields.version!==ACADEMY650_ACK_FORM))return null;
  if(fields.version!==policy.requestVersion||payload.data.version!==policy.payloadVersion||payload.data.copyVersion!==policy.templateVersion)return null;
  const expected=intendedPayload(row.applicationId,fields,true);
  if(!expected||JSON.stringify(payload.data)!==JSON.stringify(expected))return null;
  const operations=await tx.query<{operationId:string;requestDigest:string}>('SELECT operation_id AS "operationId",request_digest AS "requestDigest" FROM ls_service_interest.public_application_operations WHERE workspace_id=$1 AND application_id=$2 ORDER BY operation_id LIMIT 101',[this.workspace,row.applicationId]);
  if(operations.length>100||operations.some(operation=>operation.requestDigest!==application.requestDigest))return null;
  const facts:Trip390AckFacts={reference:row.applicationId,outboxId:id,operationIds:operations.map(r=>r.operationId),savedAt:application.receivedAt.toISOString(),queuedAt:row.createdAt.toISOString(),version:fields.version,offerVersion:fields.offerVersion,noticeVersion:fields.acknowledgment.version,privacy:fields.acknowledgment.interestPrivacySafety,conduct:fields.acknowledgment.conductExplained,recipient:fields.email,messageLanguage:fields.messageLanguage,childIds:fields.children.map(c=>c.id),contentSha256:payload.data.contentSha256};
  if(!trip390AckRequestAllowed(policy,facts,this.clock.now()))return null;
  return {row,payload:payload.data};
 }
 /** Source policy and exact immutable payload are rechecked under lock before
  * reservation and AFTER OAuth. UNKNOWN never becomes an automatic retry. */
 async dispatchTrip390One(id:string,policy:Trip390AckAdmission,env:Readonly<Record<string,string|undefined>>,sendFetch:typeof fetch=fetch){
  if(!z.string().uuid().safeParse(id).success)throw new AppError('INVALID_REQUEST');
  this.freshTripPolicy(policy,env);const config=parseGmailAuthConfig(env);
  const prepared=await this.db.transaction(async tx=>{
   await lockWorkspace(tx,this.workspace);this.freshTripPolicy(policy,env);
   const target=await this.tripTarget(tx,id,policy);if(!target||target.row.state!=='queued')return null;
   this.freshTripPolicy(policy,env);const reservedAt=this.clock.now();
   const changed=await tx.query("UPDATE ls_service_interest.inquiry_email_outbox SET state='unknown',reserved_at=$3 WHERE workspace_id=$1 AND id=$2 AND state='queued' RETURNING id",[this.workspace,id,reservedAt]);
   if(changed.length!==1)return null;
   return {payload:target.payload,reservedAt};
  });
  if(!prepared)return 'idle' as const;
  try{
   // This callback is handed directly to Gmail: OAuth completes first, then
   // scope/readback and expiry, then Gmail starts messages/send with no wait.
   const beforeSend=async(message:Parameters<AuthEmailTransport['send']>[0])=>{
    this.freshTripPolicy(policy,env);
    const okay=await this.db.transaction(async tx=>{
     await lockWorkspace(tx,this.workspace);const target=await this.tripTarget(tx,id,policy);
     return !!target&&target.row.state==='unknown'&&target.row.reservedAt?.valueOf()===prepared.reservedAt.valueOf()&&JSON.stringify(target.payload)===JSON.stringify(prepared.payload);
    }).catch(()=>false); // This callback runs before message HTTP; validation failure is known not attempted.
    if(!okay||message.from!==policy.sender||message.to!==prepared.payload.recipient||message.subject!==prepared.payload.subject||message.text!==prepared.payload.text||message.html!==prepared.payload.html||message.idempotencyKey!==`ls-auth-${id}`)throw new SignupEmailNotAttemptedError();
    this.freshTripPolicy(policy,env);
   };
   this.freshTripPolicy(policy,env);
   const transport=new GmailAuthTransport(config,sendFetch,'JLFA Office',beforeSend);
   const receipt=await transport.send({from:policy.sender,to:prepared.payload.recipient,subject:prepared.payload.subject,text:prepared.payload.text,html:prepared.payload.html,idempotencyKey:`ls-auth-${id}`});
   if(!/^[A-Za-z0-9_-]{1,256}$/.test(receipt.providerId))return 'unknown' as const;
   // Real late provider receipts are retained even if admission just expired.
   const saved=await this.db.transaction(async tx=>{await lockWorkspace(tx,this.workspace);return tx.query("UPDATE ls_service_interest.inquiry_email_outbox SET state='sent',provider_id=$3,completed_at=$4 WHERE workspace_id=$1 AND id=$2 AND state='unknown' AND reserved_at=$5 RETURNING id",[this.workspace,id,receipt.providerId,this.clock.now(),prepared.reservedAt]);});
   return saved.length===1?'sent' as const:'unknown' as const;
  }catch(error){
   if(error instanceof SignupEmailNotAttemptedError){
    const restored=await this.db.transaction(async tx=>{await lockWorkspace(tx,this.workspace);return tx.query("UPDATE ls_service_interest.inquiry_email_outbox SET state='queued',reserved_at=NULL WHERE workspace_id=$1 AND id=$2 AND state='unknown' AND reserved_at=$3 AND completed_at IS NULL AND provider_id IS NULL RETURNING id",[this.workspace,id,prepared.reservedAt]);});
    return restored.length===1?'queued' as const:'unknown' as const;
   }
   return 'unknown' as const;
  }
 }
 async dispatchTrip390ForApplication(reference:string,policy:Trip390AckAdmission,env:Readonly<Record<string,string|undefined>>){
  this.freshTripPolicy(policy,env);if(!z.string().uuid().safeParse(reference).success)throw new AppError('INVALID_REQUEST');
  const row=await this.db.transaction(tx=>one<{id:string;state:Row['state']}>(tx,'SELECT id,state FROM ls_service_interest.inquiry_email_outbox WHERE workspace_id=$1 AND application_id=$2 AND purpose=$3 AND founder_id IS NULL',[this.workspace,reference,INQUIRY_EMAIL_PURPOSE]));
  if(!row)return 'not_requested' as const;if(row.state!=='queued')return row.state;
  const result=await this.dispatchTrip390One(row.id,policy,env);return result==='idle'?'queued' as const:result;
 }
 async dispatchTrip390Page(policy:Trip390AckAdmission,env:Readonly<Record<string,string|undefined>>,cursor?:Trip390AckCursor){
  this.freshTripPolicy(policy,env);
  if(cursor&&!z.object({createdAt:z.string().min(1).max(80),id:z.string().uuid()}).strict().safeParse(cursor).success)throw new AppError('INVALID_REQUEST');
  const refs=policy.population.mode==='controlled_test'?policy.population.requests.map(r=>r.reference):null;
  const rows=await this.db.transaction(tx=>tx.query<{id:string;createdAt:string}>(`SELECT o.id,o.created_at::text AS "createdAt" FROM ls_service_interest.inquiry_email_outbox o
   JOIN ls_service_interest.public_applications a ON a.workspace_id=o.workspace_id AND a.id=o.application_id
   WHERE o.workspace_id=$1 AND o.purpose=$2 AND o.founder_id IS NULL AND o.state='queued' AND a.notice_version=$3 AND a.received_at>=$4
   AND ($5::uuid[] IS NULL OR a.id=ANY($5::uuid[])) AND ($6::timestamptz IS NULL OR (o.created_at,o.id)>($6::timestamptz,$7::uuid))
   ORDER BY o.created_at,o.id LIMIT 50`,[this.workspace,INQUIRY_EMAIL_PURPOSE,policy.noticeVersion,policy.notBefore,refs,cursor?.createdAt??null,cursor?.id??null]));
  let processed=0;for(const row of rows){this.freshTripPolicy(policy,env);try{const result=await this.dispatchTrip390One(row.id,policy,env);if(result!=='idle'&&result!=='queued')processed++;}catch{this.freshTripPolicy(policy,env);/* A malformed/held row cannot starve later eligible intents; never mutate it. */}}
  const last=rows.at(-1);return {processed,inspected:rows.length,scanComplete:rows.length<50,continuation:rows.length===50&&last?{createdAt:last.createdAt,id:last.id}:undefined};
 }
 async dispatchForApplication(reference:string,transport:AuthEmailTransport,from:string){
  if(!z.string().uuid().safeParse(reference).success)throw new AppError("INVALID_REQUEST");
  const lookup=()=>this.db.transaction(tx=>one<{id:string;state:Row["state"]}>(tx,"SELECT id,state FROM ls_service_interest.inquiry_email_outbox WHERE workspace_id=$1 AND application_id=$2 AND purpose=$3",[this.workspace,reference,INQUIRY_EMAIL_PURPOSE]));
  const row=await lookup();if(!row)return "not_requested" as const;if(row.state!=="queued")return row.state;
  const outcome=await this.dispatchOne(row.id,transport,from);if(outcome!=="idle")return outcome;
  return (await lookup())?.state??"unknown";
 }
 async dispatchOne(id:string,transport:AuthEmailTransport,from:string){
  if(!z.string().uuid().safeParse(id).success||from!==INQUIRY_EMAIL_FROM)throw new AppError("INVALID_REQUEST");
  const prepared=await this.db.transaction(async tx=>{
   await lockWorkspace(tx,this.workspace);
   const row=await one<Row>(tx,`SELECT id,application_id AS "applicationId",purpose,payload_ciphertext AS ciphertext,state
    FROM ls_service_interest.inquiry_email_outbox WHERE workspace_id=$1 AND id=$2 FOR UPDATE`,[this.workspace,id]);
   if(!row||row.state!=="queued")return null;
   const payload=payloadSchema.parse(JSON.parse(unseal(row.ciphertext,aad(this.workspace,id),this.ring)));
   const application=await one<{ciphertext:string}>(tx,`SELECT payload_ciphertext AS ciphertext FROM ls_service_interest.public_applications WHERE workspace_id=$1 AND id=$2`,[this.workspace,row.applicationId]);
   if(!application)throw new AppError("UNAVAILABLE");
   const fields=groupApplicationFieldsSchema.parse(JSON.parse(unseal(application.ciphertext,`ls_service_interest/public_application/v1/${this.workspace}/${row.applicationId}`,this.ring)));
   // Generic SEND never grants authority for current or historical Trip mail.
   if(isTrip390Interest(fields))throw new AppError("UNAVAILABLE");
   const expected=intendedPayload(row.applicationId,fields);
   if(!expected||row.purpose!==INQUIRY_EMAIL_PURPOSE||JSON.stringify(payload)!==JSON.stringify(expected))throw new AppError("UNAVAILABLE");
   // Commit UNKNOWN before network. A crash or ambiguous provider result cannot be retried automatically.
   await tx.query("UPDATE ls_service_interest.inquiry_email_outbox SET state='unknown',reserved_at=$3 WHERE workspace_id=$1 AND id=$2",[this.workspace,id,this.clock.now()]);
   return {...('version' in payload?{subject:payload.subject,text:payload.text,html:payload.html}:inquiryEmailContent(payload.reference,payload.locale)),to:payload.recipient};
  });
  if(!prepared)return "idle" as const;
  try{
   // Existing Office Gmail transport namespace; the globally unique outbox ID is stable across reconciliation.
   const receipt=await transport.send({from,...prepared,idempotencyKey:`ls-auth-${id}`});
   if(!/^[A-Za-z0-9_-]{1,256}$/.test(receipt.providerId))return "unknown" as const;
   const recorded=await this.db.transaction(async tx=>{
    await lockWorkspace(tx,this.workspace);
    return tx.query("UPDATE ls_service_interest.inquiry_email_outbox SET state='sent',provider_id=$3,completed_at=$4 WHERE workspace_id=$1 AND id=$2 AND state='unknown' RETURNING id",[this.workspace,id,receipt.providerId,this.clock.now()]);
   });
   return recorded.length===1?"sent" as const:"unknown" as const;
  }catch{return "unknown" as const;}
 }
 /** No resend/reset-to-queued path. A current ordinary practitioner must supply a verified provider reference or cancel. */
 async reconcile(actor:Actor,id:string,outcome:{state:"sent";providerId:string}|{state:"canceled"}){
  if(actor.workspaceId!==this.workspace)throw new AppError("FORBIDDEN");
  if(!z.string().uuid().safeParse(id).success||!outcome||!["sent","canceled"].includes(outcome.state)||outcome.state==="sent"&&!/^[A-Za-z0-9_-]{1,256}$/.test(outcome.providerId))throw new AppError("INVALID_REQUEST");
  return this.db.transaction(async tx=>{
   await lockWorkspace(tx,this.workspace);requirePractitioner(await freshActor(tx,actor,this.clock.now()));
   const row=await one<{state:string}>(tx,"SELECT state FROM ls_service_interest.inquiry_email_outbox WHERE workspace_id=$1 AND id=$2 FOR UPDATE",[this.workspace,id]);
   if(!row)throw new AppError("NOT_FOUND");if(row.state!=="unknown")throw new AppError("CONFLICT");
   await tx.query("UPDATE ls_service_interest.inquiry_email_outbox SET state=$3,provider_id=$4,completed_at=$5,reconciled_by=$6 WHERE workspace_id=$1 AND id=$2",[this.workspace,id,outcome.state,outcome.state==="sent"?outcome.providerId:null,this.clock.now(),actor.id]);
   return outcome.state;
  });
 }
}

/** Mount only after the NEW durable Trip save. Missing/expired admission is
 * inert; the saved lead and queued intent survive callback/transport failures. */
export async function dispatchAdmittedTrip390Acknowledgment(reference:string,runtime:{store:IdentityStore;workspaceId:WorkspaceId;keyring:Keyring;clock:IdentityClock;origin:string;digestKey:string},env:Readonly<Record<string,string|undefined>>){
 const policy=loadTrip390AckAdmission(env,runtime.clock.now());if(!policy||policy.workspaceId!==runtime.workspaceId||policy.origin!==runtime.origin)return undefined;
 return new InquiryEmailOutbox(runtime.store,runtime.workspaceId,runtime.keyring,runtime.clock,runtime.digestKey).dispatchTrip390ForApplication(reference,policy,env);
}
