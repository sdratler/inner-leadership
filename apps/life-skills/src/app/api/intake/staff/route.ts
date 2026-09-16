import { randomUUID } from "node:crypto";
import { z } from "zod";
import { NextResponse } from "next/server";
import { AppError, errorEnvelope } from "@/lib/errors.ts";
import { readJson } from "@/lib/http/json.ts";
import { verifyCsrfToken, verifyMutationOrigin } from "@/lib/security/csrf.ts";
import { SESSION_COOKIE } from "@/lib/security/session.ts";
import { identityRuntime } from "@/features/identity/runtime.ts";
import { PreEnrollmentStaffService } from "@/features/forms/pre-enrollment/staff.ts";
function token(request:Request){const values=(request.headers.get("cookie")??"").split(";").map(x=>x.trim()).filter(x=>x.startsWith(SESSION_COOKIE+"="));if(values.length!==1)throw new AppError("UNAUTHENTICATED");return values[0]!.slice(SESSION_COOKIE.length+1);}
function fail(error:unknown){const x=errorEnvelope(error,randomUUID());return NextResponse.json(x.body,{status:x.status,headers:{"Cache-Control":"private, no-store","Referrer-Policy":"no-referrer"}})}
async function actor(request:Request){const runtime=await identityRuntime(),session=token(request),actor=await runtime.services.sessions.actor(session);return {runtime,session,actor,service:new PreEnrollmentStaffService(runtime.store,runtime.config.keyring,()=>runtime.clock.now())};}
export async function GET(request:Request){try{const receiptId=new URL(request.url).searchParams.get("receiptId");if(!receiptId||!z.string().uuid().safeParse(receiptId).success)throw new AppError("INVALID_REQUEST");const x=await actor(request);return NextResponse.json({ok:true,data:await x.service.history(x.actor,receiptId),requestId:randomUUID()},{headers:{"Cache-Control":"private, no-store","Referrer-Policy":"no-referrer"}});}catch(e){return fail(e)}}
export async function PATCH(request:Request){try{const x=await actor(request);verifyMutationOrigin(request,x.runtime.config.origin);verifyCsrfToken(request.headers.get("x-csrf-token"),x.runtime.services.sessions.csrf(x.session));const body=await readJson(request,z.object({receiptId:z.string().uuid(),payload:z.unknown()}).strict());await x.service.amend(x.actor,body.receiptId,body.payload);return NextResponse.json({ok:true,data:{accepted:true},requestId:randomUUID()},{headers:{"Cache-Control":"private, no-store"}});}catch(e){return fail(e)}}
export async function POST(request:Request){try{const x=await actor(request);verifyMutationOrigin(request,x.runtime.config.origin);verifyCsrfToken(request.headers.get("x-csrf-token"),x.runtime.services.sessions.csrf(x.session));const body=await readJson(request,z.object({stableLeadRef:z.string().regex(/^LS-(?:LEAD|WAPI)-[A-Za-z0-9_-]+$/),childCount:z.number().int().min(1).max(8)}).strict());const issued=await x.service.issue(x.actor,body.stableLeadRef,body.childCount);return NextResponse.json({ok:true,data:issued,requestId:randomUUID()},{status:201,headers:{"Cache-Control":"private, no-store","Referrer-Policy":"no-referrer"}});}catch(e){return fail(e)}}
