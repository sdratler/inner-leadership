import { randomUUID } from "node:crypto";
import { AppError } from "../../lib/errors.ts";
import { asId } from "../../lib/ids.ts";
import { audienceAccess, caseAccess } from "../cases/policy.ts";
import { loadAudience, loadCase, loadGuardians } from "../cases/data.ts";
import { seal, unseal } from "../identity/crypto.ts";
import type { IdentityConfig } from "../identity/config.ts";
import { freshActor, lockWorkspace } from "../identity/data.ts";
import type { IdentityStore } from "../identity/store.ts";
import type { Actor, AudienceId, CaseId, IdentityClock } from "../identity/types.ts";
import type { GoalId } from "../home-practice/types.ts";
import type { GoalView } from "./types.ts";
import { recordPracticeAction } from "../home-practice/history.ts";

const goalAad = (workspaceId: string, goalId: string) => `goal:${workspaceId}:${goalId}`;

export class GoalService {
  constructor(private readonly store: IdentityStore, private readonly config: IdentityConfig, private readonly clock: IdentityClock) {}

  async create(actor: Actor, input: { caseId: CaseId; audienceId: AudienceId; title: string }, requestId: string): Promise<GoalView> {
    const now = this.clock.now();
    return this.store.transaction(async tx => {
      await lockWorkspace(tx, actor.workspaceId);
      const current = await freshActor(tx, actor, now);
      const item = await loadCase(tx, actor.workspaceId, input.caseId);
      const guardians = await loadGuardians(tx, actor.workspaceId, input.caseId);
      caseAccess(current, item, guardians, "write");
      const audience = await loadAudience(tx, actor.workspaceId, input.caseId, input.audienceId);
      if (!audience || audience.caseId !== input.caseId) throw new AppError("NOT_FOUND");
      const id = asId(randomUUID(), "goal");
      await tx.query(`INSERT INTO ls_practice.goals
        (id,workspace_id,case_id,audience_id,title_ciphertext,state,created_by_account_id,created_at)
        VALUES ($1,$2,$3,$4,$5,'active',$6,$7)`, [
        id, actor.workspaceId, input.caseId, input.audienceId,
        seal(input.title, goalAad(actor.workspaceId, id), this.config.keyring), actor.id, now,
      ]);
      await recordPracticeAction(tx, { requestId, now }, actor.workspaceId, actor.id, "practice_goal_created");
      return { id, workspaceId: actor.workspaceId, caseId: input.caseId, audienceId: input.audienceId, title: input.title, state: "active", createdAt: now.toISOString() };
    });
  }

  async list(actor: Actor, caseId: CaseId, audienceId: AudienceId): Promise<GoalView[]> {
    return this.store.transaction(async tx => {
      const current = await freshActor(tx, actor, this.clock.now());
      const audience = await loadAudience(tx, actor.workspaceId, caseId, audienceId);
      if (!audience) throw new AppError("NOT_FOUND");
      audienceAccess(current, await loadCase(tx, actor.workspaceId, caseId), await loadGuardians(tx, actor.workspaceId, caseId), audience);
      const rows = await tx.query<{ id: GoalId; titleCiphertext: string; state: "active" | "closed"; createdAt: Date }>(
        `SELECT id,title_ciphertext AS "titleCiphertext",state,created_at AS "createdAt"
         FROM ls_practice.goals WHERE workspace_id=$1 AND case_id=$2 AND audience_id=$3
         ORDER BY created_at,id LIMIT 100`, [actor.workspaceId, caseId, audienceId],
      );
      return rows.map(row => ({
        id: row.id, workspaceId: actor.workspaceId, caseId, audienceId,
        title: unseal(row.titleCiphertext, goalAad(actor.workspaceId, row.id), this.config.keyring),
        state: row.state, createdAt: row.createdAt.toISOString(),
      }));
    });
  }
}
