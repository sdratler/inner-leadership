import type { Id } from "../../lib/ids.ts";
import type { CaseScope } from "../../lib/workspace.ts";
import type { AccountId, AudienceId, CaseId, WorkspaceId } from "../identity/types.ts";
import type { PracticeAssignmentId, PracticeVersionId, PracticeVersionReference } from "../identity/interfaces.ts";

/** Brand intentionally matches the frozen LS-050 ParentReportReader consumer seam. */
export type ParentReportId = Id<"parent_report">;
export type UpdateReportId = ParentReportId;
export type UpdateReplyId = Id<"update_reply">;
export type AdaptationReceiptId = Id<"adaptation_receipt">;
export type ReviewState = "new" | "reviewed" | "replied" | "adapted";

export interface ParentReportReference {
  reportId: ParentReportId;
  workspaceId: WorkspaceId;
  caseId: CaseId;
  audienceId: AudienceId;
  authorAccountId: AccountId;
  submittedAt: string;
  sourceType: "parent_report";
}

export interface ParentReportReader {
  /** Returns attribution only after exact case/audience authorization; never review or evidentiary status. */
  getAuthorizedReport(scope: CaseScope, reportId: ParentReportId): Promise<ParentReportReference | null>;
}

export interface ParentReportView {
  id: UpdateReportId;
  workspaceId: WorkspaceId;
  caseId: CaseId;
  audienceId: AudienceId;
  authorAccountId: AccountId;
  body: string;
  eventAt: string | null;
  submittedAt: string;
  reviewState: ReviewState;
  reviewedByAccountId: AccountId | null;
  reviewedAt: string | null;
  practice: PracticeVersionReference;
}

export interface PractitionerReplyView {
  id: UpdateReplyId;
  reportId: UpdateReportId;
  authorAccountId: AccountId;
  body: string;
  state: "draft" | "published";
  createdAt: string;
  publishedAt: string | null;
  supersedesReplyId: UpdateReplyId | null;
}

export interface UpdateThreadView {
  report: ParentReportView;
  replies: PractitionerReplyView[];
}

export interface AdaptationDraftReceipt {
  id: AdaptationReceiptId;
  reportId: UpdateReportId;
  assignmentId: PracticeAssignmentId;
  previousVersionId: PracticeVersionId;
  newVersionId: PracticeVersionId;
  state: "draft";
  createdAt: string;
}

export interface PracticeAdaptationPort {
  /** Create a new LS-040 draft. This port never publishes an assignment version. */
  createDraftFromReport(input: {
    scope: CaseScope;
    sourceReportId: UpdateReportId;
    currentVersion: PracticeVersionReference;
    adaptedInstructions: string;
    practitionerAccountId: AccountId;
    idempotencyKey: string;
  }): Promise<{
    assignmentId: PracticeAssignmentId;
    previousVersionId: PracticeVersionId;
    newVersionId: PracticeVersionId;
    state: "draft";
  }>;
}
