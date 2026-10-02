"use client";
import {useCallback,useEffect,useRef,useState} from 'react';
import type {Locale} from '../../lib/locale.ts';
import {IdentityClientError} from '../identity/client.ts';
import {markReminderRead,readReminders,reminderWasRead} from './client.ts';
import type {ReminderItem,ReminderPage} from './service.ts';
import {workspaceHref,type WorkspaceRole} from '../../ui/workspace/navigation-model.ts';
const words={
 en:{title:'Your reminders',loading:'Loading your reminders…',empty:'No current reminders.',failed:'Reminders could not be read. Previously loaded information has been cleared. Try again.',signedOut:'Your access could not be confirmed. Sign in again before reading reminders.',retry:'Try reading again',next:'Older reminders',previous:'Newer reminders',refresh:'Refresh reminders',more:'More due items are waiting. Refresh to check the next batch.',open:'Open this day in Calendar',mark:'Mark as read',read:'Read',saved:'Read status saved and verified.',uncertain:'The saved read status could not be verified. Check it or retry the same item before marking another.',verify:'Check saved read status',retryMark:'Retry this item',self:'Time for your practice',support:'Time to support this practice',remind_child:'Time to remind your child',in_app:'In-app',email:'Email',push:'Push',whatsapp:'WhatsApp',external:'External delivery is not active. A channel preference is not proof of a sent reminder.',blocked:'Not delivered',provider_not_configured:'Delivery connection is not configured.',channel_not_verified:'This channel has not been verified.',do_not_disturb:'Held by your quiet hours.',demo_external_denied:'DEMO: external delivery is disabled.'},
 he:{title:'התזכורות שלכם',loading:'טוען את התזכורות…',empty:'אין תזכורות פעילות.',failed:'לא ניתן לקרוא את התזכורות. המידע שנטען קודם נוקה. נסו שוב.',signedOut:'לא ניתן לאמת את הגישה שלכם. היכנסו שוב לפני קריאת התזכורות.',retry:'ניסיון קריאה נוסף',next:'תזכורות קודמות',previous:'תזכורות חדשות יותר',refresh:'רענון התזכורות',more:'יש פריטים נוספים שהגיע זמנם. רעננו לבדיקת המקבץ הבא.',open:'פתיחת היום הזה ביומן',mark:'סימון כנקרא',read:'נקרא',saved:'מצב הקריאה נשמר ואומת.',uncertain:'לא ניתן לאמת את מצב הקריאה השמור. בדקו אותו או נסו שוב עם אותו פריט לפני סימון פריט אחר.',verify:'בדיקת מצב הקריאה השמור',retryMark:'ניסיון נוסף עם הפריט הזה',self:'הגיע זמן התרגול שלכם',support:'הגיע הזמן לסייע בתרגול',remind_child:'הגיע הזמן להזכיר לילד',in_app:'באפליקציה',email:'דוא״ל',push:'התראת מכשיר',whatsapp:'WhatsApp',external:'מסירה בערוצים חיצוניים אינה פעילה. בחירת ערוץ אינה הוכחה שהתזכורת נשלחה.',blocked:'לא נמסר',provider_not_configured:'חיבור המסירה לא הוגדר.',channel_not_verified:'הערוץ הזה טרם אומת.',do_not_disturb:'מושהה בשעות השקט שהוגדרו.',demo_external_denied:'DEMO: מסירה חיצונית חסומה.'},
}as const;
function denied(error:unknown){return error instanceof IdentityClientError&&['UNAUTHENTICATED','FORBIDDEN','NOT_FOUND'].includes(error.code);}
export function reminderCalendarHref(locale:Locale,role:WorkspaceRole,item:Pick<ReminderItem,'caseId'|'occursOn'>):string{
 const path=role==='parent'?'family/schedule':role==='client'?'client/calendar':'app/calendar';
 const url=new URL(workspaceHref(locale,path,item.caseId),'https://private.invalid');url.searchParams.set('date',item.occursOn);return url.pathname+url.search;
}
export function ReminderInbox({locale,role}:{locale:Locale;role:WorkspaceRole}){
 const t=words[locale],[page,setPage]=useState<ReminderPage|null>(null),[cursor,setCursor]=useState<string|null>(null),[history,setHistory]=useState<(string|null)[]>([]);
 const [busy,setBusy]=useState(false),[status,setStatus]=useState(''),[pending,setPending]=useState<string|null>(null);
 const mounted=useRef(false),inFlight=useRef(false),generation=useRef(0);
 const load=useCallback(async()=>{
  if(inFlight.current)return;const run=++generation.current;inFlight.current=true;setBusy(true);setStatus('');
  try{const loaded=await readReminders(cursor);if(mounted.current&&run===generation.current)setPage(loaded);}
  catch(error){if(mounted.current&&run===generation.current){setPage(null);setStatus(denied(error)?t.signedOut:t.failed);if(denied(error))setPending(null);}}
  finally{inFlight.current=false;if(mounted.current&&run===generation.current)setBusy(false);}
 },[cursor,t.failed,t.signedOut]);
 useEffect(()=>{mounted.current=true;const timer=window.setTimeout(()=>void load(),0);return()=>{window.clearTimeout(timer);mounted.current=false;generation.current+=1;};},[load]);
 async function mark(id:string,verifyOnly=false){
  if(inFlight.current||pending!==null&&pending!==id)return;const run=++generation.current;inFlight.current=true;setBusy(true);setStatus('');setPending(id);
  try{const result=verifyOnly?null:await markReminderRead(id),loaded=await readReminders(cursor);if(!mounted.current||run!==generation.current)return;setPage(loaded);
   if(reminderWasRead(loaded.items,id,result?.readAt)){setPending(null);setStatus(t.saved);}else setStatus(t.uncertain);
  }catch(error){if(mounted.current&&run===generation.current){setPage(null);setStatus(denied(error)?t.signedOut:t.uncertain);if(denied(error))setPending(null);}}
  finally{inFlight.current=false;if(mounted.current&&run===generation.current)setBusy(false);}
 }
 return <section className="lsu-panel lsw-stack" aria-labelledby="reminder-inbox-title"><div className="lsw-actions"><h2 id="reminder-inbox-title">{t.title}</h2><button type="button" disabled={busy} onClick={()=>void load()}>{t.refresh}</button></div>
  {busy&&<p role="status">{t.loading}</p>}{status&&<p role={pending||!page?'alert':'status'}>{status}</p>}
  {!busy&&!page&&!pending&&<button type="button" onClick={()=>void load()}>{t.retry}</button>}
  {pending&&<div className="lsw-actions"><button type="button" disabled={busy} onClick={()=>void mark(pending,true)}>{t.verify}</button><button type="button" disabled={busy} onClick={()=>void mark(pending)}>{t.retryMark}</button></div>}
  {page&&<>{!page.items.length&&<p>{t.empty}</p>}<ul className="lsw-stack" style={{listStyle:'none',padding:0,margin:0}}>{page.items.map(item=><li className="lsu-panel lsw-stack" key={item.id}>
   <h3>{t[item.purpose]}</h3><p><bdi>{new Intl.DateTimeFormat(locale==='he'?'he-IL':'en-GB',{timeZone:item.timezone,dateStyle:'medium',timeStyle:'short'}).format(new Date(item.dueAt))}</bdi> · <bdi>{item.timezone}</bdi> · {t[item.channel]}</p>
   {item.state==='blocked'&&<p role="status">{t.blocked}: {item.reason==='demo_external_denied'?t.demo_external_denied:item.reason==='channel_not_verified'?t.channel_not_verified:item.reason==='do_not_disturb'?t.do_not_disturb:t.provider_not_configured}</p>}
   <div className="lsw-actions"><a className="lsw-button" href={reminderCalendarHref(locale,role,item)}>{t.open}</a>{item.channel==='in_app'&&(item.readAt?<span>{t.read}</span>:<button type="button" disabled={busy||pending!==null} onClick={()=>void mark(item.id)}>{t.mark}</button>)}</div>
  </li>)}</ul>{page.morePending&&<p>{t.more}</p>}
  <div className="lsw-actions">{!!history.length&&<button type="button" disabled={busy||pending!==null} onClick={()=>{setCursor(history.at(-1)??null);setHistory(history.slice(0,-1));setPage(null);}}>{t.previous}</button>}{page.nextCursor&&<button type="button" disabled={busy||pending!==null} onClick={()=>{setHistory([...history,cursor]);setCursor(page.nextCursor);setPage(null);}}>{t.next}</button>}</div></>}
  <p className="lsw-help">{t.external}</p>
 </section>;
}
