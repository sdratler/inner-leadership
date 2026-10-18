import type {Locale} from "../../lib/locale.ts";
import type {InquiryEmailSetupReport} from "./inquiry-email-setup.ts";

type Status=InquiryEmailSetupReport["fields"][keyof InquiryEmailSetupReport["fields"]];
const keys=["LS_INQUIRY_EMAIL_QUEUE_ENABLED","LS_INQUIRY_EMAIL_SEND_ENABLED","LS_AUTH_EMAIL_ENABLED","LS_AUTH_EMAIL_PROVIDER","LS_AUTH_EMAIL_FROM","LS_AUTH_GOOGLE_CLIENT_ID","LS_AUTH_GOOGLE_CLIENT_SECRET","LS_AUTH_GOOGLE_REFRESH_TOKEN"] as const;
const statuses:readonly Status[]=["DISABLED","SET_UNVERIFIED","HOLD_REQUIRED","MISSING","MISMATCH","INVALID"];
function own(value:unknown,key:string):unknown{
 try{if(!value||typeof value!=="object"||Array.isArray(value))return undefined;const field=Object.getOwnPropertyDescriptor(value,key);return field&&"value"in field?field.value:undefined;}
 catch{return undefined;}
}
function snapshot(report:unknown):{queue:Status;sending:Status;configured:boolean;details:readonly Status[]}|null{
 const fields=own(report,"fields"),status=own(report,"status"),queueEnabled=own(report,"queueEnabled"),provider=own(report,"providerSetup");
 const purpose:InquiryEmailSetupReport["purpose"]="academy_inquiry_acknowledgment_v1";
 if(own(report,"purpose")!==purpose||own(report,"sendPermitted")!==false||own(report,"senderVerified")!==false||own(report,"deliveryVerified")!==false||typeof queueEnabled!=="boolean"||typeof status!=="string"||!["SEND_DISABLED","HOLD_REQUIRED"].includes(status))return null;
 const values:Status[]=[];
 for(const key of keys){
  const value=own(fields,key);if(typeof value!=="string"||!statuses.includes(value as Status))return null;
  values.push(value as Status);
 }
 const [queue,sending,auth,providerField,sender,...credentials]=values;
 if(!queue||!sending||!auth||!providerField||!sender||!["DISABLED","SET_UNVERIFIED","INVALID"].includes(queue)||!["DISABLED","HOLD_REQUIRED","INVALID"].includes(sending)||!["DISABLED","SET_UNVERIFIED","INVALID"].includes(auth))return null;
 if(![providerField,sender].every(value=>["MISSING","MISMATCH","SET_UNVERIFIED","INVALID"].includes(value))||!credentials.every(value=>["MISSING","SET_UNVERIFIED","INVALID"].includes(value)))return null;
 const configured=values.slice(2).every(value=>value==="SET_UNVERIFIED");
 if(queueEnabled!==(queue==="SET_UNVERIFIED")||(status==="HOLD_REQUIRED")!==(sending==="HOLD_REQUIRED")||provider!==(configured?"CONFIGURED_UNVERIFIED":"INCOMPLETE"))return null;
 return {queue,sending,configured,details:values.slice(2)};
}

/** Unmounted readonly operator presentation, never authority or configuration.
 * Runtime imports do not load the server-only inspector. Only fixed whitelist
 * copy is rendered; arbitrary report values, keys and credentials are omitted.
 */
export function InquiryEmailSetupSummary({report,locale}:Readonly<{report?:InquiryEmailSetupReport|null;locale:Locale}>){
 const language=locale==="he"?"he":"en",t=(en:string,he:string)=>language==="he"?he:en;
 const view=locale==="en"||locale==="he"?snapshot(report):null;
 const hold=own(report,"status")==="HOLD_REQUIRED"||own(own(report,"fields"),"LS_INQUIRY_EMAIL_SEND_ENABLED")==="HOLD_REQUIRED";
 const title=t("Inquiry confirmation email setup","הגדרת הודעת אישור הפנייה");
 const labels=[t("Email transport switch","מתג שירות הדוא״ל"),t("Gmail provider","ספק Gmail"),t("Sender setting","הגדרת השולח"),t("OAuth client ID","מזהה לקוח OAuth"),t("OAuth client secret","סוד לקוח OAuth"),t("OAuth refresh token","אסימון רענון OAuth")];
 const stateText:Record<Status,string>={DISABLED:t("Disabled","כבוי"),SET_UNVERIFIED:t("Set — unverified","מוגדר — לא אומת"),HOLD_REQUIRED:t("Sending hold required","נדרשת עצירת שליחה"),MISSING:t("Missing","חסר"),MISMATCH:t("Does not match","אינו תואם"),INVALID:t("Invalid","לא תקין")};
 return <section className="lsw-stack lsw-card" lang={language} dir={language==="he"?"rtl":"ltr"} aria-label={title}>
  <h2>{title}</h2>
  {hold&&<p role="alert">{t("Sending hold required: restore sending to OFF before proceeding.","נדרשת עצירת שליחה: יש להחזיר את הגדרת השליחה לכבוי לפני שממשיכים.")}</p>}
  {view?<>
   <dl>
    <dt>{t("Inquiry email queue","תור הודעות אישור הפנייה")}</dt>
    <dd>{view.queue==="SET_UNVERIFIED"?t("Queue enabled; delivery is not confirmed.","התור מופעל; מסירה לא אושרה."):view.queue==="DISABLED"?t("Queue disabled.","התור כבוי."):t("Queue setting is invalid; queue is not enabled.","הגדרת התור אינה תקינה; התור אינו מופעל.")}</dd>
    <dt>{t("Sending","שליחה")}</dt>
    <dd>{view.sending==="HOLD_REQUIRED"?stateText.HOLD_REQUIRED:view.sending==="DISABLED"?t("Sending is OFF. Keep it OFF for this release.","השליחה כבויה. יש להשאירה כבויה במהלך ההשקה הזו."):t("Sending setting is invalid. Keep sending OFF.","הגדרת השליחה אינה תקינה. יש להשאיר את השליחה כבויה.")}</dd>
    <dt>{t("Provider setup","הגדרת הספק")}</dt>
    <dd>{view.configured?t("Structurally configured — unverified.","מוגדר מבחינה מבנית — לא אומת."):t("Setup is incomplete; sender and delivery remain unverified.","ההגדרה אינה שלמה; השולח והמסירה טרם אומתו.")}</dd>
   </dl>
   <dl aria-label={t("Setup fields","שדות ההגדרה")}>{view.details.map((state,index)=><div key={keys[index+2]}><dt>{labels[index]}</dt><dd>{stateText[state]}</dd></div>)}</dl>
  </>:<p role="status">{t("Email setup information is unavailable. Keep sending OFF.","פרטי הגדרת הדוא״ל אינם זמינים. יש להשאיר את השליחה כבויה.")}</p>}
  <p>{t("A queue entry is not a delivery receipt. Sender access and delivery are unverified.","רישום בתור אינו אישור מסירה. הגישה לשולח והמסירה לא אומתו.")}</p>
 </section>;
}
