import "server-only";
import { IdentityAuthService } from "./auth-service.ts";
import { IdentityAccountService } from "./account-service.ts";
import { IdentityPreferenceService } from "./preferences.ts";
import { IdentitySessions } from "./session-adapter.ts";
import { CaseService } from "../cases/service.ts";
import { DatabaseCaseAuthorizer } from "../cases/authorization.ts";
import { IdentityHttp } from "./http.ts";
import { PostgresIdentityRateStore } from "./rate-store.ts";
import { durableAuditSink } from "./history.ts";
import { drizzleIdentityStore } from "./drizzle-store.ts";
import { parseIdentityConfig } from "./config.ts";
import { systemClock } from "./types.ts";
import { dummyPasswordHash } from "./crypto.ts";
import {configuredFishingOwnerAppScope} from '../../lib/fishing-owner-app-scope.ts';
import {FishingOwnerSessionAdapter} from '../integration/fishing-owner-session-adapter.ts';
let prepared:Promise<ReturnType<typeof construct>>|undefined;
function construct(){
 const config=parseIdentityConfig(process.env),store=drizzleIdentityStore,clock=systemClock;
 const appScope=configuredFishingOwnerAppScope(config.workspaceId,process.env);
 const services={auth:new IdentityAuthService(store,config,clock),accounts:new IdentityAccountService(store,config,clock),
  preferences:new IdentityPreferenceService(store,config,clock),sessions:appScope?new FishingOwnerSessionAdapter(store,config,clock,appScope):new IdentitySessions(store,config,clock),
  cases:new CaseService(store,config,clock),limits:new PostgresIdentityRateStore(store),audit:durableAuditSink(store)};
 return {config,store,clock,appScope,services,caseAuthorizer:new DatabaseCaseAuthorizer(store),http:new IdentityHttp(config,clock,services)};
}
export async function identityRuntime(){
 // No browser/HTTP bootstrap, live provider, environment bypass or automatic registration.
 if(!prepared) prepared=(async()=>{const result=construct();await dummyPasswordHash();return result;})();
 return prepared;
}
