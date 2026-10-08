"use client";
import type { FacebookPagePublicationReadModel, MarketingSnapshot, Publication } from "../../features/marketing-overview/contracts.ts";
import type { ContentCalendarQuery } from "../revamp/marketing-content-calendar.tsx";
import { MarketingDashboard } from "../revamp/marketing-dashboard.tsx";

export type MarketingAcceptanceScenario = "unconfigured" | "unavailable" | "unknown";
export function marketingAcceptanceScenario(value: string | undefined): MarketingAcceptanceScenario {
  return value === "unavailable" || value === "unknown" ? value : "unconfigured";
}

const digest = "a".repeat(64);
const planned: Publication = {
  id: "DEMO-page-calendar-planned", assetId: "DEMO-page-feed", creativeRevision: 1,
  creativeDigest: digest, channel: "facebook_page", destinationLabel: "Synthetic Page destination",
  scheduledFor: "2026-10-08T17:00:00.000Z", timezone: "Asia/Jerusalem", state: "scheduled",
  provider: "meta", providerReceiptId: null, providerReadAt: null, postUrl: null,
  receiptKind: "unknown", manualReportedAt: null, errorCode: null,
};
const snapshot: MarketingSnapshot = {
  source: "synthetic", fetchedAt: "2026-10-08T14:00:00.000Z",
  creatives: [{
    assetId: "DEMO-page-feed", revision: 1, registeredRevision: true, locale: "he",
    width: 1080, height: 1350, imageUrl: null, sourceUrl: null,
    title: "SYNTHETIC — Hebrew Facebook feed", caption: "Synthetic acceptance text only.",
    contentDigest: digest, review: "approved", approvedDigest: digest, surface: "FACEBOOK_FEED",
  }],
  publications: [planned, { ...planned, id: "DEMO-page-calendar-failed", scheduledFor: "2026-10-15T17:00:00.000Z", state: "failed", errorCode: "SYNTHETIC_PROVIDER_FAILURE" }],
  ads: [], inventoryReadback: { status: "available", lastSuccessfulReadAt: "2026-10-08T14:00:00.000Z", lastAttemptAt: "2026-10-08T14:00:00.000Z", errorCode: null },
  scout: { readyDrafts: null, sourceUrl: null, lastChecked: null, status: "unbound" },
};

function pageState(scenario: MarketingAcceptanceScenario): FacebookPagePublicationReadModel {
  if (scenario === "unavailable") return {
    state: "BRIDGE_UNAVAILABLE", lifecycleState: "BLOCKED", reason: null,
    destinationConfigured: false, providerEvidenceAvailable: false,
    externalWriteEnabled: false, externalWritePerformed: false, noBlindRetry: false, recentRecords: [],
  };
  if (scenario === "unknown") return {
    state: "UNKNOWN_DELIVERY_NO_RETRY", lifecycleState: "UNKNOWN", reason: "PROVIDER_READBACK_UNAVAILABLE",
    destinationConfigured: true, providerEvidenceAvailable: true,
    externalWriteEnabled: false, externalWritePerformed: false, noBlindRetry: true,
    recentRecords: [{ state: "UNKNOWN", localBusinessDate: "2026-10-08", scheduledAt: "2026-10-08T17:00:00.000Z", providerReadAt: "2026-10-08T17:05:00.000Z", publishedAt: null, noBlindRetry: true }],
  };
  return {
    state: "UNCONFIGURED_DESTINATION", lifecycleState: "BLOCKED", reason: "FACEBOOK_PAGE_BINDING_UNVERIFIED",
    destinationConfigured: false, providerEvidenceAvailable: false,
    externalWriteEnabled: false, externalWritePerformed: false, noBlindRetry: false, recentRecords: [],
  };
}

const labels = {
  en: { unconfigured: "Unconfigured destination", unavailable: "Source unavailable", unknown: "Unknown delivery — no blind retry" },
  he: { unconfigured: "יעד לא מוגדר", unavailable: "המקור אינו זמין", unknown: "מצב פרסום לא ידוע — ללא ניסיון חוזר עיוור" },
} as const;

export function MarketingAcceptanceFixture({ locale, scenario: rawScenario, query }: { locale: "en" | "he"; scenario?: string | undefined; query: ContentCalendarQuery }) {
  const scenario = marketingAcceptanceScenario(rawScenario);
  const retained = { role: "practitioner", page: "app/marketing", section: "content_calendar", scenario };
  return <>
    <aside className="lsu-state" role="note" data-synthetic-scenario={scenario}>
      <strong>{locale === "he" ? "תרחיש קבלה סינתטי בלבד" : "Synthetic acceptance scenario only"}: {labels[locale][scenario]}</strong>
      <p>{locale === "he" ? "אין כאן חיבור לדף, רשומות לקוחות, פרסום או פעולת ספק." : "No Page connection, client records, publishing or provider action is present."}</p>
    </aside>
    <MarketingDashboard locale={locale} snapshot={snapshot} facebookPage={pageState(scenario)} initialSection="content_calendar" calendarQuery={query} calendarNavigation={{ path: `/${locale}/dev/ui/workspace`, retained }} renderedAt="2026-10-08T14:00:00.000Z"/>
  </>;
}
