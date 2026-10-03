import { z } from "zod";
import { AppError } from "../../lib/errors.ts";
import { loadCase, loadGuardians } from "../cases/data.ts";
import { caseAccess, requirePractitioner } from "../cases/policy.ts";
import { freshActor } from "../identity/data.ts";
import type { IdentityStore } from "../identity/store.ts";
import type { Actor, CaseId, IdentityClock } from "../identity/types.ts";
import { consentHistoryCursorSchema, consentHistoryPageSchema, type ConsentHistoryKind, type ConsentHistoryPage } from "./consent-history.ts";

const pgTimestamp = z.string().min(1).max(64).regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?[+-]\d{2}(?::\d{2})?$/)
  .refine(value => z.iso.datetime({ offset: true }).safeParse(value.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00")).success);
const cursorSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("recording"), caseId: z.uuid(), version: z.number().int().positive(), id: z.uuid() }),
  z.strictObject({ kind: z.literal("disclosure"), caseId: z.uuid(), at: pgTimestamp, id: z.uuid() }),
]);
function decodeCursor(cursor: string | null, caseId: CaseId, kind: ConsentHistoryKind) {
  if (!cursor) return null;
  try {
    if (!consentHistoryCursorSchema.safeParse(cursor).success) throw new Error();
    const bytes = Buffer.from(cursor, "base64url");
    if (bytes.toString("base64url") !== cursor) throw new Error();
    const value = cursorSchema.parse(JSON.parse(bytes.toString("utf8")));
    if (value.caseId !== caseId || value.kind !== kind) throw new Error();
    return value;
  } catch { throw new AppError("INVALID_REQUEST"); }
}
const encode = (value: z.infer<typeof cursorSchema>) => Buffer.from(JSON.stringify(value)).toString("base64url");
type RecordingRow = { id: string; version: number; signedByAccountId: string; signedAt: Date; withdrawnAt: Date | null; authorityState: "checked" | "needs_review" | "restricted"; recordingAllowed: boolean; transcriptionAllowed: boolean; aiProcessingAllowed: boolean; childInformed: boolean; policyVersion: string; isCurrent: boolean };
type DisclosureRow = { id: string; sessionId: string | null; channel: "phone" | "meeting" | "secure_message"; authorizedByAccountId: string; recordedByPractitionerId: string; childDiscussionRecorded: boolean; authorizedAt: Date; orderAt: string; expiresAt: Date; revokedAt: Date | null; usedAt: Date | null };

/** Existing metadata only: no evidence/recipient/topic/clinical ciphertext is selected or decrypted. */
export async function readCaseConsentHistory(store: IdentityStore, clock: IdentityClock, actor: Actor, caseId: CaseId, kind: ConsentHistoryKind, cursor: string | null): Promise<ConsentHistoryPage> {
  const before = decodeCursor(cursor, caseId, kind), now = clock.now();
  return store.transaction(async tx => {
    await tx.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");
    const current = await freshActor(tx, actor, now);
    requirePractitioner(current);
    caseAccess(current, await loadCase(tx, actor.workspaceId, caseId), await loadGuardians(tx, actor.workspaceId, caseId), "read");
    let items: ConsentHistoryPage["items"], nextCursor: string | null = null, hasMore: boolean;
    if (kind === "recording") {
      const rows = await tx.query<RecordingRow>(`SELECT c.id,c.version,c.signed_by_account_id AS "signedByAccountId",c.signed_at AS "signedAt",c.withdrawn_at AS "withdrawnAt",
        c.authority_state AS "authorityState",c.recording_allowed AS "recordingAllowed",c.transcription_allowed AS "transcriptionAllowed",c.ai_processing_allowed AS "aiProcessingAllowed",
        c.child_informed AS "childInformed",c.policy_version AS "policyVersion",
        NOT EXISTS(SELECT 1 FROM ls_sessions.recording_consents newer WHERE newer.workspace_id=c.workspace_id AND newer.case_id=c.case_id AND newer.version>c.version) AS "isCurrent"
        FROM ls_sessions.recording_consents c WHERE c.workspace_id=$1 AND c.case_id=$2
        AND ($3::int IS NULL OR (c.version,c.id)<($3::int,$4::uuid)) ORDER BY c.version DESC,c.id DESC LIMIT 51`,
        [actor.workspaceId, caseId, before?.kind === "recording" ? before.version : null, before?.id ?? null]);
      hasMore = rows.length > 50;
      const page = rows.slice(0, 50), last = page.at(-1);
      if (hasMore && last) nextCursor = encode({ kind, caseId, version: last.version, id: last.id });
      items = page.map(row => ({ ...row, kind, signedAt: row.signedAt.toISOString(), withdrawnAt: row.withdrawnAt?.toISOString() ?? null }));
    } else {
      const rows = await tx.query<DisclosureRow>(`SELECT id,session_id AS "sessionId",channel,authorized_by_account_id AS "authorizedByAccountId",recorded_by_practitioner_id AS "recordedByPractitionerId",
        child_discussion_recorded AS "childDiscussionRecorded",authorized_at AS "authorizedAt",authorized_at::text AS "orderAt",expires_at AS "expiresAt",revoked_at AS "revokedAt",used_at AS "usedAt"
        FROM ls_sessions.disclosure_authorizations WHERE workspace_id=$1 AND case_id=$2
        AND ($3::timestamptz IS NULL OR (authorized_at,id)<($3::timestamptz,$4::uuid)) ORDER BY authorized_at DESC,id DESC LIMIT 51`,
        [actor.workspaceId, caseId, before?.kind === "disclosure" ? before.at : null, before?.id ?? null]);
      hasMore = rows.length > 50;
      const page = rows.slice(0, 50), last = page.at(-1);
      if (hasMore && last) nextCursor = encode({ kind, caseId, at: last.orderAt, id: last.id });
      items = page.map(row => ({ kind, id: row.id, sessionId: row.sessionId, channel: row.channel, authorizedByAccountId: row.authorizedByAccountId, recordedByPractitionerId: row.recordedByPractitionerId, childDiscussionRecorded: row.childDiscussionRecorded, authorizedAt: row.authorizedAt.toISOString(), expiresAt: row.expiresAt.toISOString(), revokedAt: row.revokedAt?.toISOString() ?? null, usedAt: row.usedAt?.toISOString() ?? null }));
    }
    const result = consentHistoryPageSchema.safeParse({ caseId, kind, observedAt: now.toISOString(), items, hasMore, nextCursor });
    if (!result.success) throw new AppError("UNAVAILABLE");
    return result.data;
  });
}
