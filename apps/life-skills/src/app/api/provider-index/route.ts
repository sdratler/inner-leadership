import { handleProviderRequest } from "../../../features/provider-index/server/http.ts";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;
export function POST(request: Request) { return handleProviderRequest(request, "directory"); }

