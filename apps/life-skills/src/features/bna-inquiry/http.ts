import "server-only";
import {randomUUID} from "node:crypto";
import {z} from "zod";
import {AppError} from "../../lib/errors.ts";
import {failureResponse,readJson,successResponse} from "../../lib/http/json.ts";
import {verifyMutationOrigin,verifyCsrfToken} from "../../lib/security/csrf.ts";
import {enforceRateLimit,opaqueRateLimitKey,type RateLimitStore} from "../../lib/security/rate-limit.ts";
import {canonicalForwardedRequest} from "../integration/canonical-forwarded-request.ts";
import {configuredGroupApplicationOrigin} from "../group-application/public-origin.ts";
import {issueBnaInquiryChallenge,verifyBnaInquiryChallenge} from "./challenge.ts";
import {SESSION_COOKIE} from "../../lib/security/session.ts";
import {TOKEN_PATTERN} from "../identity/crypto.ts";
import type {Actor} from "../identity/types.ts";
import {BNA_INQUIRY_NOTICE,bnaAttributionSchema,bnaFollowupCommandSchema,bnaInquirySubmissionSchema} from "./contract.ts";
import {BNA_COOP_PROGRAM,BNA_COOP_NOTICE,bnaCoopFieldsSchema} from "./coop-contract.ts";
import type {BnaInquiryStore} from "./store.ts";

const coopSubmission=z.object({challenge:z.string().min(80).max(1024),website:z.literal("").optional(),operationId:z.string().uuid(),fields:bnaCoopFieldsSchema,attribution:bnaAttributionSchema.optional()}).strict();
type PublicDeps={enabled:boolean;environment:Record<string,string|undefined>;challengeKey:string;now:()=>number;
 limits:RateLimitStore;store:Pick<BnaInquiryStore,"submit">};
export async function publicBnaInquiryHttp(request:Request,load:()=>Promise<PublicDeps>,purpose:"torah"|"coop"="torah"):Promise<Response>{
 const requestId=randomUUID();let response:Response;
 try{
  const d=await load(),url=new URL(request.url),origin=configuredGroupApplicationOrigin(request,d.environment);
  if(!d.enabled||!origin||url.pathname!==(purpose==="coop"?"/api/public/bna-coop-inquiries":"/api/public/bna-inquiries")||url.search||url.hash)throw new AppError("NOT_FOUND");
  if(request.method==="GET"){
   response=successResponse({notice:purpose==="coop"?BNA_COOP_NOTICE:BNA_INQUIRY_NOTICE,challenge:issueBnaInquiryChallenge(d.challengeKey,d.now(),purpose)},requestId);
  }else if(request.method==="POST"){
   if(request.headers.get("sec-fetch-site")!=="same-origin")throw new AppError("FORBIDDEN");
   verifyMutationOrigin(request,origin);
   const input=purpose==="coop"?await readJson(request,coopSubmission):await readJson(request,bnaInquirySubmissionSchema);
   verifyBnaInquiryChallenge(input.challenge,d.challengeKey,d.now(),purpose);
   await enforceRateLimit(d.limits,opaqueRateLimitKey("public-bna-inquiry:global",d.challengeKey),30,60_000);
   const attribution=purpose==="coop"?{...input.attribution,landingPath:input.fields.permission.language==="he"?"/he/join" as const:"/join" as const}:input.attribution;
   const record={operationId:input.operationId,fields:input.fields,...(attribution?{attribution}:{})};
   const result=purpose==="coop"?await d.store.submit(record,BNA_COOP_PROGRAM):await d.store.submit(record);
   response=successResponse(result,requestId,result.replayed?200:201);
  }else throw new AppError("INVALID_REQUEST");
 }catch(error){response=failureResponse(error instanceof AppError?error:new AppError("UNAVAILABLE"),requestId);}
 response.headers.set("Referrer-Policy","no-referrer");response.headers.set("X-Content-Type-Options","nosniff");
 return response;
}

type PrivateDeps={origin:string;actor:(token:string)=>Promise<Actor>;csrf:(token:string)=>string;
 limits:RateLimitStore;rateLimitKey:string;store:Pick<BnaInquiryStore,"list"|"read"|"followup">};
export async function privateBnaInquiryHttp(request:Request,load:()=>Promise<PrivateDeps>):Promise<Response>{
 const requestId=randomUUID();let response:Response;
 try{
  const cookies=(request.headers.get("cookie")??"").split(";").map(value=>value.trim()).filter(value=>value.startsWith(SESSION_COOKIE+"="));
  if(cookies.length!==1)throw new AppError("UNAUTHENTICATED");
  const token=cookies[0]!.slice(SESSION_COOKIE.length+1);if(!TOKEN_PATTERN.test(token))throw new AppError("UNAUTHENTICATED");
  const d=await load(),canonical=canonicalForwardedRequest(request,d.origin),url=new URL(canonical.url);
  if(url.origin!==d.origin||url.pathname!=="/api/private/bna-inquiries")throw new AppError("NOT_FOUND");
  const actor=await d.actor(token);
  if(request.method==="GET"){
   const keys=[...url.searchParams.keys()];if(keys.length>1||keys.length===1&&!['id','before'].includes(keys[0]!))throw new AppError("INVALID_REQUEST");
   const id=url.searchParams.get("id"),before=url.searchParams.get("before");if(keys.length&&!(id||before))throw new AppError("INVALID_REQUEST");
   response=successResponse(id?await d.store.read(actor,id):await d.store.list(actor,before??undefined),requestId);
  }else if(request.method==="POST"){
   if(url.search)throw new AppError("INVALID_REQUEST");
   verifyMutationOrigin(canonical,d.origin);verifyCsrfToken(request.headers.get("x-csrf-token"),d.csrf(token));
   await enforceRateLimit(d.limits,opaqueRateLimitKey(`bna-followup:${actor.workspaceId}:${actor.id}`,d.rateLimitKey),30,60_000);
   const input=await readJson(request,bnaFollowupCommandSchema);
   response=successResponse(await d.store.followup(actor,input),requestId);
  }else throw new AppError("INVALID_REQUEST");
 }catch(error){response=failureResponse(error instanceof AppError?error:new AppError("UNAVAILABLE"),requestId);}
 response.headers.set("Referrer-Policy","no-referrer");response.headers.set("X-Content-Type-Options","nosniff");
 response.headers.set("Content-Security-Policy","default-src 'none'; frame-ancestors 'none'");
 return response;
}
