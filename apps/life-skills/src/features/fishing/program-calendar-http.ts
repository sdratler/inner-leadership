import "server-only";
import {randomUUID} from "node:crypto";
import {z} from "zod";
import {AppError} from "../../lib/errors.ts";
import {failureResponse,readJson} from "../../lib/http/json.ts";
import {Ls050HttpBoundary,type Ls050HttpRuntime} from "../forms/http-boundary.ts";
import type {IdentityStore} from "../identity/store.ts";
import type {Actor} from "../identity/types.ts";
import {NativeFishingProgram} from "./native-program.ts";
import {nativeProgramIntentSchema} from "./native-program-contract.ts";
import {FishingProgramError} from "./native-program-contract.ts";
import {FishingStageError,FishingStageService} from "../fishing-stage/service.ts";
import {NativeFishingStageStore} from "../fishing-stage/native-store.ts";
import {stageCommandSchema,type StageView} from "../fishing-stage/contract.ts";
import {stageLessonReference} from "../fishing-stage/classroom.ts";
import {educationSearch} from "../resources/education-query.ts";
import {educationRehearsalEnabled} from "../resources/education-runtime.ts";
import {FishingLessonNativeStore} from "../resources/fishing-lesson-native-store.ts";
import {FishingLessonJourney} from "../resources/fishing-lesson-journey.ts";
import {fishingCalendarSelectionSchema,fishingCalendarSelectionQuery,selectedFishingStage,fishingCalendarWindowSchema,fishingCalendarEvents,type FishingCalendarPlan,type FishingCalendarSelection} from "./program-calendar-contract.ts";

export type FishingCalendarDependencies={runtime:Ls050HttpRuntime;store:IdentityStore};
const contextQuery=z.strictObject({learnerId:z.uuid().optional()});
export const fishingCalendarCommandSchema=z.strictObject({selection:fishingCalendarSelectionSchema,command:stageCommandSchema,intent:nativeProgramIntentSchema});
const prefix="/api/calendar/fishing/";
/** A denied optional lesson is not a failed Calendar plan. All other errors,
 * including expired sessions, corrupt artifacts and unknown failures, propagate. */
export function isDeniedFishingLessonLink(error:unknown):boolean{
 if(error instanceof AppError)return error.code==="FORBIDDEN"||error.code==="NOT_FOUND";
 return error instanceof Error&&error.message==="LESSON_JOURNEY_FORBIDDEN";
}
function safeFailure(error:unknown):AppError{
 if(error instanceof AppError)return error;
 if(error instanceof FishingStageError){return new AppError(error.code==="CAPACITY"||error.code==="APPROVAL_REQUIRED"?"CONFLICT":error.code==="INVALID_STATE"?"INVALID_REQUEST":error.code);}
 if(error instanceof FishingProgramError)return new AppError(error.code==="POLICY_REQUIRED"||error.code==="APPROVAL_REQUIRED"||error.code==="CAPACITY"?"CONFLICT":error.code);
 return new AppError("UNAVAILABLE");
}
async function loadDefault():Promise<FishingCalendarDependencies>{
 const {calendarRuntime}=await import("../calendar/runtime.ts"),{identity}=await calendarRuntime();
 return {runtime:{config:identity.config,sessions:identity.services.sessions,limits:identity.services.limits,audit:identity.services.audit,clock:identity.clock},store:identity.store};
}
/** Actual native composition. No alternative authority/store, environment
 * activation, grant writer, merchant fallback or legacy credit-effect drain. */
export async function handleFishingCalendar(request:Request,path:readonly string[],load:()=>Promise<FishingCalendarDependencies>=loadDefault):Promise<Response>{
 try{
  const d=await load(),{runtime,store}=d,program=new NativeFishingProgram(store,runtime.config.keyring,{childAccountsEnabled:runtime.config.childAccountsEnabled===true,merchant:null},runtime.clock);
  const stage=(actor:Actor,selection:FishingCalendarSelection,intent:z.infer<typeof nativeProgramIntentSchema>|null)=>new FishingStageService(new NativeFishingStageStore(store,runtime.config.keyring,{actor,selection:{selectedEnrollmentId:selection.enrollmentId}},program.stageHooks(intent),runtime.clock),runtime.clock);
  const authorize=async(actor:Actor,selection:FishingCalendarSelection)=>{
   const choices=await program.calendarChoices(actor,selection.learnerId);if(choices.availability!=="ready")throw new AppError("UNAVAILABLE");
   const choice=selectedFishingStage(choices,selection);if(!choice)throw new AppError("NOT_FOUND");return choice;
  };
  const links=async(actor:Actor,view:StageView|null,learnerId:string|null)=>{
   const result:FishingCalendarPlan["lessonLinks"][number][]=[];
   // Keep the existing production/loopback fence and optional-child UI boundary.
   // References are offered only after the real catalog/access read succeeds.
   if(!view||!learnerId||actor.role==="child"||!educationRehearsalEnabled())return result;
   const journey=new FishingLessonJourney(new FishingLessonNativeStore(store,runtime.config.keyring,actor,runtime.clock,{childAccountsEnabled:runtime.config.childAccountsEnabled===true}),()=>runtime.clock.now());
   for(const occurrence of view.occurrences){
    if(occurrence.state==="draft")continue;
    const ref=stageLessonReference(view,occurrence.id,learnerId);if(!ref)continue;
    try{await journey.read(ref,actor.role==="practitioner"?"teacher":"learner");}
    catch(error){if(isDeniedFishingLessonLink(error))continue;throw error;}
    result.push({occurrenceId:occurrence.id,href:`/${actor.locale}/${actor.role==="practitioner"?"app":"family"}/resources?${educationSearch(ref,actor.role==="practitioner"?"review":"lesson")}`});
   }return result;
  };
  return await new Ls050HttpBoundary(runtime).handle(request,["GET","POST"],async(actor,_requestId,url)=>{
   try{
    if(path.length!==1||url.pathname!==prefix+path[0])throw new AppError("NOT_FOUND");
    if(!["practitioner","parent","child"].includes(actor.role))throw new AppError("FORBIDDEN");
    let data:unknown;
    if(request.method==="GET"&&path[0]==="context"){
     const parsed=contextQuery.safeParse(Object.fromEntries(url.searchParams));if(!parsed.success||url.searchParams.size!==Object.keys(parsed.data).length)throw new AppError("INVALID_REQUEST");
     data=await program.calendarChoices(actor,parsed.data.learnerId??null);
    }else if(request.method==="GET"&&path[0]==="timeline"){
     const query=Object.fromEntries(url.searchParams),parsed=fishingCalendarWindowSchema.safeParse({...query,learnerId:query.learnerId??null});
     if(!parsed.success||url.searchParams.size!==Object.keys(query).length)throw new AppError("INVALID_REQUEST");
     const choices=await program.calendarChoices(actor,parsed.data.learnerId),plans:Pick<FishingCalendarPlan,"selection"|"choice"|"view">[]=[];
     if(choices.availability==="ready")for(const choice of choices.stages){
      const selection:FishingCalendarSelection={learnerId:choice.learnerId,enrollmentId:choice.enrollmentId,reference:{cohortId:choice.cohortId,stageId:choice.stageId,stage:choice.stage}};
      plans.push({choice,selection,view:await stage(actor,selection,null).read(actor,selection.reference)});
     }
     const current=await program.calendarChoices(actor,parsed.data.learnerId);
     if(current.availability!==choices.availability||plans.some(plan=>!selectedFishingStage(current,plan.selection)))throw new AppError("NOT_FOUND");
     data={availability:choices.availability,items:fishingCalendarEvents(plans,parsed.data)};
    }else if(request.method==="GET"&&path[0]==="plan"){
     const query=new URLSearchParams(url.searchParams),lessonLearnerId=query.get("lessonLearnerId");
     if(query.getAll("lessonLearnerId").length>1||lessonLearnerId!==null&&!z.uuid().safeParse(lessonLearnerId).success||actor.role!=="practitioner"&&lessonLearnerId!==null)throw new AppError("INVALID_REQUEST");query.delete("lessonLearnerId");
     let selection:FishingCalendarSelection;try{selection=fishingCalendarSelectionQuery(query);}catch{throw new AppError("INVALID_REQUEST");}
     const choice=await authorize(actor,selection),view=await stage(actor,selection,null).read(actor,selection.reference);
     const operator=actor.role==="practitioner"?await program.calendarOperatorChoices(actor,selection.reference):{venues:[],roster:[],makeupNotices:[],makeupFits:[]};
     if(lessonLearnerId!==null&&!operator.roster.some(row=>row.learnerId===lessonLearnerId))throw new AppError("NOT_FOUND");
     const learner=actor.role==="practitioner"?lessonLearnerId:selection.learnerId;
     data={selection,choice,view,operator,lessonLearnerId:learner,lessonLinks:await links(actor,view,learner)} satisfies FishingCalendarPlan;
     // Recheck current selection after potentially slower independent lesson reads.
     await authorize(actor,selection);
    }else if(request.method==="POST"&&path[0]==="command"){
     if(url.search||actor.role==="child")throw new AppError("FORBIDDEN");
     const body=await readJson(request,fishingCalendarCommandSchema),key=request.headers.get("idempotency-key");
     if(key!==body.command.operationId||body.intent.operationId!==body.command.operationId)throw new AppError("INVALID_REQUEST");
     if(actor.role!=="practitioner"&&(body.intent.resources.length!==0||body.intent.makeupFitDecisionId!==null))throw new AppError("FORBIDDEN");
     await authorize(actor,body.selection);
     data=await stage(actor,body.selection,body.intent).execute(actor,body.selection.reference,body.command);
    }else throw new AppError("NOT_FOUND");
    if(Buffer.byteLength(JSON.stringify(data),"utf8")>1048576)throw new AppError("UNAVAILABLE");
    return {data};
   }catch(error){throw safeFailure(error);}
  });
 }catch(error){
  const response=failureResponse(safeFailure(error),randomUUID());response.headers.set("Referrer-Policy","no-referrer");response.headers.set("X-Content-Type-Options","nosniff");response.headers.set("Content-Security-Policy","default-src 'none'; frame-ancestors 'none'");return response;
 }
}
