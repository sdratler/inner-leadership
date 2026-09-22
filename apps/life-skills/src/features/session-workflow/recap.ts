import { createHash } from "node:crypto";
import type { AttendanceSnapshot, CaseContext, Principal, RoutineRecap, SharedRecapRecord, SharedPractice, NextAppointmentSnapshot } from "./types.ts";
import { assertPractitioner, assertCasePrincipal, invariant, nonempty, routineRecipients, validDate, validTimezone, validIso } from "./policy.ts";
export const FOCUS = ["responsibility", "communication", "regulation", "values", "planning", "relationships", "problem_solving"] as const;
const exactKeys = (value: object, keys: readonly string[], code: string) => invariant(Object.keys(value).sort().join() === [...keys].sort().join(), code);
const clockTime = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
export function validateRecap(value: RoutineRecap): void {
    invariant(value.schemaVersion === 1 && Number.isInteger(value.version) && value.version > 0 && ["en", "he"].includes(value.locale), "RECAP_VERSION");
    invariant(Object.keys(value).sort().join() === ["schemaVersion", "sessionId", "caseId", "version", "locale", "attendance", "focus", "practices", "nextStep", "nextAppointment"].sort().join(), "RECAP_FIELDS");
    invariant(Array.isArray(value.focus) && value.focus.length <= 3 && new Set(value.focus).size === value.focus.length && value.focus.every(v => FOCUS.includes(v)), "RECAP_FOCUS");
    invariant(typeof value.nextStep === "string" && value.nextStep.length <= 300, "RECAP_NEXT_STEP");
    exactKeys(value.attendance, ["appointmentId", "state", "source", "revision", "startsAt", "arrivedAt"], "RECAP_ATTENDANCE_FIELDS");
    invariant(value.attendance.source === "appointment_record" && validIso(value.attendance.startsAt) && (value.attendance.arrivedAt === null || validIso(value.attendance.arrivedAt)), "RECAP_ATTENDANCE_SOURCE");
    invariant(nonempty(value.caseId) && nonempty(value.sessionId) && nonempty(value.attendance.appointmentId) && Number.isInteger(value.attendance.revision) && value.attendance.revision >= 0, "RECAP_IDENTITY");
    invariant(["present", "late", "no_show", "canceled", "unrecorded"].includes(value.attendance.state), "RECAP_ATTENDANCE");
    invariant(Array.isArray(value.practices) && value.practices.length <= 20, "RECAP_PRACTICES");
    const ids = new Set<string>();
    for (const p of value.practices) {
        exactKeys(p, ["assignmentId", "version", "responsibilityId", "audienceAccountIds", "participant", "instructions", "localTime", "timezone", "startsOn", "endsOn"], "RECAP_PRACTICE_FIELDS");
        invariant(nonempty(p.assignmentId) && nonempty(p.responsibilityId) && Number.isInteger(p.version) && p.version > 0 && !ids.has(p.responsibilityId), "RECAP_ASSIGNMENT");
        ids.add(p.responsibilityId);
        invariant(nonempty(p.instructions, 500) && clockTime.test(p.localTime) && validTimezone(p.timezone), "RECAP_PRACTICE_TIME");
        invariant(["client", "parent"].includes(p.participant) && Array.isArray(p.audienceAccountIds) && p.audienceAccountIds.length > 0 && p.audienceAccountIds.every((id: unknown) => nonempty(id)) && new Set(p.audienceAccountIds).size === p.audienceAccountIds.length, "RECAP_PRACTICE_AUDIENCE");
        invariant(validDate(p.startsOn) && validDate(p.endsOn) && p.startsOn <= p.endsOn, "RECAP_PRACTICE_DATES");
    }
    if (value.nextAppointment) {
        exactKeys(value.nextAppointment, ["id", "startsAt", "endsAt", "timezone", "source"], "RECAP_NEXT_APPOINTMENT_FIELDS");
        invariant(value.nextAppointment.source === "calendar" && nonempty(value.nextAppointment.id) && validTimezone(value.nextAppointment.timezone) && validIso(value.nextAppointment.startsAt) && validIso(value.nextAppointment.endsAt) && Date.parse(value.nextAppointment.startsAt) < Date.parse(value.nextAppointment.endsAt), "RECAP_NEXT_APPOINTMENT");
    }
}
/** Explicit whitelist: NEVER spread a transcript, private session object or AI analysis into this. */
export function recapFromReviewedFields(input: {
    sessionId: string;
    caseId: string;
    version: number;
    locale: "en" | "he";
    attendance: AttendanceSnapshot;
    focus: RoutineRecap["focus"];
    approvedPractices: readonly SharedPractice[];
    reviewedNextStep: string;
    nextAppointment: NextAppointmentSnapshot | null;
}): RoutineRecap {
    const v: RoutineRecap = {
        schemaVersion: 1, sessionId: input.sessionId, caseId: input.caseId, version: input.version, locale: input.locale,
        attendance: { appointmentId: input.attendance.appointmentId, state: input.attendance.state, source: "appointment_record", revision: input.attendance.revision, startsAt: input.attendance.startsAt, arrivedAt: input.attendance.arrivedAt },
        focus: [...input.focus],
        practices: input.approvedPractices.map(p => ({ assignmentId: p.assignmentId, version: p.version, responsibilityId: p.responsibilityId, audienceAccountIds: [...p.audienceAccountIds], participant: p.participant, instructions: p.instructions, localTime: p.localTime, timezone: p.timezone, startsOn: p.startsOn, endsOn: p.endsOn })),
        nextStep: input.reviewedNextStep.trim(),
        nextAppointment: input.nextAppointment ? { id: input.nextAppointment.id, startsAt: input.nextAppointment.startsAt, endsAt: input.nextAppointment.endsAt, timezone: input.nextAppointment.timezone, source: "calendar" } : null,
    };
    validateRecap(v);
    return v;
}
export function attendanceText(snapshot: AttendanceSnapshot, locale: "en" | "he"): string {
    const he = locale === "he";
    if (snapshot.state === "unrecorded")
        return he ? "הנוכחות טרם נרשמה" : "Attendance not yet recorded";
    if (snapshot.state === "no_show")
        return he ? "לא הגיע/ה למפגש" : "Did not attend";
    if (snapshot.state === "canceled")
        return he ? "המפגש בוטל" : "Session canceled";
    if (snapshot.state === "late")
        return he ? "הגיע/ה באיחור" : "Attended; arrival recorded as late";
    if (snapshot.arrivedAt && Date.parse(snapshot.arrivedAt) <= Date.parse(snapshot.startsAt))
        return he ? "הגיע/ה בזמן" : "Attended on time";
    return he ? "השתתף/ה במפגש" : "Attended the session";
}
export function shareDigest(recap: RoutineRecap, recipientIds: readonly string[]): string {
    validateRecap(recap);
    return createHash("sha256").update(JSON.stringify({ recap, recipients: [...new Set(recipientIds)].sort() })).digest("hex");
}
export interface ShareReceipt {
    idempotencyKey: string;
    actorAccountId: string;
    digest: string;
    record: SharedRecapRecord;
}
/** Implementation must serialize session writes and commit publication + outbox + receipt atomically. */
export interface ShareTransaction {
    freshContext(): Promise<{
        actor: Principal;
        context: CaseContext;
    }>;
    currentRecap(sessionId: string): Promise<RoutineRecap>;
    receipt(key: string): Promise<ShareReceipt | null>;
    savePublication(record: SharedRecapRecord, receipt: ShareReceipt): Promise<void>;
}
export interface ShareRepository {
    transaction<T>(sessionId: string, fn: (tx: ShareTransaction) => Promise<T>): Promise<T>;
}
export async function shareUpdate(repository: ShareRepository, input: {
    sessionId: string;
    idempotencyKey: string;
    expectedVersion: number;
    expectedDigest: string;
    recipientAccountIds: readonly string[];
    publicationId: string;
    now: string;
}): Promise<SharedRecapRecord> {
    invariant(nonempty(input.sessionId) && nonempty(input.publicationId) && nonempty(input.idempotencyKey) && validIso(input.now) && Number.isInteger(input.expectedVersion) && input.expectedVersion > 0 && /^[a-f0-9]{64}$/.test(input.expectedDigest), "SHARE_REQUEST");
    return repository.transaction(input.sessionId, async (tx) => {
        const { actor, context } = await tx.freshContext();
        assertPractitioner(actor, context, true);
        const allowed = routineRecipients(context), recipients = [...new Set(input.recipientAccountIds)].sort();
        invariant(recipients.length > 0 && recipients.every(id => allowed.includes(id)), "SHARE_AUDIENCE");
        const previous = await tx.receipt(input.idempotencyKey);
        if (previous) {
            invariant(previous.record.publicationVersion === input.expectedVersion && previous.actorAccountId === actor.accountId && previous.record.sessionId === input.sessionId && previous.record.caseId === context.caseId && previous.record.workspaceId === context.workspaceId && previous.digest === input.expectedDigest && previous.record.recipientAccountIds.join() === recipients.join(), "IDEMPOTENCY_CONFLICT");
            return previous.record;
        }
        const recap = await tx.currentRecap(input.sessionId);
        invariant(recap.sessionId === input.sessionId && recap.caseId === context.caseId, "NOT_FOUND");
        invariant(recap.version === input.expectedVersion && shareDigest(recap, recipients) === input.expectedDigest, "STALE_RECAP");
        // Same routine recap goes to selected child + parents; do not expose a private responsibility accidentally.
        invariant(recap.practices.every(p => recipients.every(id => p.audienceAccountIds.includes(id))), "RECAP_RESPONSIBILITY_NOT_SHARED_WITH_ALL");
        const record: SharedRecapRecord = { id: input.publicationId, workspaceId: context.workspaceId, caseId: context.caseId, sessionId: input.sessionId, recap: structuredClone(recap), recipientAccountIds: recipients, contentDigest: input.expectedDigest, sharedAt: input.now, sharedByAccountId: actor.accountId, publicationVersion: recap.version };
        await tx.savePublication(record, { idempotencyKey: input.idempotencyKey, actorAccountId: actor.accountId, digest: input.expectedDigest, record });
        return record;
    });
}
export function readSharedRecap(actor: Principal, context: CaseContext, record: SharedRecapRecord): RoutineRecap {
    assertCasePrincipal(actor, context);
    invariant(record.caseId === context.caseId && record.workspaceId === context.workspaceId, "NOT_FOUND");
    if (actor.role !== "practitioner")
        invariant(routineRecipients(context).includes(actor.accountId) && record.recipientAccountIds.includes(actor.accountId), "NOT_FOUND");
    validateRecap(record.recap);
    return structuredClone(record.recap);
}
