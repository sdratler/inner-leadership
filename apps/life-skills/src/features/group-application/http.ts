import "server-only";
import {randomUUID} from "node:crypto";
import {AppError} from "../../lib/errors.ts";
import {failureResponse,readJson,successResponse} from "../../lib/http/json.ts";
import {enforceRateLimit,opaqueRateLimitKey,type RateLimitStore} from "../../lib/security/rate-limit.ts";
import {groupApplicationNotice,groupApplicationSubmissionSchema} from "./contract.ts";
import {issueGroupApplicationChallenge,verifyGroupApplicationChallenge} from "./challenge.ts";
import {verifyGroupApplicationRequest} from "./public-origin.ts";
import type {PublicGroupApplicationStore} from "./store.ts";

export type PublicGroupApplicationHttpDependencies={enabled:boolean;environment:Record<string,string|undefined>;challengeKey:string;
 now:()=>number;limits:RateLimitStore;store:Pick<PublicGroupApplicationStore,"submit">};

export async function publicGroupApplicationHttp(request:Request,load:()=>Promise<PublicGroupApplicationHttpDependencies>):Promise<Response>{
 const requestId=randomUUID();let response:Response;
 try{
  const dependencies=await load();if(!dependencies.enabled)throw new AppError("NOT_FOUND");
  if(!["GET","POST"].includes(request.method))throw new AppError("INVALID_REQUEST");
  verifyGroupApplicationRequest(request,dependencies.environment,request.method==="POST");
  if(request.method==="GET")response=successResponse({notice:groupApplicationNotice,challenge:issueGroupApplicationChallenge(dependencies.challengeKey,dependencies.now())},requestId);
  else{
   const body=await readJson(request,groupApplicationSubmissionSchema);
   verifyGroupApplicationChallenge(body.challenge,dependencies.challengeKey,dependencies.now());
   await enforceRateLimit(dependencies.limits,opaqueRateLimitKey("public-group-application:global",dependencies.challengeKey),30,60_000);
   const result=await dependencies.store.submit({operationId:body.operationId,fields:body.fields});
   response=successResponse(result,requestId,result.replayed||result.duplicate?200:201);
  }
 }catch(error){response=failureResponse(error instanceof AppError?error:new AppError("UNAVAILABLE"),requestId);}
 response.headers.set("Referrer-Policy","no-referrer");response.headers.set("X-Content-Type-Options","nosniff");
 return response;
}
