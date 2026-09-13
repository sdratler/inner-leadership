import { randomUUID } from "node:crypto";
import type { SqlSession } from "../identity/store.ts";
import type { AccountId, WorkspaceId } from "../identity/types.ts";

export async function recordUpdateAction(
  tx: SqlSession,
  input: { workspaceId: WorkspaceId; actorAccountId: AccountId; requestId: string; action: string; now: Date },
): Promise<void> {
  await tx.query(
    `INSERT INTO ls_updates.feature_history
      (id,workspace_id,actor_account_id,request_id,action,occurred_at)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [randomUUID(), input.workspaceId, input.actorAccountId, input.requestId, input.action, input.now],
  );
}

