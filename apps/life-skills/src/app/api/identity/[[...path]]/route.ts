import { identityRuntime } from "@/features/identity/runtime.ts";
import { failureResponse } from "@/lib/http/json.ts";
import { AppError } from "@/lib/errors.ts";
import { newRequestId } from "@/lib/ids.ts";
import { canonicalForwardedRequest } from "@/features/integration/canonical-forwarded-request.ts";
import { after } from "next/server";
import { scheduleResetDelivery } from "@/providers/email/reset-delivery.ts";
export const runtime="nodejs";
export const dynamic="force-dynamic";
async function handle(request:Request):Promise<Response>{
 try{
  const identity=await identityRuntime(), canonical=canonicalForwardedRequest(request);
  const response=await identity.http.handle(canonical);
  // Delivery is explicitly enabled only for this service; never alters the uniform response.
  try{await scheduleResetDelivery(canonical,response,identity,process.env,after);}
  catch{console.error("AUTH_RESET_SCHEDULING_FAILED");}
  return response;
 }
 catch{return failureResponse(new AppError("UNAVAILABLE"),newRequestId());}
}
export const GET=handle;
export const POST=handle;
export const PUT=handle;
export const PATCH=handle;
export const DELETE=handle;
export const OPTIONS=handle;
export const HEAD=handle;
