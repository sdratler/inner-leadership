import {expect,test} from 'vitest';
import {demoPracticePlan} from '../../src/features/demo/practice-plan.ts';
const batch='ls-owner-20260927';
function recipe(){
 const base={isDemo:true,demoBatchId:batch,source:'owner-acceptance-demo',externalEffects:'deny',realAnalytics:'exclude',timezone:'Asia/Jerusalem',revision:1,startDate:'2026-10-04',endDate:'2026-10-11'};
 return {schemaVersion:1,recipeOnly:true,notExecuted:true,batchId:batch,timezone:'Asia/Jerusalem',assignments:[
  {...base,stableKey:'practice-a',caseKey:'case-a',responsibilities:[{key:'child-action',participantKey:'child-a',text:'Choose one small task.',localTime:'18:30'},{key:'parent-support',participantKey:'parent-a',text:'Ask one open question.',localTime:'18:25'}]},
  {...base,stableKey:'practice-adult',caseKey:'case-adult',responsibilities:[{key:'adult-action',participantKey:'adult-a',text:'Write one reflection.',localTime:'20:00'}]},
 ]};
}
test('maps only the existing three responsibilities, retaining source text, dates and clocks',()=>{
 const input=recipe(),copy=structuredClone(input),rows=demoPracticePlan(input,batch,'2026-10-05');
 expect(input).toEqual(copy);expect(rows.map(r=>[r.role,r.localTime,r.caseSource])).toEqual([
  ['child','18:30','owner-minor-a'],['parent','18:25','owner-minor-a'],['adult','20:00','owner-adult-a']]);
 expect(rows[0]).toMatchObject({instructions:'DEMO — Choose one small task.',startsOn:'2026-10-04',endsOn:'2026-10-11',occursOn:'2026-10-05'});
 expect(new Set(rows.map(r=>r.commandKey)).size).toBe(3);
 expect(demoPracticePlan(input,batch,'2026-10-05')).toEqual(rows);
});
test.each(['2026-10-03','2026-10-12','2026-02-30','not-a-date'])('rejects outside/invalid occurrence date %s',date=>{
 expect(()=>demoPracticePlan(recipe(),batch,date)).toThrow();
});
test('rejects effect permission, duplicate cases, incomplete roles and invented clocks',()=>{
 const changes=[(r:ReturnType<typeof recipe>)=>{r.assignments[0]!.externalEffects='allow';},
  (r:ReturnType<typeof recipe>)=>{r.assignments[1]=structuredClone(r.assignments[0]!);},
  (r:ReturnType<typeof recipe>)=>{r.assignments[0]!.responsibilities[0]!.participantKey='parent-a';},
  (r:ReturnType<typeof recipe>)=>{r.assignments[0]!.responsibilities[0]!.localTime='25:01';},
  (r:ReturnType<typeof recipe>)=>{r.assignments[0]!.endDate='2027-01-01';}];
 for(const change of changes){const r=recipe();change(r);expect(()=>demoPracticePlan(r,batch,'2026-10-05')).toThrow();}
});
