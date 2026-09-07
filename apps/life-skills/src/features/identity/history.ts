import { randomUUID } from "node:crypto";
import type { AuditEvent, AuditSink } from "../../lib/audit.ts";
import type { IdentityStore, SqlSession } from "./store.ts";
import type { RequestContext, WorkspaceId, AccountId } from "./types.ts";
export const identityActions = ["workspace_bootstrapped", "case_created", "case_status_changed", "engagement_created", "invite_queued", "invite_accepted", "reset_queued", "password_reset", "login_succeeded", "session_revoked", "guardian_revoked", "account_revoked", "audience_created", "preferences_changed", "contact_change_queued", "contact_verified", "access_denied"] as const;
export type IdentityAction = (typeof identityActions)[number];
/** Feature history is not a replacement/redefinition of the baseline AuditEvent vocabulary. */
export async function recordAction(tx: SqlSession, context: RequestContext, workspaceId: WorkspaceId, actor: AccountId | null, action: IdentityAction): Promise<void> {
  await tx.query("INSERT INTO ls_identity.action_history (id,workspace_id,actor_account_id,request_id,action,occurred_at) VALUES ($1,$2,$3,$4,$5,$6)", [randomUUID(), workspaceId, actor, context.requestId, action, context.now]);
}
export function durableAuditSink(store: IdentityStore): AuditSink {
  return { async write(event: AuditEvent) {
    await store.transaction(tx => tx.query("INSERT INTO ls_identity.foundation_audit (event_id,workspace_id,actor_account_id,request_id,kind,outcome,occurred_at) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (event_id) DO NOTHING", [event.eventId,event.workspaceId,event.actorAccountId,event.requestId,event.kind,event.outcome,event.occurredAt]).then(() => undefined));
  } };
}
