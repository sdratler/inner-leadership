import { keysConnectionHttp } from "@/features/keys-trip/connection-http.ts";
import { KeysConnectionStore, parseKeysConnectionConfig } from "@/features/keys-trip/connection-store.ts";
import { identityRuntime } from "@/features/identity/runtime.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return keysConnectionHttp(request, async () => {
    const grant = parseKeysConnectionConfig(process.env);
    if (process.env.LS_PRIVATE_APP_ENABLED !== "true" || !grant) return { enabled: false, store: null };
    const r = await identityRuntime();
    return {
      enabled: true,
      store: new KeysConnectionStore(r.store, r.config.workspaceId, r.config.keyring,
        r.config.lookupKey.toString("hex"), process.env.LS_PROVIDER_INDEX_OWNER_ACCOUNT_ID ?? "", grant, r.clock),
    };
  });
}
