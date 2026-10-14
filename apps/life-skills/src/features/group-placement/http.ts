import "server-only";
import {randomUUID} from "node:crypto";
import {AppError} from "../../lib/errors.ts";
import {readJson,successResponse,failureResponse} from "../../lib/http/json.ts";
import {SESSION_COOKIE} from "../../lib/security/session.ts";
import {verifyCsrfToken,verifyMutationOrigin} from "../../lib/security/csrf.ts";
import {TOKEN_PATTERN} from "../identity/crypto.ts";
import type {Actor} from "../identity/types.ts";
import {canonicalForwardedRequest} from "../integration/canonical-forwarded-request.ts";
import {fishingPracticeHistoryQuerySchema,groupPlacementCommandSchema} from "./contract.ts";
import type {GroupPlacementStore} from "./store.ts";

export type GroupPlacementHttpDependencies={enabled:boolean;origin:string;actor:(token:string)=>Promise<Actor>;csrf:(token:string)=>string;
 store:Pick<GroupPlacementStore,"createDraftGroup"|"proposePlacement"|"movePlacement"|"proposeMeeting"|"reviseMeeting"|"recordFishingPractice"|"listFishingPracticeHistory"|"list">};
export async function groupPlacementHttp(request:Request,load:()=>Promise<GroupPlacementHttpDependencies>){
 const id=randomUUID();let response:Response;
 try{
  const d=await load();if(!d.enabled)throw new AppError("NOT_FOUND");
  const canonical=canonicalForwardedRequest(request,d.origin),url=new URL(canonical.url);
  if(url.origin!==d.origin||url.pathname!=="/api/private/group-placement"||!["GET","POST"].includes(request.method))throw new AppError("INVALID_REQUEST");
  const cookies=(request.headers.get("cookie")??"").split(";").map(value=>value.trim()).filter(value=>value.startsWith(SESSION_COOKIE+"="));
  if(cookies.length!==1)throw new AppError("UNAUTHENTICATED");const token=cookies[0]!.slice(SESSION_COOKIE.length+1);
  if(!TOKEN_PATTERN.test(token))throw new AppError("UNAUTHENTICATED");const actor=await d.actor(token);if(actor.role!=="practitioner")throw new AppError("FORBIDDEN");
  if(request.method==="GET"){const entries=[...url.searchParams.entries()];
   if(entries.length===0)response=successResponse(await d.store.list(actor),id);
   else{if(entries.length<2||entries.length>3||new Set(entries.map(([key])=>key)).size!==entries.length||entries.some(([key])=>!["placementId","moduleKey","cursor"].includes(key)))throw new AppError("INVALID_REQUEST");
    const query=fishingPracticeHistoryQuerySchema.safeParse({placementId:url.searchParams.get("placementId"),moduleKey:url.searchParams.get("moduleKey"),cursor:url.searchParams.get("cursor")});
    if(!query.success)throw new AppError("INVALID_REQUEST");response=successResponse(await d.store.listFishingPracticeHistory(actor,query.data),id);}}
  else{verifyMutationOrigin(canonical,d.origin);verifyCsrfToken(request.headers.get("x-csrf-token"),d.csrf(token));
   if(url.search)throw new AppError("INVALID_REQUEST");
   const command=await readJson(request,groupPlacementCommandSchema);
   response=successResponse(command.action==="create_draft_group"?await d.store.createDraftGroup(actor,command):
    command.action==="propose_group_placement"?await d.store.proposePlacement(actor,command):
    command.action==="move_group_placement"?await d.store.movePlacement(actor,command):
    command.action==="propose_draft_group_meeting"?await d.store.proposeMeeting(actor,command):
    command.action==="revise_draft_group_meeting"?await d.store.reviseMeeting(actor,command):await d.store.recordFishingPractice(actor,command),id);}
 }catch(error){response=failureResponse(error instanceof AppError?error:new AppError("UNAVAILABLE"),id);}
 response.headers.set("Referrer-Policy","no-referrer");response.headers.set("X-Content-Type-Options","nosniff");return response;
}
