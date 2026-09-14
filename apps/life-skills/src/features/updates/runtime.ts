import "server-only";
import { identityRuntime } from "../identity/runtime.ts";
import { HomePracticeService } from "../home-practice/service.ts";
import { Ls080Http } from "./http.ts";
import { SqlPublishedPracticeVersionReader } from "./practice-reader.ts";
import { UpdateService } from "./service.ts";

let prepared: ReturnType<typeof construct> | undefined;

async function construct() {
  const identity = await identityRuntime();
  const versions = new SqlPublishedPracticeVersionReader(identity.store);
  const adaptations = new HomePracticeService(identity.store, identity.config, identity.clock);
  const updates = new UpdateService(identity.store, identity.config, identity.clock, versions, adaptations);
  const http = new Ls080Http(identity.config, identity.clock, {
    sessions: identity.services.sessions,
    limits: identity.services.limits,
    audit: identity.services.audit,
    updates,
  });
  return { updates, versions, http };
}

export function ls080Runtime() {
  prepared ??= construct();
  return prepared;
}
