import {randomUUID} from "node:crypto";
import {z} from "zod";
import {NextResponse} from "next/server";
import {AppError,errorEnvelope} from "@/lib/errors.ts";
import {readJson} from "@/lib/http/json.ts";
import {verifyCsrfToken,verifyMutationOrigin} from "@/lib/security/csrf.ts";
import {SESSION_COOKIE} from "@/lib/security/session.ts";
import {identityRuntime} from "@/features/identity/runtime.ts";
import type {Actor} from "@/features/identity/types.ts";
import {createProspect,sendProspectMessage,updateProspect} from "@/features/prospects/bridge.ts";
import {readAuthoritativeProspects} from "@/features/contact-ops/server/authoritative-prospects.ts";
import {prospectUpdateSchema,updateAuthoritativeProspect} from "@/features/contact-ops/server/authoritative-prospect-update.ts";
import {readProspectJourneys} from "@/features/prospects/journey-read.ts";
import {paidAwaitingBooking} from "@/features/prospects/view-state.ts";
import {PreEnrollmentStaffService} from "@/features/forms/pre-enrollment/staff.ts";
import {respondentLink} from "@/features/forms/pre-enrollment/staff-link.ts";
import {demoRecordBatch} from "@/features/demo/provenance.ts";
import {prospectContactSuppressed} from "@/features/prospects/native-edit.ts";
const lead=z.string().regex(/^LS-(?:LEAD|WAPI)-[A-Za-z0-9_-]+$/);
const body=z.discriminatedUnion("action",[
 z.object({action:z.literal("add"),name:z.string().trim().max(120),phone:z.string().trim().min(8).max(64),language:z.enum(["","he","en"]),source:z.string().trim().max(120),notes:z.string().trim().max(5000),nextAction:z.string().trim().max(500),dueDate:z.union([z.literal(""),z.string().date()])}).strict(),
 prospectUpdateSchema,
 z.object({action:z.literal("send_message"),leadId:lead,message:z.string().trim().min(1).max(2000),nextAction:z.string().max(500).optional(),dueDate:z.string().max(40).optional()}).strict(),
 z.object({action:z.literal("send_intake"),leadId:lead,firstName:z.string().trim().max(120),locale:z.enum(["he","en"]),childCount:z.number().int().min(1).max(8)}).strict(),
 z.object({action:z.literal("send_booking"),leadId:lead,firstName:z.string().trim().max(120),locale:z.enum(["he","en"]),bookingLink:z.string().url().startsWith("https://").max(1000)}).strict(),
]);
function fail(error:unknown){const e=errorEnvelope(error instanceof AppError?error:new AppError("UNAVAILABLE"),randomUUID());return NextResponse.json(e.body,{status:e.status,headers:{"Cache-Control":"private, no-store","Referrer-Policy":"no-referrer"}})}
async function session(request:Request){const values=(request.headers.get("cookie")||"").split(";").map(v=>v.trim()).filter(v=>v.startsWith(SESSION_COOKIE+"="));if(values.length!==1)throw new AppError("UNAUTHENTICATED");const runtime=await identityRuntime(),token=values[0]!.slice(SESSION_COOKIE.length+1),actor=await runtime.services.sessions.actor(token);if(actor.role!=="practitioner")throw new AppError("FORBIDDEN");return {runtime,token,actor};}
async function project(leadId:string,fields:Record<string,string>){try{await updateProspect(leadId,fields);return false;}catch{return true;}}
async function requireContactableProspect(runtime:Awaited<ReturnType<typeof identityRuntime>>,actor:Actor,leadId:string){
 const batch=await runtime.store.transaction(tx=>demoRecordBatch(tx,runtime.config.workspaceId,'prospect',leadId));if(batch)throw new AppError('FORBIDDEN');
 // A disabled button is not an opt-out boundary. Recheck the actual current
 // operational record before issuing a form or attempting any provider send.
 const row=(await readAuthoritativeProspects(actor,runtime)).find(row=>row.leadId===leadId);
 if(!row)throw new AppError('NOT_FOUND');if(prospectContactSuppressed(row))throw new AppError('FORBIDDEN');
}
export async function GET(request:Request){try{const s=await session(request),rows=await readAuthoritativeProspects(s.actor,s.runtime),states=await readProspectJourneys(s.runtime.store,s.runtime.config.workspaceId,rows.map(row=>row.leadId));return NextResponse.json({ok:true,data:rows.map(row=>({...row,...(states.get(row.leadId)??{journeyState:"prospect",paymentVerified:false,bookingConfirmed:false})})),requestId:randomUUID()},{headers:{"Cache-Control":"private, no-store","Referrer-Policy":"no-referrer"}})}catch(e){return fail(e)}}
export async function POST(request:Request){try{const s=await session(request);verifyMutationOrigin(request,s.runtime.config.origin);verifyCsrfToken(request.headers.get("x-csrf-token"),s.runtime.services.sessions.csrf(s.token));const input=await readJson(request,body);
 const sendContext={store:s.runtime.store,workspaceId:s.runtime.config.workspaceId};
 if(input.action==="add"){const created=await createProspect(input);return NextResponse.json({ok:true,data:created.result,requestId:randomUUID()},{status:created.result.action==="created"?201:200,headers:{"Cache-Control":"private, no-store"}})}
 if(input.action==="update"){const result=await updateAuthoritativeProspect(s.actor,input,s.runtime);return NextResponse.json({ok:true,data:result,requestId:randomUUID()},{headers:{"Cache-Control":"private, no-store"}})}
 if(input.action==="send_message"){await requireContactableProspect(s.runtime,s.actor,input.leadId);const sent=await sendProspectMessage(input.leadId,input.message,sendContext);const projectionPending=await project(input.leadId,{...(input.nextAction?{nextAction:input.nextAction}:{}),...(input.dueDate?{dueDate:input.dueDate}:{}),stage:"Contacted",updateProvenance:"private-app:practitioner-click"});return NextResponse.json({ok:true,data:{...sent.receipt,projectionPending},requestId:randomUUID()},{headers:{"Cache-Control":"private, no-store"}})}
 if(input.action==="send_intake"){await requireContactableProspect(s.runtime,s.actor,input.leadId);const issued=await new PreEnrollmentStaffService(s.runtime.store,s.runtime.config.keyring,()=>s.runtime.clock.now()).issue(s.actor,input.leadId,input.childCount);const href=respondentLink(s.runtime.config.origin,issued.token,input.locale);if(!href)throw new AppError("UNAVAILABLE");const hello=input.locale==="he"?(input.firstName?`שלום ${input.firstName},`:`שלום,`):(input.firstName?`Hi ${input.firstName},`:`Hi,`);const message=input.locale==="he"?`${hello} בהמשך לשיחה שלנו, זה הקישור לטופס ההיכרות: ${href}. לאחר מילוי הטופס אפשר להמשיך לתשלום עבור הפגישה הראשונה.`:`${hello} following our conversation, here is the intake form: ${href}. After submitting it, you can continue to payment for the first session.`;const sent=await sendProspectMessage(input.leadId,message,sendContext),sentAt=sent.receipt.sentAt??new Date().toISOString();const projectionPending=await project(input.leadId,{formSent:sentAt,stage:"Intake sent",nextAction:"Review submitted intake",dueDate:"",messageReceipt:sent.receipt.providerMessageId??`Whapi delivery confirmed at ${sentAt}`,updateProvenance:"private-app:intake-sent"});return NextResponse.json({ok:true,data:{sentAt,expiresAt:issued.expiresAt,projectionPending},requestId:randomUUID()},{headers:{"Cache-Control":"private, no-store"}})}
 await requireContactableProspect(s.runtime,s.actor,input.leadId);
 const journey=(await readProspectJourneys(s.runtime.store,s.runtime.config.workspaceId,[input.leadId])).get(input.leadId);if(!journey||!paidAwaitingBooking(journey))throw new AppError("CONFLICT");const message=input.locale==="he"?`התשלום התקבל. כאן אפשר לבחור מועד לפגישה: ${input.bookingLink}. הפגישה נקבעת לאחר קבלת אישור המועד.`:`Payment has been received. You can choose an appointment here: ${input.bookingLink}. The appointment is booked once the time is confirmed.`;const sent=await sendProspectMessage(input.leadId,message,sendContext),sentAt=sent.receipt.sentAt??new Date().toISOString();const projectionPending=await project(input.leadId,{bookingStatus:"Link sent; awaiting confirmed appointment",nextAction:"Confirm first appointment",messageReceipt:sent.receipt.providerMessageId??`Whapi delivery confirmed at ${sentAt}`,updateProvenance:"private-app:booking-link-sent"});return NextResponse.json({ok:true,data:{...sent.receipt,projectionPending},requestId:randomUUID()},{headers:{"Cache-Control":"private, no-store"}});
 }catch(e){return fail(e)}}
