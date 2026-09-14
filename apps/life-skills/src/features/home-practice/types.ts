import type { Id } from "../../lib/ids.ts";
import type { AccountId, AudienceId, CaseId, WorkspaceId } from "../identity/types.ts";
import type {
  CoordinationVersionId,
  OccurrenceId,
  PracticeAssignmentId,
  PracticeVersionId,
} from "../identity/interfaces.ts";

export type GoalId = Id<"goal">;
export type CommitmentId = Id<"commitment">;
export type CompletionReportId = Id<"completion_report">;
export const occurrencePeriods = ["morning", "evening"] as const;
export type OccurrencePeriod = (typeof occurrencePeriods)[number];
export const completionStatuses = ["done", "partly_done", "not_done", "rescheduled", "not_applicable"] as const;
export type CompletionStatus = (typeof completionStatuses)[number];
export const completionModes = ["any_assignee", "each_assignee"] as const;
export type CompletionMode = (typeof completionModes)[number];

export interface PublishedPracticeVersion {
  workspaceId: WorkspaceId;
  caseId: CaseId;
  assignmentId: PracticeAssignmentId;
  versionId: PracticeVersionId;
  version: number;
  audienceId: AudienceId;
  goalId: GoalId | null;
  commitmentId: CommitmentId | null;
  templateKey: string;
  templateVersion: string;
  instructions: string;
  startsOn: string;
  endsOn: string | null;
  publishedAt: string;
  immutableSnapshotDigest: string;
}

export interface CoordinationVersion {
  versionId: CoordinationVersionId;
  assignmentId: PracticeAssignmentId;
  caseId: CaseId;
  audienceId: AudienceId;
  assigneeAccountIds: readonly AccountId[];
  completionMode: CompletionMode;
  reminderCandidateAccountIds: readonly AccountId[];
  effectiveFrom: string;
  changedByAccountId: AccountId;
}

export interface ScheduledOccurrence {
  id: OccurrenceId;
  assignmentId: PracticeAssignmentId;
  practiceVersionId: PracticeVersionId;
  coordinationVersionId: CoordinationVersionId;
  occursOn: string;
  period: OccurrencePeriod;
  state: "open" | "closed";
}

export interface CompletionView {
  reportId: CompletionReportId;
  occurrenceId: OccurrenceId;
  authorAccountId: AccountId;
  status: CompletionStatus;
  revision: number;
  reportedAt: string;
  correctedReportId: CompletionReportId | null;
}

