import {createHash} from "node:crypto";
import {actionText,type OwnerDigest} from "./model.ts";
import {dateOnly} from "../contact-ops/core/validation.ts";
export const OWNER_REPORT_RECIPIENT="sdratler@gmail.com";
const escape=(value:unknown)=>String(value).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;");
export function ownerReportDateKey(date:string,recipient=OWNER_REPORT_RECIPIENT,subject="Life Skills daily overview"){
 if(!dateOnly(date)||recipient.toLowerCase()!==OWNER_REPORT_RECIPIENT||!["Life Skills daily overview","Life Skills follow-ups"].includes(subject))throw Error("INVALID_OWNER_REPORT_IDENTITY");
 // Both subject aliases represent the SAME report during the existing handover.
 return createHash("sha256").update(JSON.stringify(["life-skills-owner-daily-v1",recipient.toLowerCase(),date])).digest("hex");
}
/** Prepared email only. No sender, cron, tracking pixel or provider dependency. */
export function ownerDigestEmail(d:OwnerDigest,origin:string,locale:"he"|"en"){
 const base=new URL(origin);if(base.protocol!=="https:"||base.username||base.password||base.search||base.hash||base.pathname!=="/")throw Error("INVALID_REPORT_ORIGIN");
 const word=(en:string,he:string)=>locale==="he"?he:en,unknown=word("Unknown","לא ידוע"),value=(n:number|null|undefined)=>n??unknown;
 const money=(n:number|null)=>n===null||!d.ads.currency?unknown:new Intl.NumberFormat(locale,{style:"currency",currency:d.ads.currency}).format(n/100);
 const link=(path:string)=>new URL(`/${locale}/app/${path}`,base).href;
 const lines:string[]=[`Life Skills — ${d.reportDate} (${d.timezone})`,word("Needs your attention","דורש תשומת לב"),...d.actions.map(code=>actionText[locale][code])];
 const sections:{title:string;rows:[string,string|number][];path:string}[]=[
  {title:word("Follow-ups and intake","מעקב וקליטה"),path:"clients?section=prospects",rows:[
   [word("Due today","לטיפול היום"),value(d.followups?.data.due)],[word("Overdue","באיחור"),value(d.followups?.data.overdue)],
   [word("Missing date","תאריך חסר"),value(d.followups?.data.missingDate)],[word("Invalid date","תאריך לא תקין"),value(d.followups?.data.invalidDate)],
   [word("Forms awaiting submission — intake ledger","טפסים הממתינים להגשה — רישום הטפסים"),value(d.followups?.data.awaitingForm)],
   [word("Awaiting verified payment","ממתינים לתשלום מאומת"),value(d.followups?.data.awaitingPayment)],
   [word("Verified payment; booking not confirmed","תשלום מאומת; התיאום לא אושר"),value(d.followups?.data.awaitingBooking)]]},
  {title:word("Internal tasks — excluding linked CRM follow-ups","משימות פנימיות — ללא מעקב CRM מקושר"),path:"calendar",rows:[[word("Due today","לטיפול היום"),value(d.tasks?.data.due)],[word("Overdue","באיחור"),value(d.tasks?.data.overdue)]]},
  {title:word("Content — usable posts, not image files","תוכן — פוסטים שמישים, לא קובצי תמונה"),path:"marketing?section=content_calendar",rows:[
   [word("Hebrew WhatsApp Status","סטטוס WhatsApp בעברית"),value(d.content.heStatusReady)],
   [word("Hebrew Facebook feed","פיד Facebook בעברית"),value(d.content.heFeedReady)],
   [word("English Facebook feed","פיד Facebook באנגלית"),value(d.content.enFeedReady)],
   [word("Publishable posts","פוסטים מוכנים לפרסום"),value(d.content.publishablePosts)],
   [word("Loaded ordered queue","התור המסודר שנטען"),value(d.content.queueCount)],
   [word("Next Hebrew Status","הסטטוס הבא בעברית"),d.content.nextStatus?`${d.content.nextStatus.at} · ${d.content.nextStatus.status}`:unknown],
   [word("Latest loaded queued time — not gap-free coverage","המועד האחרון בתור שנטען — לא כיסוי רצוף"),d.content.coverageThrough??unknown],
   [word("Provider-confirmed publications in loaded records","פרסומים מאומתים ברשומות שנטענו"),value(d.content.confirmedPublished)]]},
 ];
 const asOf=word("Readback as of","קריאה עדכנית למועד"),detail=(row:[string,string|number])=>`${row[0]}: ${row[1]}`;
 for(const section of sections)lines.push(section.title,...section.rows.map(detail),link(section.path));
 const periods=d.ads.periods.map(period=>({label:word(period.name==="yesterday"?"Yesterday":period.name==="last_seven"?"Last seven complete days":"Preceding seven complete days",period.name==="yesterday"?"אתמול":period.name==="last_seven"?"שבעת הימים המלאים האחרונים":"שבעת הימים המלאים הקודמים"),period}));
 lines.push(word("Ads — direct Meta read only","מודעות — קריאה ישירה מ-Meta בלבד"),`${asOf}: ${d.ads.asOf??unknown}; ${d.ads.currency??unknown}; ${d.ads.timezone??unknown}; ${d.ads.attribution??unknown}`,
  ...periods.map(({label,period})=>`${label} ${period.since} — ${period.until}: ${money(period.spendMinor)}; ${word("link clicks","קליקים על קישור")} ${value(period.linkClicks)}; ${word("Meta messaging conversations started","שיחות הודעות שהחלו ב-Meta")} ${value(period.providerResults)}`),
  ...d.ads.days.map(day=>`${day.date}: ${money(day.spendMinor)}; ${value(day.linkClicks)}`),link("marketing?section=ads"),word("Unknown is not zero. Conversations are not verified clients or payments.","לא ידוע אינו אפס. שיחות אינן לקוחות או תשלומים מאומתים."),
  `${word("Report preview only; existing sender handover not verified","תצוגת דוח בלבד; העברת השולח הקיים לא אומתה")} · 08:00 Asia/Jerusalem`);
 const rows=(items:readonly [string,string|number][])=>`<table style="width:100%;border-collapse:collapse">${items.map(([label,n])=>`<tr><th style="text-align:start;padding:6px;font-weight:600">${escape(label)}</th><td style="padding:6px;text-align:end">${escape(n)}</td></tr>`).join("")}</table>`;
 const charts=(key:"spendMinor"|"linkClicks")=>{const max=Math.max(1,...d.ads.days.map(day=>day[key]??0));return `<h3>${escape(key==="spendMinor"?word("Spend by complete local day","הוצאה לפי יום מקומי מלא"):word("Link clicks by complete local day","קליקים על קישור לפי יום מקומי מלא"))}</h3><table style="width:100%">${d.ads.days.map(day=>`<tr><td>${escape(day.date)}</td><td style="width:45%">${day[key]===null?escape(unknown):`<div style="background:#007d83;height:12px;width:${Math.round(day[key]!/max*100)}%"></div>`}</td><td>${escape(key==="spendMinor"?money(day.spendMinor):value(day.linkClicks))}</td></tr>`).join("")}</table>`;};
 const html=`<!doctype html><html lang="${locale}" dir="${locale==="he"?"rtl":"ltr"}"><body style="margin:0;background:#fff;color:#173638;font:17px/1.55 Arial,sans-serif"><main style="max-width:640px;margin:auto;padding:20px"><h1 style="font-size:25px">Life Skills — ${escape(d.reportDate)}</h1><p>${escape(d.timezone)} · ${escape(d.asOf)}</p><h2>${escape(word("Needs your attention","דורש תשומת לב"))}</h2>${d.actions.map(code=>`<p>${escape(actionText[locale][code])}</p>`).join("")}${sections.map(section=>`<h2 style="font-size:21px">${escape(section.title)}</h2>${rows(section.rows)}<p><a href="${escape(link(section.path))}">${escape(word("Open signed-in app","פתיחת האפליקציה לאחר כניסה"))}</a></p>`).join("")}<h2>${escape(word("Ads — direct Meta read only","מודעות — קריאה ישירה מ-Meta בלבד"))}</h2><p>${escape(`${asOf}: ${d.ads.asOf??unknown}; ${d.ads.currency??unknown}; ${d.ads.timezone??unknown}; ${d.ads.attribution??unknown}`)}</p>${periods.map(({label,period})=>`<h3>${escape(`${label} ${period.since} — ${period.until}`)}</h3>${rows([[word("Spend","הוצאה"),money(period.spendMinor)],[word("Link clicks","קליקים על קישור"),value(period.linkClicks)],[word("Meta messaging conversations started","שיחות הודעות שהחלו ב-Meta"),value(period.providerResults)]])}`).join("")}${charts("spendMinor")}${charts("linkClicks")}<p>${escape(word("Unknown is not zero. Conversations are not verified clients or payments.","לא ידוע אינו אפס. שיחות אינן לקוחות או תשלומים מאומתים."))}</p><p>${escape(word("Prepared preview only. Existing sender handover and delivery are not verified.","תצוגה מוכנה בלבד. העברת השולח הקיים והמסירה לא אומתו."))}</p></main></body></html>`;
 return {recipient:OWNER_REPORT_RECIPIENT,subject:`Life Skills daily overview — ${d.reportDate}`,dateKey:ownerReportDateKey(d.reportDate),html,text:lines.join("\n"),sendEnabled:false as const};
}
