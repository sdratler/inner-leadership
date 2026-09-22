import type { CaseContext, Principal, RecordingConsent, DisclosureRecord } from "./types.ts";
export class WorkflowError extends Error {
    readonly code: string;
    constructor(code: string) { super(code); this.name = "WorkflowError"; this.code = code; }
}
export function invariant(condition: unknown, code: string): asserts condition {
    if (!condition)
        throw new WorkflowError(code);
}
export function validDate(value: unknown): value is string {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
        return false;
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function validIso(value: unknown): value is string {
    return typeof value === "string" && validDate(value.slice(0, 10)) && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.test(value) && Number.isFinite(Date.parse(value));
}
export function validTimezone(value: unknown): value is string {
    if (typeof value !== "string" || value.length > 100)
        return false;
    try {
        new Intl.DateTimeFormat("en", { timeZone: value }).format(0);
        return true;
    }
    catch {
        return false;
    }
}
export function nonempty(value: unknown, max = 200): value is string {
    return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}
export function assertCasePrincipal(actor: Principal, context: CaseContext): void {
    invariant(actor.active && actor.workspaceId === context.workspaceId, "NOT_FOUND");
    if (actor.role === "practitioner") {
        invariant(actor.accountId === context.practitionerAccountId, "NOT_FOUND");
        return;
    }
    const membership = context.members.find(m => m.accountId === actor.accountId && m.personId === actor.personId && m.role === actor.role && m.active);
    invariant(membership, "NOT_FOUND");
    if (context.mode === "adult")
        invariant(actor.role === "adult_client" && actor.personId === context.clientPersonId, "NOT_FOUND");
    else if (actor.role === "child")
        invariant(context.mode === "minor_own_device" && actor.personId === context.clientPersonId, "NOT_FOUND");
    else
        invariant(actor.role === "parent", "NOT_FOUND");
}
export function assertPractitioner(actor: Principal, context: CaseContext, write = false): void {
    assertCasePrincipal(actor, context);
    invariant(actor.role === "practitioner", "NOT_FOUND");
    if (write)
        invariant(context.active, "CASE_NOT_ACTIVE");
}
/** Model of permissions for the new workflow, not a replacement for existing identity middleware. */
export function canReadPrivateSession(actor: Principal, context: CaseContext): boolean {
    try {
        assertPractitioner(actor, context);
        return true;
    }
    catch {
        return false;
    }
}
export function assertRecordingConsent(consent: RecordingConsent, context: CaseContext, recordedAt: string, now: string): void {
    invariant(context.active && consent.workspaceId === context.workspaceId && consent.caseId === context.caseId, "CONSENT_SCOPE");
    invariant(validIso(recordedAt) && validIso(now) && validIso(consent.signedAt), "CONSENT_TIME");
    invariant(Date.parse(consent.signedAt) <= Date.parse(recordedAt) && Date.parse(recordedAt) <= Date.parse(now), "CONSENT_TIME");
    invariant(consent.authorityChecked && consent.restriction === "none_recorded", "CONSENT_REVIEW_REQUIRED");
    invariant(consent.recording && consent.transcription && consent.aiProcessing && consent.withdrawnAt === null, "RECORDING_NOT_AUTHORIZED");
    invariant(Number.isInteger(consent.version) && consent.version > 0, "CONSENT_VERSION");
    if (context.mode !== "adult")
        invariant(consent.childInformed, "CHILD_NOT_INFORMED");
    const signer = context.members.find(m => m.accountId === consent.signedByAccountId && m.active);
    invariant(signer && (context.mode === "adult" ? signer.role === "adult_client" && signer.personId === context.clientPersonId : signer.role === "parent"), "CONSENT_SIGNER");
    // A checked authority record is not legal certification. Known disputes/order restrictions require review.
}
export function routineRecipients(context: CaseContext): readonly string[] {
    return [...new Set(context.members.filter(m => m.active && m.routineRecap && (context.mode === "adult" ? m.role === "adult_client" && m.personId === context.clientPersonId :
            m.role === "parent" || (context.mode === "minor_own_device" && m.role === "child" && m.personId === context.clientPersonId))).map(m => m.accountId))].sort();
}
export function validateDisclosure(record: DisclosureRecord, context: CaseContext, now: string): void {
    invariant(context.active && record.workspaceId === context.workspaceId && record.caseId === context.caseId, "DISCLOSURE_SCOPE");
    invariant(["phone", "meeting", "secure_message"].includes(record.channel) && nonempty(record.id), "DISCLOSURE_CHANNEL");
    invariant(nonempty(record.recipient) && nonempty(record.topic, 800) && nonempty(record.purpose, 500) && nonempty(record.authorityBasis, 500), "DISCLOSURE_INCOMPLETE");
    invariant(validIso(record.authorizedAt) && validIso(record.expiresAt) && validIso(now), "DISCLOSURE_TIME");
    invariant(Date.parse(record.authorizedAt) <= Date.parse(now) && Date.parse(now) < Date.parse(record.expiresAt), "DISCLOSURE_EXPIRED");
    invariant(record.revokedAt === null && record.usedAt === null, "DISCLOSURE_NOT_ACTIVE");
    invariant(context.members.some(m => m.accountId === record.authorizedByAccountId && m.active), "DISCLOSURE_SIGNER");
    // No automatic external disclosure. The practitioner records the actual scoped conversation separately.
}
