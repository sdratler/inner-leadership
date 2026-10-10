import "server-only";
import {randomUUID} from "node:crypto";
import {AppError} from "../../../lib/errors.ts";
import {successResponse,failureResponse} from "../../../lib/http/json.ts";
import {SESSION_COOKIE} from "../../../lib/security/session.ts";
import {TOKEN_PATTERN} from "../../identity/crypto.ts";
import type {Actor} from "../../identity/types.ts";
import {canonicalForwardedRequest} from "../../integration/canonical-forwarded-request.ts";
import {writeDestination,type CutoverState} from "../core/cutover.ts";
import {normalizeWhatsAppRosterJson,projectProviderOnlyWhatsAppRoster,projectWhatsAppRoster,type NativePhoneMatch,type WhatsAppRoster} from "../core/whatsapp-roster.ts";

export const WHATSAPP_ROSTER_GROUP_ID="120363191551602241@g.us";
export type WhatsAppRosterHttpDependencies={origin:string;now:()=>Date;actor:(token:string)=>Promise<Actor>;
 binding:{channelId:string;groupId:string};
 authority:{read:(actor:Actor)=>Promise<CutoverState>};bridge:()=>Promise<string>;
 directory:{acquisitionMatches:(actor:Actor,phones:readonly string[],epoch:number)=>Promise<Map<string,NativePhoneMatch>>}};

/** Ordinary practitioner-only read. Provider I/O finishes before a fresh
 * authority/actor transaction. Stable Sheet authority permits only a
 * provider-only projection; native matching remains inside its native gate. */
export async function whatsappRosterHttp(request:Request,load:()=>Promise<WhatsAppRosterHttpDependencies>):Promise<Response>{
 const id=randomUUID();let response:Response;
 try{
  const cookies=(request.headers.get("cookie")??"").split(";").map(value=>value.trim()).filter(value=>value.startsWith(SESSION_COOKIE+"="));
  if(cookies.length!==1)throw new AppError("UNAUTHENTICATED");const token=cookies[0]!.slice(SESSION_COOKIE.length+1);if(!TOKEN_PATTERN.test(token))throw new AppError("UNAUTHENTICATED");
  const dependencies=await load(),canonical=canonicalForwardedRequest(request,dependencies.origin),url=new URL(canonical.url);
  if(request.method!=="GET"||url.origin!==dependencies.origin||url.pathname!=="/api/private/whatsapp-group-roster"||url.search)throw new AppError("INVALID_REQUEST");
  const actor=await dependencies.actor(token);if(actor.role!=="practitioner")throw new AppError("FORBIDDEN");
  const current=await dependencies.authority.read(actor),destination=writeDestination(current.phase);if(destination==="durable_queue_only")throw new AppError("CONFLICT");
  let raw:string;try{raw=await dependencies.bridge()}catch{throw new AppError("UNAVAILABLE")}
  let roster;try{roster=normalizeWhatsAppRosterJson(raw,dependencies.binding,dependencies.now().toISOString())}catch{throw new AppError("UNAVAILABLE")}
  let result:WhatsAppRoster;
  if(destination==="native"){
   const phones=[...new Set(roster.members.map(member=>member.phone).filter((phone):phone is string=>Boolean(phone)))];
   let matches:Map<string,NativePhoneMatch>;try{matches=await dependencies.directory.acquisitionMatches(actor,phones,current.epoch)}catch(error){throw error instanceof AppError?error:new AppError("UNAVAILABLE")}
   try{result=projectWhatsAppRoster(roster,matches)}catch{throw new AppError("UNAVAILABLE")}
  }else{
   // Revalidate the ordinary session, practitioner role, workspace and exact
   // stable authority after provider I/O before returning any member values.
   const confirmed=await dependencies.authority.read(actor);
   if(confirmed.epoch!==current.epoch||confirmed.phase!==current.phase||writeDestination(confirmed.phase)!=="sheet")throw new AppError("CONFLICT");
   result=projectProviderOnlyWhatsAppRoster(roster);
  }
  response=successResponse(result,id);
 }catch(error){response=failureResponse(error instanceof AppError?error:new AppError("UNAVAILABLE"),id)}
 response.headers.set("Referrer-Policy","no-referrer");response.headers.set("X-Content-Type-Options","nosniff");response.headers.set("Content-Security-Policy","default-src 'none'; frame-ancestors 'none'");return response;
}
