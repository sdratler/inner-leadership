import "server-only";
import {randomUUID} from "node:crypto";
import {AppError} from "../../../lib/errors.ts";
import {successResponse,failureResponse} from "../../../lib/http/json.ts";
import {SESSION_COOKIE} from "../../../lib/security/session.ts";
import {TOKEN_PATTERN} from "../../identity/crypto.ts";
import type {Actor} from "../../identity/types.ts";
import type {ContactInboundStore} from "./inbound-store.ts";
import {canonicalForwardedRequest} from "../../integration/canonical-forwarded-request.ts";
export type InboundInboxEntry={id:string;fromNumber:string;pushName:string;messageType:string;messageText:string;occurredAt:string;storedAt:string;media:{fileName:string;mimeType:string;sizeBytes:number|null}[]};
type Dependencies={origin:string;captureEnabled:boolean;bindingConfigured:boolean;actor:(token:string)=>Promise<Actor>;store:ContactInboundStore};
/** Ordinary session and fresh native authorization; bounded captured receipts
 * only. No clinical joins, WhatsApp scans, phone-based identity or role flags.
 */
export async function readInboundInbox(request:Request,load:()=>Promise<Dependencies>):Promise<Response>{
 const id=randomUUID();let response:Response;
 try{
  const cookies=(request.headers.get("cookie")??"").split(";").map(v=>v.trim()).filter(v=>v.startsWith(SESSION_COOKIE+"="));
  if(cookies.length!==1)throw new AppError("UNAUTHENTICATED");
  const token=cookies[0]!.slice(SESSION_COOKIE.length+1);if(!TOKEN_PATTERN.test(token))throw new AppError("UNAUTHENTICATED");
  const d=await load();
  // Railway's internal Request URL is not the browser's custom-domain URL.
  // Reuse the accepted identity boundary; only the exact configured HTTPS
  // forwarding pair is trusted, and it grants no session or role permission.
  const canonicalRequest=canonicalForwardedRequest(request,d.origin),url=new URL(canonicalRequest.url);
  if(request.method!=="GET"||url.origin!==d.origin||url.search)throw new AppError("INVALID_REQUEST");
  const actor=await d.actor(token);if(actor.role!=="practitioner")throw new AppError("FORBIDDEN");
  const rows=await d.store.recent(actor,50);
  const items:InboundInboxEntry[]=rows.map(({receiptKey,inquiry,storedAt})=>({id:receiptKey,fromNumber:inquiry.fromNumber,pushName:inquiry.pushName,messageType:inquiry.messageType,messageText:inquiry.messageText,occurredAt:inquiry.occurredAt,storedAt,media:inquiry.media.map(({fileName,mimeType,sizeBytes})=>({fileName,mimeType,sizeBytes}))}));
  response=successResponse({items,limit:50,captureEnabled:d.captureEnabled,bindingConfigured:d.bindingConfigured},id);
 }catch(error){response=failureResponse(error instanceof AppError?error:new AppError("UNAVAILABLE"),id);}
 response.headers.set("Referrer-Policy","no-referrer");response.headers.set("X-Content-Type-Options","nosniff");
 response.headers.set("Content-Security-Policy","default-src 'none'; frame-ancestors 'none'");return response;
}
