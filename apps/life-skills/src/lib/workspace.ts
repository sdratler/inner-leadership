import { AppError } from "./errors.ts";
import type { AccountId, CaseId, WorkspaceId } from "./ids.ts";
export type WorkspaceScope = Readonly<{ workspaceId: WorkspaceId; accountId: AccountId }>;
export type CaseScope = WorkspaceScope & Readonly<{ caseId: CaseId }>;
export function assertSameWorkspace(scope: WorkspaceScope, rowWorkspaceId: WorkspaceId): void {
  if (scope.workspaceId !== rowWorkspaceId) throw new AppError("FORBIDDEN");
}
/** The identity owner implements this; workspace equality alone NEVER grants case access. */
export interface CaseAuthorizer {
  authorize(scope: WorkspaceScope, caseId: CaseId, operation: "read" | "write" | "publish"): Promise<CaseScope>;
}
export const closedCaseAuthorizer: CaseAuthorizer = Object.freeze({
  async authorize() { throw new AppError("UNAVAILABLE"); },
});
