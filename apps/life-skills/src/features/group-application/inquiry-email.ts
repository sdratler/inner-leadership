import "server-only";
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
import {createAuthEmailTransport} from "../../providers/email/gmail.ts";
import {groupApplicationFieldsSchema,isFloridaGroupApplication,isSchoolInquiry,type GroupApplicationFields} from "./contract.ts";
import {INQUIRY_EMAIL_FROM,INQUIRY_EMAIL_PURPOSE,inquiryEmailContent} from "./inquiry-email-copy.ts";

const payloadSchema=z.object({purpose:z.literal(INQUIRY_EMAIL_PURPOSE),reference:z.string().uuid(),recipient:z.email().max(254),locale:z.enum(["en","he"])}).strict();
const aad=(workspace:string,id:string)=>`ls_service_interest/inquiry_email/v1/${workspace}/${id}`;
export function inquiryEmailQueueEnabled(env:Record<string,string|undefined>){return env.LS_INQUIRY_EMAIL_QUEUE_ENABLED==="true";}
export function createInquiryEmailTransport(env:Record<string,string|undefined>,sendFetch:typeof fetch=fetch){
 if(env.LS_INQUIRY_EMAIL_SEND_ENABLED!=="true"||env.LS_AUTH_EMAIL_PROVIDER!=="gmail"||env.LS_AUTH_EMAIL_FROM!==INQUIRY_EMAIL_FROM)throw new AppError("UNAVAILABLE");
 return createAuthEmailTransport(env,sendFetch);
}
function intendedPayload(reference:string,fields:GroupApplicationFields){
 if(!isFloridaGroupApplication(fields)||fields.programId!=="sunday_fishing_academy")return null;
 // Only a supplied, validated confirmation address may override an email
 // contact. Phone-only remains valid; never infer an address from a number.
 const supplied=!isSchoolInquiry(fields)?fields.academyIntake?.confirmationEmail:undefined;
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
/** Private worker capability. Caller supplies the separately permitted transport; never called by public HTTP. */
export class InquiryEmailOutbox{
 constructor(private readonly db:IdentityStore,private readonly workspace:WorkspaceId,private readonly ring:Keyring,private readonly clock:IdentityClock){}
 async dispatchForApplication(reference:string,transport:AuthEmailTransport,from:string){
  if(!z.string().uuid().safeParse(reference).success)throw new AppError("INVALID_REQUEST");
  const lookup=()=>this.db.transaction(tx=>one<{id:string;state:Row["state"]}>(tx,"SELECT id,state FROM ls_service_interest.inquiry_email_outbox WHERE workspace_id=$1 AND application_id=$2",[this.workspace,reference]));
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
   const expected=intendedPayload(row.applicationId,fields);
   if(!expected||row.purpose!==INQUIRY_EMAIL_PURPOSE||JSON.stringify(payload)!==JSON.stringify(expected))throw new AppError("UNAVAILABLE");
   // Commit UNKNOWN before network. A crash or ambiguous provider result cannot be retried automatically.
   await tx.query("UPDATE ls_service_interest.inquiry_email_outbox SET state='unknown',reserved_at=$3 WHERE workspace_id=$1 AND id=$2",[this.workspace,id,this.clock.now()]);
   return {...inquiryEmailContent(payload.reference,payload.locale),to:payload.recipient};
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
