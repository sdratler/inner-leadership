import {describe,expect,test} from 'vitest';
import {demoCalendarPlan} from '../../src/features/demo/calendar-plan.ts';
import {localMinute} from '../../src/features/calendar/time.ts';
const batch='ls-owner-20260927';
function recipe(anchor='2026-09-28',dates=['2026-09-29','2026-09-30','2026-10-01']){
 return {schemaVersion:1,recipeOnly:true,notExecuted:true,batchId:batch,anchorDate:anchor,timezone:'Asia/Jerusalem',
  appointments:dates.map((date,i)=>({stableKey:`appointment-${i+1}`,caseKey:i===2?'case-adult':'case-a',isDemo:true,demoBatchId:batch,
   source:'owner-acceptance-demo',externalEffects:'deny',realAnalytics:'exclude',blocksRealAvailability:false,timezone:'Asia/Jerusalem',
   durationMinutes:60,state:'scheduled',localDate:date,localTime:i===2?'13:00':'11:00'}))};
}
describe('existing recipe future-calendar increment',()=>{
 test('consumes three future items and adds one linked fifteen-minute guidance proposal',()=>{
  const p=demoCalendarPlan(recipe(),batch);expect(p.items).toHaveLength(4);
  expect(p.items.map(i=>[i.sourceKey,i.caseSource,i.kind])).toEqual([
   ['appointment-1','owner-minor-a','individual'],['appointment-2','owner-minor-a','individual'],
   ['appointment-3','owner-adult-a','individual'],['parent-guidance-1','owner-minor-a','parent_guidance']]);
  expect(localMinute(p.items[0]!.startsAt)).toBe('2026-09-29T11:00');
  expect(localMinute(p.items[3]!.startsAt)).toBe('2026-09-29T12:15');
  expect(p.items[3]?.parentSourceKey).toBe('appointment-1');
  expect(p.items.every(i=>i.location.startsWith('DEMO')&&!i.location.includes('http'))).toBe(true);
 });
 test('uses Jerusalem offsets after the DST transition, not a fixed UTC offset',()=>{
  const p=demoCalendarPlan(recipe('2026-10-25',['2026-10-26','2026-10-27','2026-10-28']),batch);
  expect(p.items[0]?.startsAt).toBe('2026-10-26T09:00:00.000Z');
  expect(localMinute(p.items[0]!.startsAt)).toBe('2026-10-26T11:00');
 });
 test('stable command keys do not change to bypass an altered-recipe conflict',()=>{
  const first=demoCalendarPlan(recipe(),batch),next=demoCalendarPlan(recipe('2026-10-25',['2026-10-26','2026-10-27','2026-10-28']),batch);
  expect(first.items.map(i=>i.commandKey)).toEqual(next.items.map(i=>i.commandKey));
  expect(first.items[0]?.startsAt).not.toBe(next.items[0]?.startsAt);
 });
 test.each(['isDemo','blocksRealAvailability','externalEffects','realAnalytics','demoBatchId','caseKey','durationMinutes','localTime'])('rejects changed safety field %s',field=>{
  const r=recipe();r.appointments[0]![field as keyof typeof r.appointments[0]]='unsafe' as never;
  expect(()=>demoCalendarPlan(r,batch)).toThrow();
 });
 test('rejects duplicate/reordered/missing/extra scheduled source keys and malformed recipe',()=>{
  for(const r of [null,{...recipe(),recipeOnly:false},{...recipe(),batchId:'different'},
   {...recipe(),appointments:[recipe().appointments[0],recipe().appointments[0],recipe().appointments[2]]},
   {...recipe(),appointments:recipe().appointments.slice(0,2)},
   {...recipe(),appointments:[...recipe().appointments,recipe().appointments[0]]}])expect(()=>demoCalendarPlan(r,batch)).toThrow();
 });
 test('rejects invalid dates, past dates, Friday/Saturday and unbounded placement',()=>{
  for(const dates of [['2026-09-31','2026-10-01','2026-10-04'],['2026-09-28','2026-09-30','2026-10-01'],
   ['2026-10-02','2026-10-04','2026-10-05'],['2026-10-03','2026-10-04','2026-10-05'],
   ['2026-10-13','2026-10-14','2026-10-15']])expect(()=>demoCalendarPlan(recipe('2026-09-28',dates),batch)).toThrow();
 });
 test('does not require or import recipe account proposals, prior sessions or optional second family',()=>{
  const r={...recipe(),accounts:[{mailboxAliasSuffix:'+old-proposal'}],appointments:[
   {state:'completed',stableKey:'session-1',localDate:'2026-09-01'},...recipe().appointments]};
  expect(demoCalendarPlan(r,batch).items).toHaveLength(4);
 });
});
