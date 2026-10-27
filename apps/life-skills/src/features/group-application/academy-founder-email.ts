import {floridaDeadline} from './academy-founder-contract.ts';
import {academyExactEmails} from './academy-exact-copy.ts';
// Academy mail uses the owner's public school domain. Identity/session origins
// and synthetic fixture origins remain unchanged.
function confirmationLink(origin:string,locale:'en'|'he',token:string){
 const publicAcademy=origin==='https://life-skills.bneineviimacademy.org'||origin==='https://bneineviimacademy.org';
 const base=publicAcademy?'https://bneineviimacademy.org'+(locale==='he'?'/he':'')+'/fishing-academy':origin+'/'+locale+'/florida';
 return base+'/confirm-interest#'+token;
}
export type FounderMailKind='interest'|'ack'|'offer'|'interest_reminder'|'payment_reminder'|'interest_deadline_receipt'|'payment_deadline_receipt';
/** Current announcement/payment-clock copy identity, not send authority.
 * Existing saved payloads never acquire this marker or current catalog by inference. */
export const R00_ANNOUNCEMENT_CLOCK='JLFA-OWNER-PAYMENT-CLOCK-CORRECTION-20261027-01' as const;
export type R00AnnouncementClock={version:typeof R00_ANNOUNCEMENT_CLOCK;approvalReceiptSha256:string};
export function isAnnouncementR00(p:FounderMail){return p.kind==='interest'&&p.transactional?.templateId==='R00'&&p.transactional.r00Exception?.version===R00_ANNOUNCEMENT_CLOCK&&p.transactional.r00Exception.approvalReceiptSha256==='caeab55524e61c98273b01c9884f15b707e502bc6e145360ebf4575ba55bde3a';}
export type FounderTransactionalMail={
 version:'JLFA-EXACT-COPY-20261026-05';templateId:'R00'|'R01'|'R02'|'R03';parentFirstName?:string;
 r00Exception?:R00AnnouncementClock;acceptedSend?:{sentAt:string;deadline?:string};confirmed?:boolean;founderRateReserved?:boolean;
};
export type FounderMail={transactional?:FounderTransactionalMail;familyId:string;generation:number;kind:FounderMailKind;locale:'en'|'he';to:string;reference:string;status:'reserved'|'interest_list'|'pending_verification';token?:string;deadline?:string;reminderDate?:string;unpaidLines?:{childId:string;offerId:string;revision:number;name:string;unpaidCents:number;deadline:string|null}[];offer?:{group:string;firstSession:string;children:{name:string;amount:number}[];paymentUrl:string;terms:string};};
/** Drafts for owner review. No scheduling-hold exception or enrollment claims. */
export function founderEmailContent(p:FounderMail,origin:string){
 if(p.transactional!==undefined)return exactTransactionalContent(p,origin);
 const he=p.locale==='he',t=(en:string,heText:string)=>he?heText:en;
 const lines=[t('Hello,','שלום,'),'',t('Your Jewish Leadership Fishing Academy registration reference is ','מספר ההרשמה שלכם לאקדמיה היהודית לדיג ולמנהיגות: ')+p.reference];
 if(p.kind==='interest_deadline_receipt')throw Error('FOUNDER_INTEREST_DEADLINE_SUPERSEDED');
 if(p.kind==='payment_deadline_receipt'){
  if(!p.deadline)throw Error('FOUNDER_SENT_DEADLINE_REQUIRED');
  lines.push(t('Your group offer has now been sent successfully. Its separate payment deadline is: ','הצעת הקבוצה נשלחה בהצלחה. המועד הנפרד לתשלום הוא: ')+floridaDeadline(p.deadline,p.locale),t('This receipt records the existing deadline; it does not start a new window.','הודעה זו מתעדת את המועד הקיים; היא אינה מתחילה חלון חדש.'));
 }else if(p.kind==='interest'||p.kind==='interest_reminder'){
  lines.push(t(p.status==='reserved'?'Your free registration is saved. Your founding-family rate is reserved pending confirmation of interest.':p.status==='interest_list'?'Your registration is saved. A founding-family rate has not been reserved. We will contact you about suitable ordinary registration options.':'Your free registration is saved. Founder-rate eligibility is pending verification.',p.status==='reserved'?'ההרשמה החינמית נשמרה. תעריף המשפחה המייסדת שמור בכפוף לאישור ההתעניינות.':p.status==='interest_list'?'ההרשמה נשמרה. לא נשמר תעריף משפחה מייסדת. ניצור קשר לגבי אפשרויות מתאימות להרשמה רגילה.':'ההרשמה החינמית נשמרה. הזכאות לתעריף משפחה מייסדת ממתינה לבדיקה.'),t('Please confirm your interest. No payment is due and no start date has been set.','אנא אשרו שאתם מעוניינים. אין תשלום כעת וטרם נקבע מועד פתיחה.'));
  lines.push(t("We expect to announce the start date within the next couple of weeks. Once we announce it, you’ll have seven days to pay and secure your place.","אנו מצפים להודיע על מועד הפתיחה בשבועיים הקרובים. מרגע שנודיע עליו, יהיו לכם שבעה ימים לשלם ולהבטיח את מקומכם."));
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
 const announcement=isAnnouncementR00(p);
 if(input.templateId==='R00'&&(!announcement||input.acceptedSend!==undefined)||input.templateId!=='R00'&&input.r00Exception!==undefined)throw Error('ACADEMY_R00_ANNOUNCEMENT_CLOCK_REQUIRED');
 let link='';
 if(input.templateId==='R03'){
  if(input.confirmed!==true)throw Error('ACADEMY_TRANSACTIONAL_CONFIRMATION_REQUIRED');
 }else{
  // Reminder provenance is the actual accepted initial send, never an interest
  // expiry or payment clock. A historical deadline field is deliberately ignored.
  if(input.templateId!=='R00'&&(!input.acceptedSend||!validInstant(input.acceptedSend.sentAt)))throw Error('ACADEMY_TRANSACTIONAL_ACCEPTED_SEND_REQUIRED');
  if(!p.token||!/^[A-Za-z0-9_-]{43}$/.test(p.token))throw Error('ACADEMY_TRANSACTIONAL_TOKEN_REQUIRED');
  const parsed=new URL(origin);
  if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.origin!==origin||!['bneineviimacademy.org','life-skills.bneineviimacademy.org','127.0.0.1','[::1]'].includes(parsed.hostname))throw Error('ACADEMY_TRANSACTIONAL_ORIGIN_INVALID');
  link=confirmationLink(origin,p.locale,p.token);
 }
 const values:Record<string,string>={parent_first_name:name??'',reservation_sentence:copy.reservationSentences[p.status],confirmed_founder_sentence:input.confirmed===true&&input.founderRateReserved===true&&p.status==='reserved'?copy.confirmedFounderSentence:''};
 const interpolate=(text:string)=>text.replace(/\{([a-z_]+)\}/g,(_match,key:string)=>{if(!Object.hasOwn(values,key))throw Error('ACADEMY_TRANSACTIONAL_PLACEHOLDER_INVALID');return values[key]!;});
 const blocks=template.blocks.map((block,index)=>({...block,text:index===0&&!name?copy.greetingFallback:interpolate(block.text)})).filter(block=>block.text!=='');
 const text=blocks.map(block=>block.kind==='action'?block.text+': '+link:block.text).join('\n\n');
 const preview=interpolate(template.preview),subject=interpolate(template.subject);
 const html='<div lang="'+p.locale+'" dir="'+(p.locale==='he'?'rtl':'ltr')+'"><div style="display:none;max-height:0;overflow:hidden" aria-hidden="true">'+htmlEscape(preview)+'</div>'+blocks.map(block=>block.kind==='action'?'<p><a href="'+htmlEscape(link)+'" style="display:inline-block;background-color:#FDC844;color:#041858;font-size:16px;line-height:24px;font-weight:700;text-decoration:none;text-align:center;min-height:48px;box-sizing:border-box;padding:12px 24px;border-radius:8px;">'+htmlEscape(block.text)+'</a></p>':'<p>'+htmlEscape(block.text).replace(/\n/g,'<br>')+'</p>').join('')+'</div>';
 return {subject,text,preview,html};
}
