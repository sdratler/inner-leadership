import { AppError } from "../../lib/errors.ts";
import type { AudienceFacts, CaseFacts, GuardianFacts } from "../cases/policy.ts";
import { audienceAccess, caseAccess } from "../cases/policy.ts";
import type { AccountFacts } from "../identity/types.ts";

export function parentMayReport(
  actor: AccountFacts,
  item: CaseFacts | null,
  guardians: readonly GuardianFacts[],
  audience: AudienceFacts,
): void {
  audienceAccess(actor, item, guardians, audience);
  if (actor.role !== "parent" || audience.visibility !== "family_full") throw new AppError("NOT_FOUND");
}

export function practitionerMayRespond(
  actor: AccountFacts,
  item: CaseFacts | null,
  guardians: readonly GuardianFacts[],
): void {
  caseAccess(actor, item, guardians, "write");
  if (actor.role !== "practitioner") throw new AppError("NOT_FOUND");
}

export function narrative(value: string, maximum = 8_000): string {
  const result = value.trim();
  if (!result || result.length > maximum) throw new AppError("INVALID_REQUEST");
  return result;
}

