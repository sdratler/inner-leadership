import {expect,type Page} from "@playwright/test";
import type {InquiryEmailSetupReport} from "../../../src/features/group-application/inquiry-email-setup.ts";

type Readback={available:boolean;queueEnabled:boolean|null;holdRequired:boolean;providerConfigured:boolean|null};
type Expected=Readonly<{origin:string;locale:"en"|"he";title:string;footer:string;hold:string|null;unavailable:string;
 primary:readonly string[];details:readonly (readonly string[])[];fieldsLabel:string;scalars:Readonly<Readback>}>;
type State=InquiryEmailSetupReport["fields"][keyof InquiryEmailSetupReport["fields"]];
const origins=["https://localhost:3105","https://localhost:3106","https://localhost:3107","https://localhost:3108"] as const;
const fieldKeys=["LS_INQUIRY_EMAIL_QUEUE_ENABLED","LS_INQUIRY_EMAIL_SEND_ENABLED","LS_AUTH_EMAIL_ENABLED","LS_AUTH_EMAIL_PROVIDER","LS_AUTH_EMAIL_FROM","LS_AUTH_GOOGLE_CLIENT_ID","LS_AUTH_GOOGLE_CLIENT_SECRET","LS_AUTH_GOOGLE_REFRESH_TOKEN"] as const;
const scopeFailure="INQUIRY_EMAIL_SETUP_READBACK_SCOPE";
function own(value:unknown,key:string):unknown{
 if(!value||typeof value!=="object"||Array.isArray(value))return undefined;
 const entry=Object.getOwnPropertyDescriptor(value,key);return entry&&"value"in entry?entry.value:undefined;
}
function requireValue(value:unknown):asserts value{if(!value)throw new Error("INQUIRY_EMAIL_SETUP_READBACK_INPUT");}
function captureOrigin(input:unknown):string{
 const fixture=own(input,"fixture"),origin=own(input,"origin");
 requireValue(fixture==="SYNTHETIC_ONLY"&&typeof origin==="string"&&origins.some(value=>value===origin));
 return origin as string;
}
function hasOrigin(raw:string,origin:string):boolean{
 try{const url=new URL(raw);return url.origin===origin&&url.protocol==="https:"&&url.hostname==="localhost"&&!url.username&&!url.password;}catch{return false;}
}

/** Independent frozen-copy expectations; no production presenter/inspector oracle. */
function capture(input:unknown):Expected{
 const origin=captureOrigin(input),locale=own(input,"locale"),report=own(input,"report");
 requireValue(locale==="en"||locale==="he");
 const t=(en:string,he:string)=>locale==="he"?he:en;
 const title=t("Inquiry confirmation email setup","הגדרת הודעת אישור הפנייה");
 const footer=t("A queue entry is not a delivery receipt. Sender access and delivery are unverified.","רישום בתור אינו אישור מסירה. הגישה לשולח והמסירה לא אומתו.");
 const unavailable=t("Email setup information is unavailable. Keep sending OFF.","פרטי הגדרת הדוא״ל אינם זמינים. יש להשאיר את השליחה כבויה.");
 const fieldsLabel=t("Setup fields","שדות ההגדרה");
 if(report===null)return Object.freeze({origin,locale,title,footer,unavailable,fieldsLabel,hold:null,primary:Object.freeze([]),details:Object.freeze([]),
  scalars:Object.freeze({available:false,queueEnabled:null,holdRequired:false,providerConfigured:null})});
 const purpose:InquiryEmailSetupReport["purpose"]="academy_inquiry_acknowledgment_v1";
 requireValue(own(report,"purpose")===purpose&&own(report,"sendPermitted")===false&&own(report,"senderVerified")===false&&own(report,"deliveryVerified")===false);
 const fields=own(report,"fields"),states:State[]=[];
 for(const [index,key] of fieldKeys.entries()){
  const value=own(fields,key);
  const allowed:readonly string[]=index===0||index===2?["DISABLED","SET_UNVERIFIED","INVALID"]:index===1?["DISABLED","HOLD_REQUIRED","INVALID"]:index===3||index===4?["MISSING","MISMATCH","SET_UNVERIFIED","INVALID"]:["MISSING","SET_UNVERIFIED","INVALID"];
  requireValue(typeof value==="string"&&allowed.includes(value));states.push(value as State);
 }
 const queueEnabled=states[0]==="SET_UNVERIFIED",holdRequired=states[1]==="HOLD_REQUIRED",providerConfigured=states.slice(2).every(value=>value==="SET_UNVERIFIED");
 requireValue(own(report,"queueEnabled")===queueEnabled&&own(report,"status")===(holdRequired?"HOLD_REQUIRED":"SEND_DISABLED")&&own(report,"providerSetup")===(providerConfigured?"CONFIGURED_UNVERIFIED":"INCOMPLETE"));
 const primary=Object.freeze([
  t("Inquiry email queue","תור הודעות אישור הפנייה"),queueEnabled?t("Queue enabled; delivery is not confirmed.","התור מופעל; מסירה לא אושרה."):states[0]==="DISABLED"?t("Queue disabled.","התור כבוי."):t("Queue setting is invalid; queue is not enabled.","הגדרת התור אינה תקינה; התור אינו מופעל."),
  t("Sending","שליחה"),holdRequired?t("Sending hold required","נדרשת עצירת שליחה"):states[1]==="DISABLED"?t("Sending is OFF. Keep it OFF for this release.","השליחה כבויה. יש להשאירה כבויה במהלך ההשקה הזו."):t("Sending setting is invalid. Keep sending OFF.","הגדרת השליחה אינה תקינה. יש להשאיר את השליחה כבויה."),
  t("Provider setup","הגדרת הספק"),providerConfigured?t("Structurally configured — unverified.","מוגדר מבחינה מבנית — לא אומת."):t("Setup is incomplete; sender and delivery remain unverified.","ההגדרה אינה שלמה; השולח והמסירה טרם אומתו."),
 ]);
 const names=[t("Email transport switch","מתג שירות הדוא״ל"),t("Gmail provider","ספק Gmail"),t("Sender setting","הגדרת השולח"),t("OAuth client ID","מזהה לקוח OAuth"),t("OAuth client secret","סוד לקוח OAuth"),t("OAuth refresh token","אסימון רענון OAuth")];
 const labels:Readonly<Record<State,string>>={DISABLED:t("Disabled","כבוי"),SET_UNVERIFIED:t("Set — unverified","מוגדר — לא אומת"),HOLD_REQUIRED:t("Sending hold required","נדרשת עצירת שליחה"),MISSING:t("Missing","חסר"),MISMATCH:t("Does not match","אינו תואם"),INVALID:t("Invalid","לא תקין")};
 const details=Object.freeze(states.slice(2).map((state,index)=>Object.freeze([names[index]!,labels[state]])));
 return Object.freeze({origin,locale,title,footer,unavailable,fieldsLabel,primary,details,
  hold:holdRequired?t("Sending hold required: restore sending to OFF before proceeding.","נדרשת עצירת שליחה: יש להחזיר את הגדרת השליחה לכבוי לפני שממשיכים."):null,
  scalars:Object.freeze({available:true,queueEnabled,holdRequired,providerConfigured})});
}

async function guardedPoll(page:Page,origin:string,read:()=>Promise<boolean>):Promise<void>{
 let stopped=false;
 const guard=()=>{if(stopped||!hasOrigin(page.url(),origin)){stopped=true;throw new Error(scopeFailure);}};
 try{
  guard();
  await expect.poll(async()=>{
   guard();
   try{const matched=await read();guard();return matched;}
   catch(error){if(error instanceof Error&&error.message.includes(scopeFailure))stopped=true;guard();return false;}
  },{timeout:5000,intervals:[100,250],message:"INQUIRY_EMAIL_SETUP_READBACK_PENDING"}).toBe(true);
  guard();
 }catch{throw new Error(stopped?scopeFailure:"INQUIRY_EMAIL_SETUP_READBACK_UNAVAILABLE");}
}

/** Root owns ordinary practitioner login, fresh authorized GET, details opening
 * and separately reviewed native admission. A supplied DTO/fixture tag is not
 * authorization, sender verification, activation or delivery evidence. This
 * helper only reads an already-open synthetic page; it never changes the page.
 */
export async function verifyInquiryEmailSetupReadback(page:Page,input:{fixture:"SYNTHETIC_ONLY";origin:string;locale:"en"|"he";report:InquiryEmailSetupReport|null}):Promise<Readback>{
 try{
  const expected=capture(input); // All caller values are captured before polling.
  await guardedPoll(page,expected.origin,()=>page.evaluate(expected=>{
   const guard=()=>{const current=new URL(location.href);if(current.origin!==expected.origin||current.protocol!=="https:"||current.hostname!=="localhost"||current.username||current.password)throw new Error("INQUIRY_EMAIL_SETUP_READBACK_SCOPE");};
   guard();
   try{
    const normalize=(value:string)=>value.replace(/\s+/gu," ").trim();
    const visible=(element:Element)=>{
     if(!(element instanceof HTMLElement)||element.getClientRects().length===0)return false;
     const rect=element.getBoundingClientRect();if(rect.width<=0||rect.height<=0)return false;
     for(let current:HTMLElement|null=element;current;current=current.parentElement){const style=getComputedStyle(current);if(current.hidden||current.getAttribute("aria-hidden")==="true"||style.display==="none"||style.visibility!=="visible"||Number(style.opacity)===0)return false;}
     return true;
    };
    const leaf=(element:Element|undefined,tag:string,text:string)=>!!element&&element.tagName===tag&&element.children.length===0&&visible(element)&&normalize(element.textContent??"")===normalize(text);
    const markers=document.querySelectorAll("[data-inquiry-email-setup]");
    if(markers.length!==1)return false;const marker=markers[0];
    if(!(marker instanceof HTMLDetailsElement)||!marker.open||!visible(marker))return false;
    const sections=marker.querySelectorAll("section"),section=sections[0];
    if(sections.length!==1||!(section instanceof HTMLElement)||!visible(section)||section.lang!==expected.locale||section.dir!==(expected.locale==="he"?"rtl":"ltr")||section.getAttribute("aria-label")!==expected.title)return false;
    if(Array.from(document.querySelectorAll("section")).filter(node=>node.getAttribute("aria-label")===expected.title).length!==1)return false;
    if(section.querySelectorAll('a,button,input,select,textarea,form,script,iframe,details,summary,[role="button"],[role="link"],[contenteditable]:not([contenteditable="false"]),[onclick],[onchange],[onsubmit]').length!==0)return false;
    const children=Array.from(section.children);let index=0;
    if(!leaf(children[index++],"H2",expected.title))return false;
    if(expected.hold){const alert=children[index++];if(!leaf(alert,"P",expected.hold)||alert?.getAttribute("role")!=="alert")return false;}
    if(section.querySelectorAll('[role="alert"]').length!==(expected.hold?1:0))return false;
    if(expected.scalars.available){
     const primary=children[index++],details=children[index++];
     if(primary?.tagName!=="DL"||!visible(primary)||primary.children.length!==6||details?.tagName!=="DL"||!visible(details)||details.getAttribute("aria-label")!==expected.fieldsLabel||details.children.length!==6)return false;
     for(let i=0;i<6;i++)if(!leaf(primary.children[i],i%2===0?"DT":"DD",expected.primary[i]!))return false;
     for(let i=0;i<6;i++){const row=details.children[i],pair=expected.details[i]!;if(row?.tagName!=="DIV"||!visible(row)||row.children.length!==2||!leaf(row.children[0],"DT",pair[0]!)||!leaf(row.children[1],"DD",pair[1]!))return false;}
     if(section.querySelectorAll('[role="status"]').length!==0)return false;
    }else{
     const unavailable=children[index++];if(!leaf(unavailable,"P",expected.unavailable)||unavailable?.getAttribute("role")!=="status"||section.querySelectorAll('[role="status"]').length!==1||section.querySelectorAll("dl").length!==0)return false;
    }
    if(!leaf(children[index++],"P",expected.footer)||index!==children.length)return false;
    // Also reject extra raw text between elements, without returning DOM strings.
    const all=[expected.title,...(expected.hold?[expected.hold]:[]),...(expected.scalars.available?[...expected.primary,...expected.details.flat()]:[expected.unavailable]),expected.footer].join("");
    return (section.textContent??"").replace(/\s/gu,"")===all.replace(/\s/gu,"");
   }finally{guard();}
  },expected));
  return Object.freeze({...expected.scalars});
 }catch{throw new Error("INQUIRY_EMAIL_SETUP_READBACK_FAILED");}
}

/** Root causes loading/failure/denial first. This asserts absence only; it does
 * not navigate, log in, fabricate a denied state or infer authority from it. */
export async function expectInquiryEmailSetupAbsent(page:Page,input:{fixture:"SYNTHETIC_ONLY";origin:string}):Promise<void>{
 try{
  const origin=captureOrigin(input);
  await guardedPoll(page,origin,()=>page.evaluate(origin=>{
   const guard=()=>{const current=new URL(location.href);if(current.origin!==origin||current.protocol!=="https:"||current.hostname!=="localhost"||current.username||current.password)throw new Error("INQUIRY_EMAIL_SETUP_READBACK_SCOPE");};
   guard();try{return document.querySelectorAll("[data-inquiry-email-setup]").length===0;}finally{guard();}
  },origin));
 }catch{throw new Error("INQUIRY_EMAIL_SETUP_ABSENCE_FAILED");}
}
