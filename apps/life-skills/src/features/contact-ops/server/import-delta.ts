import {canonical, requireThat} from "../core/validation.ts";
import {planImport, importedFollowUpDate, type ImportRow, type SheetSnapshot} from "./import-plan.ts";
import type {CrmProfile} from "./native-store.ts";

/** Owner-private reconciliation data, never an HTTP response or public receipt.
 * Planning does not import, link identities, fence writers or switch authority. */
export interface SourceDelta {
  previousRevision: string;
  nextRevision: string;
  previousSnapshotDigest: string;
  nextSnapshotDigest: string;
  rows: readonly {kind: "unchanged" | "changed" | "new"; before: ImportRow | null; after: ImportRow}[];
  missingLegacyIds: readonly string[];
  review: readonly {legacyId: string; reasons: readonly string[]}[];
  ready: boolean;
}

/** Stable legacy identity, not row position, relates the two complete snapshots.
 * A missing row is a conflict, never permission to delete a native person. */
export function planSourceDelta(previous: SheetSnapshot, next: SheetSnapshot, workspaceId: string, integrityKey: string): SourceDelta {
  requireThat(previous.fileId === next.fileId && previous.sheetId === next.sheetId, "DELTA_SOURCE_MISMATCH");
  requireThat(previous.headers.length === next.headers.length &&
    previous.headers.every(header => next.headers.includes(header)), "DELTA_SOURCE_COLUMNS_CHANGED");
  const before = planImport(previous, workspaceId, integrityKey), after = planImport(next, workspaceId, integrityKey);
  requireThat(before.canImport && after.canImport, "DELTA_SOURCE_NEEDS_REVIEW");
  requireThat(previous.revision !== next.revision || before.snapshotDigest === after.snapshotDigest, "DELTA_REVISION_REUSED");
  const prior = new Map(before.rows.map(row => [row.legacyId, row]));
  const nextIds = new Set(after.rows.map(row => row.legacyId));
  const missingLegacyIds = before.rows.filter(row => !nextIds.has(row.legacyId)).map(row => row.legacyId);
  const phones = new Map<string, string[]>(), emails = new Map<string, string[]>();
  for (const row of after.rows) {
    for (const [map, value] of [[phones, row.normalizedPhone], [emails, row.normalizedEmail]] as const) {
      if (value) map.set(value, [...(map.get(value) ?? []), row.legacyId]);
    }
  }
  const review: {legacyId: string; reasons: string[]}[] = [];
  const rows = after.rows.map(row => {
    const old = prior.get(row.legacyId) ?? null;
    const reasons = [...row.issues];
    // Match the native directory identity's z.string().max(120), preserving
    // empty names and exact source text for review instead of truncating it.
    if (row.protectedPayload.displayName.length > 120) reasons.push("DISPLAY_NAME_NEEDS_REVIEW");
    if ((row.normalizedPhone && phones.get(row.normalizedPhone)!.length > 1) ||
      (row.normalizedEmail && emails.get(row.normalizedEmail)!.length > 1)) reasons.push("SHARED_ENDPOINT");
    if (old && (old.normalizedEmail !== row.normalizedEmail || old.normalizedPhone !== row.normalizedPhone)) reasons.push("ENDPOINT_CHANGED");
    // Civil-date validation is the same strict source-native rule as first import.
    try { importedFollowUpDate(row); } catch { reasons.push("INVALID_FOLLOWUP_DATE"); }
    if (reasons.length) review.push({legacyId: row.legacyId, reasons});
    return {kind: !old ? "new" as const : old.rowDigest === row.rowDigest ? "unchanged" as const : "changed" as const,
      before: old, after: row};
  });
  return {previousRevision: previous.revision, nextRevision: next.revision,
    previousSnapshotDigest: before.snapshotDigest, nextSnapshotDigest: after.snapshotDigest,
    rows, missingLegacyIds, review, ready: !missingLegacyIds.length && !review.length};
}

type AdministrativeField = "stage" | "nextAction" | "followUpDate" | "notes";
const fields = ["stage", "nextAction", "followUpDate", "notes"] as const;
function sourceValue(row: ImportRow, name: string): string {
  return Object.entries(row.protectedPayload.sourceFields).find(([key]) => key.trim() === name)?.[1] ?? "";
}
function administrative(row: ImportRow): Pick<CrmProfile, AdministrativeField> {
  const value = {stage: row.protectedPayload.stageText.trim() || "new",
    nextAction: sourceValue(row, "Next action").trim() || null,
    followUpDate: importedFollowUpDate(row), notes: sourceValue(row, "General sales notes")};
  requireThat(value.stage.length <= 120 && (value.nextAction === null || value.nextAction.length <= 500) && value.notes.length <= 5000,
    "DELTA_PROFILE_FIELD_TOO_LONG");
  return value;
}

/** Three-way merge of administrative fields only. Preserve native changes when
 * Sheet is unchanged; competing edits require explicit review, never concatenate
 * or silently overwrite authored notes. Provider activity/opt-outs/access and
 * payment/booking truth are not editable by a Sheet delta. */
export function reconcileImportedProfile(before: ImportRow, after: ImportRow, current: CrmProfile):
  {profile: CrmProfile; conflicts: readonly AdministrativeField[]; changed: boolean} {
  requireThat(before.legacyId === after.legacyId && before.suggestedPersonId === after.suggestedPersonId &&
    current.personId === before.suggestedPersonId && current.legacyIds.includes(before.legacyId), "DELTA_IDENTITY_MISMATCH");
  requireThat(before.normalizedPhone === after.normalizedPhone && before.normalizedEmail === after.normalizedEmail,
    "DELTA_ENDPOINT_REQUIRES_REVIEW");
  const base = administrative(before), incoming = administrative(after);
  const profile = structuredClone(current), conflicts: AdministrativeField[] = [];
  for (const field of fields) {
    if (incoming[field] === base[field]) continue;
    if (current[field] !== base[field] && current[field] !== incoming[field]) { conflicts.push(field); continue; }
    // These four fields have a shared string-or-null read type; each source
    // value retains its field-specific invariant from administrative().
    Object.assign(profile, {[field]: incoming[field]});
  }
  // A conflicted row is not a partially applicable update.
  return conflicts.length ? {profile: structuredClone(current), conflicts, changed: false} :
    {profile, conflicts, changed: canonical(profile) !== canonical(current)};
}
