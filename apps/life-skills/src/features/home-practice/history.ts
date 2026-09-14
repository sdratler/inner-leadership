import type { SqlSession } from "../identity/store.ts";
import type { AccountId, WorkspaceId } from "../identity/types.ts";

export const practiceActions = [
  "practice_goal_created", "practice_commitment_created", "practice_assignment_draft_created",
  "practice_assignment_revision_drafted", "practice_assignment_published", "practice_coordination_changed",
  "practice_occurrence_scheduled", "practice_checkin_reported", "practice_checkin_corrected",
] as const;
export type PracticeAction = (typeof practiceActions)[number];

export async function recordPracticeAction(
  tx: SqlSession,
  context: { requestId: string; now: Date },
  workspaceId: WorkspaceId,
  actorAccountId: AccountId,
  action: PracticeAction,
): Promise<void> {
  await tx.query(`INSERT INTO ls_practice.action_history
    (id,workspace_id,actor_account_id,request_id,action,occurred_at)
    VALUES (gen_random_uuid(),$1,$2,$3,$4,$5)`, [workspaceId, actorAccountId, context.requestId, action, context.now]);
}

