import { keysInterestOwnerHttp } from "@/features/keys-trip/http.ts";
import { keysOwnerRuntime } from "@/features/keys-trip/runtime.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handle(request: Request) {
  return keysInterestOwnerHttp(request, async () => {
    const { identity: r, store } = await keysOwnerRuntime();
    return { enabled: true, origin: r.config.origin, actor: (token: string) => r.services.sessions.actor(token),
      csrf: (token: string) => r.services.sessions.csrf(token), limits: r.services.limits,
      rateLimitKey: r.config.rateLimitKey, store };
  });
}
export const GET = handle;
export const POST = handle;
