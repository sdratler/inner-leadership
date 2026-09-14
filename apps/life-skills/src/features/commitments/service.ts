import { randomUUID } from "node:crypto";
import { AppError } from "../../lib/errors.ts";
import { asId } from "../../lib/ids.ts";
import { audienceAccess, caseAccess } from "../cases/policy.ts";
import { loadAudience, loadCase, loadGuardians } from "../cases/data.ts";
import { seal, unseal } from "../identity/crypto.ts";
import type { IdentityConfig } from "../identity/config.ts";
import { freshActor, lockWorkspace } from "../identity/data.ts";
import { one, type IdentityStore } from "../identity/store.ts";
import type { Actor, AudienceId, CaseId, IdentityClock } from "../identity/types.ts";
import type { CommitmentId, GoalId } from "../home-practice/types.ts";
import type { CommitmentView } from "./types.ts";
import { recordPracticeAction } from "../home-practice/history.ts";

const commitmentAad = (workspaceId: string, id: string) => `commitment:${workspaceId}:${id}`;

export class CommitmentService {
  constructor(private readonly store: IdentityStore, private readonly config: IdentityConfig, private readonly clock: IdentityClock) {}

  async create(actor: Actor, input: { caseId: CaseId; audienceId: AudienceId; goalId: GoalId; title: string }, requestId: string): Promise<CommitmentView> {
    const now = this.clock.now();
    return this.store.transaction(async tx => {
      await lockWorkspace(tx, actor.workspaceId);
      const current = await freshActor(tx, actor, now);
      const item = await loadCase(tx, actor.workspaceId, input.caseId);
      const guardians = await loadGuardians(tx, actor.workspaceId, input.caseId);
      caseAccess(current, item, guardians, "write");
      const audience = await loadAudience(tx, actor.workspaceId, input.caseId, input.audienceId);
      if (!audience) throw new AppError("NOT_FOUND");
      const goal = await one(tx, "SELECT id FROM ls_practice.goals WHERE workspace_id=$1 AND case_id=$2 AND audience_id=$3 AND id=$4 AND state='active'", [actor.workspaceId, input.caseId, input.audienceId, input.goalId]);
      if (!goal) throw new AppError("NOT_FOUND");
      const id = asId(randomUUID(), "commitment");
      await tx.query(`INSERT INTO ls_practice.commitments
        (id,workspace_id,case_id,audience_id,goal_id,title_ciphertext,state,created_by_account_id,created_at)
        VALUES ($1,$2,$3,$4,$5,$6,'active',$7,$8)`, [
        id, actor.workspaceId, input.caseId, input.audienceId, input.goalId,
        seal(input.title, commitmentAad(actor.workspaceId, id), this.config.keyring), actor.id, now,
      ]);
      await recordPracticeAction(tx, { requestId, now }, actor.workspaceId, actor.id, "practice_commitment_created");
      return { id, workspaceId: actor.workspaceId, caseId: input.caseId, audienceId: input.audienceId, goalId: input.goalId, title: input.title, state: "active", createdAt: now.toISOString() };
    });
  }

  async list(actor: Actor, caseId: CaseId, audienceId: AudienceId): Promise<CommitmentView[]> {
    return this.store.transaction(async tx => {
      const current = await freshActor(tx, actor, this.clock.now());
      const audience = await loadAudience(tx, actor.workspaceId, caseId, audienceId);
      if (!audience) throw new AppError("NOT_FOUND");
      audienceAccess(current, await loadCase(tx, actor.workspaceId, caseId), await loadGuardians(tx, actor.workspaceId, caseId), audience);
      const rows = await tx.query<{ id: CommitmentId; goalId: GoalId; titleCiphertext: string; state: "active" | "closed"; createdAt: Date }>(
        `SELECT id,goal_id AS "goalId",title_ciphertext AS "titleCiphertext",state,created_at AS "createdAt"
         FROM ls_practice.commitments WHERE workspace_id=$1 AND case_id=$2 AND audience_id=$3
         ORDER BY created_at,id LIMIT 100`, [actor.workspaceId, caseId, audienceId],
      );
      return rows.map(row => ({
        id: row.id, workspaceId: actor.workspaceId, caseId, audienceId, goalId: row.goalId,
        title: unseal(row.titleCiphertext, commitmentAad(actor.workspaceId, row.id), this.config.keyring),
        state: row.state, createdAt: row.createdAt.toISOString(),
      }));
    });
  }
}
