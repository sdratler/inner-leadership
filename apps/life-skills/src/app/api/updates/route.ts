import { handleLs080Request } from "@/features/updates/route-handler.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = handleLs080Request;
export const POST = handleLs080Request;
export const PUT = handleLs080Request;
export const PATCH = handleLs080Request;
export const DELETE = handleLs080Request;
export const OPTIONS = handleLs080Request;
export const HEAD = handleLs080Request;

