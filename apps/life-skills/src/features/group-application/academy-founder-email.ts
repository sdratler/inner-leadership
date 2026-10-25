import {floridaDeadline} from './academy-founder-contract.ts';
// Academy mail uses the owner's public school domain. Identity/session origins
// and synthetic fixture origins remain unchanged.
function confirmationLink(origin:string,locale:'en'|'he',token:string){
 const publicAcademy=origin==='https://life-skills.bneineviimacademy.org'||origin==='https://bneineviimacademy.org';
 const base=publicAcademy?'https://bneineviimacademy.org'+(locale==='he'?'/he':'')+'/fishing-academy':origin+'/'+locale+'/florida';
 return base+'/confirm-interest#'+token;
}
export type FounderMailKind='interest'|'ack'|'offer'|'interest_reminder'|'payment_reminder'|'interest_deadline_receipt'|'payment_deadline_receipt';
export type FounderMail={familyId:string;generation:number;kind:FounderMailKind;locale:'en'|'he';to:string;reference:string;status:'reserved'|'interest_list'|'pending_verification';token?:string;deadline?:string;reminderDate?:string;unpaidLines?:{childId:string;offerId:string;revision:number;name:string;unpaidCents:number;deadline:string|null}[];offer?:{group:string;firstSession:string;children:{name:string;amount:number}[];paymentUrl:string;terms:string};};
/** Drafts for owner review. No scheduling-hold exception or enrollment claims. */
export function founderEmailContent(p:FounderMail,origin:string){
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
