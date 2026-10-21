/** Synthetic source/agreements/merchant only; actual retained native commands,
 * SQL, encrypted plans, payment processing and ordinary password sessions. */
import {randomUUID} from 'node:crypto';
import {ordinaryFixtureInterval} from './academy-calendar-fixture-times.ts';
import {refundPreparationFixture} from './academy-refund-preparation-fixture.ts';
import {NativeFishingStageStore} from '../../../src/features/fishing-stage/native-store.ts';
import {FishingStageService} from '../../../src/features/fishing-stage/service.ts';
import {systemClock,type Actor} from '../../../src/features/identity/types.ts';
import type {FishingStageRef} from '../../../src/features/fishing/contract.ts';
import type {NativeProgramCommandIntent} from '../../../src/features/fishing/native-program-contract.ts';

export async function originalObligationFixture(mode:'monthly_block'|'prepay'='monthly_block'){
 const f=await refundPreparationFixture();
 try{
  const p=await f.purchase(undefined,mode);await f.settle(p);const enrollmentId=await f.enroll(p);await f.publish();
  const rootIds=(await f.current()).occurrences.map(o=>o.id);
  const read=(actor:Actor=p.family.parent,index=0,program=f.program)=>f.db.transaction(tx=>program.readSessionCreditObligationInTransaction(tx,actor,{selectedEnrollmentId:enrollmentId,originalOccurrenceId:rootIds[index]}));
  async function complete(index=0,state?:'present'|'late'|'absent'|'no_show'){
   let plan=await f.current(),o=plan.occurrences[index]!;
   if(o.state!=='completed'){await f.revise(o.id,f.at(-24-index*168),f.at(-21-index*168));plan=await f.current();o=plan.occurrences[index]!;await f.stage().execute(f.owner,f.ref,{action:'complete',operationId:randomUUID(),expectedRevision:plan.revision,occurrenceId:o.id,expectedOccurrenceRevision:o.revision,reason:'SYNTHETIC actual group completion'});}
   if(state){plan=await f.current();o=plan.occurrences[index]!;await f.stage().execute(f.owner,f.ref,{action:'attendance',operationId:randomUUID(),expectedRevision:plan.revision,occurrenceId:o.id,expectedOccurrenceRevision:o.revision,enrollmentId,state,reason:'SYNTHETIC selected child attendance'});}
  }
  async function notice(index=0){const plan=await f.current(),o=plan.occurrences[index]!;await f.stage(p.family.parent,enrollmentId).execute(p.family.parent,f.ref,{action:'notice',operationId:randomUUID(),expectedRevision:plan.revision,occurrenceId:o.id,expectedOccurrenceRevision:o.revision,reason:'ordinary_absence'});return (await f.current()).notices.find(n=>n.occurrenceId===o.id)!;}
  async function reserve(target:{id:string;revision:number},index=0){
   const plan=await f.current(),n=plan.notices.find(n=>n.occurrenceId===rootIds[index])??await notice(index),fit={commandId:randomUUID(),id:randomUUID(),stageId:f.ref.stageId,learnerId:p.family.learnerId,purpose:'makeup' as const,decision:'approved' as const,targetOccurrenceId:target.id,targetRevision:target.revision,note:'SYNTHETIC native suitability, not original activity equivalence'};await f.program.recordFit(f.owner,fit);
   const current=await f.current(),operationId=randomUUID();await f.stage(f.owner,null,{operationId,resources:[],makeupFitDecisionId:fit.id}).execute(f.owner,f.ref,{action:'confirm_makeup',operationId,expectedRevision:current.revision,noticeId:n.id,replacementOccurrenceId:target.id,expectedReplacementRevision:target.revision,reason:'SYNTHETIC native replacement reservation only'});
   return read(p.family.parent,index);
  }
  const makeup=async(index=0,targetIndex=4)=>reserve((await f.current()).occurrences[targetIndex]!,index);
  async function crossStageMakeup(index=0){
   const ref:FishingStageRef={cohortId:randomUUID(),stageId:randomUUID(),stage:1};await f.program.createCohort(f.owner,{...f.cohortCommand,...ref,commandId:randomUUID(),label:'Synthetic replacement cohort'});
   const stage=(intent:NativeProgramCommandIntent|null=null)=>new FishingStageService(new NativeFishingStageStore(f.db,f.ring,{actor:f.owner,selection:{selectedEnrollmentId:null}},f.program.stageHooks(intent)),systemClock);
   await stage().execute(f.owner,ref,{action:'create',operationId:randomUUID(),expectedRevision:0,templateVersion:f.template.version,childCapacity:4});let plan=(await stage().read(f.owner,ref))!,o=plan.occurrences[index]!,operationId=randomUUID();
   await stage({operationId,resources:[{occurrenceId:o.id,expectedRevision:o.revision,venueId:f.venueCommand.id}],makeupFitDecisionId:null}).execute(f.owner,ref,{action:'revise',operationId,expectedRevision:plan.revision,occurrenceId:o.id,expectedOccurrenceRevision:o.revision,details:{time:{kind:'scheduled',...ordinaryFixtureInterval(f.at(15*24+5),f.at(15*24+8)),timeZone:'America/New_York'},location:f.venueCommand.label,directions:'Synthetic replacement directions',equipment:'Synthetic equipment',logisticalNote:'Synthetic target',childCapacity:4},reason:'SYNTHETIC replacement timetable'});
   plan=(await stage().read(f.owner,ref))!;operationId=randomUUID();await stage({operationId,resources:[],makeupFitDecisionId:null}).execute(f.owner,ref,{action:'publish',operationId,expectedRevision:plan.revision});plan=(await stage().read(f.owner,ref))!;o=plan.occurrences[index]!;return {ref,target:o,obligation:await reserve(o,index)};
  }
  async function snapshot(){return {protected:await f.protectedState(),stage:await Promise.all(['ls_fishing_stage.plans','ls_fishing_stage.revisions','ls_fishing_stage.makeup_links','ls_fishing_stage.resource_reservations','ls_fishing_stage.command_receipts'].map(async table=>({table,rows:(await f.pool.query(`SELECT to_jsonb(t) AS row FROM ${table} t WHERE workspace_id=$1 ORDER BY to_jsonb(t)::text`,[f.workspaceId])).rows})))};}
  return {...f,p,enrollmentId,rootIds,read,complete,notice,makeup,crossStageMakeup,snapshot};
 }catch(error){await f.close();throw error;}
}
