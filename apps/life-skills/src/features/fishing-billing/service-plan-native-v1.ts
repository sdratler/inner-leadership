import 'server-only';
import {AppError} from '../../lib/errors.ts';
import {billingId} from './contracts.ts';
import type {Actor,WorkspaceId} from '../identity/types.ts';
import {privateDigest} from '../contact-ops/server/digests.ts';
import {childPeriodLessonWeeksV3} from './service-periods-v3.ts';
import {FishingProgramSourceNativeV3} from './program-source-native-v3.ts';
import {FishingFulfillmentNativeV1} from './fulfillment-native-v1.ts';
import {SERVICE_PLAN_V1,servicePlanPreviewV1Schema,servicePlanSnapshotV1Schema,type ServicePlanSnapshotV1} from './service-plan-contract-v1.ts';
import type {BillingContext} from './native.ts';
import type {AnchoredPlanningDataV3} from '../../lib/fishing-billing-guest-owner-store.ts';

export type NativeServicePlanV1=Readonly<{version:typeof SERVICE_PLAN_V1;snapshot:ServicePlanSnapshotV1;digest:string}>;

function fail(code:'UNAVAILABLE'|'CONFLICT'|'FORBIDDEN'='CONFLICT'):never{throw new AppError(code);}
const overlap=(a:{startsAt:string;endsAt:string},b:{startsAt:string;endsAt:string})=>Date.parse(a.startsAt)<Date.parse(b.endsAt)&&Date.parse(a.endsAt)>Date.parse(b.startsAt);
/** Full prospective schedule through actual native SQL sources. No caller
 * dates/readiness, injected eligibility resolver, writes or account fallback.
 * The future agreement must bind this exact snapshot; global reservations,
 * operating authority, paid confirmation and attendance remain separate. */
export class FishingServicePlanNativeV1{
 constructor(private readonly workspaceId:WorkspaceId,private readonly programme:FishingProgramSourceNativeV3,
  private readonly fulfillment:FishingFulfillmentNativeV1,private readonly key:string){
  if(!billingId.safeParse(workspaceId).success||key.length<32)fail('UNAVAILABLE');
 }
 private hash(value:unknown){return privateDigest(value,this.key);}
 async preview(actor:Actor,raw:unknown){
  return this.withPreview(actor,raw,async(_c,_data,preview)=>preview);
 }
 /** Same-transaction native material composition. A preview is scheduling
  * data; downstream issue/acceptance must independently admit every effect. */
 async withPreview<T>(actor:Actor,raw:unknown,work:(c:Readonly<BillingContext>,data:AnchoredPlanningDataV3,preview:NativeServicePlanV1)=>Promise<T>){
  const command=servicePlanPreviewV1Schema.parse(raw);
  return this.fulfillment.withPlanData(actor,command.quoteId,async(c,data,planning)=>{
   if(c.workspaceId!==this.workspaceId||c.actor.workspaceId!==this.workspaceId)fail('FORBIDDEN');
   const q=data.quote,stored=planning.plan;
   if(q.state!=='draft'||q.acceptance!==null||q.revision!==command.expectedQuoteRevision||stored.record.kind!=='plan'||planning.departureSourceState!=='unchanged'||
    stored.record.revision!==command.tripPlan.expectedRevision||stored.digest!==command.tripPlan.expectedDigest)fail();
   const live=await this.programme.firstEligibleLessons(c,{quoteId:q.id,familyId:q.familyId,children:data.original.periods.map(p=>({lineId:p.lineId,childId:p.childId,periodId:p.period.id,
    groupId:p.lesson.groupId,firstEligibleLessonId:p.lesson.id,expectedLessonRevision:p.lesson.revision,dueAt:q.lines.find(line=>line.id===p.lineId)!.dueAt}))});
   if(!live||live.length!==data.original.periods.length||live.some((lesson,index)=>this.hash(lesson)!==this.hash(data.original.periods[index]!.lesson)))fail();
   if(command.children.length!==q.lines.length||q.lines.some(line=>!command.children.some(child=>child.lineId===line.id)))fail();
   const groups=new Map<string,Awaited<ReturnType<FishingProgramSourceNativeV3['readGroupDataInTransaction']>>>();
   for(const line of q.lines){if(!line.groupId)fail();if(!groups.has(line.groupId))groups.set(line.groupId,await this.programme.readGroupDataInTransaction(c,line.groupId));}
   const snapshot:ServicePlanSnapshotV1={version:SERVICE_PLAN_V1,classification:'prospective_schedule_not_reserved_paid_or_operating_approval',workspaceId:this.workspaceId,
    quoteId:q.id,quoteRevision:q.revision,familyId:q.familyId,quoteBasisDigest:stored.record.snapshot.quoteBasisDigest,tripPlan:{revision:stored.record.revision,digest:stored.digest},children:[]};
   for(const tripChild of stored.record.snapshot.children){
    const selected=command.children.find(child=>child.lineId===tripChild.lineId)!,group=groups.get(tripChild.groupId)!;
    const g=group.group.record.command,progress=group.progressions.find(p=>p.record.command.id===tripChild.childId);
    if(g.kind!=='group'||g.fields.state!=='forming'||!progress||progress.record.command.kind!=='progression'||progress.record.revision!==selected.expectedProgressionRevision)fail();
    const p=progress.record.command.fields;
    if(p.state!=='planned'||p.familyId!==q.familyId)fail();
    const weeks=childPeriodLessonWeeksV3(tripChild.period),lessons=selected.lessons.map(selection=>{
     const source=group.lessons.find(lesson=>lesson.record.command.id===selection.id);if(!source||source.record.command.kind!=='lesson'||source.record.revision!==selection.expectedRevision)fail();
     const l=source.record.command.fields;
     if(l.state!=='scheduled'||Date.parse(l.startsAt)<Date.parse(tripChild.period.startsAt)||Date.parse(l.startsAt)<Date.parse(p.eligibleFrom)||Date.parse(l.endsAt)>Date.parse(tripChild.period.endsAt)||
      overlap(l,tripChild.keys.fields)||overlap(l,tripChild.local.fields))fail();
     const weekIndex=weeks.findIndex(week=>Date.parse(l.startsAt)>=Date.parse(week.startsAt)&&Date.parse(l.startsAt)<Date.parse(week.endsAt));
     if(weekIndex<0)fail();const week=weeks[weekIndex]!;
     return {id:selection.id,revision:source.record.revision,digest:source.digest,sequence:l.sequence,startsAt:l.startsAt,endsAt:l.endsAt,weekIndex,weekStartsAt:week.startsAt,weekEndsAt:week.endsAt};
    }).sort((a,b)=>Date.parse(a.startsAt)-Date.parse(b.startsAt)||a.id.localeCompare(b.id));
    if(lessons[0]?.id!==tripChild.firstEligibleLesson.id||lessons[0].revision!==tripChild.firstEligibleLesson.revision||
     weeks.some((_week,index)=>!lessons.some(lesson=>lesson.weekIndex===index))||lessons.some((lesson,index)=>index>0&&overlap(lessons[index-1]!,lesson)))fail();
    const firstTrip=Math.min(Date.parse(tripChild.keys.fields.startsAt),Date.parse(tripChild.local.fields.startsAt));
    let foundation:ServicePlanSnapshotV1['children'][number]['foundation'];
    if(p.readiness==='needs_foundation'){
     const first=lessons[0]!,second=lessons.find(lesson=>lesson.sequence===2&&Date.parse(lesson.startsAt)>=Date.parse(first.endsAt)&&Date.parse(lesson.endsAt)<=firstTrip);
     if(first.sequence!==1||!second)fail();foundation={basis:'planned_first_two',lessonIds:[first.id,second.id],evidence:null};
    }else if(p.readiness==='foundation_one_complete'){
     const second=lessons.find(lesson=>lesson.sequence===2&&Date.parse(lesson.endsAt)<=firstTrip);
     if(!p.evidence||!second)fail();foundation={basis:'verified_first_plus_planned_second',lessonIds:[second.id],evidence:p.evidence};
    }else{
     if(!p.evidence)fail();foundation={basis:p.readiness==='foundation_complete'?'verified_foundation':'verified_catchup',lessonIds:[],evidence:p.evidence};
    }
    snapshot.children.push({...tripChild,groupSource:{revision:group.group.record.revision,digest:group.group.digest,location:g.fields.location,venueSource:g.fields.venueSource},
     progression:{revision:progress.record.revision,digest:progress.digest,eligibleFrom:p.eligibleFrom,readiness:p.readiness,evidence:p.evidence},weeklyLessons:lessons,foundation});
   }
   const parsed=servicePlanSnapshotV1Schema.parse(snapshot);
   return work(c,data,{version:SERVICE_PLAN_V1,snapshot:parsed,digest:this.hash({domain:'prospective-service-plan/v1',snapshot:parsed})});
  });
 }
}
