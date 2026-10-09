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
import {audienceCommandSchema} from "../core/audience-interest.ts";
import type {AudienceInterestStore} from "./audience-interest-store.ts";

const endpoint="/api/private/audience-interest",epoch=z.string().regex(/^(0|[1-9]\d{0,15})$/),page=z.string().regex(/^[1-9]\d{0,4}$/);
const query=z.object({expectedEpoch:epoch,search:z.string().max(200).default(""),state:z.enum(["all","expressed","withdrawn"]).default("all"),page:page.default("1"),personId:z.string().uuid().optional()}).strict();
export type AudienceInterestHttpDependencies={origin:string;actor:(token:string)=>Promise<Actor>;csrf:(token:string)=>string;store:Pick<AudienceInterestStore,"list"|"record">};

export async function audienceInterestHttp(request:Request,load:()=>Promise<AudienceInterestHttpDependencies>):Promise<Response>{
 const id=randomUUID();let response:Response;
 try{
  const cookies=(request.headers.get("cookie")??"").split(";").map(value=>value.trim()).filter(value=>value.startsWith(SESSION_COOKIE+"="));
  if(cookies.length!==1)throw new AppError("UNAUTHENTICATED");const token=cookies[0]!.slice(SESSION_COOKIE.length+1);if(!TOKEN_PATTERN.test(token))throw new AppError("UNAUTHENTICATED");
  const d=await load(),canonical=canonicalForwardedRequest(request,d.origin),url=new URL(canonical.url);
  if(url.origin!==d.origin||url.pathname!==endpoint||!["GET","POST"].includes(request.method))throw new AppError("INVALID_REQUEST");
  const actor=await d.actor(token);if(actor.role!=="practitioner")throw new AppError("FORBIDDEN");
  if(request.method==="GET"){
   const keys=[...url.searchParams.keys()];if(new Set(keys).size!==keys.length)throw new AppError("INVALID_REQUEST");
   const parsed=query.safeParse(Object.fromEntries(url.searchParams));if(!parsed.success)throw new AppError("INVALID_REQUEST");
   response=successResponse(await d.store.list(actor,{expectedEpoch:Number(parsed.data.expectedEpoch),search:parsed.data.search,state:parsed.data.state,page:Number(parsed.data.page),pageSize:25,...(parsed.data.personId?{personId:parsed.data.personId}:{})}),id);
  }else{
   if(url.search)throw new AppError("INVALID_REQUEST");verifyMutationOrigin(canonical,d.origin);verifyCsrfToken(request.headers.get("x-csrf-token"),d.csrf(token));
   response=successResponse(await d.store.record(actor,await readJson(request,audienceCommandSchema)),id);
  }
 }catch(error){response=failureResponse(error instanceof AppError?error:new AppError("UNAVAILABLE"),id);}
 response.headers.set("Referrer-Policy","no-referrer");response.headers.set("X-Content-Type-Options","nosniff");response.headers.set("Content-Security-Policy","default-src 'none'; frame-ancestors 'none'");return response;
}
