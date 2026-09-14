import "server-only";
import { identityRuntime } from "../identity/runtime.ts";
import { FormsHttp } from "./http.ts";
import { FormsService } from "./service.ts";

let prepared: Promise<FormsHttp> | undefined;
export function formsRuntime(): Promise<FormsHttp> {
  prepared ??= (async () => {
    const identity = await identityRuntime();
    const service = new FormsService(identity.store, identity.config, identity.clock);
    return new FormsHttp({
      config: identity.config,
      sessions: identity.services.sessions,
      limits: identity.services.limits,
      audit: identity.services.audit,
      clock: identity.clock,
    }, service);
  })();
  return prepared;
}
