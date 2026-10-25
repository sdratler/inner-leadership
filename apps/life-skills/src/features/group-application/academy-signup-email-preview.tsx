"use client";
import {useId,useState} from 'react';
import type {Locale} from '../../lib/locale.ts';
import type {SignupEmailReview} from './academy-signup-email-review.ts';

const kinds=['interest','ack','interest_reminder','interest_deadline_receipt'] as const;
const statuses=['reserved','interest_list','pending_verification'] as const;
const object=(value:unknown):value is Record<string,unknown>=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);
const keys=(value:Record<string,unknown>,expected:string[])=>Object.keys(value).length===expected.length&&expected.every(key=>Object.hasOwn(value,key));
const hash=(value:unknown)=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
/** Reject unsupported DTO shapes; content is escaped text, never HTML, links or send commands. */
export function isSignupEmailReview(value:unknown):value is SignupEmailReview{
 if(!object(value)||!keys(value,['version','state','syntheticExample','delivery','formatter','example','drafts'])||value.version!=='academy-signup-email-review-v1'||value.state!=='draft_review_required'||value.syntheticExample!==true||value.delivery!=='not_sent'||value.formatter!=='founderEmailContent')return false;
 if(!object(value.example)||!keys(value.example,['reference','deadline'])||value.example.reference!=='SYNTHETIC-PREVIEW-NOT-A-FAMILY'||value.example.deadline!=='2030-01-15T15:00:00.000Z'||!Array.isArray(value.drafts)||value.drafts.length!==8)return false;
 const seen=new Set<string>();
 for(const draft of value.drafts){
  if(!object(draft)||!keys(draft,['id','language','kind','variants'])||(draft.language!=='en'&&draft.language!=='he')||!kinds.some(k=>k===draft.kind)||draft.id!==draft.kind+'-'+draft.language||seen.has(draft.id as string)||!Array.isArray(draft.variants))return false;
  seen.add(draft.id as string);const expected=draft.kind==='interest'||draft.kind==='interest_reminder'?statuses:['not_applicable'];
  if(draft.variants.length!==expected.length)return false;
  for(let i=0;i<expected.length;i++){
   const v=draft.variants[i];if(!object(v)||!keys(v,['status','subject','text','subjectSha256','textSha256'])||v.status!==expected[i]||typeof v.subject!=='string'||!v.subject.trim()||v.subject.length>300||typeof v.text!=='string'||v.text.length>12000||!v.text.includes(value.example.reference)||!hash(v.subjectSha256)||!hash(v.textSha256))return false;
  }
 }
 return true;
}

export function AcademySignupEmailPreview({locale,review}:{locale:Locale;review:SignupEmailReview}){
 const id=useId(),[language,setLanguage]=useState<'en'|'he'>(locale),[kind,setKind]=useState<typeof kinds[number]>('interest'),[status,setStatus]=useState<typeof statuses[number]>('reserved');
 const t=(en:string,he:string)=>locale==='he'?he:en;
 if(!isSignupEmailReview(review))return <section lang={locale} dir={locale==='he'?'rtl':'ltr'}><p role="status">{t('Signup email review is unavailable. No draft or delivery status has been verified.','תצוגת הודעות ההרשמה אינה זמינה. לא אומתו טיוטה או מצב משלוח.')}</p></section>;
 const draft=review.drafts.find(d=>d.language===language&&d.kind===kind)!,variant=draft.variants.find(v=>v.status===status)??draft.variants[0]!;
 const names={interest:t('Thank-you and interest request','תודה ובקשת אישור התעניינות'),ack:t('Interest confirmed acknowledgment','אישור קבלת ההתעניינות'),interest_reminder:t('Interest confirmation reminder','תזכורת לאישור ההתעניינות'),interest_deadline_receipt:t('Deadline receipt after successful send','הודעת מועד לאחר שליחה מוצלחת')};
 const stateNames={reserved:t('Founder rate reserved','תעריף משפחה מייסדת שמור'),interest_list:t('Ordinary registration','הרשמה רגילה'),pending_verification:t('Founder eligibility awaiting verification','הזכאות לתעריף מייסדים ממתינה לבדיקה')};
 const selectStyle={display:'block',minHeight:44,maxWidth:'100%',font:'inherit',margin:'0.25rem 0 1rem'};
 return <section data-academy-signup-email-review lang={locale} dir={locale==='he'?'rtl':'ltr'} style={{maxWidth:'48rem',overflowWrap:'anywhere'}}>
  <h3>{t('Registration email drafts','טיוטות דוא״ל להרשמה')}</h3>
  <p><strong>{t('Synthetic examples — owner approval required. Not sent.','דוגמאות סינתטיות — נדרש אישור בעלים. לא נשלחו.')}</strong></p>
  <p>{t('Review only. The reference, date and confirmation token are examples. Wording about a successful send or confirmed interest below illustrates a later state; it is not a real delivery receipt. These previews cannot send, approve or confirm anything.','לעיון בלבד. מספר הפנייה, התאריך ואסימון האישור הם דוגמאות. הנוסח על שליחה מוצלחת או התעניינות שאושרה למטה מדגים מצב עתידי; זו אינה קבלה על משלוח אמיתי. התצוגה אינה שולחת, מאשרת או מבצעת פעולה.')}</p>
  <label htmlFor={id+'-language'}>{t('Email language','שפת ההודעה')}</label><select id={id+'-language'} name="signupPreviewLanguage" style={selectStyle} value={language} onChange={e=>setLanguage(e.target.value==='he'?'he':'en')}><option value="en">English</option><option value="he">עברית</option></select>
  <label htmlFor={id+'-kind'}>{t('Email template','תבנית ההודעה')}</label><select id={id+'-kind'} name="signupPreviewKind" style={selectStyle} value={kind} onChange={e=>{if(kinds.some(k=>k===e.target.value))setKind(e.target.value as typeof kind);}}>{kinds.map(k=><option key={k} value={k}>{names[k]}</option>)}</select>
  {draft.variants.length>1&&<><label htmlFor={id+'-status'}>{t('Example registration status','מצב הרשמה לדוגמה')}</label><select id={id+'-status'} name="signupPreviewStatus" style={selectStyle} value={status} onChange={e=>{if(statuses.some(s=>s===e.target.value))setStatus(e.target.value as typeof status);}}>{statuses.map(s=><option key={s} value={s}>{stateNames[s]}</option>)}</select></>}
  <article data-signup-email-draft={draft.id} lang={language} dir={language==='he'?'rtl':'ltr'}>
   <h4>{variant.subject}</h4><div data-signup-email-text style={{whiteSpace:'pre-wrap'}}>{variant.text}</div>
  </article>
  <details><summary>{t('Draft version and exact content hashes','גרסת הטיוטה וגיבוב התוכן המדויק')}</summary><dl><dt>{t('Review version','גרסת תצוגה')}</dt><dd><bdi>{review.version}</bdi></dd><dt>{t('Subject SHA256','SHA256 של הנושא')}</dt><dd><bdi>{variant.subjectSha256}</bdi></dd><dt>{t('Body SHA256','SHA256 של התוכן')}</dt><dd><bdi>{variant.textSha256}</bdi></dd></dl></details>
 </section>;
}
