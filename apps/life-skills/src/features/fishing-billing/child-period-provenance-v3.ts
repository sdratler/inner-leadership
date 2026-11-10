import {z} from 'zod';
import {billingId,billingInstant,createFamilyOfferSchema,sourceReferenceSchema,servicePeriodSchema} from './contracts.ts';
import {guestFamilyOfferSchema,type GuestFamilyOffer} from '../../lib/fishing-billing-guest-contract-v3.ts';
import type {BillingContext} from './native.ts';
import {calendarMonthlyChildPeriodV3} from './service-periods-v3.ts';
import {requireBilling} from './billing-errors.ts';

export const ANCHORED_OFFER_V3='JLFA-FISHING-ANCHORED-OFFER-v3' as const;
const revision=z.number().int().positive();
export const anchoredOfferCommandV3Schema=createFamilyOfferSchema.omit({children:true}).extend({
 version:z.literal(ANCHORED_OFFER_V3),
 children:z.array(z.object({
  lineId:billingId,childId:billingId,periodId:billingId,groupId:billingId,
  firstEligibleLessonId:billingId,expectedLessonRevision:revision,dueAt:billingInstant.nullable(),
 }).strict()).min(1).max(10),
}).strict().superRefine((v,c)=>{
 for(const key of ['lineId','childId','periodId'] as const){
  if(new Set(v.children.map(child=>child[key])).size!==v.children.length)c.addIssue({code:'custom',message:'DUPLICATE_'+key});
 }
});
export type AnchoredOfferCommandV3=z.infer<typeof anchoredOfferCommandV3Schema>;

/** Facts from a trusted native resolver, not authority supplied by an HTTP
 * client. In particular a proposed preparation is not an eligible lesson. */
export const nativeEligibleLessonV3Schema=z.object({
 workspaceId:billingId,familyId:billingId,childId:billingId,groupId:billingId,
 id:billingId,revision,startsAt:billingInstant,source:sourceReferenceSchema,
}).strict();
export type NativeEligibleLessonV3=z.infer<typeof nativeEligibleLessonV3Schema>;
export interface ChildPeriodNativeAuthorityV3{
 /** Read and lock the actual first scheduled eligible lesson, child/family,
  * group and progression/catch-up evidence in context.tx through commit.
  * Return exactly one fact per requested child, in the same order. No network,
  * cached/caller date, draft-as-authority, or retired scheduling fallback. */
 firstEligibleLessons(context:Readonly<BillingContext>,query:Readonly<{
  quoteId:string;familyId:string;children:readonly Readonly<AnchoredOfferCommandV3['children'][number]>[];
 }>):Promise<readonly NativeEligibleLessonV3[]|null>;
}
export const anchoredOfferPeriodV3Schema=z.object({
 lineId:billingId,childId:billingId,lesson:nativeEligibleLessonV3Schema,period:servicePeriodSchema,
}).strict();
export type AnchoredOfferPeriodV3=z.infer<typeof anchoredOfferPeriodV3Schema>;
export const anchoredOfferReceiptV3Schema=z.object({
 version:z.literal(ANCHORED_OFFER_V3),operationId:billingId,action:z.literal('create_anchored'),
 entityId:billingId,entityVersion:z.literal(1),quote:guestFamilyOfferSchema,
 periods:z.array(anchoredOfferPeriodV3Schema).min(1).max(10),replayed:z.boolean(),
}).strict();
export type AnchoredOfferReceiptV3=z.infer<typeof anchoredOfferReceiptV3Schema>;

export function deriveAnchoredOfferPeriodsV3(command:AnchoredOfferCommandV3,workspaceId:string,raw:readonly NativeEligibleLessonV3[]|null):AnchoredOfferPeriodV3[]{
 requireBilling(raw!==null&&raw.length===command.children.length,'UNAVAILABLE');
 return command.children.map((child,index)=>{
  const lesson=nativeEligibleLessonV3Schema.parse(raw![index]);
  requireBilling(lesson.workspaceId===workspaceId&&lesson.familyId===command.familyId&&lesson.childId===child.childId&&lesson.groupId===child.groupId,'UNAVAILABLE');
  requireBilling(lesson.id===child.firstEligibleLessonId&&lesson.revision===child.expectedLessonRevision,'CONFLICT');
  const {period}=calendarMonthlyChildPeriodV3({childId:child.childId,periodId:child.periodId,firstEligibleLesson:{id:lesson.id,startsAt:lesson.startsAt},cycle:0});
  return {lineId:child.lineId,childId:child.childId,lesson,period};
 });
}
/** Authenticate joins and recompute the original period before any stored
 * journal is used as provenance. Parsing alone never grants native authority. */
export function verifyAnchoredOfferReceiptV3(raw:unknown,command:AnchoredOfferCommandV3,current?:GuestFamilyOffer):AnchoredOfferReceiptV3{
 const receipt=anchoredOfferReceiptV3Schema.parse(raw),q=receipt.quote;
 requireBilling(receipt.entityId===q.id&&receipt.entityId===command.id&&receipt.operationId===command.operationId&&q.familyId===command.familyId&&q.definition.id===command.definitionId&&
  q.revision===1&&q.state==='draft'&&q.acceptance===null&&q.issuedAt===null&&q.lines.length===command.children.length&&receipt.periods.length===q.lines.length,'UNAVAILABLE');
 const derived=deriveAnchoredOfferPeriodsV3(command,q.workspaceId,receipt.periods.map(p=>p.lesson));
 requireBilling(JSON.stringify(receipt.periods)===JSON.stringify(derived),'UNAVAILABLE');
 const amounts=new Map(command.override?.amounts.map(a=>[a.lineId,a.amountMinor])??[]);
 requireBilling(command.override?!!q.override&&q.override.reason===command.override.reason&&amounts.size===command.children.length&&command.children.every(child=>amounts.has(child.lineId)):q.override===null,'UNAVAILABLE');
 for(const [index,line] of q.lines.entries()){
  const child=command.children[index]!,p=derived[index]!;
  requireBilling(line.id===p.lineId&&line.childId===p.childId&&line.groupId===child.groupId&&line.dueAt===child.dueAt&&line.amountMinor===(amounts.get(line.id)??q.definition.unitAmountMinor)&&JSON.stringify(line.period)===JSON.stringify(p.period),'UNAVAILABLE');
 }
 if(current)requireBilling(current.workspaceId===q.workspaceId&&current.id===q.id&&current.familyId===q.familyId&&current.revision>=q.revision&&
  JSON.stringify([current.createdAt,current.definition,current.lines,current.override])===JSON.stringify([q.createdAt,q.definition,q.lines,q.override]),'UNAVAILABLE');
 return receipt;
}
