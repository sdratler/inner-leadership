import {describe,it,expect} from "vitest";
import {readFile} from "node:fs/promises";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {FloridaJourneyPreview} from "../../src/features/group-application/journey-preview.tsx";
import {journeyPreviewEnabled} from "../../src/features/group-application/journey-preview-model.ts";
import {practitionerDetailReturnPath,loginReturnDestination} from "../../src/features/identity/login-return.ts";
import {academyLandingDraft,academyJourneyDraft,academyRollingLandingDraft,academyRollingJourneyDraft,academyLandingForMode,academyJourneyForMode} from "../../src/features/group-application/academy-draft.ts";
import {journeySourceManifest,journeyProgramName} from "../../src/features/group-application/journey-preview-model.ts";
import {fitCallDraft} from "../../src/features/group-application/fit-call-draft.tsx";
import {floridaGroupApplicationNotice} from "../../src/features/group-application/contract.ts";
const local={LS_APP_ORIGIN:"https://localhost:3105",LS_DATABASE_URL:"postgresql://synthetic:temporary@127.0.0.1:55441/ls_calendar_test_journeys",LS_APP_MODE:"foundation_preview",LS_GROUP_APPLICATION_SYNTHETIC_LOOPBACK:"true"};
describe("private Florida journey containment",()=>{
 it("visibly dates superseded Academy illustrations without changing other programs or historical attestations",()=>{
  for(const locale of ["en","he"] as const)for(const mode of ["native","sample"] as const){
   const html=renderToStaticMarkup(createElement(FloridaJourneyPreview,{locale,programId:"sunday_fishing_academy",mode}));
   expect(html).toContain('data-historical-academy="true"');
   expect(html).toContain(locale==="he"?"13 באוקטובר 2026":"13 October 2026");
   expect(html).toContain(locale==="he"?"ארבעה שלבים של שנים־עשר מפגשים":"four twelve-session stages");
   expect(html).toContain(locale==="he"?"יציאות רשות בתשלום נפרד":"optional, separately priced outings");
   expect(html).toContain(locale==="he"?"מחייב בתשלום או מאשר יציאה":"charge or clear a trip");
   for(const programId of ["morning_torah_learning","private_fishing_life_skills"] as const)
    expect(renderToStaticMarkup(createElement(FloridaJourneyPreview,{locale,programId,mode}))).not.toContain("data-historical-academy");
  }
 });
 it("uses current Academy ranks while preserving historical source attestations and unavailable access",()=>{
  expect(academyLandingDraft.cards).toHaveLength(4);
  expect(academyRollingLandingDraft.cards).toHaveLength(3);
  for(const locale of ["en","he"] as const){
   expect(journeyProgramName("sunday_fishing_academy",locale)).toBe(academyLandingDraft.label[locale]);
   expect(academyRollingLandingDraft.cards.map(card=>card.title[locale]).join(" ")).toMatch(/A.*B.*C/);
   expect(academyRollingLandingDraft.sectionBody[locale]).toContain(locale==="he"?"רצף הלימוד המתוכנן":"planned teaching sequence");
   expect(academyRollingLandingDraft.sectionBody[locale]).toContain(locale==="he"?"השלמת היציאות יסוכמו בנפרד":"outing completion are agreed separately");
   expect(academyLandingDraft.sectionBody[locale]).toContain(locale==="he"?"ארבעה שלבים":"four stages");
   expect(academyJourneyDraft.access[locale]).toContain(locale==="he"?"עדיין לא מומש":"not implemented");
   expect(academyJourneyDraft.access[locale]).toContain(locale==="he"?"רשומות קליניות נשארות מבודדות":"clinical records remain isolated");
   expect(academyJourneyDraft.enrollment[locale]).toContain(locale==="he"?"לא נרכשה או הוקצתה":"No actual rank is purchased or allocated");
  }
  expect(JSON.stringify({landing:academyLandingDraft,journey:academyJourneyDraft})).not.toMatch(/\$\d|tuition.*not.*selected|3–3.5|one scheduled weekday local outing/i);
  expect(journeySourceManifest.academy).toMatchObject({websiteSection:35,productSection:34,status:"proposed",draftVersion:"3.2",commercialAgreement:"reviewed draft; actual offer and family-use approval pending"});
  expect(journeySourceManifest.academy.english.sha256).toBe("034ce55d694e693e40167dc6536964115681d179fc57b7fff20784bb72febd16");
  expect(journeySourceManifest.academy.hebrew.sha256).toBe("c728587361e9c348e477507b1302ec90b62ebb563d3b3e35548f20515dda3f81");
  expect(journeyProgramName("morning_torah_learning","en")).toBe("Morning Torah Learning");
  expect(journeyProgramName("private_fishing_life_skills","en")).toBe("Private Fishing & Life Skills");
 });
 it("shares current presentation without changing separate native/sample behavior or historical forms",()=>{
  expect(academyLandingForMode("native")).toBe(academyLandingDraft);expect(academyJourneyForMode("native")).toBe(academyJourneyDraft);
  expect(academyLandingForMode("sample")).toBe(academyLandingDraft);expect(academyJourneyForMode("sample")).toBe(academyRollingJourneyDraft);
  expect(academyRollingLandingDraft.id).toBe("sunday_fishing_academy");expect(academyRollingLandingDraft.label).not.toEqual(academyLandingDraft.label);
  expect(journeySourceManifest.privateProposal).toMatchObject({instruction:"LS-FISH-MODULE-ROLLING-20261013-06",websiteSection:36,productSection:35,scope:"authenticated owner sample only",moduleStart:"unresolved",maximumWait:"unresolved"});
  expect(journeySourceManifest.privateProposal.forms).toContain("inquiry-only");
  expect(journeySourceManifest.privateProposal.deliveryInstruction).toBe("LS-FISH-DAYTIME-ENROLL-20261013-08");
  expect(journeySourceManifest.rollingForms.english.sha256).toBe("337ec8c43345e48806612d4580c2505017b76f1b20bd93856bcf57a885663b51");
  expect(journeySourceManifest.rollingForms.hebrew.sha256).toBe("4e1fc9c3d6aeb88cf1fb898992ad511ef613f071c71fafa1496b9bdd7c79c6df");
 });
 it("rehearses corrected four-credit ranks without a sale, fixed calendar or readiness grant",()=>{
  for(const locale of ["en","he"] as const){
   const [a,b,c]=academyRollingLandingDraft.cards;
   expect(a!.body[locale]).toContain(locale==="he"?"שלוש יחידות הכנה":"Three preparation credits");
   expect(a!.body[locale]).toContain(locale==="he"?"כיחידה הרביעית":"fourth credit");
   expect(b!.body[locale]).toContain(locale==="he"?"ארבע יחידות שטח":"Four defined supervised field credits");
   expect(c!.body[locale]).toContain(locale==="he"?"שלוש יחידות הכנה":"Three advanced preparation credits");
   expect(c!.body[locale]).toContain(locale==="he"?"קברניט וצוות מקצועיים":"professionally captained and crewed");
   expect(academyJourneyDraft.calendarInclusions[locale]).toContain(locale==="he"?"אינן ארבעה ימי ראשון רצופים":"do not mean four consecutive Sundays");
   expect(academyRollingJourneyDraft.creditState[locale]).toContain(locale==="he"?"אין דרגה בבעלות או פנקס יחידות":"No owned rank or credit ledger exists");
   expect(academyRollingJourneyDraft.creditState[locale]).toContain(locale==="he"?"בטיחות: ללא אישור":"Safety: not cleared");
   expect(academyRollingJourneyDraft.access[locale]).toContain(locale==="he"?"רשומות קליניות נשארות מבודדות":"clinical records remain isolated");
  }
  expect(JSON.stringify({landing:academyRollingLandingDraft,journey:academyRollingJourneyDraft})).not.toMatch(/\$\d|₪\d|staff role is granted|free voyage is earned/);
 });
 it("uses existing canonical control tokens without changing semantic warning/focus styling",async()=>{
  const css=await readFile(new URL("../../src/features/group-application/journey-preview.module.css",import.meta.url),"utf8");
  expect(css).toContain("color:var(--ls-deep,#163F48)");expect(css).toContain("background:var(--ls-teal,#245159)");
  expect(css).not.toMatch(/#08756d|#173f46/);expect(css).toContain(".warning{background:#fff2d4");expect(css).toContain("outline:3px solid #ce972c");
 });
 it("keeps actual scheduling, credit terms and trip clearance separate from the teaching plan",()=>{
  for(const locale of ["en","he"] as const){
   expect(academyJourneyDraft.calendarInclusions[locale]).toContain(locale==="he"?"אינה רכישה שנייה":"not a second purchase");
   expect(academyJourneyDraft.calendarInclusions[locale]).toContain(locale==="he"?"ההמתנה המרבית":"Maximum offshore wait");
   expect(academyJourneyDraft.enrollment[locale]).toContain(locale==="he"?"שנים־עשר שבועות שחלפו אינם מאשרים":"Twelve elapsed weeks do not confirm");
   expect(academyJourneyDraft.access[locale]).toContain(locale==="he"?"לעולם אינם מאשרים יציאה":"never clear a trip");
   expect(academyRollingLandingDraft.price[locale]).toContain(locale==="he"?"אינה מחייבת בתשלום":"No payment is required");
   expect(academyLandingDraft.boundary[locale]).toContain(locale==="he"?"אינה מחייבת בתשלום":"does not reserve a place or require payment");
  }
 });
 it("preserves only known owner sample returns, without customer entitlement or open redirects",()=>{
  for(const locale of ["en","he"] as const)for(const page of ["florida-journeys","florida-landing"])for(const program of ["sunday_fishing_academy","morning_torah_learning","private_fishing_life_skills"]){
   const path=`/${locale}/sample?page=${page}&program=${program}`;
   expect(loginReturnDestination(locale,"practitioner",path+"&role=parent&unsafe=x")).toBe(path);
   expect(loginReturnDestination(locale,"parent",path)).toBe(`/${locale}/family/schedule`);
   expect(loginReturnDestination(locale,"child",path)).toBe(`/${locale}/client`);
  }
  for(const path of ["//evil.invalid/en/sample?page=florida-journeys&program=sunday_fishing_academy","/en/sample?page=florida-journeys&program=unknown","/he/sample?page=florida-journeys&program=sunday_fishing_academy","/en/sample?page=florida-journeys&program=sunday_fishing_academy#unsafe"]){
   expect(loginReturnDestination("en","practitioner",path)).toBe("/en/app/calendar");
  }
 });
 it("requires the explicit disposable loopback target and preview mode",()=>{
  expect(journeyPreviewEnabled(local)).toBe(true);
  for(const env of [{...local,LS_DATABASE_URL:"postgresql://synthetic@127.0.0.1/live"},{...local,LS_DATABASE_URL:"postgresql://synthetic@db.railway.internal/ls_calendar_test_journeys"},{...local,LS_APP_ORIGIN:"https://life-skills.bneineviimacademy.org"},{...local,LS_APP_MODE:"production"},{...local,LS_GROUP_APPLICATION_SYNTHETIC_LOOPBACK:undefined},{...local,LS_DATABASE_URL:local.LS_DATABASE_URL+"?sslmode=disable"}])expect(journeyPreviewEnabled(env)).toBe(false);
 });
 it("keeps only a known program in the ordinary practitioner login return",()=>{
  const path="/he/app/group-applications/journey-preview";
  expect(practitionerDetailReturnPath("he",path,{program:"morning_torah_learning"})).toBe(path+"?program=morning_torah_learning");
  expect(practitionerDetailReturnPath("he",path,{program:"https://evil.invalid",role:"practitioner"})).toBe(path);
 });
 it("prepares a localized inquiry-specific draft without a meeting or payment promise",()=>{
  for(const programId of ["sunday_fishing_academy","morning_torah_learning","private_fishing_life_skills"] as const)for(const locale of ["en","he"] as const){
   const draft=fitCallDraft({id:"synthetic-reference",source:"public_group_application",state:"owner_review",receivedAt:"2026-10-13T00:00:00Z",fields:{parentName:"Synthetic guardian",contact:"synthetic@example.invalid",language:locale,cityArea:"Synthetic Florida",programId,schedulePreference:["flexible"],permission:{confirmed:true,version:floridaGroupApplicationNotice.version,language:locale}}},locale);
   expect(draft).toContain("synthetic-reference");expect(draft).toContain("Synthetic guardian");expect(draft).not.toContain("15–20");expect(draft).toContain(locale==="he"?"כאן שלמה":"this is Shlomo");expect(draft).not.toContain("http");expect(draft).not.toMatch(/\$\d|paid|enrolled/);
  }
 });
});
