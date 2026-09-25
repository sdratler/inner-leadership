import { normalizePhone, normalizeEmail } from "../core/contact-resolution.js";
import { requireThat, canonical } from "../core/validation.js";
import { privateDigest, stableUuid } from "./digests.js";
export interface SheetSnapshot {
    fileId: string;
    tab: string;
    revision: string;
    complete: boolean;
    headers: readonly string[];
    rows: readonly (readonly string[])[];
}
export interface ImportRow {
    legacyId: string;
    suggestedPersonId: string;
    normalizedPhone: string | null;
    normalizedEmail: string | null;
    sourceRow: number;
    rowDigest: string;
    issues: readonly string[];
    /** Sensitive owner-only payload. Encrypt before persistence; exclude from Git and public evidence. */
    protectedPayload: {
        displayName: string;
        language: string;
        stageText: string;
        sourceFields: Record<string, string>;
    };
    paymentVerified: false;
}
export interface ImportPlan {
    source: {
        fileId: string;
        tab: string;
        revision: string;
    };
    snapshotDigest: string;
    rows: readonly ImportRow[];
    blankRows: number;
    conflicts: readonly {
        sourceRow: number;
        code: string;
    }[];
    canImport: boolean;
}
const required = ["Lead ID", "Parent/adult name", "Phone", "Email", "Pipeline stage"];
/** A planner, not an importer. No network/database operations or consent/payment invention. */
export function planImport(s: SheetSnapshot, workspaceId: string, integrityKey: string): ImportPlan {
    requireThat(s.complete && Boolean(s.fileId && s.tab && s.revision && workspaceId), "INCOMPLETE_SNAPSHOT");
    requireThat(s.rows.length <= 100000, "SNAPSHOT_BOUND");
    const h = s.headers.map(x => x.trim());
    requireThat(h.length > 0 && new Set(h).size === h.length && h.every(Boolean), "AMBIGUOUS_HEADERS");
    for (const k of required)
        requireThat(h.includes(k), "MISSING_HEADER:" + k);
    const out: ImportRow[] = [], conflicts: {
        sourceRow: number;
        code: string;
    }[] = [], ids = new Map<string, string>();
    let blankRows = 0;
    s.rows.forEach((row, index) => {
        const sourceRow = index + 2;
        requireThat(row.length <= h.length, "UNMAPPED_EXTRA_CELLS");
        if (row.every(v => !v.trim())) {
            blankRows++;
            return;
        }
        const fields = Object.fromEntries(s.headers.map((key, i) => [key, row[i] ?? ""]));
        const field = (name: string) => row[h.indexOf(name)] ?? "";
        const id = field("Lead ID").trim();
        if (!/^LS-(?:LEAD|WAPI)-[A-Za-z0-9_-]+$/.test(id)) {
            conflicts.push({ sourceRow, code: "MISSING_OR_INVALID_LEGACY_ID" });
            return;
        }
        const rd = privateDigest(fields, integrityKey), prior = ids.get(id);
        if (prior) {
            conflicts.push({ sourceRow, code: prior === rd ? "DUPLICATE_LEGACY_ID" : "CONFLICTING_LEGACY_ID" });
            return;
        }
        ids.set(id, rd);
        const phoneText = field("Phone"), emailText = field("Email");
        const phone = phoneText.trim() ? normalizePhone(phoneText) : null, email = emailText.trim() ? normalizeEmail(emailText) : null;
        const issues: string[] = [];
        if (phoneText.trim() && !phone)
            issues.push("PHONE_NEEDS_REVIEW");
        if (emailText.trim() && !email)
            issues.push("EMAIL_NEEDS_REVIEW");
        if (!phone && !email)
            issues.push("NO_ROUTABLE_ENDPOINT");
        out.push({ legacyId: id, suggestedPersonId: stableUuid(workspaceId + ":" + s.fileId + ":" + s.tab, id), normalizedPhone: phone, normalizedEmail: email, sourceRow, rowDigest: rd, issues,
            protectedPayload: { displayName: field("Parent/adult name"), language: h.includes("Language") ? field("Language") : "", stageText: field("Pipeline stage"), sourceFields: fields }, paymentVerified: false });
    });
    return { source: { fileId: s.fileId, tab: s.tab, revision: s.revision }, snapshotDigest: privateDigest({ headers: s.headers, rows: s.rows }, integrityKey), rows: out, blankRows, conflicts, canImport: conflicts.length === 0 };
}
export function importSummary(p: ImportPlan) { return { source: p.source, snapshotDigest: p.snapshotDigest, rowCount: p.rows.length, blankRows: p.blankRows, conflicts: p.conflicts, issueCount: p.rows.reduce((n, r) => n + r.issues.length, 0), canImport: p.canImport }; }
/** Header/key fidelity, not just a matching count, is required for reconciliation. */
export function sameProtectedRow(a: ImportRow, b: ImportRow): boolean { return a.legacyId === b.legacyId && a.rowDigest === b.rowDigest && canonical(a.protectedPayload) === canonical(b.protectedPayload); }
