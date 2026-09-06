import { z } from "zod";
/** Non-sensitive vocabulary only; final I-003 ownership stays with LS-010. */
export const auditEventSchema = z.strictObject({
  eventId: z.uuid(), requestId: z.uuid(), workspaceId: z.uuid(), actorAccountId: z.uuid().nullable(),
  kind: z.enum(["access_denied", "session_revoked", "configuration_checked", "migration_applied"]),
  outcome: z.enum(["allowed", "denied", "failed"]),
  occurredAt: z.iso.datetime(),
});
export type AuditEvent = z.infer<typeof auditEventSchema>;
export interface AuditSink { write(event: AuditEvent): Promise<void>; }
export async function writeAudit(sink: AuditSink, input: unknown): Promise<void> {
  const result = auditEventSchema.safeParse(input);
  if (!result.success) throw new Error("INVALID_AUDIT_EVENT");
  // The private runtime implements durable delivery; no console or client payload sink.
  await sink.write(result.data);
}
