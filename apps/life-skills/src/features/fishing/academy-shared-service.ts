import 'server-only';
import {AppError} from '../../lib/errors.ts';
import {one,type SqlSession} from '../identity/store.ts';
import type {Keyring} from '../identity/crypto.ts';
import {digest} from '../fishing-payments/domain.ts';
import {AcademyGroupPublicationStore} from './academy-group-calendar-publication-store.ts';
import {academyGroupPublicationVersion} from './academy-group-calendar-publication-contract.ts';
import {academySharedServiceVersion,academySharedServiceEvidenceSchema,type AcademySharedServiceEvidence} from './academy-shared-service-contract.ts';

type Authority={workspaceId:string;operatorId:string;cohortId:string;stageId:string;purchaseId:string;purchaseLineId:string;learnerId:string;enrollmentId:string|null;enrollmentRevision:number|null;guardianSha256:string|null;originals:readonly {id:string;sha256:string}[]};
function requireFact(v:unknown):asserts v{if(!v)throw new AppError('UNAVAILABLE');}
/** Called only after fresh native enrollment/guardian/purchase-scope authority
 * in the SAME transaction. Read-only sealed-journal composition, no second
 * ledger, fabricated Stage revision, financial effect or activity fulfillment. */
export async function readAcademySharedServices(tx:SqlSession,ring:Keyring,authority:Authority,now:Date):Promise<AcademySharedServiceEvidence[]>{
 const a=authority;requireFact(Number.isFinite(now.valueOf())&&new Set(a.originals.map(o=>o.id)).size===a.originals.length);
 const store=new AcademyGroupPublicationStore(tx,ring);if(!await store.configured())return [];const result:AcademySharedServiceEvidence[]=[];
 for(const original of a.originals){const bindings=await store.bindings(a.workspaceId,original.id);if(!bindings.length)continue;requireFact(bindings.length===1);const current=bindings[0]!,saved=await store.publication(a.workspaceId,current.eventId,current.revision);requireFact(saved);
  const link=current.originals.find(o=>o.selection.occurrenceId===original.id);requireFact(link&&link.selection.cohortId===a.cohortId&&link.selection.stageId===a.stageId&&link.originalSha256===original.sha256&&current.operatorId===a.operatorId);
  const member=current.members.find(m=>m.enrollmentId===a.enrollmentId&&m.learnerId===a.learnerId&&m.originalOccurrenceId===original.id);
  if(member)requireFact(member.purchaseId===a.purchaseId&&member.purchaseLineId===a.purchaseLineId&&member.enrollmentRevision===a.enrollmentRevision);
  const review=await store.review(a.workspaceId,current.sourceReviewId);requireFact(review&&review.sha256===current.sourceReviewSha256);
  const sourceReady=!review.revoked&&Date.parse(review.record.approval.approvedAt)<=Date.parse(current.recordedAt)&&Date.parse(review.record.approval.expiresAt)>=Date.parse(current.trip.endsAt)&&!!await one(tx,"SELECT id FROM ls_identity.accounts WHERE workspace_id=$1 AND id=$2 AND role='practitioner' AND state='active' AND email_verified_at<=clock_timestamp() FOR SHARE",[a.workspaceId,review.record.approval.approvedBy]);
  const attendance=member?.participation.kind==='keys'?await store.attendance(a.workspaceId,current.eventId,a.learnerId):null;
  if(attendance){const r=attendance.record,receipt=await store.replay(a.workspaceId,r.actorId,{version:academyGroupPublicationVersion,action:'attendance',operationId:r.operationId,eventId:r.eventId,expectedPublicationRevision:r.publicationRevision,learnerId:r.learnerId,expectedAttendanceRevision:r.revision-1,state:r.state,reason:r.reason});requireFact(receipt&&receipt.attendanceId===r.id&&receipt.sha256===attendance.sha256&&r.actorId===current.operatorId&&r.enrollmentId===a.enrollmentId&&r.originalOccurrenceId===original.id);}
  if(current.state==='completed'){requireFact(current.reason);const receipt=await store.replay(a.workspaceId,current.operatorId,{version:academyGroupPublicationVersion,action:'complete',operationId:current.operationId,eventId:current.eventId,expectedPublicationRevision:current.revision-1,reason:current.reason});requireFact(receipt&&receipt.publicationId===current.id&&receipt.sha256===saved.sha256);}
  const recordedOnce=current.state==='completed'&&Date.parse(current.trip.endsAt)<=now.valueOf()&&!!attendance&&['present','late'].includes(attendance.record.state);
  let state:AcademySharedServiceEvidence['state']='review_required';
  if(sourceReady&&member&&member.guardianDigest===a.guardianSha256){
   if(current.state==='cancelled')state='cancelled';
   else if(member.participation.kind==='local_alternative')state='local_alternative';
   else if(member.participation.kind==='keys')state=recordedOnce?'credited':current.state==='completed'&&attendance?'not_attended':current.state==='published'&&Date.parse(current.trip.startsAt)>now.valueOf()&&!attendance?'pending':'review_required';
  }
  result.push(academySharedServiceEvidenceSchema.parse({version:academySharedServiceVersion,originalOccurrenceId:original.id,purchaseId:a.purchaseId,purchaseLineId:a.purchaseLineId,learnerId:a.learnerId,enrollmentId:a.enrollmentId,eventId:current.eventId,publicationId:current.id,publicationRevision:current.revision,publicationSha256:saved.sha256,bindingSha256:digest({link,member:member??null}),sourceReviewSha256:review.sha256,sourceRevoked:review.revoked,startsAt:current.trip.startsAt,endsAt:current.trip.endsAt,state,recordedOnce,attendance:attendance?{id:attendance.record.id,revision:attendance.record.revision,sha256:attendance.sha256,state:attendance.record.state}:null}));
 }
 return result;
}
