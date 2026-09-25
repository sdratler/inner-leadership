"use client";
import Image from "next/image";
import { useState } from "react";
import type { Locale } from "../../features/session-workflow/types.ts";
import type { AdDailyPoint, MarketingSnapshot, Publication } from "../../features/marketing-overview/contracts.ts";
import { approvedCreative, safeMarketingUrl } from "../../features/marketing-overview/read-model.ts";
import { adjacentMonth, calendarDates, contentMonth, contentView, contentViewPublications, monthPublications, nextHebrewStatus, orderedPublicationQueue, publicationStatusText, CONTENT_TIMEZONE, type ContentView } from "../../features/marketing-overview/calendar-model.ts";
import { CommunityReplyWorkspace } from "../../features/community-reply/workspace.tsx";
import { Section, word } from "./primitives.tsx";
import "./styles.css";

const sections = ["overview", "content_calendar", "creatives", "needs_approval", "community", "ads"] as const;
const headings = {
  en: { overview: "Overview", content_calendar: "Content calendar", creatives: "Creatives", needs_approval: "Needs approval", community: "Community", ads: "Ads" },
  he: { overview: "סקירה", content_calendar: "יומן תוכן", creatives: "קריאייטיב", needs_approval: "דורש אישור", community: "קהילה", ads: "מודעות" },
};

function driveThumbnail(value: string | null): string | null {
  if (!value) return null;
  const match = value.match(/drive\.google\.com\/file\/d\/([^/]+)/);
  return match ? `https://drive.google.com/thumbnail?id=${encodeURIComponent(match[1]!)}&sz=w600` : value;
}

function CreativeThumbnail({ image, title, width, height, locale }: { image: string | null; title: string; width: number; height: number; locale: Locale }) {
  const [failed, setFailed] = useState(false);
  return <div className="lsr-creative-image">{image && !failed ? <Image src={image} alt={title} width={width} height={height} unoptimized referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : <span>{word(locale, "Thumbnail unavailable; open the source asset", "התמונה הממוזערת אינה זמינה; אפשר לפתוח את קובץ המקור")}<br />{width} × {height}</span>}</div>;
}

function contentTime(value: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: CONTENT_TIMEZONE }).format(new Date(value));
}
function channelName(value: string, locale: Locale): string {
  const names: Record<string, [string, string]> = { whatsapp_status: ["WhatsApp Status", "סטטוס WhatsApp"], facebook_page: ["Facebook feed", "פיד Facebook"], instagram: ["Instagram", "Instagram"], facebook_group_manual: ["Facebook group (manual)", "קבוצת Facebook (ידני)"], whatsapp_group_manual: ["WhatsApp group (manual)", "קבוצת WhatsApp (ידני)"] };
  const pair = names[value]; return pair ? word(locale, pair[0], pair[1]) : value;
}
function PublicationEvidence({ item, locale }: { item: Publication; locale: Locale }) {
  return <>{item.providerReceiptId && <p>{word(locale, "Provider receipt", "אסמכתת ספק")}: {item.providerReceiptId}</p>}{item.errorCode && <p role="status">{word(locale, "Attention needed", "דורש טיפול")}: {item.errorCode}</p>}</>;
}

function currency(locale: Locale, code: string | null, minor: number | null): string {
  if (!code || minor === null) return word(locale, "Not available", "לא זמין");
  return new Intl.NumberFormat(locale, { style: "currency", currency: code }).format(minor / 100);
}

function MetricBars({ locale, points, metric, currencyCode }: { locale: Locale; points: readonly AdDailyPoint[]; metric: "spendMinor" | "linkClicks"; currencyCode: string | null }) {
  const values = points.map(point => point[metric]);
  const maximum = Math.max(1, ...values.map(value => value ?? 0));
  const label = metric === "spendMinor" ? word(locale, "Spend by completed local day", "הוצאה לפי יום מקומי שהושלם") : word(locale, "Link clicks by completed local day", "קליקים על קישור לפי יום מקומי שהושלם");
  return <figure className="lsr-chart"><figcaption><strong>{label}</strong></figcaption><div className="lsr-chart-bars">{points.map(point => <div key={point.date} className="lsr-chart-point"><div className="lsr-chart-track"><span style={{ height: `${Math.max(4, ((point[metric] ?? 0) / maximum) * 100)}%` }} /></div><small>{point.date.slice(5)}</small><span className="sr-only">{point.date}: {metric === "spendMinor" ? currency(locale, currencyCode, point.spendMinor) : point.linkClicks ?? word(locale, "Unavailable", "לא זמין")}</span></div>)}</div></figure>;
}

export function MarketingDashboard({ locale, snapshot, initialSection, initialFilter, initialMonth, renderedAt }: { locale: Locale; snapshot: MarketingSnapshot; initialSection?: string | undefined; initialFilter?: string | undefined; initialMonth?: string | undefined; renderedAt: string }) {
  const section = sections.find(value => value === initialSection) ?? "overview";
  const h = headings[locale];
  const actual = snapshot.source === "provider_readback";
  const inventory = snapshot.inventory;
  const adsCurrency = snapshot.ads.find(ad => ad.currency)?.currency ?? null;
  const workbook = safeMarketingUrl(snapshot.workbookUrl ?? null, ["docs.google.com"]);
  const month = contentMonth(initialMonth, new Date(renderedAt));
  const view = contentView(initialFilter);
  const queue = orderedPublicationQueue(snapshot.publications);
  const nextStatus = nextHebrewStatus(snapshot.publications, snapshot.creatives, new Date(renderedAt));
  const calendarItems = contentViewPublications(snapshot.publications, view);
  const nonQueuedItems = calendarItems.filter(item => !["ready", "scheduled", "sending"].includes(item.state));
  const days = monthPublications(calendarItems, month);
  const monthHref = (value: string) => `/${locale}/app/marketing?${new URLSearchParams({ section: "content_calendar", month: value, ...(view !== "all" ? { filter: view } : {}) })}`;
  const viewHref = (value: ContentView) => `/${locale}/app/marketing?${new URLSearchParams({ section: "content_calendar", month, ...(value !== "all" ? { filter: value } : {}) })}`;
  const creativeFor = (assetId: string, revision: number) => snapshot.creatives.find(asset => asset.assetId === assetId && asset.revision === revision);
  const inventoryCards = inventory ? [
    ["he_status", word(locale, "Hebrew WhatsApp Status", "סטטוס WhatsApp בעברית"), inventory.heStatusReady, "creatives"],
    ["he_feed", word(locale, "Hebrew Facebook feed", "פיד Facebook בעברית"), inventory.heFeedReady, "creatives"],
    ["en_feed", word(locale, "English Facebook feed", "פיד Facebook באנגלית"), inventory.enFeedReady, "creatives"],
    ["all", word(locale, "Publishable posts", "פוסטים מוכנים לפרסום"), inventory.publishablePosts, "creatives"],
    ["queued", word(locale, "Queued", "בתור"), inventory.queued, "content_calendar"],
    ["published", word(locale, "Published", "פורסמו"), inventory.published, "content_calendar"],
  ] as const : [];
  const visibleCreatives = snapshot.creatives.filter(asset => {
    if (section === "needs_approval") return !approvedCreative(asset);
    if (initialFilter === "he_status") return asset.locale === "he" && /status|whatsapp/i.test(asset.surface ?? "");
    if (initialFilter === "he_feed") return asset.locale === "he" && /feed|facebook/i.test(asset.surface ?? "");
    if (initialFilter === "en_feed") return asset.locale === "en" && /feed|facebook/i.test(asset.surface ?? "");
    return true;
  });
  return <section className="lsr">
    <header className="lsr-page-heading"><h1>{word(locale, "Marketing", "שיווק")}</h1><p>{word(locale, "Actual creative inventory, publishing records and direct Meta account readback. No client records or leads appear here.", "מלאי קריאייטיב, רשומות פרסום וקריאה ישירה מחשבון Meta. אין כאן רשומות לקוחות או לידים.")}</p><p className="lsr-status">{actual ? word(locale, "Live readback available; provider acceptance and confirmed publication remain distinct.", "זמינה קריאה חיה; קבלת הספק ואישור פרסום מוצגים בנפרד.") : word(locale, "One or more live readbacks are unavailable.", "קריאה חיה אחת או יותר אינה זמינה.")}</p>{snapshot.connectionErrors?.map(error => <p role="status" className="lsr-inline-error" key={error}>{error === "direct_meta_readback_unavailable" ? word(locale, "Direct Meta metrics are temporarily unavailable.", "נתוני Meta הישירים אינם זמינים כרגע.") : word(locale, "Creative inventory is temporarily unavailable.", "מלאי הקריאייטיב אינו זמין כרגע.")}</p>)}</header>
    {section === "overview" && <>
      <div className="lsr-summary-grid">{inventoryCards.map(([filter, label, value, destination]) => <Section title={label} key={filter}><a className="lsr-stat-link" href={`/${locale}/app/marketing?section=${destination}&filter=${filter}`} aria-label={`${label}: ${value}`}><strong className="lsr-stat">{value}</strong><span>{word(locale, "View records", "הצגת הרשומות")}</span></a></Section>)}</div>
      {inventory && <Section title={word(locale, "Inventory meaning", "משמעות המלאי")}><p>{word(locale, `${inventory.files} registered files represent ${inventory.concepts} concepts; files, concepts, publishable posts and placements are counted separately.`, `${inventory.files} קבצים רשומים מייצגים ${inventory.concepts} רעיונות; קבצים, רעיונות, פוסטים מוכנים ומיקומים נספרים בנפרד.`)}</p><p><a href={`/${locale}/app/marketing?section=needs_approval`}>{word(locale, "Needs approval", "דורש אישור")}: {inventory.needsApproval}</a> · {word(locale, "Needs resize or caption", "דורש התאמת גודל או כיתוב")}: {inventory.needsResizeOrCaption} · {word(locale, "Held or missing", "בהשהיה או חסר")}: {inventory.heldMissing}</p><p><time>{inventory.asOf}</time>{inventory.partial ? ` · ${word(locale, "Partial inventory; unknown is not zero", "מלאי חלקי; לא ידוע אינו אפס")}` : ""}</p>{workbook && <a href={workbook} target="_blank" rel="noopener noreferrer">{word(locale, "Open source workbook", "פתיחת חוברת המקור")}</a>}</Section>}
    </>}
    {section === "ads" && <Section title={word(locale, "Ads — direct Meta read only", "מודעות — קריאה ישירה מ-Meta בלבד")}>
        {!snapshot.ads.length ? <p>{word(locale, "No direct Meta snapshots are available.", "אין כרגע נתונים ישירים מ-Meta.")}</p> : snapshot.ads.map(ad => { const manageUrl = safeMarketingUrl(ad.manageUrl, ["adsmanager.facebook.com", "business.facebook.com"]); return <article className="lsr-ad-row" key={ad.id}><h3>{ad.name}</h3><p>Meta · {ad.status} · {ad.endDate ? `${word(locale, "Ends", "מסתיים")} ${ad.endDate}` : word(locale, "Ongoing — no scheduled end", "מתמשך — ללא מועד סיום מתוזמן")}</p><div className="lsr-metric-row"><span>{word(locale, "Spend", "הוצאה")}: <strong>{currency(locale, ad.currency, ad.spendMinor)}</strong></span><span>{word(locale, "Impressions", "חשיפות")}: <strong>{ad.impressions ?? "—"}</strong></span><span>{word(locale, "Reach", "תפוצה")}: <strong>{ad.reach ?? "—"}</strong></span><span>{word(locale, "Link clicks", "קליקים על קישור")}: <strong>{ad.linkClicks ?? "—"}</strong></span><span>CTR: <strong>{ad.linkCtr === null || ad.linkCtr === undefined ? "—" : `${ad.linkCtr.toFixed(2)}%`}</strong></span><span>{ad.providerResultLabel ?? word(locale, "Provider results", "תוצאות ספק")}: <strong>{ad.providerResults ?? "—"}</strong></span></div><p>{word(locale, "Updated through", "עודכן עד")}: {ad.asOf ?? word(locale, "Not verified", "לא אומת")}</p>{manageUrl && <a href={manageUrl} target="_blank" rel="noopener noreferrer">{word(locale, "Open Meta Ads Manager", "פתיחת מנהל המודעות של Meta")}</a>}</article>; })}
        {!!snapshot.adSeries?.length && <div className="lsr-chart-grid"><MetricBars locale={locale} points={snapshot.adSeries} metric="spendMinor" currencyCode={adsCurrency}/><MetricBars locale={locale} points={snapshot.adSeries} metric="linkClicks" currencyCode={adsCurrency}/></div>}
    </Section>}
    {(section === "creatives" || section === "needs_approval") && <Section title={h[section]} description={word(locale, "Language, dimensions and approval belong to the exact registered revision.", "שפה, מידות ואישור שייכים לגרסה הרשומה המדויקת.")}><div className="lsr-creative-grid">{visibleCreatives.map(asset => { const image = safeMarketingUrl(driveThumbnail(asset.imageUrl), ["drive.google.com", "lh3.googleusercontent.com"]); const source = safeMarketingUrl(asset.sourceUrl ?? asset.imageUrl, ["drive.google.com", "docs.google.com", "github.com"]); return <article key={`${asset.assetId}:${asset.revision}`}><CreativeThumbnail image={image} title={asset.title} width={asset.width} height={asset.height} locale={locale}/><h3>{asset.title}</h3><p>{asset.locale.toUpperCase()} · {asset.surface ?? `${asset.width}×${asset.height}`} · v{asset.revision}</p><p>{approvedCreative(asset) ? word(locale, "Approved exact version", "הגרסה המדויקת מאושרת") : asset.holdReason ?? word(locale, "Needs review", "ממתין לבדיקה")}</p>{source && <a href={source} target="_blank" rel="noopener noreferrer">{word(locale, "Open asset", "פתיחת הנכס")}</a>}</article>; })}</div>{!visibleCreatives.length && <p>{word(locale, "No linked assets match this view. Check the source workbook for records that are not linked to a preview image.", "אין נכסים מקושרים בתצוגה הזאת. אפשר לבדוק בחוברת המקור רשומות ללא קישור לתמונה.")}</p>}</Section>}
    {section === "content_calendar" && <Section title={h[section]}>
      <p className="lsr-help">{word(locale, "Read-only registry view. Times use Asia/Jerusalem. Planned, provider-accepted and confirmed published are different states; this page does not schedule or publish.", "תצוגת קריאה בלבד של המאגר. הזמנים מוצגים לפי שעון ישראל. תכנון, קבלת הספק ופרסום מאומת הם מצבים שונים; מסך זה אינו מתזמן או מפרסם.")}{snapshot.inventory?.partial ? ` ${word(locale, "Inventory is partial; missing is not zero.", "המלאי חלקי; חוסר מידע אינו אפס.")}` : ""}</p>
      <nav className="lsr-tabs lsr-content-views" aria-label={word(locale, "Publication views", "תצוגות פרסום")}>{([[
        "all", word(locale, "All", "הכול")], ["queued", word(locale, "Due & planned", "ממתינים ומתוכננים")], ["drafts", word(locale, "Drafts", "טיוטות")],
        ["published", word(locale, "Published", "פורסמו")], ["history", word(locale, "History", "היסטוריה")],
      ] as const).map(([value, label]) => <a className="lsr-button" aria-current={view === value ? "page" : undefined} href={viewHref(value)} key={value}>{label}</a>)}</nav>
      <div className="lsr-status"><strong>{word(locale, "Next planned Hebrew WhatsApp Status in the registry", "הסטטוס המתוכנן הבא בעברית במאגר")}</strong><p>{nextStatus?.scheduledFor ? <><time dateTime={nextStatus.scheduledFor}>{contentTime(nextStatus.scheduledFor, locale)}</time> · {creativeFor(nextStatus.assetId, nextStatus.creativeRevision)?.title ?? nextStatus.assetId} · {publicationStatusText(nextStatus, snapshot.creatives, locale)}</> : word(locale, "No upcoming planned Hebrew Status appears in these records. The external publisher queue may differ.", "לא מופיע כאן סטטוס מתוכנן עתידי בעברית. ייתכן שהתור אצל ספק הפרסום שונה.")}</p></div>
      <nav className="lsr-content-month-nav" aria-label={word(locale, "Content calendar month", "חודש ביומן התוכן")}><a className="lsr-button" href={monthHref(adjacentMonth(month, -1))}>{word(locale, "Previous month", "החודש הקודם")}</a><h3>{new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T12:00:00Z`))}</h3><a className="lsr-button" href={monthHref(adjacentMonth(month, 1))}>{word(locale, "Next month", "החודש הבא")}</a></nav>
      <div className="lsr-content-calendar-scroll" role="region" aria-label={word(locale, "Monthly content calendar", "יומן תוכן חודשי")} tabIndex={0}><div className="lsr-content-calendar-grid">
        {Array.from({ length: 7 }, (_, index) => <strong className="lsr-content-weekday" key={index}>{new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2023, 0, 1 + index)))}</strong>)}
        {calendarDates(month).map((day, index) => <div className="lsr-content-day" key={day ?? `blank-${index}`} aria-label={day ?? undefined}><strong>{day?.slice(-2) ?? ""}</strong>{day && <ul>{(days.get(day) ?? []).map(item => <li key={item.id}><time dateTime={item.scheduledFor ?? undefined}>{item.scheduledFor ? new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", timeZone: CONTENT_TIMEZONE }).format(new Date(item.scheduledFor)) : "—"}</time> · {creativeFor(item.assetId, item.creativeRevision)?.title ?? item.assetId}<small>{channelName(item.channel, locale)} · {item.destinationLabel} · {publicationStatusText(item, snapshot.creatives, locale)}</small></li>)}</ul>}</div>)}
      </div></div>
      {(view === "all" || view === "queued") && <><h3>{word(locale, "Ordered planned and ready records", "רשומות מתוכננות ומוכנות לפי סדר")}: {queue.length}</h3><p className="lsr-help">{word(locale, "Ready but unscheduled records are included; this count is not the provider queue count.", "רשומות מוכנות אך לא מתוזמנות כלולות; המספר אינו מספר הפריטים בתור הספק.")}</p>{queue.length ? <ol className="lsr-content-queue">{queue.map(item => { const asset = creativeFor(item.assetId, item.creativeRevision); const source = safeMarketingUrl(asset?.sourceUrl ?? asset?.imageUrl ?? null, ["drive.google.com", "docs.google.com", "github.com"]); return <li key={item.id}><strong>{asset?.title ?? item.assetId}</strong> · {channelName(item.channel, locale)} · {item.destinationLabel} · {item.scheduledFor ? <time dateTime={item.scheduledFor}>{contentTime(item.scheduledFor, locale)}</time> : word(locale, "Unscheduled", "ללא מועד")}<p>{publicationStatusText(item, snapshot.creatives, locale)}</p><PublicationEvidence item={item} locale={locale}/>{source && <a href={source} target="_blank" rel="noopener noreferrer">{word(locale, "Open source asset", "פתיחת קובץ המקור")}</a>}</li>; })}</ol> : <p>{word(locale, "No planned records in the registry; this is not a provider queue readback.", "אין רשומות מתוכננות במאגר; זו אינה קריאה ישירה של תור הספק.")}</p>}</>}
      {(view === "all" || view === "drafts" || view === "published" || view === "history") && <><h3>{view === "all" ? word(locale, "Other registry records", "רשומות נוספות במאגר") : word(locale, "Selected records", "רשומות שנבחרו")}: {view === "all" ? nonQueuedItems.length : calendarItems.length}</h3><ol className="lsr-content-queue">{(view === "all" ? nonQueuedItems : calendarItems).slice().sort((a, b) => (a.scheduledFor ? Date.parse(a.scheduledFor) : Number.POSITIVE_INFINITY) - (b.scheduledFor ? Date.parse(b.scheduledFor) : Number.POSITIVE_INFINITY) || a.id.localeCompare(b.id)).map(item => <li key={item.id}><strong>{creativeFor(item.assetId, item.creativeRevision)?.title ?? item.assetId}</strong> · {channelName(item.channel, locale)} · {item.destinationLabel} · {item.scheduledFor ? <time dateTime={item.scheduledFor}>{contentTime(item.scheduledFor, locale)}</time> : word(locale, "No recorded date", "אין תאריך רשום")}<p>{publicationStatusText(item, snapshot.creatives, locale)}</p><PublicationEvidence item={item} locale={locale}/></li>)}</ol></>}
      {!snapshot.publications.length && <p>{word(locale, "No workbook publishing records are available. This does not mean the publisher is empty.", "אין כרגע רשומות פרסום מהחוברת. אין להסיק שמתזמן הספק ריק.")}</p>}
    </Section>}
    {section === "community" && <Section title={h[section]}><CommunityReplyWorkspace locale={locale} /></Section>}
  </section>;
}
