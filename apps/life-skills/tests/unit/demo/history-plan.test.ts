import {describe,expect,it} from 'vitest';
import {demoHistoryPlan} from '../../../src/features/demo/history-plan.ts';
const batch='ls-owner-20260927',dates=['2026-09-20','2026-09-21','2026-09-22','2026-09-23','2026-09-24'];
const keys=['engagement','regulation','frustration_tolerance','initiative','reflective_capacity','impulse_control','responsiveness','participation','social_engagement'];
function recipe(){const common={isDemo:true,demoBatchId:batch,source:'owner-acceptance-demo',externalEffects:'deny',realAnalytics:'exclude'};
return {schemaVersion:1,recipeOnly:true,notExecuted:true,batchId:batch,anchorDate:'2026-09-28',timezone:'Asia/Jerusalem',
 appointments:dates.map((localDate,i)=>({...common,stableKey:`session-${i+1}`,caseKey:'case-a',localDate,localTime:'11:00',timezone:'Asia/Jerusalem',durationMinutes:60,state:'completed',attendance:'present',blocksRealAvailability:false})),
 observations:dates.map((observedDate,i)=>({...common,stableKey:`observation-${i+1}`,caseKey:'case-a',sessionKey:`session-${i+1}`,observedDate,visibility:'practitioner_private',values:Object.fromEntries(keys.map((k,j)=>[k,{score:i===2&&j===8?null:3+(i+j)%5,note:'Synthetic observation for interface verification only.'}]))}))};}
describe('same supplied recipe historical DEMO slice',()=>{
 it('maps exactly five past dates and all nine measures without inventing a score',()=>{const p=demoHistoryPlan(recipe(),batch);expect(p.items).toHaveLength(5);expect(p.items[0]?.startsAt).toBe('2026-09-20T08:00:00.000Z');expect(p.items[0]?.values.reflection.score).toBe(7);expect(p.items[2]?.values.social_engagement).toEqual({score:null,notObservedReason:'Synthetic measure not observed',note:'Synthetic observation for interface verification only.'});expect(p.items.every(i=>Object.keys(i.values).length===9&&i.commandKey.startsWith(batch))).toBe(true);});
 it('keeps command keys date-independent so a changed recipe cannot create a second batch',()=>{const a=recipe(),b=recipe();b.appointments[0]!.localDate='2026-09-17';b.observations[0]!.observedDate='2026-09-17';expect(demoHistoryPlan(a,batch).items[0]?.commandKey).toBe(demoHistoryPlan(b,batch).items[0]?.commandKey);});
 for(const [label,change] of [
  ['wrong batch',(r:ReturnType<typeof recipe>)=>{r.batchId='ls-owner-20260926';}],
  ['unmarked appointment',(r:ReturnType<typeof recipe>)=>{r.appointments[0]!.isDemo=false;}],
  ['real effect',(r:ReturnType<typeof recipe>)=>{r.appointments[0]!.externalEffects='allow';}],
  ['wrong case',(r:ReturnType<typeof recipe>)=>{r.appointments[0]!.caseKey='case-b';}],
  ['future date',(r:ReturnType<typeof recipe>)=>{r.appointments[4]!.localDate='2026-09-29';}],
  ['weekend',(r:ReturnType<typeof recipe>)=>{r.appointments[0]!.localDate='2026-09-19';}],
  ['duplicate key',(r:ReturnType<typeof recipe>)=>{r.appointments[1]!.stableKey='session-1';}],
  ['missing observation',(r:ReturnType<typeof recipe>)=>{r.observations.pop();}],
  ['private data note',(r:ReturnType<typeof recipe>)=>{r.observations[0]!.values.engagement!.note='A real client detail';}],
  ['missing measure',(r:ReturnType<typeof recipe>)=>{delete r.observations[0]!.values.engagement;}],
  ['unknown measure',(r:ReturnType<typeof recipe>)=>{r.observations[0]!.values.extra={score:5,note:'Synthetic observation for interface verification only.'};}],
  ['invalid score',(r:ReturnType<typeof recipe>)=>{r.observations[0]!.values.engagement!.score=11;}],
 ] as const)it(`rejects ${label}`,()=>{const r=recipe();change(r);expect(()=>demoHistoryPlan(r,batch)).toThrow();});
});
