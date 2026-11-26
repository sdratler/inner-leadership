import { keysInterestHttp } from "@/features/keys-trip/http.ts";
import { keysCollectionRuntime } from "@/features/keys-trip/runtime.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handle(request: Request) {
  return keysInterestHttp(request, async () => {
    const { identity: r, store } = await keysCollectionRuntime();
    return { enabled: true, origin: r.config.origin, challengeKey: r.config.rateLimitKey,
      now: () => r.clock.now().getTime(), limits: r.services.limits, store };
  });
}
export const GET = handle;
export const POST = handle;
