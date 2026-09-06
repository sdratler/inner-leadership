import { AppError } from "../../lib/errors.ts";
import { TOKEN_PATTERN } from "../../features/identity/crypto.ts";
import type { AuthMailKind,AuthMailPayload } from "../../features/identity/auth-mail.ts";
export function authEmailContent(origin:string,kind:AuthMailKind,payload:AuthMailPayload):{subject:string;text:string} {
 const parsed=new URL(origin);if(parsed.protocol!=='https:' || parsed.origin!==origin) throw new AppError("UNAVAILABLE");
 const he=payload.locale==='he';let link=origin;
 const route={invite:'/auth/invite',reset:'/auth/reset',email_change:'/auth/verify-email'} as const;
 if(kind==='invite' || kind==='reset' || kind==='email_change'){
  if(!payload.token || !TOKEN_PATTERN.test(payload.token)) throw new AppError("UNAVAILABLE");
  // Fragment never reaches the HTTP access log. The client exchanges it only in a CSRF-protected POST body.
  link=`${origin}${route[kind]}#token=${payload.token}`;
 }
 const subject=he?'החשבון האישי שלך':'Your private account';
 const intro=kind==='invite'?(he?'התקבלה הזמנה לחשבון האישי שלך.':'You have been invited to your private account.'):
  kind==='reset'?(he?'התקבלה בקשה לאיפוס הסיסמה שלך.':'A password reset was requested for your account.'):
  kind==='email_change'?(he?'אפשר לאמת את כתובת הדואר החדשה בקישור הבא.':'Confirm your new email address using this link.'):
  kind==='case_notice'?(he?'הגישה לחשבון שלך עודכנה. אפשר להיכנס לחשבון לצפייה.':'Your account access was updated. Sign in to review it.'):
  (he?'עודכנו הגדרות האבטחה בחשבון שלך. אם לא ביצעת שינוי זה, פנה למנהל החשבון.':'Your account security settings changed. Contact the account administrator if you did not make this change.');
 const tail=he?'אין להעביר הודעה זו לאחרים. אם לא ביקשת פעולה זו, אין להשתמש בקישור.':'Do not forward this message. If you did not request this action, do not use the link.';
 return {subject,text:`${intro}\n\n${link}\n\n${tail}`};
}
