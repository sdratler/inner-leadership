import type {AcademySharedServiceEvidence} from './academy-shared-service-contract.ts';
import type {StageState} from '../fishing-stage/contract.ts';
import type {Owner03RefundInput} from '../fishing-payments/owner03-policy.ts';
import type {AcademyRefundReviewReason} from './academy-refund-contract.ts';
import {FishingProgramError} from './native-program-contract.ts';

type Projection={state:'ready';timing:'prestart'|'after_start';attendedCount:number;lessons:Owner03RefundInput['attendance']['lessons']}|{state:'review_required';reason:AcademyRefundReviewReason};
/** Inputs come only from Root's authenticated snapshot/journal loader. Every
 * outcome represents one purchased slot, including a verified makeup chain. */
export function projectOwner03Attendance(input:{purchaseId:string;childId:string;scopeId:string;occurrenceIds:readonly string[];enrollmentId:string|null;plans:readonly StageState[];now:Date;sharedServices?:readonly AcademySharedServiceEvidence[]}):Projection{
 const {enrollmentId,plans,now}=input;
 if(!Number.isFinite(now.valueOf())||![4,12].includes(input.occurrenceIds.length)||new Set(input.occurrenceIds).size!==input.occurrenceIds.length)throw new FishingProgramError('UNAVAILABLE');
 const occurrences=new Map(plans.flatMap(plan=>plan.occurrences.map(o=>[o.id,{o,plan}] as const)));
 const shared=new Map((input.sharedServices??[]).map(v=>[v.originalOccurrenceId,v]));if(shared.size!==(input.sharedServices??[]).length||(input.sharedServices??[]).some(v=>v.purchaseId!==input.purchaseId||v.learnerId!==input.childId||v.enrollmentId!==input.enrollmentId||!input.occurrenceIds.includes(v.originalOccurrenceId)))throw new FishingProgramError('UNAVAILABLE');
 const effective=new Set<string>(),lessons:Owner03RefundInput['attendance']['lessons']=[];
 let delivered=0,hasStarted=false,allFuture=true;
 for(const id of input.occurrenceIds){
  const service=shared.get(id);if(service){const entry=occurrences.get(id);if(!entry)throw new FishingProgramError('UNAVAILABLE');if(entry.o.state==='completed'||entry.plan.attendance.some(v=>v.occurrenceId===id&&v.enrollmentId===enrollmentId))return {state:'review_required',reason:'shared_service_review_required'};
   if(service.state==='not_attended')return {state:'review_required',reason:'before_third_lesson_window_review_required'};
   if(!['pending','credited'].includes(service.state)||service.state==='pending'&&Date.parse(service.startsAt)<=now.valueOf())return {state:'review_required',reason:'shared_service_review_required'};
   if(service.state==='credited'){if(!service.recordedOnce||Date.parse(service.endsAt)>now.valueOf()||service.sourceRevoked||!service.attendance||!['present','late'].includes(service.attendance.state))throw new FishingProgramError('UNAVAILABLE');delivered++;hasStarted=true;allFuture=false;}
   lessons.push({lessonId:id,purchaseId:input.purchaseId,childId:input.childId,scopeId:input.scopeId,outcome:service.state==='credited'?'attended':'not_delivered'});continue;
  }
  let current=id,slotDelivered=false;const visited=new Set<string>();
  for(;;){
   if(visited.has(current)||visited.size>=12)throw new FishingProgramError('UNAVAILABLE');visited.add(current);
   const entry=occurrences.get(current);if(!entry)throw new FishingProgramError('UNAVAILABLE');
   const {o,plan}=entry,attendance=enrollmentId?plan.attendance.filter(a=>a.enrollmentId===enrollmentId&&a.occurrenceId===current).at(-1):undefined;
   // Delivery/window evidence survives a later makeup reservation. Count it
   // once for this purchased slot, independently of its eventual outcome.
   if(o.state==='completed'){
    if(o.time.kind!=='scheduled'||Date.parse(o.time.startsAt)>now.valueOf()||!attendance)return {state:'review_required',reason:'attendance_record_required'};
    slotDelivered=true;hasStarted=true;allFuture=false;
   }
   const replacements=enrollmentId?plan.makeups.filter(m=>m.notice.enrollmentId===enrollmentId&&m.notice.occurrenceId===current&&m.notice.replacementOccurrenceId!==null&&m.notice.replacementReservationId!==null):[];
   if(replacements.length>1)return {state:'review_required',reason:'makeup_attendance_review_required'};
   if(replacements.length){
    // A later correction cannot turn the original AND its replacement into two credits.
    if(attendance?.state==='present'||attendance?.state==='late')return {state:'review_required',reason:'makeup_attendance_review_required'};
    if(o.state==='completed'||o.time.kind==='scheduled'&&Date.parse(o.time.startsAt)<=now.valueOf())hasStarted=true;
    current=replacements[0]!.notice.replacementOccurrenceId!;continue;
   }
   if(effective.has(current))return {state:'review_required',reason:'makeup_attendance_review_required'};effective.add(current);
   let outcome:Owner03RefundInput['attendance']['lessons'][number]['outcome'];
   if(o.state==='completed'){
    if(o.time.kind!=='scheduled'||Date.parse(o.time.startsAt)>now.valueOf()||!attendance)return {state:'review_required',reason:'attendance_record_required'};
    outcome=attendance.state==='present'||attendance.state==='late'?'attended':'not_attended';
   }else if(o.state==='cancelled'){
    outcome='operator_cancelled';allFuture=false;if(o.time.kind==='scheduled'&&Date.parse(o.time.startsAt)<=now.valueOf())hasStarted=true;
   }else{
    if(attendance)throw new FishingProgramError('UNAVAILABLE');
    if(o.time.kind!=='scheduled'){allFuture=false;}else if(Date.parse(o.time.startsAt)<=now.valueOf())return {state:'review_required',reason:'attendance_record_required'};
    outcome='not_delivered';
   }
   if(slotDelivered)delivered++;
   lessons.push({lessonId:id,purchaseId:input.purchaseId,childId:input.childId,scopeId:input.scopeId,outcome});break;
  }
 }
 const attendedCount=lessons.filter(l=>l.outcome==='attended').length;
 // Preserve attended-only retention without inventing a late withdrawal window.
 if(delivered>=3&&attendedCount<3)return {state:'review_required',reason:'before_third_lesson_window_review_required'};
 if(!hasStarted&&!allFuture)return {state:'review_required',reason:'start_timing_review_required'};
 return {state:'ready',timing:hasStarted?'after_start':'prestart',attendedCount,lessons};
}
