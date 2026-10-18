import {createElement,type ComponentType} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {readFileSync,existsSync} from "node:fs";
import {createHash} from "node:crypto";
import {describe,it,expect,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {GroupApplicationLanding} from "../../src/features/group-application/landing.tsx";
import {AcademyIntakePage} from "../../src/features/group-application/academy-intake-page.tsx";
import {AcademyStage} from "../../src/features/group-application/academy-stage.tsx";
import {academyStages,academyFoundationProgression} from "../../src/features/group-application/academy-public-program.ts";
import {academyContactOverlaps} from "../../src/features/group-application/academy-whatsapp.tsx";
import {ACADEMY_WHATSAPP} from "../../src/features/group-application/academy-site-frame.tsx";
import assets from "../../src/features/group-application/academy-hero-assets.json";
function html<Props extends object>(component:ComponentType<Props>,props:Props){return renderToStaticMarkup(createElement(component,props));}
const sha=(bytes:Uint8Array)=>createHash("sha256").update(bytes).digest("hex");

describe("the actual owner-selected Academy visual and inquiry design",()=>{
 it.each(["en","he"] as const)("renders%s live hero copy, real price/form links and four separate stage views",locale=>{
  const page=html(GroupApplicationLanding,{locale});
  expect(page).toContain('data-academy-site="true"');expect(page).toContain(`lang="${locale}"`);expect(page).toContain(`dir="${locale==="he"?"rtl":"ltr"}"`);
  expect(page.match(/<h1\b/g)).toHaveLength(1);expect(page).toContain("South Florida");expect(page).toContain("Jewish Leadership<br/>Fishing Academy");expect(page).toContain("A part-time enrichment<br/>program for boys");expect(page).toContain("Self-governance");
  expect(page).toContain('<picture>');expect(page).toContain('media="(min-width: 768px)"');expect(page).toContain('srcSet="/groups/academy/hero-desktop-selected-20261018.png"');expect(page).toContain('src="/groups/academy/hero-mobile-selected-20261018.png"');
  expect(page).toMatch(/<a[^>]*href="#pricing"[^>]*data-jlfa-primary="true"/);expect(page).toContain('id="pricing"');expect(page).toContain(`href="/${locale}/florida/apply"`);
  for(const stage of academyStages)expect(page).toContain(`href="/${locale}/florida/stages/${stage.slug}"`);
  expect(page.match(/data-academy-stage-card=/g)).toHaveLength(4);expect(page.match(/data-price-kind=/g)).toHaveLength(5);
  for(const id of["locations","fishing-skills","self-governance","outings","questions","founder"])expect(page).toContain(`id="${id}"`);
  expect(page).toContain('data-jlfa-header-logo="true"');expect(page).toContain('data-jlfa-footer-logo="true"');expect(page).toContain('/groups/people/founder-grass-group.webp');
  for(const value of['name="parentName"','name="postalCode"','role="timer"','data-counter','Save $800','HERO ARTWORK IN PROGRESS','text-layout-reference.png'])expect(page).not.toContain(value);
  expect(page).toContain('data-academy-whatsapp="true" data-visible="false"');expect(page).toContain('aria-hidden="true"');expect(page).toContain(ACADEMY_WHATSAPP.replaceAll("&","&amp;"));
 });
 it.each(["en","he"] as const)("keeps the%s complete form mounted with in-place language controls and same-document price actions",locale=>{
  const page=html(AcademyIntakePage,{locale});expect(page).toContain('data-academy-full-inquiry=""');expect(page).toContain('name="parentName"');expect(page).toContain('name="postalCode"');expect(page).toContain('name="learnerCount"');
  expect(page).toContain('id="academy-form"');expect(page).toContain('id="academy-drive-limit"');expect(page).toContain('id="academy-travel-faq"');expect(page).toContain('href="#apply"');expect(page).toContain('id="apply"');
  expect(page).toContain('aria-pressed="true"');expect(page).toContain('data-jlfa-header-logo="true"');expect(page).toContain('data-jlfa-footer-logo="true"');expect(page.match(/<form\b/g)).toHaveLength(1);
  expect(page).not.toContain('data-academy-whatsapp');expect(page).not.toContain('href="https://checkout.');
 });
 it.each(["en","he"] as const)("retains the%s sample's inert form and existing overview instead of mounting native stage links",locale=>{
  const page=html(GroupApplicationLanding,{locale,mode:"sample"});expect(page).toContain('name="parentName"');expect(page).toContain('aria-controls="jlfa-curriculum"');expect(page).not.toContain('data-academy-site');expect(page).not.toContain(`href="/${locale}/florida/apply"`);
 });
 for(const stage of academyStages)it.each(["en","he"] as const)(`${stage.slug}:%s has its own accessible age-depth view and the same header/footer`,locale=>{
  const page=html(AcademyStage,{locale,slug:stage.slug});expect(page).toContain(`data-academy-stage-view="${stage.slug}"`);expect(page.match(/<h1\b/g)).toHaveLength(1);expect(page.match(/role="tab"/g)).toHaveLength(3);expect(page.match(/role="tabpanel"/g)).toHaveLength(3);expect(page.match(/aria-selected="true"/g)).toHaveLength(1);expect(page.match(/ hidden=""/g)).toHaveLength(2);
  expect(page).toContain('data-jlfa-header-logo="true"');expect(page).toContain('data-jlfa-footer-logo="true"');expect(page).toContain(`href="/${locale}/florida/apply"`);expect(page).toContain('Deerfield Beach International Fishing Pier');
  for(const text of["source_approvals","profile_ciphertext","answerKey","paymentIntent","paid first mates"])expect(page).not.toContain(text);
 });
 it("does not fabricate48 weekly assignments or confirmed Keys benefits",()=>{
  expect(academyFoundationProgression).toHaveLength(6);const foundation=html(AcademyStage,{locale:"en",slug:"foundation"});
  for(const text of["Week 1","Week 2","Week 3","Week 4","Weeks 5–11","Session 12","to be announced","Bass Pro Shops","planned","voluntary","local twelfth-session alternative","no free Keys benefit"])expect(foundation).toContain(text);
  for(const slug of["independent","advanced","leadership"]){const page=html(AcademyStage,{locale:"en",slug});expect(page).toContain("not a fixed twelve-date itinerary");expect(page).not.toContain("Week 1</strong>");}
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
