import type {StageState} from '../fishing-stage/contract.ts';
import {FishingProgramError} from './native-program-contract.ts';
import {academyOriginalDeliverySchema,type AcademyOriginalDelivery,type AcademyOriginalDeliveryStep,type AcademyMakeupSeatProof} from './academy-original-obligation-contract.ts';

/** Projection of actual native-loaded plans and physical seats only. Its result
 * is not authority: the native caller must verify current identities, encrypted
 * history and physical provenance in the SAME transaction before calling it. */
export function projectAcademyOriginalDelivery(input:{workspaceId:string;enrollmentId:string;learnerId:string;originalOccurrenceIds:readonly string[];originalOccurrenceId:string;plans:readonly StageState[];seats:readonly AcademyMakeupSeatProof[];otherPurchasedRoots:readonly string[];now:Date}):AcademyOriginalDelivery{
 const {workspaceId,enrollmentId,learnerId,originalOccurrenceId,plans,seats,now}=input;
 if(!Number.isFinite(now.valueOf())||![4,12].includes(input.originalOccurrenceIds.length)||new Set(input.originalOccurrenceIds).size!==input.originalOccurrenceIds.length||!input.originalOccurrenceIds.includes(originalOccurrenceId)||plans.length<1||plans.length>16)throw new FishingProgramError('UNAVAILABLE');
 const entries=plans.flatMap(plan=>plan.occurrences.map(o=>({plan,o}))),occurrences=new Map(entries.map(entry=>[entry.o.id,entry]));
 if(occurrences.size!==entries.length||plans.some(p=>p.workspaceId!==workspaceId))throw new FishingProgramError('UNAVAILABLE');
 const incoming=new Map<string,number>();
 for(const plan of plans)for(const m of plan.makeups)if(m.notice.enrollmentId===enrollmentId&&m.notice.replacementOccurrenceId)incoming.set(m.notice.replacementOccurrenceId,(incoming.get(m.notice.replacementOccurrenceId)??0)+1);
 const chain:AcademyOriginalDeliveryStep[]=[],visited=new Set<string>(),entitlements=new Set<string>();let current=originalOccurrenceId,rootEntitlementId:string|null=null;
 const finish=(state:AcademyOriginalDelivery['state'],reason:AcademyOriginalDelivery['reason'])=>academyOriginalDeliverySchema.parse({state,reason,rootEntitlementId,effectiveOccurrenceId:current,chain});
 for(;;){
  if(visited.has(current)||visited.size>=12)return finish('review_required','makeup_cycle');visited.add(current);
  const entry=occurrences.get(current);if(!entry){if(chain.length)return finish('review_required','original_provenance_required');throw new FishingProgramError('UNAVAILABLE');}
  const {plan,o}=entry,attendance=plan.attendance.filter(a=>a.enrollmentId===enrollmentId&&a.occurrenceId===current).at(-1),notices=plan.makeups.filter(m=>m.notice.enrollmentId===enrollmentId&&m.notice.occurrenceId===current),notice=notices[0]?.notice??null;
  if(chain.length===0)rootEntitlementId=notice?.entitlementId??null;
  const step:AcademyOriginalDeliveryStep={stageId:plan.stageId,stageRevision:plan.revision,occurrenceId:current,occurrenceRevision:o.revision,state:o.state,moduleId:o.moduleId,moduleVersion:o.moduleVersion,templateVersion:plan.template.version,templateSourceSha256:plan.template.sourceSha256,attendance:attendance?{state:attendance.state,recordedAt:attendance.recordedAt,recordedBy:attendance.recordedBy}:null,
   notice:notice?{id:notice.id,state:notice.state,originalOccurrenceRevision:notice.originalOccurrenceRevision,entitlementId:notice.entitlementId,replacementOccurrenceId:notice.replacementOccurrenceId,replacementReservationId:notice.replacementReservationId}:null,reservationState:null};chain.push(step);
  if(notices.length>1)return finish('review_required','makeup_fork');
  if(notice?.entitlementId)entitlements.add(notice.entitlementId);
  if(current!==originalOccurrenceId&&(input.originalOccurrenceIds.includes(current)||input.otherPurchasedRoots.includes(current)))return finish('review_required','purchased_root_collision');
  if((incoming.get(current)??0)>1)return finish('review_required','shared_makeup_target');
  if(notice&&(notice.replacementOccurrenceId===null)!==(notice.replacementReservationId===null))return finish('review_required','reservation_review');
  if(notice?.replacementOccurrenceId){
   const target=occurrences.get(notice.replacementOccurrenceId),matching=seats.filter(s=>s.workspaceId===workspaceId&&s.sourceStageId===plan.stageId&&s.entitlementId===notice.entitlementId&&s.enrollmentId===enrollmentId&&s.learnerId===learnerId&&s.occurrenceId===notice.replacementOccurrenceId&&s.reservationId===notice.replacementReservationId&&s.seatStageId===target?.plan.stageId&&s.origin==='makeup');
   if(matching.length!==1)return finish('review_required','reservation_review');step.reservationState=matching[0]!.state;
   if(step.reservationState==='released')return finish('review_required','reservation_review');
   // A later reservation cannot supply the preceding child's missing delivery
   // record or resolve a past session that has not been accounted for.
   if(o.time.kind!=='scheduled')return finish('review_required','unscheduled_session');
   if(o.state==='completed'&&(Date.parse(o.time.startsAt)>now.valueOf()||!attendance))return finish('review_required','attendance_record_required');
   if(o.state!=='completed'&&attendance)return finish('review_required','delivery_chain_conflict');
   if(o.state!=='completed'&&o.state!=='cancelled'&&Date.parse(o.time.startsAt)<=now.valueOf())return finish('review_required','past_session_unresolved');
   if(attendance&&(attendance.state==='present'||attendance.state==='late'))return finish('review_required','delivery_chain_conflict');
   current=notice.replacementOccurrenceId;continue;
  }
  // Retain the whole graph. A nested ID is not another purchased credit and
  // cannot silently replace the original identity without an admitted rule.
  if(entitlements.size>1)return finish('review_required','nested_entitlement_review');
  if(o.time.kind!=='scheduled')return finish('review_required','unscheduled_session');
  if(o.state==='completed'){
   if(Date.parse(o.time.startsAt)>now.valueOf()||!attendance)return finish('review_required','attendance_record_required');
   if(attendance.state==='present'||attendance.state==='late'){
    // Native makeup fit/attendance proves this target was attended, not that
    // its activity fulfills the purchased original. No equivalence is guessed.
    return chain.length>1?finish('review_required','replacement_activity_binding_required'):finish('delivered','selected_child_delivery_recorded');
   }
   return finish('undelivered','purchased_session_undelivered');
  }
  if(attendance)return finish('review_required','delivery_chain_conflict');
  if(o.state!=='cancelled'&&Date.parse(o.time.startsAt)<=now.valueOf())return finish('review_required','past_session_unresolved');
  return finish('undelivered','purchased_session_undelivered');
 }
}
