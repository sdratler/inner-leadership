import { AppError } from "../../lib/errors.ts";
import type { AccountFacts, AccountId } from "../identity/types.ts";
import type { AudienceFacts, CaseFacts, GuardianFacts } from "../cases/policy.ts";
import { validateAssignees } from "../cases/policy.ts";
import type { CoordinationSnapshot } from "../identity/interfaces.ts";
import type { CompletionStatus, OccurrencePeriod } from "./types.ts";

export function assertCalendarDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new AppError("INVALID_REQUEST");
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (candidate.getUTCFullYear() !== year || candidate.getUTCMonth() !== month - 1 || candidate.getUTCDate() !== day) {
    throw new AppError("INVALID_REQUEST");
  }
  return value;
}

export function assertPeriod(value: string): OccurrencePeriod {
  if (value !== "morning" && value !== "evening") throw new AppError("INVALID_REQUEST");
  return value;
}

export function assertCompletionStatus(value: string): CompletionStatus {
  if (!(["done", "partly_done", "not_done", "rescheduled", "not_applicable"] as const).includes(value as CompletionStatus)) {
    throw new AppError("INVALID_REQUEST");
  }
  return value as CompletionStatus;
}

export function assertAssigneeMayReport(snapshot: CoordinationSnapshot, actorAccountId: AccountId): void {
  if (!snapshot.assigneeAccountIds.includes(actorAccountId)) throw new AppError("NOT_FOUND");
}

export function occurrenceShouldClose(snapshot: CoordinationSnapshot, reportedBy: readonly AccountId[]): boolean {
  const unique = new Set(reportedBy);
  if (snapshot.completionMode === "any_assignee") return unique.size > 0;
  return snapshot.assigneeAccountIds.every(accountId => unique.has(accountId));
}

export function selectReminderCandidates(
  snapshot: CoordinationSnapshot & { reminderCandidateAccountIds: readonly AccountId[] },
  enabledAccountIds: readonly AccountId[],
): readonly AccountId[] {
  const enabled = new Set(enabledAccountIds);
  return snapshot.reminderCandidateAccountIds.filter(id => snapshot.assigneeAccountIds.includes(id) && enabled.has(id));
}

/** A client can coordinate only their own adult case and own responsibility.
 * Child permission, an audience grant or a reminder recipient is not ownership. */
export function coordinationAssignees(actor: AccountFacts, item: CaseFacts | null, guardians: readonly GuardianFacts[], audience: AudienceFacts, assignees: readonly AccountId[], clientAccountIds: readonly AccountId[]): readonly AccountId[] {
  if (!item || !audience.published || audience.visibility === "private" || !["parent", "adult_client"].includes(actor.role)) throw new AppError("NOT_FOUND");
  if (actor.role === "adult_client" && (item.kind !== "adult" || actor.personId !== item.clientPersonId || assignees.length !== 1 || assignees[0] !== actor.id)) throw new AppError("NOT_FOUND");
  return validateAssignees(actor, item, guardians, audience, assignees, clientAccountIds);
}
