import "server-only";
import {randomUUID} from "node:crypto";
import {AppError} from "../../lib/errors.ts";
import {failureResponse,successResponse} from "../../lib/http/json.ts";
import {SESSION_COOKIE} from "../../lib/security/session.ts";
import {TOKEN_PATTERN} from "../identity/crypto.ts";
import type {Actor} from "../identity/types.ts";
import {canonicalForwardedRequest} from "../integration/canonical-forwarded-request.ts";
import type {PublicGroupApplicationStore} from "./store.ts";
import type {InquiryEmailSetupReport} from "./inquiry-email-setup.ts";

export type GroupApplicationReviewDependencies={origin:string;actor:(token:string)=>Promise<Actor>;store:Pick<PublicGroupApplicationStore,"list">&Partial<Pick<PublicGroupApplicationStore,"listPage">>;emailSetup?:()=>InquiryEmailSetupReport};

/** Practitioner-only, read-only review. It does not promote, contact or enroll an applicant. */
export async function groupApplicationReviewHttp(request:Request,load:()=>Promise<GroupApplicationReviewDependencies>):Promise<Response>{
 const requestId=randomUUID();let response:Response;
 try{
  const d=await load(),canonical=canonicalForwardedRequest(request,d.origin),url=new URL(canonical.url);
  if(request.method!=="GET"||url.origin!==d.origin||url.pathname!=="/api/private/group-applications"||[...url.searchParams.keys()].some(key=>!["search","cursor"].includes(key)||url.searchParams.getAll(key).length!==1))throw new AppError("INVALID_REQUEST");
  const search=url.searchParams.get("search")??"",cursor=url.searchParams.get("cursor");
  if(search.length>200||cursor!==null&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(cursor))throw new AppError("INVALID_REQUEST");
  const cookies=(request.headers.get("cookie")??"").split(";").map(value=>value.trim()).filter(value=>value.startsWith(SESSION_COOKIE+"="));
  if(cookies.length!==1)throw new AppError("UNAUTHENTICATED");
  const token=cookies[0]!.slice(SESSION_COOKIE.length+1);if(!TOKEN_PATTERN.test(token))throw new AppError("UNAUTHENTICATED");
  const actor=await d.actor(token);if(actor.role!=="practitioner")throw new AppError("FORBIDDEN");
  // list rechecks the current actor and the configured inquiry workspace. Do
  // not inspect server email settings until that authorization has succeeded.
  if(url.search&&!d.store.listPage)throw new AppError("UNAVAILABLE");
  const page=d.store.listPage?await d.store.listPage(actor,{search,...(cursor?{cursor}:{})}):{items:await d.store.list(actor)},emailSetup=d.emailSetup?.()??null;
  response=successResponse({...page,emailSetup},requestId);
 }catch(error){response=failureResponse(error instanceof AppError?error:new AppError("UNAVAILABLE"),requestId);}
 response.headers.set("Referrer-Policy","no-referrer");response.headers.set("X-Content-Type-Options","nosniff");response.headers.set("Content-Security-Policy","default-src 'none'; frame-ancestors 'none'");
 return response;
}
