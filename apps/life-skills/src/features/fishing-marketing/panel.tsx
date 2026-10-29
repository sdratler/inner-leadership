import Image from "next/image";
import type {Locale} from "../../lib/locale.ts";
import type {FishingMarketingSnapshot} from "./contract.ts";
import type {TaggedInquiryPage} from "./attribution-store.ts";
import {filterFishingRecords,marketingFilters} from "./filters.ts";

type Readback={snapshot:FishingMarketingSnapshot;receivedAt:string}|null;
function status(locale:Locale,value:string,evidence:string){
 const labels:Record<string,[string,string]>={ready:["Ready for review","מוכן לבדיקה"],submitted:["Submitted; awaiting outcome","נשלח; ממתין לתוצאה"],moderator_pending:["Pending moderator review","ממתין לאישור מנהל הקבוצה"],pending_admin_approval:["Pending moderator review","ממתין לאישור מנהל הקבוצה"],participation_review_required:["Participation review required","נדרשת בדיקת השתתפות"],unknown:["Unknown; reconcile before retry","לא ידוע; יש לבדוק לפני ניסיון נוסף"],submission_unknown:["Unknown; reconcile before retry","לא ידוע; יש לבדוק לפני ניסיון נוסף"],failed:["Failed","נכשל"],skipped:["Skipped","דולג"],complaint:["Held after complaint","בהשהיה בעקבות תלונה"],removed:["Held after removal","בהשהיה בעקבות הסרה"],manually_reported:["Reported by operator; not independently verified","דווח על ידי המפעיל; לא אומת באופן עצמאי"]};
 if(evidence==="browser_readback")return locale==="he"?"פורסם; אומת בדפדפן":"Published; browser readback verified";
 if(evidence==="operator_recorded_readback")return locale==="he"?"דווח שאומת על ידי המפעיל":"Operator recorded readback";
 return labels[value]?.[locale==="he"?1:0]??(locale==="he"?"התוצאה לא אומתה":"Outcome unverified");
}
export function FishingMarketingPanel({locale,data,unavailable=false,creative=null,attribution=null,attributionUnavailable=false,filters={},section="overview"}:{locale:Locale;data:Readback;unavailable?:boolean;creative?:{path:string;sha256:string;width:number;height:number}|null;attribution?:TaggedInquiryPage|null;attributionUnavailable?:boolean;filters?:{program?:unknown;channel?:unknown;state?:unknown};section?:string}){
 const t=(en:string,he:string)=>locale==="he"?he:en;
 if(unavailable)return <section className="lsw-card" role="status"><h2>{t("Fishing group preparation","הכנת פרסומים לקבוצות דיג")}</h2><p>{t("The scheduler readback is unavailable.","קריאת נתוני המתזמן אינה זמינה.")}</p></section>;
 if(!data)return <section className="lsw-card" role="status"><h2>{t("Fishing group preparation","הכנת פרסומים לקבוצות דיג")}</h2><p>{t("Waiting for the first scheduler sync.","ממתינים לסנכרון הראשון של המתזמן.")}</p></section>;
 const s=data.snapshot,groups=new Map(s.targets.map(target=>[target.id,target])),selected=marketingFilters(filters);
 const visible=selected.program!=="bna"&&(selected.channel==="all"||selected.channel==="groups"),records=filterFishingRecords(s,selected.state);
 return <section className="lsw-card lsw-stack" lang={locale} dir={locale==="he"?"rtl":"ltr"}>
  <h2>{t("Program marketing","שיווק לפי תוכנית")}</h2>
  <form method="get" className="lsw-stack"><input type="hidden" name="section" value={section}/>
   <label>{t("Program","תוכנית")} <select name="marketingProgram" defaultValue={selected.program}><option value="all">{t("All authorized programs","כל התוכניות המורשות")}</option><option value="fishing">Fishing</option><option value="bna">BNA</option></select></label>
   <label>{t("Channel","ערוץ")} <select name="marketingChannel" defaultValue={selected.channel}><option value="all">{t("All channels","כל הערוצים")}</option><option value="groups">Facebook Groups</option><option value="page">Facebook Page</option><option value="other">{t("Other configured channels","ערוצים מוגדרים אחרים")}</option></select></label>
   <label>{t("State","מצב")} <select name="marketingState" defaultValue={selected.state}><option value="all">{t("All states","כל המצבים")}</option><option value="draft">{t("Draft / ready","טיוטה / מוכן")}</option><option value="scheduled">{t("Scheduled","מתוזמן")}</option><option value="pending">{t("Pending","ממתין")}</option><option value="published">{t("Published with readback","פורסם ואומת")}</option><option value="problem">{t("Problem / unknown","בעיה / לא ידוע")}</option></select></label>
   <button type="submit">{t("Apply filters","החלת מסננים")}</button></form>
  {selected.program!=="fishing"&&<p role="status">{t("BNA marketing is not connected yet.","שיווק BNA עדיין אינו מחובר.")}</p>}
  {selected.channel!=="all"&&selected.channel!=="groups"&&<p role="status">{t("This channel is not connected to the Fishing group queue.","ערוץ זה אינו מחובר לתור קבוצות הדיג.")}</p>}
  {visible&&<><h3>{t("Fishing group preparation","הכנת פרסומים לקבוצות דיג")}</h3>
  <p>{t("Assisted posting: review and publish each post yourself.","פרסום בסיוע: יש לבדוק ולפרסם כל פוסט באופן ידני.")}</p>
  <p>{t("Last scheduler snapshot","נתוני המתזמן האחרונים")}: <bdi><time dateTime={s.generatedAt}>{s.generatedAt}</time></bdi> · {t("Received","התקבל")}: <bdi><time dateTime={data.receivedAt}>{data.receivedAt}</time></bdi>. {t("A missing update can mean the Windows host is offline.","היעדר עדכון עשוי להעיד שמחשב Windows אינו פעיל.")}</p>
  <p>{s.schedule.enabled?t("Scheduler enabled","המתזמן פעיל"):t("Scheduler paused","המתזמן מושהה")} · {s.schedule.funnelReady?t("Funnel gate open","שער הפניות פתוח"):t("Funnel gate held","שער הפניות בהשהיה")} · {t("Daily cap","מגבלה יומית")}: {s.schedule.dailyCap} · {t("Same-group cooldown","מרווח לאותה קבוצה")}: {s.schedule.cooldownDays} {t("days","ימים")}</p>
  <p>{t("Next preparation window","חלון ההכנה הבא")}: <bdi><time dateTime={s.schedule.nextDue}>{s.schedule.nextDue}</time></bdi> ({s.schedule.timezone})</p>
  <details><summary>{t("Groups and approved captions","קבוצות וכיתובים מאושרים")}</summary>
   <ul>{s.targets.map(group=><li key={group.id}><a href={group.url} target="_blank" rel="noreferrer">{group.name||group.id}</a> · {group.hold?status(locale,group.hold,"unverified"):group.eligible?t("Eligible for preparation","זמינה להכנה"):t("Held for review","בהשהיה לבדיקה")}</li>)}</ul>
   {s.assets.map(asset=><article key={asset.id}><h3>{asset.language.toUpperCase()}</h3><p style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}} dir="auto">{asset.caption}</p>{creative&&creative.sha256===asset.imageSha256?<Image src={creative.path} alt={t("Approved Fishing Academy image","תמונה מאושרת של אקדמיית הדיג")} width={creative.width} height={creative.height} unoptimized style={{maxWidth:"100%",height:"auto"}}/>:<p>{t("Exact approved image unavailable.","התמונה המאושרת המדויקת אינה זמינה.")}</p>}</article>)}
  </details>
  <details><summary>{t("Recorded inquiry links","קישורים מתועדים לפניות")}</summary>
   <p>{t("Links require matching group and post tags on an inquiry. Tags do not prove the post caused the inquiry.","קישור דורש תגי קבוצה ופוסט תואמים בפנייה. התגים אינם מוכיחים שהפוסט גרם לפנייה.")}</p>
   {attributionUnavailable?<p role="status">{t("Inquiry links are unavailable; this does not mean there are no matches.","קישורי הפניות אינם זמינים; אין פירוש הדבר שאין התאמות.")}</p>:attribution&&<>
    {!attribution.links.length&&<p>{t("No exact matches in this batch.","אין התאמות מדויקות באצווה זו.")}</p>}
    <ul>{attribution.links.map(link=><li key={`${link.applicationId}/${link.postUrl}`}><a href={`/${locale}/app/group-applications?${new URLSearchParams({inquiryId:link.applicationId})}`}>{t("Open inquiry","פתיחת פנייה")} <bdi>{link.applicationId}</bdi></a> · <a href={link.postUrl} target="_blank" rel="noreferrer">{t("Open verified post","פתיחת פוסט מאומת")}</a></li>)}</ul>
    {attribution.nextCursor&&<a href={`?${new URLSearchParams({section,marketingProgram:selected.program,marketingChannel:selected.channel,marketingState:selected.state,linkCursor:attribution.nextCursor})}`}>{t("Check next batch of inquiries","בדיקת אצוות הפניות הבאה")}</a>}
   </>}
  </details>
  <details><summary>{t("Queue and publication history","תור והיסטוריית פרסום")}</summary>
   {!records.items.length&&!records.history.length&&<p>{t("No matching queue or delivery records in this snapshot.","אין רשומות תור או מסירה תואמות בנתונים אלו.")}</p>}
   {records.items.length>0&&<><h3>{t("Prepared queue","תור מוכן")}</h3><ul>{records.items.map(item=><li key={`${item.day}/${item.groupId}`}><bdi>{item.day}</bdi> · {groups.get(item.groupId)?.name??item.groupId} · {status(locale,item.state,item.publicationEvidence)} · {t("Personal profile ID","מזהה פרופיל אישי")}: <bdi>{item.actorProfileId??t("not recorded","לא תועד")}</bdi> {item.postUrl&&<a href={item.postUrl} target="_blank" rel="noreferrer">{t("Open post","פתיחת הפוסט")}</a>}</li>)}</ul></>}
   {records.history.length>0&&<><h3>{t("Delivery ledger","יומן מסירות")}</h3><ul>{records.history.map(item=><li key={item.id}><bdi>{item.recordedAt}</bdi> · {groups.get(item.groupId)?.name??item.groupId} · {status(locale,item.state,item.publicationEvidence)} · {t("Recorded identity","זהות שתועדה")}: <bdi>{item.identity}</bdi> ({t("account ID not recorded","מזהה החשבון לא תועד")}) {item.postUrl&&<a href={item.postUrl} target="_blank" rel="noreferrer">{t("Open post","פתיחת הפוסט")}</a>}</li>)}</ul></>}
   {(!s.historyAvailable||s.historyTruncated||s.itemsTruncated)&&<p role="status">{t("Some history is unavailable or truncated; check the scheduler.","חלק מההיסטוריה אינה זמינה או נקטעה; יש לבדוק את המתזמן.")}</p>}
  </details></>}
 </section>;
}
