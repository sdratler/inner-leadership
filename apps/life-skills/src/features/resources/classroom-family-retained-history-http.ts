import "server-only";
import {AppError} from "../../lib/errors.ts";
import {readJson} from "../../lib/http/json.ts";
import {Ls050HttpBoundary,type Ls050HttpRuntime} from "../forms/http-boundary.ts";
import {FishingProgramError} from "../fishing/native-program-contract.ts";
import type {ClassroomFamilyRetainedHistoryStore} from "./classroom-family-retained-history-store.ts";
import {classroomFamilyRetainedHistoryPath,classroomFamilyRetainedHistoryRequestSchema} from "./classroom-family-retained-history-contract.ts";
export class ClassroomFamilyRetainedHistoryHttp {
 private readonly boundary:Ls050HttpBoundary;
 constructor(runtime:Ls050HttpRuntime,private readonly store:Pick<ClassroomFamilyRetainedHistoryStore,"read">){this.boundary=new Ls050HttpBoundary(runtime);}
 handle(request:Request){return this.boundary.handle(request,new URL(request.url).pathname===classroomFamilyRetainedHistoryPath?["POST"]:[],async(actor,_id,url)=>{
  try{
   if(actor.role!=="practitioner")throw new AppError("FORBIDDEN");if(url.search)throw new AppError("INVALID_REQUEST");
   return {data:await this.store.read(actor,await readJson(request,classroomFamilyRetainedHistoryRequestSchema))};
  }catch(error){
   if(error instanceof AppError)throw error;
   if(error instanceof FishingProgramError&&["FORBIDDEN","NOT_FOUND","CONFLICT","INVALID_REQUEST","UNAVAILABLE"].includes(error.code))throw new AppError(error.code as "FORBIDDEN"|"NOT_FOUND"|"CONFLICT"|"INVALID_REQUEST"|"UNAVAILABLE");
   throw new AppError("UNAVAILABLE");
  }
 });}
}
