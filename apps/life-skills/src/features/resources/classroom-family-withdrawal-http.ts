import "server-only";
import {AppError} from "../../lib/errors.ts";
import {readJson} from "../../lib/http/json.ts";
import {Ls050HttpBoundary,type Ls050HttpRuntime} from "../forms/http-boundary.ts";
import {FishingProgramError} from "../fishing/native-program-contract.ts";
import type {ClassroomFamilyWithdrawalStore} from "./classroom-family-withdrawal-store.ts";
import {classroomFamilyWithdrawalPath,classroomFamilyWithdrawalQuerySchema,classroomFamilyWithdrawalCommandSchema} from "./classroom-family-withdrawal-contract.ts";
export class ClassroomFamilyWithdrawalHttp {
 private readonly boundary:Ls050HttpBoundary;
 constructor(runtime:Ls050HttpRuntime,private readonly store:Pick<ClassroomFamilyWithdrawalStore,"review"|"execute">){this.boundary=new Ls050HttpBoundary(runtime);}
 handle(request:Request){return this.boundary.handle(request,new URL(request.url).pathname===classroomFamilyWithdrawalPath?["GET","POST"]:[],async(actor,_id,url)=>{
  try{
   if(actor.role!=="practitioner")throw new AppError("FORBIDDEN");
   if(request.method==="GET"){
    const parsed=classroomFamilyWithdrawalQuerySchema.safeParse(Object.fromEntries(url.searchParams));
    if(!parsed.success||url.searchParams.size!==2)throw new AppError("INVALID_REQUEST");return {data:await this.store.review(actor,parsed.data)};
   }
   if(url.search)throw new AppError("INVALID_REQUEST");const body=await readJson(request,classroomFamilyWithdrawalCommandSchema);
   if(request.headers.get("idempotency-key")!==body.operationId)throw new AppError("INVALID_REQUEST");return {data:await this.store.execute(actor,body)};
  }catch(error){
   if(error instanceof AppError)throw error;
   if(error instanceof FishingProgramError){const code=error.code;if(["FORBIDDEN","NOT_FOUND","CONFLICT","INVALID_REQUEST","UNAVAILABLE"].includes(code))throw new AppError(code as "FORBIDDEN"|"NOT_FOUND"|"CONFLICT"|"INVALID_REQUEST"|"UNAVAILABLE");}
   throw new AppError("UNAVAILABLE");
  }
 });}
}
