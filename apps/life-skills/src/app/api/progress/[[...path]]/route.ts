import { AppError } from "@/lib/errors.ts";
import { failureResponse } from "@/lib/http/json.ts";
import { newRequestId } from "@/lib/ids.ts";
import { progressRuntime } from "@/features/progress/runtime.ts";
import { identityRuntime } from "@/features/identity/runtime.ts";
import { DatabaseAttendanceReader } from "@/features/progress/sources.ts";
import { HomePracticeService } from "@/features/home-practice/service.ts";
import { DatabaseParentReportReader } from "@/features/updates/sources.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handle(request: Request): Promise<Response> {
  try {
    const identity = await identityRuntime();
    return await (await progressRuntime({
      attendance: new DatabaseAttendanceReader(identity.store),
      practiceVersions: new HomePracticeService(identity.store, identity.config, identity.clock),
      parentReports: new DatabaseParentReportReader(identity.store),
    })).handle(request);
  }
  catch { return failureResponse(new AppError("UNAVAILABLE"), newRequestId()); }
}
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const PUT = handle;
export const DELETE = handle;
export const OPTIONS = handle;
export const HEAD = handle;
