import { requireThat } from "./validation.js";
export type Phase = "sheet_active" | "shadow_ready" | "frozen" | "native_active" | "retired" | "rollback_prepared";
export interface CutoverState {
    phase: Phase;
    epoch: number;
    batchId: string | null;
    nativeWritesSinceSwitch: number;
}
export interface CutoverProof {
    backupRestored: boolean;
    snapshotMatched: boolean;
    imported: boolean;
    rowContentMatched: boolean;
    allRowsAccounted: boolean;
    identityConflicts: number;
    paymentsReconciled: boolean;
    writersFenced: boolean;
    inboundDurable: boolean;
    deltaDrained: boolean;
    consumersRepointed: boolean;
    sheetConsumersRepointed: boolean;
    nativeBrowserVerified: boolean;
    oldSchedulesDisabled: boolean;
    sourceFrozen: boolean;
    restorePlanReady: boolean;
}
export type CutoverAction = "prepare" | "freeze" | "switch_native" | "retire_sheet" | "prepare_rollback" | "finish_rollback";
/** Pure gate only. The adapter must hold a database lock and commit epoch/writer changes atomically. */
export function advanceCutover(s: CutoverState, action: CutoverAction, proof: CutoverProof, batchId: string): CutoverState {
    requireThat(Number.isSafeInteger(s.epoch) && s.epoch >= 0, "INVALID_EPOCH");
    requireThat(Boolean(batchId), "MISSING_BATCH");
    if (s.batchId)
        requireThat(s.batchId === batchId, "BATCH_MISMATCH");
    const to = (phase: Phase): CutoverState => ({ ...s, phase, epoch: s.epoch + 1, batchId });
    if (action === "prepare") {
        requireThat(s.phase === "sheet_active", "WRONG_PHASE");
        requireThat(proof.backupRestored && proof.snapshotMatched && proof.imported && proof.rowContentMatched && proof.allRowsAccounted, "IMPORT_NOT_RECONCILED");
        requireThat(proof.identityConflicts === 0 && proof.paymentsReconciled, "UNRESOLVED_IMPORT");
        return to("shadow_ready");
    }
    if (action === "freeze") {
        requireThat(s.phase === "shadow_ready", "WRONG_PHASE");
        requireThat(proof.writersFenced && proof.sourceFrozen && proof.inboundDurable && proof.restorePlanReady, "UNSAFE_FREEZE");
        return to("frozen");
    }
    if (action === "switch_native") {
        requireThat(s.phase === "frozen", "WRONG_PHASE");
        requireThat(proof.sourceFrozen && proof.writersFenced && proof.inboundDurable && proof.deltaDrained && proof.allRowsAccounted && proof.rowContentMatched && proof.identityConflicts === 0 && proof.paymentsReconciled && proof.consumersRepointed, "UNSAFE_CUTOVER");
        return to("native_active");
    }
    if (action === "retire_sheet") {
        requireThat(s.phase === "native_active", "WRONG_PHASE");
        requireThat(proof.nativeBrowserVerified && proof.oldSchedulesDisabled && proof.consumersRepointed && proof.deltaDrained && proof.backupRestored && proof.writersFenced && proof.sourceFrozen, "UNSAFE_RETIREMENT");
        return to("retired");
    }
    if (action === "prepare_rollback") {
        requireThat(s.phase === "native_active" || s.phase === "frozen" || s.phase === "shadow_ready", "WRONG_PHASE");
        requireThat(proof.writersFenced && proof.inboundDurable, "UNSAFE_ROLLBACK");
        return to("rollback_prepared");
    }
    requireThat(s.phase === "rollback_prepared", "WRONG_PHASE");
    // Native writes require an explicit delta export/reconciliation; never flip an old flag back.
    requireThat(proof.writersFenced && proof.deltaDrained && proof.rowContentMatched && proof.allRowsAccounted && proof.paymentsReconciled && proof.sheetConsumersRepointed, "ROLLBACK_DELTA_UNVERIFIED");
    return { ...to("sheet_active"), nativeWritesSinceSwitch: 0, batchId: null };
}
export function writeDestination(phase: Phase): "sheet" | "native" | "durable_queue_only" {
    return phase === "sheet_active" || phase === "shadow_ready" ? "sheet" : phase === "native_active" || phase === "retired" ? "native" : "durable_queue_only";
}
export interface WorkbookDependency {
    name: string;
    kind: "crm" | "marketing" | "reporting" | "unknown";
    activeReader: boolean;
    activeWriter: boolean;
    preserved: boolean;
}
export function canTrashWholeWorkbook(deps: readonly WorkbookDependency[], explicitDeletionReceipt: boolean): boolean {
    return explicitDeletionReceipt && deps.length > 0 && deps.every(d => !d.activeReader && !d.activeWriter && d.preserved && d.kind !== "unknown");
}
