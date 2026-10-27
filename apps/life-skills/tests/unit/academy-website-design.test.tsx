import {academyExactCopy,academyExactCurriculum} from '../../src/features/group-application/academy-exact-copy.ts';
import type {ReactNode} from 'react';
import {AcademyCampaignProvider} from '../../src/features/group-application/academy-campaign-state.ts';
import {campaignSnapshotSchema,ACADEMY_CAMPAIGN} from '../../src/features/group-application/academy-campaign-contract.ts';
import {createElement,type ComponentType} from "react";
import {renderToStaticMarkup as renderPhaseRaw} from "react-dom/server";
import {readFileSync,existsSync} from "node:fs";
import {createHash} from "node:crypto";
import {describe,it,expect,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {GroupApplicationLanding} from "../../src/features/group-application/landing.tsx";
import {AcademyIntakePage} from "../../src/features/group-application/academy-intake-page.tsx";
import {AcademyStage} from "../../src/features/group-application/academy-stage.tsx";
import {academyStages} from "../../src/features/group-application/academy-public-program.ts";
import {academyContactOverlaps} from "../../src/features/group-application/academy-whatsapp.tsx";
import {ACADEMY_WHATSAPP} from "../../src/features/group-application/academy-site-frame.tsx";
import assets from "../../src/features/group-application/academy-hero-assets.json";
function html<Props extends object>(component:ComponentType<Props>,props:Props){return renderToStaticMarkup(createElement(component,props));}
const sha=(bytes:Uint8Array)=>createHash("sha256").update(bytes).digest("hex");

describe("the actual owner-selected Academy visual and inquiry design",()=>{
 it.each(["en","he"] as const)("renders%s live hero copy, real price/form links and four separate stage views",locale=>{
  const page=html(GroupApplicationLanding,{locale});
  expect(page).toContain('data-academy-site="true"');expect(page).toContain(`lang="${locale}"`);expect(page).toContain(`dir="${locale==="he"?"rtl":"ltr"}"`);
  expect(page.match(/<h1\b/g)).toHaveLength(1);if(locale==="en"){expect(page).toContain("South Florida");expect(page).toContain("South Florida Jewish Leadership Fishing Academy");expect(page).not.toContain("A part-time enrichment program for boys");expect(page).toContain("Self-Governance");}else{expect(page).toContain(academyExactCopy.he.hero.accessibleName);expect(page).not.toContain("תוכנית העשרה במשרה חלקית לבנים");}
  expect(page).toContain('<picture>');expect(page).toContain('media="(min-width:768px)"');expect(page).toContain('srcSet="/groups/academy/hero-desktop-20261018.png"');expect(page).toContain('src="/groups/academy/hero-mobile-20261018.png"');
  expect(page).toContain(`href="/${locale}/florida/apply" data-jlfa-primary="true"`);expect(page).toContain('id="pricing"');expect(page).toContain(`href="/${locale}/florida/apply"`);
  for(const stage of academyStages)expect(page).toContain(`href="/${locale}/florida/stages/${stage.slug}"`);
  expect(page.match(/data-academy-stage-card=/g)).toHaveLength(4);expect(page.match(/data-price-kind=/g)).toHaveLength(3);
  expect(page.match(/<details name="academy-faq"/g)).toHaveLength(academyExactCopy[locale].home.faq.length);
  expect(page).not.toMatch(/<details[^>]*name="academy-faq"[^>]*open=/);
  for(const id of["about","who-its-for","how-it-works","stages","self-governance","questions","founder"])expect(page).toContain(`id="${id}"`);
  expect(page).toContain('data-jlfa-header-logo="true"');expect(page).toContain('data-jlfa-footer-logo="true"');expect(page).toContain('/groups/people/founder-grass-group.webp');
  for(const value of['name="parentName"','name="postalCode"','role="timer"','data-counter','Save $800','HERO ARTWORK IN PROGRESS','text-layout-reference.png'])expect(page).not.toContain(value);
  expect(page).not.toContain('data-academy-whatsapp'); // Body portal mounts after hydration; browser checks verify destination/visibility.
 });
 it.each(["en","he"] as const)("keeps the%s complete form mounted with in-place language controls and same-document price actions",locale=>{
  const page=html(AcademyIntakePage,{locale});expect(page).toContain('data-academy-registration="true"');expect(page).toContain('name="parentName"');expect(page).toContain('name="postalCode"');expect(page).toContain('name="learnerId"');
  expect(page).toContain('id="academy-form"');expect(page).toContain('id="registration-driveMinutes"');expect(page).toContain('href="/'+locale+'/florida#academy-travel-faq"');expect(page).toContain('href="#academy-form"');expect(page).toContain('id="apply"');
  expect(page).toContain('aria-pressed="true"');expect(page).toContain('data-jlfa-header-logo="true"');expect(page).toContain('data-jlfa-footer-logo="true"');expect(page.match(/<form\b/g)).toHaveLength(1);
  expect(page).not.toContain('data-academy-whatsapp');expect(page).not.toContain('href="https://checkout.');
 });
 it.each(["en","he"] as const)("retains the%s sample's inert form and existing overview instead of mounting native stage links",locale=>{
  const page=html(GroupApplicationLanding,{locale,mode:"sample"});expect(page).toContain('name="parentName"');expect(page).toContain('aria-controls="jlfa-curriculum"');expect(page).not.toContain('data-academy-site');expect(page).not.toContain(`href="/${locale}/florida/apply"`);
 });
 for(const stage of academyStages)it.each(["en","he"] as const)(`${stage.slug}:%s has its own accessible age-depth view and the same header/footer`,locale=>{
  const page=html(AcademyStage,{locale,slug:stage.slug});expect(page).toContain(`data-academy-stage-view="${stage.slug}"`);expect(page.match(/<h1\b/g)).toHaveLength(1);expect(page.match(/data-age-choice=/g)).toHaveLength(3);expect(page.match(/data-age-panel=/g)).toHaveLength(3);expect(page.match(/checked=""/g)).toHaveLength(1);expect(page).not.toMatch(/data-age-panel[^>]*hidden=/);
  expect(page).toContain('data-jlfa-header-logo="true"');expect(page).toContain('data-jlfa-footer-logo="true"');expect(page).toContain(`href="/${locale}/florida/apply"`);expect(page).toContain(academyExactCurriculum.stages.find(item=>item.slug===stage.slug)!.title[locale]);
  for(const text of["source_approvals","profile_ciphertext","answerKey","paymentIntent","paid first mates"])expect(page).not.toContain(text);
 });
 it("renders all owner-supplied lesson summaries without inventing dates or public instructor identifiers",()=>{
  expect(academyExactCurriculum.stages.flatMap(stage=>stage.lessons)).toHaveLength(48);
  for(const stage of academyExactCurriculum.stages){const page=html(AcademyStage,{locale:'en',slug:stage.slug});
   for(const lesson of stage.lessons)expect(page).toContain(renderPhaseRaw(createElement('p',null,lesson.description.en)));
   expect(page).toContain(academyExactCurriculum.common.en.logisticsNote);expect(page).not.toMatch(/RM-\d{3}|Week 1<\/strong>|<details/);
  }
  expect(academyExactCurriculum.stages[0]!.lessons.slice(0,4).map(item=>item.rmId)).toEqual(['RM-101','RM-103','RM-102','RM-104']);
  expect(html(AcademyStage,{locale:"en",slug:"arbitrary"})).toBe("");
 });
 it("binds exactly two production PNGs to the selected bytes, dimensions and art direction",()=>{
  expect(assets.assets).toHaveLength(2);for(const asset of assets.assets){const bytes=readFileSync(new URL("../../public"+asset.publicPath,import.meta.url));expect(bytes.length).toBe(asset.bytes);expect(sha(bytes)).toBe(asset.sha256);expect(bytes.subarray(0,8).toString("hex")).toBe("89504e470d0a1a0a");expect(bytes.readUInt32BE(16)).toBe(asset.width);expect(bytes.readUInt32BE(20)).toBe(asset.height);expect(asset.role==="desktop"?asset.width>asset.height:asset.height>asset.width).toBe(true);}
  expect(existsSync(new URL("../../public/groups/academy/text-layout-reference.png",import.meta.url))).toBe(false);
  expect(sha(readFileSync(new URL("../../public/groups/brand/jlfa-logo-locked-v1.png",import.meta.url)))).toBe("e78ff6d3ef16c37613725507ce14da05883734a77f48b78ab9d6df3f92480356");
  expect(sha(readFileSync(new URL("../../public/groups/people/founder-grass-group.webp",import.meta.url)))).toBe("ba81073d35db946e67b01c95daf5e0d754f7fa47b200f9a621bc98b69649ac84");
 });
 it("treats text/control intersection as overlap while allowing an adjacent blank corner",()=>{
  const bubble={left:320,right:376,top:770,bottom:826};expect(academyContactOverlaps(bubble,{left:20,right:360,top:750,bottom:795})).toBe(true);expect(academyContactOverlaps(bubble,{left:20,right:320,top:750,bottom:795})).toBe(false);expect(academyContactOverlaps(bubble,{left:20,right:380,top:600,bottom:770})).toBe(false);expect(academyContactOverlaps(bubble,{left:320,right:376,top:826,bottom:870})).toBe(false);
  const url=new URL(ACADEMY_WHATSAPP);expect(url.origin).toBe("https://wa.me");expect(url.pathname).toBe("/972534932631");expect(url.searchParams.get("text")).toBe("Hi, I came from your website. I'd like to know more.");
 });
});

import {AcademyWebsite} from "../../src/features/group-application/academy-website.tsx";
import scenes from "../../src/features/group-application/academy-scenes.json";
import {groupApplicationPublicAsset,groupApplicationReleasePath} from "../../src/proxy.ts";
const visualGateEnv={NODE_ENV:"production",LS_APP_ORIGIN:"https://academy.invalid",LS_GROUP_APPLICATION_REAL_DATA_RELEASE:"true",LS_IDENTITY_ENABLED:"true",LS_IDENTITY_WORKSPACE_ID:"11111111-1111-4111-8111-111111111111",LS_IDENTITY_ACTIVE_KEY_ID:"v1",LS_IDENTITY_DATA_KEYS:JSON.stringify({v1:Buffer.alloc(32,1).toString("base64url")}),LS_IDENTITY_CSRF_KEY:Buffer.alloc(32,2).toString("base64url"),LS_IDENTITY_LOOKUP_KEY:Buffer.alloc(32,3).toString("base64url"),LS_IDENTITY_RATE_KEY:Buffer.alloc(32,4).toString("base64url")};
describe("latest owner14/15 visual successor, static contracts",()=>{
 it.each(["en","he"] as const)("%s final homepage follows the owner’s complete hierarchy",locale=>{
  const html=renderToStaticMarkup(createElement(AcademyWebsite,{locale,onLocaleChange:()=>{}}));
  const ids=["about","who-its-for","self-governance","how-it-works","stages","pricing","questions","parent-reflections","founder"];
  const positions=ids.map(id=>html.indexOf('id="'+id+'"'));expect(positions.every(index=>index>0)).toBe(true);expect(positions).toEqual([...positions].sort((a,b)=>a-b));
  expect(html).not.toContain('<section id="locations"');expect(html).not.toContain('id="fishing-skills"');expect(html.match(/data-price-group=/g)).toHaveLength(1);
  expect(html).toContain('data-price-group="actual"');for(const kind of ['founding-primary','founding-sibling','monthly-block'])expect(html).toContain('data-price-kind="'+kind+'"');
 });
 it.each(["en","he"] as const)("%s top header precedes full-width hero with one real pricing CTA and no bottom bar",locale=>{
  const html=renderToStaticMarkup(createElement(AcademyWebsite,{locale,onLocaleChange:()=>{}}));
  expect(html.indexOf("data-academy-header=")).toBeLessThan(html.indexOf("data-academy-hero="));expect(html.match(/data-jlfa-primary/g)).toHaveLength(1);expect(html).toContain(locale==="en"?"Pre-register for free":"הרשמה מוקדמת בחינם");expect(html).not.toContain("data-academy-bottom-bar");
  expect(html.indexOf('id="questions"')).toBeLessThan(html.indexOf('id="parent-reflections"'));expect(html.indexOf('id="parent-reflections"')).toBeLessThan(html.indexOf('id="founder"'));expect(html.indexOf('id="founder"')).toBeLessThan(html.indexOf("data-academy-footer="));
  expect(html).toContain('data-academy-testimonial-state="historical-reflection"');expect(html.match(/<blockquote\b/g)).toHaveLength(1);expect(html).toContain('<blockquote lang="en" dir="ltr"><p>“Medication is no longer relevant.”</p></blockquote>');expect(html).toContain("L. Bars");const testimonial=html.slice(html.indexOf('id="parent-reflections"'),html.indexOf('id="founder"'));expect(testimonial).toContain(locale==="en"?"Mother of a student · 2024 · Beit Shemesh":"אמו של תלמיד · 2024 · בית שמש");expect(testimonial).toContain('/groups/testimonials/l-bars-2024.png');expect(testimonial).not.toMatch(/earlier educational work|עבודה חינוכית קודמת|עבודתו החינוכית הקודמת/);expect(html).not.toMatch(/Lieberman|More locations in the pool|A Florida Keys milestone/);expect(html).toContain(academyExactCopy[locale].home.founderHeading);
  expect(html).not.toContain("data-academy-whatsapp");expect(html).toContain('aria-controls="academy-mobile-menu"');expect(html).toContain('aria-expanded="false"');
 });
 it.each(["foundation","independent","advanced","leadership"])("%s retains its one stage route and real scene without changing age-depth navigation",slug=>{
  const html=renderToStaticMarkup(createElement(AcademyStage,{locale:"en",slug}));expect(html).toContain('data-academy-scene=');expect(html).toContain('<fieldset');expect(html.match(/data-age-choice=/g)).toHaveLength(3);expect(html).toContain('href="/en/florida/apply"');expect(html).not.toContain("data-academy-bottom-bar");expect(html).toContain(academyExactCurriculum.common.en.logisticsNote);
 });
 it.each(["en","he"] as const)("%s form retains one form, exact actions and school-hours responsibility",locale=>{
  const html=renderToStaticMarkup(createElement(AcademyIntakePage,{locale}));expect(html.match(/<form\b/g)).toHaveLength(1);expect(html).not.toMatch(/<select[^>]*name="schoolHoursAvailability"/);const schoolHours=[...html.matchAll(/<input[^>]*name="schoolHoursAvailability"[^>]*>/g)];expect(schoolHours).toHaveLength(4);expect(schoolHours.every(match=>match[0].includes('required=""'))).toBe(true);for(const value of["flexible","permission_needed","outside_school_only","discuss"])expect(html).toContain(`value="${value}"`);expect(html).not.toContain('name="nextStep"');expect(html).toContain('max="120"');expect(html).toContain('data-academy-registration="true"');expect(html).not.toContain("data-academy-bottom-bar");
 });
 it("serves exactly the installed named scene derivatives under the unchanged GET/HEAD/environment/identity fence",()=>{
  expect(scenes.assets).toHaveLength(11);for(const image of scenes.assets){const bytes=readFileSync(new URL("../../public"+image.publicPath,import.meta.url));expect(bytes.length).toBe(image.bytes);expect(createHash("sha256").update(bytes).digest("hex")).toBe(image.sha256);for(const method of["GET","HEAD"])expect(groupApplicationPublicAsset(image.publicPath,method,visualGateEnv)).toBe(true);expect(groupApplicationPublicAsset(image.publicPath,"POST",visualGateEnv)).toBe(false);expect(groupApplicationPublicAsset(image.publicPath,"GET",{...visualGateEnv,LS_IDENTITY_ENABLED:"false"})).toBe(false);expect(groupApplicationPublicAsset(image.publicPath,"GET",{...visualGateEnv,LS_GROUP_APPLICATION_REAL_DATA_RELEASE:"false"})).toBe(false);}
  for(const path of["/groups/academy/scenes/private.webp","/groups/academy/scenes/../secret.webp","/groups/academy/scenes/foundation.png","/groups/academy/scenes/source.csv"])expect(groupApplicationPublicAsset(path,"GET",visualGateEnv)).toBe(false);
 });
});

import {AcademyOutingPrices} from "../../src/features/group-application/academy-outing-prices.tsx";
describe("owner1181 visual and outing corrections",()=>{
 it.each(["en","he"] as const)("%s keeps core inquiry links and separates the outing presentation",locale=>{
  const html=renderToStaticMarkup(createElement(AcademyWebsite,{locale,onLocaleChange:()=>{}}));
  expect(html).not.toContain('id="outings"');expect(html).not.toMatch(/A progression, one stage at a time|The person behind the program|Shared Keys days|Illustrative scene\./);
  expect(html).not.toContain('id="fishing-skills"');expect(html).toContain('id="how-it-works"');expect(html).toContain(academyExactCopy[locale].home.aboutHeading);
  expect(html.match(/data-academy-scene="foundation"/g)).toHaveLength(1);expect(html).toContain('data-hidden="false"');expect(html).not.toContain('data-academy-bottom-bar');
  const outings=renderToStaticMarkup(createElement(AcademyOutingPrices,{locale}));expect(outings.match(/data-academy-outing=/g)).toHaveLength(2);
  const copy=academyExactCopy[locale].pricing.outings;
  for(const text of [copy.keysTitle,copy.keysBody,copy.offshoreTitle,copy.offshoreBody,copy.faqLink])expect(outings).toContain(renderPhaseRaw(createElement('span',null,text)).slice(6,-7));
  expect(outings).not.toMatch(/\$[0-9]|<details/);expect(outings).toContain('href="/'+locale+'/florida#keys-trip-faq"');

 });
 it("adds only the exact pricing page to the existing public environment gate",()=>{
  for(const locale of ["en","he"]){expect(groupApplicationReleasePath(`/${locale}/florida/pricing`,visualGateEnv)).toBe(true);expect(groupApplicationReleasePath(`/${locale}/florida/pricing/private`,visualGateEnv)).toBe(false);expect(groupApplicationReleasePath(`/${locale}/florida/pricing`,{...visualGateEnv,LS_IDENTITY_ENABLED:"false"})).toBe(false);}
 });
});

const explicitPre=campaignSnapshotSchema.parse({version:ACADEMY_CAMPAIGN,phase:'PRE_REGISTRATION',revision:1,capacity:30,occupied:1,remaining:29,firstFilledAt:null,asOf:'2026-10-23T14:00:00.000Z',reopeningPolicy:'PROPOSED_STICKY_REGULAR_PENDING_OWNER_CONFIRMATION'});
function renderToStaticMarkup(node:ReactNode){return renderPhaseRaw(createElement(AcademyCampaignProvider,{initial:explicitPre},node));}
