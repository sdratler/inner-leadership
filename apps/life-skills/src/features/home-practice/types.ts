import type { Id } from "../../lib/ids.ts";
import type { AccountId, AudienceId, CaseId, WorkspaceId } from "../identity/types.ts";
import type {ResponsibilityInput} from "./responsibility-input.ts";
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
  /** Absent historical metadata stays absent; never infer a clock/participant. */
  responsibility?:ResponsibilityInput|null;
}

/** Practitioner-only authoring projection. Drafts never enter the client list. */
export interface ManagedPracticeVersion extends Omit<PublishedPracticeVersion, "publishedAt" | "immutableSnapshotDigest"> {
  state: "draft" | "published";
  active: boolean;
  publishedAt: string | null;
  immutableSnapshotDigest: string | null;
}
export interface PracticeManagementPage { items: ManagedPracticeVersion[]; hasMore: boolean; }

export interface CoordinationVersion {
  responsibilityVersionId?: PracticeVersionId | null;
  participant?: "parent" | "client" | null;
  assistedParentAccountIds?: readonly AccountId[] | null;
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

export interface PracticeCoordinationPage {
  readOnlyReason?: "client_responsibility" | "legacy_child_assignment";
  ownAccountId: AccountId;
  role: "parent" | "adult_client";
  eligibleAccountIds: readonly AccountId[];
  /** Native immutable routing authority, distinct from the selected version. */
  reminderRoutingAccountIds?: readonly AccountId[];
  /** Server-clock effective selection, independent of the bounded history. */
  asOf: string;
  currentVersion: CoordinationVersion | null;
  /** Earliest pending effective instant, also independent of bounded history. */
  nextEffectiveFrom: string | null;
  versions: CoordinationVersion[];
  hasMore: boolean;
}

export interface ScheduledOccurrence {
  id: OccurrenceId;
  assignmentId: PracticeAssignmentId;
  practiceVersionId: PracticeVersionId;
  coordinationVersionId: CoordinationVersionId;
  occursOn: string;
  period: OccurrencePeriod;
  state: "open" | "closed" | "cancelled";
  occursAt?:string|null;
}

export interface CompletionView {
  reportId: CompletionReportId;
  occurrenceId: OccurrenceId;
  authorAccountId: AccountId;
  status: CompletionStatus;
  revision: number;
  reportedAt: string;
  correctedReportId: CompletionReportId | null;
  attribution?:{subjectPersonId:string;authorship:"self"|"parent_assisted_child"|"parent_reporting_child";note:string};
}

/** Only the authenticated own-history endpoint includes retry receipt keys. */
export interface OwnCompletionView extends CompletionView { idempotencyKey: string; }

/** Read projection only; responsibility and instruction version stay frozen. */
export interface PracticeOccurrenceItem {
  occurrence: ScheduledOccurrence;
  practice: PublishedPracticeVersion;
  canReport: boolean;
  ownReport: CompletionView | null;
  assistanceModes?:readonly ("together"|"parent_report")[];
  schedule?:{participant:"parent"|"client";localTime:string;timezone:string;timeOrigin:ResponsibilityInput["timeOrigin"]};
}
export interface PracticeOccurrencePage {
  items: PracticeOccurrenceItem[];
  hasMore: boolean;
}

