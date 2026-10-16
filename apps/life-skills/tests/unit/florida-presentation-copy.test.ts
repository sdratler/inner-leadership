import {describe,it,expect} from "vitest";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {readFile} from "node:fs/promises";
import {GroupApplicationLanding} from "../../src/features/group-application/landing.tsx";
import {GroupApplicationForm} from "../../src/features/group-application/application-form.tsx";
import {floridaGroupApplicationNotice,floridaSchoolInquiryNotice} from "../../src/features/group-application/contract.ts";
import copy from "../../src/features/group-application/presentation-copy.json";

const markup=(locale:"en"|"he",programId:"sunday_fishing_academy"|"private_fishing_life_skills",mode:"native"|"sample")=>renderToStaticMarkup(createElement(GroupApplicationLanding,{locale,programId,mode}));
const escaped=(text:string)=>renderToStaticMarkup(createElement("span",null,text)).slice(6,-7);
describe("reviewed Florida presentation, not new runtime authority",()=>{
 it("renders the single approved alumni correction in both languages without changing historical funnels",()=>{
  expect(copy.realMensch.academy.faqs).toHaveLength(9);
  const faq=copy.realMensch.academy.faqs[6]!;
  for(const locale of ["en","he"] as const){
   const html=markup(locale,"sunday_fishing_academy","native");
   expect(html).toContain(escaped(faq[0]![locale]));expect(html).toContain(escaped(faq[1]![locale]));
   expect(markup(locale,"private_fishing_life_skills","native")).not.toContain(escaped(faq[0]![locale]));
  }
  expect(faq[1]!.en).toContain("without having to help or enroll in Advanced");
  expect(faq[1]!.en).toContain("already scheduled beginner class free of tuition");
  expect(faq[1]!.en).toContain("distinct from the Advanced skills stage");
  expect(JSON.stringify(faq)).not.toMatch(/\$|2,350|2,399|100|guaranteed|reimburse/i);
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
   expect(html).toContain(`<h1>${copy.realMensch.academy.title[locale]}</h1>`);
   expect(html.match(/viewBox="0 0 24 24"/g)).toHaveLength(3);
   expect(html.match(new RegExp(`href="#apply"[^>]*>${copy.realMensch.shared.ctaAcademy[locale]}`,"g"))).toHaveLength(3);
   // The existing accepted overview is now on demand (JLFA-WEB-SIMPLE-02),
   // not rendered as the entire curriculum on the initial page.
   for(const card of copy.realMensch.academy.cards)expect(html).not.toContain(escaped(card.body[locale]));
   expect(html).toContain('aria-controls="jlfa-curriculum"');
   expect(html).not.toContain(copy.shared.previewBanner[locale]);
   expect(html).toContain(`dir="${locale==="he"?"rtl":"ltr"}"`);
   expect(html).not.toContain(mode==="sample"?"program=morning_torah_learning":"torah-mornings");
   expect(html).not.toContain(mode==="sample"?"program=private_fishing_life_skills":"private-fishing");
   expect(html).not.toMatch(/Pre-register|This page does not create|No invented launch details|\$1,100|\$2,399|\$3,000/);
   expect(html.match(/name="contact"/g)).toHaveLength(2); // one guardian and one separate collapsed school inquiry
   expect(html).toContain(escaped(floridaGroupApplicationNotice[locale]));expect(html).toContain(escaped(floridaSchoolInquiryNotice[locale]));
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
  expect(source).toContain("disabled={busy||uncertain}");expect(source).toContain("previouslyUncertain");
 });
 it("does not bundle private pricing or teacher material in the copied customer projection",()=>{
  expect(JSON.stringify(copy)).not.toMatch(/1,100|3,300|2,399|2,550|3,000|teacher-only|answer keys|sourceId|financial model/);
 });
});
