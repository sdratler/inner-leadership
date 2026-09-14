import "server-only";
import { identityRuntime } from "../identity/runtime.ts";
import { ResourcesHttp } from "./http.ts";
import { ResourcesService } from "./service.ts";

let prepared: Promise<ResourcesHttp> | undefined;
export function resourcesRuntime(): Promise<ResourcesHttp> {
  prepared ??= (async () => {
    const identity = await identityRuntime();
    return new ResourcesHttp({
      config: identity.config,
      sessions: identity.services.sessions,
      limits: identity.services.limits,
      audit: identity.services.audit,
      clock: identity.clock,
    }, new ResourcesService(identity.store, identity.config, identity.clock));
  })();
  return prepared;
}
