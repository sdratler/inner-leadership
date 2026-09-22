import "server-only";
import { identityRuntime } from "../identity/runtime.ts";
import { SessionDatabaseService } from "./database.ts";
import { SessionHttp } from "./http.ts";
let prepared:Promise<SessionHttp>|undefined;
export function sessionRuntime(){prepared??=identityRuntime().then(identity=>new SessionHttp({config:identity.config,sessions:identity.services.sessions,limits:identity.services.limits,audit:identity.services.audit,clock:identity.clock},new SessionDatabaseService(identity.store,identity.config.keyring,identity.clock)));return prepared;}
