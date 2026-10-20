import {describe,it,expect} from "vitest";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {readFile} from "node:fs/promises";
import {GroupApplicationLanding} from "../../src/features/group-application/landing.tsx";
import {GroupApplicationForm} from "../../src/features/group-application/application-form.tsx";
import {AcademyIntakePage} from "../../src/features/group-application/academy-intake-page.tsx";
import {academyQuestions} from "../../src/features/group-application/academy-public-program.ts";
import {floridaGroupApplicationNotice,floridaSchoolInquiryNotice} from "../../src/features/group-application/contract.ts";
import {academyRegistrationNotice} from "../../src/features/group-application/academy-registration-notice.ts";
import copy from "../../src/features/group-application/presentation-copy.json";

const markup=(locale:"en"|"he",programId:"sunday_fishing_academy"|"private_fishing_life_skills",mode:"native"|"sample")=>renderToStaticMarkup(createElement(GroupApplicationLanding,{locale,programId,mode}));
const escaped=(text:string)=>renderToStaticMarkup(createElement("span",null,text)).slice(6,-7);
describe("reviewed Florida presentation, not new runtime authority",()=>{
 it("adopts the current V4 core FAQ and removes superseded mixed academic inclusions without changing other funnels",()=>{
  expect(copy.realMensch.academy.faqs).toHaveLength(11);const faq=copy.realMensch.academy.faqs[6]!;
  for(const locale of ["en","he"] as const){
   const sample=markup(locale,"sunday_fishing_academy","sample");expect(sample).toContain(escaped(faq[0]![locale]));expect(sample).toContain(escaped(faq[1]![locale]));
   const native=markup(locale,"sunday_fishing_academy","native");for(const current of academyQuestions){expect(native).toContain(escaped(current.question[locale]));expect(native).toContain(escaped(current.answer[locale]));}
   expect(markup(locale,"private_fishing_life_skills","native")).not.toContain(escaped(faq[0]![locale]));
  }
  expect(faq[1]!.en).toContain("It does not include a full math, science, English or Jewish-studies curriculum");expect(faq[1]!.en).toContain("compulsory academic homework or a digital classroom");expect(JSON.stringify(faq)).not.toMatch(/\$|guaranteed|reimburse/i);
 });
 it("retains every base CSS-module layout key when merging additions",async()=>{
  const [baseCss,additionCss,landing]=await Promise.all(["landing.module.css","landing-additions.module.css","landing.tsx"].map(file=>readFile(new URL("../../src/features/group-application/"+file,import.meta.url),"utf8")));
  const exported=(css:string)=>[...new Set([...css.matchAll(/\.([a-zA-Z_][a-zA-Z0-9_-]*)/g)].map(match=>match[1]!))];
  const baseKeys=exported(baseCss!),additionKeys=exported(additionCss!),collisions=additionKeys.filter(key=>baseKeys.includes(key));
  expect(collisions).toEqual([]);
  const base=Object.fromEntries(baseKeys.map(key=>[key,"base_"+key])),additions=Object.fromEntries(additionKeys.map(key=>[key,"addition_"+key])),merged={...base,...additions};
  for(const key of baseKeys)expect(merged[key]).toBe(base[key]);
  expect(baseKeys).toContain("how");expect(baseKeys).toContain("twoColumn");
  expect(baseCss).toMatch(/\.twoColumn\{display:grid;grid-template-columns:/);
  expect(landing).toContain('className={`${styles.wrap} ${styles.twoColumn} ${styles.learningRow}`}');
  expect(additionKeys).toContain("learningRow");
 });
 for(const locale of ["en","he"] as const)for(const mode of ["native","sample"] as const){
  it(`renders one Academy headline/benefit row and the same contact action in ${locale}/${mode}`,()=>{
   const html=markup(locale,"sunday_fishing_academy",mode);
   expect(html.match(/<h1\b/g)).toHaveLength(1);
   if(mode==="native"){
    expect(html).toContain(locale==="he"?'<h1 id="academy-title">האקדמיה היהודית לדיג ולמנהיגות בדרום פלורידה</h1>':'<h1 id="academy-title">South Florida Jewish Leadership Fishing Academy</h1>');
    expect(html).toContain(locale==="he"?'תורה • דיג • הנהגה עצמית':'Torah • Fishing • Self-Governance');
    expect(html).toMatch(/<a[^>]*href="#pricing"[^>]*data-jlfa-primary="true"/);expect(html).toContain(`href="/${locale}/florida/apply"`);
    expect(html).not.toContain('data-inquiry-kind=');expect(html).not.toContain('name="contact"');
    const form=renderToStaticMarkup(createElement(AcademyIntakePage,{locale}));expect(form.match(/name="contact"/g)).toHaveLength(1);expect(form).toContain('data-inquiry-kind="parent"');expect(form).toContain(escaped(academyRegistrationNotice[locale]));expect(form).not.toContain(escaped(floridaGroupApplicationNotice[locale]));expect(form).not.toContain('name="permission" checked');
   }else{
    expect(html).toContain(`<h1>${copy.realMensch.academy.title[locale]}</h1>`);expect(html).toContain("TORAH • FISHING • SELF-GOVERNANCE");
    expect(html.match(new RegExp(`href="#apply"[^>]*>${copy.realMensch.shared.ctaAcademy[locale]}`,"g"))).toHaveLength(2);
    expect(html).toContain('aria-controls="jlfa-curriculum"');
    expect(html.match(/name="contact"/g)).toHaveLength(2);expect(html).toContain(escaped(floridaGroupApplicationNotice[locale]));expect(html).toContain(escaped(floridaSchoolInquiryNotice[locale]));
   }
   // The existing accepted overview is now on demand (JLFA-WEB-SIMPLE-02),
   // not rendered as the entire curriculum on the initial page.
   for(const card of copy.realMensch.academy.cards)expect(html).not.toContain(escaped(card.body[locale]));
   expect(html).not.toContain(copy.shared.previewBanner[locale]);
   expect(html).toContain(`dir="${locale==="he"?"rtl":"ltr"}"`);
   expect(html).not.toContain(mode==="sample"?"program=morning_torah_learning":"torah-mornings");
   expect(html).not.toContain(mode==="sample"?"program=private_fishing_life_skills":"private-fishing");
   expect(html).not.toMatch(/Pre-register|This page does not create|No invented launch details|\$1,100|\$2,399|\$3,000/);
   expect(html).not.toContain('name="permission" checked');
  });
  it(`keeps VIP individually considered, without Academy schedules or implied packages in ${locale}/${mode}`,()=>{
   const html=markup(locale,"private_fishing_life_skills",mode);
   expect(html).toContain(`<h1>${copy.vip.title[locale]}</h1>`);
   expect(html).toContain(copy.vip.price[locale]);expect(html).toContain(copy.vip.boundary[locale]);
   expect(html).not.toContain('value="weekday_morning_homeschool"');
   expect(html).not.toContain('data-inquiry-kind="institution"');expect(html).not.toContain("/groups/private/skill-");
   expect(html.match(/name="contact"/g)).toHaveLength(1);
   expect(html).not.toMatch(/\$3,000|3–3.5|viewBox="0 0 24 24"/);
  });
 }
 it("keeps sample validation nonwriting and never renders a durable confirmation initially",()=>{
  for(const locale of ["en","he"] as const){
   const html=renderToStaticMarkup(createElement(GroupApplicationForm,{locale,programId:"sunday_fishing_academy",mode:"sample"}));
   expect(html).toContain(copy.inquiry.sampleBanner[locale]);expect(html).toContain(copy.inquiry.sampleSubmit[locale]);
   expect(html).not.toContain(copy.inquiry.savedTitle[locale]);
   expect(html).not.toContain("Published group preference");
  }
 });
 it("keeps the retained save/replay, mode and exact runtime consent guards",async()=>{
  const source=await readFile(new URL("../../src/features/group-application/application-form.tsx",import.meta.url),"utf8");
  expect(source).toContain("notice.version");expect(source).toContain("permissionRef.current.checked=false");
  expect(source).toContain('if(mode==="sample"){setPreviewed(true);onPreviewed?.();return;}');
  expect(source).toContain('body.data?.saved!==true');expect(source).toContain('typeof body.data?.item?.id!=="string"');
  expect(source).toContain("operationId:pending.current.command.operationId");
  expect(source).toContain('<fieldset className={styles.fieldset} disabled={busy||uncertain||(fullIntake&&saved)}>');expect(source).toContain("previouslyUncertain");
 });
 it("does not bundle private pricing or teacher material in the copied customer projection",()=>{
  expect(JSON.stringify(copy)).not.toMatch(/1,100|3,300|2,399|2,550|3,000|teacher-only|answer keys|sourceId|financial model/);
 });
});
