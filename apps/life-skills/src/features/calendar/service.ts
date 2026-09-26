import { randomUUID } from 'node:crypto';
import { AppError } from '../../lib/errors.ts';
import { asId } from '../../lib/ids.ts';
import { one } from '../identity/store.ts';
import type { AccountId, Actor, AudienceId, CaseId, EngagementId } from '../identity/types.ts';
import type { CreditEffectReference, RescheduleEligibilityReference } from '../identity/interfaces.ts';
import { audienceAccess, requirePractitioner } from '../cases/policy.ts';
import { loadAudience } from '../cases/data.ts';
import type { Appointment, AppointmentId, AppointmentView, AttendanceInput, Availability, CreateBooking, ManualNoticeInput, Notice, NoticeInput, SchedulePage } from './types.ts';
import { CalendarStore, type TransactionContext } from './store.ts';
import { assertAvailable, makeNoticeFields, paddedSlot, validateBooking } from './policy.ts';
import { iso, ms } from './time.ts';
import { validateAttendance } from '../attendance/policy.ts';
import { demoCaseBatch } from '../demo/provenance.ts';
export interface BookingCatalog {
 audiences: Array<{id:AudienceId;parentIds:AccountId[]}>;
 engagement: {id:EngagementId;termsVersion:string}|null;
}
export class CalendarService {
 readonly db: CalendarStore;
 constructor(db:CalendarStore){this.db=db;}
 get(actor:Actor,id:AppointmentId){return this.db.read(actor,c=>this.db.view(c,id));}
 async list(actor:Actor,query:{from:string;to:string;caseId:CaseId|null;cursor:string|null}):Promise<SchedulePage> {
  const from=iso(query.from),to=iso(query.to);
  if(ms(to)<=ms(from)||ms(to)-ms(from)>63*86_400_000)throw new AppError('INVALID_REQUEST');
  let cursorTime=from,cursorId='00000000-0000-0000-0000-000000000000';
  if(query.cursor){
   if(query.cursor.length>180||!/^[A-Za-z0-9_-]+$/.test(query.cursor))throw new AppError('INVALID_REQUEST');
   try {const cursor=JSON.parse(Buffer.from(query.cursor,'base64url').toString());cursorTime=iso(cursor[0]);cursorId=asId(cursor[1],'appointment');}
   catch{throw new AppError('INVALID_REQUEST');}
   if(ms(cursorTime)<ms(from)||ms(cursorTime)>=ms(to))throw new AppError('INVALID_REQUEST');
  }
  return this.db.read(actor,async c=>{
   if(query.caseId)await this.db.scope(c,query.caseId);
   if(c.actor.role!=='practitioner' && !query.caseId)throw new AppError('INVALID_REQUEST');
   const rows=await c.tx.query<{id:AppointmentId;startsAt:Date}>(`SELECT a.id,a.starts_at AS "startsAt" FROM ls_calendar.appointments a
    JOIN ls_cases.cases cs ON cs.workspace_id=a.workspace_id AND cs.id=a.case_id
    JOIN ls_cases.audiences au ON au.workspace_id=a.workspace_id AND au.case_id=a.case_id AND au.id=a.audience_id
    WHERE a.workspace_id=$1 AND ($2::uuid IS NULL OR a.case_id=$2) AND a.starts_at>=$3 AND a.starts_at<$4
    AND (a.starts_at,a.id)>($5::timestamptz,$6::uuid)
    AND (($7='practitioner' AND cs.practitioner_account_id=$8) OR ($7='parent' AND au.published AND au.visibility<>'private'
     AND EXISTS(SELECT 1 FROM ls_cases.case_guardians g WHERE g.workspace_id=a.workspace_id AND g.case_id=a.case_id AND g.account_id=$8 AND g.revoked_at IS NULL)
     AND EXISTS(SELECT 1 FROM ls_cases.audience_accounts aa WHERE aa.workspace_id=a.workspace_id AND aa.case_id=a.case_id AND aa.audience_id=a.audience_id AND aa.account_id=$8 AND aa.revoked_at IS NULL))
     OR ($7='adult_client' AND au.published AND au.visibility<>'private'
     AND EXISTS(SELECT 1 FROM ls_cases.clients cl JOIN ls_identity.account_subjects s ON s.workspace_id=cl.workspace_id AND s.person_id=cl.person_id WHERE cl.workspace_id=cs.workspace_id AND cl.id=cs.client_id AND s.account_id=$8)
     AND EXISTS(SELECT 1 FROM ls_cases.audience_accounts aa WHERE aa.workspace_id=a.workspace_id AND aa.case_id=a.case_id AND aa.audience_id=a.audience_id AND aa.account_id=$8 AND aa.revoked_at IS NULL))
     OR ($7='child' AND au.published AND au.visibility<>'private'
     AND EXISTS(SELECT 1 FROM ls_cases.clients cl JOIN ls_identity.account_subjects s ON s.workspace_id=cl.workspace_id AND s.person_id=cl.person_id WHERE cl.workspace_id=cs.workspace_id AND cl.id=cs.client_id AND s.account_id=$8)
     AND EXISTS(SELECT 1 FROM ls_cases.audience_accounts aa WHERE aa.workspace_id=a.workspace_id AND aa.case_id=a.case_id AND aa.audience_id=a.audience_id AND aa.account_id=$8 AND aa.revoked_at IS NULL)))
    ORDER BY a.starts_at,a.id LIMIT 101`,[c.workspace,query.caseId,from,to,cursorTime,cursorId,c.actor.role,c.actor.id]);
   const items:AppointmentView[]=[];for(const r of rows.slice(0,100))items.push(await this.db.view(c,r.id));
   const last=rows[99];return {items,nextCursor:rows.length>100&&last?Buffer.from(JSON.stringify([last.startsAt.toISOString(),last.id])).toString('base64url'):null,serverNow:c.now};
  });
 }
 catalog(actor:Actor,caseId:CaseId):Promise<BookingCatalog>{return this.db.read(actor,async c=>{
  const {item,guardians}=await this.db.scope(c,caseId,true);requirePractitioner(c.actor);
  const rows=await c.tx.query<{id:AudienceId}>(`SELECT id FROM ls_cases.audiences WHERE workspace_id=$1 AND case_id=$2 AND published AND visibility<>'private' ORDER BY created_at,id LIMIT 101`,[c.workspace,caseId]);
  if(rows.length>100)throw new AppError('CONFLICT');
  const audiences:BookingCatalog['audiences']=[];
  for(const r of rows){const au=await loadAudience(c.tx,c.workspace,caseId,r.id);if(!au)continue;audienceAccess(c.actor,item,guardians,au);
   const parentIds:AccountId[]=[];for(const id of au.accountIds){if(guardians.some(g=>g.accountId===id&&!g.revoked)){try{await this.db.assertParentActive(c,id);parentIds.push(id);}catch(error){if(!(error instanceof AppError && error.code==='NOT_FOUND'))throw error;}}}
   if(item.kind==='minor'&&au.visibility==='family_full'&&parentIds.length)audiences.push({id:au.id,parentIds});
   if(item.kind==='adult'){const adult=await one(c.tx,`SELECT a.id FROM ls_identity.accounts a JOIN ls_identity.account_subjects s ON s.workspace_id=a.workspace_id AND s.account_id=a.id WHERE a.workspace_id=$1 AND a.state='active' AND a.role='adult_client' AND s.person_id=$2 AND a.id=ANY($3::uuid[])`,[c.workspace,item.clientPersonId,au.accountIds]);if(adult)audiences.push({id:au.id,parentIds:[]});}
  }
  const engagement=await one<{id:EngagementId;termsVersion:string}>(c.tx,`SELECT id,terms_version AS "termsVersion" FROM ls_cases.engagements WHERE workspace_id=$1 AND case_id=$2 AND state='active'`,[c.workspace,caseId]);
  return {audiences,engagement};
 });}
 async privateAvailability(c:TransactionContext,from:string,to:string):Promise<Availability[]> {
  const rows=await c.tx.query<Omit<Availability,'startsAt'|'endsAt'> & {startsAt:Date;endsAt:Date}>(`SELECT id,starts_at AS "startsAt",ends_at AS "endsAt",kind,version FROM ls_calendar.availability
   WHERE workspace_id=$1 AND practitioner_id=$2 AND active AND starts_at<$4 AND ends_at>$3 ORDER BY starts_at,id LIMIT 501`,[c.workspace,c.actor.id,from,to]);
  if(rows.length>500)throw new AppError('CONFLICT');return rows.map(r=>({...r,startsAt:r.startsAt.toISOString(),endsAt:r.endsAt.toISOString()}));
 }
 availability(actor:Actor,from:string,to:string){
  if(ms(to)<=ms(from)||ms(to)-ms(from)>63*86_400_000)throw new AppError('INVALID_REQUEST');
  return this.db.read(actor,async c=>{requirePractitioner(c.actor);return this.privateAvailability(c,iso(from),iso(to));});
 }
 addAvailability(actor:Actor,key:string,input:{startsAt:string;endsAt:string;kind:'open'|'blocked'}){
  const from=iso(input.startsAt),to=iso(input.endsAt);
  if(ms(to)<=ms(from)||ms(to)-ms(from)>31*86_400_000||!['open','blocked'].includes(input.kind))throw new AppError('INVALID_REQUEST');
  return this.db.command(actor,'availability:create',key,input,c=>this.db.requirePractitioner(c),async c=>{
   if(ms(to)<=ms(c.now)||ms(to)>ms(c.now)+366*86_400_000)throw new AppError('INVALID_REQUEST');
   if(input.kind==='blocked'){
    const conflicts=await one(c.tx,`SELECT a.id FROM ls_calendar.appointments a WHERE a.workspace_id=$1 AND a.practitioner_id=$2 AND a.status='scheduled'
     AND a.starts_at-a.buffer_before*interval '1 minute'<$4 AND a.ends_at+a.buffer_after*interval '1 minute'>$3
     AND NOT EXISTS (SELECT 1 FROM ls_demo.cases d WHERE d.workspace_id=a.workspace_id AND d.case_id=a.case_id) LIMIT 1`,[c.workspace,c.actor.id,from,to]);
    if(conflicts)throw new AppError('CONFLICT');
   }
   const id=randomUUID();await c.tx.query(`INSERT INTO ls_calendar.availability(id,workspace_id,practitioner_id,starts_at,ends_at,kind) VALUES($1,$2,$3,$4,$5,$6)`,[id,c.workspace,c.actor.id,from,to,input.kind]);
   await this.db.history(c,null,'availability_changed');return {id,version:1,startsAt:from,endsAt:to,kind:input.kind};
  });
 }
 removeAvailability(actor:Actor,key:string,id:string,expectedVersion:number){
  return this.db.command(actor,`availability:remove:${id}`,key,{expectedVersion},c=>this.db.requirePractitioner(c),async c=>{
   const rows=await c.tx.query(`UPDATE ls_calendar.availability SET active=false,version=version+1 WHERE workspace_id=$1 AND practitioner_id=$2 AND id=$3 AND active AND version=$4 RETURNING id`,[c.workspace,c.actor.id,id,expectedVersion]);
   if(!rows.length)throw new AppError('CONFLICT');await this.db.history(c,null,'availability_changed');return {id,active:false};
  });
 }
 private async createIn(c:TransactionContext,input:CreateBooking,original:Appointment|null=null):Promise<Appointment> {
  const {item,guardians,audience}=await this.db.audience(c,input.caseId,input.audienceId);
  const demoBatch=await demoCaseBatch(c.tx,c.workspace,input.caseId);
  const times=validateBooking(c.actor,item,guardians,audience,input,c.now);
  for(const id of input.parentIds)await this.db.assertParentActive(c,id);
  if(item.kind==='minor'&&!audience.accountIds.some(id=>guardians.some(g=>g.accountId===id&&!g.revoked)))throw new AppError('INVALID_REQUEST');
  if(item.kind==='adult'){const adult=await one(c.tx,`SELECT a.id FROM ls_identity.accounts a JOIN ls_identity.account_subjects s ON s.workspace_id=a.workspace_id AND s.account_id=a.id WHERE a.workspace_id=$1 AND a.state='active' AND a.role='adult_client' AND s.person_id=$2 AND a.id=ANY($3::uuid[])`,[c.workspace,item.clientPersonId,audience.accountIds]);if(!adult)throw new AppError('INVALID_REQUEST');}
  const engagement=original?{id:original.engagementId,termsVersion:original.termsVersion}:await one<{id:EngagementId;termsVersion:string}>(c.tx,`SELECT id,terms_version AS "termsVersion" FROM ls_cases.engagements WHERE workspace_id=$1 AND case_id=$2 AND state='active'`,[c.workspace,input.caseId]);
  if(!engagement)throw new AppError('CONFLICT');
  if(input.parentForId){
   const child=await this.db.authorized(c,input.parentForId,true);
   if(child.item.kind!=='individual'||child.item.caseId!==input.caseId)throw new AppError('NOT_FOUND');
   const childAttendance=await this.db.attendance(c,child.item);
   if((child.item.status.startsWith('canceled')||child.item.status==='rescheduled'||childAttendance?.state==='no_show'||childAttendance?.state==='canceled')&&!input.checkinExceptionReason?.trim())throw new AppError('CONFLICT');
  }
  const id=this.db.uuid(),a:Appointment={id,workspaceId:c.workspace,caseId:item.id,audienceId:audience.id,engagementId:engagement.id,
   practitionerId:item.practitionerAccountId,termsVersion:engagement.termsVersion,kind:input.kind,...times,status:'scheduled',
   parentForId:input.parentForId,originalId:original?.id??null,parentIds:[...input.parentIds],bufferBefore:input.bufferBefore,bufferAfter:input.bufferAfter,
   location:input.location,createdAt:c.now,createdBy:c.actor.id,version:1};
  if(!demoBatch){
   const slot=paddedSlot(a),windows=await this.privateAvailability(c,slot.startsAt,slot.endsAt);
   const busy=await c.tx.query<{startsAt:Date;endsAt:Date}>(`SELECT a.starts_at-a.buffer_before*interval '1 minute' AS "startsAt",a.ends_at+a.buffer_after*interval '1 minute' AS "endsAt" FROM ls_calendar.appointments a
    WHERE a.workspace_id=$1 AND a.practitioner_id=$2 AND a.status='scheduled' AND a.starts_at-a.buffer_before*interval '1 minute'<$4 AND a.ends_at+a.buffer_after*interval '1 minute'>$3
    AND NOT EXISTS (SELECT 1 FROM ls_demo.cases d WHERE d.workspace_id=a.workspace_id AND d.case_id=a.case_id)`,[c.workspace,c.actor.id,slot.startsAt,slot.endsAt]);
   assertAvailable(slot,windows,busy.map(r=>({startsAt:r.startsAt.toISOString(),endsAt:r.endsAt.toISOString()})));
  }
  await c.tx.query(`INSERT INTO ls_calendar.appointments(id,workspace_id,case_id,audience_id,engagement_id,practitioner_id,terms_version,kind,starts_at,ends_at,status,
   parent_for_id,original_id,parent_ids,buffer_before,buffer_after,location_ciphertext,created_by,created_at,checkin_exception_ciphertext)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'scheduled',$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
   [a.id,c.workspace,a.caseId,a.audienceId,a.engagementId,a.practitionerId,a.termsVersion,a.kind,a.startsAt,a.endsAt,a.parentForId,a.originalId,a.parentIds,a.bufferBefore,a.bufferAfter,
    this.db.encrypt(c,'location',id,a.location),c.actor.id,c.now,input.checkinExceptionReason?this.db.encrypt(c,'checkin',id,input.checkinExceptionReason):null]);
  if(demoBatch)await c.tx.query(`INSERT INTO ls_demo.records(workspace_id,batch_id,entity_kind,entity_key,source_key,case_id)
   VALUES($1,$2,'appointment',$3,$3,$4)`,[c.workspace,demoBatch,a.id,a.caseId]);
  await this.db.event(c,a,`appointment:${id}:1`,{type:'appointment_changed',appointmentId:id,version:1,occurredAt:c.now});
  await this.db.history(c,a,'booked');return a;
 }
 create(actor:Actor,key:string,input:CreateBooking){return this.db.command(actor,'booking:create',key,input,async c=>{
  await this.db.scope(c,input.caseId,true);await this.db.audience(c,input.caseId,input.audienceId);
 },async c=>{const a=await this.createIn(c,input);return this.db.view(c,a.id);});}
 private async credit(c:TransactionContext,a:Appointment,n:Notice|null,effect:CreditEffectReference['effect'],suffix:string){
  if(a.kind!=='individual')return; // Joint-parent guidance is not a second child-session credit.
  const key=effect==='consume'||effect==='restore'?`credit:${a.id}:${effect}`:`credit:${a.id}:${effect}:${suffix}`;
  const reference:CreditEffectReference={schemaVersion:1,caseId:a.caseId,appointmentId:a.id,rescheduleRequestId:n?.id??null,termsVersion:a.termsVersion,
   effect,idempotencyKey:key,actorAccountId:c.actor.id,occurredAt:c.now};
  await this.db.event(c,a,key,{type:'credit_effect',reference});
 }
 private async preserve(c:TransactionContext,a:Appointment,n:Notice|null,suffix:string){
  await this.credit(c,a,n,'preserve',suffix);
  const consumed=await one(c.tx,`SELECT id FROM ls_calendar.events WHERE workspace_id=$1 AND event_key=$2`,[c.workspace,`credit:${a.id}:consume`]);
  if(consumed)await this.credit(c,a,n,'restore',suffix);
 }
 private async parentNoticeAuthorization(c:TransactionContext,id:AppointmentId,manual:boolean){
  const result=await this.db.authorized(c,id,manual);
  if(!manual && c.actor.role!=='parent')throw new AppError('FORBIDDEN');
  if(!manual && (result.audience.visibility!=='family_full'||!result.audience.published))throw new AppError('NOT_FOUND');
  return result;
 }
 /** receivedAt is captured immediately after the bounded, valid body is received, before authentication/database waits; never accepted from parent JSON. */
 receiveNotice(actor:Actor,id:AppointmentId,key:string,input:NoticeInput,receivedAt:Date){return this.noticeCommand(actor,id,key,input,receivedAt,null);}
 receiveManualNotice(actor:Actor,id:AppointmentId,key:string,input:ManualNoticeInput){return this.noticeCommand(actor,id,key,input,new Date(ms(input.receivedAt)),input);}
 private noticeCommand(actor:Actor,id:AppointmentId,key:string,input:NoticeInput,receivedAt:Date,manual:ManualNoticeInput|null){
  const operation=`notice:${manual?'manual':'app'}:${id}`;
  return this.db.command(actor,operation,key,input,c=>this.parentNoticeAuthorization(c,id,manual!==null),async c=>{
   const {item:a,caseFacts,guardians,audience}=await this.parentNoticeAuthorization(c,id,manual!==null);
   if(!Number.isFinite(receivedAt.valueOf()) || receivedAt.valueOf()>ms(c.now))throw new AppError('UNAVAILABLE');
   const requestedBy=manual?.requestedBy??c.actor.id;
   if(manual){const parent=await this.db.assertParentActive(c,requestedBy);audienceAccess(parent,caseFacts,guardians,audience);if(audience.visibility!=='family_full')throw new AppError('NOT_FOUND');}
   const previous=await this.db.notice(c,a);
   // Earliest receipt remains authoritative. A practitioner may supplement with earlier verifiable phone/WhatsApp notice; old rows are immutable.
   if(previous && (!manual || ms(previous.receivedAt)<=receivedAt.valueOf()))return this.db.view(c,id);
   const fields=makeNoticeFields(a,input,receivedAt.toISOString(),c.now),noticeId=asId(randomUUID(),'reschedule_request');
   const n:Notice={...fields,id:noticeId,appointmentId:id,caseId:a.caseId,requestedBy,enteredBy:c.actor.id,source:manual?.source??'app',state:input.kind==='reschedule'?'pending':'closed',replacementId:null};
   await c.tx.query(`INSERT INTO ls_calendar.notices(id,workspace_id,case_id,appointment_id,kind,source,received_at,recorded_at,original_start,notice_milliseconds,
    requested_by,entered_by,terms_version,eligibility,state,proposed_windows) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb)`,
    [n.id,c.workspace,a.caseId,a.id,n.kind,n.source,n.receivedAt,n.recordedAt,n.originalStart,n.noticeMilliseconds,n.requestedBy,n.enteredBy,n.termsVersion,n.eligibility,n.state,JSON.stringify(n.proposedWindows)]);
   if(a.status==='scheduled')await this.db.setStatus(c,a,'canceled_family');
   const reference:RescheduleEligibilityReference={schemaVersion:1,workspaceId:c.workspace,caseId:a.caseId,requestId:n.id,appointmentId:id,receivedAt:n.receivedAt,
    originalStart:n.originalStart,source:n.source,requestedByAccountId:n.requestedBy,termsVersion:n.termsVersion,eligibility:n.eligibility};
   await this.db.event(c,a,`notice:${n.id}`,{type:'notice_received',reference});
   if(n.eligibility==='credit_preserved'||await this.db.protectedByException(c,a))await this.preserve(c,a,n,n.id);else await this.credit(c,a,n,'consume',n.id);
   await this.db.history(c,a,'notice_received');return this.db.view(c,id);
  });
 }
 confirmReplacement(actor:Actor,id:AppointmentId,key:string,input:{expectedVersion:number;booking:CreateBooking}){
  return this.db.command(actor,`replacement:${id}`,key,input,c=>this.db.authorized(c,id,true),async c=>{
   const {item:a}=await this.db.authorized(c,id,true),n=await this.db.notice(c,a);
   if(a.version!==input.expectedVersion||!n||n.kind!=='reschedule'||n.state!=='pending'||a.status==='rescheduled')throw new AppError('CONFLICT');
   if(n.eligibility==='late_notice' && !await this.db.protectedByException(c,a))throw new AppError('CONFLICT');
   if(input.booking.caseId!==a.caseId||input.booking.kind!==a.kind)throw new AppError('INVALID_REQUEST');
   const actual=await this.db.attendance(c,a);if(actual?.attended)throw new AppError('CONFLICT');
   const replacement=await this.createIn(c,input.booking,a);
   await c.tx.query(`UPDATE ls_calendar.notices SET state='confirmed',replacement_id=$3 WHERE workspace_id=$1 AND id=$2`,[c.workspace,n.id,replacement.id]);
   await this.db.setStatus(c,a,'rescheduled');await this.db.history(c,a,'notice_resolved');
   return {original:await this.db.view(c,id),replacement:await this.db.view(c,replacement.id)};
  });
 }
 closeRequest(actor:Actor,id:AppointmentId,key:string,expectedVersion:number){
  return this.db.command(actor,`request:close:${id}`,key,{expectedVersion},c=>this.db.authorized(c,id,true),async c=>{
   const {item:a}=await this.db.authorized(c,id,true),n=await this.db.notice(c,a);
   if(a.version!==expectedVersion||!n||n.state!=='pending')throw new AppError('CONFLICT');
   await c.tx.query(`UPDATE ls_calendar.notices SET state='closed' WHERE workspace_id=$1 AND id=$2`,[c.workspace,n.id]);
   await this.db.setStatus(c,a,a.status);await this.db.history(c,a,'notice_resolved');return this.db.view(c,id);
  });
 }
 logistics(actor:Actor,id:AppointmentId,key:string,input:{expectedVersion:number;location:string}){
  return this.db.command(actor,`logistics:${id}`,key,input,c=>this.db.authorized(c,id,true),async c=>{
   const {item:a}=await this.db.authorized(c,id,true);
   if(a.version!==input.expectedVersion)throw new AppError('CONFLICT');
   await c.tx.query('UPDATE ls_calendar.appointments SET location_ciphertext=$3,version=version+1 WHERE workspace_id=$1 AND id=$2',[c.workspace,id,this.db.encrypt(c,'location',id,input.location)]);
   await this.db.history(c,a,'logistics_changed');await this.db.event(c,a,`appointment:${id}:${a.version+1}`,{type:'appointment_changed',appointmentId:id,version:a.version+1,occurredAt:c.now});return this.db.view(c,id);
  });
 }
 private async exceptionIn(c:TransactionContext,a:Appointment,reasonCode:'practitioner_exception'|'provider_unavailable',reason:string){
  if(!reason.trim()||reason.length>500)throw new AppError('INVALID_REQUEST');
  if(!await this.db.protectedByException(c,a)){
   const id=randomUUID();await c.tx.query(`INSERT INTO ls_calendar.credit_exceptions(id,workspace_id,case_id,appointment_id,reason_code,reason_ciphertext,recorded_by,recorded_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
    [id,c.workspace,a.caseId,a.id,reasonCode,this.db.encrypt(c,'exception',id,reason),c.actor.id,c.now]);
   const n=await this.db.notice(c,a);await this.preserve(c,a,n,'exception');await this.db.history(c,a,'credit_exception',reason);
  }
 }
 grantException(actor:Actor,id:AppointmentId,key:string,input:{expectedVersion:number;reason:string}){
  return this.db.command(actor,`exception:${id}`,key,input,c=>this.db.authorized(c,id,true),async c=>{
   const {item:a}=await this.db.authorized(c,id,true);if(a.version!==input.expectedVersion)throw new AppError('CONFLICT');
   await this.exceptionIn(c,a,'practitioner_exception',input.reason);await this.db.setStatus(c,a,a.status);return this.db.view(c,id);
  });
 }
 cancelProvider(actor:Actor,id:AppointmentId,key:string,input:{expectedVersion:number;reason:string}){
  return this.db.command(actor,`provider:cancel:${id}`,key,input,c=>this.db.authorized(c,id,true),async c=>{
   const {item:a}=await this.db.authorized(c,id,true);if(a.version!==input.expectedVersion||a.status==='rescheduled')throw new AppError('CONFLICT');
   if((await this.db.attendance(c,a))?.attended)throw new AppError('CONFLICT');
   await this.exceptionIn(c,a,'provider_unavailable',input.reason);await this.db.setStatus(c,a,'canceled_practitioner');await this.db.history(c,a,'provider_canceled',input.reason);return this.db.view(c,id);
  });
 }
 recordAttendance(actor:Actor,id:AppointmentId,key:string,input:AttendanceInput){
  return this.db.command(actor,`attendance:${id}`,key,input,c=>this.db.authorized(c,id,true),async c=>{
   const {item:a}=await this.db.authorized(c,id,true),prior=await this.db.attendance(c,a),value=validateAttendance(a,prior,input,c.now);
   const values=[c.workspace,a.caseId,id,value.state,value.attended,value.arrivedAt,value.version,c.actor.id,c.now];
   await c.tx.query(`INSERT INTO ls_attendance.records(workspace_id,case_id,appointment_id,state,attended,arrived_at,version,recorded_by,recorded_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(workspace_id,appointment_id) DO UPDATE SET state=EXCLUDED.state,attended=EXCLUDED.attended,arrived_at=EXCLUDED.arrived_at,version=EXCLUDED.version,recorded_by=EXCLUDED.recorded_by,recorded_at=EXCLUDED.recorded_at`,values);
   await c.tx.query(`INSERT INTO ls_attendance.history(workspace_id,case_id,appointment_id,state,attended,arrived_at,version,recorded_by,recorded_at,correction_ciphertext)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[...values,input.correctionReason?this.db.encrypt(c,'attendance',`${id}:${value.version}`,input.correctionReason):null]);
   await this.db.event(c,a,`attendance:${id}:${value.version}`,{type:'attendance_recorded',appointmentId:id,state:value.state,attended:value.attended,version:value.version,occurredAt:c.now});
   // Attendance observations never erase an existing protection or exception. Corrections do not silently restore credits.
   const notice=await this.db.notice(c,a),protectedCredit=notice?.eligibility==='credit_preserved'||await this.db.protectedByException(c,a);
   if(['present','late','no_show'].includes(value.state)&&!protectedCredit)await this.credit(c,a,notice,'consume','attendance');
   if(a.status==='scheduled' && value.state!=='canceled')await this.db.setStatus(c,a,'completed');
   return this.db.view(c,id);
  });
 }
 attendanceHistory(actor:Actor,id:AppointmentId,beforeVersion:number|null){return this.db.read(actor,async c=>{
  await this.db.authorized(c,id,true);
  const rows=await c.tx.query<{state:string;attended:boolean;arrivedAt:Date|null;version:number;recordedAt:Date;recordedBy:AccountId;reason:string|null}>(`SELECT state,attended,arrived_at AS "arrivedAt",version,recorded_at AS "recordedAt",recorded_by AS "recordedBy",correction_ciphertext AS reason
   FROM ls_attendance.history WHERE workspace_id=$1 AND appointment_id=$2 AND ($3::integer IS NULL OR version<$3) ORDER BY version DESC LIMIT 101`,[c.workspace,id,beforeVersion]);
  return {items:rows.slice(0,100).map(r=>({...r,arrivedAt:r.arrivedAt?.toISOString()??null,recordedAt:r.recordedAt.toISOString(),reason:r.reason?this.db.decrypt(c,'attendance',`${id}:${r.version}`,r.reason):null})),nextVersion:rows.length>100?rows[99]!.version:null};
 });}
 childAttendanceCount(actor:Actor,caseId:CaseId){return this.db.read(actor,async c=>{
  await this.db.scope(c,caseId);
  const row=await one<{count:string}>(c.tx,`SELECT count(*) AS count FROM ls_attendance.records r JOIN ls_calendar.appointments a ON a.workspace_id=r.workspace_id AND a.id=r.appointment_id
   JOIN ls_cases.audiences au ON au.workspace_id=a.workspace_id AND au.case_id=a.case_id AND au.id=a.audience_id
   WHERE r.workspace_id=$1 AND r.case_id=$2 AND a.kind='individual' AND r.attended AND ($3='practitioner' OR (au.published AND au.visibility<>'private' AND EXISTS(SELECT 1 FROM ls_cases.audience_accounts aa WHERE aa.workspace_id=a.workspace_id AND aa.case_id=a.case_id AND aa.audience_id=a.audience_id AND aa.account_id=$4 AND aa.revoked_at IS NULL)))`,[c.workspace,caseId,c.actor.role,c.actor.id]);
  return {attendedChildSessions:Number(row?.count??0),basis:'attendance_only' as const,serverNow:c.now};
 });}
}
