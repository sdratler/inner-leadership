/** Marketing DTOs contain public creative metadata only; never cases, notes, contact/lead records or transcripts. */
export type Channel = "whatsapp_status" | "facebook_page" | "instagram" | "facebook_group_manual" | "whatsapp_group_manual";
export interface CreativeVersion {
    assetId: string;
    revision: number;
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
}
export interface Publication {
    id: string;
    assetId: string;
    creativeRevision: number;
    creativeDigest: string;
    channel: Channel;
    destinationLabel: string;
    scheduledFor: string | null;
    timezone: string;
    state: "draft" | "ready" | "scheduled" | "sending" | "published" | "failed" | "unknown" | "skipped" | "manually_reported";
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
export interface MarketingSnapshot {
    source: "synthetic" | "provider_readback" | "registry_only";
    fetchedAt: string | null;
    creatives: readonly CreativeVersion[];
    publications: readonly Publication[];
    ads: readonly AdSnapshot[];
    inventory?: MarketingInventory;
    adSeries?: readonly AdDailyPoint[];
    workbookUrl?: string | null;
    connectionErrors?: readonly string[];
    scout: {
        readyDrafts: number | null;
        sourceUrl: string | null;
        lastChecked: string | null;
        status: "unbound" | "available" | "error";
    };
}
