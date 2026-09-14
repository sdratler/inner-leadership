import { randomUUID } from "node:crypto";
import type { RequestContext, WorkspaceId, AccountId } from "../identity/types.ts";
import type { SqlSession } from "../identity/store.ts";

export const ls050Actions = [
  "form_template_created", "form_assigned", "form_submitted", "form_reviewed",
  "resource_created", "resource_assigned", "resource_completion_reported",
  "contextual_target_created", "qualitative_review_drafted", "qualitative_review_published",
] as const;
export type Ls050Action = (typeof ls050Actions)[number];

/** Feature-local neutral history. Protected form answers, narratives, titles and case details are never copied here. */
export async function recordLs050Action(tx: SqlSession, context: RequestContext, workspaceId: WorkspaceId, actorAccountId: AccountId, action: Ls050Action): Promise<void> {
  await tx.query(`INSERT INTO ls_progress.feature_history
    (id,workspace_id,actor_account_id,request_id,action,occurred_at) VALUES ($1,$2,$3,$4,$5,$6)`,
  [randomUUID(), workspaceId, actorAccountId, context.requestId, action, context.now]);
}
