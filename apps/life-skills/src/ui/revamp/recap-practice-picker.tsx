"use client";
import {useEffect,useState} from "react";
import type {Locale} from "../../features/session-workflow/types.ts";
import type {RecapPracticeChoices,RecapPracticeSelection} from "../../features/session-workflow/recap-contract.ts";
import {word} from "./primitives.tsx";
export function RecapPracticePicker({locale,selected,onChange,load,locked}:{locale:Locale;selected:readonly RecapPracticeSelection[];onChange:(value:RecapPracticeSelection[])=>void;load?:((signal:AbortSignal)=>Promise<RecapPracticeChoices>)|undefined;locked:boolean}){
 const [data,setData]=useState<RecapPracticeChoices|null>(null),[failed,setFailed]=useState(false),[retry,setRetry]=useState(0);
 useEffect(()=>{if(!load)return;const controller=new AbortController();queueMicrotask(()=>{if(!controller.signal.aborted){setFailed(false);void load(controller.signal).then(value=>{if(!controller.signal.aborted)setData(value);}).catch(()=>{if(!controller.signal.aborted)setFailed(true);});}});return()=>controller.abort();},[load,retry]);
 // Resolve only the exact retained version. Never silently replace it with a
 // newer version, shorten source instructions or manufacture a source digest.
 const resolve=()=>selected.map(row=>({...row,expectedSourceDigest:row.expectedSourceDigest||data?.items.find(item=>item.versionId===row.versionId)?.sourceDigest||""}));
 return <fieldset disabled={locked}><legend>{word(locale,"Published practice responsibilities to include","תפקידי תרגול שפורסמו להוספה לעדכון")}</legend>
  <p className="lsr-help">{word(locale,"Choose the exact published version. Review its short instructions before sharing; long source text is not automatically shortened.","יש לבחור את הגרסה המדויקת שפורסמה ולבדוק את ההוראות הקצרות לפני שיתוף. טקסט מקור ארוך אינו מתקצר אוטומטית.")}</p>
  {!load?<p>{word(locale,"Native practice selection is unavailable in this component example.","בחירת תרגול אמיתי אינה זמינה בדוגמת הרכיב הזאת.")}</p>:failed?<div role="alert"><p>{word(locale,"Practice versions could not be confirmed. Your selections are still here.","לא ניתן לאשר את גרסאות התרגול. הבחירות שלך נשארו כאן.")}</p><button type="button" onClick={()=>setRetry(value=>value+1)}>{word(locale,"Retry practice read","ניסיון קריאת תרגול חוזר")}</button></div>:data===null?<p role="status">{word(locale,"Loading authorized practice versions…","טוען גרסאות תרגול מורשות…")}</p>:<>
   {data.hasMore&&<p role="status">{word(locale,"Showing the latest 20 published sources. Older versions are not replaced automatically.","מוצגים 20 המקורות האחרונים שפורסמו. גרסאות קודמות אינן מוחלפות אוטומטית.")}</p>}
   {!data.items.length&&<p>{word(locale,"No eligible published timed practice is available.","אין תרגול מתוזמן שפורסם ומתאים לשיתוף.")}</p>}
   {data.items.map(item=>{const chosen=selected.find(row=>row.versionId===item.versionId);return <section key={item.versionId}>
    <label><input type="checkbox" checked={Boolean(chosen)} onChange={event=>onChange(event.target.checked?[...resolve(),{versionId:item.versionId,expectedSourceDigest:item.sourceDigest,instructions:item.instructions.length<=500?item.instructions:""}]:resolve().filter(row=>row.versionId!==item.versionId))}/>{word(locale,item.participant==="parent"?"Parent support":"Client practice",item.participant==="parent"?"תמיכת הורה":"תרגול מקבל השירות")} · {word(locale,"Version","גרסה")} {item.version} · <bdi>{item.localTime} · {item.timezone}</bdi></label>
    <p className="lsr-help"><bdi>{item.startsOn} — {item.endsOn}</bdi> · {word(locale,"Scheduled weekdays","ימי השבוע שנקבעו")} {item.weekdays.map(day=>new Intl.DateTimeFormat(locale,{weekday:"short",timeZone:"UTC"}).format(new Date(Date.UTC(2026,0,4+day)))).join(" · ")}</p>
    <details><summary>{word(locale,"Published instruction details","פרטי ההנחיה שפורסמה")}</summary><p dir="auto">{item.instructions}</p></details>
    {chosen&&<label>{word(locale,"Reviewed short practice instruction — up to 500 characters","הנחיית תרגול קצרה שנבדקה — עד 500 תווים")}<textarea dir="auto" required maxLength={500} rows={3} value={chosen.instructions} onChange={event=>onChange(resolve().map(row=>row.versionId===item.versionId?{...row,instructions:event.target.value}:row))}/></label>}
   </section>;})}
  </>}
  {data!==null&&selected.filter(row=>!data.items.some(item=>item.versionId===row.versionId)).map(row=><div key={row.versionId}><p role="alert">{word(locale,"A selected version is not confirmed in the current source list. It will not be silently replaced.","גרסה שנבחרה אינה מאושרת ברשימת המקורות הנוכחית. היא לא תוחלף בלי בחירה מפורשת.")}</p><p dir="auto">{row.instructions}</p><button type="button" onClick={()=>onChange(selected.filter(item=>item.versionId!==row.versionId))}>{word(locale,"Remove this selection","הסרת הבחירה הזאת")}</button></div>)}
  {selected.some(row=>!row.expectedSourceDigest)&&data&&<button type="button" onClick={()=>onChange(resolve())}>{word(locale,"Confirm these exact source versions","אישור גרסאות המקור המדויקות האלה")}</button>}
 </fieldset>;
}
