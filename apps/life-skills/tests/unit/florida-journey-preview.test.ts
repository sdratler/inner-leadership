import {describe,it,expect} from "vitest";
import {journeyPreviewEnabled} from "../../src/features/group-application/journey-preview-model.ts";
import {practitionerDetailReturnPath,loginReturnDestination} from "../../src/features/identity/login-return.ts";
import {academyLandingDraft,academyJourneyDraft} from "../../src/features/group-application/academy-draft.ts";
import {journeySourceManifest,journeyProgramName} from "../../src/features/group-application/journey-preview-model.ts";
import {fitCallDraft} from "../../src/features/group-application/fit-call-draft.tsx";
import {floridaGroupApplicationNotice} from "../../src/features/group-application/contract.ts";
const local={LS_APP_ORIGIN:"https://localhost:3105",LS_DATABASE_URL:"postgresql://synthetic:temporary@127.0.0.1:55441/ls_calendar_test_journeys",LS_APP_MODE:"foundation_preview",LS_GROUP_APPLICATION_SYNTHETIC_LOOPBACK:"true"};
describe("private Florida journey containment",()=>{
 it("places the twelve-week proposal in academy-only display copy without settled commercial or access claims",()=>{
  expect(academyLandingDraft.cards).toHaveLength(3);
  for(const locale of ["en","he"] as const){
   expect(journeyProgramName("sunday_fishing_academy",locale)).toBe(academyLandingDraft.label[locale]);
   expect(academyLandingDraft.cards.map(card=>card.title[locale]).join(" ")).toMatch(/9–12/);
   const copy=JSON.stringify({landing:academyLandingDraft,journey:academyJourneyDraft});
   expect(copy).not.toMatch(/one package payment|included trip is not a second purchase|Keys culmination stays included|\$\d/);
   expect(academyJourneyDraft.access[locale]).toContain(locale==="he"?"עדיין לא מומש":"not implemented");
   expect(academyJourneyDraft.access[locale]).toContain(locale==="he"?"רשומות קליניות נשארות מבודדות":"clinical records remain isolated");
   expect(academyLandingDraft.boundary[locale]).toContain(locale==="he"?"אינם מעניקים אישור":"never grant clearance");
  }
  expect(journeySourceManifest.academy).toMatchObject({websiteSection:34,productSection:33,status:"proposed",commercialAgreement:"pending source-owner amendment"});
  expect(journeyProgramName("morning_torah_learning","en")).toBe("Morning Torah Learning");
  expect(journeyProgramName("private_fishing_life_skills","en")).toBe("Private Fishing & Life Skills");
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
   expect(draft).toContain("synthetic-reference");expect(draft).toContain("Synthetic guardian");expect(draft).toContain("15–20");expect(draft).not.toContain("http");expect(draft).not.toMatch(/\$\d|paid|enrolled/);
  }
 });
});
