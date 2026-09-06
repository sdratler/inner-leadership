import { AppError } from "../../../../lib/errors.ts";
import { newRequestId } from "../../../../lib/ids.ts";
import { failureResponse } from "../../../../lib/http/json.ts";
export const dynamic = "force-dynamic";
function closed() { return failureResponse(new AppError("UNAVAILABLE"), newRequestId()); }
export { closed as GET, closed as POST, closed as PUT, closed as PATCH, closed as DELETE, closed as OPTIONS, closed as HEAD };
