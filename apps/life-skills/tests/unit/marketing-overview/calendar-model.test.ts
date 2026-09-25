import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CreativeVersion, MarketingSnapshot, Publication } from "../../../src/features/marketing-overview/contracts.ts";
import { adjacentMonth, calendarDates, contentDayKey, contentMonth, contentView, contentViewPublications, monthPublications, nextHebrewStatus, orderedPublicationQueue, publicationStatusText } from "../../../src/features/marketing-overview/calendar-model.ts";
import { MarketingDashboard } from "../../../src/ui/revamp/marketing-dashboard.tsx";

const creative = { assetId: "he-status-1", revision: 2, locale: "he", review: "approved", contentDigest: "a".repeat(64), approvedDigest: "a".repeat(64) } as CreativeVersion;
const post = (id: string, scheduledFor: string | null, state: Publication["state"] = "scheduled"): Publication => ({
  id, assetId: "he-status-1", creativeRevision: 2, creativeDigest: "a".repeat(64), channel: "whatsapp_status", destinationLabel: "Hebrew Status",
  scheduledFor, timezone: "Asia/Jerusalem", state, provider: "whapi", providerReceiptId: null, providerReadAt: null,
  postUrl: null, receiptKind: "unknown", manualReportedAt: null, errorCode: null,
});
const snapshot = (publications: Publication[]): MarketingSnapshot => ({ source: "synthetic", fetchedAt: "2026-09-25T08:00:00Z", creatives: [creative], publications, ads: [], scout: { readyDrafts: null, sourceUrl: null, lastChecked: null, status: "unbound" } });

describe("read-only Marketing content calendar", () => {
  it("keeps Jerusalem publication dates across UTC midnight and month boundaries", () => {
    expect(contentDayKey("2026-09-30T21:15:00Z")).toBe("2026-10-01");
    expect(monthPublications([post("status", "2026-09-30T21:15:00Z")], "2026-10").get("2026-10-01")?.[0]?.id).toBe("status");
  });
  it("renders empty month grids, leap dates and linkable adjacent months", () => {
    expect(calendarDates("2026-02").filter(Boolean)).toHaveLength(28);
    expect(calendarDates("2028-02").filter(Boolean)).toHaveLength(29);
    expect(adjacentMonth("2026-12", 1)).toBe("2027-01");
    expect(contentMonth("not-a-month", new Date("2026-09-25T08:00:00Z"))).toBe("2026-09");
    expect(monthPublications([], "2026-09").size).toBe(0);
  });
  it("orders real planned records without treating ready-unscheduled or published as next", () => {
    const records = [post("later", "2026-09-26T17:00:00Z"), post("ready", null, "ready"), post("earlier", "2026-09-25T17:00:00Z"), post("published", "2026-09-24T17:00:00Z", "published")];
    expect(orderedPublicationQueue(records).map(item => item.id)).toEqual(["earlier", "later", "ready"]);
    expect(nextHebrewStatus(records, [creative], new Date("2026-09-25T08:00:00Z"))?.id).toBe("earlier");
    expect(nextHebrewStatus(records, [creative], new Date("2026-09-27T08:00:00Z"))).toBeNull();
    expect(publicationStatusText(post("planned", "2026-09-25T17:00:00Z"), [creative], "he")).toBe("מתוכנן — ללא אישור מהספק");
    expect(contentViewPublications(records, "queued").map(item => item.id)).toEqual(["later", "ready", "earlier"]);
    expect(contentViewPublications(records, "published").map(item => item.id)).toEqual(["published"]);
    expect(contentView("unknown")).toBe("all");
  });
  it("orders mixed ISO offsets by instant and keeps destination-specific records", () => {
    const earlier = { ...post("earlier", "2026-10-01T00:00:00+03:00"), destinationLabel: "Group A" };
    const later = { ...post("later", "2026-09-30T22:30:00Z"), destinationLabel: "Group B" };
    expect(orderedPublicationQueue([later, earlier]).map(item => item.id)).toEqual(["earlier", "later"]);
    expect(nextHebrewStatus([later, earlier], [creative], new Date("2026-09-30T20:00:00Z"))?.id).toBe("earlier");
    const html = renderToStaticMarkup(React.createElement(MarketingDashboard, { locale: "en", snapshot: snapshot([later, earlier]), initialSection: "content_calendar", initialMonth: "2026-09", renderedAt: "2026-09-25T08:00:00Z" }));
    expect(html).toContain("Group A");
    expect(html).toContain("Group B");
  });
  it("renders a real empty grid, Hebrew/English views and planned-versus-provider copy", () => {
    const empty = renderToStaticMarkup(React.createElement(MarketingDashboard, { locale: "en", snapshot: snapshot([]), initialSection: "content_calendar", initialMonth: "2026-09", renderedAt: "2026-09-25T08:00:00Z" }));
    expect(empty).toContain("Monthly content calendar");
    expect(empty).toContain("No upcoming planned Hebrew Status");
    expect((empty.match(/class="lsr-content-day"/g) ?? [])).toHaveLength(calendarDates("2026-09").length);
    const he = renderToStaticMarkup(React.createElement(MarketingDashboard, { locale: "he", snapshot: snapshot([post("planned", "2026-09-30T17:00:00Z", "ready")]), initialSection: "content_calendar", initialMonth: "2026-09", renderedAt: "2026-09-25T08:00:00Z" }));
    expect(he).toContain("הסטטוס המתוכנן הבא בעברית במאגר");
    expect(he).toContain("אושר, אך לא תוזמן");
    expect(he).toContain("תצוגות פרסום");
    const undated = renderToStaticMarkup(React.createElement(MarketingDashboard, { locale: "en", snapshot: snapshot([post("undated", null, "failed")]), initialSection: "content_calendar", initialMonth: "2026-09", renderedAt: "2026-09-25T08:00:00Z" }));
    expect(undated).toContain("Other registry records");
    expect(undated).toContain("No recorded date");
    expect(undated).toContain("Hebrew Status");
  });
});
