import { AppError } from "../../lib/errors.ts";
import type { CaseScope } from "../../lib/workspace.ts";
import { isVisibility, type Visibility } from "../../lib/visibility.ts";
import type { AccountFacts, AccountId, CaseId, PersonId, WorkspaceId, AudienceId } from "../identity/types.ts";
export const caseLifecycleValues = ["invited", "intake", "active", "paused", "completed", "archived"] as const;
export type CaseLifecycle = (typeof caseLifecycleValues)[number];
export interface CaseFacts {
  id: CaseId; workspaceId: WorkspaceId; clientPersonId: PersonId;
  practitionerAccountId: AccountId; kind: "minor" | "adult"; state: CaseLifecycle;
}
export interface GuardianFacts { caseId: CaseId; accountId: AccountId; workspaceId: WorkspaceId; revoked: boolean; }
export interface AudienceFacts {
  id: AudienceId; workspaceId: WorkspaceId; caseId: CaseId; visibility: Visibility;
  published: boolean; accountIds: readonly AccountId[];
}
export function isCaseLifecycle(value: unknown): value is CaseLifecycle {
  return typeof value === "string" && caseLifecycleValues.some(item => item === value);
}
export function caseAccess(account: AccountFacts, item: CaseFacts | null, guardians: readonly GuardianFacts[], operation: "read" | "write" | "publish"): CaseScope {
  // Uniform absence/denial response prevents existence enumeration.
  if (!item || account.state !== "active" || account.workspaceId !== item.workspaceId) throw new AppError("NOT_FOUND");
  const owner = account.role === "practitioner" && account.id === item.practitionerAccountId;
  const parent = account.role === "parent" && item.kind === "minor" && guardians.some(g =>
    g.accountId === account.id && g.caseId === item.id && g.workspaceId === item.workspaceId && g.revoked === false);
  const adult = account.role === "adult_client" && item.kind === "adult" && item.clientPersonId === account.personId;
  if (!owner && !(operation === "read" && (parent || adult))) throw new AppError("NOT_FOUND");
  // Lifecycle does not silently change retention or end-of-service access policy.
  // Membership revocation is explicit, rather than inferred from completion/payment.
  return Object.freeze({ workspaceId: item.workspaceId, accountId: account.id, caseId: item.id });
}
export function audienceAccess(account: AccountFacts, item: CaseFacts | null, guardians: readonly GuardianFacts[], audience: AudienceFacts): CaseScope {
  const scope = caseAccess(account, item, guardians, "read");
  if (audience.workspaceId !== scope.workspaceId || audience.caseId !== scope.caseId || !isVisibility(audience.visibility)) throw new AppError("NOT_FOUND");
  if (account.role === "practitioner") return scope;
  if (!audience.published || audience.visibility === "private" || !audience.accountIds.includes(account.id)) throw new AppError("NOT_FOUND");
  return scope;
}
export function requireOwnPreference(actor: AccountFacts, targetAccountId: AccountId): void {
  if (actor.state !== "active" || actor.id !== targetAccountId) throw new AppError("NOT_FOUND");
}
export function requirePractitioner(actor: AccountFacts): void {
  if (actor.state !== "active" || actor.role !== "practitioner") throw new AppError("FORBIDDEN");
}
/** Only deliberately publishable fields enter this type. Private notes are not accepted. */
export interface SharedItem {
  id: string; title: string; completed: boolean; publicDetails: string;
}
export function projectSharedItem(actor: AccountFacts, item: CaseFacts, guardians: readonly GuardianFacts[], audience: AudienceFacts, content: SharedItem) {
  audienceAccess(actor, item, guardians, audience);
  const minimal = { id: content.id, title: content.title, completed: content.completed };
  return audience.visibility === "family_title_completion" && actor.role !== "practitioner"
    ? minimal : { ...minimal, details: content.publicDetails };
}
export function validateAssignees(actor: AccountFacts, item: CaseFacts, guardians: readonly GuardianFacts[], audience: AudienceFacts, assignees: readonly AccountId[]): readonly AccountId[] {
  audienceAccess(actor, item, guardians, audience);
  if (!assignees.length || assignees.length > 2 || new Set(assignees).size !== assignees.length) throw new AppError("INVALID_REQUEST");
  for (const id of assignees) {
    if (!audience.accountIds.includes(id) || !guardians.some(g => g.accountId === id && g.caseId === item.id && g.workspaceId === item.workspaceId && !g.revoked)) throw new AppError("NOT_FOUND");
  }
  return [...assignees];
}
