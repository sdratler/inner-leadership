import "server-only";
import {randomUUID} from "node:crypto";
import {z} from "zod";
import {AppError} from "../../../lib/errors.ts";
import {successResponse,failureResponse} from "../../../lib/http/json.ts";
import {SESSION_COOKIE} from "../../../lib/security/session.ts";
import {TOKEN_PATTERN} from "../../identity/crypto.ts";
import type {Actor} from "../../identity/types.ts";
import {canonicalForwardedRequest} from "../../integration/canonical-forwarded-request.ts";
import {writeDestination,type CutoverState} from "../core/cutover.ts";
import type {Page} from "../core/types.ts";
import type {NativeContactQuery,NativeContactRow} from "./native-directory.ts";
export type PeopleResponse={source:"sheet";authorityEpoch:number}|{source:"native";authorityEpoch:number;page:Page<NativeContactRow>};
export type PeopleHttpDependencies={origin:string;now:()=>Date;actor:(token:string)=>Promise<Actor>;
 authority:{read:(actor:Actor)=>Promise<CutoverState>};
 directory:{list:(actor:Actor,query:NativeContactQuery,epoch:number)=>Promise<Page<NativeContactRow>>}};
const querySchema=z.object({view:z.enum(["all","prospects","paid","active","archived"]).default("all"),
 search:z.string().max(200).default(""),stage:z.string().min(1).max(120).optional(),
 language:z.enum(["he","en"]).optional(),due:z.enum(["any","today","overdue"]).default("any"),
 mode:z.enum(["live","demo"]).default("live"),personId:z.string().uuid().optional(),
 page:z.string().regex(/^[1-9]\d{0,4}$/).default("1")}).strict();
/** Ordinary practitioner read. No browser flag can choose native authority,
 * reveal a shadow, activate cutover, or turn a failed native read into Sheet data.
 * Existing Sheet UI remains the sole view before cutover; frozen is a conflict.
 */
export async function peopleHttp(request:Request,load:()=>Promise<PeopleHttpDependencies>):Promise<Response>{
 const id=randomUUID();let response:Response;
 try{
  const cookies=(request.headers.get("cookie")??"").split(";").map(v=>v.trim()).filter(v=>v.startsWith(SESSION_COOKIE+"="));
  if(cookies.length!==1)throw new AppError("UNAUTHENTICATED");
  const token=cookies[0]!.slice(SESSION_COOKIE.length+1);if(!TOKEN_PATTERN.test(token))throw new AppError("UNAUTHENTICATED");
  const d=await load(),canonical=canonicalForwardedRequest(request,d.origin),url=new URL(canonical.url);
  if(request.method!=="GET"||url.origin!==d.origin||url.pathname!=="/api/private/people")throw new AppError("INVALID_REQUEST");
  const actor=await d.actor(token);if(actor.role!=="practitioner")throw new AppError("FORBIDDEN");
  const keys=[...url.searchParams.keys()];if(new Set(keys).size!==keys.length)throw new AppError("INVALID_REQUEST");
  const input=querySchema.safeParse(Object.fromEntries(url.searchParams));if(!input.success)throw new AppError("INVALID_REQUEST");
  const current=await d.authority.read(actor),destination=writeDestination(current.phase);
  if(destination==="durable_queue_only")throw new AppError("CONFLICT");
  let result:PeopleResponse;
  if(destination==="sheet")result={source:"sheet",authorityEpoch:current.epoch};
  else{
   const today=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Jerusalem"}).format(d.now()),q=input.data;
   const page=await d.directory.list(actor,{view:q.view,search:q.search,...(q.stage?{stage:q.stage}:{}),
    ...(q.language?{locale:q.language}:{}),...(q.personId?{personId:q.personId}:{}),due:q.due,mode:q.mode,today,page:Number(q.page),pageSize:12},current.epoch);
   result={source:"native",authorityEpoch:current.epoch,page};
  }
  response=successResponse(result,id);
 }catch(error){response=failureResponse(error instanceof AppError?error:new AppError("UNAVAILABLE"),id);}
 response.headers.set("Referrer-Policy","no-referrer");response.headers.set("X-Content-Type-Options","nosniff");
 response.headers.set("Content-Security-Policy","default-src 'none'; frame-ancestors 'none'");return response;
}
