import { createHash } from "node:crypto";
import type { CaseContext, Principal } from "../session-workflow/types.ts";
import { assertCasePrincipal, invariant, nonempty, validIso } from "../session-workflow/policy.ts";
import type { CheckIn, CheckInState, PracticeOccurrence, Responsibility } from "./contracts.ts";
export const CHECKIN_STATES: readonly CheckInState[] = ["done", "partly_done", "not_done", "rescheduled", "not_applicable"];
export function authorizeCheckIn(actor: Principal, context: CaseContext, r: Responsibility, assisted: "together" | "parent_report" | null): CheckIn["authorship"] {
    assertCasePrincipal(actor, context);
    invariant(context.active && r.state === "published" && r.caseId === context.caseId && r.workspaceId === context.workspaceId && r.audienceAccountIds.includes(actor.accountId), "NOT_FOUND");
    if (r.participant === "client" && actor.role === "parent") {
        invariant(r.subjectPersonId === context.clientPersonId && r.assistedByParentAccountIds.includes(actor.accountId) && assisted !== null, "PARENT_ASSISTANCE_NOT_AUTHORIZED");
        return assisted === "together" ? "parent_assisted_child" : "parent_reporting_child";
    }
    invariant(assisted === null && r.assigneeAccountIds.includes(actor.accountId) && (r.participant === "parent" ? actor.role === "parent" : r.subjectPersonId === actor.personId && (actor.role === "child" || actor.role === "adult_client")), "CHECKIN_NOT_ASSIGNED");
    return "self";
}
export interface CheckInRequest {
    id: string;
    idempotencyKey: string;
    occurrenceId: string;
    expectedRevision: number;
    state: CheckInState;
    note: string;
    assisted: "together" | "parent_report" | null;
    now: string;
}
export interface CheckInReceipt {
    digest: string;
    record: CheckIn;
}
export interface CheckInTransaction {
    freshFacts(): Promise<{
        actor: Principal;
        context: CaseContext;
        responsibility: Responsibility;
        occurrence: PracticeOccurrence;
        current: CheckIn | null;
    }>;
    receipt(key: string): Promise<CheckInReceipt | null>;
    save(record: CheckIn, key: string, digest: string): Promise<void>;
}
export interface CheckInRepository {
    transaction<T>(occurrenceId: string, fn: (tx: CheckInTransaction) => Promise<T>): Promise<T>;
}
/** Receipt+completion save is atomic. Reminder receivers are NOT automatically allowed to submit. */
export async function saveCheckIn(repository: CheckInRepository, input: CheckInRequest): Promise<CheckIn> {
    invariant(nonempty(input.id) && nonempty(input.idempotencyKey) && validIso(input.now) && CHECKIN_STATES.includes(input.state) && typeof input.note === "string" && input.note.length <= 2000 && Number.isInteger(input.expectedRevision) && input.expectedRevision >= 0, "CHECKIN_REQUEST");
    return repository.transaction(input.occurrenceId, async (tx) => {
        const { actor, context, responsibility: r, occurrence: o, current } = await tx.freshFacts();
        const authorship = authorizeCheckIn(actor, context, r, input.assisted);
        invariant(o.id === input.occurrenceId && o.caseId === context.caseId && o.workspaceId === context.workspaceId && o.responsibilityId === r.id && o.responsibilityVersion === r.version, "STALE_OCCURRENCE");
        const digest = createHash("sha256").update(JSON.stringify([actor.accountId, context.workspaceId, context.caseId, o.id, r.version, input.state, input.note.trim(), authorship, input.expectedRevision])).digest("hex");
        const prior = await tx.receipt(input.idempotencyKey);
        if (prior) {
            invariant(prior.digest === digest, "IDEMPOTENCY_CONFLICT");
            return prior.record;
        }
        invariant((current?.revision ?? 0) === input.expectedRevision, "CHECKIN_CONFLICT_REFRESH");
        const record: CheckIn = { id: input.id, occurrenceId: o.id, responsibilityId: r.id, responsibilityVersion: r.version, workspaceId: context.workspaceId, caseId: context.caseId, authenticatedAccountId: actor.accountId, subjectPersonId: r.subjectPersonId, authorship, state: input.state, note: input.note.trim(), recordedAt: input.now, revision: input.expectedRevision + 1, replacesId: current?.id ?? null };
        await tx.save(record, input.idempotencyKey, digest);
        return record;
    });
}
export function latestCompletion(records: readonly CheckIn[], r: Responsibility, occurrenceId: string): "unreported" | "done" | "partial_or_other" {
    const byActor = new Map<string, CheckIn>();
    for (const x of records) {
        invariant(x.workspaceId === r.workspaceId && x.caseId === r.caseId && x.responsibilityId === r.id, "CHECKIN_SCOPE");
        if (x.occurrenceId !== occurrenceId)
            continue;
        const old = byActor.get(x.authenticatedAccountId);
        if (!old || x.revision > old.revision)
            byActor.set(x.authenticatedAccountId, x);
    }
    if (!byActor.size)
        return "unreported";
    if (r.completionMode === "each_assignee")
        return r.assigneeAccountIds.length > 0 && r.assigneeAccountIds.every(id => byActor.get(id)?.state === "done") ? "done" : "partial_or_other";
    // In any-assignee mode the repository serializes one latest occurrence state; a correction can undo Done.
    const latest = [...byActor.values()].sort((a, b) => b.revision - a.revision)[0]!;
    return latest.state === "done" ? "done" : "partial_or_other";
}
