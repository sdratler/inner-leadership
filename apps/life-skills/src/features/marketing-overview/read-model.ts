import type { CreativeVersion, MarketingSnapshot, Publication } from "./contracts.ts";
import { invariant, validIso, validTimezone } from "../session-workflow/policy.ts";
export function approvedCreative(asset: CreativeVersion): boolean {
    return asset.review === "approved" && /^[a-f0-9]{64}$/.test(asset.contentDigest) && asset.contentDigest === asset.approvedDigest;
}
export function publicationLabel(p: Publication, assets: readonly CreativeVersion[]): string {
    const asset = assets.find(a => a.assetId === p.assetId && a.revision === p.creativeRevision);
    if (!asset || asset.contentDigest !== p.creativeDigest)
        return "Creative revision unavailable";
    if (p.state === "manually_reported")
        return p.manualReportedAt && validIso(p.manualReportedAt) ? "Manually marked as posted — not provider-verified" : "Unknown";
    if (p.state === "published" && (p.channel === "facebook_group_manual" || p.channel === "whatsapp_group_manual"))
        return "Manual channel — publication not independently verified";
    if (p.state === "published")
        return p.receiptKind === "publication" && p.provider !== "manual" && p.provider !== "unbound" && p.providerReceiptId && p.providerReadAt && validIso(p.providerReadAt) ? "Published — provider receipt recorded" : "Unknown — publication not verified";
    if (p.state === "scheduled" && (p.channel === "facebook_group_manual" || p.channel === "whatsapp_group_manual"))
        return p.providerReceiptId && p.receiptKind === "schedule" ? "Reminder scheduled — manual posting required" : "Manual posting planned";
    if (p.state === "scheduled")
        return p.receiptKind === "schedule" && p.scheduledFor && validIso(p.scheduledFor) && p.provider !== "unbound" && p.providerReceiptId && p.providerReadAt && validIso(p.providerReadAt) ? "Scheduled — provider confirmed" : "Planned — not provider-confirmed";
    if (p.state === "ready")
        return approvedCreative(asset) ? "Approved, not scheduled" : "Not approved for this revision";
    return { draft: "Draft", sending: "Sending — awaiting result", failed: "Failed", unknown: "Unknown — check provider", skipped: "Skipped — no backfill" }[p.state] ?? "Unknown";
}
export function safeMarketingUrl(value: string | null, hosts: readonly string[]): string | null {
    if (!value)
        return null;
    try {
        const u = new URL(value);
        return u.protocol === "https:" && !u.username && !u.password && hosts.includes(u.hostname.toLowerCase()) ? u.href : null;
    }
    catch {
        return null;
    }
}
export function assertMarketingOwner(actor: {
    role: string;
    active: boolean;
    workspaceId: string;
    accountId: string;
}, owner: {
    workspaceId: string;
    accountId: string;
}): void {
    invariant(actor.active && actor.role === "practitioner" && actor.workspaceId === owner.workspaceId && actor.accountId === owner.accountId, "NOT_FOUND");
}
export function validateMarketingSnapshot(snapshot: MarketingSnapshot): void {
    const allowed = new Set(["source", "fetchedAt", "creatives", "publications", "ads", "scout", "inventory", "adSeries", "workbookUrl", "connectionErrors"]);
    invariant(Object.keys(snapshot).every(key => allowed.has(key)) && ["source", "fetchedAt", "creatives", "publications", "ads", "scout"].every(key => key in snapshot), "MARKETING_FIELDS");
    invariant(["synthetic", "provider_readback", "registry_only"].includes(snapshot.source) && (snapshot.fetchedAt === null || validIso(snapshot.fetchedAt)), "MARKETING_PROVENANCE");
    invariant(snapshot.creatives.length <= 1000 && snapshot.publications.length <= 2000 && snapshot.ads.length <= 200, "MARKETING_PAGE_BOUND");
    for (const p of snapshot.publications)
        invariant(validTimezone(p.timezone) && (p.scheduledFor === null || validIso(p.scheduledFor)), "PUBLICATION_TIME");
    for (const a of snapshot.ads)
        invariant((a.spendMinor === null || Number.isSafeInteger(a.spendMinor) && a.spendMinor >= 0) && (a.inquiries === null || Number.isSafeInteger(a.inquiries) && a.inquiries >= 0), "ADS_UNKNOWN_IS_NOT_ZERO");
    for (const point of snapshot.adSeries ?? [])
        invariant(/^\d{4}-\d{2}-\d{2}$/.test(point.date) && (point.spendMinor === null || Number.isSafeInteger(point.spendMinor) && point.spendMinor >= 0), "ADS_SERIES");
}
export function filterPublications(snapshot: MarketingSnapshot, filters: {
    channel?: Publication["channel"];
    state?: Publication["state"];
}): readonly Publication[] {
    validateMarketingSnapshot(snapshot);
    return snapshot.publications.filter(p => (!filters.channel || p.channel === filters.channel) && (!filters.state || p.state === filters.state)).slice().sort((a, b) => (a.scheduledFor ?? "9999").localeCompare(b.scheduledFor ?? "9999"));
}
