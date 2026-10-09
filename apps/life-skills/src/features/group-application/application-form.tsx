"use client";
import {useEffect,useRef,useState} from "react";
import type {FormEvent} from "react";
import type {Locale} from "../../lib/locale.ts";
import {currentGroupApplicationFieldsSchema,groupApplicationNotice,type GroupApplicationCommand} from "./contract.ts";
import styles from "./application-form.module.css";

type Challenge={challenge:string};
const optional=(value:FormDataEntryValue|null)=>typeof value==="string"&&value!==""?value:undefined;
export function classifyPublicApplicationFailure(requestStarted:boolean,status?:number,previouslyUncertain=false){
 if(!requestStarted||status===404)return "unavailable" as const;
 if(status!==undefined&&status>=400&&status<500)return "correctable" as const;
 if(previouslyUncertain)return "unconfirmed" as const;
 return "unconfirmed" as const;
}
export function GroupApplicationForm({locale}:{locale:Locale}){
 const t=(en:string,he:string)=>locale==="he"?he:en,form=useRef<HTMLFormElement>(null),pending=useRef<GroupApplicationCommand|null>(null);
 const [challenge,setChallenge]=useState(""),[busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false),
  [error,setError]=useState(""),[saved,setSaved]=useState(false),[step,setStep]=useState<1|2>(1),[townChoice,setTownChoice]=useState(""),[screenAccess,setScreenAccess]=useState("");
 useEffect(()=>{let active=true,timer:ReturnType<typeof setTimeout>|undefined;fetch("/api/public/group-applications",{cache:"no-store",credentials:"same-origin"}).then(async response=>{
  const body=await response.json();if(!response.ok||body?.ok!==true||typeof body.data?.challenge!=="string")throw new Error();return body.data as Challenge;
 }).then(data=>{if(active)timer=setTimeout(()=>{if(active)setChallenge(data.challenge);},1600);}).catch(()=>{if(active)setError(locale==="he"?"עדיין לא ניתן לשלוח בקשה. לא נשלח מידע.":"Applications are not available yet. No information has been sent.");});return()=>{active=false;if(timer)clearTimeout(timer);};},[locale]);
 useEffect(()=>{const guard=(event:BeforeUnloadEvent)=>{if(pending.current){event.preventDefault();event.returnValue="";}};window.addEventListener("beforeunload",guard);return()=>window.removeEventListener("beforeunload",guard);},[]);
 async function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(busy||!challenge)return;setSaved(false);setError("");const previouslyUncertain=uncertain;
  if(!pending.current){
   const values=new FormData(event.currentTarget),age=values.get("childAge"),childAge=typeof age==="string"&&age.trim()!==""?Number(age):Number.NaN,
    selectedTown=values.get("townChoice"),otherTown=optional(values.get("otherTown")),town=selectedTown==="beit_shemesh"?"Beit Shemesh":selectedTown==="jerusalem"?"Jerusalem":selectedTown==="modiin"?"Modiin":otherTown,
    observations=Object.fromEntries(["intrinsicMotivation","expression","selfGovernance","valuesAndGoals","cooperation","socialConfidence","stressfulSituations"].map(key=>[key,optional(values.get(key))]).filter(([,value])=>value!==undefined));
   const fields=currentGroupApplicationFieldsSchema.safeParse({parentName:values.get("parentName"),parentPhone:values.get("parentPhone"),language:locale,
    childAge,town,townChoice:selectedTown,otherTown,neighborhood:values.get("neighborhood"),schedulePreference:values.get("schedulePreference"),screenAccess:optional(values.get("screenAccess")),
    screenTime:optional(values.get("screenTime")),observations,parentPriorities:optional(values.get("parentPriorities")),permission:{confirmed:values.get("permission")==="on",version:groupApplicationNotice.version,language:locale}});
   if(!fields.success){setError(t("Please check the required fields and permission, then try again.","בדקו את שדות החובה ואת ההסכמה ונסו שוב."));return;}
   pending.current={operationId:crypto.randomUUID(),fields:fields.data};
  }
  setBusy(true);let requestStarted=false;
  try{
   requestStarted=true;const website=new FormData(event.currentTarget).get("website");
   const response=await fetch("/api/public/group-applications",{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json"},body:JSON.stringify({challenge,website,operationId:pending.current.operationId,fields:pending.current.fields})});
   if(!response.ok&&previouslyUncertain&&response.status===403){
    setChallenge("");
    try{const renewed=await fetch("/api/public/group-applications",{cache:"no-store",credentials:"same-origin"}),body=await renewed.json();if(!renewed.ok||body?.ok!==true||typeof body.data?.challenge!=="string")throw new Error();await new Promise(resolve=>setTimeout(resolve,1600));setChallenge(body.data.challenge);setUncertain(true);setError(t("Form verification was renewed. Retry the same application; it will not be duplicated.","אימות הטופס חודש. נסו שוב את אותה בקשה; היא לא תיווצר פעמיים."));}
    catch{setUncertain(true);setError(t("The earlier result is still unconfirmed and form verification could not be renewed. Keep this page open and try again later.","התוצאה הקודמת עדיין לא אומתה ולא ניתן היה לחדש את אימות הטופס. השאירו את הדף פתוח ונסו שוב מאוחר יותר."));}
    return;
   }
   if(!response.ok&&previouslyUncertain&&response.status===429){setUncertain(true);setError(t("The earlier result is still unconfirmed. Wait before retrying the same application; it will not be duplicated.","התוצאה הקודמת עדיין לא אומתה. המתינו לפני ניסיון חוזר של אותה בקשה; היא לא תיווצר פעמיים."));return;}
   const kind=classifyPublicApplicationFailure(true,response.status,previouslyUncertain);
   if(!response.ok&&kind!=="unconfirmed"){
    pending.current=null;setUncertain(false);setError(response.status===429?t("Too many attempts were received. Please wait and try again later.","התקבלו ניסיונות רבים מדי. המתינו ונסו שוב מאוחר יותר."):
     response.status===403?t("This form expired or could not be verified. Reload the page and try again.","לא ניתן לאמת את הטופס או שפג תוקפו. רעננו את הדף ונסו שוב."):
     t("The application was not saved. Check the fields and try again.","הבקשה לא נשמרה. בדקו את הפרטים ונסו שוב."));return;
   }
   const body=await response.json();if(!response.ok||body?.ok!==true||body.data?.saved!==true)throw new Error();
   pending.current=null;setUncertain(false);form.current?.reset();setTownChoice("");setScreenAccess("");setStep(1);setSaved(true);
  }catch{
   const kind=classifyPublicApplicationFailure(requestStarted,undefined,previouslyUncertain);
   if(kind==="unavailable"){pending.current=null;setUncertain(false);setError(t("Applications are unavailable. No information was saved.","לא ניתן לשלוח בקשות כעת. לא נשמר מידע."));}
   else{setUncertain(true);setError(t("The result is not confirmed. Keep this page open and retry the same application so it will not be duplicated.","תוצאת השמירה לא אומתה. השאירו את הדף פתוח ונסו שוב את אותה בקשה כדי שלא תיווצר כפילות."));}
  }finally{setBusy(false);}
 }
 function continueToDetails(){
  const controls=form.current?.querySelectorAll<HTMLInputElement|HTMLSelectElement>("[data-step-one] input,[data-step-one] select");
  for(const control of controls??[]){if(!control.checkValidity()){control.reportValidity();return;}}
  setError("");setStep(2);requestAnimationFrame(()=>form.current?.querySelector<HTMLElement>("[data-step-two] summary,[data-step-two] input")?.focus());
 }
 const observationOptions=<><option value="">{t("Not shared","לא נמסר")}</option><option value="going_well">{t("Generally going well","בדרך כלל הולך טוב")}</option><option value="sometimes_difficult">{t("Sometimes difficult","לפעמים קשה")}</option><option value="would_like_support">{t("Would like support","נשמח לתמיכה")}</option></>;
 return <form ref={form} className={styles.form} onSubmit={submit}>
  <ol className={styles.steps} aria-label={t("Application steps","שלבי הבקשה")}><li className={step===1?styles.active:""}><span>1</span>{t("Your details","הפרטים שלכם")}</li><li className={step===2?styles.active:""}><span>2</span>{t("About your son","על הילד שלכם")}</li></ol>
  {error&&<p role="alert" className={styles.error}>{error}</p>}{saved&&<p role="status" className={styles.success}>{t("Your application was saved for private owner review. This is not enrollment or a booking.","הבקשה נשמרה לבדיקה פרטית של הבעלים. אין זו הרשמה או קביעת מועד.")}</p>}
  <div data-step-one hidden={step!==1}>
   <h3>{t("A conversation starts here.","השיחה מתחילה כאן.")}</h3><p className={styles.intro}>{t("No child's name or private clinical information is needed.","אין צורך בשם הילד או במידע קליני פרטי.")}</p>
   <div className={styles.fields}>
   <label>{t("Parent name","שם ההורה")}<input name="parentName" required maxLength={100} autoComplete="name"/></label>
   <label>{t("Mobile number","מספר נייד")}<input name="parentPhone" required type="tel" dir="ltr" inputMode="tel" maxLength={24} placeholder={locale==="he"?"052-000-0000":"+972 52 000 0000"} autoComplete="tel"/></label>
   <label>{t("Boy's age","גיל הילד")}<input name="childAge" required type="number" min={0} max={17} inputMode="numeric"/></label>
   <label>{t("Town or city","עיר או יישוב")}<select name="townChoice" required value={townChoice} onChange={event=>setTownChoice(event.currentTarget.value)}><option value="" disabled>{t("Choose your town or city","בחרו עיר או יישוב")}</option><option value="beit_shemesh">{t("Beit Shemesh","בית שמש")}</option><option value="jerusalem">{t("Jerusalem","ירושלים")}</option><option value="modiin">{t("Modiin","מודיעין")}</option><option value="other">{t("Another town","יישוב אחר")}</option></select><span className={styles.fieldNote}>{t("We currently run groups in Beit Shemesh and are forming groups in Central Israel and Jerusalem. Inquiries from all towns are welcome.","אנחנו מפעילים כעת קבוצות בבית שמש ומקימים קבוצות במרכז הארץ ובירושלים. פניות מכל יישוב מתקבלות בברכה.")}</span></label>
   {townChoice==="other"&&<label>{t("Other town or city","עיר או יישוב אחר")}<input name="otherTown" required maxLength={120} autoComplete="address-level2"/></label>}
   <label>{t("Neighborhood","שכונה")}<input name="neighborhood" required maxLength={120} autoComplete="address-level3"/><span className={styles.fieldNote}>{t("This helps us understand which local group could suit your family.","המידע עוזר לנו להבין איזו קבוצה מקומית עשויה להתאים למשפחה שלכם.")}</span></label>
   <label>{t("Preferred time","זמן מועדף")}<select name="schedulePreference" required defaultValue=""><option value="" disabled>{t("Choose","בחירה")}</option><option value="morning">{t("Morning","בוקר")}</option><option value="evening">{t("Evening","ערב")}</option><option value="flexible">{t("Flexible","גמיש")}</option></select></label>
   </div>
   <button type="button" onClick={continueToDetails}>{t("Continue","המשך")} <span aria-hidden="true">{locale==="he"?"←":"→"}</span></button>
  </div>
  <div data-step-two hidden={step!==2}>
  <h3>{t("A little about your son.","קצת על הילד שלכם.")}</h3><p className={styles.intro}>{t("These observations are optional. A few words are enough; we can discuss the rest.","התצפיות האלה אינן חובה. כמה מילים מספיקות; על השאר אפשר לדבר.")}</p>
  <details className={styles.optional}><summary tabIndex={-1}>{t("Optional practical information","מידע מעשי לבחירה")}</summary>
   <p>{t("These answers help with planning only. They are not an assessment or diagnosis.","התשובות מסייעות לתכנון בלבד. הן אינן אבחון או הערכה טיפולית.")}</p>
   <div className={styles.fields}>
    <label>{t("Do you have screens at home?","האם יש לכם מסכים בבית?")}<select name="screenAccess" value={screenAccess} onChange={event=>setScreenAccess(event.currentTarget.value)}><option value="">{t("Prefer to discuss","נעדיף לדבר על כך")}</option><option value="screens_at_home">{t("Yes","כן")}</option><option value="no_screens_at_home">{t("No, we don't have screens","לא, אין לנו מסכים")}</option></select></label>
    {screenAccess!=="no_screens_at_home"&&<label>{t("How much screen time is he allotted each week?","כמה זמן מסך מוקצב לו בכל שבוע?")}<select name="screenTime"><option value="">{t("Prefer to discuss","נעדיף לדבר על כך")}</option><option value="none">{t("No screen time","ללא זמן מסך")}</option><option value="under_2_hours_weekly">{t("Less than 2 hours a week","פחות משעתיים בשבוע")}</option><option value="2_to_5_hours_weekly">{t("2–5 hours a week","2–5 שעות בשבוע")}</option><option value="6_to_10_hours_weekly">{t("6–10 hours a week","6–10 שעות בשבוע")}</option><option value="11_to_20_hours_weekly">{t("11–20 hours a week","11–20 שעות בשבוע")}</option><option value="over_20_hours_weekly">{t("More than 20 hours a week","יותר מ־20 שעות בשבוע")}</option><option value="no_fixed_limit">{t("No fixed limit","ללא מגבלה קבועה")}</option><option value="not_sure">{t("Not sure","לא בטוחים")}</option></select><span className={styles.fieldNote}>{t("An approximate weekly allowance is enough.","הערכה שבועית משוערת מספיקה.")}</span></label>}
    {([ ["intrinsicMotivation",t("Intrinsic motivation","מוטיבציה פנימית")],["expression",t("Expressing thoughts and needs","הבעת מחשבות וצרכים")],["selfGovernance",t("Self-direction and decisions","הכוונה עצמית וקבלת החלטות")],["valuesAndGoals",t("Values and goals","ערכים ומטרות")],["cooperation",t("Cooperation","שיתוף פעולה")],["socialConfidence",t("Appropriate disagreement and social confidence","חוסר הסכמה מתאים וביטחון חברתי")],["stressfulSituations",t("Coping with stressful situations","התמודדות במצבים מלחיצים")] ] as const).map(([name,label])=><label key={name}>{label}<select name={name}>{observationOptions}</select></label>)}
   </div>
   <label className={styles.explanation}>{t("What would you most like the group to help with? (optional)","במה הייתם רוצים שהקבוצה תסייע במיוחד? (לא חובה)")}<textarea name="parentPriorities" maxLength={600} rows={4}/></label>
  </details>
  <label className={styles.check}><input name="permission" type="checkbox" required/><span>{groupApplicationNotice[locale]}</span></label>
  <label className={styles.honeypot} aria-hidden="true">Website<input name="website" tabIndex={-1} autoComplete="off"/></label>
  <div className={styles.actions}><button type="button" className={styles.back} onClick={()=>setStep(1)} disabled={busy||uncertain}>{locale==="he"?"→":"←"} {t("Back","חזרה")}</button><button type="submit" disabled={busy||!challenge}>{busy?t("Sending…","שולח…"):uncertain?t("Retry the same application","ניסיון חוזר לאותה בקשה"):t("Apply for owner review","שליחת בקשה לבדיקת הבעלים")}</button></div>
  <p className={styles.boundary}>{t("Submitting does not enroll your child, reserve a place, charge you, or create an appointment. This is not an emergency channel.","השליחה אינה רושמת את הילד, שומרת מקום, מחייבת בתשלום או קובעת פגישה. זה אינו ערוץ חירום.")}</p>
  </div>
 </form>;
}
