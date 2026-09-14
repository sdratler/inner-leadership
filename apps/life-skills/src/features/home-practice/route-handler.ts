import { AppError } from "../../lib/errors.ts";
import { failureResponse } from "../../lib/http/json.ts";
import { newRequestId } from "../../lib/ids.ts";
import { ls040Runtime } from "./runtime.ts";

export async function handleLs040Request(request: Request): Promise<Response> {
  try { return await (await ls040Runtime()).http.handle(request); }
  catch { return failureResponse(new AppError("UNAVAILABLE"), newRequestId()); }
}

