import { newRequestId } from "../../../lib/ids.ts";
import { successResponse } from "../../../lib/http/json.ts";
export const dynamic = "force-dynamic";
/** Process liveness only; deliberately does not claim database or identity readiness. */
export function GET() { return successResponse({ status: "ok" }, newRequestId()); }
