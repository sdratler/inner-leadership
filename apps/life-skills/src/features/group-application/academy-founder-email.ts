import {floridaCalendarDays,floridaDeadline} from './academy-founder-contract.ts';
import {academyExactEmails} from './academy-exact-copy.ts';
// Academy mail uses the owner's public school domain. Identity/session origins
// and synthetic fixture origins remain unchanged.
function confirmationLink(origin:string,locale:'en'|'he',token:string){
 const publicAcademy=origin==='https://life-skills.bneineviimacademy.org'||origin==='https://bneineviimacademy.org';
 const base=publicAcademy?'https://bneineviimacademy.org'+(locale==='he'?'/he':'')+'/fishing-academy':origin+'/'+locale+'/florida';
 return base+'/confirm-interest#'+token;
}
export type FounderMailKind='interest'|'ack'|'offer'|'interest_reminder'|'payment_reminder'|'interest_deadline_receipt'|'payment_deadline_receipt';
/** Conditional exception identity only; not an approval or send capability.
 * The original exact05 catalog remains immutable. Runtime admission separately
 * binds the actual owner exception receipt and this formatter's source hash. */
export const R00_RELATIVE_EXCEPTION='JLFA-R00-RELATIVE-SEND-CLOCK-20261027-01' as const;
export type R00RelativeException={version:typeof R00_RELATIVE_EXCEPTION;approvalReceiptSha256:string};
export function isRelativeR00(p:FounderMail){return p.kind==='interest'&&p.transactional?.templateId==='R00'&&p.transactional.r00Exception?.version===R00_RELATIVE_EXCEPTION&&/^[a-f0-9]{64}$/.test(p.transactional.r00Exception.approvalReceiptSha256);}
export type FounderTransactionalMail={
 version:'JLFA-EXACT-COPY-20261026-05';templateId:'R00'|'R01'|'R02'|'R03';parentFirstName?:string;
 r00Exception?:R00RelativeException;acceptedSend?:{sentAt:string;deadline:string};confirmed?:boolean;founderRateReserved?:boolean;
};
export type FounderMail={transactional?:FounderTransactionalMail;familyId:string;generation:number;kind:FounderMailKind;locale:'en'|'he';to:string;reference:string;status:'reserved'|'interest_list'|'pending_verification';token?:string;deadline?:string;reminderDate?:string;unpaidLines?:{childId:string;offerId:string;revision:number;name:string;unpaidCents:number;deadline:string|null}[];offer?:{group:string;firstSession:string;children:{name:string;amount:number}[];paymentUrl:string;terms:string};};
/** Drafts for owner review. No scheduling-hold exception or enrollment claims. */
export function founderEmailContent(p:FounderMail,origin:string){
 if(p.transactional!==undefined)return exactTransactionalContent(p,origin);
 const he=p.locale==='he',t=(en:string,heText:string)=>he?heText:en;
 const lines=[t('Hello,','שלום,'),'',t('Your Jewish Leadership Fishing Academy registration reference is ','מספר ההרשמה שלכם לאקדמיה היהודית לדיג ולמנהיגות: ')+p.reference];
 if(p.kind==='interest_deadline_receipt'||p.kind==='payment_deadline_receipt'){
  if(!p.deadline)throw Error('FOUNDER_SENT_DEADLINE_REQUIRED');
  lines.push(t(p.kind==='interest_deadline_receipt'?'Your confirmation request has now been sent successfully. Confirm your interest by: ':'Your group offer has now been sent successfully. Its separate payment deadline is: ',p.kind==='interest_deadline_receipt'?'בקשת אישור ההתעניינות נשלחה בהצלחה. יש לאשר עד: ':'הצעת הקבוצה נשלחה בהצלחה. המועד הנפרד לתשלום הוא: ')+floridaDeadline(p.deadline,p.locale),t('This receipt records the existing deadline; it does not start a new window.','הודעה זו מתעדת את המועד הקיים; היא אינה מתחילה חלון חדש.'));
 }else if(p.kind==='interest'||p.kind==='interest_reminder'){
  lines.push(t(p.status==='reserved'?'Your free registration is saved. Your founding-family rate is reserved pending confirmation of interest.':p.status==='interest_list'?'Your registration is saved. A founding-family rate has not been reserved. We will contact you about suitable ordinary registration options.':'Your free registration is saved. Founder-rate eligibility is pending verification.',p.status==='reserved'?'ההרשמה החינמית נשמרה. תעריף המשפחה המייסדת שמור בכפוף לאישור ההתעניינות.':p.status==='interest_list'?'ההרשמה נשמרה. לא נשמר תעריף משפחה מייסדת. ניצור קשר לגבי אפשרויות מתאימות להרשמה רגילה.':'ההרשמה החינמית נשמרה. הזכאות לתעריף משפחה מייסדת ממתינה לבדיקה.'),t('Please confirm your interest. No payment is due and no start date has been set.','אנא אשרו שאתם מעוניינים. אין תשלום כעת וטרם נקבע מועד פתיחה.'));
  if(p.deadline)lines.push(t('Confirm by: ','יש לאשר עד: ')+floridaDeadline(p.deadline,p.locale));
  else lines.push(t('You have seven calendar days after this email is successfully sent. Your exact Florida deadline appears on the confirmation page.','לרשותכם שבעה ימים קלנדריים לאחר שליחת הודעה זו בהצלחה. המועד המדויק לפי שעון פלורידה מופיע בעמוד האישור.'));
  if(p.token)lines.push(t('Confirm My Interest','אישור ההתעניינות שלי')+': '+confirmationLink(origin,p.locale,p.token));
 }else if(p.kind==='ack')lines.push(t('Thank you for confirming your interest. No payment is due. We have not set a start date. We will contact you about a suitable group and a separate offer.','תודה שאישרתם את התעניינותכם. אין תשלום כעת וטרם נקבע מועד פתיחה. ניצור איתכם קשר לגבי קבוצה מתאימה והצעה נפרדת.'));
 else if(p.kind==='payment_reminder'){
  if(!p.offer||!p.reminderDate||!p.unpaidLines?.length)throw Error('FOUNDER_CURRENT_UNPAID_LINES_REQUIRED');
  lines.push(t('Payment reminder for your current unpaid offers:','תזכורת לתשלום עבור ההצעות שטרם שולמו:'),...p.unpaidLines.map(l=>{if(!l.deadline)throw Error('FOUNDER_LINE_DEADLINE_REQUIRED');return l.name+': $'+(l.unpaidCents/100).toFixed(2)+' — '+floridaDeadline(l.deadline,p.locale);}),p.offer.paymentUrl,t('Verified payments are reflected separately for each child. There is no automatic future charge.','תשלומים מאומתים נרשמים בנפרד לכל ילד. אין חיוב עתידי אוטומטי.'));
 }else{
  if(!p.offer)throw Error('FOUNDER_OFFER_NOT_READY');
  lines.push(t('Your suitable group offer: ','ההצעה לקבוצה המתאימה: ')+p.offer.group,t('First session: ','המפגש הראשון: ')+floridaDeadline(p.offer.firstSession,p.locale),...p.offer.children.map(c=>c.name+': $'+c.amount),p.offer.terms,p.deadline?t('Complete payment by: ','יש להשלים את התשלום עד: ')+floridaDeadline(p.deadline,p.locale):t('Your separate seven-day payment window starts after this email is successfully sent. See the verified payment page for your exact Florida deadline.','חלון התשלום הנפרד בן שבעת הימים מתחיל לאחר שליחת הודעה זו בהצלחה. המועד המדויק לפי שעון פלורידה מופיע בעמוד התשלום המאומת.'),p.offer.paymentUrl,t('Only verified payment and completed admission confirm enrollment. There is no automatic future charge.','רק תשלום שאומת והשלמת תנאי הקבלה מאשרים הרשמה להשתתפות. אין חיוב עתידי אוטומטי.'));
 }
 lines.push('',t('Shlomo','שלמה'));
 return {subject:t(p.kind==='ack'?'Your interest is confirmed':p.kind.includes('offer')||p.kind==='payment_reminder'?'Your Fishing Academy group offer':'Confirm your free Fishing Academy registration',p.kind==='ack'?'ההתעניינות שלכם אושרה':p.kind==='offer'||p.kind==='payment_reminder'?'הצעת קבוצה באקדמיה לדיג':'אישור ההרשמה החינמית לאקדמיה לדיג'),text:lines.join('\n')};
}

function htmlEscape(value:string){return value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));}
function validInstant(value:unknown):value is string{return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;}
/** Explicit new payloads only. Rendering does not confer send or source authority. */
function exactTransactionalContent(p:FounderMail,origin:string){
 const input=p.transactional!;
 if(input.version!==academyExactEmails.version||!['en','he'].includes(p.locale)||!['reserved','interest_list','pending_verification'].includes(p.status))throw Error('ACADEMY_TRANSACTIONAL_VERSION_REQUIRED');
 const ids={R00:'interest',R01:'interest_reminder',R02:'interest_reminder',R03:'ack'} as const;
 if(!Object.hasOwn(ids,input.templateId)||ids[input.templateId]!==p.kind)throw Error('ACADEMY_TRANSACTIONAL_KIND_MISMATCH');
 const copy=academyExactEmails.locales[p.locale],template=copy.templates[input.templateId];
 const name=input.parentFirstName?.trim();
 if(name!==undefined&&(name.length>80||/[\u0000-\u001f\u007f{}]/.test(name)))throw Error('ACADEMY_TRANSACTIONAL_NAME_INVALID');
 if(input.confirmed!==undefined&&typeof input.confirmed!=='boolean'||input.founderRateReserved!==undefined&&typeof input.founderRateReserved!=='boolean')throw Error('ACADEMY_TRANSACTIONAL_EVIDENCE_INVALID');
 const relative=isRelativeR00(p);
 if(input.r00Exception!==undefined&&(!relative||input.acceptedSend!==undefined))throw Error('ACADEMY_R00_EXCEPTION_INVALID');
 let deadline='',link='';
 if(input.templateId==='R03'){
  if(input.confirmed!==true)throw Error('ACADEMY_TRANSACTIONAL_CONFIRMATION_REQUIRED');
 }else{
  const accepted=input.acceptedSend;
  if(!relative&&(!accepted||!validInstant(accepted.sentAt)||!validInstant(accepted.deadline)))throw Error('ACADEMY_TRANSACTIONAL_ACCEPTED_SEND_REQUIRED');
  const minimum=accepted?floridaCalendarDays(new Date(accepted.sentAt),7).getTime():NaN;
  // Extensions are possible for reminders; the initial rendered window is exact.
  if(!relative&&accepted&&(Date.parse(accepted.deadline)<minimum||input.templateId==='R00'&&Date.parse(accepted.deadline)!==minimum))throw Error('ACADEMY_TRANSACTIONAL_DEADLINE_MISMATCH');
  if(!p.token||!/^[A-Za-z0-9_-]{43}$/.test(p.token))throw Error('ACADEMY_TRANSACTIONAL_TOKEN_REQUIRED');
  const parsed=new URL(origin);
  if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.origin!==origin||!['bneineviimacademy.org','life-skills.bneineviimacademy.org','127.0.0.1','[::1]'].includes(parsed.hostname))throw Error('ACADEMY_TRANSACTIONAL_ORIGIN_INVALID');
  deadline=accepted?floridaDeadline(accepted.deadline,p.locale):'';link=confirmationLink(origin,p.locale,p.token);
 }
 const values:Record<string,string>={parent_first_name:name??'',reservation_sentence:copy.reservationSentences[p.status],interest_deadline_eastern:deadline,confirmed_founder_sentence:input.confirmed===true&&input.founderRateReserved===true&&p.status==='reserved'?copy.confirmedFounderSentence:''};
 const interpolate=(text:string)=>text.replace(/\{([a-z_]+)\}/g,(_match,key:string)=>{if(!Object.hasOwn(values,key))throw Error('ACADEMY_TRANSACTIONAL_PLACEHOLDER_INVALID');return values[key]!;});
 const relativeLine=p.locale==='en'?'You have seven calendar days after this email is successfully sent. Your exact Florida deadline appears on the confirmation page.':'לרשותכם שבעה ימים קלנדריים לאחר שליחת הודעה זו בהצלחה. המועד המדויק לפי שעון פלורידה מופיע בעמוד האישור.';
 const originalLine=p.locale==='en'?'Confirm by {interest_deadline_eastern}.':'יש לאשר עד {interest_deadline_eastern}.';
 if(relative&&template.blocks.filter(b=>b.text.startsWith(originalLine)).length!==1)throw Error('ACADEMY_R00_SOURCE_LINE_MISMATCH');
 const sourceBlocks=relative?template.blocks.map(b=>({...b,text:b.text.startsWith(originalLine)?relativeLine+b.text.slice(originalLine.length):b.text})):template.blocks;
 const blocks=sourceBlocks.map((block,index)=>({...block,text:index===0&&!name?copy.greetingFallback:interpolate(block.text)})).filter(block=>block.text!=='');
 const text=blocks.map(block=>block.kind==='action'?block.text+': '+link:block.text).join('\n\n');
 const preview=interpolate(template.preview),subject=interpolate(template.subject);
 const html='<div lang="'+p.locale+'" dir="'+(p.locale==='he'?'rtl':'ltr')+'"><div style="display:none;max-height:0;overflow:hidden" aria-hidden="true">'+htmlEscape(preview)+'</div>'+blocks.map(block=>block.kind==='action'?'<p><a href="'+htmlEscape(link)+'" style="display:inline-block;background-color:#FDC844;color:#041858;font-size:16px;line-height:24px;font-weight:700;text-decoration:none;text-align:center;min-height:48px;box-sizing:border-box;padding:12px 24px;border-radius:8px;">'+htmlEscape(block.text)+'</a></p>':'<p>'+htmlEscape(block.text).replace(/\n/g,'<br>')+'</p>').join('')+'</div>';
 return {subject,text,preview,html};
}
