import {randomUUID} from "node:crypto";
import {z} from "zod";
import {NextResponse} from "next/server";
import {AppError,errorEnvelope} from "@/lib/errors.ts";
import {readJson} from "@/lib/http/json.ts";
import {verifyCsrfToken,verifyMutationOrigin} from "@/lib/security/csrf.ts";
import {SESSION_COOKIE} from "@/lib/security/session.ts";
import {identityRuntime} from "@/features/identity/runtime.ts";
import type {Actor} from "@/features/identity/types.ts";
import {assertProspectSenderAvailable,outboundLedgerAvailable,projectLegacyProspectAfterSend,reconcileLegacyProspectProjection,resolvePreparedProspectSend,sendAuthoritativeProspectMessage} from "@/features/contact-ops/server/authoritative-prospect-send.ts";
import {prospectCreateSchema} from "@/features/contact-ops/core/people-create.ts";
import {createAuthoritativeProspect} from "@/features/contact-ops/server/authoritative-prospect-create.ts";
import {readAuthoritativeProspects} from "@/features/contact-ops/server/authoritative-prospects.ts";
import {prospectUpdateSchema,updateAuthoritativeProspect} from "@/features/contact-ops/server/authoritative-prospect-update.ts";
import {readProspectJourneys} from "@/features/prospects/journey-read.ts";
import {paidAwaitingBooking} from "@/features/prospects/view-state.ts";
import {PreEnrollmentStaffService} from "@/features/forms/pre-enrollment/staff.ts";
import {respondentLink} from "@/features/forms/pre-enrollment/staff-link.ts";
import {demoRecordBatch} from "@/features/demo/provenance.ts";
import {prospectContactSuppressed} from "@/features/prospects/native-edit.ts";
import {OutboundProjectionStore,type OutboundReceipt} from "@/features/contact-ops/server/outbound-projection-store.ts";
const lead=z.string().regex(/^LS-(?:LEAD|WAPI)-[A-Za-z0-9_-]+$/);
const body=z.discriminatedUnion("action",[
 prospectCreateSchema,
 prospectUpdateSchema,
 z.object({action:z.literal("send_message"),leadId:lead,message:z.string().trim().min(1).max(2000),nextAction:z.string().max(500).optional(),dueDate:z.string().max(40).optional()}).strict(),
 z.object({action:z.literal("send_intake"),leadId:lead,firstName:z.string().trim().max(120),locale:z.enum(["he","en"]),childCount:z.number().int().min(1).max(8)}).strict(),
 z.object({action:z.literal("send_booking"),leadId:lead,firstName:z.string().trim().max(120),locale:z.enum(["he","en"]),bookingLink:z.string().url().startsWith("https://").max(1000)}).strict(),
 z.object({action:z.literal("reconcile_projection"),operationId:z.string().uuid()}).strict(),
 z.object({action:z.literal("resolve_prepared"),operationId:z.string().uuid(),outcome:z.enum(["delivered","not_delivered"]),
  source:z.enum(["provider_delivery_log","provider_support_case"]),reference:z.string().min(8).max(200),
  checkedAt:z.iso.datetime({offset:true}),verifiedExactMessage:z.literal(true),
  providerMessageId:z.string().min(8).max(200).optional(),sentAt:z.iso.datetime({offset:true}).optional()}).strict(),
]);
function fail(error:unknown){const e=errorEnvelope(error instanceof AppError?error:new AppError("UNAVAILABLE"),randomUUID());return NextResponse.json(e.body,{status:e.status,headers:{"Cache-Control":"private, no-store","Referrer-Policy":"no-referrer"}})}
async function session(request:Request){const values=(request.headers.get("cookie")||"").split(";").map(v=>v.trim()).filter(v=>v.startsWith(SESSION_COOKIE+"="));if(values.length!==1)throw new AppError("UNAUTHENTICATED");const runtime=await identityRuntime(),token=values[0]!.slice(SESSION_COOKIE.length+1),actor=await runtime.services.sessions.actor(token);if(actor.role!=="practitioner")throw new AppError("FORBIDDEN");return {runtime,token,actor};}
async function project(actor:Actor,runtime:Awaited<ReturnType<typeof identityRuntime>>,leadId:string,
 fields:Record<string,string>,epoch:number,operationId:string,receipt:OutboundReceipt){
 return projectLegacyProspectAfterSend(actor,runtime,leadId,fields,epoch,operationId,receipt);
}
async function requireContactableProspect(runtime:Awaited<ReturnType<typeof identityRuntime>>,actor:Actor,leadId:string){
 const batch=await runtime.store.transaction(tx=>demoRecordBatch(tx,runtime.config.workspaceId,'prospect',leadId));if(batch)throw new AppError('FORBIDDEN');
 // A disabled button is not an opt-out boundary. Recheck the actual current
 // operational record before issuing a form or attempting any provider send.
 const row=(await readAuthoritativeProspects(actor,runtime)).find(row=>row.leadId===leadId);
 if(!row)throw new AppError('NOT_FOUND');if(prospectContactSuppressed(row))throw new AppError('FORBIDDEN');
}
export async function GET(request:Request){try{
 const s=await session(request),rows=await readAuthoritativeProspects(s.actor,s.runtime);
 const states=await readProspectJourneys(s.runtime.store,s.runtime.config.workspaceId,rows.map(row=>row.leadId));
 const ledger=new OutboundProjectionStore(s.runtime.store,s.runtime.config.keyring,
  s.runtime.config.lookupKey.toString("hex"),s.runtime.clock),cursor=new URL(request.url).searchParams.getAll("pendingAfter");
 if(cursor.length>1)throw new AppError("INVALID_REQUEST");
 const ledgerReady=await outboundLedgerAvailable(s.runtime);
 const [pending,pendingPage]=ledgerReady?await Promise.all([ledger.pendingForLeads(s.actor,rows.map(row=>row.leadId)),
  ledger.pendingPage(s.actor,cursor[0]??null)]):[new Map(),{items:[],nextCursor:null}];
 return NextResponse.json({ok:true,data:rows.map(row=>({...row,...(states.get(row.leadId)??{
  journeyState:"prospect",paymentVerified:false,bookingConfirmed:false}),projectionPending:pending.has(row.leadId),
  projectionOperationId:pending.get(row.leadId)?.operationId,projectionState:pending.get(row.leadId)?.state,
  projectionMessage:pending.get(row.leadId)?.state==="prepared"?pending.get(row.leadId)?.message:undefined,
  projectionCreatedAt:pending.get(row.leadId)?.createdAt})),
  pendingOperations:pendingPage.items,pendingNext:pendingPage.nextCursor,ledgerReady,
  requestId:randomUUID()},{headers:{"Cache-Control":"private, no-store","Referrer-Policy":"no-referrer"}});
}catch(e){return fail(e)}}
export async function POST(request:Request){try{const s=await session(request);verifyMutationOrigin(request,s.runtime.config.origin);verifyCsrfToken(request.headers.get("x-csrf-token"),s.runtime.services.sessions.csrf(s.token));const input=await readJson(request,body);
 if(input.action==="add"){const result=await createAuthoritativeProspect(s.actor,input,s.runtime);return NextResponse.json({ok:true,data:result,requestId:randomUUID()},{status:result.action==="created"?201:200,headers:{"Cache-Control":"private, no-store","Referrer-Policy":"no-referrer"}})}
 if(input.action==="update"){const result=await updateAuthoritativeProspect(s.actor,input,s.runtime);return NextResponse.json({ok:true,data:result,requestId:randomUUID()},{headers:{"Cache-Control":"private, no-store"}})}
 if(input.action==="reconcile_projection"){
  const result=await reconcileLegacyProspectProjection(s.actor,s.runtime,input.operationId);
  return NextResponse.json({ok:true,data:result,requestId:randomUUID()},{headers:{"Cache-Control":"private, no-store"}});
 }
 if(input.action==="resolve_prepared"){
  const result=await resolvePreparedProspectSend(s.actor,s.runtime,input.operationId,input);
  return NextResponse.json({ok:true,data:result,requestId:randomUUID()},{headers:{"Cache-Control":"private, no-store"}});
 }
 if(input.action==="send_message"){
  await requireContactableProspect(s.runtime,s.actor,input.leadId);
  const fields={...(input.nextAction?{nextAction:input.nextAction}:{}),...(input.dueDate?{dueDate:input.dueDate}:{}),
   stage:"Contacted",updateProvenance:"private-app:practitioner-click"};
  const sent=await sendAuthoritativeProspectMessage(s.actor,s.runtime,input.leadId,input.message,fields);
  const projection=await project(s.actor,s.runtime,input.leadId,fields,sent.authorityEpoch,sent.operationId,sent.receipt);
  return NextResponse.json({ok:true,data:{...sent.receipt,...projection},requestId:randomUUID()},
   {headers:{"Cache-Control":"private, no-store"}});
 }
 if(input.action==="send_intake"){
  await requireContactableProspect(s.runtime,s.actor,input.leadId);
  const epoch=await assertProspectSenderAvailable(s.actor,s.runtime);
  const issued=await new PreEnrollmentStaffService(s.runtime.store,s.runtime.config.keyring,()=>s.runtime.clock.now())
   .issue(s.actor,input.leadId,input.childCount);
  const href=respondentLink(s.runtime.config.origin,issued.token,input.locale);if(!href)throw new AppError("UNAVAILABLE");
  const hello=input.locale==="he"?(input.firstName?`שלום ${input.firstName},`:`שלום,`):
   (input.firstName?`Hi ${input.firstName},`:`Hi,`);
  const message=input.locale==="he"?`${hello} בהמשך לשיחה שלנו, זה הקישור לטופס ההיכרות: ${href}. לאחר מילוי הטופס אפשר להמשיך לתשלום עבור הפגישה הראשונה.`:
   `${hello} following our conversation, here is the intake form: ${href}. After submitting it, you can continue to payment for the first session.`;
  const planned={stage:"Intake sent",nextAction:"Review submitted intake",dueDate:"",updateProvenance:"private-app:intake-sent"};
  const sent=await sendAuthoritativeProspectMessage(s.actor,s.runtime,input.leadId,message,planned,undefined,epoch);
  const sentAt=sent.receipt.sentAt??new Date().toISOString();
  const fields={...planned,formSent:sentAt,messageReceipt:sent.receipt.providerMessageId??`Whapi delivery confirmed at ${sentAt}`};
  const projection=await project(s.actor,s.runtime,input.leadId,fields,sent.authorityEpoch,sent.operationId,sent.receipt);
  return NextResponse.json({ok:true,data:{sentAt,expiresAt:issued.expiresAt,...projection},requestId:randomUUID()},
   {headers:{"Cache-Control":"private, no-store"}});
 }
 await requireContactableProspect(s.runtime,s.actor,input.leadId);
 const journey=(await readProspectJourneys(s.runtime.store,s.runtime.config.workspaceId,[input.leadId])).get(input.leadId);
 if(!journey||!paidAwaitingBooking(journey))throw new AppError("CONFLICT");
 const message=input.locale==="he"?`התשלום התקבל. כאן אפשר לבחור מועד לפגישה: ${input.bookingLink}. הפגישה נקבעת לאחר קבלת אישור המועד.`:
  `Payment has been received. You can choose an appointment here: ${input.bookingLink}. The appointment is booked once the time is confirmed.`;
 const planned={bookingStatus:"Link sent; awaiting confirmed appointment",nextAction:"Confirm first appointment",
  updateProvenance:"private-app:booking-link-sent"};
 const sent=await sendAuthoritativeProspectMessage(s.actor,s.runtime,input.leadId,message,planned),sentAt=sent.receipt.sentAt??new Date().toISOString();
 const fields={...planned,messageReceipt:sent.receipt.providerMessageId??`Whapi delivery confirmed at ${sentAt}`};
 const projection=await project(s.actor,s.runtime,input.leadId,fields,sent.authorityEpoch,sent.operationId,sent.receipt);
 return NextResponse.json({ok:true,data:{...sent.receipt,...projection},requestId:randomUUID()},
  {headers:{"Cache-Control":"private, no-store"}});
 }catch(e){return fail(e)}}
