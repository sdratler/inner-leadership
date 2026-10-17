/** Pure synthetic markup only; no mounted operator/auth/provider acceptance. */
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import dgram from "node:dgram";
import {afterAll,afterEach,beforeAll,describe,expect,test,vi} from "vitest";
vi.mock("../../src/features/group-application/inquiry-email-setup.ts",()=>{throw new Error("SERVER_INSPECTOR_MUST_NOT_LOAD_AT_RUNTIME");});
import type {InquiryEmailSetupReport} from "../../src/features/group-application/inquiry-email-setup.ts";
import type {Locale} from "../../src/lib/locale.ts";
import {InquiryEmailSetupSummary} from "../../src/features/group-application/inquiry-email-setup-summary.tsx";

const CANARY="PRIVATE_SETUP1085_credential_address@example.invalid_ID_<script>secret</script>";
const noNetwork=vi.fn(()=>{throw new Error("UNEXPECTED_NETWORK_ATTEMPT");});
beforeAll(()=>{
 vi.stubGlobal("fetch",noNetwork);vi.stubGlobal("WebSocket",noNetwork);
 vi.spyOn(http,"request").mockImplementation(noNetwork);vi.spyOn(http,"get").mockImplementation(noNetwork);
 vi.spyOn(https,"request").mockImplementation(noNetwork);vi.spyOn(https,"get").mockImplementation(noNetwork);
 vi.spyOn(net,"connect").mockImplementation(noNetwork);vi.spyOn(net,"createConnection").mockImplementation(noNetwork);
 vi.spyOn(net.Socket.prototype,"connect").mockImplementation(noNetwork);
 vi.spyOn(tls,"connect").mockImplementation(noNetwork);vi.spyOn(dgram,"createSocket").mockImplementation(noNetwork);
});
afterEach(()=>{expect(noNetwork).not.toHaveBeenCalled();});
afterAll(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
function report():InquiryEmailSetupReport{return {purpose:"academy_inquiry_acknowledgment_v1",status:"SEND_DISABLED",queueEnabled:true,providerSetup:"CONFIGURED_UNVERIFIED",sendPermitted:false,senderVerified:false,deliveryVerified:false,fields:{
 LS_INQUIRY_EMAIL_QUEUE_ENABLED:"SET_UNVERIFIED",LS_INQUIRY_EMAIL_SEND_ENABLED:"DISABLED",LS_AUTH_EMAIL_ENABLED:"SET_UNVERIFIED",LS_AUTH_EMAIL_PROVIDER:"SET_UNVERIFIED",LS_AUTH_EMAIL_FROM:"SET_UNVERIFIED",LS_AUTH_GOOGLE_CLIENT_ID:"SET_UNVERIFIED",LS_AUTH_GOOGLE_CLIENT_SECRET:"SET_UNVERIFIED",LS_AUTH_GOOGLE_REFRESH_TOKEN:"SET_UNVERIFIED",
}};}
// Casts deliberately exercise malformed runtime input; production uses the type-only DTO.
function render(value:unknown=report(),locale:unknown="en"){
 const html=renderToStaticMarkup(createElement(InquiryEmailSetupSummary,{report:value as InquiryEmailSetupReport,locale:locale as Locale}));
 expect(html).not.toContain("PRIVATE_SETUP1085");expect(html).not.toContain("example.invalid");expect(html).not.toContain("academy_inquiry_acknowledgment_v1");expect(html).not.toContain("LS_AUTH_");expect(html).not.toContain("LS_INQUIRY_");
 expect(html).not.toMatch(/<(?:form|button|input|select|textarea|a|script)\b/i);expect(html).not.toMatch(/\b(?:onClick|onSubmit|onChange)=/i);expect(html).not.toMatch(/\bready\b/i);
 return html;
}
const unavailable=(locale:Locale)=>locale==="he"?"פרטי הגדרת הדוא״ל אינם זמינים":"Email setup information is unavailable";

describe.each(["en","he"] as const)("%s operator setup summary",locale=>{
 test("separates queue, OFF sending and unverified provider structure with accessible direction",()=>{
  const html=render(report(),locale);expect(html).toContain(`lang="${locale}"`);expect(html).toContain(`dir="${locale==="he"?"rtl":"ltr"}"`);expect(html).toContain("lsw-stack lsw-card");
  for(const label of locale==="he"?["תור הודעות אישור הפנייה","שליחה","הגדרת הספק","השליחה כבויה","מוגדר מבחינה מבנית — לא אומת","רישום בתור אינו אישור מסירה"]:["Inquiry email queue","Sending","Provider setup","Sending is OFF","Structurally configured — unverified","A queue entry is not a delivery receipt"])expect(html).toContain(label);
  expect(html).not.toContain('role="alert"');expect(html).not.toContain(unavailable(locale));
 });
 test.each([false,true])("a sending HOLD visibly requires restoring OFF, queue=%s",queue=>{
  const value=report(),held={...value,queueEnabled:queue,status:"HOLD_REQUIRED",fields:{...value.fields,LS_INQUIRY_EMAIL_QUEUE_ENABLED:queue?"SET_UNVERIFIED":"DISABLED",LS_INQUIRY_EMAIL_SEND_ENABLED:"HOLD_REQUIRED"}};
  const before=structuredClone(held),html=render(held,locale);
  expect(html).toContain('role="alert"');expect(html).toContain(locale==="he"?"יש להחזיר את הגדרת השליחה לכבוי לפני שממשיכים":"restore sending to OFF before proceeding");expect(held).toEqual(before);
  expect(html).toContain(queue?(locale==="he"?"התור מופעל; מסירה לא אושרה":"Queue enabled; delivery is not confirmed"):(locale==="he"?"התור כבוי":"Queue disabled"));
 });
 test("queue OFF and structurally configured remain independent",()=>{
  const value=report(),html=render({...value,queueEnabled:false,fields:{...value.fields,LS_INQUIRY_EMAIL_QUEUE_ENABLED:"DISABLED"}},locale);
  expect(html).toContain(locale==="he"?"התור כבוי":"Queue disabled");expect(html).toContain(locale==="he"?"מוגדר מבחינה מבנית — לא אומת":"Structurally configured — unverified");
 });
 test("invalid queue/sending settings remain distinct from missing provider setup",()=>{
  const value=report(),html=render({...value,queueEnabled:false,fields:{...value.fields,LS_INQUIRY_EMAIL_QUEUE_ENABLED:"INVALID",LS_INQUIRY_EMAIL_SEND_ENABLED:"INVALID"}},locale);
  expect(html).toContain(locale==="he"?"הגדרת התור אינה תקינה":"Queue setting is invalid");expect(html).toContain(locale==="he"?"הגדרת השליחה אינה תקינה":"Sending setting is invalid");expect(html).toContain(locale==="he"?"מוגדר מבחינה מבנית — לא אומת":"Structurally configured — unverified");
 });
 test.each(["MISSING","MISMATCH","INVALID"] as const)("fixed provider status %s is localized without printing a value",state=>{
  const value=report(),html=render({...value,providerSetup:"INCOMPLETE",fields:{...value.fields,LS_AUTH_EMAIL_PROVIDER:state,LS_AUTH_EMAIL_FROM:state}},locale);
  expect(html).toContain(locale==="he"?"ההגדרה אינה שלמה":"Setup is incomplete");expect(html).toContain(({MISSING:locale==="he"?"חסר":"Missing",MISMATCH:locale==="he"?"אינו תואם":"Does not match",INVALID:locale==="he"?"לא תקין":"Invalid"})[state]);
 });
 test.each(["DISABLED","INVALID"] as const)("email transport switch %s cannot imply configured sender access",state=>{
  const value=report(),html=render({...value,providerSetup:"INCOMPLETE",fields:{...value.fields,LS_AUTH_EMAIL_ENABLED:state}},locale);expect(html).toContain(locale==="he"?"ההגדרה אינה שלמה":"Setup is incomplete");
 });
 test.each(["LS_AUTH_GOOGLE_CLIENT_ID","LS_AUTH_GOOGLE_CLIENT_SECRET","LS_AUTH_GOOGLE_REFRESH_TOKEN"] as const)("missing %s uses fixed localized field labels",key=>{
  const value=report(),html=render({...value,providerSetup:"INCOMPLETE",fields:{...value.fields,[key]:"MISSING"}},locale);expect(html).toContain(locale==="he"?"חסר":"Missing");expect(html).toContain(locale==="he"?"מזהה לקוח OAuth":"OAuth client ID");expect(html).toContain(locale==="he"?"סוד לקוח OAuth":"OAuth client secret");expect(html).toContain(locale==="he"?"אסימון רענון OAuth":"OAuth refresh token");
 });
 test.each([null,undefined,{},[],123,CANARY])("missing or malformed report is unavailable (%s)",value=>{
  // Pass undefined as an own prop rather than use render's default argument.
  const html=value===undefined?renderToStaticMarkup(createElement(InquiryEmailSetupSummary,{locale})):render(value,locale);expect(html).toContain(unavailable(locale));expect(html).not.toContain(locale==="he"?"מוגדר מבחינה מבנית":"Structurally configured");
 });
 test.each(["purpose","status","queueEnabled","providerSetup","sendPermitted","senderVerified","deliveryVerified","fields"])("missing required %s is unavailable",key=>{
  const value={...report()};Reflect.deleteProperty(value,key);expect(render(value,locale)).toContain(unavailable(locale));
 });
 test.each(["sendPermitted","senderVerified","deliveryVerified"])("a supplied true %s cannot create a readiness claim",key=>{expect(render({...report(),[key]:true},locale)).toContain(unavailable(locale));});
 test("contradictory queue, hold or provider states are unavailable",()=>{
  for(const changes of [{queueEnabled:false},{status:"HOLD_REQUIRED"},{providerSetup:"INCOMPLETE"}])expect(render({...report(),...changes},locale)).toContain(unavailable(locale));
 });
 test("a recognized HOLD survives an otherwise invalid report",()=>{
  for(const value of [{status:"HOLD_REQUIRED"},{fields:{LS_INQUIRY_EMAIL_SEND_ENABLED:"HOLD_REQUIRED"}}, {...report(),status:"HOLD_REQUIRED",purpose:CANARY}]){
   const html=render(value,locale);expect(html).toContain(unavailable(locale));expect(html).toContain('role="alert"');expect(html).toContain(locale==="he"?"יש להחזיר את הגדרת השליחה לכבוי":"restore sending to OFF");
  }
 });
 test.each(["LS_INQUIRY_EMAIL_QUEUE_ENABLED","LS_INQUIRY_EMAIL_SEND_ENABLED","LS_AUTH_EMAIL_ENABLED","LS_AUTH_EMAIL_PROVIDER","LS_AUTH_EMAIL_FROM","LS_AUTH_GOOGLE_CLIENT_ID","LS_AUTH_GOOGLE_CLIENT_SECRET","LS_AUTH_GOOGLE_REFRESH_TOKEN"])("unrecognized status in %s is unavailable without disclosure",key=>{
  const value=report();expect(render({...value,fields:{...value.fields,[key]:CANARY}},locale)).toContain(unavailable(locale));
 });
 test("a known status in the wrong field is still unavailable",()=>{
  for(const [key,state] of [["LS_AUTH_GOOGLE_CLIENT_ID","MISMATCH"],["LS_AUTH_EMAIL_ENABLED","HOLD_REQUIRED"],["LS_INQUIRY_EMAIL_QUEUE_ENABLED","MISSING"],["LS_INQUIRY_EMAIL_SEND_ENABLED","SET_UNVERIFIED"]]){const value=report();expect(render({...value,fields:{...value.fields,[key!]:state}},locale)).toContain(unavailable(locale));}
 });
 test("unknown fields, addresses, IDs and credential canaries are not enumerated or printed",()=>{
  const value=report(),baseline=render(value,locale),extended={...value,raw:CANARY,address:CANARY,accountId:CANARY,credentials:CANARY,[CANARY]:CANARY,fields:{...value.fields,[CANARY]:CANARY}};
  expect(render(extended,locale)).toBe(baseline);
 });
 test("input report is unchanged and frozen reports render repeatedly",()=>{
  const value=report();Object.freeze(value.fields);Object.freeze(value);const before=structuredClone(value),first=render(value,locale);expect(render(value,locale)).toBe(first);expect(value).toEqual(before);
 });
 test("getters are never invoked and absent data stays unavailable",()=>{
  const value=report(),getter=vi.fn(()=>{throw new Error(CANARY);});Object.defineProperty(value,"fields",{get:getter});expect(render(value,locale)).toContain(unavailable(locale));expect(getter).not.toHaveBeenCalled();
 });
 test("report values are never coerced into strings or rendered through toString",()=>{
  const toString=vi.fn(()=>{throw new Error(CANARY);});expect(render({...report(),status:{toString}},locale)).toContain(unavailable(locale));expect(toString).not.toHaveBeenCalled();
 });
});
test("unsupported locale is unavailable in a fixed English fallback",()=>{
 const html=render(report(),CANARY);expect(html).toContain('lang="en"');expect(html).toContain('dir="ltr"');expect(html).toContain(unavailable("en"));
});
test("an inherited report is unavailable rather than reading prototype data",()=>{expect(render(Object.create(report()))).toContain(unavailable("en"));});
test("no logs, actions, delivery receipt or server-inspector runtime dependency",()=>{
 const spies=[vi.spyOn(console,"log"),vi.spyOn(console,"warn"),vi.spyOn(console,"error")];try{for(const locale of ["en","he"] as const){const html=render(report(),locale);expect(html).not.toContain("<dd>Sent</dd>");expect(html).not.toContain("<dd>Verified</dd>");expect(html).not.toContain("<dd>נשלח</dd>");expect(html).not.toContain("<dd>אומת</dd>");}for(const spy of spies)expect(spy).not.toHaveBeenCalled();}finally{for(const spy of spies)spy.mockRestore();}
});
