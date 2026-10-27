import 'server-only';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {AppError} from '../../lib/errors.ts';
import type {WorkspaceId} from '../../lib/ids.ts';
import {seal,unseal,type Keyring} from '../identity/crypto.ts';
import {lockWorkspace} from '../identity/data.ts';
import {one,type IdentityStore,type SqlSession} from '../identity/store.ts';
import type {IdentityClock} from '../identity/types.ts';
import type {AuthEmailTransport} from '../../providers/email/transport.ts';
import {GmailAuthTransport,parseGmailAuthConfig} from '../../providers/email/gmail.ts';
import {groupApplicationFieldsSchema,isFloridaGroupApplication,isSchoolInquiry,type GroupApplicationFields} from './contract.ts';
import {INQUIRY_EMAIL_FROM} from './inquiry-email-copy.ts';

export const ACADEMY_OWNER_NOTIFICATION_PURPOSE='academy_owner_signup_notification' as const;
export const ACADEMY_OWNER_NOTIFICATION_TO='sdratler@gmail.com' as const;
const payloadSchema=z.object({purpose:z.literal(ACADEMY_OWNER_NOTIFICATION_PURPOSE),reference:z.string().uuid(),parentName:z.string().min(1).max(160),receiptEmail:z.email().max(254),parentLanguage:z.enum(['en','he']).nullable(),childCount:z.number().int().min(1).max(12),submittedAt:z.iso.datetime()}).strict();
type Payload=z.infer<typeof payloadSchema>;
const aad=(workspace:string,id:string)=>`ls_service_interest/academy_owner_notification/v1/${workspace}/${id}`;

function intendedPayload(reference:string,fields:GroupApplicationFields,submittedAt:Date):Payload|null{
 if(!isFloridaGroupApplication(fields)||isSchoolInquiry(fields)||fields.programId!=='sunday_fishing_academy'||!fields.academyRegistration)return null;
 const registration=fields.academyRegistration;
 return payloadSchema.parse({purpose:ACADEMY_OWNER_NOTIFICATION_PURPOSE,reference,parentName:fields.parentName,receiptEmail:registration.receiptEmail,parentLanguage:registration.communicationPreferences?.parentLanguage??null,childCount:registration.learners.length,submittedAt:submittedAt.toISOString()});
}

/** Same transaction as the saved application and founder allocation. No network. */
export async function queueAcademyOwnerNotification(tx:SqlSession,workspace:WorkspaceId,reference:string,fields:GroupApplicationFields,ring:Keyring,now:Date){
 const payload=intendedPayload(reference,fields,now);if(!payload)return 'not_requested' as const;
 const id=randomUUID();await tx.query(`INSERT INTO ls_service_interest.inquiry_email_outbox(workspace_id,id,application_id,purpose,message_key,payload_ciphertext,state,created_at)
  VALUES($1,$2,$3,$4,$5,$6,'queued',$7) ON CONFLICT DO NOTHING`,[workspace,id,reference,ACADEMY_OWNER_NOTIFICATION_PURPOSE,`owner-signup:${reference}`,seal(JSON.stringify(payload),aad(workspace,id),ring),now]);
 return 'queued' as const;
}

function content(payload:Payload,ownerOrigin:string){
 const link=new URL('/en/app/group-applications?program=sunday_fishing_academy',ownerOrigin).toString();
 return {subject:'New Fishing Academy registration',text:[
  'A Fishing Academy registration was saved.',
  '',`Parent or guardian: ${payload.parentName}`,`Registration email: ${payload.receiptEmail}`,`Children on this submission: ${payload.childCount}`,`Parent message language: ${payload.parentLanguage??'Not recorded'}`,`Registration reference: ${payload.reference}`,`Saved: ${payload.submittedAt}`,'',`Review in Life Skills: ${link}`,
  'This is an owner notification only. It does not confirm enrollment, payment, a group, or a start date.'
 ].join('\n')};
}

export function createAcademyOwnerNotificationTransport(env:Readonly<Record<string,string|undefined>>,sendFetch:typeof fetch=fetch){
 if(env.LS_ACADEMY_OWNER_NOTIFICATION_ENABLED!=='true'||env.LS_ACADEMY_OWNER_NOTIFICATION_TO!==ACADEMY_OWNER_NOTIFICATION_TO||env.LS_INQUIRY_EMAIL_QUEUE_ENABLED!=='true')throw new AppError('UNAVAILABLE');
 if(env.LS_AUTH_EMAIL_PROVIDER!=='gmail'||env.LS_AUTH_EMAIL_FROM!==INQUIRY_EMAIL_FROM)throw new AppError('UNAVAILABLE');
 const config=parseGmailAuthConfig(env);return {transport:new GmailAuthTransport(config,sendFetch,'JLFA Office'),from:config.from,to:ACADEMY_OWNER_NOTIFICATION_TO};
}

type Row={id:string;applicationId:string;founderId:string;ciphertext:string;state:'queued'|'unknown'|'sent'|'canceled';createdAt:Date};
export class AcademyOwnerNotificationOutbox{
 constructor(private readonly db:IdentityStore,private readonly workspace:WorkspaceId,private readonly ring:Keyring,private readonly clock:IdentityClock){}
 async dispatchOne(id:string,transport:AuthEmailTransport,from:string,to:string,ownerOrigin:string){
  if(!z.string().uuid().safeParse(id).success||from!==INQUIRY_EMAIL_FROM||to!==ACADEMY_OWNER_NOTIFICATION_TO)throw new AppError('INVALID_REQUEST');
  const parsedOrigin=new URL(ownerOrigin);if(parsedOrigin.protocol!=='https:'||parsedOrigin.origin!==ownerOrigin||parsedOrigin.hostname!=='life-skills.bneineviimacademy.org')throw new AppError('INVALID_REQUEST');
  const prepared=await this.db.transaction(async tx=>{await lockWorkspace(tx,this.workspace);const row=await one<Row>(tx,`SELECT id,application_id AS "applicationId",founder_id AS "founderId",payload_ciphertext AS ciphertext,state,created_at AS "createdAt" FROM ls_service_interest.inquiry_email_outbox WHERE workspace_id=$1 AND id=$2 AND purpose=$3 FOR UPDATE`,[this.workspace,id,ACADEMY_OWNER_NOTIFICATION_PURPOSE]);if(!row||row.state!=='queued')return null;
   const saved=await one<{ciphertext:string}>(tx,'SELECT payload_ciphertext AS ciphertext FROM ls_service_interest.public_applications WHERE workspace_id=$1 AND id=$2',[this.workspace,row.applicationId]);if(!saved)throw new AppError('UNAVAILABLE');
   const fields=groupApplicationFieldsSchema.parse(JSON.parse(unseal(saved.ciphertext,`ls_service_interest/public_application/v1/${this.workspace}/${row.applicationId}`,this.ring))),expected=intendedPayload(row.applicationId,fields,row.createdAt),payload=payloadSchema.parse(JSON.parse(unseal(row.ciphertext,aad(this.workspace,id),this.ring)));
   if(!expected||JSON.stringify(payload)!==JSON.stringify(expected))throw new AppError('UNAVAILABLE');
   await tx.query("UPDATE ls_service_interest.inquiry_email_outbox SET state='unknown',reserved_at=$3 WHERE workspace_id=$1 AND id=$2 AND state='queued'",[this.workspace,id,this.clock.now()]);return content(payload,ownerOrigin);
  });if(!prepared)return 'idle' as const;
  try{const receipt=await transport.send({from,to,...prepared,idempotencyKey:`ls-auth-${id}`});if(!/^[A-Za-z0-9_-]{1,256}$/.test(receipt.providerId))return 'unknown' as const;const rows=await this.db.transaction(async tx=>{await lockWorkspace(tx,this.workspace);return tx.query("UPDATE ls_service_interest.inquiry_email_outbox SET state='sent',provider_id=$3,completed_at=$4 WHERE workspace_id=$1 AND id=$2 AND state='unknown' RETURNING id",[this.workspace,id,receipt.providerId,this.clock.now()]);});return rows.length===1?'sent' as const:'unknown' as const;}catch{return 'unknown' as const;}
 }
 async dispatchForApplication(reference:string,transport:AuthEmailTransport,from:string,to:string,ownerOrigin:string){
  if(!z.string().uuid().safeParse(reference).success)throw new AppError('INVALID_REQUEST');const row=await this.db.transaction(tx=>one<{id:string;state:Row['state']}>(tx,'SELECT id,state FROM ls_service_interest.inquiry_email_outbox WHERE workspace_id=$1 AND application_id=$2 AND purpose=$3',[this.workspace,reference,ACADEMY_OWNER_NOTIFICATION_PURPOSE]));if(!row)return 'not_requested' as const;if(row.state!=='queued')return row.state;const result=await this.dispatchOne(row.id,transport,from,to,ownerOrigin);return result==='idle'?(await this.db.transaction(tx=>one<{state:Row['state']}>(tx,'SELECT state FROM ls_service_interest.inquiry_email_outbox WHERE workspace_id=$1 AND id=$2',[this.workspace,row.id])))?.state??'unknown':result;
 }
 async dispatchQueued(transport:AuthEmailTransport,from:string,to:string,ownerOrigin:string){
  const rows=await this.db.transaction(tx=>tx.query<{id:string}>('SELECT id FROM ls_service_interest.inquiry_email_outbox WHERE workspace_id=$1 AND purpose=$2 AND state=\'queued\' ORDER BY created_at,id LIMIT 50',[this.workspace,ACADEMY_OWNER_NOTIFICATION_PURPOSE]));let processed=0;for(const row of rows){if(await this.dispatchOne(row.id,transport,from,to,ownerOrigin)!=='idle')processed++;}return {processed,scanComplete:rows.length<50};
 }
}
