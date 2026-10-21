import 'server-only';
import {readAcademySharedServices} from './academy-shared-service.ts';
import {academySharedServiceView} from './academy-shared-service-contract.ts';
import {AppError} from '../../lib/errors.ts';
import {lockWorkspace} from '../identity/data.ts';
import type {IdentityStore} from '../identity/store.ts';
import type {IdentityConfig} from '../identity/config.ts';
import {systemClock,type Actor,type IdentityClock} from '../identity/types.ts';
import {NativeFishingProgram} from './native-program.ts';
import {digest} from '../fishing-payments/domain.ts';
import {readAcademySharedPhysicalEvents} from './academy-group-calendar-publication-fence.ts';
import {fishingCalendarEventSchema,fishingCalendarSearch,type FishingCalendarEvent,type FishingCalendarPlan} from './program-calendar-contract.ts';

type Plan=Pick<FishingCalendarPlan,'selection'|'choice'|'view'>;
function requireFact(v:unknown,code:'UNAVAILABLE'|'FORBIDDEN'|'CONFLICT'='CONFLICT'):asserts v{if(!v)throw new AppError(code);}
/** Read projection only: one physical identity, selected original learning
 * identities retained. Neither trip attendance nor this DTO grants a service,
 * activity, enrollment, credit, charge or refund. No other-family roster. */
export async function academySharedCalendar(db:IdentityStore,config:IdentityConfig,actor:Actor,plans:readonly Plan[],clock:IdentityClock=systemClock){
 return db.transaction(async tx=>{
  requireFact(actor.workspaceId===config.workspaceId,'FORBIDDEN');await lockWorkspace(tx,actor.workspaceId);
  const program=new NativeFishingProgram({transaction:work=>work(tx)},config.keyring,{childAccountsEnabled:config.childAccountsEnabled===true,merchant:null},clock);
  // Fresh choices authorize the supplied contexts inside this read transaction.
  const choices=await program.calendarChoices(actor,actor.role==='practitioner'?null:plans[0]?.selection.learnerId??null);
  const same=(a:Plan['selection'],b:Plan['selection'])=>fishingCalendarSearch(a)===fishingCalendarSearch(b);
  requireFact(plans.every(p=>choices.stages.some(c=>same(p.selection,{learnerId:c.learnerId,enrollmentId:c.enrollmentId,reference:{cohortId:c.cohortId,stageId:c.stageId,stage:c.stage}}))),'FORBIDDEN');
  const publications=await readAcademySharedPhysicalEvents(tx,config.keyring,actor.workspaceId),events:FishingCalendarEvent[]=[],boundOriginalIds=new Set<string>();
  const ownerGroups=actor.role==='practitioner'&&publications.some(p=>p.operatorId===actor.id)?await program.calendarGroupPlanningInTransaction(tx,actor):[];
  for(const publication of publications){
   const originals:NonNullable<FishingCalendarEvent['shared']>['originals']=[];
   for(const plan of plans){const link=publication.originals.find(o=>o.selection.cohortId===plan.selection.reference.cohortId&&o.selection.stageId===plan.selection.reference.stageId&&o.selection.stage===plan.selection.reference.stage);if(!link)continue;
    if(actor.role==='practitioner'){
     if(publication.operatorId!==actor.id)continue;
     const current=ownerGroups.find(g=>g.stageId===link.selection.stageId&&g.cohortId===link.selection.cohortId)?.originals.find(o=>o.selection.occurrenceId===link.selection.occurrenceId);requireFact(current&&current.originalSha256===link.originalSha256);
     originals.push({selection:plan.selection,occurrenceId:link.selection.occurrenceId,ordinal:link.ordinal,moduleId:link.moduleId,moduleVersion:link.moduleVersion,participation:'operator_context'});
    }else{
     // A group link alone never enrolls its other children in a saved trip.
     const member=publication.members.find(m=>m.enrollmentId===plan.selection.enrollmentId&&m.learnerId===plan.selection.learnerId&&m.originalOccurrenceId===link.selection.occurrenceId);
     requireFact((actor.role==='parent'||actor.role==='child')&&plan.selection.enrollmentId&&plan.selection.learnerId,'FORBIDDEN');
     const current=await program.readCalendarOriginalInTransaction(tx,actor,{selectedEnrollmentId:plan.selection.enrollmentId,originalOccurrenceId:link.selection.occurrenceId});
     if(!current){requireFact(!member,'UNAVAILABLE');continue;}
     requireFact(current.enrollment.learnerId===plan.selection.learnerId&&current.operatorId===publication.operatorId&&digest(current.original)===link.originalSha256);
     if(member)requireFact(current.enrollment.revision===member.enrollmentRevision&&current.enrollment.purchaseId===member.purchaseId);
     requireFact(plan.view&&plan.view.revision===current.plan.revision);
     const service=(await readAcademySharedServices(tx,config.keyring,{workspaceId:actor.workspaceId,operatorId:current.operatorId,cohortId:current.plan.cohortId,stageId:current.plan.stageId,purchaseId:current.enrollment.purchaseId,purchaseLineId:current.enrollment.purchaseLineId,learnerId:current.enrollment.learnerId,enrollmentId:current.enrollment.id,enrollmentRevision:current.enrollment.revision,guardianSha256:current.guardianSha256,originals:[{id:current.original.id,sha256:digest(current.original)}]},clock.now()))[0];requireFact(service);
     originals.push({selection:plan.selection,occurrenceId:link.selection.occurrenceId,ordinal:link.ordinal,moduleId:link.moduleId,moduleVersion:link.moduleVersion,participation:member?.participation.kind??'review_required',service:academySharedServiceView(service)});
    }
    boundOriginalIds.add(link.selection.occurrenceId);
   }
   if(!originals.length)continue;const selections=originals.map(o=>o.selection).filter((s,i,a)=>a.findIndex(v=>same(v,s))===i);
   events.push(fishingCalendarEventSchema.parse({id:publication.eventId,revision:publication.revision,ordinal:originals[0]!.ordinal,label:actor.locale==='he'?publication.trip.labelHe:publication.trip.labelEn,state:publication.state,startsAt:publication.trip.startsAt,endsAt:publication.trip.endsAt,timeZone:publication.trip.timeZone,location:publication.trip.labelEn+'\n'+publication.trip.address,details:{directions:publication.trip.directions,equipment:publication.trip.equipment,logisticalNote:publication.trip.guardianInformation,changedAt:publication.recordedAt},selections,shared:{kind:'monthly_core_keys',originals,weeklyService:actor.role==='practitioner'?'not_inferred':'per_original',originalActivity:'not_inferred'}}));
  }
  // Recheck actual session and guardian choices before returning private data.
  await program.calendarChoices(actor,actor.role==='practitioner'?null:plans[0]?.selection.learnerId??null);
  const candidates=events.filter(e=>e.state==='published'&&Date.parse(e.startsAt)>clock.now().valueOf()&&e.shared?.originals.some(o=>o.participation==='operator_context'||o.participation==='keys'&&o.service?.state==='pending'));
  for(const plan of plans)for(const o of plan.view?.occurrences??[]){if(o.state!=='published'||o.time.kind!=='scheduled'||boundOriginalIds.has(o.id)||Date.parse(o.time.startsAt)<=clock.now().valueOf())continue;candidates.push(fishingCalendarEventSchema.parse({id:o.id,revision:o.revision,ordinal:o.ordinal,label:plan.choice.label,state:o.state,startsAt:o.time.startsAt,endsAt:o.time.endsAt,timeZone:o.time.timeZone,location:o.location,details:{directions:o.directions,equipment:o.equipment,logisticalNote:o.logisticalNote,changedAt:o.changedAt},selections:[plan.selection]}));}
  const nextPhysical=candidates.sort((a,b)=>Date.parse(a.startsAt)-Date.parse(b.startsAt)||a.id.localeCompare(b.id))[0]??null;
  return {events,boundOriginalIds:[...boundOriginalIds],nextPhysical};
 });
}
