"use client";
import { useState } from "react";
import Image from "next/image";
import type { Locale } from "../../features/session-workflow/types.ts";
import type { AdDailyPoint, MarketingSnapshot } from "../../features/marketing-overview/contracts.ts";
import { publicationLabel, approvedCreative, safeMarketingUrl } from "../../features/marketing-overview/read-model.ts";
import { Section, word } from "./primitives.tsx";
import "./styles.css";

const sections = ["overview", "content_calendar", "creatives", "publishing"] as const;
const headings = {
  en: { overview: "Overview", content_calendar: "Content calendar", creatives: "Creatives", publishing: "Publishing" },
  he: { overview: "סקירה", content_calendar: "יומן תוכן", creatives: "קריאייטיב", publishing: "פרסום" },
};

function driveThumbnail(value: string | null): string | null {
  if (!value) return null;
  const match = value.match(/drive\.google\.com\/file\/d\/([^/]+)/);
  return match ? `https://drive.google.com/thumbnail?id=${encodeURIComponent(match[1]!)}&sz=w600` : value;
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

export function MarketingDashboard({ locale, snapshot }: { locale: Locale; snapshot: MarketingSnapshot }) {
  const [section, setSection] = useState<typeof sections[number]>("overview");
  const h = headings[locale];
  const actual = snapshot.source === "provider_readback";
  const inventory = snapshot.inventory;
  const adsCurrency = snapshot.ads.find(ad => ad.currency)?.currency ?? null;
  const workbook = safeMarketingUrl(snapshot.workbookUrl ?? null, ["docs.google.com"]);
  const inventoryCards = inventory ? [
    [word(locale, "Hebrew Status ready", "סטטוסים מוכנים בעברית"), inventory.heStatusReady],
    [word(locale, "Hebrew feed ready", "פוסטים מוכנים בעברית"), inventory.heFeedReady],
    [word(locale, "English feed ready", "פוסטים מוכנים באנגלית"), inventory.enFeedReady],
    [word(locale, "Publishable concepts", "רעיונות מוכנים לפרסום"), inventory.publishablePosts],
    [word(locale, "Queued", "בתור"), inventory.queued],
    [word(locale, "Published", "פורסמו"), inventory.published],
  ] as const : [];
  return <section className="lsr">
    <header className="lsr-page-heading"><h1>{word(locale, "Marketing", "שיווק")}</h1><p>{word(locale, "Actual creative inventory, publishing records and direct Meta account readback. No client records or leads appear here.", "מלאי קריאייטיב, רשומות פרסום וקריאה ישירה מחשבון Meta. אין כאן רשומות לקוחות או לידים.")}</p><p className="lsr-status">{actual ? word(locale, "Live readback available; provider acceptance and confirmed publication remain distinct.", "זמינה קריאה חיה; קבלת הספק ואישור פרסום מוצגים בנפרד.") : word(locale, "One or more live readbacks are unavailable.", "קריאה חיה אחת או יותר אינה זמינה.")}</p>{snapshot.connectionErrors?.map(error => <p role="status" className="lsr-inline-error" key={error}>{error === "direct_meta_readback_unavailable" ? word(locale, "Direct Meta metrics are temporarily unavailable.", "נתוני Meta הישירים אינם זמינים כרגע.") : word(locale, "Creative inventory is temporarily unavailable.", "מלאי הקריאייטיב אינו זמין כרגע.")}</p>)}</header>
    <nav className="lsr-tabs" aria-label={word(locale, "Marketing sections", "חלקי השיווק")}>{sections.map(key => <button type="button" key={key} aria-pressed={section === key} onClick={() => setSection(key)}>{h[key]}</button>)}</nav>
    {section === "overview" && <>
      <div className="lsr-summary-grid">{inventoryCards.map(([label, value]) => <Section title={label} key={label}><strong className="lsr-stat">{value}</strong></Section>)}</div>
      {inventory && <Section title={word(locale, "Inventory meaning", "משמעות המלאי")}><p>{word(locale, `${inventory.files} registered files represent ${inventory.concepts} concepts; files, concepts, publishable posts and placements are counted separately.`, `${inventory.files} קבצים רשומים מייצגים ${inventory.concepts} רעיונות; קבצים, רעיונות, פוסטים מוכנים ומיקומים נספרים בנפרד.`)}</p><p>{word(locale, "Needs approval", "דורש אישור")}: {inventory.needsApproval} · {word(locale, "Needs resize or caption", "דורש התאמת גודל או כיתוב")}: {inventory.needsResizeOrCaption} · {word(locale, "Held or missing", "בהשהיה או חסר")}: {inventory.heldMissing}</p><p><time>{inventory.asOf}</time>{inventory.partial ? ` · ${word(locale, "Partial inventory; unknown is not zero", "מלאי חלקי; לא ידוע אינו אפס")}` : ""}</p>{workbook && <a href={workbook} target="_blank" rel="noopener noreferrer">{word(locale, "Open source workbook", "פתיחת חוברת המקור")}</a>}</Section>}
      <Section title={word(locale, "Ads — direct Meta read only", "מודעות — קריאה ישירה מ-Meta בלבד")}>
        {!snapshot.ads.length ? <p>{word(locale, "No direct Meta snapshots are available.", "אין כרגע נתונים ישירים מ-Meta.")}</p> : snapshot.ads.map(ad => { const manageUrl = safeMarketingUrl(ad.manageUrl, ["adsmanager.facebook.com", "business.facebook.com"]); return <article className="lsr-ad-row" key={ad.id}><h3>{ad.name}</h3><p>Meta · {ad.status} · {ad.endDate ? `${word(locale, "Ends", "מסתיים")} ${ad.endDate}` : word(locale, "Ongoing — no scheduled end", "מתמשך — ללא מועד סיום מתוזמן")}</p><div className="lsr-metric-row"><span>{word(locale, "Spend", "הוצאה")}: <strong>{currency(locale, ad.currency, ad.spendMinor)}</strong></span><span>{word(locale, "Impressions", "חשיפות")}: <strong>{ad.impressions ?? "—"}</strong></span><span>{word(locale, "Reach", "תפוצה")}: <strong>{ad.reach ?? "—"}</strong></span><span>{word(locale, "Link clicks", "קליקים על קישור")}: <strong>{ad.linkClicks ?? "—"}</strong></span><span>CTR: <strong>{ad.linkCtr === null || ad.linkCtr === undefined ? "—" : `${ad.linkCtr.toFixed(2)}%`}</strong></span><span>{ad.providerResultLabel ?? word(locale, "Provider results", "תוצאות ספק")}: <strong>{ad.providerResults ?? "—"}</strong></span></div><p>{word(locale, "Updated through", "עודכן עד")}: {ad.asOf ?? word(locale, "Not verified", "לא אומת")}</p>{manageUrl && <a href={manageUrl} target="_blank" rel="noopener noreferrer">{word(locale, "Open Meta Ads Manager", "פתיחת מנהל המודעות של Meta")}</a>}</article>; })}
        {!!snapshot.adSeries?.length && <div className="lsr-chart-grid"><MetricBars locale={locale} points={snapshot.adSeries} metric="spendMinor" currencyCode={adsCurrency}/><MetricBars locale={locale} points={snapshot.adSeries} metric="linkClicks" currencyCode={adsCurrency}/></div>}
      </Section>
    </>}
    {section === "creatives" && <Section title={h.creatives} description={word(locale, "Language, dimensions and approval belong to the exact registered revision.", "שפה, מידות ואישור שייכים לגרסה הרשומה המדויקת.")}><div className="lsr-creative-grid">{snapshot.creatives.map(asset => { const image = safeMarketingUrl(driveThumbnail(asset.imageUrl), ["drive.google.com", "lh3.googleusercontent.com"]); const source = safeMarketingUrl(asset.sourceUrl ?? asset.imageUrl, ["drive.google.com", "docs.google.com", "github.com"]); return <article key={`${asset.assetId}:${asset.revision}`}><div className="lsr-creative-image">{image ? <Image src={image} alt={asset.title} width={asset.width} height={asset.height} unoptimized referrerPolicy="no-referrer"/> : <span>{word(locale, "No verified thumbnail", "אין תמונה ממוזערת מאומתת")}<br />{asset.width} × {asset.height}</span>}</div><h3>{asset.title}</h3><p>{asset.locale.toUpperCase()} · {asset.surface ?? `${asset.width}×${asset.height}`} · v{asset.revision}</p><p>{approvedCreative(asset) ? word(locale, "Approved exact version", "הגרסה המדויקת מאושרת") : asset.holdReason ?? word(locale, "Needs review", "ממתין לבדיקה")}</p>{source && <a href={source} target="_blank" rel="noopener noreferrer">{word(locale, "Open asset", "פתיחת הנכס")}</a>}</article>; })}</div>{!snapshot.creatives.length && <p>{word(locale, "The existing Asset Registry could not be read. No replacement was generated.", "לא ניתן לקרוא את מרשם הנכסים הקיים. לא נוצר תחליף.")}</p>}</Section>}
    {(section === "content_calendar" || section === "publishing") && <Section title={h[section]}>{snapshot.publications.map(publication => <article className="lsr-publication-row" key={publication.id}><h3>{snapshot.creatives.find(asset => asset.assetId === publication.assetId)?.title ?? publication.assetId}</h3><p>{publication.channel} · {publication.destinationLabel}</p><time>{publication.scheduledFor ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: publication.timezone }).format(new Date(publication.scheduledFor)) : word(locale, "No scheduled time", "לא תוזמן")}</time><p>{publication.state === "skipped" ? word(locale, "Skipped by the recorded quiet-day rule; no backfill", "דולג לפי כלל יום המנוחה הרשום; ללא השלמהย้อนหลัง") : publicationLabel(publication, snapshot.creatives)}</p>{publication.providerReceiptId && <p>{word(locale, "Provider receipt", "אסמכתת ספק")}: {publication.providerReceiptId}</p>}{publication.errorCode && <p role="status">{word(locale, "Attention needed", "דורש טיפול")}: {publication.errorCode}</p>}</article>)}{!snapshot.publications.length && <p>{word(locale, "No workbook publishing records are available. This does not mean the publisher is empty.", "אין כרגע רשומות פרסום מהחוברת. אין להסיק שהמתזמן ריק.")}</p>}</Section>}
  </section>;
}
