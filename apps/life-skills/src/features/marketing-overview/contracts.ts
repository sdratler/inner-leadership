/** Marketing DTOs contain public creative metadata only; never cases, notes, contact/lead records or transcripts. */
export type Channel = "whatsapp_status" | "facebook_page" | "instagram" | "facebook_group_manual" | "whatsapp_group_manual";
export interface CreativeVersion {
    assetId: string;
    revision: number;
    /** Explicit producer evidence; false means the display revision is a legacy fallback. */
    registeredRevision?: boolean;
    registeredRevisionLabel?: string;
    /** Source metadata only. Unknown cycle is never guessed from an ingest date. */
    concept?: number | null;
    cycle?: string | null;
    catalogKind?: string;
    /** Secondary records cannot become delivery/review items. */
    collection?: "templates" | "history";
    locale: "en" | "he";
    width: number;
    height: number;
    imageUrl: string | null;
    title: string;
    caption: string;
    contentDigest: string;
    review: "draft" | "in_review" | "approved" | "retired";
    approvedDigest: string | null;
    surface?: string;
    sourceUrl?: string | null;
    holdReason?: string | null;
    libraryState?: string;
    /** Opaque guard for the existing register's exact source and approval history. */
    reviewToken?: string;
    artworkReview?: {decision:"approve_artwork"|"needs_revision";note:string;savedAt:string;operationId:string};
}
export interface Publication {
    id: string;
    assetId: string;
    creativeRevision: number;
    creativeDigest: string;
    channel: Channel;
    destinationLabel: string;
    scheduledFor: string | null;
    confirmedAt?: string | null;
    timezone: string;
    state: "draft" | "held" | "ready" | "scheduled" | "sending" | "published" | "failed" | "unknown" | "skipped" | "manually_reported";
    provider: "whapi" | "publer" | "meta" | "manual" | "unbound";
    providerReceiptId: string | null;
    providerReadAt: string | null;
    postUrl: string | null;
    receiptKind: "schedule" | "publication" | "manual_open" | "unknown";
    manualReportedAt: string | null;
    errorCode: string | null;
}
export interface AdSnapshot {
    id: string;
    name: string;
    platform: "meta" | "google";
    status: "active" | "paused" | "unknown";
    creativeAssetIds: readonly string[];
    currency: string | null;
    spendMinor: number | null;
    inquiries: number | null;
    asOf: string | null;
    manageUrl: string | null;
    impressions?: number | null;
    reach?: number | null;
    linkClicks?: number | null;
    linkCtr?: number | null;
    costPerLinkClickMinor?: number | null;
    providerResults?: number | null;
    providerResultLabel?: string | null;
    costPerResultMinor?: number | null;
    startDate?: string | null;
    endDate?: string | null;
    previousSpendMinor?: number | null;
}
export interface AdDailyPoint {
    date: string;
    spendMinor: number | null;
    linkClicks: number | null;
    providerResults: number | null;
}
/** Completed account-local periods, never inferred from campaign names/currency. */
export interface AdReporting {
    accountId: string;
    currency: string;
    timezone: string;
    fetchedAt: string;
    attribution: "provider_default";
    current: { since: string; until: string };
    previous: { since: string; until: string };
    days: readonly AdDailyPoint[];
}
export interface MarketingInventory {
    files: number;
    concepts: number;
    publishablePosts: number;
    heStatusReady: number;
    heFeedReady: number;
    enFeedReady: number;
    adEligible: number;
    inLiveAds: number | null;
    queued: number;
    published: number;
    needsApproval: number;
    needsResizeOrCaption: number;
    heldMissing: number;
    partial: boolean;
    asOf: string;
}
export interface NextStatusHold {
    state: "held";
    language: "en" | "he";
    reason: string;
    conceptId: number;
    candidateAssetIds: readonly string[];
}
/** Shared by the server read decision and the actual dashboard view. */
export function normalizeMarketingSection(value:unknown){
    return (["overview", "content_calendar", "creatives", "needs_approval", "community", "ads"] as const).find(section=>section===value)??"overview";
}
export interface MarketingSnapshot {
    source: "synthetic" | "provider_readback" | "registry_only";
    fetchedAt: string | null;
    creatives: readonly CreativeVersion[];
    library?: readonly CreativeVersion[];
    publications: readonly Publication[];
    ads: readonly AdSnapshot[];
    inventory?: MarketingInventory;
    /** Canonical read-only publisher hold. It is not a schedule or send control. */
    nextStatusHold?: NextStatusHold | null;
    adSeries?: readonly AdDailyPoint[];
    adReporting?: AdReporting;
    workbookUrl?: string | null;
    connectionErrors?: readonly string[];
    inventoryReadback?: {status:"available"|"error";lastSuccessfulReadAt:string|null;lastAttemptAt:string;errorCode:"creative_inventory_unavailable"|null};
    scout: {
        readyDrafts: number | null;
        sourceUrl: string | null;
        lastChecked: string | null;
        status: "unbound" | "available" | "error";
    };
}
