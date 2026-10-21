import 'server-only';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {AppError} from '../../lib/errors.ts';
import type {IdentityConfig} from '../identity/config.ts';
import {one,type IdentityStore,type SqlSession} from '../identity/store.ts';
import {unseal} from '../identity/crypto.ts';
import {systemClock,type Actor,type IdentityClock} from '../identity/types.ts';
import {digest,type MerchantBinding} from '../fishing-payments/domain.ts';
import {assertAvailable} from '../calendar/policy.ts';
import {NativeFishingProgram} from './native-program.ts';
import {FishingProgramError} from './native-program-contract.ts';
import {AcademyGroupCalendarStore} from './academy-group-calendar-store.ts';
import {AcademyGroupPublicationStore} from './academy-group-calendar-publication-store.ts';
import {readTravelActivity,travelDigest} from './academy-travel-credit-source.ts';
import {AcademySessionCreditStore} from '../fishing-stage/academy-session-credit-store.ts';
import {verifyAcademySharedTravelDeclaration} from './academy-shared-travel.ts';
import {readAcademySharedPhysicalEvents,academySharedResourceClash,academySharedTeachingEvents} from './academy-group-calendar-publication-fence.ts';
import {academyFloridaDay,academyOperatorDayViolations} from './academy-operator-day.ts';
import {academyGroupPublicationVersion,academyKeysCommandSchema,academyKeysPublicationSchema,academyKeysAttendanceRecordSchema,academyKeysReceiptSchema,type AcademyKeysCommand,type AcademyKeysPublication,type AcademyKeysSourceReview,type AcademyKeysReceipt} from './academy-group-calendar-publication-contract.ts';

function requireFact(v:unknown,code:'CONFLICT'|'FORBIDDEN'|'NOT_FOUND'|'UNAVAILABLE'='CONFLICT'):asserts v{if(!v)throw new AppError(code);}
function clean(error:unknown):never{
 if(error instanceof AppError)throw error;if(error instanceof FishingProgramError)throw new AppError(error.code==='CAPACITY'||error.code==='POLICY_REQUIRED'||error.code==='APPROVAL_REQUIRED'?'CONFLICT':error.code);
 if(error&&typeof error==='object'&&'code'in error&&['23505','40001','40P01'].includes(String(error.code)))throw new AppError('CONFLICT');throw new AppError('UNAVAILABLE');
}
/** Native transaction service only. No source importer, environment lookup,
 * routes, runtime factory, provider, financial mutation or production admission.
 * Merchant defaults to unavailable; only an independently admitted server
 * binding can support paid-member proof. Caller submits selectors, not approval. */
export class AcademyGroupPublicationService{
 private program:NativeFishingProgram;
 constructor(private db:IdentityStore,private config:IdentityConfig,merchant:MerchantBinding|null=null,private clock:IdentityClock=systemClock){this.program=new NativeFishingProgram(db,config.keyring,{childAccountsEnabled:config.childAccountsEnabled===true,merchant},clock);}
 private async validateReview(tx:SqlSession,actor:Actor,store:AcademyGroupPublicationStore,review:AcademyKeysSourceReview,sha256:string,currentSnapshots:boolean,now:Date){
  const saved=await store.review(actor.workspaceId,review.id);requireFact(saved&&!saved.revoked&&saved.sha256===sha256&&digest(review)===sha256,'CONFLICT');
  requireFact(review.workspaceId===actor.workspaceId&&Date.parse(review.approval.approvedAt)<=now.valueOf()&&Date.parse(review.approval.expiresAt)>=Date.parse(review.trip.endsAt),'CONFLICT');
  requireFact(await one(tx,"SELECT id FROM ls_identity.accounts WHERE workspace_id=$1 AND id=$2 AND role='practitioner' AND state='active' AND email_verified_at<=clock_timestamp() FOR SHARE",[actor.workspaceId,review.approval.approvedBy]),'FORBIDDEN');
  const current=await this.program.calendarPublicationOriginalsInTransaction(tx,actor,review.originals,currentSnapshots),selections=currentSnapshots?current:review.members.map(m=>({selectedEnrollmentId:m.enrollmentId,originalOccurrenceId:m.originalOccurrenceId})),members=new Map(review.members.map(m=>[m.enrollmentId+'/'+m.originalOccurrenceId,m]));
  requireFact(members.size===review.members.length&&members.size===selections.length,'CONFLICT');
  for(const selection of selections){const member=members.get(selection.selectedEnrollmentId+'/'+selection.originalOccurrenceId);requireFact(member,'CONFLICT');
   const obligation=await this.program.readSessionCreditObligationInTransaction(tx,actor,selection),o=obligation.original;
   requireFact(obligation.payment.state==='verified_fully_paid'&&obligation.enrollmentId===member.enrollmentId&&obligation.enrollmentRevision===member.enrollmentRevision&&obligation.learnerId===member.learnerId&&obligation.purchaseId===member.purchaseId&&obligation.purchaseLineId===member.purchaseLineId&&obligation.guardianDigest===member.guardianDigest&&obligation.payment.evidenceSha256===member.paymentEvidenceSha256&&obligation.acceptedTermsVersion===member.acceptedTermsVersion,'CONFLICT');
   requireFact(obligation.delivery.chain.length===1&&(currentSnapshots?obligation.delivery.state==='undelivered':['purchased_session_undelivered','past_session_unresolved'].includes(obligation.delivery.reason)),'CONFLICT');
   const activity=await readTravelActivity(tx,this.config.keyring,{workspaceId:actor.workspaceId,templateApprovalId:o.templateApprovalId,templateSourceSha256:o.templateSourceSha256,moduleId:o.moduleId,moduleVersion:o.moduleVersion},now);
   requireFact(activity&&activity.id===member.originalActivityBindingId&&travelDigest(activity)===member.originalActivitySha256,'CONFLICT');
   if(member.participation.kind!=='keys'&&member.participation.retainedCreditId!==null){
    const retainedCreditId=member.participation.retainedCreditId,credit=(await new AcademySessionCreditStore(tx,this.config.keyring).selected(actor.workspaceId,member.enrollmentId,member.learnerId)).find(c=>c.id===retainedCreditId);
    requireFact(credit&&credit.state!=='delivered'&&credit.purchaseId===member.purchaseId&&credit.purchaseLineId===member.purchaseLineId&&credit.anchor.workspaceId===actor.workspaceId&&credit.anchor.learnerId===member.learnerId&&credit.anchor.cohortId===o.cohortId&&credit.anchor.stageId===o.stageId&&credit.anchor.occurrenceId===o.occurrenceId&&credit.anchor.ordinal===o.ordinal&&credit.anchor.moduleId===o.moduleId&&credit.anchor.moduleVersion===o.moduleVersion&&credit.anchor.activityId===activity.activityId,'CONFLICT');
   }
   // All members retain their paid original and activity obligations. A
   // separate physical-change/guardian/root-credit adapter must authenticate
   // local alternatives; a source review alone cannot impersonate that parent.
   if(member.participation.kind==='local_alternative'){
    await verifyAcademySharedTravelDeclaration(tx,this.config,this.program,actor,{enrollmentId:member.enrollmentId,learnerId:member.learnerId,originalOccurrenceId:member.originalOccurrenceId,eventId:review.eventId,tripSha256:travelDigest(review.trip),declarationId:member.participation.guardianDeclarationId,declarationSha256:member.participation.guardianDeclarationSha256,creditId:member.participation.retainedCreditId,activityBindingId:member.originalActivityBindingId},currentSnapshots,now);
   }
  }
 }
 private async resources(tx:SqlSession,actor:Actor,value:AcademyKeysPublication,now:Date){
  const trip=value.trip,shared=await readAcademySharedPhysicalEvents(tx,this.config.keyring,actor.workspaceId),before=shared.find(e=>e.eventId===value.eventId);
  if(before){const identity=(items:AcademyKeysPublication['originals'])=>items.map(o=>Object.fromEntries(Object.entries(o).filter(([key])=>key!=='planRevision')));requireFact(digest(identity(before.originals))===digest(identity(value.originals)),'CONFLICT');for(const member of before.members)requireFact(value.members.some(m=>m.learnerId===member.learnerId&&m.enrollmentId===member.enrollmentId&&m.purchaseId===member.purchaseId&&m.purchaseLineId===member.purchaseLineId&&m.originalOccurrenceId===member.originalOccurrenceId),'CONFLICT');}
  requireFact(shared.every(e=>e.eventId===value.eventId||!e.originals.some(o=>value.originals.some(n=>n.selection.occurrenceId===o.selection.occurrenceId))),'CONFLICT');
  const displaced=new Set([...shared.flatMap(e=>e.originals),...value.originals].map(o=>o.selection.occurrenceId)),ordinary=(await this.program.calendarPublicationTeachingInTransaction(tx,actor)).filter(o=>!displaced.has(o.id)),others=shared.filter(e=>e.eventId!==value.eventId);
  const teaching=[...ordinary,...academySharedTeachingEvents(others,actor.id,actor.id),{id:value.eventId,kind:'keys' as const,startsAt:trip.startsAt,endsAt:trip.endsAt}];
  requireFact(!academyOperatorDayViolations(teaching,new Set([academyFloridaDay(trip.startsAt)])).length,'CONFLICT');
  const venue=await one<{operatorId:string;capacity:number;ciphertext:string}>(tx,'SELECT operator_id AS "operatorId",capacity,details_ciphertext AS ciphertext FROM ls_fishing_stage.venues WHERE workspace_id=$1 AND id=$2 AND active FOR SHARE',[actor.workspaceId,trip.venueId]);requireFact(venue&&venue.operatorId===actor.id&&venue.capacity>=trip.approvedChildCapacity,'CONFLICT');
  let address:string;try{address=z.object({address:z.string()}).parse(JSON.parse(unseal(venue.ciphertext,`fishing-program:v1:venue:${actor.workspaceId}:${trip.venueId}`,this.config.keyring))).address;}catch{throw new AppError('UNAVAILABLE');}requireFact(address===trip.address,'CONFLICT');
  const originals=new Set(value.originals.map(o=>o.selection.occurrenceId));
  for(const [kind,id]of [...trip.qualifiedAdultAccountIds.map(id=>['instructor',id]as const),['venue',trip.venueId]as const]){
   requireFact(!academySharedResourceClash(shared,kind,id,trip.startsAt,trip.endsAt,value.eventId),'CONFLICT');
   const clashes=await tx.query<{id:string}>('SELECT occurrence_id AS id FROM ls_fishing_stage.resource_reservations WHERE workspace_id=$1 AND kind=$2 AND resource_id=$3 AND active AND starts_at<$5::timestamptz AND ends_at>$4::timestamptz ORDER BY occurrence_id LIMIT 1001 FOR UPDATE',[actor.workspaceId,kind,id,trip.startsAt,trip.endsAt]);requireFact(clashes.length<=1000,'UNAVAILABLE');requireFact(clashes.every(c=>originals.has(c.id)),'CONFLICT');
   if(kind==='instructor'){
    requireFact(await one(tx,"SELECT a.id FROM ls_identity.accounts a JOIN ls_identity.account_subjects s ON s.workspace_id=a.workspace_id AND s.account_id=a.id JOIN ls_identity.people p ON p.workspace_id=s.workspace_id AND p.id=s.person_id WHERE a.workspace_id=$1 AND a.id=$2 AND a.state='active' AND a.role<>'child' AND a.email_verified_at<=$3 AND p.kind='adult' FOR SHARE OF a,s,p",[actor.workspaceId,id,now]),'CONFLICT');
    const windows=await tx.query<{id:string;version:number;kind:'open'|'blocked';startsAt:Date;endsAt:Date}>('SELECT id,version,kind,starts_at AS "startsAt",ends_at AS "endsAt" FROM ls_calendar.availability WHERE workspace_id=$1 AND practitioner_id=$2 AND active AND starts_at<$4::timestamptz AND ends_at>$3::timestamptz ORDER BY starts_at,id LIMIT 501 FOR SHARE',[actor.workspaceId,id,trip.startsAt,trip.endsAt]);requireFact(windows.length<=500,'UNAVAILABLE');
    const clinical=await tx.query<{startsAt:Date;endsAt:Date}>(`SELECT a.starts_at-a.buffer_before*interval '1 minute' AS "startsAt",a.ends_at+a.buffer_after*interval '1 minute' AS "endsAt" FROM ls_calendar.appointments a WHERE a.workspace_id=$1 AND a.practitioner_id=$2 AND a.status='scheduled' AND a.starts_at-a.buffer_before*interval '1 minute'<$4::timestamptz AND a.ends_at+a.buffer_after*interval '1 minute'>$3::timestamptz AND NOT EXISTS(SELECT 1 FROM ls_demo.cases d WHERE d.workspace_id=a.workspace_id AND d.case_id=a.case_id) LIMIT 1001 FOR SHARE OF a`,[actor.workspaceId,id,trip.startsAt,trip.endsAt]);requireFact(clinical.length<=1000,'UNAVAILABLE');
    assertAvailable(trip,windows.map(w=>({...w,startsAt:w.startsAt.toISOString(),endsAt:w.endsAt.toISOString()})),clinical.map(c=>({startsAt:c.startsAt.toISOString(),endsAt:c.endsAt.toISOString()})));
   }
  }
  for(const o of value.originals)await tx.query('UPDATE ls_fishing_stage.resource_reservations SET active=false WHERE workspace_id=$1 AND occurrence_id=$2',[actor.workspaceId,o.selection.occurrenceId]);
 }
 async execute(actor:Actor,raw:unknown){const command=academyKeysCommandSchema.parse(raw);
  try{return await this.db.transaction(async tx=>{
   const initial=await this.program.calendarPublicationOwnerInTransaction(tx,actor),now=initial.now,store=new AcademyGroupPublicationStore(tx,this.config.keyring),draftStore=new AcademyGroupCalendarStore(tx,this.config.keyring);requireFact(await store.configured(),'UNAVAILABLE');
   const draft=await draftStore.read(actor.workspaceId,command.eventId);requireFact(draft&&draft.record.operatorId===actor.id,'NOT_FOUND');
   const current=await store.publication(actor.workspaceId,command.eventId);if(current){requireFact(current.record.operatorId===actor.id,'NOT_FOUND');await store.currentResources(current.record);}
   const replay=await store.replay(actor.workspaceId,actor.id,command);
   if(replay){const archived=await store.publication(actor.workspaceId,command.eventId,replay.publicationRevision);requireFact(archived&&archived.record.id===replay.publicationId,'UNAVAILABLE');
    if(command.action!=='cancel'){const review=await store.review(actor.workspaceId,archived.record.sourceReviewId);requireFact(review,'UNAVAILABLE');await this.validateReview(tx,actor,store,review.record,review.sha256,false,now);requireFact(current?.record.state!=='cancelled','CONFLICT');}
    await this.program.calendarPublicationOwnerInTransaction(tx,actor);return {receipt:{...replay,replayed:true}};
   }
   let receipt:AcademyKeysReceipt;
   if(command.action==='publish')receipt=await this.publish(tx,actor,store,draft,command,current,now);
   else{
    requireFact(current&&current.record.revision===command.expectedPublicationRevision,'CONFLICT');const old=current.record;
    if(command.action==='attendance'){
     requireFact(old.state!=='cancelled'&&Date.parse(old.trip.startsAt)<=now.valueOf(),'CONFLICT');const review=await store.review(actor.workspaceId,old.sourceReviewId);requireFact(review,'UNAVAILABLE');await this.validateReview(tx,actor,store,review.record,review.sha256,false,now);
     const member=old.members.find(m=>m.learnerId===command.learnerId);requireFact(member?.participation.kind==='keys','NOT_FOUND');const previous=await store.attendance(actor.workspaceId,command.eventId,member.learnerId);requireFact((previous?.record.revision??0)===command.expectedAttendanceRevision,'CONFLICT');
     const attendance=academyKeysAttendanceRecordSchema.parse({version:academyGroupPublicationVersion,workspaceId:actor.workspaceId,id:randomUUID(),eventId:command.eventId,publicationId:old.id,publicationRevision:old.revision,learnerId:member.learnerId,enrollmentId:member.enrollmentId,originalOccurrenceId:member.originalOccurrenceId,revision:command.expectedAttendanceRevision+1,previousSha256:previous?.sha256??null,state:command.state,reason:command.reason,actorId:actor.id,operationId:command.operationId,recordedAt:now.toISOString()}),sha256=await store.appendAttendance(attendance);
     receipt=academyKeysReceiptSchema.parse({version:academyGroupPublicationVersion,operationId:command.operationId,eventId:command.eventId,publicationId:old.id,publicationRevision:old.revision,attendanceId:attendance.id,state:'attendance_recorded',sha256,financialEffect:'none',activityFulfillment:'not_inferred'});
    }else{
     requireFact(old.state==='published','CONFLICT');if(command.action==='complete'){requireFact(Date.parse(old.trip.endsAt)<=now.valueOf(),'CONFLICT');const review=await store.review(actor.workspaceId,old.sourceReviewId);requireFact(review,'UNAVAILABLE');await this.validateReview(tx,actor,store,review.record,review.sha256,false,now);for(const m of old.members.filter(m=>m.participation.kind==='keys'))requireFact(await store.attendance(actor.workspaceId,old.eventId,m.learnerId),'CONFLICT');}
     const next=academyKeysPublicationSchema.parse({...old,id:randomUUID(),revision:old.revision+1,previousSha256:current.sha256,state:command.action==='complete'?'completed':'cancelled',operationId:command.operationId,recordedAt:now.toISOString(),reason:command.reason}),sha256=await store.appendPublication(next);await store.replaceResources(next);receipt=this.receipt(next,sha256);
    }
   }
   await store.recordCommand(actor.workspaceId,actor.id,command,receipt,now);await this.program.calendarPublicationOwnerInTransaction(tx,actor);return {receipt:{...receipt,replayed:false}};
  });}catch(error){clean(error);}
 }
 private receipt(record:AcademyKeysPublication,sha256:string){return academyKeysReceiptSchema.parse({version:academyGroupPublicationVersion,operationId:record.operationId,eventId:record.eventId,publicationId:record.id,publicationRevision:record.revision,attendanceId:null,state:record.state,sha256,financialEffect:'none',activityFulfillment:'not_inferred'});}
 private async publish(tx:SqlSession,actor:Actor,store:AcademyGroupPublicationStore,draft:NonNullable<Awaited<ReturnType<AcademyGroupCalendarStore['read']>>>,command:Extract<AcademyKeysCommand,{action:'publish'}>,current:Awaited<ReturnType<AcademyGroupPublicationStore['publication']>>,now:Date){
  requireFact(draft.record.revision===command.expectedDraftRevision&&(current?.record.revision??0)===command.expectedPublicationRevision&&current?.record.state!=='completed','CONFLICT');
  const review=await store.review(actor.workspaceId,command.sourceReviewId);requireFact(review&&!review.revoked&&review.record.eventId===command.eventId&&review.record.eventRevision===draft.record.revision&&review.record.eventSha256===draft.sha256&&digest(review.record.originals)===digest(draft.record.originals),'CONFLICT');
  requireFact(draft.record.placement.kind==='proposed'&&draft.record.placement.startsAt===review.record.trip.startsAt&&draft.record.placement.endsAt===review.record.trip.endsAt&&draft.record.placement.venueId===review.record.trip.venueId&&academyFloridaDay(review.record.trip.startsAt).slice(0,7)===draft.record.calendarMonth&&Date.parse(review.record.trip.startsAt)>now.valueOf(),'CONFLICT');
  await this.validateReview(tx,actor,store,review.record,review.sha256,true,now);
  requireFact(!await one(tx,'SELECT id FROM ls_academy_calendar.attendance WHERE workspace_id=$1 AND event_id=$2 LIMIT 1 FOR SHARE',[actor.workspaceId,command.eventId]),'CONFLICT');
  const record=academyKeysPublicationSchema.parse({version:academyGroupPublicationVersion,workspaceId:actor.workspaceId,eventId:command.eventId,id:randomUUID(),revision:command.expectedPublicationRevision+1,previousSha256:current?.sha256??null,draftRevision:draft.record.revision,draftSha256:draft.sha256,operatorId:actor.id,sourceReviewId:review.record.id,sourceReviewSha256:review.sha256,trip:review.record.trip,originals:review.record.originals,members:review.record.members,state:'published',operationId:command.operationId,recordedAt:now.toISOString(),reason:null,outcomeRights:'original_learning_outcomes_and_local_alternatives_preserved'});
  await this.resources(tx,actor,record,now);const sha256=await store.appendPublication(record);await store.replaceResources(record);return this.receipt(record,sha256);
 }
}
