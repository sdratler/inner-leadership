import type {CommunityInboxPost} from "../community-inbox/bridge.ts";

type Locale="en"|"he";
const copy={
 en:{aid:"English reading aid",summary:"Convenience summary, not the source. The original excerpt remains authoritative.",
  missing:"No English reading aid is available for this post. Reading it does not run a paid analysis.",status:"Workflow status",captured:"Captured",comments:"Comments not captured"},
 he:{aid:"עזר קריאה באנגלית",summary:"תקציר עזר בלבד, לא המקור. הקטע המקורי נשאר המקור הקובע.",
  missing:"אין עזר קריאה באנגלית לפוסט הזה. קריאת הפוסט אינה מפעילה ניתוח בתשלום.",status:"מצב טיפול",captured:"נקלט",comments:"תגובות לא נקלטו"},
};
const statusLabels=new Map<string,readonly[string,string]>([
 ["new",["New","חדש"]],["ready",["Ready","מוכן"]],["replied",["Marked replied","סומן כנענה"]],
 ["follow_up",["Follow-up","מעקב"]],["lead",["Marked as a lead","סומן כפנייה"]],["skipped",["Skipped","דולג"]],
]);
/** Presentation only: unknown values and all stored/filter keys stay unchanged. */
export function communityStatusLabel(status:string,locale:Locale):string{
 const labels=statusLabels.get(status);return labels?.[locale==="he"?1:0]??status;
}
/** The aid stays English even on Hebrew routes; its controls/explanation do not. */
export function CommunityReadingAid({locale,lines}:{locale:Locale;lines:CommunityInboxPost["englishReadingAid"]}){
 const t=copy[locale];return <section className="lsr-reading-aid" lang={locale} dir={locale==="he"?"rtl":"ltr"} aria-label={t.aid}>
  <h4>{t.aid}</h4>{lines?.length?<><ul lang="en" dir="ltr">{lines.map((line,index)=><li key={index}>{line}</li>)}</ul>
   <p className="lsr-help">{t.summary}</p></>:<p className="lsr-help">{t.missing}</p>}
 </section>;
}
export function CommunityPostMetadata({locale,post}:{locale:Locale;post:Pick<CommunityInboxPost,"status"|"postedAt"|"capturedAt">}){
 const t=copy[locale];return <p className="lsr-help">{t.status}: <bdi>{communityStatusLabel(post.status,locale)}</bdi> · {t.captured}: <bdi>{post.postedAt??post.capturedAt??"—"}</bdi> · {t.comments}</p>;
}
