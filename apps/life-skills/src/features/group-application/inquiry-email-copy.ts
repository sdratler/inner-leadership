import {z} from "zod";
import {AppError} from "../../lib/errors.ts";
export const INQUIRY_EMAIL_PURPOSE="academy_inquiry_acknowledgment_v1";
export const INQUIRY_EMAIL_FROM="office@bneineviimacademy.org";
export function inquiryEmailContent(reference:string,locale:"en"|"he"){
 if(!z.string().uuid().safeParse(reference).success||!["en","he"].includes(locale))throw new AppError("INVALID_REQUEST");
 return locale==="he"?{
  subject:"פנייתכם התקבלה — South Florida Jewish Leadership Fishing Academy",
  text:`פנייתכם ל-South Florida Jewish Leadership Fishing Academy נשמרה באופן פרטי לבדיקת הבעלים.\nמספר הפנייה: ${reference}\nהצעד הבא הוא בדיקת הפנייה ויצירת קשר בנוגע להתאמה ולפרטים.\nזו הודעת אישור לפנייה בלבד. היא אינה אישור הרשמה, תשלום, מקום בקבוצה או הזמנת פעילות.\nאין צורך לשלוח את הפנייה שוב.`,
 }:{
  subject:"Inquiry received — South Florida Jewish Leadership Fishing Academy",
  text:`Your inquiry to South Florida Jewish Leadership Fishing Academy was saved privately for owner review.\nReference: ${reference}\nThe next step is a review of your inquiry and contact about fit and details.\nThis acknowledges an inquiry only. It does not confirm enrollment, payment, a place in a group or a booking.\nYou do not need to submit the inquiry again.`,
 };
}
