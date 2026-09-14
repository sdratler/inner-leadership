import { AppError } from "../../lib/errors.ts";
import { failureResponse } from "../../lib/http/json.ts";
import { newRequestId } from "../../lib/ids.ts";
import { ls080Runtime } from "./runtime.ts";

export async function handleLs080Request(request: Request): Promise<Response> {
  try { return await (await ls080Runtime()).http.handle(request); }
  catch { return failureResponse(new AppError("UNAVAILABLE"), newRequestId()); }
}

