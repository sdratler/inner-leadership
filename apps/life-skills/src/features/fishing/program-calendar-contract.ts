import {z} from "zod";
import {academySharedServiceViewSchema} from './academy-shared-service-contract.ts';
import {stageReferenceSchema,type StageView} from "../fishing-stage/contract.ts";

const uuid=z.uuid(),label=z.string().min(1).max(160),version=z.string().min(1).max(120);
export const fishingCalendarLimit=1000;
export const fishingCalendarSelectionSchema=z.strictObject({learnerId:uuid.nullable(),enrollmentId:uuid.nullable(),reference:stageReferenceSchema});
export type FishingCalendarSelection=z.infer<typeof fishingCalendarSelectionSchema>;
export const fishingCalendarStageSchema=stageReferenceSchema.extend({label,enrollmentId:uuid.nullable(),learnerId:uuid.nullable(),templateVersion:version,childCapacity:z.number().int().min(1).max(1000)}).strict();
export const fishingCalendarChoicesSchema=z.strictObject({availability:z.enum(["ready","not_configured"]),role:z.enum(["practitioner","parent","child"]),
 children:z.array(z.strictObject({learnerId:uuid,displayName:label})).max(100),selectedLearnerId:uuid.nullable(),stages:z.array(fishingCalendarStageSchema).max(fishingCalendarLimit)});
export type FishingCalendarChoices=z.infer<typeof fishingCalendarChoicesSchema>;
export const fishingCalendarOperatorSchema=z.strictObject({venues:z.array(z.strictObject({id:uuid,label,address:z.string().max(1200),capacity:z.number().int().min(1).max(1000)})).max(fishingCalendarLimit),
 roster:z.array(z.strictObject({enrollmentId:uuid,learnerId:uuid,displayName:label})).max(fishingCalendarLimit),
 makeupNotices:z.array(z.strictObject({id:uuid,enrollmentId:uuid,learnerId:uuid})).max(12000),
 makeupFits:z.array(z.strictObject({id:uuid,learnerId:uuid,occurrenceId:uuid,revision:z.number().int().positive(),startsAt:z.iso.datetime({offset:true}),label:z.string().min(1).max(1200)})).max(fishingCalendarLimit)});
export type FishingCalendarOperator=z.infer<typeof fishingCalendarOperatorSchema>;
export type FishingCalendarPlan={sharedEvents?:readonly FishingCalendarEvent[];nextPhysical?:FishingCalendarEvent|null;selection:FishingCalendarSelection;choice:z.infer<typeof fishingCalendarStageSchema>;view:StageView|null;operator:FishingCalendarOperator;lessonLearnerId:string|null;
 lessonLinks:readonly {occurrenceId:string;href:string}[]};
const selectionKeys=["learnerId","enrollmentId","cohortId","stageId","stage"] as const;
const civilDay=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>{const d=new Date(value+"T12:00:00Z");return Number.isFinite(d.valueOf())&&d.toISOString().slice(0,10)===value;});
export const fishingCalendarWindowSchema=z.strictObject({from:civilDay,to:civilDay,learnerId:uuid.nullable()}).refine(value=>{const span=(Date.parse(value.to+"T12:00:00Z")-Date.parse(value.from+"T12:00:00Z"))/86400000;return span>=0&&span<62;});
export const fishingCalendarEventSchema=z.strictObject({id:uuid,revision:z.number().int().positive(),ordinal:z.number().int().min(1).max(12),label,state:z.enum(["published","completed","cancelled"]),startsAt:z.iso.datetime({offset:true}),endsAt:z.iso.datetime({offset:true}),timeZone:z.literal("America/New_York"),location:z.string().max(2400),details:z.strictObject({directions:z.string().max(1200),equipment:z.string().max(1200),logisticalNote:z.string().max(1200),changedAt:z.iso.datetime({offset:true})}).optional(),selections:z.array(fishingCalendarSelectionSchema).min(1).max(fishingCalendarLimit),shared:z.strictObject({kind:z.literal('monthly_core_keys'),originals:z.array(z.strictObject({selection:fishingCalendarSelectionSchema,occurrenceId:uuid,ordinal:z.number().int().min(1).max(12),moduleId:label,moduleVersion:version,participation:z.enum(['keys','local_alternative','review_required','operator_context']),service:academySharedServiceViewSchema.optional()})).min(1).max(fishingCalendarLimit),weeklyService:z.enum(['not_inferred','per_original']),originalActivity:z.literal('not_inferred')}).optional()});
export type FishingCalendarEvent=z.infer<typeof fishingCalendarEventSchema>;
export const fishingCalendarTimelineSchema=z.strictObject({availability:z.enum(["ready","not_configured"]),items:z.array(fishingCalendarEventSchema).max(fishingCalendarLimit)});
/** Fishing civil days are Florida days, never the host's or clinical calendar's zone. */
export function fishingCivilTime(instant:string):{date:string;time:string}{
 if(!z.iso.datetime({offset:true}).safeParse(instant).success)throw Error("FISHING_TIME_INVALID");
 const parts=new Intl.DateTimeFormat("en-US",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date(instant));
 const value=(type:Intl.DateTimeFormatPartTypes)=>parts.find(part=>part.type===type)!.value;
 return {date:`${value("year")}-${value("month")}-${value("day")}`,time:`${value("hour")}:${value("minute")}`};
}
/** Called only with freshly authorized Stage views. No draft/undated booking. */
export function fishingCalendarEvents(plans:readonly Pick<FishingCalendarPlan,"selection"|"choice"|"view">[],window:z.infer<typeof fishingCalendarWindowSchema>):FishingCalendarEvent[]{
 const range=fishingCalendarWindowSchema.parse(window),events=new Map<string,FishingCalendarEvent>();
 for(const plan of plans)for(const o of plan.view?.occurrences??[]){
  if(o.state==="draft"||o.time.kind!=="scheduled")continue;
  if(o.time.timeZone!=="America/New_York")throw Error("FISHING_TIME_ZONE_INVALID");
  const {date}=fishingCivilTime(o.time.startsAt);if(date<range.from||date>range.to)continue;
  const event=fishingCalendarEventSchema.parse({id:o.id,revision:o.revision,ordinal:o.ordinal,label:plan.choice.label,state:o.state,startsAt:o.time.startsAt,endsAt:o.time.endsAt,timeZone:o.time.timeZone,location:o.location,selections:[plan.selection]}),prior=events.get(o.id);
  if(prior){if(JSON.stringify({...prior,selections:[]})!==JSON.stringify({...event,selections:[]}))throw Error("FISHING_EVENT_INCONSISTENT");if(!prior.selections.some(s=>fishingCalendarSearch(s)===fishingCalendarSearch(plan.selection)))prior.selections.push(plan.selection);}
  else events.set(o.id,event);
 }
 return fishingCalendarTimelineSchema.parse({availability:"ready",items:[...events.values()].sort((a,b)=>Date.parse(a.startsAt)-Date.parse(b.startsAt)||a.id.localeCompare(b.id))}).items;
}
export function fishingCalendarSelectionQuery(params:URLSearchParams):FishingCalendarSelection{
 if([...params.keys()].some(key=>!selectionKeys.includes(key as typeof selectionKeys[number])||params.getAll(key).length!==1))throw Error("FISHING_SELECTION_INVALID");
 const stage=params.get("stage");if(!stage||!/^[1-4]$/.test(stage))throw Error("FISHING_SELECTION_INVALID");
 return fishingCalendarSelectionSchema.parse({learnerId:params.get("learnerId"),enrollmentId:params.get("enrollmentId"),reference:{cohortId:params.get("cohortId"),stageId:params.get("stageId"),stage:Number(stage)}});
}
/** Context hints only; every read and mutation independently authorizes them. */
export function fishingCalendarSearch(selection:FishingCalendarSelection):string{
 const value=fishingCalendarSelectionSchema.parse(selection);
 return new URLSearchParams({...value.reference,stage:String(value.reference.stage),...(value.learnerId?{learnerId:value.learnerId}:{}),...(value.enrollmentId?{enrollmentId:value.enrollmentId}:{})}).toString();
}
export function selectedFishingStage(choices:FishingCalendarChoices,selection:FishingCalendarSelection){
 return choices.stages.find(choice=>choice.stageId===selection.reference.stageId&&choice.cohortId===selection.reference.cohortId&&choice.stage===selection.reference.stage&&choice.enrollmentId===selection.enrollmentId&&choice.learnerId===selection.learnerId)??null;
}
/** Preserve only known, well-shaped fishing context during Calendar navigation. */
export function fishingCalendarContext(params:URLSearchParams):Record<string,string>{
 const result:Record<string,string>={};
 if(params.get("fishing")==="1")result.fishing="1";
 for(const key of ["learnerId","enrollmentId","cohortId","stageId"]){const value=params.get(key);if(value&&params.getAll(key).length===1&&uuid.safeParse(value).success)result[key]=value;}
 if(params.getAll("stage").length===1&&/^[1-4]$/.test(params.get("stage")??""))result.stage=params.get("stage")!;
 return result;
}
