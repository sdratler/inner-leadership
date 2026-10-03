"use client";
import Image from "next/image";
import { useState } from "react";
import type { Locale } from "../../features/session-workflow/types.ts";
import type { AdDailyPoint, MarketingSnapshot } from "../../features/marketing-overview/contracts.ts";
import { safeMarketingUrl } from "../../features/marketing-overview/read-model.ts";
import {creativeApprovals,creativeFilters,creativePlacements,creativeReviewState,filterCreatives,type CreativeQuery} from "../../features/marketing-overview/creative-filters.ts";
import { MarketingContentCalendar, type ContentCalendarQuery } from "./marketing-content-calendar.tsx";
import { CommunityReplyWorkspace } from "../../features/community-reply/workspace.tsx";
import { Section, word } from "./primitives.tsx";
import "./styles.css";

const sections = ["overview", "content_calendar", "creatives", "needs_approval", "community", "ads"] as const;
const headings = {
  en: { overview: "Overview", content_calendar: "Content calendar", creatives: "Creatives", needs_approval: "Needs approval", community: "Community", ads: "Ads" },
  he: { overview: "סקירה", content_calendar: "יומן תוכן", creatives: "קריאייטיב", needs_approval: "דורש אישור", community: "קהילה", ads: "מודעות" },
};

function driveThumbnail(value: string | null): string | null {
  const safe=safeMarketingUrl(value,["drive.google.com","lh3.googleusercontent.com"]);if(!safe)return null;
  const parsed=new URL(safe),match=parsed.hostname==="drive.google.com"?parsed.pathname.match(/^\/file\/d\/([A-Za-z0-9_-]+)(?:\/|$)/):null;
  return match ? `https://drive.google.com/thumbnail?id=${encodeURIComponent(match[1]!)}&sz=w600` : safe;
}

function CreativeThumbnail({ image, sourceAvailable, title, width, height, locale }: { image: string | null; sourceAvailable: boolean; title: string; width: number; height: number; locale: Locale }) {
  const [failed, setFailed] = useState(false);
  return <div className="lsr-creative-image">{image && !failed ? <Image src={image} alt={title} width={width} height={height} unoptimized referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : <span>{sourceAvailable ? word(locale, "Thumbnail unavailable; open the source asset", "התמונה הממוזערת אינה זמינה; אפשר לפתוח את קובץ המקור") : word(locale, "No verified thumbnail", "אין תמונה ממוזערת מאומתת")}<br />{width} × {height}</span>}</div>;
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

export function MarketingDashboard({ locale, snapshot, initialSection, initialFilter, initialMonth, calendarQuery, creativeQuery, renderedAt }: { locale: Locale; snapshot: MarketingSnapshot; initialSection?: string | undefined; initialFilter?: string | undefined; initialMonth?: string | undefined; calendarQuery?:ContentCalendarQuery|undefined;creativeQuery?:CreativeQuery|undefined; renderedAt: string }) {
  const section = sections.find(value => value === initialSection) ?? "overview";
  const h = headings[locale];
  const actual = snapshot.source === "provider_readback";
  const inventory = snapshot.inventory;
  const adsCurrency = snapshot.ads.find(ad => ad.currency)?.currency ?? null;
  const workbook = safeMarketingUrl(snapshot.workbookUrl ?? null, ["docs.google.com"]);
  const inventoryCards = inventory ? [
    ["he_status", word(locale, "Hebrew WhatsApp Status", "סטטוס WhatsApp בעברית"), inventory.heStatusReady, "content_calendar"],
    ["he_feed", word(locale, "Hebrew Facebook feed", "פיד Facebook בעברית"), inventory.heFeedReady, "creatives"],
    ["en_feed", word(locale, "English Facebook feed", "פיד Facebook באנגלית"), inventory.enFeedReady, "creatives"],
    ["all", word(locale, "Publishable posts", "פוסטים מוכנים לפרסום"), inventory.publishablePosts, "creatives"],
    ["queued", word(locale, "Queued", "בתור"), inventory.queued, "content_calendar"],
    ["published", word(locale, "Published", "פורסמו"), inventory.published, "content_calendar"],
  ] as const : [];
  const filters=creativeFilters({filter:initialFilter,...creativeQuery},section==='needs_approval');
  const visibleCreatives=filterCreatives(snapshot.creatives,filters);
  const actionableLoaded=filterCreatives(snapshot.creatives,creativeFilters({},true)).length;
  const creativeDestination=section==='needs_approval'?'creatives':section,clearCreativeHref=`/${locale}/app/marketing?section=${creativeDestination}${section==='needs_approval'?'&approval=needs_approval':''}`;
  const placementLabels={all:word(locale,'All placements','כל המיקומים'),facebook_feed:word(locale,'Facebook feed','פיד Facebook'),whatsapp_status:word(locale,'WhatsApp Status','סטטוס WhatsApp'),instagram_feed:word(locale,'Instagram feed','פיד Instagram'),other:word(locale,'Other registered placement','מיקום רשום אחר')};
  const approvalLabels={all:word(locale,'All approval states','כל מצבי האישור'),needs_approval:word(locale,'Needs approval','דורש אישור'),approved:word(locale,'Approved exact version','הגרסה המדויקת מאושרת'),retired:word(locale,'Retired','הוצא משימוש'),rejected:word(locale,'Rejected','נדחה'),unknown:word(locale,'Unknown approval state','מצב אישור לא ידוע')};
  return <section className="lsr">
    <header className="lsr-page-heading"><h1>{word(locale, "Marketing", "שיווק")}</h1><details className="lsr-source-detail" open={section==='overview'}><summary>{word(locale,'Sources and verification','מקורות ואימות')}</summary><p>{word(locale, "Actual creative inventory, publishing records and direct Meta account readback. No client records or leads appear here.", "מלאי קריאייטיב, רשומות פרסום וקריאה ישירה מחשבון Meta. אין כאן רשומות לקוחות או לידים.")}</p><p className="lsr-status">{actual ? word(locale, "Live readback available; provider acceptance and confirmed publication remain distinct.", "זמינה קריאה חיה; קבלת הספק ואישור פרסום מוצגים בנפרד.") : word(locale, "One or more live readbacks are unavailable.", "קריאה חיה אחת או יותר אינה זמינה.")}</p></details>{snapshot.connectionErrors?.map(error => <p role="status" className="lsr-inline-error" key={error}>{error === "direct_meta_readback_unavailable" ? word(locale, "Direct Meta metrics are temporarily unavailable.", "נתוני Meta הישירים אינם זמינים כרגע.") : word(locale, "Creative inventory is temporarily unavailable.", "מלאי הקריאייטיב אינו זמין כרגע.")}</p>)}</header>
    {section === "overview" && <>
      <div className="lsr-summary-grid">{inventoryCards.map(([filter, label, value, destination]) => <Section title={label} key={filter}><a className="lsr-stat-link" href={filter==="he_status"?`/${locale}/app/marketing?section=content_calendar&filter=queued&channel=whatsapp_status&layout=agenda`:`/${locale}/app/marketing?section=${destination}&filter=${filter}`} aria-label={`${label}: ${value}`}><strong className="lsr-stat">{value}</strong><span>{word(locale, "View records", "הצגת הרשומות")}</span></a></Section>)}</div>
      {inventory && <Section title={word(locale, "Inventory meaning", "משמעות המלאי")}><p>{word(locale, `${inventory.files} registered files represent ${inventory.concepts} concepts; files, concepts, publishable posts and placements are counted separately.`, `${inventory.files} קבצים רשומים מייצגים ${inventory.concepts} רעיונות; קבצים, רעיונות, פוסטים מוכנים ומיקומים נספרים בנפרד.`)}</p><p><a href={`/${locale}/app/marketing?section=creatives&approval=needs_approval`}>{word(locale, "Needs approval in loaded revisions", "דורש אישור בגרסאות שנטענו")}: {actionableLoaded}</a> · {word(locale, "Needs resize or caption", "דורש התאמת גודל או כיתוב")}: {inventory.needsResizeOrCaption} · {word(locale, "Held or missing", "בהשהיה או חסר")}: {inventory.heldMissing}</p><p><time>{inventory.asOf}</time>{inventory.partial ? ` · ${word(locale, "Partial inventory; unknown is not zero", "מלאי חלקי; לא ידוע אינו אפס")}` : ""}</p>{workbook && <a href={workbook} target="_blank" rel="noopener noreferrer">{word(locale, "Open source workbook", "פתיחת חוברת המקור")}</a>}</Section>}
    </>}
    {section === "ads" && <Section title={word(locale, "Ads — direct Meta read only", "מודעות — קריאה ישירה מ-Meta בלבד")}>
        {!snapshot.ads.length ? <p>{word(locale, "No direct Meta snapshots are available.", "אין כרגע נתונים ישירים מ-Meta.")}</p> : snapshot.ads.map(ad => { const manageUrl = safeMarketingUrl(ad.manageUrl, ["adsmanager.facebook.com", "business.facebook.com"]); return <article className="lsr-ad-row" key={ad.id}><h3>{ad.name}</h3><p>Meta · {ad.status} · {ad.endDate ? `${word(locale, "Ends", "מסתיים")} ${ad.endDate}` : word(locale, "Ongoing — no scheduled end", "מתמשך — ללא מועד סיום מתוזמן")}</p><div className="lsr-metric-row"><span>{word(locale, "Spend", "הוצאה")}: <strong>{currency(locale, ad.currency, ad.spendMinor)}</strong></span><span>{word(locale, "Impressions", "חשיפות")}: <strong>{ad.impressions ?? "—"}</strong></span><span>{word(locale, "Reach", "תפוצה")}: <strong>{ad.reach ?? "—"}</strong></span><span>{word(locale, "Link clicks", "קליקים על קישור")}: <strong>{ad.linkClicks ?? "—"}</strong></span><span>CTR: <strong>{ad.linkCtr === null || ad.linkCtr === undefined ? "—" : `${ad.linkCtr.toFixed(2)}%`}</strong></span><span>{ad.providerResultLabel ?? word(locale, "Provider results", "תוצאות ספק")}: <strong>{ad.providerResults ?? "—"}</strong></span></div><p>{word(locale, "Updated through", "עודכן עד")}: {ad.asOf ?? word(locale, "Not verified", "לא אומת")}</p>{manageUrl && <a href={manageUrl} target="_blank" rel="noopener noreferrer">{word(locale, "Open Meta Ads Manager", "פתיחת מנהל המודעות של Meta")}</a>}</article>; })}
        {!!snapshot.adSeries?.length && <div className="lsr-chart-grid"><MetricBars locale={locale} points={snapshot.adSeries} metric="spendMinor" currencyCode={adsCurrency}/><MetricBars locale={locale} points={snapshot.adSeries} metric="linkClicks" currencyCode={adsCurrency}/></div>}
    </Section>}
    {(section === "creatives" || section === "needs_approval") && <Section title={h[section]}>
      <form method="get" action={`/${locale}/app/marketing`} className="lsr-creative-filters" aria-label={word(locale,'Creative filters','סינון קריאייטיב')}>
        <input type="hidden" name="section" value={creativeDestination}/>{section==='needs_approval'&&<input type="hidden" name="approval" value="needs_approval"/>}
        <label>{word(locale,'Language','שפה')}<select name="language" defaultValue={filters.language}><option value="all">{word(locale,'All languages','כל השפות')}</option><option value="he">{word(locale,'Hebrew','עברית')}</option><option value="en">{word(locale,'English','אנגלית')}</option></select></label>
        <label>{word(locale,'Placement','מיקום')}<select name="placement" defaultValue={filters.placement}>{creativePlacements.map(value=><option key={value} value={value}>{placementLabels[value]}</option>)}</select></label>
        {section==='creatives'&&<label>{word(locale,'Approval','אישור')}<select name="approval" defaultValue={filters.approval}>{creativeApprovals.map(value=><option key={value} value={value}>{approvalLabels[value]}</option>)}</select></label>}
        <label>{word(locale,'Search assets','חיפוש נכסים')}<input type="search" name="search" maxLength={200} defaultValue={filters.search}/></label>
        <div className="lsr-creative-filter-actions"><button type="submit">{word(locale,'Apply filters','החלת סינון')}</button><a href={clearCreativeHref}>{word(locale,'Clear filters','ניקוי סינון')}</a></div>
      </form>
      <p className="lsr-creative-counts" role="status">{word(locale,`${visibleCreatives.length} revisions · ${new Set(visibleCreatives.map(asset=>`${asset.locale}:${asset.width}x${asset.height}`)).size} language/size variants`,`${visibleCreatives.length} גרסאות · ${new Set(visibleCreatives.map(asset=>`${asset.locale}:${asset.width}x${asset.height}`)).size} שילובי שפה וגודל`)}{inventory?.partial?` · ${word(locale,'Partial inventory','מלאי חלקי')}`:''}</p>
      <div className="lsr-creative-grid">{visibleCreatives.map(asset => { const image = safeMarketingUrl(driveThumbnail(asset.imageUrl), ["drive.google.com", "lh3.googleusercontent.com"]); const source = safeMarketingUrl(asset.sourceUrl ?? null, ["drive.google.com", "docs.google.com", "github.com"]) ?? safeMarketingUrl(asset.imageUrl, ["drive.google.com", "docs.google.com", "github.com"]);const state=creativeReviewState(asset); return <article className="lsr-creative-card" key={`${asset.assetId}:${asset.revision}:${asset.contentDigest}`}><CreativeThumbnail key={`${asset.assetId}:${asset.revision}:${asset.imageUrl}`} image={image} sourceAvailable={source !== null} title={asset.title} width={asset.width} height={asset.height} locale={locale}/><h3>{asset.title}</h3><p>{asset.locale.toUpperCase()} · {asset.surface ?? word(locale,'No registered placement','אין מיקום רשום')} · {asset.width}×{asset.height} · v{asset.revision}</p><p>{state==='unapproved'?asset.holdReason??word(locale,'Needs review of this exact version','נדרשת בדיקת הגרסה המדויקת'):approvalLabels[state]}</p>{source && <a href={source} target="_blank" rel="noopener noreferrer">{word(locale, "Open asset", "פתיחת הנכס")}</a>}</article>; })}</div>
      {!visibleCreatives.length&&<p>{snapshot.connectionErrors?.includes('creative_inventory_unavailable')?word(locale,'The source could not be loaded. Retry this page; an unavailable source is not an empty inventory.','לא ניתן לטעון את המקור. אפשר לנסות שוב; מקור לא זמין אינו מלאי ריק.'):word(locale,'No registered revisions match these filters.','אין גרסאות רשומות המתאימות לסינון.')} <a href={clearCreativeHref}>{word(locale,'Clear filters','ניקוי סינון')}</a></p>}
      {inventory&&<details className="lsr-creative-inventory"><summary>{word(locale,'Files, concepts and usable posts','קבצים, רעיונות ופוסטים שמישים')}</summary><p>{word(locale,`${inventory.files} registered files · ${inventory.concepts} concepts · ${inventory.publishablePosts} publishable posts`,`${inventory.files} קבצים רשומים · ${inventory.concepts} רעיונות · ${inventory.publishablePosts} פוסטים מוכנים לפרסום`)}</p><p>{word(locale,'Loaded revisions and language/size combinations are not ready-post totals. Approval is bound to the exact digest; source edits never inherit approval.','גרסאות טעונות ושילובי שפה וגודל אינם מספר הפוסטים המוכנים. האישור קשור לתוכן המדויק; עריכה במקור אינה יורשת אישור.')}</p><time>{inventory.asOf}</time>{workbook&&<p><a href={workbook} target="_blank" rel="noopener noreferrer">{word(locale,'Open source workbook','פתיחת חוברת המקור')}</a></p>}</details>}
    </Section>}
    {section === "content_calendar" && <MarketingContentCalendar locale={locale} snapshot={snapshot}
      query={{filter:initialFilter,month:initialMonth,...calendarQuery}} renderedAt={renderedAt}
      thumbnail={asset=><CreativeThumbnail key={`${asset.assetId}:${asset.revision}:${asset.imageUrl}`}
        image={safeMarketingUrl(driveThumbnail(asset.imageUrl),["drive.google.com","lh3.googleusercontent.com"])}
        sourceAvailable={Boolean(safeMarketingUrl(asset.sourceUrl??asset.imageUrl??null,["drive.google.com","docs.google.com","github.com"]))}
        title={asset.title} width={asset.width} height={asset.height} locale={locale}/>} />}
    {section === "community" && <Section title={h[section]}><CommunityReplyWorkspace locale={locale} /></Section>}
  </section>;
}
