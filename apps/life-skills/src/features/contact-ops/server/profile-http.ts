import "server-only";
import {randomUUID} from "node:crypto";
import {z} from "zod";
import {AppError} from "../../../lib/errors.ts";
import {readJson,successResponse,failureResponse} from "../../../lib/http/json.ts";
import {SESSION_COOKIE} from "../../../lib/security/session.ts";
import {verifyCsrfToken,verifyMutationOrigin} from "../../../lib/security/csrf.ts";
import {TOKEN_PATTERN} from "../../identity/crypto.ts";
import type {Actor} from "../../identity/types.ts";
import {canonicalForwardedRequest} from "../../integration/canonical-forwarded-request.ts";
import {ContractError,dateOnly} from "../core/validation.ts";
import type {OperationalNativeCrmStore} from "./operational-store.ts";

const endpoint="/api/private/contact-profiles";
const epoch=z.number().int().min(0).max(Number.MAX_SAFE_INTEGER-1);
const fields=z.object({stage:z.string().trim().min(1).max(120),nextAction:z.string().max(500).nullable(),
 followUpDate:z.string().refine(dateOnly).nullable(),notes:z.string().max(5000)}).strict();
const update=z.object({action:z.literal("update"),personId:z.string().uuid(),expectedEpoch:epoch,
 expectedVersion:z.number().int().min(1).max(Number.MAX_SAFE_INTEGER-1),operationId:z.string().uuid(),fields}).strict();
export type NativeProfileHttpDependencies={origin:string;actor:(token:string)=>Promise<Actor>;csrf:(token:string)=>string;
 store:Pick<OperationalNativeCrmStore,"read"|"updateFields">};

/** Ordinary session API for administrative profile edits, not a cutover API.
 * Both native methods verify the fresh actor and durable epoch inside their DB
 * transaction. Legacy/frozen/missing authority is a conflict, NEVER Sheet fallback.
 * No new identity, account, case, endpoint, payment fact or provider send is created.
 */
export async function nativeProfileHttp(request:Request,load:()=>Promise<NativeProfileHttpDependencies>):Promise<Response>{
 const id=randomUUID();let response:Response;
 try{
  const cookies=(request.headers.get("cookie")??"").split(";").map(v=>v.trim()).filter(v=>v.startsWith(SESSION_COOKIE+"="));
  if(cookies.length!==1)throw new AppError("UNAUTHENTICATED");
  const token=cookies[0]!.slice(SESSION_COOKIE.length+1);if(!TOKEN_PATTERN.test(token))throw new AppError("UNAUTHENTICATED");
  const d=await load(),canonical=canonicalForwardedRequest(request,d.origin),url=new URL(canonical.url);
  if(url.origin!==d.origin||url.pathname!==endpoint||!["GET","POST"].includes(request.method))throw new AppError("INVALID_REQUEST");
  const actor=await d.actor(token);if(actor.role!=="practitioner")throw new AppError("FORBIDDEN");
  if(request.method==="GET"){
   const keys=[...url.searchParams.keys()];
   if(keys.length!==2||new Set(keys).size!==2||keys.some(key=>!["personId","expectedEpoch"].includes(key)))throw new AppError("INVALID_REQUEST");
   const person=z.string().uuid().safeParse(url.searchParams.get("personId")),rawEpoch=url.searchParams.get("expectedEpoch")??"";
   const parsedEpoch=epoch.safeParse(/^(0|[1-9]\d{0,15})$/.test(rawEpoch)?Number(rawEpoch):NaN);
   if(!person.success||!parsedEpoch.success)throw new AppError("INVALID_REQUEST");
   const current=await d.store.read(actor,person.data,parsedEpoch.data);
   if(!current)throw new AppError("NOT_FOUND");
   const p=current.profile;
   // Stable identity links remain server-owned; this is not clinical data.
   response=successResponse({personId:p.personId,stage:p.stage,nextAction:p.nextAction,followUpDate:p.followUpDate,
    notes:p.notes,version:current.version,authorityEpoch:parsedEpoch.data},id);
  }else{
   if(url.search)throw new AppError("INVALID_REQUEST");
   verifyMutationOrigin(canonical,d.origin);verifyCsrfToken(request.headers.get("x-csrf-token"),d.csrf(token));
   const input=await readJson(request,update);
   const result=await d.store.updateFields(actor,input.personId,input.fields,input.expectedVersion,input.operationId,input.expectedEpoch);
   response=successResponse({...result,authorityEpoch:input.expectedEpoch,personId:input.personId},id);
  }
 }catch(error){
  const safe=error instanceof AppError?error:error instanceof ContractError&&
   ["STALE_PROFILE_VERSION","OPERATION_REUSED_WITH_DIFFERENT_INPUT"].includes(error.code)?new AppError("CONFLICT"):new AppError("UNAVAILABLE");
  response=failureResponse(safe,id);
 }
 response.headers.set("Referrer-Policy","no-referrer");response.headers.set("X-Content-Type-Options","nosniff");
 response.headers.set("Content-Security-Policy","default-src 'none'; frame-ancestors 'none'");return response;
}
