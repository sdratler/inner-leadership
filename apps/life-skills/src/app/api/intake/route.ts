import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AppError, errorEnvelope } from "@/lib/errors.ts";
import { readJson } from "@/lib/http/json.ts";
import { identityRuntime } from "@/features/identity/runtime.ts";
import { verifyIntakeMutationOrigin } from "@/features/forms/pre-enrollment/public-origin.ts";
import { PreEnrollmentService } from "@/features/forms/pre-enrollment/service.ts";
import { SqlPreEnrollmentRepository } from "@/features/forms/pre-enrollment/repository.ts";
import { updateProspect } from "@/features/prospects/bridge.ts";

/** Public intake is intentionally gated until W0's explicit real-data release.
 * The fragment token is never accepted in a GET/query string. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function reply(error:unknown){const result=errorEnvelope(error,randomUUID());return NextResponse.json(result.body,{status:result.status,headers:{"Cache-Control":"private, no-store","Referrer-Policy":"no-referrer","X-Content-Type-Options":"nosniff"}});}
/** The production environment remains closed unless the dedicated release flag is enabled.
 * Local synthetic loopback uses the same sealed database path, never a browser store. */
function enabled(request:Request){
  if(process.env.LS_INTAKE_REAL_DATA_RELEASE==="true")return true;
  const host=new URL(request.url).hostname;
  return process.env.NODE_ENV==="development"&&process.env.LS_INTAKE_SYNTHETIC_LOOPBACK==="true"&&(host==="localhost"||host==="127.0.0.1");
}
export async function GET(): Promise<Response> { return reply(new AppError("NOT_FOUND")); }
export async function POST(request:Request):Promise<Response>{try{if(!enabled(request))throw new AppError("NOT_FOUND");verifyIntakeMutationOrigin(request,process.env);const runtime=await identityRuntime();const body=await readJson(request,z.object({action:z.enum(["exchange","submit"]),token:z.string().max(128),idempotencyKey:z.string().uuid().optional(),payload:z.unknown().optional()}).strict());const service=new PreEnrollmentService(new SqlPreEnrollmentRepository(runtime.store,runtime.config.workspaceId),runtime.config.keyring,()=>runtime.clock.now(),true,runtime.config.workspaceId);const data=body.action==='exchange'?await service.exchange(body.token):body.idempotencyKey?await service.submit(body.token,body.idempotencyKey,body.payload):(()=>{throw new AppError("INVALID_REQUEST");})();if(body.action==='submit'&&'stableLeadId' in data){await updateProspect(data.stableLeadId,{formSubmitted:data.receivedAt,stage:"Intake submitted / awaiting payment",nextAction:"Verify first-session payment",dueDate:"",updateProvenance:"private-app:intake-submitted"}).catch(()=>undefined);}return NextResponse.json({ok:true,data,requestId:randomUUID()},{headers:{"Cache-Control":"private, no-store","Referrer-Policy":"no-referrer","X-Content-Type-Options":"nosniff"}});}catch(error){return reply(error);}}
