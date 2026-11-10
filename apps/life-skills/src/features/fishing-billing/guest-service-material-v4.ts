import 'server-only';
import {z} from 'zod';
import {AppError} from '../../lib/errors.ts';
import {canonical} from '../contact-ops/core/validation.ts';
import {digest} from '../contact-ops/server/digests.ts';
import {calendarMonthlyChildPeriodV3,childPeriodLessonWeeksV3} from './service-periods-v3.ts';
import {BILLING_SERVICE_V4,SERVICE_FINANCIAL_ACTION_V4,serviceFinancialDraftV4Schema,serviceDraftBindingV4Schema,serviceOfferBindingV4Schema,serviceIssuedMaterialV4Schema,
 serviceDisplayBundleV4Schema,serviceAcceptCommandV4Schema,servicePresentationV4Schema,serviceRecurringPresentationV4Schema,serviceGrantRecordV4Schema,serviceFinancialAcceptanceV4Schema,
 type ServiceFinancialDraftV4,type ServiceOfferBindingV4,type ServiceIssuedMaterialV4,type ServiceAcceptCommandV4} from './guest-service-contract-v4.ts';

function requireFact(condition:unknown):asserts condition{if(!condition)throw new AppError('UNAVAILABLE');}
const equal=(a:unknown,b:unknown)=>canonical(a)===canonical(b);
type Financial=ServiceIssuedMaterialV4['financial'];
/** Internal coherence only. Actual native source/guardian/recipient/legal
 * release/seat/provider admission must additionally be rechecked at issue and
 * acceptance. Public hashes and typed planning facts never mint authority. */
function coherent(financial:Pick<Financial,'workspaceId'|'quoteId'|'familyId'|'definition'|'lines'>,schedule:ServiceFinancialDraftV4['schedule'],policy:ServiceFinancialDraftV4['policy']){
 const s=schedule.snapshot;
 requireFact(financial.workspaceId===s.workspaceId&&financial.quoteId===s.quoteId&&financial.familyId===s.familyId&&financial.lines.length===s.children.length);
 requireFact(new Set(s.children.map(child=>child.lineId)).size===s.children.length);
 requireFact(new Set(s.children.map(child=>child.childId)).size===s.children.length);
 for(const [key,ref] of [['cancellation',policy.cancellation],['weather',policy.weather],['renewal',policy.renewal],['service_period',policy.servicePeriod]] as const)
  requireFact(equal(financial.definition.policies[key],ref));
 if(policy.kind==='selected_650_product_policy')requireFact(financial.definition.unitAmountMinor===65000);
 for(const [index,line] of financial.lines.entries()){
  const child=s.children[index];requireFact(child&&child.lineId===line.id&&child.childId===line.childId&&child.groupId===line.groupId&&equal(child.period,line.period));
  requireFact(child.firstEligibleLesson.workspaceId===s.workspaceId&&child.firstEligibleLesson.familyId===s.familyId&&child.firstEligibleLesson.childId===line.childId&&child.firstEligibleLesson.groupId===line.groupId);
  requireFact(equal(calendarMonthlyChildPeriodV3({childId:line.childId,periodId:line.period.id,firstEligibleLesson:{id:child.firstEligibleLesson.id,startsAt:child.firstEligibleLesson.startsAt},cycle:0}).period,line.period));
  const weeks=childPeriodLessonWeeksV3(child.period),lessons=child.weeklyLessons;
  requireFact(new Set(lessons.map(lesson=>lesson.id)).size===lessons.length&&lessons[0]?.id===child.firstEligibleLesson.id&&lessons[0].revision===child.firstEligibleLesson.revision);
  requireFact(Date.parse(child.firstEligibleLesson.startsAt)===Date.parse(line.period.startsAt));
  const trips=[child.keys,child.local];
  requireFact(child.keys.id!==child.local.id&&child.keys.fields.tripKind==='keys'&&child.local.fields.tripKind==='local');
  for(const trip of trips)requireFact(trip.groupId===line.groupId&&trip.fields.state==='scheduled'&&Date.parse(trip.fields.startsAt)>=Date.parse(line.period.startsAt)&&Date.parse(trip.fields.endsAt)<=Date.parse(line.period.endsAt));
  requireFact(weeks.every((_week,i)=>lessons.some(lesson=>lesson.weekIndex===i)));
  for(const [i,lesson] of lessons.entries()){
   const week=weeks[lesson.weekIndex];requireFact(week&&lesson.weekStartsAt===week.startsAt&&lesson.weekEndsAt===week.endsAt&&Date.parse(lesson.startsAt)>=Date.parse(week.startsAt)&&Date.parse(lesson.startsAt)<Date.parse(week.endsAt)&&
    Date.parse(lesson.startsAt)>=Date.parse(child.progression.eligibleFrom)&&Date.parse(lesson.endsAt)>Date.parse(lesson.startsAt)&&Date.parse(lesson.endsAt)<=Date.parse(line.period.endsAt));
   requireFact(i===0||Date.parse(lessons[i-1]!.endsAt)<=Date.parse(lesson.startsAt));
   requireFact(trips.every(trip=>Date.parse(lesson.endsAt)<=Date.parse(trip.fields.startsAt)||Date.parse(lesson.startsAt)>=Date.parse(trip.fields.endsAt)));
  }
  const f=child.foundation,firstTrip=Math.min(...trips.map(trip=>Date.parse(trip.fields.startsAt))),ready=child.progression.readiness;
  if(ready==='needs_foundation'){
   const first=lessons.find(lesson=>lesson.id===f.lessonIds[0]),second=lessons.find(lesson=>lesson.id===f.lessonIds[1]);
   requireFact(f.basis==='planned_first_two'&&f.lessonIds.length===2&&f.evidence===null&&first?.id===child.firstEligibleLesson.id&&first.sequence===1&&second?.sequence===2&&Date.parse(second.startsAt)>=Date.parse(first.endsAt)&&Date.parse(second.endsAt)<=firstTrip);
  }else if(ready==='foundation_one_complete'){
   const second=lessons.find(lesson=>lesson.id===f.lessonIds[0]);requireFact(f.basis==='verified_first_plus_planned_second'&&f.lessonIds.length===1&&second?.sequence===2&&Date.parse(second.endsAt)<=firstTrip&&child.progression.evidence&&equal(f.evidence,child.progression.evidence));
  }else requireFact(f.basis===(ready==='foundation_complete'?'verified_foundation':'verified_catchup')&&f.lessonIds.length===0&&child.progression.evidence&&equal(f.evidence,child.progression.evidence));
 }
}
export function bindServiceFinancialDraftV4(raw:unknown){
 const material=serviceFinancialDraftV4Schema.parse(raw),q=material.basis;
 requireFact(material.schedule.snapshot.quoteRevision===q.revision);coherent({workspaceId:q.workspaceId,quoteId:q.id,familyId:q.familyId,definition:q.definition,lines:q.lines},material.schedule,material.policy);
 return {material,sha256:digest({domain:'service-financial-draft/v4',material})};
}
export function verifyServiceFinancialDraftV4(raw:unknown){
 const b=serviceDraftBindingV4Schema.parse(raw);requireFact(equal(bindServiceFinancialDraftV4(b.material),b));return b;
}
/** Pure material recipe for the actual issuer's server time. This does not
 * issue/persist a quote/grant, start a 24h hold or release financial terms. */
export function bindServiceIssuedMaterialV4(draft:unknown,issuedAt:string):ServiceOfferBindingV4{
 const d=verifyServiceFinancialDraftV4(draft).material,q=d.basis;
 const material=serviceIssuedMaterialV4Schema.parse({version:BILLING_SERVICE_V4,kind:'issued_service_financial_material',financial:{workspaceId:q.workspaceId,familyId:q.familyId,quoteId:q.id,issuedRevision:q.revision+1,
  definition:q.definition,lines:q.lines,createdAt:q.createdAt,issuedAt,override:q.override},schedule:d.schedule,policy:d.policy});
 return verifyServiceOfferBindingV4({material,sha256:digest({domain:'service-issued-material/v4',material})});
}
export function verifyServiceOfferBindingV4(raw:unknown):ServiceOfferBindingV4{
 const b=serviceOfferBindingV4Schema.parse(raw),m=b.material;
 requireFact(b.sha256===digest({domain:'service-issued-material/v4',material:m})&&m.financial.issuedRevision===m.schedule.snapshot.quoteRevision+1);
 coherent(m.financial,m.schedule,m.policy);return b;
}
export function bindServiceDisplayBundleV4(offer:unknown,raw:unknown){
 const b=verifyServiceOfferBindingV4(offer),{sha256,...shape}=serviceDisplayBundleV4Schema.shape;void sha256;
 const material=z.object(shape).strict().parse(raw);requireFact(material.offerSnapshotSha256===b.sha256&&material.serviceSnapshotSha256===digest(b.material.schedule.snapshot)&&equal(material.financialTerms.source,b.material.financial.definition.terms));
 return {...material,sha256:digest({domain:'service-display-bundle/v4',material})};
}
export function verifyServiceDisplayBundleV4(offer:unknown,raw:unknown){
 const bundle=serviceDisplayBundleV4Schema.parse(raw),{sha256,...material}=bundle;
 requireFact(bindServiceDisplayBundleV4(offer,material).sha256===sha256);return bundle;
}
export function serviceFinancialStatementSha256V4(offer:unknown,bundle:unknown,raw:unknown){
 const b=verifyServiceOfferBindingV4(offer),display=verifyServiceDisplayBundleV4(b,bundle),presentation=servicePresentationV4Schema.parse(raw);
 requireFact(presentation.displayBundleId===display.id&&presentation.displayBundleSha256===display.sha256&&presentation.locale===display.locale);
 return digest({domain:'service-financial-statement/v4',offerSnapshotSha256:b.sha256,serviceSnapshotSha256:display.serviceSnapshotSha256,presentation});
}
/** Exact separately displayed mandate for the parent's selected children.
 * This only hashes a proposal. It neither proves display/consent nor creates a
 * provider subscription; native acceptance must retain genuine evidence. */
export function serviceRecurringStatementSha256V4(offer:unknown,bundle:unknown,lines:unknown,raw:unknown){
 const b=verifyServiceOfferBindingV4(offer),display=verifyServiceDisplayBundleV4(b,bundle),presentation=serviceRecurringPresentationV4Schema.parse(raw);
 const selection=serviceAcceptCommandV4Schema.shape.recurring.options[1].shape.lines.parse(lines);
 requireFact(presentation.displayBundleId===display.id&&presentation.displayBundleSha256===display.sha256&&presentation.locale===display.locale&&new Set(selection.map(line=>line.lineId)).size===selection.length);
 for(const line of selection){const actual=b.material.financial.lines.find(l=>l.id===line.lineId);
  requireFact(actual&&line.childId===actual.childId&&line.periodId===actual.period.id&&line.amountMinor===actual.amountMinor&&line.currency===b.material.financial.definition.currency&&line.firstPeriodStartsAt===actual.period.startsAt&&line.nextRenewalAt===actual.period.endsAt);
 }
 return digest({domain:'separate-recurring-card-statement/v4',offerSnapshotSha256:b.sha256,presentation,lines:selection,
  renewal:b.material.policy.renewal,cancellation:b.material.policy.cancellation,prepaidFirstPeriod:'once_no_renewal_before_start_no_second_charge_at_start'});
}
export function validateServiceAcceptCommandV4(offer:unknown,bundle:unknown,raw:unknown,presentation:unknown,recurringPresentation:unknown|null):ServiceAcceptCommandV4{
 const b=verifyServiceOfferBindingV4(offer),display=verifyServiceDisplayBundleV4(b,bundle),command=serviceAcceptCommandV4Schema.parse(raw),p=servicePresentationV4Schema.parse(presentation);
 requireFact(command.expectedQuoteRevision===b.material.financial.issuedRevision&&command.offerSnapshotSha256===b.sha256&&command.displayBundleId===display.id&&command.displayBundleSha256===display.sha256);
 serviceFinancialStatementSha256V4(b,display,p);
 if(command.recurring.kind==='one_time_only')requireFact(recurringPresentation===null);
 else{const r=serviceRecurringPresentationV4Schema.parse(recurringPresentation);requireFact(r.grantId===p.grantId);
  requireFact(command.recurring.statementSha256===serviceRecurringStatementSha256V4(b,display,command.recurring.lines,r));}
 return command;
}
export const serviceMaterialPurposeV4={version:BILLING_SERVICE_V4,action:SERVICE_FINANCIAL_ACTION_V4} as const;
export function verifyServiceGrantRecordV4(raw:unknown){
 const g=serviceGrantRecordV4Schema.parse(raw);verifyServiceOfferBindingV4(g.offer);verifyServiceDisplayBundleV4(g.offer,g.displayBundle);return g;
}
/** Integrity/readback recipe only. A native V4 writer must first establish real
 * one-use purpose-bound grant/display/guardian/document/provider authority and
 * persist this evidence atomically with the existing quote/obligation ledger. */
export function verifyServiceFinancialAcceptanceV4(raw:unknown,presentation:unknown,recurringPresentation:unknown|null){
 const a=serviceFinancialAcceptanceV4Schema.parse(raw),p=servicePresentationV4Schema.parse(presentation);
 verifyServiceOfferBindingV4(a.offer);verifyServiceDisplayBundleV4(a.offer,a.displayed);
 requireFact(p.grantId===a.grantId&&a.parent.statementSha256===serviceFinancialStatementSha256V4(a.offer,a.displayed,p));
 requireFact(Object.values(a.offer.material.financial.definition.policies).every(value=>value!==null)&&a.offer.material.financial.lines.every(line=>line.dueAt!==null));
 if(a.recurring.kind==='one_time_only')requireFact(recurringPresentation===null);
 else{const r=serviceRecurringPresentationV4Schema.parse(recurringPresentation);requireFact(r.grantId===a.grantId&&a.recurring.statementSha256===serviceRecurringStatementSha256V4(a.offer,a.displayed,a.recurring.lines,r));}
 return a;
}
