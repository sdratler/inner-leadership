import "server-only";
import {randomUUID} from "node:crypto";
import {AppError} from "../../lib/errors.ts";
import {failureResponse,readJson,successResponse} from "../../lib/http/json.ts";
import {enforceRateLimit,opaqueRateLimitKey,type RateLimitStore} from "../../lib/security/rate-limit.ts";
import {floridaGroupApplicationNotice,floridaSchoolInquiryNotice,floridaGroupApplicationSubmissionSchema,floridaGroupApplicationReadSubmissionSchema,groupApplicationNotice,groupApplicationSubmissionSchema} from "./contract.ts";
import {issueFloridaGroupApplicationChallenge,issueGroupApplicationChallenge,verifyGroupApplicationChallenge} from "./challenge.ts";
import {groupApplicationProgramFromRequest,verifyGroupApplicationRequest} from "./public-origin.ts";
import type {PublicGroupApplicationStore} from "./store.ts";

export type PublicGroupApplicationHttpDependencies={enabled:boolean;environment:Record<string,string|undefined>;challengeKey:string;
 now:()=>number;limits:RateLimitStore;store:Pick<PublicGroupApplicationStore,"submit">&Partial<Pick<PublicGroupApplicationStore,"replaySaved">>;
 afterCommit?:(reference:string)=>Promise<"queued"|"unknown"|"sent"|"canceled"|"not_requested"|undefined>};

export async function publicGroupApplicationHttp(request:Request,load:()=>Promise<PublicGroupApplicationHttpDependencies>):Promise<Response>{
 const requestId=randomUUID();let response:Response;
 try{
  const dependencies=await load();if(!dependencies.enabled)throw new AppError("NOT_FOUND");
  if(!["GET","POST"].includes(request.method))throw new AppError("INVALID_REQUEST");
  verifyGroupApplicationRequest(request,dependencies.environment,request.method==="POST");const programId=groupApplicationProgramFromRequest(request);
  if(request.method==="GET")response=successResponse({notice:programId?floridaGroupApplicationNotice:groupApplicationNotice,...(programId==="sunday_fishing_academy"?{schoolNotice:floridaSchoolInquiryNotice}:{}),
   challenge:programId?issueFloridaGroupApplicationChallenge(dependencies.challengeKey,programId,dependencies.now()):issueGroupApplicationChallenge(dependencies.challengeKey,dependencies.now())},requestId);
  else{
   let result:Awaited<ReturnType<PublicGroupApplicationStore["submit"]>>;
   if(programId){
    const body=await readJson(request,floridaGroupApplicationReadSubmissionSchema),challenge=verifyGroupApplicationChallenge(body.challenge,dependencies.challengeKey,dependencies.now());
    if(challenge.v!==2||body.fields.programId!==challenge.programId||body.fields.programId!==programId)throw new AppError("FORBIDDEN");
    await enforceRateLimit(dependencies.limits,opaqueRateLimitKey("public-group-application:global",dependencies.challengeKey),30,60_000);
    const current=floridaGroupApplicationSubmissionSchema.safeParse(body);
    if(current.success)result=await dependencies.store.submit({operationId:current.data.operationId,fields:current.data.fields});
    else{const prior=await dependencies.store.replaySaved?.({operationId:body.operationId,fields:body.fields});
     if(!prior)throw new AppError("INVALID_REQUEST");result=prior;}
   }else{
    const body=await readJson(request,groupApplicationSubmissionSchema),challenge=verifyGroupApplicationChallenge(body.challenge,dependencies.challengeKey,dependencies.now());
    if(challenge.v!==1)throw new AppError("FORBIDDEN");
    await enforceRateLimit(dependencies.limits,opaqueRateLimitKey("public-group-application:global",dependencies.challengeKey),30,60_000);
    result=await dependencies.store.submit({operationId:body.operationId,fields:body.fields});
   }
   // submit/replay has completed its durable transaction. A mail error cannot undo or hide the saved inquiry.
   let acknowledgment:Awaited<ReturnType<NonNullable<PublicGroupApplicationHttpDependencies["afterCommit"]>>>;
   if(dependencies.afterCommit){try{acknowledgment=await dependencies.afterCommit(result.item.id);}catch{acknowledgment="unknown";}}
   response=successResponse({...result,...(acknowledgment?{acknowledgment}:{})},requestId,result.replayed||result.duplicate?200:201);
  }
 }catch(error){response=failureResponse(error instanceof AppError?error:new AppError("UNAVAILABLE"),requestId);}
 response.headers.set("Referrer-Policy","no-referrer");response.headers.set("X-Content-Type-Options","nosniff");
 return response;
}
