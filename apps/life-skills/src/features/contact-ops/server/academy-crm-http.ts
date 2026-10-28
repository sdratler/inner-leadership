import "server-only";
import {randomUUID} from "node:crypto";
import {z} from "zod";
import {AppError} from "../../../lib/errors.ts";
import {successResponse,failureResponse,readJson} from "../../../lib/http/json.ts";
import {SESSION_COOKIE} from "../../../lib/security/session.ts";
import {TOKEN_PATTERN} from "../../identity/crypto.ts";
import {verifyCsrfToken,verifyMutationOrigin} from "../../../lib/security/csrf.ts";
import {enforceRateLimit,opaqueRateLimitKey,type RateLimitStore} from "../../../lib/security/rate-limit.ts";
import {canonicalForwardedRequest} from "../../integration/canonical-forwarded-request.ts";
import type {Actor} from "../../identity/types.ts";
import {academyCrmCommandSchema} from "../core/academy-crm.ts";
import {ContractError} from "../core/validation.ts";
import type {AcademyCrmStore} from "./academy-crm-store.ts";

export type AcademyCrmHttpDependencies={origin:string;actor:(token:string)=>Promise<Actor>;csrf:(token:string)=>string;
 limits:RateLimitStore;rateLimitKey:string;store:Pick<AcademyCrmStore,"list"|"read"|"previewInquiry"|"execute">};
const getSchema=z.union([
 z.object({search:z.string().max(200).optional(),page:z.string().regex(/^[1-9]\d{0,4}$/).optional()}).strict(),
 z.object({personId:z.string().uuid(),expectedEpoch:z.string().regex(/^\d{1,16}$/)}).strict(),
 z.object({inquiryId:z.string().uuid(),expectedEpoch:z.string().regex(/^\d{1,16}$/)}).strict(),
]);
/** Ordinary owner operations only. No authority switch, program/workspace
 * selector, legacy import, identity merge, provider binding or send action. */
export async function academyCrmHttp(request:Request,load:()=>Promise<AcademyCrmHttpDependencies>){
 const id=randomUUID();let response:Response;
 try{
  const cookies=(request.headers.get("cookie")??"").split(";").map(value=>value.trim()).filter(value=>value.startsWith(SESSION_COOKIE+"="));
  if(cookies.length!==1)throw new AppError("UNAUTHENTICATED");
  const token=cookies[0]!.slice(SESSION_COOKIE.length+1);if(!TOKEN_PATTERN.test(token))throw new AppError("UNAUTHENTICATED");
  const d=await load(),canonical=canonicalForwardedRequest(request,d.origin),url=new URL(canonical.url);
  if(url.origin!==d.origin||url.pathname!=="/api/private/academy-crm")throw new AppError("INVALID_REQUEST");
  const actor=await d.actor(token);if(actor.role!=="practitioner")throw new AppError("FORBIDDEN");
  if(request.method==="GET"){
   const keys=[...url.searchParams.keys()];if(new Set(keys).size!==keys.length)throw new AppError("INVALID_REQUEST");
   const parsed=getSchema.safeParse(Object.fromEntries(url.searchParams));if(!parsed.success)throw new AppError("INVALID_REQUEST");
   const query=parsed.data;
   const data="personId" in query?await d.store.read(actor,query.personId,Number(query.expectedEpoch)):
    "inquiryId" in query?await d.store.previewInquiry(actor,query.inquiryId,Number(query.expectedEpoch)):
    await d.store.list(actor,{search:query.search??"",page:Number(query.page??"1")});
   response=successResponse(data,id);
  }else if(request.method==="POST"){
   if(url.search)throw new AppError("INVALID_REQUEST");
   verifyMutationOrigin(canonical,d.origin);verifyCsrfToken(request.headers.get("x-csrf-token"),d.csrf(token));
   await enforceRateLimit(d.limits,opaqueRateLimitKey(`academy-crm:${actor.workspaceId}:${actor.id}`,d.rateLimitKey),30,60_000);
   const input=await readJson(request,academyCrmCommandSchema);
   response=successResponse(await d.store.execute(actor,input),id);
  }else throw new AppError("INVALID_REQUEST");
 }catch(error){
  const safe=error instanceof AppError?error:error instanceof ContractError&&
   ["STALE_PROFILE_VERSION","OPERATION_REUSED_WITH_DIFFERENT_INPUT"].includes(error.code)?new AppError("CONFLICT"):
   error instanceof z.ZodError?new AppError("INVALID_REQUEST"):new AppError("UNAVAILABLE");
  response=failureResponse(safe,id);
 }
 response.headers.set("Referrer-Policy","no-referrer");response.headers.set("X-Content-Type-Options","nosniff");
 response.headers.set("Content-Security-Policy","default-src 'none'; frame-ancestors 'none'");return response;
}
