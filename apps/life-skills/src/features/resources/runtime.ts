import "server-only";
import { identityRuntime } from "../identity/runtime.ts";
import { ResourcesHttp } from "./http.ts";
import { ResourcesService } from "./service.ts";
import {composeEducationResources} from "./education-runtime.ts";

let prepared: Promise<{handle(request:Request):Promise<Response>}> | undefined;
export function resourcesRuntime(): Promise<{handle(request:Request):Promise<Response>}> {
  prepared ??= (async () => {
    const identity = await identityRuntime();
    const regular=new ResourcesHttp({
      config: identity.config,
      sessions: identity.services.sessions,
      limits: identity.services.limits,
      audit: identity.services.audit,
      clock: identity.clock,
    }, new ResourcesService(identity.store, identity.config, identity.clock));
    return composeEducationResources(regular,identity);
  })();
  return prepared;
}
