/** Controlled in-memory projection cases, not native/provider authority. */
import {randomUUID} from 'node:crypto';
import {expect,test,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {Fixture,actor,ref} from '../fishing-stage/fixture.ts';
import {FishingStageService} from '../../../src/features/fishing-stage/service.ts';
import {projectOwner03Attendance} from '../../../src/features/fishing/academy-refund-projection.ts';
import {academySharedServiceVersion,academySharedServiceEvidenceSchema,type AcademySharedServiceEvidence} from '../../../src/features/fishing/academy-shared-service-contract.ts';

async function fixture(){
 const f=new Fixture();await new FishingStageService(f,{now:()=>f.now}).execute(actor(),ref,{action:'create',operationId:randomUUID(),expectedRevision:0,templateVersion:f.template.version,childCapacity:4});const plan=f.state!;plan.occurrences=plan.occurrences.map((o,i)=>({...o,state:'published',time:{kind:'scheduled',timeZone:'America/New_York',startsAt:i===0?'2026-03-02T14:00:00Z':'2026-04-20T14:00:00Z',endsAt:i===0?'2026-03-02T17:00:00Z':'2026-04-20T17:00:00Z'}}));
 const input={purchaseId:randomUUID(),childId:randomUUID(),scopeId:randomUUID(),occurrenceIds:plan.occurrences.slice(0,4).map(o=>o.id),enrollmentId:randomUUID(),plans:[plan],now:new Date('2026-03-11T00:00:00Z')};
 function service(index=0,change:Partial<AcademySharedServiceEvidence>={}){return academySharedServiceEvidenceSchema.parse({version:academySharedServiceVersion,originalOccurrenceId:input.occurrenceIds[index],purchaseId:input.purchaseId,purchaseLineId:randomUUID(),learnerId:input.childId,enrollmentId:input.enrollmentId,eventId:randomUUID(),publicationId:randomUUID(),publicationRevision:2,publicationSha256:'a'.repeat(64),bindingSha256:'b'.repeat(64),sourceReviewSha256:'c'.repeat(64),sourceRevoked:false,startsAt:'2026-03-10T12:00:00Z',endsAt:'2026-03-10T21:00:00Z',state:'credited',recordedOnce:true,attendance:{id:randomUUID(),revision:1,sha256:'d'.repeat(64),state:'present'},...change});}
 return {plan,input,service};
}

test('a verified future shared session replaces the obsolete physical date for prestart timing without consuming service or lesson rights',async()=>{
 const {plan,input,service}=await fixture(),before=structuredClone(plan),pending=service(0,{state:'pending',recordedOnce:false,attendance:null,startsAt:'2026-03-18T12:00:00Z',endsAt:'2026-03-18T21:00:00Z'}),result=projectOwner03Attendance({...input,sharedServices:[pending]});expect(result).toMatchObject({state:'ready',timing:'prestart',attendedCount:0});if(result.state!=='ready')throw Error();expect(result.lessons.map(l=>l.lessonId)).toEqual(input.occurrenceIds);expect(result.lessons.every(l=>l.outcome==='not_delivered')).toBe(true);expect(plan).toEqual(before);
});

test('started pending, cancelled, local and unresolved records do not silently become prestart or completed service',async()=>{
 const {input,service}=await fixture();for(const state of ['pending','cancelled','local_alternative','review_required']as const)expect(projectOwner03Attendance({...input,sharedServices:[service(0,{state,recordedOnce:false,attendance:null})]})).toMatchObject({state:'review_required',reason:'shared_service_review_required'});expect(projectOwner03Attendance({...input,sharedServices:[service(0,{state:'not_attended',recordedOnce:false,attendance:null})]})).toMatchObject({state:'review_required',reason:'before_third_lesson_window_review_required'});
});

test('two distinct paid originals count once each while their original learning plan remains unchanged',async()=>{
 const {plan,input,service}=await fixture(),before=structuredClone(plan),first=service(),second=service(1);second.attendance!.state='late';const result=projectOwner03Attendance({...input,sharedServices:[first,second]});expect(result).toMatchObject({state:'ready',timing:'after_start',attendedCount:2});if(result.state!=='ready')throw Error();expect(result.lessons).toHaveLength(4);expect(result.lessons.map(l=>l.lessonId)).toEqual(input.occurrenceIds);expect(result.lessons.filter(l=>l.outcome==='attended')).toHaveLength(2);expect(plan).toEqual(before);
});

test('contradictory Stage completion or attendance requires review rather than counting a second delivered service',async()=>{
 const {plan,input,service}=await fixture();plan.occurrences=plan.occurrences.map((o,i)=>i===0?{...o,state:'completed'}:o);expect(projectOwner03Attendance({...input,sharedServices:[service()]})).toMatchObject({state:'review_required',reason:'shared_service_review_required'});plan.occurrences=plan.occurrences.map((o,i)=>i===0?{...o,state:'published'}:o);plan.attendance.push({occurrenceId:input.occurrenceIds[0]!,enrollmentId:input.enrollmentId,state:'absent',recordedAt:input.now.toISOString(),recordedBy:actor().id,reason:'SYNTHETIC contradictory original journal'});expect(projectOwner03Attendance({...input,sharedServices:[service()]})).toMatchObject({state:'review_required',reason:'shared_service_review_required'});
});

test('a later independently purchased block and foreign or missing enrollment/child context cannot inherit a shared service',async()=>{
 const {plan,input,service}=await fixture(),fact=service();for(const change of [{occurrenceIds:plan.occurrences.slice(4,8).map(o=>o.id)},{purchaseId:randomUUID()},{childId:randomUUID()},{enrollmentId:randomUUID()},{enrollmentId:null}])expect(()=>projectOwner03Attendance({...input,...change,sharedServices:[fact]})).toThrow();plan.occurrences=plan.occurrences.slice(1);expect(()=>projectOwner03Attendance({...input,sharedServices:[fact]})).toThrow();
});

test('full-stage scope keeps twelve original slots without creating future four-lesson purchases or altering the plan',async()=>{
 const {plan,input,service}=await fixture(),before=structuredClone(plan),all={...input,occurrenceIds:plan.occurrences.map(o=>o.id)},result=projectOwner03Attendance({...all,sharedServices:[service()]});expect(result).toMatchObject({state:'ready',attendedCount:1});if(result.state!=='ready')throw Error();expect(result.lessons).toHaveLength(12);expect(result.lessons.map(l=>l.lessonId)).toEqual(all.occurrenceIds);expect(result.lessons.every(l=>l.purchaseId===input.purchaseId&&l.childId===input.childId&&l.scopeId===input.scopeId)).toBe(true);expect(plan).toEqual(before);
});
