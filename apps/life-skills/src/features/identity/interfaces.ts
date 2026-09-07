/** Prepared I-013/I-014 declarations. LS-025 must freeze them; no domain implementations here. */
import type { Id, AccountId, CaseId, WorkspaceId } from "../../lib/ids.ts";
import type { CaseScope } from "../../lib/workspace.ts";
import type { Visibility } from "../../lib/visibility.ts";
import type { NotificationPreference, AudienceId } from "./types.ts";
export type PracticeAssignmentId = Id<"practice_assignment">;
export type PracticeVersionId = Id<"practice_version">;
export type OccurrenceId = Id<"occurrence">;
export type CoordinationVersionId = Id<"coordination_version">;
export interface PracticeVersionReference {
  workspaceId: WorkspaceId; caseId: CaseId; assignmentId: PracticeAssignmentId;
  versionId: PracticeVersionId; audienceId: AudienceId; visibility: Visibility;
  publishedAt: string; immutableSnapshotDigest: string;
}
export interface PracticeVersionReader {
  /** Verify case, audience, publication and the exact historical version independently. */
  getAuthorizedVersion(scope: CaseScope, versionId: PracticeVersionId): Promise<PracticeVersionReference | null>;
}
export interface CoordinationSnapshot {
  versionId: CoordinationVersionId; caseId: CaseId; audienceId: AudienceId;
  assigneeAccountIds: readonly AccountId[]; completionMode: "any_assignee" | "each_assignee";
  effectiveFrom: string; changedByAccountId: AccountId;
}
export interface CompletionReportReference {
  occurrenceId: OccurrenceId; coordinationVersionId: CoordinationVersionId;
  authorAccountId: AccountId; reportedAt: string; idempotencyKey: string;
  status: "done" | "partly_done" | "not_done" | "rescheduled" | "not_applicable";
}
export interface RescheduleEligibilityReference {
  schemaVersion: 1; workspaceId: WorkspaceId; caseId: CaseId;
  requestId: Id<"reschedule_request">; appointmentId: Id<"appointment">;
  receivedAt: string; originalStart: string; source: "app" | "phone" | "whatsapp_manual";
  requestedByAccountId: AccountId; termsVersion: string;
  eligibility: "credit_preserved" | "late_notice" | "practitioner_exception";
}
export interface CreditEffectReference {
  schemaVersion: 1; caseId: CaseId; appointmentId: Id<"appointment">;
  rescheduleRequestId: Id<"reschedule_request"> | null; termsVersion: string;
  effect: "consume" | "restore" | "preserve"; idempotencyKey: string;
  /** This is not an attendance event; the calendar owner records attendance separately. */
  actorAccountId: AccountId; occurredAt: string;
}
export interface NotificationEffectReference {
  schemaVersion: 1; workspaceId: WorkspaceId; caseId: CaseId; audienceId: AudienceId;
  recipientAccountId: AccountId; sourceId: string; sourceVersionId: string;
  neutralMessageKey: "practice_due" | "appointment_changed" | "new_reply" | "summary_published";
  dueAt: string; channel: NotificationPreference["channel"]; idempotencyKey: string;
}
export interface DeliveryAuthorization {
  /** Recheck live account, membership, audience, opt-in and source validity at delivery time. */
  mayDeliver(effect: NotificationEffectReference): Promise<boolean>;
}
