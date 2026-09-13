import type { CommitmentId, GoalId } from "../home-practice/types.ts";
import type { AudienceId, CaseId, WorkspaceId } from "../identity/types.ts";

export interface CommitmentView {
  id: CommitmentId;
  workspaceId: WorkspaceId;
  caseId: CaseId;
  audienceId: AudienceId;
  goalId: GoalId;
  title: string;
  state: "active" | "closed";
  createdAt: string;
}

