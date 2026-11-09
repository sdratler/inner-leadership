import 'server-only';
import { z } from 'zod';
import { AppError } from '../../lib/errors.ts';
import { canonicalEmail, seal, unseal, type Keyring } from '../identity/crypto.ts';
import { lockWorkspace } from '../identity/data.ts';
import { one, type IdentityStore, type SqlSession } from '../identity/store.ts';
import type { IdentityClock, WorkspaceId } from '../identity/types.ts';
import { GmailAuthTransport, parseGmailAuthConfig } from '../../providers/email/gmail.ts';
import type { AuthEmailMessage } from '../../providers/email/transport.ts';
import { decodeStoredGroupApplication, type StoredGroupApplicationRow } from './group-application-record.ts';
import { isTrip390Interest } from './contract.ts';
import { isCurrentTrip390Interest, TRIP390_NOTICE_VERSION } from './academy-trip390-contract.ts';
import { INQUIRY_EMAIL_PURPOSE } from './inquiry-email-copy.ts';
import { INQUIRY_EMAIL_CONTROL_PURPOSE, INQUIRY_EMAIL_CONTROL_VERSION, type InquiryEmailControlDelivery, type InquiryEmailControlVerification } from './academy-inquiry-email-verification.ts';
import { emailControlContent } from './academy-inquiry-email-control-email.ts';
import { EMAIL_CONTROL_SENDER, emailControlDigest, inquiryEmailControlAllows, inquiryEmailControlRequestAllowed,
 loadInquiryEmailControlAdmission, type InquiryEmailControlAdmission } from './academy-inquiry-email-control-admission.ts';

const id = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/);
const instant = z.iso.datetime().refine(s => new Date(s).toISOString() === s);
const purpose = INQUIRY_EMAIL_CONTROL_PURPOSE;
const actionSchema = z.object({
 purpose:z.literal(purpose),version:z.literal(INQUIRY_EMAIL_CONTROL_VERSION),verificationId:id,deliveryIntentId:id,
 workspaceId:id,applicationId:id,recipient:z.email().max(254),messageLanguage:z.enum(['en','he']),
 token:z.string().regex(/^[A-Za-z0-9_-]{43}$/),expiresAt:instant,sourceDigest:hash,requestVersion:z.string(),offerVersion:z.string(),
}).strict();
const contentSchema = z.object({version:z.string().min(1),subject:z.string().min(1).max(150).regex(/^[^\r\n]+$/),
 text:z.string().min(1).max(5000),html:z.string().min(1).refine(s => Buffer.byteLength(s) <= 32768),contentSha256:hash}).strict();
const payloadSchema = z.object({purpose:z.literal(purpose),version:z.literal(1),action:actionSchema,savedAt:instant,createdAt:instant,
 noticeVersion:z.literal(TRIP390_NOTICE_VERSION),childIds:z.array(id).min(1).max(10),content:contentSchema}).strict();
type Payload = z.infer<typeof payloadSchema>;
const lifecycleBase = {version:z.literal(1),purpose:z.literal(purpose),workspaceId:id,reference:id,deliveryId:id,verificationId:id,
 sourceDigest:hash,payloadSha256:hash,createdAt:instant};
const lifecycleSchema = z.discriminatedUnion('state',[
 z.object({...lifecycleBase,state:z.literal('queued'),reservedAt:z.null(),completedAt:z.null(),providerId:z.null()}).strict(),
 z.object({...lifecycleBase,state:z.literal('unknown'),reservedAt:instant,completedAt:z.null(),providerId:z.null()}).strict(),
 z.object({...lifecycleBase,state:z.literal('sent'),reservedAt:instant,completedAt:instant,providerId:z.string().regex(/^[A-Za-z0-9_-]{1,256}$/)}).strict(),
]);
type Lifecycle = z.infer<typeof lifecycleSchema>;
type Durable = {payload:Payload;life:Lifecycle;payloadCipher:string;lifeCipher:string};
type Row = {id:string;reference:string;state:string;payloadCipher:string;lifeCipher:string;createdAt:Date;reservedAt:Date|null;completedAt:Date|null;providerId:string|null};
const columns = 'SELECT id,application_id AS reference,state,payload_ciphertext AS "payloadCipher",control_delivery_ciphertext AS "lifeCipher",created_at AS "createdAt",reserved_at AS "reservedAt",completed_at AS "completedAt",provider_id AS "providerId" FROM ls_service_interest.inquiry_email_outbox';
const cursorSchema = z.object({receivedAt:z.iso.datetime(),id}).strict();
export type InquiryEmailControlCursor = z.infer<typeof cursorSchema>;
export type InquiryEmailControlState = 'held'|'queued'|'unknown'|'sent';
export type InquiryEmailControlOutboxConfig = {
 store:IdentityStore;workspaceId:WorkspaceId;keyring:Keyring;requestDigestKey:string;clock:IdentityClock;
 verification:Pick<InquiryEmailControlVerification,'issue'|'isDeliveryCurrent'>;
};
type TestTransport = {env:Readonly<Record<string,string|undefined>>;fetch:typeof fetch};
type Prepared = {id:string;message:AuthEmailMessage;marker:string;policy:InquiryEmailControlAdmission;action:InquiryEmailControlDelivery};
const unavailable = () => new AppError('UNAVAILABLE');
const same = (a:unknown,b:unknown) => JSON.stringify(a) === JSON.stringify(b);
const safeFirstName = (display:string):string|null => {
 const first = display.trim().split(/\s+/u)[0];
 return first && /^\p{L}[\p{L}\p{M}'’\-]*$/u.test(first) && !/^(?:mr|mrs|ms|dr|rabbi|family|household|משפחת|הרב|דוקטור)$/iu.test(first) ? first : null;
};

export class InquiryEmailControlOutbox {
 constructor(private readonly config:InquiryEmailControlOutboxConfig,private readonly test?:TestTransport) {
  id.parse(config.workspaceId);
  if (config.requestDigestKey.length < 32 || (test && (process.env.NODE_ENV !== 'test' || typeof test.fetch !== 'function' || test.fetch === globalThis.fetch))) throw unavailable();
 }
 private env() { return this.test?.env ?? process.env; }
 private now() { return new Date(Math.max(Date.now(),this.config.clock.now().getTime())); }
 private async dbNow(tx:SqlSession) {
  const row = await one<{at:Date}>(tx,'SELECT GREATEST($1::timestamptz,clock_timestamp()) AS at',[this.now()]);
  if (!row || !Number.isFinite(row.at.getTime())) throw unavailable();
  return row.at;
 }
 private fresh(previous?:InquiryEmailControlAdmission) {
  const policy = loadInquiryEmailControlAdmission(this.env(),this.now());
  if (!policy || (previous && !same(policy,previous)) || !inquiryEmailControlAllows(policy,this.config.workspaceId,this.now())) throw unavailable();
  return policy;
 }
 private aad(kind:'payload'|'delivery',deliveryId:string) {
  return 'ls_service_interest/inquiry_email_control/outbox/v1/'+kind+'/'+this.config.workspaceId+'/'+deliveryId;
 }
 private encode(life:Lifecycle) {
  return seal(JSON.stringify(lifecycleSchema.parse(life)),this.aad('delivery',life.deliveryId),this.config.keyring);
 }
 private async source(tx:SqlSession,policy:InquiryEmailControlAdmission,reference:string) {
  const workspace = this.config.workspaceId;
  const row = await one<StoredGroupApplicationRow>(tx,`SELECT a.id,a.request_digest AS "requestDigest",a.payload_ciphertext AS "payloadCiphertext",a.received_at AS "receivedAt"
   FROM ls_service_interest.public_applications a WHERE a.workspace_id=$1 AND a.id=$2 AND a.received_at >= $3::timestamptz
   AND EXISTS (SELECT 1 FROM ls_service_interest.public_application_operations op WHERE op.workspace_id=a.workspace_id AND op.application_id=a.id AND op.request_digest=a.request_digest)
   AND NOT EXISTS (SELECT 1 FROM ls_service_interest.inquiry_email_outbox old WHERE old.workspace_id=a.workspace_id AND old.application_id=a.id AND old.purpose=$4) FOR SHARE OF a`,
   [workspace,reference,policy.notBefore,INQUIRY_EMAIL_PURPOSE]);
  if (!row) throw unavailable();
  const {fields} = decodeStoredGroupApplication(workspace,row,this.config.keyring,this.config.requestDigestKey);
  if (!isTrip390Interest(fields) || !isCurrentTrip390Interest(fields) || !fields.acknowledgment.interestPrivacySafety ||
      !fields.acknowledgment.conductExplained || fields.acknowledgment.version !== TRIP390_NOTICE_VERSION) throw unavailable();
  const recipient = canonicalEmail(fields.email);
  if (!inquiryEmailControlRequestAllowed(policy,workspace,{reference,recipient,savedAt:row.receivedAt},this.now())) throw unavailable();
  return {fields,recipient,row};
 }
 private async payload(tx:SqlSession,policy:InquiryEmailControlAdmission,action:InquiryEmailControlDelivery,createdAt:string):Promise<Payload> {
  const parsed = actionSchema.parse(action);
  const {fields,recipient,row} = await this.source(tx,policy,action.applicationId);
  if (action.workspaceId !== this.config.workspaceId || action.recipient !== recipient || action.sourceDigest !== row.requestDigest ||
      action.requestVersion !== fields.version || action.offerVersion !== fields.offerVersion || action.messageLanguage !== fields.messageLanguage ||
      Date.parse(createdAt) < row.receivedAt.getTime() || Date.parse(action.expiresAt) <= Date.parse(createdAt)) throw unavailable();
  const content = emailControlContent({reference:row.id,parentFirstName:safeFirstName(fields.guardianName),
   children:fields.children.map(({id,name}) => ({id,name})),messageLanguage:fields.messageLanguage,token:action.token});
  return payloadSchema.parse({purpose,version:1,action:parsed,createdAt,savedAt:row.receivedAt.toISOString(),
   noticeVersion:fields.acknowledgment.version,childIds:fields.children.map(c => c.id),content});
 }
 private async currentAction(tx:SqlSession,action:InquiryEmailControlDelivery,policy:InquiryEmailControlAdmission) {
  const binding = await one(tx,`SELECT id FROM ls_service_interest.inquiry_email_control_verifications
   WHERE workspace_id=$1 AND id=$2 AND delivery_intent_id=$3 AND expires_at=$4::timestamptz
   AND expires_at=issued_at+$5::integer*interval '1 millisecond'`,
   [this.config.workspaceId,action.verificationId,action.deliveryIntentId,action.expiresAt,policy.securityLifetimeMs]);
  if (!binding) throw unavailable();
  if (!await this.config.verification.isDeliveryCurrent(tx,action)) throw unavailable();
  this.fresh(policy);
  if (Date.parse(action.expiresAt) <= this.now().getTime()) throw unavailable();
 }
 private async read(tx:SqlSession,deliveryId:string):Promise<Durable|null> {
  const workspace = this.config.workspaceId;
  const row = await one<Row>(tx,columns+" WHERE workspace_id=$1 AND id=$2 AND purpose=$3 AND founder_id IS NULL AND message_key='email-control:'||id::text FOR UPDATE",[workspace,deliveryId,purpose]);
  if (!row) return null;
  const data = payloadSchema.parse(JSON.parse(unseal(row.payloadCipher,this.aad('payload',deliveryId),this.config.keyring)));
  const life = lifecycleSchema.parse(JSON.parse(unseal(row.lifeCipher,this.aad('delivery',deliveryId),this.config.keyring)));
  const action = data.action;
  if (action.workspaceId !== workspace || action.deliveryIntentId !== row.id || action.applicationId !== row.reference ||
      life.workspaceId !== workspace || life.reference !== row.reference || life.deliveryId !== row.id || life.verificationId !== action.verificationId ||
      life.sourceDigest !== action.sourceDigest || life.payloadSha256 !== emailControlDigest(row.payloadCipher) || life.createdAt !== data.createdAt ||
      row.state !== life.state || row.providerId !== life.providerId ||
      (life.reservedAt && Date.parse(life.reservedAt) < Date.parse(life.createdAt)) ||
      (life.completedAt && Date.parse(life.completedAt) < Date.parse(life.reservedAt))) throw unavailable();
  // SQL checks exact timestamptz values, including sub-millisecond tampering
  // that would disappear when the driver rounds a timestamp into a JS Date.
  const exact = await one<{ok:boolean}>(tx,`SELECT created_at=$3::timestamptz AND reserved_at IS NOT DISTINCT FROM $4::timestamptz
   AND completed_at IS NOT DISTINCT FROM $5::timestamptz AS ok FROM ls_service_interest.inquiry_email_outbox WHERE workspace_id=$1 AND id=$2`,
   [workspace,deliveryId,life.createdAt,life.reservedAt,life.completedAt]);
  if (!exact?.ok) throw unavailable();
  return {payload:data,life,payloadCipher:row.payloadCipher,lifeCipher:row.lifeCipher};
 }
 private async change(tx:SqlSession,old:Durable,next:Lifecycle) {
  const cipher = this.encode(next);
  const rows = await tx.query(`UPDATE ls_service_interest.inquiry_email_outbox SET state=$5,reserved_at=$6,completed_at=$7,provider_id=$8,control_delivery_ciphertext=$9
   WHERE workspace_id=$1 AND id=$2 AND purpose=$3 AND state=$4 AND control_delivery_ciphertext=$10 AND payload_ciphertext=$11 RETURNING id`,
   [this.config.workspaceId,next.deliveryId,purpose,old.life.state,next.state,next.reservedAt,next.completedAt,next.providerId,cipher,old.lifeCipher,old.payloadCipher]);
  if (rows.length !== 1) throw unavailable();
  return cipher;
 }
 private async byReference(tx:SqlSession,reference:string) {
  const hit = await one<{id:string}>(tx,'SELECT id FROM ls_service_interest.inquiry_email_outbox WHERE workspace_id=$1 AND application_id=$2 AND purpose=$3',[this.config.workspaceId,reference,purpose]);
  if (!hit) return null;
  const original = await this.read(tx,hit.id);
  if (!original || original.payload.action.applicationId !== reference) throw unavailable();
  return original;
 }
 /** A.issue calls this with its existing transaction after recording issuance. */
 async queue(tx:SqlSession,action:InquiryEmailControlDelivery):Promise<void> {
  const policy = this.fresh(), workspace = this.config.workspaceId;
  await lockWorkspace(tx,workspace);
  const at = await this.dbNow(tx), data = await this.payload(tx,policy,action,at.toISOString());
  await this.currentAction(tx,action,policy);
  const id = action.deliveryIntentId, payloadCipher = seal(JSON.stringify(data),this.aad('payload',id),this.config.keyring);
  const life:Lifecycle = {version:1,purpose,workspaceId:workspace,reference:action.applicationId,deliveryId:id,verificationId:action.verificationId,
   sourceDigest:action.sourceDigest,payloadSha256:emailControlDigest(payloadCipher),createdAt:data.createdAt,state:'queued',reservedAt:null,completedAt:null,providerId:null};
  const inserted = await tx.query(`INSERT INTO ls_service_interest.inquiry_email_outbox(workspace_id,id,application_id,purpose,message_key,payload_ciphertext,state,created_at,control_delivery_ciphertext)
   VALUES($1,$2,$3,$4,$5,$6,'queued',$7,$8) ON CONFLICT DO NOTHING RETURNING id`,
   [workspace,id,action.applicationId,purpose,'email-control:'+id,payloadCipher,at,this.encode(life)]);
  if (!inserted.length) {
   const old = await this.read(tx,id);
   if (!old || !same(old.payload,{...data,createdAt:old.payload.createdAt})) throw unavailable();
  }
  await this.currentAction(tx,action,policy);
 }
 /** Post-save crash recovery. A committed lead may initially have no outbox.
  * An existing parent receipt of any state always excludes this replacement. */
 async prepareForApplication(reference:string):Promise<InquiryEmailControlState> {
  id.parse(reference);
  let issuanceStarted = false;
  try {
   const policy = this.fresh();
   const existing = await this.config.store.transaction(async tx => {
    await lockWorkspace(tx,this.config.workspaceId);
    const original = await this.byReference(tx,reference);
    if (original && original.life.state !== 'queued') return original.life.state;
    await this.source(tx,policy,reference);
    return null;
   });
   if (existing) return existing;
   issuanceStarted = true;
   const result = await this.config.verification.issue(reference,(tx,action) => {this.fresh(policy);return this.queue(tx,action);});
   if (result.state === 'closed') return 'held';
   return await this.config.store.transaction(async tx => {
    const row = await this.read(tx,result.deliveryIntentId);
    return row?.payload.action.applicationId === reference ? row.life.state : 'held';
   });
  } catch {
   if (!issuanceStarted) return 'held';
   // A lost commit reply may follow a successful issue and enqueue. Recover
   // only the same authenticated original row. No reissue or transport here.
   try {
    return await this.config.store.transaction(async tx => {
     await lockWorkspace(tx,this.config.workspaceId);
     return (await this.byReference(tx,reference))?.life.state ?? 'held';
    });
   } catch { return 'unknown'; }
  }
 }
 private message(row:Durable):AuthEmailMessage {
  const {action,content} = row.payload;
  return {from:EMAIL_CONTROL_SENDER,to:action.recipient,subject:content.subject,text:content.text,html:content.html,idempotencyKey:'ls-auth-'+action.deliveryIntentId};
 }
 private async eligible(tx:SqlSession,row:Durable,policy:InquiryEmailControlAdmission) {
  const action = row.payload.action as InquiryEmailControlDelivery;
  const current = await this.payload(tx,policy,action,row.payload.createdAt);
  if (!same(row.payload,current)) throw unavailable();
  await this.currentAction(tx,action,policy);
 }
 private async persistAcceptance(prepared:Prepared,providerId:string):Promise<InquiryEmailControlState> {
  try {
   return await this.config.store.transaction(async tx => {
    await lockWorkspace(tx,this.config.workspaceId);
    const row = await this.read(tx,prepared.id);
    if (!row || row.life.state !== 'unknown' || row.lifeCipher !== prepared.marker) return 'unknown';
    const completedAt = (await this.dbNow(tx)).toISOString();
    if (Date.parse(completedAt) < Date.parse(row.life.reservedAt)) throw unavailable();
    await this.change(tx,row,{...row.life,state:'sent',completedAt,providerId});
    return 'sent';
   });
  } catch {
   // A commit reply can be lost after acceptance was saved. Read only the
   // authenticated receipt of this exact original message; never send again.
   try {
    return await this.config.store.transaction(async tx => {
     const row = await this.read(tx,prepared.id);
     return row?.life.state === 'sent' && row.life.providerId === providerId &&
      same(row.payload.action,prepared.action) && same(this.message(row),prepared.message) ? 'sent' : 'unknown';
    });
   } catch { return 'unknown'; }
  }
 }
 async dispatchOne(deliveryId:string):Promise<InquiryEmailControlState> {
  id.parse(deliveryId);
  let commitMayHaveStarted = false;
  let prepared:Prepared;
  try {
   const policy = this.fresh();
   const result = await this.config.store.transaction(async tx => {
    await lockWorkspace(tx,this.config.workspaceId);
    const row = await this.read(tx,deliveryId);
    if (!row) return 'held' as const;
    if (row.life.state !== 'queued') return row.life.state;
    await this.eligible(tx,row,policy);
    const at = (await this.dbNow(tx)).toISOString();
    const marker = await this.change(tx,row,{...row.life,state:'unknown',reservedAt:at,completedAt:null,providerId:null});
    await this.currentAction(tx,row.payload.action as InquiryEmailControlDelivery,policy);
    commitMayHaveStarted = true;
    return {id:deliveryId,policy,marker,message:this.message(row),action:row.payload.action as InquiryEmailControlDelivery};
   });
   if (typeof result === 'string') return result;
   prepared = result;
  } catch { return commitMayHaveStarted ? 'unknown' : 'held'; }
  // The send is outside SQL. Gmail invokes the gate after OAuth and directly
  // before its one messages.send POST. An uncertain attempt is never requeued.
  try {
   this.fresh(prepared.policy);
   const transport = new GmailAuthTransport(parseGmailAuthConfig(this.env()),this.test?.fetch ?? fetch,'JLFA Office',async message => {
    if (!same(message,prepared.message)) throw unavailable();
    await this.config.store.transaction(async tx => {
     await lockWorkspace(tx,this.config.workspaceId);
     const row = await this.read(tx,deliveryId);
     if (!row || row.life.state !== 'unknown' || row.lifeCipher !== prepared.marker || !same(this.message(row),message)) throw unavailable();
     await this.eligible(tx,row,prepared.policy);
    });
    this.fresh(prepared.policy);
    if (Date.parse(prepared.action.expiresAt) <= this.now().getTime()) throw unavailable();
   });
   const actual = await transport.send(prepared.message);
   if (!/^[A-Za-z0-9_-]{1,256}$/.test(actual.providerId)) return 'unknown';
   return this.persistAcceptance(prepared,actual.providerId);
  } catch { return 'unknown'; }
 }
 async dispatchForApplication(reference:string):Promise<InquiryEmailControlState> {
  const state = await this.prepareForApplication(reference);
  if (state !== 'queued') return state;
  try {
   const row = await this.config.store.transaction(tx => this.byReference(tx,reference));
   return row ? await this.dispatchOne(row.life.deliveryId) : 'held';
  } catch { return 'unknown'; }
 }
 async dispatchPage(cursor?:InquiryEmailControlCursor):Promise<{examined:number;sent:number;next:InquiryEmailControlCursor|null}> {
  const parsed = cursor ? cursorSchema.parse(cursor) : null, policy = this.fresh();
  const controlled = policy.population.mode === 'controlled_test' ? policy.population.requests.map(r => r.reference) : null;
  const rows = await this.config.store.transaction(tx => tx.query<InquiryEmailControlCursor>(`SELECT a.id,
   to_char(a.received_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "receivedAt" FROM ls_service_interest.public_applications a
   WHERE a.workspace_id=$1 AND a.received_at >= $2::timestamptz AND a.received_at <= $3::timestamptz
   AND ($4::uuid[] IS NULL OR a.id=ANY($4::uuid[])) AND ($5::timestamptz IS NULL OR (a.received_at,a.id)>($5::timestamptz,$6::uuid))
   AND NOT EXISTS (SELECT 1 FROM ls_service_interest.inquiry_email_outbox old WHERE old.workspace_id=a.workspace_id AND old.application_id=a.id AND
     (old.purpose=$7 OR (old.purpose=$8 AND old.state <> 'queued')))
   ORDER BY a.received_at,a.id LIMIT 11`,[this.config.workspaceId,policy.notBefore,this.now(),controlled,parsed?.receivedAt ?? null,parsed?.id ?? null,INQUIRY_EMAIL_PURPOSE,purpose]));
  const page = rows.slice(0,10);
  let sent = 0;
  for (const row of page) {this.fresh(policy);if (await this.dispatchForApplication(row.id) === 'sent') sent++;}
  return {examined:page.length,sent,next:rows.length > 10 ? page[page.length-1]! : null};
 }
}
