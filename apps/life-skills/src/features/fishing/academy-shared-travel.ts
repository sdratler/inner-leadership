import 'server-only';
import {AppError} from '../../lib/errors.ts';
import type {IdentityConfig} from '../identity/config.ts';
import type {Actor} from '../identity/types.ts';
import {one,type SqlSession} from '../identity/store.ts';
import {digest} from '../fishing-payments/domain.ts';
import {NativeFishingProgram} from './native-program.ts';
import {AcademyGroupPublicationStore} from './academy-group-calendar-publication-store.ts';
import {AcademyTravelCreditStore} from './academy-travel-credit-store.ts';
import {travelDigest} from './academy-travel-credit-source.ts';
import {travelLogisticsSchema,academyPhysicalTravelVersion,type TravelChangeRecord} from './academy-travel-credit-contract.ts';
import type {AcademyKeysPublication} from './academy-group-calendar-publication-contract.ts';

type Selected=Awaited<ReturnType<NativeFishingProgram['readSessionCreditSelectionInTransaction']>>;
type PhysicalChange=Extract<TravelChangeRecord,{version:typeof academyPhysicalTravelVersion}>;
function requireFact(v:unknown,code:'CONFLICT'|'UNAVAILABLE'|'FORBIDDEN'='CONFLICT'):asserts v{if(!v)throw new AppError(code);}
function logistics(selected:Selected,publication:AcademyKeysPublication,stageRevision=selected.plan.revision){
 const original=selected.original;requireFact(original.time.kind==='scheduled');
 const before=travelLogisticsSchema.parse({stageRevision,occurrenceRevision:original.revision,state:original.state,time:original.time,location:original.location,sha256:digest(original)}),time={kind:'scheduled',startsAt:publication.trip.startsAt,endsAt:publication.trip.endsAt,timeZone:publication.trip.timeZone};
 const changed=travelLogisticsSchema.parse({stageRevision,occurrenceRevision:original.revision,state:publication.state==='cancelled'?'cancelled':publication.state==='completed'?'completed':'published',time,location:publication.trip.labelEn+'\n'+publication.trip.address,sha256:travelDigest(publication.trip)});
 return {before,changed,kind:before.location===changed.location?'academy_schedule' as const:'academy_venue' as const};
}
/** Called only AFTER fresh native selected-child authorization. Never projects
 * another family/member or treats old Stage logistics as this shared trip. */
export async function readAcademySharedTravel(tx:SqlSession,config:IdentityConfig,selected:Selected,now:Date){
 const store=new AcademyGroupPublicationStore(tx,config.keyring);if(!await store.configured())return null;
 const bindings=await store.bindings(selected.plan.workspaceId,selected.original.id);if(!bindings.length)return null;requireFact(bindings.length===1,'UNAVAILABLE');const publication=bindings[0]!,original=publication.originals.find(o=>o.selection.occurrenceId===selected.original.id),member=publication.members.find(m=>m.enrollmentId===selected.enrollment.id&&m.learnerId===selected.enrollment.learnerId);
 requireFact(original&&member&&publication.operatorId===selected.operatorId&&original.selection.cohortId===selected.plan.cohortId&&original.selection.stageId===selected.plan.stageId&&original.originalSha256===digest(selected.original),'CONFLICT');
 const review=await store.review(selected.plan.workspaceId,publication.sourceReviewId);requireFact(review,'UNAVAILABLE');
 const sourceReady=!review.revoked&&Date.parse(review.record.approval.approvedAt)<=now.valueOf()&&Date.parse(review.record.approval.expiresAt)>=Date.parse(publication.trip.endsAt)&&!!await one(tx,"SELECT id FROM ls_identity.accounts WHERE workspace_id=$1 AND id=$2 AND role='practitioner' AND state='active' AND email_verified_at<=clock_timestamp() FOR SHARE",[selected.plan.workspaceId,review.record.approval.approvedBy]);
 const physical={eventId:publication.eventId,publicationId:publication.id,publicationRevision:publication.revision,tripSha256:travelDigest(publication.trip)};
 return {publication,member,original,physical,sourceReady,...logistics(selected,publication)};
}
export async function validateAcademySharedTravelChange(tx:SqlSession,config:IdentityConfig,program:NativeFishingProgram,actor:Actor,selection:{selectedEnrollmentId:string;originalOccurrenceId:string},change:PhysicalChange,current:boolean,now:Date){
 const selected=await program.readSessionCreditOriginalRevisionInTransaction(tx,actor,selection,change.before.stageRevision),saved=await new AcademyGroupPublicationStore(tx,config.keyring).publication(actor.workspaceId,change.physical.eventId,change.physical.publicationRevision);
 requireFact(saved&&saved.record.id===change.physical.publicationId&&travelDigest(saved.record.trip)===change.physical.tripSha256&&saved.record.operatorId===selected.operatorId,'CONFLICT');
 const original=saved.record.originals.find(o=>o.selection.occurrenceId===selected.original.id),member=saved.record.members.find(m=>m.enrollmentId===selected.enrollment.id&&m.learnerId===selected.enrollment.learnerId);requireFact(original&&member&&digest(selected.revisionOriginal)===original.originalSha256&&digest(selected.original)===original.originalSha256,'CONFLICT');
 const expected=logistics({...selected,original:selected.revisionOriginal},saved.record,change.before.stageRevision);
 requireFact(change.workspaceId===actor.workspaceId&&change.enrollmentId===selected.enrollment.id&&change.learnerId===selected.enrollment.learnerId&&change.stageId===selected.plan.stageId&&change.originalOccurrenceId===selected.original.id&&change.operatorId===selected.operatorId&&travelDigest(change.command.physical)===travelDigest(change.physical)&&travelDigest(change.before)===travelDigest(expected.before)&&travelDigest(change.changed)===travelDigest(expected.changed)&&change.kind===expected.kind,'CONFLICT');
 if(current){const actual=await readAcademySharedTravel(tx,config,selected,now);requireFact(actual&&actual.sourceReady&&actual.publication.state==='published'&&actual.physical.eventId===change.physical.eventId&&actual.physical.tripSha256===change.physical.tripSha256,'CONFLICT');}
 return {...selected,change:{before:change.before,changed:change.changed,kind:change.kind}};
}
/** Read-only publication proof of an actual current guardian declaration. It
 * grants no booking, replacement, financial effect or legal approval. */
export async function verifyAcademySharedTravelDeclaration(tx:SqlSession,config:IdentityConfig,program:NativeFishingProgram,actor:Actor,input:{enrollmentId:string;learnerId:string;originalOccurrenceId:string;eventId:string;tripSha256:string;declarationId:string;declarationSha256:string;creditId:string|null;activityBindingId:string},currentAdoption:boolean,now:Date){
 const row=await one<{changeId:string}>(tx,'SELECT change_id AS "changeId" FROM ls_fishing_stage.academy_travel_declarations WHERE workspace_id=$1 AND id=$2 FOR SHARE',[actor.workspaceId,input.declarationId]);requireFact(row,'CONFLICT');const store=new AcademyTravelCreditStore(tx,config.keyring),change=await store.readChange(actor.workspaceId,row.changeId);requireFact(change&&change.version===academyPhysicalTravelVersion&&change.physical.eventId===input.eventId&&change.physical.tripSha256===input.tripSha256,'CONFLICT');
 const selection={selectedEnrollmentId:input.enrollmentId,originalOccurrenceId:input.originalOccurrenceId},selected=await validateAcademySharedTravelChange(tx,config,program,actor,selection,change,currentAdoption,now),declarations=await store.declarations(actor.workspaceId,change.id),declaration=declarations[0];
 // Historical saved operations still prove the current exact trip and source,
 // while completion never grants permission for a new adoption or credit.
 if(!currentAdoption){const actual=await readAcademySharedTravel(tx,config,selected,now);requireFact(actual&&actual.sourceReady&&['published','completed'].includes(actual.publication.state)&&actual.physical.eventId===change.physical.eventId&&actual.physical.tripSha256===change.physical.tripSha256,'CONFLICT');}
 requireFact(declaration&&declaration.id===input.declarationId&&travelDigest(declaration)===input.declarationSha256&&declaration.enrollmentId===input.enrollmentId&&declaration.learnerId===input.learnerId&&declaration.changeSha256===change.sha256&&declaration.familyCannotAttend,'CONFLICT');
 requireFact(declaration.guardianSha256===await program.readSessionCreditGuardianInTransaction(tx,actor,selection,declaration.parentAccountId),'FORBIDDEN');
 const receipt=await store.replay(actor.workspaceId,declaration.parentAccountId,declaration.command.operationId,declaration.command);requireFact(receipt&&receipt.declarationId===declaration.id&&receipt.changeId===change.id&&receipt.outcome!=='change_recorded'&&receipt.creditId===input.creditId,'CONFLICT');
 if(input.creditId){const notices=selected.plan.makeups.filter(m=>m.notice.enrollmentId===input.enrollmentId&&m.notice.occurrenceId===input.originalOccurrenceId);requireFact(notices.length===1&&notices[0]!.notice.entitlementId===input.creditId&&notices[0]!.notice.travelCredit?.creditId===input.creditId&&notices[0]!.notice.travelCredit?.activityBindingId===input.activityBindingId,'CONFLICT');}
 return declaration;
}
