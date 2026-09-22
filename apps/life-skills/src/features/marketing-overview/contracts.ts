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
    state: "draft" | "ready" | "scheduled" | "sending" | "published" | "failed" | "unknown" | "manually_reported";
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
}
export interface MarketingSnapshot {
    source: "synthetic" | "provider_readback" | "registry_only";
    fetchedAt: string | null;
    creatives: readonly CreativeVersion[];
    publications: readonly Publication[];
    ads: readonly AdSnapshot[];
    scout: {
        readyDrafts: number | null;
        sourceUrl: string | null;
        lastChecked: string | null;
        status: "unbound" | "available" | "error";
    };
}
