import { AppError } from "../../lib/errors.ts";
import type { CaseAuthorizer, WorkspaceScope } from "../../lib/workspace.ts";
import type { IdentityStore } from "../identity/store.ts";
import { accountById } from "../identity/data.ts";
import type { AccountId,CaseId,AudienceId,WorkspaceId } from "../identity/types.ts";
import { loadCase,loadGuardians,loadAudience } from "./data.ts";
import { caseAccess,audienceAccess } from "./policy.ts";
/** I-001/I-002 implementation. Scope MUST come from requireSession on the server, not JSON. */
export class DatabaseCaseAuthorizer implements CaseAuthorizer {
 constructor(private readonly store:IdentityStore) {}
 async authorize(scope:WorkspaceScope,caseId:CaseId,operation:'read'|'write'|'publish') {
  return this.store.transaction(async tx=>{
   const account=await accountById(tx,scope.workspaceId,scope.accountId);
   if (!account) throw new AppError("NOT_FOUND");
   return caseAccess(account,await loadCase(tx,scope.workspaceId,caseId),await loadGuardians(tx,scope.workspaceId,caseId),operation);
  });
 }
 async authorizeAudience(scope:WorkspaceScope,caseId:CaseId,audienceId:AudienceId) {
  return this.store.transaction(async tx=>{
   const account=await accountById(tx,scope.workspaceId,scope.accountId), audience=await loadAudience(tx,scope.workspaceId,caseId,audienceId);
   if (!account || !audience) throw new AppError("NOT_FOUND");
   return audienceAccess(account,await loadCase(tx,scope.workspaceId,caseId),await loadGuardians(tx,scope.workspaceId,caseId),audience);
  });
 }
 /** Future dispatchers recheck at delivery time. Possessing a job ID is never permission. */
 async mayDeliver(workspaceId:WorkspaceId,accountId:AccountId,caseId:CaseId,audienceId:AudienceId):Promise<boolean> {
  try {await this.authorizeAudience({workspaceId,accountId},caseId,audienceId);return true;}
  catch(error){if(error instanceof AppError && error.code==='NOT_FOUND') return false;throw new AppError("UNAVAILABLE");}
 }
}
