import "server-only";
import {randomUUID} from "node:crypto";
import {AppError} from "../../../lib/errors.ts";
import {readJson,successResponse,failureResponse} from "../../../lib/http/json.ts";
import {SESSION_COOKIE} from "../../../lib/security/session.ts";
import {verifyCsrfToken,verifyMutationOrigin} from "../../../lib/security/csrf.ts";
import {TOKEN_PATTERN} from "../../identity/crypto.ts";
import type {Actor} from "../../identity/types.ts";
import {canonicalForwardedRequest} from "../../integration/canonical-forwarded-request.ts";
import {acquisitionDecisionSchema} from "../core/acquisition.ts";
import {writeDestination,type CutoverState} from "../core/cutover.ts";
import type {AcquisitionDecisionStore} from "./acquisition-decisions.ts";
export type AcquisitionHttpDependencies={origin:string;actor:(token:string)=>Promise<Actor>;csrf:(token:string)=>string;
 authority:{read:(actor:Actor)=>Promise<CutoverState>};store:Pick<AcquisitionDecisionStore,"list"|"decide">};
/** No browser native-authority, provider-label, payment or synthetic-mode flags.
 * All ordinary mutations carry CSRF and revalidate authority in the store.
 */
export async function acquisitionHttp(request:Request,load:()=>Promise<AcquisitionHttpDependencies>):Promise<Response>{
 const id=randomUUID();let response:Response;
 try{
  const cookies=(request.headers.get("cookie")??"").split(";").map(v=>v.trim()).filter(v=>v.startsWith(SESSION_COOKIE+"="));
  if(cookies.length!==1)throw new AppError("UNAUTHENTICATED");
  const token=cookies[0]!.slice(SESSION_COOKIE.length+1);if(!TOKEN_PATTERN.test(token))throw new AppError("UNAUTHENTICATED");
  const d=await load(),canonical=canonicalForwardedRequest(request,d.origin),url=new URL(canonical.url);
  if(url.origin!==d.origin||url.pathname!=="/api/private/contact-acquisition"||!["GET","POST"].includes(request.method))throw new AppError("INVALID_REQUEST");
  const actor=await d.actor(token);if(actor.role!=="practitioner")throw new AppError("FORBIDDEN");
  if(request.method==="GET"){
   const keys=[...url.searchParams.keys()];if(new Set(keys).size!==keys.length||keys.some(k=>!["page","search"].includes(k)))throw new AppError("INVALID_REQUEST");
   const page=url.searchParams.get("page")??"1",search=url.searchParams.get("search")??"";
   if(!/^[1-9]\d{0,4}$/.test(page)||search.length>200)throw new AppError("INVALID_REQUEST");
   const authority=await d.authority.read(actor);
   response=successResponse(writeDestination(authority.phase)==="sheet"?{source:"sheet",authorityEpoch:authority.epoch}:
    writeDestination(authority.phase)==="native"?{source:"native",...await d.store.list(actor,authority.epoch,{page:Number(page),search})}:
     (()=>{throw new AppError("CONFLICT");})(),id);
  }else{
   if(url.search)throw new AppError("INVALID_REQUEST");verifyMutationOrigin(canonical,d.origin);
   verifyCsrfToken(request.headers.get("x-csrf-token"),d.csrf(token));
   response=successResponse(await d.store.decide(actor,await readJson(request,acquisitionDecisionSchema)),id);
  }
 }catch(error){response=failureResponse(error instanceof AppError?error:new AppError("UNAVAILABLE"),id);}
 response.headers.set("Referrer-Policy","no-referrer");response.headers.set("X-Content-Type-Options","nosniff");
 response.headers.set("Content-Security-Policy","default-src 'none'; frame-ancestors 'none'");return response;
}
