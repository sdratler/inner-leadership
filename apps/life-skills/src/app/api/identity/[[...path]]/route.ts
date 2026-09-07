import { identityRuntime } from "@/features/identity/runtime.ts";
import { failureResponse } from "@/lib/http/json.ts";
import { AppError } from "@/lib/errors.ts";
import { newRequestId } from "@/lib/ids.ts";
export const runtime="nodejs";
export const dynamic="force-dynamic";
async function handle(request:Request):Promise<Response>{
 try{return await (await identityRuntime()).http.handle(request);}
 catch{return failureResponse(new AppError("UNAVAILABLE"),newRequestId());}
}
export const GET=handle;
export const POST=handle;
export const PUT=handle;
export const PATCH=handle;
export const DELETE=handle;
export const OPTIONS=handle;
export const HEAD=handle;
