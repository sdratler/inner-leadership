import type {Locale} from '../../lib/locale.ts';
import type {FishingMarketingLocalSnapshot} from './contract.ts';
import type {TaggedInquiryPage} from './attribution-store.ts';

type Outcome='published'|'pending'|'declined'|'unknown'|'other';
export function localOutcome(record:{state:string;publicationEvidence:string}):Outcome{
 if(record.publicationEvidence==='browser_readback'&&record.state==='published_browser_readback_verified')return 'published';
 if(['pending_admin_approval','moderator_pending','submitted'].includes(record.state))return 'pending';
 if(record.state==='declined_by_group')return 'declined';
 if(['submission_unknown','unknown'].includes(record.state))return 'unknown';
 return 'other';
}
export function localWorkerView(snapshot:FishingMarketingLocalSnapshot,renderedAt:number){
 const age=renderedAt-Date.parse(snapshot.generatedAt),fresh=Number.isFinite(age)&&age>=-300_000&&age<=90*60_000,w=snapshot.worker;
 const loginRecent=w.login.state==='verified'&&w.login.checkedAt!==null&&renderedAt-Date.parse(w.login.checkedAt)<=15*60_000&&fresh;
 const status=!snapshot.schedule.enabled?'paused':!snapshot.schedule.funnelReady?'funnel_held':w.login.state==='needs_login'?'needs_login':w.account.state==='held'?'held':!fresh?'stale':w.account.state==='unknown'?'unknown':w.slot==='reconcile_submission'?'reconcile':w.publisher==='busy'?'running':w.publisher==='idle'?'idle':'unknown';
 const counts={published:0,pending:0,declined:0,unknown:0,other:0};
 for(const record of snapshot.history)counts[localOutcome(record)]++;
 return {fresh,loginRecent,status,counts,due:snapshot.targets.filter(g=>g.campaign.status==='due').length};
}
const outcomeWords:Record<Outcome,[string,string]>={published:['Confirmed publication','פרסום שאומת'],pending:['Pending moderator approval','ממתין לאישור מנהל הקבוצה'],declined:['Declined by group','נדחה על ידי הקבוצה'],unknown:['Unknown — reconcile before retry','לא ידוע — יש לבדוק לפני ניסיון נוסף'],other:['Other recorded outcome','תוצאה מתועדת אחרת']};
const workerWords:Record<string,[string,string]>={paused:['Local campaign paused','הקמפיין המקומי מושהה'],funnel_held:['Inquiry gate held','שער הפניות בהשהיה'],needs_login:['Facebook account needs attention','נדרשת בדיקה של חשבון פייסבוק'],held:['Account safety hold','השהיית בטיחות בחשבון'],stale:['Local computer may be offline','ייתכן שהמחשב המקומי אינו פעיל'],reconcile:['Submission needs reconciliation','נדרשת בדיקת תוצאת שליחה'],running:['Publisher last reported running','המפרסם דיווח לאחרונה שהוא פועל'],idle:['Publisher last reported idle','המפרסם דיווח לאחרונה שאינו פועל'],unknown:['Worker state unknown','מצב המפרסם אינו ידוע']};
const groupWords:Record<string,[string,string]>={due:['Due under recorded rules','ניתן לפרסם לפי הכללים המתועדים'],cooldown:['Waiting for group interval','ממתינים למרווח הפרסום בקבוצה'],held:['Group held','הקבוצה בהשהיה'],reconcile:['Previous outcome needs review','התוצאה הקודמת דורשת בדיקה'],outside_window:['Outside posting hours','מחוץ לשעות הפרסום'],other_weekday:['Waiting for advertising day','ממתינים ליום הפרסום'],closed_weekday:['Group closed today','הקבוצה סגורה היום'],refresh_rules:['Rules need a fresh review','נדרשת בדיקה עדכנית של הכללים'],review_cadence:['Group rules need review','כללי הקבוצה דורשים בדיקה'],account_held:['Account held','החשבון בהשהיה'],account_guard_unknown:['Account safety state unknown','מצב בטיחות החשבון אינו ידוע']};
const runWords:Record<string,[string,string]>={running:['Running at last evidence','פעל במועד העדכון האחרון'],finished:['Finished','הסתיים'],needs_action:['Finished with groups needing review','הסתיים עם קבוצות הדורשות בדיקה'],stopped:['Stopped','נעצר'],interrupted:['End of run not recorded','סיום ההרצה לא תועד']};
const reasonWords:Record<string,[string,string]>={composer_unavailable:['The group composer did not open. Review that group locally before another attempt.','חלון הפרסום בקבוצה לא נפתח. יש לבדוק את הקבוצה במחשב המקומי לפני ניסיון נוסף.'],rules_changed:['Group rules changed and need review.','כללי הקבוצה השתנו ודורשים בדיקה.'],uncertain_submission:['A submission has no confirmed outcome. Reconcile it before retrying.','אין תוצאה מאומתת לשליחה. יש לבדוק אותה לפני ניסיון נוסף.'],browser_timeout:['The browser timed out; review the last attempt locally.','תם הזמן לפעולת הדפדפן; יש לבדוק את הניסיון האחרון במחשב המקומי.'],account_checkpoint:['Resolve Facebook’s account check manually on the local computer.','יש להשלים ידנית את בדיקת החשבון של פייסבוק במחשב המקומי.'],identity_review:['Confirm the intended personal profile manually on the local computer.','יש לאמת ידנית את הפרופיל האישי המתאים במחשב המקומי.'],account_warning:['Facebook reported an account warning. Review it locally before resuming.','פייסבוק הציג אזהרה בחשבון. יש לבדוק אותה במחשב המקומי לפני חידוש הפעילות.']};

export function FishingLocalWorkerPanel({locale,snapshot,receivedAt,renderedAt=Date.now(),state,section='overview',attribution,attributionUnavailable=false}:{
 locale:Locale;snapshot:FishingMarketingLocalSnapshot;receivedAt:string;renderedAt?:number;state?:unknown;section?:string;attribution?:TaggedInquiryPage|null;attributionUnavailable?:boolean
}){
 const t=(en:string,he:string)=>locale==='he'?he:en,word=(words:Record<string,[string,string]>,key:string)=>words[key]?.[locale==='he'?1:0]??t('Review required','נדרשת בדיקה');
 const s=snapshot,w=s.worker,view=localWorkerView(s,renderedAt),groups=new Map(s.targets.map(g=>[g.id,g]));
 const selected=typeof state==='string'&&['published','pending','declined','unknown','other'].includes(state)?state:'all';
 const records=s.history.filter(r=>selected==='all'||localOutcome(r)===selected);
 const targetSection=section==='content_calendar'?'content_calendar':'overview';
 const retry=`?${new URLSearchParams({section:targetSection,marketingState:selected})}`;
 const time=(date:string|null)=>date?<bdi><time dateTime={date}>{new Intl.DateTimeFormat(locale==='he'?'he-IL':'en-US',{timeZone:s.schedule.timezone,dateStyle:'medium',timeStyle:'short'}).format(new Date(date))}</time></bdi>:t('Not recorded','לא תועד');
 const days=(values:number[])=>values.length?values.map(day=>new Intl.DateTimeFormat(locale==='he'?'he-IL':'en-US',{weekday:'long',timeZone:'UTC'}).format(new Date(Date.UTC(2026,10,9+day)))).join(', '):t('No specific days recorded','לא תועדו ימים מסוימים');
 return <section className="lsw-card lsw-stack" lang={locale} dir={locale==='he'?'rtl':'ltr'} style={{overflowWrap:'anywhere'}}>
  <header><p className="lsw-eyebrow">{t('Fishing Academy · Facebook Groups','אקדמיית הדיג · קבוצות פייסבוק')}</p><h2>{t('Local publishing','פרסום מהמחשב המקומי')}</h2><p>{t('Personal-profile publishing runs on the local Windows computer.','הפרסום מהפרופיל האישי מתבצע במחשב Windows המקומי.')}</p></header>
  <div className="lsw-attention" role="status"><div><strong>{word(workerWords,view.status)}</strong><p>{!view.fresh?t('No recent update. The computer may be offline, or sync may be delayed.','לא התקבל עדכון לאחרונה. ייתכן שהמחשב אינו פעיל או שהסנכרון מתעכב.'):t('This is the last reported state, not a live connection to the computer.','זהו המצב האחרון שדווח, ללא חיבור חי למחשב.')}</p><p>{t('Observed','נצפה')}: {time(s.generatedAt)} · {t('Received','התקבל')}: {time(receivedAt)} · <bdi>{s.schedule.timezone}</bdi></p></div></div>
  <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,13rem),1fr))',gap:'1rem'}}>
   <article className="lsw-card"><h3>{t('Facebook login','כניסה לפייסבוק')}</h3><p>{w.login.state==='needs_login'?t('Manual account check required','נדרשת בדיקה ידנית של החשבון'):view.loginRecent?t('Verified at last check','אומת בבדיקה האחרונה'):t('Current login is unknown','מצב הכניסה הנוכחי אינו ידוע')}</p><p>{t('Last verified','אומת לאחרונה')}: {time(w.login.checkedAt)}</p></article>
   <article className="lsw-card"><h3>{t('Groups due','קבוצות שניתן לפרסם בהן')}</h3><p className="lsw-credit-number">{view.due}</p><p>{t('At the snapshot time, subject to account safety and unresolved submissions.','במועד העדכון, בכפוף לבטיחות החשבון ולבדיקת שליחות שתוצאתן אינה ידועה.')}</p></article>
   <article className="lsw-card"><h3>{t('Next planned wake','מועד ההפעלה המתוכנן הבא')}</h3><p>{time(w.nextWakeAt)}</p><p>{t('10 a.m. and 2 p.m. Florida time. Posting window: 10 a.m.–6 p.m.','10:00 ו־14:00 לפי שעון פלורידה. חלון הפרסום: 10:00–18:00.')}</p><p>{t('No total daily cap. Each group keeps its own rules and interval.','ללא מגבלה יומית כוללת. לכל קבוצה נשמרים הכללים ומרווח הפרסום שלה.')}</p></article>
  </div>
  <section className="lsw-stack"><h3>{t('Last run and evidence','ההרצה האחרונה והאסמכתאות')}</h3>
   {w.lastRun?<><p><strong>{word(runWords,w.lastRun.state)}</strong> · {t('Started','התחילה')}: {time(w.lastRun.startedAt)} · {t('Last evidence','אסמכתא אחרונה')}: {time(w.lastRun.evidenceAt)}</p>{w.lastRun.groupId&&<p>{t('Last recorded group','הקבוצה האחרונה שתועדה')}: <bdi>{groups.get(w.lastRun.groupId)?.name??w.lastRun.groupId}</bdi></p>}{w.lastRun.reason&&<p role="status">{word(reasonWords,w.lastRun.reason)}</p>}</>:<p>{t('No run evidence has been received. This does not mean no run occurred.','לא התקבלה אסמכתא להרצה. אין פירוש הדבר שלא התבצעה הרצה.')}</p>}
   {w.account.reason&&<p role="status">{word(reasonWords,w.account.reason)}</p>}
   {w.slot==='reconcile_submission'&&<p role="status">{word(reasonWords,'uncertain_submission')}</p>}
   {w.slot.includes('T')&&<p>{t('Pacing until','המתנה בין פרסומים עד')}: {time(w.slot)}</p>}
   <p>{t('Last completed run with a confirmed publication','ההרצה האחרונה שהסתיימה וכללה פרסום מאומת')}: {time(w.lastSuccessfulRunAt)}</p>
   <p>{t('Last confirmed publication','הפרסום המאומת האחרון')}: {time(w.lastConfirmedPublicationAt)}</p>
  </section>
  <details className="lsw-details"><summary>{t('Group rules and next eligible dates','כללי הקבוצות והמועדים הבאים')}</summary><div className="lsw-stack">
   <p>{t('Dates reflect recorded history. A due group is not a promised or scheduled post.','המועדים משקפים את ההיסטוריה המתועדת. זמינות של קבוצה אינה הבטחה לפרסום או פרסום מתוזמן.')}</p>
   {!s.targets.length&&<p>{t('No group rules were included in this snapshot.','לא נכללו כללי קבוצות בעדכון זה.')}</p>}
   {s.targets.map(g=><details className="lsw-details" key={g.id}><summary><bdi>{g.name||g.id}</bdi> · {word(groupWords,g.campaign.status)}</summary><div className="lsw-stack">
    <p><a href={g.url} target="_blank" rel="noreferrer">{t('Open group','פתיחת הקבוצה')}</a> · <a href={g.campaign.rulesUrl} target="_blank" rel="noreferrer">{t('Open group rules','פתיחת כללי הקבוצה')}</a></p>
    <p>{t('Next eligible time','המועד הבא שבו ניתן לשקול פרסום')}: {g.campaign.nextEligibleAt?time(g.campaign.nextEligibleAt):t('Not established; review the group state','לא נקבע; יש לבדוק את מצב הקבוצה')}</p>
    <p>{t('Minimum interval','מרווח מינימלי')}: {g.campaign.minimumGapDays} {g.campaign.interval==='calendar_days'?t('calendar days','ימים קלנדריים'):g.campaign.interval==='rolling_days'?t('full days since the last attempt','ימים מלאים מהניסיון האחרון'):t('days; interval needs review','ימים; נדרשת בדיקת המרווח')}</p>
    <p>{t('Advertising days','ימי פרסום')}: {days(g.campaign.advertisingDays)} · {t('Closed days','ימים סגורים')}: {days(g.campaign.closedDays)}</p>
    <p>{g.campaign.placement==='thread'?t('Use the designated thread only.','יש להשתמש רק בשרשור המיועד.'):g.eligible?t('Standalone posting admitted under the recorded rules.','פרסום עצמאי מאושר בכפוף לכללים המתועדים.'):t('Posting is held for review.','הפרסום בהשהיה עד לבדיקה.')}</p>
    <p dir="auto" style={{whiteSpace:'pre-wrap'}}>{g.campaign.ruleSummary}</p><p>{t('Rules checked','הכללים נבדקו')}: {time(g.campaign.rulesCheckedAt)} · {t('Last attempt','הניסיון האחרון')}: {time(g.campaign.lastAttemptAt)}</p>
   </div></details>)}
  </div></details>
  <section className="lsw-stack"><h3>{t('Recorded outcomes','תוצאות מתועדות')}</h3><p>{t('Counts cover the records included in this snapshot. Pending, declined and unknown are separate from confirmed publication.','הספירות מתייחסות לרשומות שנכללו בעדכון. המתנה לאישור, דחייה ותוצאה לא ידועה מוצגות בנפרד מפרסום מאומת.')}</p>
   <dl style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,10rem),1fr))',gap:'1rem'}}>{(['published','pending','declined','unknown'] as const).map(key=><div key={key}><dt>{word(outcomeWords,key)}</dt><dd className="lsw-credit-number" style={{marginInlineStart:0}}>{view.counts[key]}</dd></div>)}</dl>
   <form method="get" className="lsw-stack"><input type="hidden" name="section" value={targetSection}/><label htmlFor="fishing-outcome">{t('Filter outcomes','סינון תוצאות')}</label><select id="fishing-outcome" name="marketingState" defaultValue={selected}><option value="all">{t('All recorded outcomes','כל התוצאות המתועדות')}</option>{Object.keys(outcomeWords).map(key=><option key={key} value={key}>{word(outcomeWords,key)}</option>)}</select><button type="submit">{t('Apply filter','החלת מסנן')}</button></form>
   {!records.length&&<p role="status">{t('No matching outcomes in this snapshot.','אין תוצאות תואמות בעדכון זה.')}</p>}
   <ul className="lsw-stack">{records.map(r=><li key={r.id}><strong>{word(outcomeWords,localOutcome(r))}</strong> · <bdi>{groups.get(r.groupId)?.name??r.groupId}</bdi> · {time(r.recordedAt)}{r.postUrl&&<> · <a href={r.postUrl} target="_blank" rel="noreferrer">{r.publicationEvidence==='browser_readback'?t('Open verified post','פתיחת פוסט מאומת'):t('Open recorded link','פתיחת הקישור המתועד')}</a></>}</li>)}</ul>
   {s.historyTruncated&&<p role="status">{t('Earlier history was omitted. Check the local delivery ledger before retrying.','היסטוריה מוקדמת יותר לא נכללה. יש לבדוק את יומן המסירות המקומי לפני ניסיון נוסף.')}</p>}
  </section>
  <details className="lsw-details"><summary>{t('Manual fallback and approved text','חלופה ידנית והטקסט המאושר')}</summary><div className="lsw-stack">
   <p>{t('On the local computer, confirm the intended personal profile and resolve any account check. Review the group rules and existing outcome before posting manually. Keep unknown, pending or declined attempts held until reviewed.','במחשב המקומי יש לאמת את הפרופיל האישי המתאים ולטפל בבדיקות החשבון. לפני פרסום ידני יש לבדוק את כללי הקבוצה ואת תוצאת הניסיון הקודם. ניסיונות שתוצאתם אינה ידועה, ממתינים לאישור או נדחו נשארים בהשהיה עד לבדיקה.')}</p>
   <p>{t('The approved video is held on the local computer. This page cannot start, pause or resume the desktop worker.','הסרטון המאושר נמצא במחשב המקומי. עמוד זה אינו יכול להפעיל, להשהות או לחדש את המפרסם במחשב.')}</p>
   {s.creative.captions.map(c=><div key={c.language} className="lsw-stack"><label htmlFor={`fishing-copy-${c.language}`}>{c.language==='en'?t('Approved English text','הטקסט המאושר באנגלית'):t('Approved Hebrew text','הטקסט המאושר בעברית')}</label><textarea id={`fishing-copy-${c.language}`} readOnly rows={8} value={c.caption} dir={c.language==='he'?'rtl':'ltr'} lang={c.language} style={{inlineSize:'100%',maxInlineSize:'100%',boxSizing:'border-box'}}/></div>)}
   <a href={retry}>{t('Reload latest reported state','טעינת המצב המדווח האחרון')}</a>
  </div></details>
  <details className="lsw-details"><summary>{t('Recorded inquiry links','קישורים מתועדים לפניות')}</summary><div className="lsw-stack"><p>{t('Matching inquiry tags link a group and post; they do not prove causation.','תגים תואמים בפנייה מקשרים קבוצה ופוסט; הם אינם מוכיחים סיבתיות.')}</p>
   {attributionUnavailable?<p role="status">{t('Inquiry links are unavailable. This does not mean there are no matches.','קישורי הפניות אינם זמינים. אין פירוש הדבר שאין התאמות.')}</p>:!attribution?<p>{t('Inquiry links have not been loaded.','קישורי הפניות טרם נטענו.')}</p>:<>{!attribution.links.length&&<p>{t('No exact matches in this batch.','אין התאמות מדויקות באצווה זו.')}</p>}<ul>{attribution.links.map(link=><li key={`${link.applicationId}/${link.postUrl}`}><a href={`/${locale}/app/group-applications?${new URLSearchParams({inquiryId:link.applicationId})}`}>{t('Open inquiry','פתיחת פנייה')}</a> · <a href={link.postUrl} target="_blank" rel="noreferrer">{t('Open verified post','פתיחת פוסט מאומת')}</a></li>)}</ul>{attribution.nextCursor&&<a href={`?${new URLSearchParams({section:targetSection,marketingState:selected,linkCursor:attribution.nextCursor})}`}>{t('Check next batch of inquiries','בדיקת אצוות הפניות הבאה')}</a>}</>}
  </div></details>
 </section>;
}
