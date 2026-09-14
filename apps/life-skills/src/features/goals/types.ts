import type { GoalId } from "../home-practice/types.ts";
import type { AudienceId, CaseId, WorkspaceId } from "../identity/types.ts";

export interface GoalView {
  id: GoalId;
  workspaceId: WorkspaceId;
  caseId: CaseId;
  audienceId: AudienceId;
  title: string;
  state: "active" | "closed";
  createdAt: string;
}

