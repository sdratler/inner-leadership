import "server-only";
import { identityRuntime } from "../identity/runtime.ts";
import { PrivateNotesHttp } from "./http.ts";
import { PrivateNotesService } from "./service.ts";
let prepared: Promise<PrivateNotesHttp> | undefined;
export function privateNotesRuntime() { prepared ??= identityRuntime().then((identity) => new PrivateNotesHttp({ config: identity.config, sessions: identity.services.sessions, limits: identity.services.limits, audit: identity.services.audit, clock: identity.clock }, new PrivateNotesService(identity.store, identity.config, identity.clock))); return prepared; }
