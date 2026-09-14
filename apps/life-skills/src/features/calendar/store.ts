import { createHash, randomUUID } from 'node:crypto';
import { AppError } from '../../lib/errors.ts';
import { asId } from '../../lib/ids.ts';
import { accountById, freshActor, lockWorkspace } from '../identity/data.ts';
import { one } from '../identity/store.ts';
import type { IdentityStore, SqlSession } from '../identity/store.ts';
import type { AccountFacts, Actor, AudienceId, CaseId, IdentityClock, WorkspaceId } from '../identity/types.ts';
import { seal, unseal, type Keyring } from '../identity/crypto.ts';
import { loadAudience, loadCase, loadGuardians } from '../cases/data.ts';
import { audienceAccess, caseAccess, requirePractitioner, type AudienceFacts, type CaseFacts, type GuardianFacts } from '../cases/policy.ts';
import type { Appointment, AppointmentId, AppointmentView, Attendance, CalendarEvent, Notice } from './types.ts';
import { authorizeAppointment } from './policy.ts';
import { countsAsChildSession } from '../attendance/policy.ts';
export interface TransactionContext { tx: SqlSession; actor: AccountFacts; workspace: WorkspaceId; now: string; }
export interface AuthorizedAppointment { item: Appointment; caseFacts: CaseFacts; audience: AudienceFacts; guardians: GuardianFacts[]; }
export const APPOINTMENT_SELECT = `SELECT id,workspace_id AS "workspaceId",case_id AS "caseId",audience_id AS "audienceId",
 engagement_id AS "engagementId",practitioner_id AS "practitionerId",terms_version AS "termsVersion",kind,
 starts_at AS "startsAt",ends_at AS "endsAt",status,parent_for_id AS "parentForId",original_id AS "originalId",
 parent_ids AS "parentIds",buffer_before AS "bufferBefore",buffer_after AS "bufferAfter",version,
 location_ciphertext AS "locationCiphertext",created_by AS "createdBy",created_at AS "createdAt" FROM ls_calendar.appointments`;
type AppointmentRow=Omit<Appointment,'startsAt'|'endsAt'|'createdAt'|'location'> & {startsAt:Date;endsAt:Date;createdAt:Date;locationCiphertext:string};
const stamp = (value: Date): string => value.toISOString();
export function canonical(value: unknown): string {
 if (value===undefined) throw new AppError('INVALID_REQUEST');
 if (value===null || typeof value!=='object') return JSON.stringify(value);
 if (Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
 return '{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}';
}
export class CalendarStore {
 readonly store: IdentityStore; readonly keyring: Keyring; readonly clock: IdentityClock;
 constructor(store: IdentityStore,keyring:Keyring,clock:IdentityClock) { this.store=store;this.keyring=keyring;this.clock=clock; }
 private aad(c:TransactionContext,kind:string,id:string) {return `calendar:${kind}:${c.workspace}:${id}`;}
 encrypt(c:TransactionContext,kind:string,id:string,value:string) {return seal(value,this.aad(c,kind,id),this.keyring);}
 decrypt(c:TransactionContext,kind:string,id:string,value:string) {return unseal(value,this.aad(c,kind,id),this.keyring);}
 async read<T>(actor:Actor,work:(c:TransactionContext)=>Promise<T>):Promise<T> {
  try {return await this.store.transaction(async tx=>{
   await lockWorkspace(tx,actor.workspaceId);
   const live=await freshActor(tx,actor,this.clock.now());
   const row=await one<{now:Date}>(tx,'SELECT clock_timestamp() AS now');
   if(!row)throw new AppError('UNAVAILABLE');
   return work({tx,actor:live,workspace:live.workspaceId,now:stamp(row.now)});
  });} catch(error) {
   if(error instanceof AppError)throw error;
   const code=(error as {code?:unknown})?.code;
   if(['23505','23514','23503','23P01'].includes(String(code)))throw new AppError('CONFLICT');
   throw new AppError('UNAVAILABLE'); // Never return SQL, identifiers, payloads or secrets.
  }
 }
 async command<T>(actor:Actor,operation:string,key:string,body:unknown,authorize:(c:TransactionContext)=>Promise<unknown>,work:(c:TransactionContext)=>Promise<T>):Promise<T> {
  if(!/^[A-Za-z0-9_-]{16,100}$/.test(key))throw new AppError('INVALID_REQUEST');
  const digest=createHash('sha256').update(canonical(body)).digest('hex');
  return this.read(actor,async c=>{
   // Reauthorization precedes replay, so revocation is not bypassed by an old key.
   await authorize(c);
   const previous=await one<{digest:string;result:string}>(c.tx,`SELECT body_digest AS digest,result_ciphertext AS result FROM ls_calendar.commands
    WHERE workspace_id=$1 AND account_id=$2 AND operation=$3 AND command_key=$4`,[c.workspace,c.actor.id,operation,key]);
   const resultId=createHash('sha256').update(`${c.actor.id}:${operation}:${key}`).digest('hex');
   if(previous){if(previous.digest!==digest)throw new AppError('CONFLICT');return JSON.parse(this.decrypt(c,'command',resultId,previous.result)) as T;}
   const result=await work(c);
   await c.tx.query(`INSERT INTO ls_calendar.commands(workspace_id,account_id,operation,command_key,body_digest,result_ciphertext,created_at)
    VALUES($1,$2,$3,$4,$5,$6,$7)`,[c.workspace,c.actor.id,operation,key,digest,this.encrypt(c,'command',resultId,JSON.stringify(result)),c.now]);
   return result;
  });
 }
 async scope(c:TransactionContext,caseId:CaseId,write=false) {
  const item=await loadCase(c.tx,c.workspace,caseId),guardians=await loadGuardians(c.tx,c.workspace,caseId);
  caseAccess(c.actor,item,guardians,write?'write':'read');
  if(!item)throw new AppError('NOT_FOUND');return {item,guardians};
 }
 async getRaw(c:TransactionContext,id:AppointmentId):Promise<Appointment|null> {
  const row=await one<AppointmentRow>(c.tx,APPOINTMENT_SELECT+' WHERE workspace_id=$1 AND id=$2',[c.workspace,id]);
  if(!row)return null;
  const {locationCiphertext,...rest}=row;
  return {...rest,startsAt:stamp(row.startsAt),endsAt:stamp(row.endsAt),createdAt:stamp(row.createdAt),location:this.decrypt(c,'location',id,locationCiphertext)};
 }
 async authorized(c:TransactionContext,id:AppointmentId,practitionerOnly=false):Promise<AuthorizedAppointment> {
  const metadata=await one<{caseId:CaseId;audienceId:AudienceId}>(c.tx,'SELECT case_id AS "caseId",audience_id AS "audienceId" FROM ls_calendar.appointments WHERE workspace_id=$1 AND id=$2',[c.workspace,id]);
  if(!metadata)throw new AppError('NOT_FOUND');
  await this.scope(c,metadata.caseId,practitionerOnly);await this.audience(c,metadata.caseId,metadata.audienceId);
  const a=await this.getRaw(c,id);if(!a)throw new AppError('NOT_FOUND');
  const {item,guardians}=await this.scope(c,a.caseId,practitionerOnly);
  const audience=await loadAudience(c.tx,c.workspace,a.caseId,a.audienceId);
  authorizeAppointment(c.actor,item,guardians,audience,a,practitionerOnly);
  if(!audience)throw new AppError('NOT_FOUND');return {item:a,caseFacts:item,audience,guardians};
 }
 async notice(c:TransactionContext,a:Appointment):Promise<Notice|null> {
  const row=await one<Omit<Notice,'receivedAt'|'recordedAt'|'originalStart'|'noticeMilliseconds'> & {receivedAt:Date;recordedAt:Date;originalStart:Date;noticeMilliseconds:string}>(c.tx,`SELECT id,appointment_id AS "appointmentId",case_id AS "caseId",kind,source,
   received_at AS "receivedAt",recorded_at AS "recordedAt",original_start AS "originalStart",notice_milliseconds AS "noticeMilliseconds",
   requested_by AS "requestedBy",entered_by AS "enteredBy",terms_version AS "termsVersion",eligibility,state,replacement_id AS "replacementId",proposed_windows AS "proposedWindows"
   FROM ls_calendar.notices WHERE workspace_id=$1 AND appointment_id=$2 ORDER BY received_at,id LIMIT 1`,[c.workspace,a.id]);
  return row?{...row,receivedAt:stamp(row.receivedAt),recordedAt:stamp(row.recordedAt),originalStart:stamp(row.originalStart),noticeMilliseconds:Number(row.noticeMilliseconds)}:null;
 }
 async attendance(c:TransactionContext,a:Appointment):Promise<Attendance|null> {
  const row=await one<Omit<Attendance,'recordedAt'|'arrivedAt'> & {recordedAt:Date;arrivedAt:Date|null}>(c.tx,`SELECT state,attended,arrived_at AS "arrivedAt",version,recorded_at AS "recordedAt",recorded_by AS "recordedBy"
   FROM ls_attendance.records WHERE workspace_id=$1 AND appointment_id=$2`,[c.workspace,a.id]);
  return row?{...row,recordedAt:stamp(row.recordedAt),arrivedAt:row.arrivedAt?stamp(row.arrivedAt):null}:null;
 }
 async protectedByException(c:TransactionContext,a:Appointment) {
  const row=await one<{reasonCode:'practitioner_exception'|'provider_unavailable';recordedAt:Date}>(c.tx,`SELECT reason_code AS "reasonCode",recorded_at AS "recordedAt" FROM ls_calendar.credit_exceptions WHERE workspace_id=$1 AND appointment_id=$2`,[c.workspace,a.id]);
  return row?{reasonCode:row.reasonCode,recordedAt:stamp(row.recordedAt)}:null;
 }
 async view(c:TransactionContext,id:AppointmentId):Promise<AppointmentView> {
  const {item:a,audience}=await this.authorized(c,id);
  const notice=await this.notice(c,a),attendance=await this.attendance(c,a),creditException=await this.protectedByException(c,a);
  let checkinNeedsReview=false;
  if(a.parentForId){
   const parent=await this.getRaw(c,a.parentForId);
   if(!parent)throw new AppError('UNAVAILABLE');
   const childAttendance=await this.attendance(c,parent);
   checkinNeedsReview=['canceled_family','canceled_practitioner','rescheduled'].includes(parent.status) || childAttendance?.state==='no_show' || childAttendance?.state==='canceled';
  }
  const replacement=await one<{id:AppointmentId}>(c.tx,'SELECT id FROM ls_calendar.appointments WHERE workspace_id=$1 AND original_id=$2',[c.workspace,id]);
  const limited=c.actor.role!=='practitioner'  && audience.visibility!=='family_full';
  return {...a,location:limited?'':a.location,parentIds:limited?[]:a.parentIds,
   notice:limited?null:notice,attendance,countsAsChildSession:countsAsChildSession(a.kind,attendance?.state),checkinNeedsReview,creditException,replacementId:replacement?.id??null};
 }
 async event(c:TransactionContext,a:Appointment,eventKey:string,event:CalendarEvent) {
  // Same workspace transaction serializes sequence allocation with all calendar/identity writes.
  await c.tx.query(`INSERT INTO ls_calendar.events(id,workspace_id,case_id,appointment_id,sequence,topic,event_key,payload,created_at)
   SELECT $1,$2,$3,$4,COALESCE(MAX(sequence),0)+1,$5,$6,$7::jsonb,$8 FROM ls_calendar.events WHERE workspace_id=$2 AND appointment_id=$4
   ON CONFLICT(workspace_id,event_key) DO NOTHING`,[randomUUID(),c.workspace,a.caseId,a.id,event.type,eventKey,JSON.stringify(event),c.now]);
 }
 async history(c:TransactionContext,a:Appointment|null,action:string,reason:string|null=null) {
  const id=randomUUID();
  await c.tx.query(`INSERT INTO ls_calendar.history(id,workspace_id,case_id,appointment_id,action,actor_id,recorded_at,reason_ciphertext)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[id,c.workspace,a?.caseId??null,a?.id??null,action,c.actor.id,c.now,reason?this.encrypt(c,'history',id,reason):null]);
 }
 async setStatus(c:TransactionContext,a:Appointment,status:Appointment['status']) {
  await c.tx.query('UPDATE ls_calendar.appointments SET status=$3,version=version+1 WHERE workspace_id=$1 AND id=$2',[c.workspace,a.id,status]);
  a.status=status;a.version+=1;
  await this.event(c,a,`appointment:${a.id}:${a.version}`,{type:'appointment_changed',appointmentId:a.id,version:a.version,occurredAt:c.now});
 }
 async assertParentActive(c:TransactionContext,id:AccountFacts['id']) {
  const p=await accountById(c.tx,c.workspace,id);if(!p || p.role!=='parent' || p.state!=='active')throw new AppError('NOT_FOUND');return p;
 }
 async audience(c:TransactionContext,caseId:CaseId,id:AudienceId) {
  const {item,guardians}=await this.scope(c,caseId);
  const audience=await loadAudience(c.tx,c.workspace,caseId,id);if(!audience)throw new AppError('NOT_FOUND');
  audienceAccess(c.actor,item,guardians,audience);return {item,guardians,audience};
 }
 async requirePractitioner(c:TransactionContext) {requirePractitioner(c.actor);}
 uuid() {return asId(randomUUID(),'appointment');}
}
