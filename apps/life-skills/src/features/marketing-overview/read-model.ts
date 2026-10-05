import type { CreativeVersion, MarketingSnapshot, Publication } from "./contracts.ts";
import { invariant, validIso, validTimezone } from "../session-workflow/policy.ts";
export function registeredCreativeRevision(asset: CreativeVersion): boolean {
    return !("registeredRevision" in asset) || Object.hasOwn(asset, "registeredRevision") && asset.registeredRevision === true;
}
export function approvedCreative(asset: CreativeVersion): boolean {
    return registeredCreativeRevision(asset) && asset.review === "approved" && /^[a-f0-9]{64}$/.test(asset.contentDigest) && asset.contentDigest === asset.approvedDigest;
}
export function publicationLabel(p: Publication, assets: readonly CreativeVersion[]): string {
    if (p.state === "held") return "Held — not eligible for publication";
    if (p.state === "unknown") return "Unknown — check provider";
    if (p.state === "failed") return "Failed";
    if (p.state === "draft") return "Draft";
    if (p.state === "skipped") return "Skipped — no backfill";
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
    return p.state === "sending" ? "Sending — awaiting result" : "Unknown";
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
function validateCreative(asset: CreativeVersion): void {
    invariant(typeof asset === "object" && asset !== null && !Array.isArray(asset), "CREATIVE_FIELDS");
    const required = ["assetId", "revision", "locale", "width", "height", "imageUrl", "title", "caption", "contentDigest", "review", "approvedDigest"];
    invariant(required.every(key => Object.hasOwn(asset, key)), "CREATIVE_FIELDS");
    invariant(!("registeredRevision" in asset) || Object.hasOwn(asset, "registeredRevision") && typeof asset.registeredRevision === "boolean", "CREATIVE_FIELDS");
    invariant(typeof asset.assetId === "string" && /^[A-Za-z0-9._-]{1,200}$/.test(asset.assetId) && Number.isSafeInteger(asset.revision) && asset.revision > 0 && asset.revision <= 999999 && ["en", "he"].includes(asset.locale), "CREATIVE_IDENTITY");
    // Zero means an unrecorded size: preserve the record, but never use it as a
    // valid next/image dimension or infer placement eligibility from it.
    invariant([asset.width, asset.height].every(value => Number.isSafeInteger(value) && value >= 0 && value <= 32768), "CREATIVE_DIMENSIONS");
    invariant(typeof asset.title === "string" && typeof asset.caption === "string" && typeof asset.contentDigest === "string" && /^[a-f0-9]{64}$/.test(asset.contentDigest) && ["draft", "in_review", "approved", "retired"].includes(asset.review), "CREATIVE_FIELDS");
    invariant((asset.imageUrl === null || typeof asset.imageUrl === "string") && (asset.approvedDigest === null || typeof asset.approvedDigest === "string" && /^[a-f0-9]{64}$/.test(asset.approvedDigest)), "CREATIVE_FIELDS");
    invariant(["surface", "libraryState"].every(key => !Object.hasOwn(asset, key) || typeof asset[key as "surface" | "libraryState"] === "string") && ["sourceUrl", "holdReason"].every(key => !Object.hasOwn(asset, key) || asset[key as "sourceUrl" | "holdReason"] === null || typeof asset[key as "sourceUrl" | "holdReason"] === "string"), "CREATIVE_FIELDS");
}
function validatePublication(p: Publication): void {
    invariant(typeof p === "object" && p !== null && !Array.isArray(p), "PUBLICATION_FIELDS");
    const required = ["id", "assetId", "creativeRevision", "creativeDigest", "channel", "destinationLabel", "scheduledFor", "timezone", "state", "provider", "providerReceiptId", "providerReadAt", "postUrl", "receiptKind", "manualReportedAt", "errorCode"];
    invariant(required.every(key => Object.hasOwn(p, key)), "PUBLICATION_FIELDS");
    // An unresolved source slot may have an empty asset/digest. Keep its honest
    // unavailable state instead of inventing a binding or rejecting all slots.
    invariant(typeof p.id === "string" && p.id.length > 0 && typeof p.assetId === "string" && Number.isSafeInteger(p.creativeRevision) && p.creativeRevision > 0 && typeof p.creativeDigest === "string" && typeof p.destinationLabel === "string", "PUBLICATION_FIELDS");
    const assetKey = /^[A-Za-z0-9._-]{1,200}$/.test(p.assetId);
    // The live registry retains historical/held slots even when their exact
    // creative is unavailable. These are display-only, never usable queue or
    // delivery evidence. Preserve the source state and reason without a digest.
    const unresolvedState = ["unknown", "skipped", "failed", "held"].includes(p.state) || p.state === "draft" && typeof p.errorCode === "string" && p.errorCode.length > 0;
    const noDeliveryEvidence = p.receiptKind === "unknown" && p.providerReceiptId === null && p.providerReadAt === null && p.postUrl === null && p.manualReportedAt === null && (p.confirmedAt === undefined || p.confirmedAt === null);
    invariant(p.provider !== "unbound" || noDeliveryEvidence, "PUBLICATION_UNBOUND_EVIDENCE");
    const explicitMissing = unresolvedState && p.provider === "unbound" && noDeliveryEvidence;
    invariant(assetKey && /^[a-f0-9]{64}$/.test(p.creativeDigest) || (assetKey || p.assetId === "") && p.creativeDigest === "" && explicitMissing, "PUBLICATION_BINDING");
    invariant(["whatsapp_status", "facebook_page", "instagram", "facebook_group_manual", "whatsapp_group_manual"].includes(p.channel) && ["draft", "held", "ready", "scheduled", "sending", "published", "failed", "unknown", "skipped", "manually_reported"].includes(p.state) && ["whapi", "publer", "meta", "manual", "unbound"].includes(p.provider) && ["schedule", "publication", "manual_open", "unknown"].includes(p.receiptKind), "PUBLICATION_FIELDS");
    invariant([p.providerReceiptId, p.postUrl, p.errorCode].every(value => value === null || typeof value === "string"), "PUBLICATION_FIELDS");
    invariant(typeof p.timezone === "string" && validTimezone(p.timezone) && [p.scheduledFor, p.providerReadAt, p.manualReportedAt].every(value => value === null || typeof value === "string" && validIso(value)), "PUBLICATION_TIME");
    invariant(!("confirmedAt" in p) || Object.hasOwn(p, "confirmedAt") && (p.confirmedAt === null || typeof p.confirmedAt === "string" && validIso(p.confirmedAt)), "PUBLICATION_TIME");
}
export function validateMarketingSnapshot(snapshot: MarketingSnapshot): void {
    const allowed = new Set(["source", "fetchedAt", "creatives", "publications", "ads", "scout", "inventory", "adSeries", "adReporting", "workbookUrl", "connectionErrors", "inventoryReadback"]);
    invariant(Object.keys(snapshot).every(key => allowed.has(key)) && ["source", "fetchedAt", "creatives", "publications", "ads", "scout"].every(key => key in snapshot), "MARKETING_FIELDS");
    invariant(["synthetic", "provider_readback", "registry_only"].includes(snapshot.source) && (snapshot.fetchedAt === null || validIso(snapshot.fetchedAt)), "MARKETING_PROVENANCE");
    invariant(snapshot.creatives.length <= 1000 && snapshot.publications.length <= 2000 && snapshot.ads.length <= 200, "MARKETING_PAGE_BOUND");
    for (const asset of snapshot.creatives) validateCreative(asset);
    if(snapshot.inventoryReadback){const read=snapshot.inventoryReadback;invariant(validIso(read.lastAttemptAt)&&(read.lastSuccessfulReadAt===null||validIso(read.lastSuccessfulReadAt))&&(read.status==="available"?read.lastSuccessfulReadAt!==null&&read.errorCode===null:read.status==="error"&&read.errorCode==="creative_inventory_unavailable"),"MARKETING_INVENTORY_PROVENANCE");}
    if(snapshot.inventory!==undefined){
        const counts=snapshot.inventory;
        invariant(typeof counts==="object"&&counts!==null&&!Array.isArray(counts),"MARKETING_INVENTORY_FIELDS");
        const numericFields=["files","concepts","publishablePosts","heStatusReady","heFeedReady","enFeedReady","adEligible","queued","published","needsApproval","needsResizeOrCaption","heldMissing"] as const;
        invariant(numericFields.every(key=>Object.hasOwn(counts,key)&&Number.isSafeInteger(counts[key])&&counts[key]>=0)&&Object.hasOwn(counts,"inLiveAds")&&(counts.inLiveAds===null||Number.isSafeInteger(counts.inLiveAds)&&counts.inLiveAds>=0)&&Object.hasOwn(counts,"partial")&&typeof counts.partial==="boolean"&&Object.hasOwn(counts,"asOf")&&typeof counts.asOf==="string"&&validIso(counts.asOf),"MARKETING_INVENTORY_FIELDS");
    }
    for (const p of snapshot.publications) validatePublication(p);
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
