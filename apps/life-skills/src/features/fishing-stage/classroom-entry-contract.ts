import {z} from "zod";
import {fishingCalendarChoicesSchema,fishingCalendarSearch,fishingCalendarSelectionSchema,fishingCalendarStageSchema,type FishingCalendarSelection} from "../fishing/program-calendar-contract.ts";
import {educationReferenceSchema,educationSearch} from "../resources/education-query.ts";
import {stageReferenceSchema} from "./contract.ts";

/** Presentation binding only. These reads never establish lesson authority:
 * Calendar and Resources independently resolve the current native grants. */
const uuid=z.uuid();
const sessionSchema=z.object({accountId:uuid,role:z.enum(["parent","practitioner","child","adult_client"]),locale:z.enum(["en","he"])});
const occurrenceSchema=z.object({...stageReferenceSchema.shape,id:uuid,ordinal:z.number().int().min(1).max(12),
 moduleId:educationReferenceSchema.shape.moduleId,moduleVersion:educationReferenceSchema.shape.version,
 state:z.enum(["draft","published","completed","cancelled"])});
const referenceSchema=z.strictObject({occurrenceId:uuid,moduleId:educationReferenceSchema.shape.moduleId,version:educationReferenceSchema.shape.version});
// Deliberately pick only chooser metadata, never retain the rest of a StageView.
const viewSchema=z.object({...stageReferenceSchema.shape,role:z.literal("parent"),enrollmentId:uuid,
 occurrences:z.array(occurrenceSchema).max(12),lessonReferences:z.array(referenceSchema).max(12)});
const planSchema=z.object({selection:fishingCalendarSelectionSchema,choice:fishingCalendarStageSchema,view:viewSchema.nullable(),
 lessonLearnerId:uuid,lessonLinks:z.array(z.strictObject({occurrenceId:uuid,href:z.string().min(1).max(1600)})).max(12)});
const requestSchema=z.strictObject({generation:z.number().int().nonnegative(),learnerId:uuid.nullable(),enrollmentId:uuid.nullable()})
 .refine(value=>value.learnerId!==null||value.enrollmentId===null);
export type ClassroomEntryRequest=z.infer<typeof requestSchema>;
/** URL context is a selection hint. Every load still checks current native access. */
export function classroomEntryRequestFromQuery(query:Record<string,string|string[]|undefined>):ClassroomEntryRequest|null{
 const request=requestSchema.safeParse({generation:0,learnerId:query.learnerId??null,enrollmentId:query.enrollmentId??null});
 return request.success?request.data:null;
}
export function classroomEntrySearch(request:ClassroomEntryRequest,priorSearch:string):string{
 const selected=requestSchema.parse(request),query=new URLSearchParams(priorSearch);
 for(const key of["learnerId","enrollmentId"])query.delete(key);
 if(selected.learnerId)query.set("learnerId",selected.learnerId);
 if(selected.enrollmentId)query.set("enrollmentId",selected.enrollmentId);
 return query.toString();
}
export type ClassroomEntryFailure="UNAUTHENTICATED"|"FORBIDDEN"|"NOT_FOUND"|"UNAVAILABLE";
export class ClassroomEntryError extends Error{
 constructor(readonly code:ClassroomEntryFailure){super(code);this.name="ClassroomEntryError";}
}
type Child={learnerId:string;displayName:string};
type Stage=z.infer<typeof fishingCalendarStageSchema>;
export type ClassroomEntryLesson={occurrenceId:string;ordinal:number;moduleId:string;version:string;state:"published"|"completed"|"cancelled";href:string};
export type ClassroomEntryData={availability:"ready"|"not_configured";children:Child[];stages:Stage[];lessons:ClassroomEntryLesson[]};
export type ClassroomEntryReadPort={session():Promise<unknown>;read(path:string):Promise<unknown>};
function mismatch():never{throw new ClassroomEntryError("UNAVAILABLE");}
function parentSession(raw:unknown){
 const parsed=sessionSchema.safeParse(raw);if(!parsed.success)mismatch();
 if(parsed.data.role!=="parent")throw new ClassroomEntryError("FORBIDDEN");return parsed.data;
}
function unique(values:readonly (string|number)[]){if(new Set(values).size!==values.length)mismatch();}
function sameStage(a:z.infer<typeof stageReferenceSchema>,b:z.infer<typeof stageReferenceSchema>){return a.cohortId===b.cohortId&&a.stageId===b.stageId&&a.stage===b.stage;}
function selectionFor(stage:Stage):FishingCalendarSelection{
 return {learnerId:stage.learnerId,enrollmentId:stage.enrollmentId,reference:{cohortId:stage.cohortId,stageId:stage.stageId,stage:stage.stage}};
}
function lessonChoices(raw:unknown,choice:Stage,locale:"en"|"he"):ClassroomEntryLesson[]{
 const parsed=planSchema.safeParse(raw);if(!parsed.success)mismatch();const plan=parsed.data,selection=selectionFor(choice);
 if(fishingCalendarSearch(plan.selection)!==fishingCalendarSearch(selection)||
  Object.keys(choice).some(key=>choice[key as keyof Stage]!==plan.choice[key as keyof Stage])||plan.lessonLearnerId!==choice.learnerId)mismatch();
 if(!plan.view){if(plan.lessonLinks.length)mismatch();return [];}
 const view=plan.view;
 if(!sameStage(view,choice)||view.enrollmentId!==choice.enrollmentId)mismatch();
 unique(view.occurrences.map(o=>o.id));unique(view.occurrences.map(o=>o.ordinal));
 unique(view.lessonReferences.map(ref=>ref.occurrenceId));unique(plan.lessonLinks.map(link=>link.occurrenceId));
 for(const occurrence of view.occurrences){
  if(!sameStage(occurrence,choice)||occurrence.moduleId!==`RM-${choice.stage}${String(occurrence.ordinal).padStart(2,"0")}`)mismatch();
 }
 for(const ref of view.lessonReferences){
  const occurrence=view.occurrences.find(o=>o.id===ref.occurrenceId);
  if(!occurrence||ref.moduleId!==occurrence.moduleId||ref.version!==occurrence.moduleVersion)mismatch();
 }
 return plan.lessonLinks.map(link=>{
  const occurrence=view.occurrences.find(o=>o.id===link.occurrenceId),ref=view.lessonReferences.find(r=>r.occurrenceId===link.occurrenceId);
  if(!occurrence||occurrence.state==="draft"||!ref||!choice.learnerId)mismatch();
  const expected=`/${locale}/family/resources?${educationSearch({learnerId:choice.learnerId,moduleId:ref.moduleId,version:ref.version},"lesson")}`;
  // Keep the server's exact href; do not manufacture a link from enrollment.
  if(link.href!==expected)mismatch();
  return {occurrenceId:occurrence.id,ordinal:occurrence.ordinal,moduleId:ref.moduleId,version:ref.version,state:occurrence.state,href:link.href};
 }).sort((a,b)=>a.ordinal-b.ordinal);
}
/** The caller invalidates pending reads on context change/unmount. A late read
 * stops before the next request and is also fenced by the reducer generation. */
export async function readClassroomEntry(rawRequest:ClassroomEntryRequest,port:ClassroomEntryReadPort,current:()=>boolean):Promise<ClassroomEntryData|null>{
 const request=requestSchema.parse(rawRequest);if(!current())return null;
 const before=parentSession(await port.session());if(!current())return null;
 const raw=await port.read("fishing/context"+(request.learnerId?"?"+new URLSearchParams({learnerId:request.learnerId}):""));
 if(!current())return null;
 const parsed=fishingCalendarChoicesSchema.safeParse(raw);if(!parsed.success)mismatch();const choices=parsed.data;
 if(choices.role!=="parent")throw new ClassroomEntryError("FORBIDDEN");
 unique(choices.children.map(child=>child.learnerId));unique(choices.stages.map(stage=>stage.enrollmentId??stage.stageId));
 let lessons:ClassroomEntryLesson[]=[];
 if(choices.availability==="not_configured"){
  if(choices.children.length||choices.stages.length||choices.selectedLearnerId!==null)mismatch();
 }else{
  if(choices.selectedLearnerId!==request.learnerId||request.learnerId!==null&&!choices.children.some(child=>child.learnerId===request.learnerId)||
   choices.stages.some(stage=>!stage.enrollmentId||!stage.learnerId||stage.learnerId!==request.learnerId))mismatch();
  if(request.enrollmentId!==null){
   const choice=choices.stages.find(stage=>stage.enrollmentId===request.enrollmentId);if(!choice)throw new ClassroomEntryError("NOT_FOUND");
   const plan=await port.read("fishing/plan?"+fishingCalendarSearch(selectionFor(choice)));if(!current())return null;
   lessons=lessonChoices(plan,choice,before.locale);
  }
 }
 const after=parentSession(await port.session());if(!current())return null;
 if(after.accountId!==before.accountId||after.locale!==before.locale)throw new ClassroomEntryError("FORBIDDEN");
 return {availability:choices.availability,children:choices.children,stages:choices.stages,lessons};
}
export type ClassroomEntryState=ClassroomEntryData&{request:ClassroomEntryRequest;status:"loading"|"ready"|"failed";failure:ClassroomEntryFailure|null};
export function initialClassroomEntry(request:ClassroomEntryRequest={generation:0,learnerId:null,enrollmentId:null}):ClassroomEntryState{
 return {request:requestSchema.parse(request),status:"loading",failure:null,availability:"ready",children:[],stages:[],lessons:[]};
}
export type ClassroomEntryAction=
 |{type:"learner";learnerId:string|null}|{type:"stage";enrollmentId:string|null}|{type:"refresh"}|{type:"restart"}
 |{type:"loaded";generation:number;data:ClassroomEntryData}|{type:"failed";generation:number;failure:ClassroomEntryFailure};
export function classroomEntryReducer(state:ClassroomEntryState,action:ClassroomEntryAction):ClassroomEntryState{
 if(action.type==="loaded"||action.type==="failed"){
  if(action.generation!==state.request.generation||state.status!=="loading")return state;
  return action.type==="loaded"?{...state,...action.data,status:"ready",failure:null}:
   {...state,status:"failed",failure:action.failure,children:[],stages:[],lessons:[]};
 }
 if(action.type==="learner"&&action.learnerId!==null&&!state.children.some(child=>child.learnerId===action.learnerId))return state;
 if(action.type==="stage"&&action.enrollmentId!==null&&!state.stages.some(stage=>stage.enrollmentId===action.enrollmentId&&stage.learnerId===state.request.learnerId))return state;
 const learnerId=action.type==="restart"?null:action.type==="learner"?action.learnerId:state.request.learnerId;
 const enrollmentId=action.type==="restart"||action.type==="learner"?null:action.type==="stage"?action.enrollmentId:state.request.enrollmentId;
 return {...state,request:{generation:state.request.generation+1,learnerId,enrollmentId},status:"loading",failure:null,lessons:[],
  children:action.type==="refresh"||action.type==="restart"?[]:state.children,stages:action.type==="stage"?state.stages:[]};
}
