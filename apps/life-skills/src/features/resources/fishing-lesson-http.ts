import "server-only";
import {z} from "zod";
import {AppError} from "../../lib/errors.ts";
import {readJson} from "../../lib/http/json.ts";
import {Ls050HttpBoundary,type Ls050HttpRuntime} from "../forms/http-boundary.ts";
import type {Actor} from "../identity/types.ts";
import {FishingLessonJourney,lessonJourneyCommandSchema,lessonReferenceSchema} from "./fishing-lesson-journey.ts";
const path="/api/resources/education/lesson",view=z.enum(["learner","teacher","parent"]);
const requestBody=z.strictObject({reference:lessonReferenceSchema,command:lessonJourneyCommandSchema});
// HTTP dispatch has a parsed union view; the journey retains its narrower
// per-view overloads for typed consumers. This port does not supply authority.
type JourneyPort=Pick<FishingLessonJourney,"save">&{
 read(...args:Parameters<FishingLessonJourney["read"]>):ReturnType<FishingLessonJourney["read"]>;
};
/** UNMOUNTED: supplies no Next route, grant writer, importer or activation. */
export class FishingLessonHttp {
 private readonly boundary:Ls050HttpBoundary;
 private readonly childAccountsEnabled:boolean;
 constructor(runtime:Ls050HttpRuntime,private readonly journey:(actor:Actor)=>JourneyPort){this.boundary=new Ls050HttpBoundary(runtime);this.childAccountsEnabled=runtime.config.childAccountsEnabled===true;}
 handle(request:Request){return this.boundary.handle(request,new URL(request.url).pathname===path?["GET","POST"]:[],async actor=>{
  try{
   if(actor.role==="child"&&!this.childAccountsEnabled)throw new AppError("FORBIDDEN");
   const url=new URL(request.url),journey=this.journey(actor);
   if(request.method==="GET"){
    const query=z.strictObject({...lessonReferenceSchema.shape,view}).safeParse(Object.fromEntries(url.searchParams));
    if(!query.success||[...url.searchParams.keys()].length!==4)throw new AppError("INVALID_REQUEST");
    const {view:projection,...reference}=query.data;return {data:await journey.read(reference,projection)};
   }
   if(url.search)throw new AppError("INVALID_REQUEST");const input=await readJson(request,requestBody);
   return {data:await journey.save(input.reference,input.command)};
  }catch(error){
   if(error instanceof AppError)throw error;
   const message=error instanceof Error?error.message:"";
   if(message==="LESSON_JOURNEY_FORBIDDEN")throw new AppError("FORBIDDEN");
   if(message==="LESSON_JOURNEY_CONFLICT")throw new AppError("CONFLICT");
   if(["LESSON_JOURNEY_QUESTION_MISMATCH","LESSON_JOURNEY_SUBMISSION_MISMATCH","LESSON_JOURNEY_OBSERVATION_MISMATCH"].includes(message))throw new AppError("INVALID_REQUEST");
   throw new AppError("UNAVAILABLE");
  }
 });}
}
