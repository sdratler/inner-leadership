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

describe("Source21 bilingual parent journey",()=>{
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
  const ids=["about","who-its-for","self-governance","how-it-works","stages","pricing","questions","parent-reflections","founder"];
  const positions=ids.map(id=>html.indexOf(`id="${id}"`));expect(positions.every(n=>n>=0)).toBe(true);expect(positions).toEqual([...positions].sort((a,b)=>a-b));
  expect(html).not.toContain('<section id="how-it-works"');expect(html).toContain('<div id="how-it-works"');expect(html).not.toContain('class="disclosure"');
  expect(html).toContain(locale==="he"?"בכל שלב 12 מפגשים":"Each stage has 12 sessions");expect(html.match(/<blockquote/g)).toHaveLength(1);expect(html).toContain('<blockquote lang="en" dir="ltr">');
  expect(html).toContain('id="academy-travel-faq"');expect(html).toContain(locale==="he"?"תוכנית של Bnei Neviim Academy":"A program of Bnei Neviim Academy");
 });
 it.each(["foundation","independent","advanced","leadership"])("%s shows age controls before artwork and specific skills without essay bands",slug=>{
  for(const locale of ["en","he"] as const){const html=renderToStaticMarkup(createElement(AcademyStage,{locale,slug}));
   expect(html.indexOf('role="tablist"')).toBeLessThan(html.indexOf('data-academy-scene='));expect(html.match(/role="tab"/g)).toHaveLength(3);
   for(const age of ["8–10","11–13","14–17"])expect(html).toContain(age);
   for(const heading of locale==="he"?["מיומנויות דיג","קבלת החלטות ועבודת צוות","התקדמות לאורך המפגשים","מקומות דיג אפשריים"]:["Fishing skills","Decisions &amp; teamwork","Session progression","Possible locations"])expect(html).toContain(heading);
   const stage=bilingual.stages.find(item=>item.slug===slug)!;
   for(const copy of [stage.water[locale],stage.practice[locale]])expect(html).toContain(renderPhaseRaw(createElement('p',null,copy)));
   expect(html).not.toContain(locale==='he'?'נושאי הלמידה':'Curriculum topics');
   expect(html).not.toMatch(/Inside this stage|Thinking it through|Depth that grows/);expect(html).toContain(`href="/${locale}/florida/apply"`);
  }
 });
 it.each(["en","he"] as const)("%s stage registration actions follow verified campaign phase without inventing availability",locale=>{
  const regular=campaignSnapshotSchema.parse({...explicitPre,phase:'REGULAR_REGISTRATION',revision:2,occupied:30,remaining:0,firstFilledAt:'2026-10-23T14:00:00.000Z'});
  for(const initial of [explicitPre,regular,null])for(const slug of ['foundation','independent','advanced','leadership']){
   const html=renderPhaseRaw(createElement(AcademyCampaignProvider,{initial},createElement(AcademyStage,{locale,slug})));
   const labels=[...html.matchAll(/<a[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/g)].filter(match=>match[1]===`/${locale}/florida/apply`).map(match=>match[2]);
   const expected=initial?.phase==='PRE_REGISTRATION'?(locale==='he'?'הרשמה מוקדמת בחינם':'Pre-register for free'):(locale==='he'?'הרשמה':'Register');
   expect(labels.length).toBeGreaterThanOrEqual(3);expect(labels.every(label=>label===expected)).toBe(true);
   if(initial?.phase!=='PRE_REGISTRATION')expect(html).not.toContain(locale==='he'?'הרשמה מוקדמת בחינם':'Pre-register for free');
   expect(html).toContain(locale==='he'?'למחירי השלבים':'See stage prices');
  }
 });
 it.each(["en","he"] as const)("%s full-capacity FAQ keeps ordinary registration open without promising a founder rate",locale=>{
  const html=renderToStaticMarkup(createElement(AcademyWebsite,{locale,onLocaleChange:()=>{}}));
  const expected=locale==='he'?'אם כל ההקצאות לתעריף המייסדים תפוסות, ההרשמה הרגילה נשארת פתוחה ללא שמירת תעריף מייסדים.':'If all founding-family rate reservations are occupied, regular registration remains open without a founding-family rate reservation.';
  expect(html).toContain(expected);expect(html).not.toContain(locale==='he'?'ההרשמה מצטרפת לרשימת המתעניינים':'your registration joins the interest list');
  expect(html).toContain(locale==='he'?'ביטול הרשמה שלא שולמה אינו כרוך בתשלום.':'Cancelling an unpaid registration has no fee.');
 });
 it.each(["en","he"] as const)("%s registration uses exact grades, integer drive and one free-registration action",locale=>{
  const html=renderToStaticMarkup(createElement(AcademyIntakePage,{locale}));
  for(const name of ["postalCode","schoolHoursAvailability","driveMinutes","permission","preferredGroupLanguage"])expect(html).toContain('name="'+name+'"');
  for(let grade=3;grade<=12;grade++)expect(html).toContain('value="'+grade+'"');
  expect(html).toContain('min="5" max="120" step="1"');expect(html.match(/name="postalCode"/g)).toHaveLength(1);expect(html.match(/<form\b/g)).toHaveLength(1);
  for(const removed of ['name="paymentPlan"','name="nextStep"','name="parentDropoff"','name="preferredAreas"','learnerTackleBox','learnerGear','grade_3_5'])expect(html).not.toContain(removed);
  expect(html).toContain(locale==='he'?'הרשמה מוקדמת בחינם':'Pre-register for free');expect(html).not.toContain(locale==='he'?'תשלום ואישור מקום':'Pay &amp; Confirm My Spot');expect(html).not.toContain('data-academy-saved=');
 });
 it.each(["en","he"] as const)("%s metadata keeps the current verified origin and matching alternate child paths",locale=>{
  for(const path of ["","/apply","/pricing","/stages/foundation","/stages/leadership"]){const meta=academyMetadata(locale,path);expect(meta.alternates.canonical).toBe(`https://life-skills.bneineviimacademy.org/${locale}/florida${path}`);for(const lang of ["en","he"] as const)expect(meta.alternates.languages[lang].endsWith(`/${lang}/florida${path}`)).toBe(true);expect(meta.openGraph.url).toBe(meta.alternates.canonical);}
 });
});

const explicitPre=campaignSnapshotSchema.parse({version:ACADEMY_CAMPAIGN,phase:'PRE_REGISTRATION',revision:1,capacity:30,occupied:1,remaining:29,firstFilledAt:null,asOf:'2026-10-23T14:00:00.000Z',reopeningPolicy:'PROPOSED_STICKY_REGULAR_PENDING_OWNER_CONFIRMATION'});
function renderToStaticMarkup(node:ReactNode){return renderPhaseRaw(createElement(AcademyCampaignProvider,{initial:explicitPre},node));}
