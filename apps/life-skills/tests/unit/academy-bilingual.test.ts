import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {describe,it,expect,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {AcademyWebsite} from "../../src/features/group-application/academy-website.tsx";
import {AcademyStage} from "../../src/features/group-application/academy-stage.tsx";
import {AcademyIntakePage} from "../../src/features/group-application/academy-intake-page.tsx";
import {academyMetadata} from "../../src/features/group-application/academy-metadata.ts";
import {AcademyPublicRoute} from "../../src/features/group-application/academy-route-context.tsx";
import {academyPath} from "../../src/features/group-application/academy-routing.ts";

describe("Source21 bilingual parent journey",()=>{
 it.each(["en","he"] as const)("%s BNA gateway presentation keeps all page links and alternates on the requested host",locale=>{
  const html=renderToStaticMarkup(createElement(AcademyPublicRoute,{mode:"bna"},createElement(AcademyWebsite,{locale,onLocaleChange:()=>{}})));
  const home=locale==="he"?"/he/fishing-academy":"/fishing-academy";
  expect(html).toContain(`href="${home}/apply"`);for(const stage of ["foundation","independent","advanced","leadership"])expect(html).toContain(`href="${home}/stages/${stage}"`);
  expect(html).not.toContain(`href="/${locale}/florida`);
  const meta=academyMetadata(locale,"/apply",undefined,"bna");expect(meta.alternates.canonical).toBe("https://bneineviimacademy.org"+home+"/apply");
  expect(meta.alternates.languages.en).toBe("https://bneineviimacademy.org/fishing-academy/apply");expect(meta.alternates.languages.he).toBe("https://bneineviimacademy.org/he/fishing-academy/apply");
  for(const bad of ["/private","/../app","//evil.invalid","/apply?secret=1","/api/identity/session"])expect(()=>academyPath(locale,bad,"bna")).toThrow("ACADEMY_PATH_UNAVAILABLE");
 });
 it.each(["en","he"] as const)("%s keeps the short homepage sequence and legacy anchors without duplicate marketing walls",locale=>{
  const html=renderToStaticMarkup(createElement(AcademyWebsite,{locale,onLocaleChange:()=>{}}));
  const ids=["about","who-its-for","stages","self-governance","pricing","questions","parent-reflections","founder"];
  const positions=ids.map(id=>html.indexOf(`id="${id}"`));expect(positions.every(n=>n>=0)).toBe(true);expect(positions).toEqual([...positions].sort((a,b)=>a-b));
  expect(html).not.toContain('<section id="how-it-works"');expect(html).toContain('<span id="how-it-works"');expect(html).not.toContain('class="disclosure"');
  expect(html).toContain(locale==="he"?"שלושת המפגשים הראשונים":"The first three Foundation meetings");expect(html.match(/<blockquote/g)).toHaveLength(1);expect(html).toContain('<blockquote lang="en" dir="ltr">');
  expect(html).toContain('id="academy-travel-faq"');expect(html).toContain(locale==="he"?"תוכנית של Bnei Neviim Academy":"A program of Bnei Neviim Academy");
 });
 it.each(["foundation","independent","advanced","leadership"])("%s shows age controls before artwork and specific skills without essay bands",slug=>{
  for(const locale of ["en","he"] as const){const html=renderToStaticMarkup(createElement(AcademyStage,{locale,slug}));
   expect(html.indexOf('role="tablist"')).toBeLessThan(html.indexOf('data-academy-scene='));expect(html.match(/role="tab"/g)).toHaveLength(3);
   for(const age of ["8–10","11–13","14–17"])expect(html).toContain(age);
   for(const heading of locale==="he"?["מיומנויות דיג","קבלת החלטות ועבודת צוות","התקדמות לאורך המפגשים","מקומות דיג אפשריים"]:["Fishing skills","Decisions &amp; teamwork","Session progression","Possible locations"])expect(html).toContain(heading);
   expect(html).not.toMatch(/Inside this stage|Thinking it through|Depth that grows/);expect(html).toContain(`href="/${locale}/florida/apply"`);
  }
 });
 it.each(["en","he"] as const)("%s complete form preserves numeric drive, school acknowledgment choices and two saved-inquiry intents",locale=>{
  const html=renderToStaticMarkup(createElement(AcademyIntakePage,{locale}));
  for(const name of ["learnerCount","learnerAge-0","learnerGrade-0","learnerSchooling-0","learnerTackleBox-0","schoolHoursAvailability","driveLimit","permission","nextStep"])expect(html).toContain(`name="${name}"`);
  for(let minutes=5;minutes<=120;minutes+=5)expect(html).toContain(`value="${minutes}"`);
  expect(html).toContain('value="permission_needed"');expect(html).toContain('value="enrollment_followup"');expect(html).toContain('value="callback"');expect(html.match(/<form\b/g)).toHaveLength(1);
  expect(html).toContain(locale==="he"?"שליחת הפרטים":"Submit my information");expect(html).not.toContain('data-academy-saved=');
 });
 it.each(["en","he"] as const)("%s metadata keeps the current verified origin and matching alternate child paths",locale=>{
  for(const path of ["","/apply","/pricing","/stages/foundation","/stages/leadership"]){const meta=academyMetadata(locale,path);expect(meta.alternates.canonical).toBe(`https://life-skills.bneineviimacademy.org/${locale}/florida${path}`);for(const lang of ["en","he"] as const)expect(meta.alternates.languages[lang].endsWith(`/${lang}/florida${path}`)).toBe(true);expect(meta.openGraph.url).toBe(meta.alternates.canonical);}
 });
});
