"use client";
import {useId,useState} from 'react';
import {communicationPreferenceReadback,communicationPreferenceStatusLabel} from './academy-communication-preferences.ts';
import type {Locale} from '../../lib/locale.ts';
import type {AcademyFounderStore} from './academy-founder-store.ts';
import {floridaDeadline} from './academy-founder-contract.ts';

type Data=Pick<Awaited<ReturnType<AcademyFounderStore['ownerList']>>,'metrics'|'families'|'messages'>;
type Labels=readonly [string,string];
const metrics:readonly [keyof Data['metrics'],...Labels][]=[
 ['completedRegistrations','Completed registration submissions','טופסי הרשמה שהושלמו'],
 ['uniqueFamilies','Unique families counted','משפחות ייחודיות שנספרו'],
 ['unresolvedIdentityRecords','Family identities awaiting review','זהויות משפחה הממתינות לבדיקה'],
 ['children','Children recorded','ילדים שנרשמו בטפסים'],
 ['activeFounderReservations','Active founder-rate reservations','שמירות פעילות לתעריף מייסדים'],
 ['confirmedInterest','Families with confirmed interest','משפחות שאישרו התעניינות'],
 ['waitingForSuitableGroup','Families waiting for a suitable group','משפחות הממתינות לקבוצה מתאימה'],
 ['offersSent','Families with sent payment offers','משפחות שנשלחה להן הצעת תשלום'],
 ['paidFamilies','Families with recorded payment','משפחות עם תשלום מתועד'],
 ['paidChildren','Children with recorded payment','ילדים עם תשלום מתועד'],
 ['collectedCents','Gross collected tuition (USD)','שכר לימוד שנגבה ברוטו (USD)'],
 ['confirmedEnrollment','Children enrolled','ילדים שהתקבלו להשתתפות'],
];
const statuses:Record<string,Labels>={
 pending_verification:['Family identity awaiting review','זהות המשפחה ממתינה לבדיקה'],
 interest_list:['Ordinary registration interest list','רשימת התעניינות בהרשמה רגילה'],
 provisional:['Founder rate reserved; interest confirmation pending','תעריף מייסדים שמור; ממתינים לאישור התעניינות'],
 confirmed:['Interest confirmed','ההתעניינות אושרה'],
 scheduling_hold:['Internal hold for a suitable group','המתנה פנימית לקבוצה מתאימה'],
 offered:['Dated group offer prepared','הוכנה הצעת קבוצה מתוארכת'],
 redeemed:['Payment recorded — enrollment is separate','תשלום תועד — הקבלה להשתתפות נפרדת'],
 expired:['Reservation expired','שמירת התעריף פגה'],
 withdrawn:['Registration withdrawn','ההרשמה בוטלה'],
};
const purposes:Record<string,Labels>={
 academy_founder_interest:['Thank-you and interest confirmation request','תודה ובקשה לאישור התעניינות'],
 academy_founder_ack:['Interest confirmation acknowledgment','אישור קבלת אישור ההתעניינות'],
 academy_founder_interest_reminder:['Interest confirmation reminder','תזכורת לאישור התעניינות'],
 academy_founder_interest_deadline_receipt:['Interest confirmation deadline notice','הודעה על המועד לאישור התעניינות'],
 academy_founder_offer:['Individualized payment offer','הצעת תשלום אישית'],
 academy_founder_payment_reminder:['Payment reminder','תזכורת לתשלום'],
 academy_founder_payment_deadline_receipt:['Payment deadline notice','הודעה על מועד התשלום'],
};
const messageStates:Record<string,Labels>={
 queued:['Queued — not yet sent','בתור — טרם נשלח'],
 unknown:['Send outcome unknown — review before retry','תוצאת השליחה אינה ידועה — יש לבדוק לפני ניסיון חוזר'],
 sent:['Recorded as sent — delivery and reading are not verified','מתועד כנשלח — מסירה וקריאה לא אומתו'],
 canceled:['Queue dispatch canceled — provider outcome is not established','השליחה מהתור בוטלה — תוצאת הספק לא הובררה'],
};

type FamilyFilter={search:string;status:string;age:string};
const normalizeSearch=(value:string)=>value.normalize('NFKC').trim().toLocaleLowerCase();
const validAge=(value:string)=>value===''||/^(?:[0-9]|1[0-7])$/.test(value);
/** Selects whole families from this response only. Never trims children, messages or global metrics. */
export function filterFounderFamilies(families:Data['families'],filter:FamilyFilter):Data['families']{
 const search=normalizeSearch(filter.search);
 if(!validAge(filter.age)||filter.status!=='all'&&filter.status!=='unverified'&&!Object.hasOwn(statuses,filter.status))return [];
 return families.filter(f=>{
  const statusMatches=filter.status==='all'||(filter.status==='unverified'?!Object.hasOwn(statuses,f.status):f.status===filter.status);
  const ageMatches=(child:Data['families'][number]['children'][number])=>filter.age===''||Number.isInteger(child.age)&&child.age===Number(filter.age);
  const familySearchMatches=!search||[f.parentName,f.email,f.reference].some(value=>normalizeSearch(value).includes(search));
  const matches=familySearchMatches?(filter.age===''||f.children.some(ageMatches)):f.children.some(child=>normalizeSearch(child.name).includes(search)&&ageMatches(child));
  return statusMatches&&matches;
 });
}

/** Read-only projection of the existing authorized owner response; creates no authority or actions. */
export function AcademyFounderReadback({locale,data}:{locale:Locale;data:Data}){
 const filterId=useId(),[search,setSearch]=useState(''),[status,setStatus]=useState('all'),[age,setAge]=useState('');
 const t=(en:string,he:string)=>locale==='he'?he:en;
 const label=(map:Record<string,Labels>,key:string,fallback:Labels)=>{const value=Object.hasOwn(map,key)?map[key]:undefined;return value?t(...value):t(...fallback);};
 const count=(value:number)=>Number.isSafeInteger(value)&&value>=0?String(value):t('Needs review','נדרשת בדיקה');
 const date=(value:string)=>Number.isFinite(Date.parse(value))?floridaDeadline(value,locale):t('Date not verified — needs review','התאריך לא אומת — נדרשת בדיקה');
 const window=(value:Data['families'][number]['interest'])=>value.exception?t('Delivery exception — owner review required','חריגת משלוח — נדרשת בדיקת בעלים'):!value.sentAt?t('No recorded successful send — no verified window','אין שליחה מוצלחת מתועדת — אין חלון מאומת'):!Number.isFinite(Date.parse(value.sentAt))?t('Send time not verified — window needs review','מועד השליחה לא אומת — החלון דורש בדיקה'):value.deadline?date(value.deadline):t('Sent window deadline needs review','מועד הסיום של החלון לאחר השליחה דורש בדיקה');
 const families=filterFounderFamilies(data.families,{search,status,age}),filtered=search!==''||status!=='all'||age!=='';
 const controlStyle={display:'block',width:'100%',minHeight:44,font:'inherit',boxSizing:'border-box' as const};
 return <section lang={locale} dir={locale==='he'?'rtl':'ltr'} data-academy-founder-readback style={{minWidth:0,overflowWrap:'anywhere'}}>
  <h3>{t('Registration and payment overview','סקירת הרשמות ותשלומים')}</h3>
  <dl style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,15rem),1fr))',gap:'1rem'}}>{metrics.map(([key,en,he])=><div key={key} data-founder-metric={key} style={{minWidth:0}}><dt>{t(en,he)}</dt><dd style={{marginInlineStart:0,fontWeight:600}}>{key==='collectedCents'?Number.isSafeInteger(data.metrics[key])&&data.metrics[key]>=0?<bdi dir="ltr">USD {(data.metrics[key]/100).toFixed(2)}</bdi>:t('Needs review','נדרשת בדיקה'):count(data.metrics[key])}</dd></div>)}</dl>
  <p>{t('Free registrations are not tuition income. Payment and enrollment are separate; gross receipts do not show refunds, fees or profit.','הרשמה חינמית אינה הכנסה משכר לימוד. תשלום וקבלה להשתתפות הם נפרדים; סכום הגבייה ברוטו אינו מציג החזרים, עמלות או רווח.')}</p>
  <h3>{t('Saved families','משפחות שנשמרו')}</h3>
  <div data-founder-filters style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,15rem),1fr))',gap:'1rem',marginBlock:'1rem'}}>
   <div><label htmlFor={filterId+'-search'}>{t('Search loaded families','חיפוש במשפחות שנטענו')}</label><input id={filterId+'-search'} name="founderFamilySearch" type="search" maxLength={200} autoComplete="off" value={search} onChange={e=>setSearch(e.target.value)} aria-describedby={filterId+'-scope'} style={controlStyle}/></div>
   <div><label htmlFor={filterId+'-status'}>{t('Saved registration status','מצב ההרשמה שנשמר')}</label><select id={filterId+'-status'} name="founderFamilyStatus" value={status} onChange={e=>setStatus(e.target.value)} style={controlStyle}><option value="all">{t('All statuses','כל המצבים')}</option>{Object.entries(statuses).map(([key,names])=><option key={key} value={key}>{t(...names)}</option>)}<option value="unverified">{t('Unrecognized status — needs review','מצב לא מזוהה — נדרשת בדיקה')}</option></select></div>
   <div><label htmlFor={filterId+'-age'}>{t('Child age in whole years (optional)','גיל ילד בשנים מלאות (לא חובה)')}</label><input id={filterId+'-age'} name="founderChildAge" type="number" inputMode="numeric" min={0} max={17} step={1} value={age} onChange={e=>setAge(e.target.value)} aria-invalid={!validAge(age)} aria-describedby={!validAge(age)?filterId+'-age-error':filterId+'-scope'} style={controlStyle}/>{!validAge(age)&&<p id={filterId+'-age-error'} role="alert">{t('Enter a whole-year age from 0 to 17, or leave blank. The filter does not round ages.','הזינו גיל שלם בין 0 ל־17, או השאירו ריק. הסינון אינו מעגל גילאים.')}</p>}</div>
  </div>
  <p id={filterId+'-scope'}>{t('Search parent or child name, email or reference within the families already loaded. When searching a child name with an age, both must match the same child. For parent, email or reference searches, age matches any child. All siblings stay together. These filters do not search the complete database. Overview totals and family email records are unchanged.','חפשו שם הורה או ילד, דוא״ל או אסמכתה במשפחות שכבר נטענו. בחיפוש שם ילד יחד עם גיל, שניהם חייבים להתאים לאותו ילד. בחיפוש הורה, דוא״ל או אסמכתה, הגיל מתאים לכל ילד במשפחה. כל האחים נשארים יחד. הסינון אינו מחפש בכל מסד הנתונים. הסיכומים למעלה ורשומות הדוא״ל המשפחתיות אינם משתנים.')}</p>
  <p role="status" data-founder-filter-count>{t('Showing '+families.length+' of '+data.families.length+' loaded families.','מוצגות '+families.length+' מתוך '+data.families.length+' משפחות שנטענו.')}</p>
  <button type="button" disabled={!filtered} onClick={()=>{setSearch('');setStatus('all');setAge('');}} style={{minHeight:44,padding:'0.5rem 1rem',font:'inherit'}}>{t('Clear filters','ניקוי הסינון')}</button>
  {data.families.length===0&&<p>{t('No saved families are shown in this response.','לא מוצגות משפחות שמורות בתשובה זו.')}</p>}
  {data.families.length>0&&families.length===0&&<p>{t('No loaded families match these filters. Clear filters to see the loaded response.','אין משפחות שנטענו המתאימות לסינון. נקו את הסינון כדי להציג את התשובה שנטענה.')}</p>}
  {families.map(f=><article className="lsw-card" key={f.id} data-founder-family style={{minWidth:0}}>
   <h4><bdi>{f.parentName}</bdi></h4><p>{t('Email','דוא״ל')}: <bdi>{f.email}</bdi></p><p>{t('Reference','אסמכתה')}: <bdi>{f.reference}</bdi></p>
   <p>{t('Registration status','מצב ההרשמה')}: {label(statuses,f.status,['Status unverified — needs owner review','המצב לא אומת — נדרשת בדיקת בעלים'])} · {t('Revision','גרסה')} {f.revision}</p>
   <ul>{f.children.map(c=><li key={c.id}><bdi>{c.name}</bdi> · {t('Age','גיל')} {c.age}</li>)}</ul>
   <p>{t('Interest confirmation','אישור התעניינות')}: {f.interest.confirmedAt?date(f.interest.confirmedAt):t('Pending','ממתין')}</p>
   <p>{t('Interest confirmation window','חלון אישור ההתעניינות')}: {window(f.interest)}</p><p>{t('Payment offer window','חלון הצעת התשלום')}: {window(f.payment)}</p>
   {f.nativeBinding&&<p>{t('Native family last verified','מועד אימות המשפחה במערכת')}: {date(f.nativeBinding.verifiedAt)} · {f.nativeBinding.children.length} {t('mapped children; current authority is checked again before an offer.','ילדים מקושרים; ההרשאה נבדקת מחדש לפני הצעה.')}</p>}
   {f.offer&&<p>{t('Offered group','הקבוצה בהצעה')}: {f.offer.group} · {t('First session','המפגש הראשון')}: {date(f.offer.firstSession)}</p>}
   <p>{t('Children with recorded payment','ילדים עם תשלום מתועד')}: {f.redeemedChildIds.length} · {t('Children enrolled','ילדים שהתקבלו להשתתפות')}: {f.enrolledChildIds.length}</p>
   <p>{t('Recorded parent communication choices (not provider activation)','בחירות תקשורת מתועדות להורה (לא הפעלת ספק)')}: <bdi>{communicationPreferenceReadback(f.communicationPreferences).parentLanguage??t('Language not recorded','שפה לא תועדה')}</bdi> · {t('Educational email','דוא״ל חינוכי')}: <bdi>{communicationPreferenceStatusLabel(communicationPreferenceReadback(f.communicationPreferences).nurtureEmail,locale)}</bdi> · WAPI: <bdi>{communicationPreferenceStatusLabel(communicationPreferenceReadback(f.communicationPreferences).privateWapi,locale)}</bdi></p>
   <h5>{t('Registration and offer emails','הודעות דוא״ל להרשמה ולהצעות')}</h5>
   {data.messages.some(m=>m.familyId===f.id)?<ul>{data.messages.filter(m=>m.familyId===f.id).map(m=><li key={m.id}><p>{label(purposes,m.purpose,['Message purpose unverified — needs review','מטרת ההודעה לא אומתה — נדרשת בדיקה'])}</p><p>{label(messageStates,m.state,['Send status unverified — needs review','מצב השליחה לא אומת — נדרשת בדיקה'])}</p><p>{t('Message reference','אסמכתת הודעה')}: <bdi>{m.id}</bdi></p></li>)}</ul>:<p>{t('No email records are shown for this family.','לא מוצגות רשומות דוא״ל למשפחה זו.')}</p>}
  </article>)}
 </section>;
}
