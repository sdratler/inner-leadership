import "server-only";
import {randomUUID} from "node:crypto";
import {AppError} from "../../lib/errors.ts";
import {failureResponse,successResponse} from "../../lib/http/json.ts";
import {SESSION_COOKIE} from "../../lib/security/session.ts";
import {TOKEN_PATTERN} from "../identity/crypto.ts";
import type {Actor} from "../identity/types.ts";
import {canonicalForwardedRequest} from "../integration/canonical-forwarded-request.ts";
import type {PublicGroupApplicationStore} from "./store.ts";
import {reviewCursorSchema} from "./store.ts";
import {isFloridaGroupApplication,isTrip390Interest,type GroupApplicationRecord} from "./contract.ts";
import {trip390InterestSchema} from "./academy-trip390-contract.ts";
import type {InquiryEmailSetupReport} from "./inquiry-email-setup.ts";

export type GroupApplicationReviewDependencies={origin:string;actor:(token:string)=>Promise<Actor>;store:Pick<PublicGroupApplicationStore,"list">&Partial<Pick<PublicGroupApplicationStore,"listPage"|"readForOwner">>;emailSetup?:()=>InquiryEmailSetupReport};

function academyRecord(item:GroupApplicationRecord):boolean {
 const fields=item.fields;
 return isTrip390Interest(fields)?trip390InterestSchema.safeParse(fields).success:isFloridaGroupApplication(fields)&&fields.programId==="sunday_fishing_academy";
}

/** Practitioner-only, read-only review. It does not promote, contact or enroll an applicant. */
export async function groupApplicationReviewHttp(request:Request,load:()=>Promise<GroupApplicationReviewDependencies>):Promise<Response>{
 const requestId=randomUUID();let response:Response;
 try{
  const d=await load(),canonical=canonicalForwardedRequest(request,d.origin),url=new URL(canonical.url);
  if(request.method!=="GET"||url.origin!==d.origin||url.pathname!=="/api/private/group-applications"||[...url.searchParams.keys()].some(key=>!["search","cursor","reference"].includes(key)||url.searchParams.getAll(key).length!==1))throw new AppError("INVALID_REQUEST");
  const search=url.searchParams.get("search")??"",cursor=url.searchParams.get("cursor");
  const reference=url.searchParams.get("reference");
  if(reference!==null&&(url.searchParams.size!==1||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(reference)))throw new AppError("INVALID_REQUEST");
  if(search.length>200||cursor!==null&&!reviewCursorSchema.safeParse(cursor).success)throw new AppError("INVALID_REQUEST");
  const cookies=(request.headers.get("cookie")??"").split(";").map(value=>value.trim()).filter(value=>value.startsWith(SESSION_COOKIE+"="));
  if(cookies.length!==1)throw new AppError("UNAUTHENTICATED");
  const token=cookies[0]!.slice(SESSION_COOKIE.length+1);if(!TOKEN_PATTERN.test(token))throw new AppError("UNAUTHENTICATED");
  const actor=await d.actor(token);if(actor.role!=="practitioner")throw new AppError("FORBIDDEN");
  // list rechecks the current actor and the configured inquiry workspace. Do
  // not inspect server email settings until that authorization has succeeded.
  if(reference!==null){
   if(!d.store.readForOwner)throw new AppError("UNAVAILABLE");
   const item=await d.store.readForOwner(actor,reference.toLowerCase());
   if(item.id!==reference.toLowerCase()||!academyRecord(item))throw new AppError("UNAVAILABLE");
   const emailSetup=isTrip390Interest(item.fields)?null:d.emailSetup?.()??null;
   response=successResponse({items:[item],nextCursor:null,emailSetup},requestId);
  }else{
   if(url.search&&!d.store.listPage)throw new AppError("UNAVAILABLE");
   const page=d.store.listPage?await d.store.listPage(actor,{search,...(cursor?{cursor}:{})}):{items:await d.store.list(actor)};
  // Refuse a misconfigured broad store before any record reaches the browser.
   if(!page.items.every(academyRecord))throw new AppError("UNAVAILABLE");
   const emailSetup=d.emailSetup?.()??null;
   response=successResponse({...page,emailSetup},requestId);
  }
 }catch(error){response=failureResponse(error instanceof AppError?error:new AppError("UNAVAILABLE"),requestId);}
 response.headers.set("Referrer-Policy","no-referrer");response.headers.set("X-Content-Type-Options","nosniff");response.headers.set("Content-Security-Policy","default-src 'none'; frame-ancestors 'none'");
 return response;
}
