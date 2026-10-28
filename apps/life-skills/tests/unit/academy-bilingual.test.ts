import {academyExactCopy,academyExactCurriculum} from '../../src/features/group-application/academy-exact-copy.ts';
import bilingual from '../../src/features/group-application/academy-bilingual-copy.json';
import type {ReactNode} from 'react';
import {AcademyCampaignProvider} from '../../src/features/group-application/academy-campaign-state.ts';
import {campaignSnapshotSchema,ACADEMY_CAMPAIGN} from '../../src/features/group-application/academy-campaign-contract.ts';
import {createElement} from "react";
import {renderToStaticMarkup as renderPhaseRaw} from "react-dom/server";
import {describe,it,expect,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {AcademyWebsite} from "../../src/features/group-application/academy-website.tsx";
import {AcademyStage} from "../../src/features/group-application/academy-stage.tsx";
import {AcademyIntakePage} from "../../src/features/group-application/academy-intake-page.tsx";
import {academyMetadata} from "../../src/features/group-application/academy-metadata.ts";
import {AcademyPublicRoute} from "../../src/features/group-application/academy-route-context.tsx";
import {academyPath} from "../../src/features/group-application/academy-routing.ts";

describe("Exact05 bilingual parent journey and retained stage coverage",()=>{
 it.each(["en","he"] as const)("%s mobile menu keeps the exact four navigation links and registration action while locations remain in the FAQ",locale=>{
  for(const mode of ['legacy','bna'] as const){
   const html=renderToStaticMarkup(createElement(AcademyPublicRoute,{mode},createElement(AcademyStage,{locale,slug:'advanced'})));
   const home=academyPath(locale,'',mode);
   const desktop=html.match(/<nav[^>]*aria-label="(?:Academy navigation|ניווט באקדמיה)"[^>]*>([\s\S]*?)<\/nav>/)?.[1];
   const mobile=html.match(/<nav[^>]*id="academy-mobile-menu"[^>]*>([\s\S]*?)<\/nav>/)?.[1];
   expect(desktop).toBeDefined();expect(mobile).toBeDefined();
   const hrefs=(markup:string)=>[...markup.matchAll(/<a[^>]*href="([^"]*)"/g)].map(match=>match[1]);
   expect(hrefs(desktop!)).toEqual([home,home+'#stages',home+'/pricing',home+'#questions']);
   expect(hrefs(mobile!).slice(0,5)).toEqual([home,home+'#stages',home+'/pricing',home+'#questions',home+'/apply']);expect(hrefs(mobile!).filter(href=>href===home+'#locations')).toHaveLength(0);
   expect(mobile).not.toMatch(/Where we fish|איפה דגים/);
   expect(hrefs(mobile!)).toEqual(expect.arrayContaining([home+'#questions',home+'/apply']));
   const landing=renderToStaticMarkup(createElement(AcademyPublicRoute,{mode},createElement(AcademyWebsite,{locale,onLocaleChange:()=>{}})));
   expect(landing).toMatch(/<details[^>]*id="locations"/);expect(landing).not.toMatch(/<section[^>]*id="locations"/);
  }
 });
 it.each([{locale:"en",stage:"unknown"},{locale:"fr",stage:"foundation"}])("unknown stage/locale returns the Next 404 boundary before public URL formatting: %j",async params=>{
  const {generateMetadata}=await import("../../src/app/[locale]/florida/stages/[stage]/page.tsx");
  await expect(generateMetadata({params:Promise.resolve(params)})).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
 });
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
  const ids=["about","who-its-for","self-governance","stages","founder","how-it-works","pricing","questions"];
  const positions=ids.map(id=>html.indexOf(`id="${id}"`));expect(positions.every(n=>n>=0)).toBe(true);expect(positions).toEqual([...positions].sort((a,b)=>a-b));
  expect(html).toContain('<section id="how-it-works"');expect(html).not.toContain('<div id="how-it-works"');expect(html).not.toContain('class="disclosure"');
  expect(html).toContain(academyExactCopy[locale].home.stagesIntro);expect(html).not.toMatch(/<blockquote|Medication is no longer relevant/);
  expect(html).toContain('id="academy-travel-faq"');expect(html).toContain(academyExactCopy[locale].home.footerAttribution);
 });
 it.each(["foundation","independent","advanced","leadership"])("%s provides direct stage navigation, native age choices and all twelve exact lessons",slug=>{
  for(const locale of ["en","he"] as const){const html=renderToStaticMarkup(createElement(AcademyStage,{locale,slug})),stage=academyExactCurriculum.stages.find(item=>item.slug===slug)!;
   expect(html.indexOf('data-academy-curriculum-navigation')).toBeLessThan(html.indexOf('data-academy-scene='));expect(html.match(/data-age-choice=/g)).toHaveLength(3);expect(html.match(/data-age-panel=/g)).toHaveLength(3);
   for(const age of ["8–10","11–13","14–17"])expect(html).toContain(age);
   for(const lesson of stage.lessons){expect(html).toContain(renderPhaseRaw(createElement('h3',null,lesson.title[locale])));expect(html).toContain(renderPhaseRaw(createElement('p',null,lesson.description[locale])));}
   expect(html).toContain(renderPhaseRaw(createElement('p',null,academyExactCurriculum.common[locale].logisticsNote)));
   expect(html).not.toContain('<figcaption');expect(html).not.toContain('Curriculum topics');expect(html).not.toMatch(/RM-\d{3}|data-academy-lesson-list[^>]*hidden|<details/);
   expect(html).toContain(`href="/${locale}/florida/apply"`);
  }
 });
 it.each(['en','he'] as const)('%s curriculum keeps distinct stage age support and explicit readiness limits',locale=>{
  for(const stage of academyExactCurriculum.stages){const html=renderToStaticMarkup(createElement(AcademyStage,{locale,slug:stage.slug}));
   for(const panel of Object.values(stage.agePanels))for(const text of panel[locale])expect(html).toContain(renderPhaseRaw(createElement('li',null,text)));
   expect(html).toContain(renderPhaseRaw(academyExactCurriculum.common[locale].readinessNote));expect(html.match(/data-academy-lesson-list/g)).toHaveLength(1);
  }
  expect(academyExactCurriculum.stages[0]!.lessons.slice(0,4).map(item=>item.rmId)).toEqual(['RM-101','RM-103','RM-102','RM-104']);
 });
 it.each(["en","he"] as const)("%s stage registration actions follow verified campaign phase without inventing availability",locale=>{
  const regular=campaignSnapshotSchema.parse({...explicitPre,phase:'REGULAR_REGISTRATION',revision:2,occupied:30,remaining:0,firstFilledAt:'2026-10-23T14:00:00.000Z'});
  for(const initial of [explicitPre,regular,null])for(const slug of ['foundation','independent','advanced','leadership']){
   const html=renderPhaseRaw(createElement(AcademyCampaignProvider,{initial},createElement(AcademyStage,{locale,slug})));
   const labels=[...html.matchAll(/<a[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/g)].filter(match=>match[1]===`/${locale}/florida/apply`).map(match=>match[2]);
   const expected=initial?.phase==='PRE_REGISTRATION'?academyExactCopy[locale].nav.preRegister:academyExactCopy[locale].nav.register;
   expect(labels.length).toBeGreaterThanOrEqual(3);expect(labels.every(label=>label===expected)).toBe(true);
   if(initial?.phase!=='PRE_REGISTRATION')expect(html).not.toContain(locale==='he'?'הרשמה מוקדמת בחינם':'Pre-register for free');
   expect(html).not.toContain(locale==='he'?'למחירי השלבים':'See stage prices');
  }
 });
 it.each(["en","he"] as const)("%s ordinary-phase follow-up FAQ does not invent a founder allocation",locale=>{
  const html=renderPhaseRaw(createElement(AcademyCampaignProvider,{initial:null},createElement(AcademyWebsite,{locale,onLocaleChange:()=>{}})));
  expect(html).toContain(renderPhaseRaw(createElement('p',null,academyExactCopy[locale].home.regularFollowup.answer)));
  expect(html).not.toContain(locale==='he'?'ההרשמה מצטרפת לרשימת המתעניינים':'your registration joins the interest list');
  expect(html).not.toContain(academyExactCopy[locale].hero.offer);
 });
 it.each(["en","he"] as const)("%s registration uses exact grades, integer drive and one free-registration action",locale=>{
  const html=renderToStaticMarkup(createElement(AcademyIntakePage,{locale}));
  for(const name of ["postalCode","schoolHoursAvailability","driveMinutes","permission","preferredGroupLanguage"])expect(html).toContain('name="'+name+'"');
  for(let grade=3;grade<=12;grade++)expect(html).toContain('value="'+grade+'"');
  expect(html).toContain('min="5" max="120" step="1"');expect(html.match(/name="postalCode"/g)).toHaveLength(1);expect(html.match(/<form\b/g)).toHaveLength(1);
  for(const removed of ['name="paymentPlan"','name="nextStep"','name="parentDropoff"','name="preferredAreas"','learnerTackleBox','learnerGear','grade_3_5'])expect(html).not.toContain(removed);
  expect(html).toContain(locale==='he'?'הרשמה מוקדמת בחינם':'Pre-register for free');expect(html).not.toContain(locale==='he'?'תשלום ואישור מקום':'Pay &amp; Confirm My Spot');expect(html).not.toContain('data-academy-saved=');
 });
 it.each(["en","he"] as const)("%s keeps full trip eligibility in FAQ while new applicants use the short Foundation form",locale=>{
  const form=renderToStaticMarkup(createElement(AcademyIntakePage,{locale}));
  const website=renderToStaticMarkup(createElement(AcademyWebsite,{locale,onLocaleChange:()=>{}}));
  const approved=renderPhaseRaw(createElement('p',null,academyExactCopy[locale].home.faq.find(item=>item.id==='offshore-trip-faq')!.answer));
  expect(website).toContain(approved.slice(3,-4));
  expect(form).not.toContain(approved.slice(3,-4));
  for(const html of [form,website])expect(html).not.toContain(locale==='he'?'השלב הראשון בן 12 השבועות':'first 12-week stage');
  expect(form).not.toContain('name="stageInterest"');
  expect(form).not.toContain(locale==='he'?'השלב שמעניין אתכם':'Stage Interest');
  expect(form).toContain('data-academy-program-terms');
  expect(form).toContain(academyExactCopy[locale].form.equipmentLine);

 });
 it.each(["en","he"] as const)("%s metadata keeps the current verified origin and matching alternate child paths",locale=>{
  for(const path of ["","/apply","/pricing","/stages/foundation","/stages/leadership"]){const meta=academyMetadata(locale,path);expect(meta.alternates.canonical).toBe(`https://life-skills.bneineviimacademy.org/${locale}/florida${path}`);for(const lang of ["en","he"] as const)expect(meta.alternates.languages[lang].endsWith(`/${lang}/florida${path}`)).toBe(true);expect(meta.openGraph.url).toBe(meta.alternates.canonical);}
 });
});

const explicitPre=campaignSnapshotSchema.parse({version:ACADEMY_CAMPAIGN,phase:'PRE_REGISTRATION',revision:1,capacity:30,occupied:1,remaining:29,firstFilledAt:null,asOf:'2026-10-23T14:00:00.000Z',reopeningPolicy:'PROPOSED_STICKY_REGULAR_PENDING_OWNER_CONFIRMATION'});
function renderToStaticMarkup(node:ReactNode){return renderPhaseRaw(createElement(AcademyCampaignProvider,{initial:explicitPre},node));}

it.each(['en','he'] as const)('%s Exact05 uses the supplied introduction and explicit safety FAQ without promising outcomes',locale=>{
 const html=renderToStaticMarkup(createElement(AcademyWebsite,{locale,onLocaleChange:()=>{}}));
 expect(html).toContain(academyExactCopy[locale].home.aboutLead);expect(html).toContain(academyExactCopy[locale].home.aboutSupporting);
 expect(html).toContain(renderPhaseRaw(createElement('p',null,academyExactCopy[locale].home.faq.find(item=>item.id==='safety')!.answer)));
 expect(html).not.toContain(bilingual.gainIntro[locale]);
});

it.each(['en','he'] as const)('%s every intake registration link stays in the same document and preserves the unsent form',locale=>{
 for(const mode of ['legacy','bna'] as const)for(const campaign of [explicitPre,null]){
  const html=renderToStaticMarkup(createElement(AcademyPublicRoute,{mode,campaign},createElement(AcademyIntakePage,{locale})));
  const label=campaign?academyExactCopy[locale].nav.preRegister:academyExactCopy[locale].nav.register;
  const links=[...html.matchAll(/<a[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/g)].filter(match=>match[2]===label);
  expect(links.length).toBeGreaterThanOrEqual(4);expect(links.every(match=>match[1]==='#academy-form')).toBe(true);expect(html).toContain('id="academy-form"');
 }
});

it.each(['en','he'] as const)('%s exact homepage distinguishes all four parent steps from all four stages',locale=>{
 const html=renderToStaticMarkup(createElement(AcademyWebsite,{locale,onLocaleChange:()=>{}})),copy=academyExactCopy[locale].home;
 for(const item of [...copy.gains,...copy.journey,...copy.stageCards])for(const text of [item.title,item.body])expect(html).toContain(renderPhaseRaw(createElement('span',null,text)).slice(6,-7));
 expect(copy.gains).toHaveLength(6);expect(copy.journey).toHaveLength(4);expect(copy.stageCards).toHaveLength(4);
 for(const faq of copy.faq){expect(html).toContain(renderPhaseRaw(createElement('summary',null,faq.question)));expect(html).toContain(renderPhaseRaw(createElement('p',null,faq.answer)));}
 expect(copy.faq).toHaveLength(15);
});
