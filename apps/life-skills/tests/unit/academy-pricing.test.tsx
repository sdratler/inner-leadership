import type {ReactNode} from 'react';
import {AcademyCampaignProvider} from '../../src/features/group-application/academy-campaign-state.ts';
import {campaignSnapshotSchema,ACADEMY_CAMPAIGN} from '../../src/features/group-application/academy-campaign-contract.ts';
/** Pure static markup/CSS contracts; no browser, checkout or viewport acceptance. */
import {readFileSync} from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import dgram from "node:dgram";
import {createElement} from "react";
import {renderToStaticMarkup as renderPhaseRaw} from "react-dom/server";
import {afterAll,afterEach,beforeAll,describe,expect,test,vi} from "vitest";
import type {Locale} from "../../src/lib/locale.ts";
import {AcademyPricing,AcademyRegistrationOffer} from "../../src/features/group-application/academy-pricing.tsx";

const CANARY="PRIVATE_SYNTHETIC_HREF1107";
const whatsapp="https://wa.me/972534932631?text=Hi%2C%20I%20came%20from%20your%20website.%20I%27d%20like%20to%20know%20more.";
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
const render=(locale:Locale,href?:string)=>renderToStaticMarkup(createElement(AcademyPricing,{locale,...(href===undefined?{}:{applicationHref:href})}));
const plain=(html:string)=>html.replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim();
function cell(html:string,kind:string){const found=new RegExp(`<td\\b[^>]*data-price-kind="${kind}"[^>]*>([\\s\\S]*?)</td>`).exec(html);expect(found).not.toBeNull();return found![1]!;}

describe.each(["en","he"] as const)("%s compact Academy price comparison",locale=>{
 test("uses one compact panel with an adjacent ordinary/founder comparison",()=>{
  const html=render(locale);expect(html).toContain('id="pricing"');expect(html).toContain('data-academy-pricing=""');expect(html).toContain(`lang="${locale}"`);expect(html).toContain(`dir="${locale==="he"?"rtl":"ltr"}"`);
  expect(html).toContain(locale==='he'?'הירשמו בחינם. חסכו 300 דולר.':'Pre-register free. Save $300.');expect(html.match(/data-price-group=/g)).toHaveLength(1);expect(html.match(/data-price-kind=/g)).toHaveLength(5);
  expect(html).not.toMatch(/countdown|spots left|role="timer"|מקומות נותרו/);expect(plain(html)).toContain(locale==='he'?'12 מפגשים':'12-session');
 });
 test("founding primary compares the real three-block basis without a false former price",()=>{
  const html=render(locale);expect(cell(html,'founding-primary')).toContain('$1,650');expect(html).toContain('$1,950');expect(html).not.toContain('<del>');expect(plain(html)).toContain(locale==='he'?'שלושה מקבצים נפרדים':'Three separately purchased');expect(plain(html)).toContain('$300');
 });
 test.each([["regular-prepay",1750,200],["founding-sibling",1550,400],["ordinary-sibling",1650,300]] as const)("%s preserves master amount and savings basis",(kind,amount,saving)=>{
  expect(cell(render(locale),kind)).toContain(`$${amount.toLocaleString('en-US')}`);expect(amount+saving).toBe(1950);
 });
 test("monthly row is a separate650 purchase, never automatic renewal",()=>{const text=plain(render(locale));expect(text).toContain('$650');expect(text).toContain(locale==='he'?'ל־4 שיעורים':'for 4 lessons');expect(text).toContain(locale==='he'?'כל מקבץ נרכש בנפרד':'Each block is purchased separately');expect(text).toContain(locale==='he'?'ללא חידוש אוטומטי':'No automatic renewal');});
 test("no annual offer,1850proposal,stacked discounts or800 claim",()=>{const text=plain(render(locale));expect(text).not.toMatch(/\$800|\$1,850|Pay now|membership|subscription/);expect(text).toContain(locale==='he'?'אין כפל הנחות':'Discounts do not stack');for(const amount of ['$3,200','$3,400','$3,900'])expect(text).toContain(amount);});
 test("lifecycle details remain readable inside a collapsed how-it-works disclosure",()=>{const html=render(locale);expect(html).toMatch(/<details[^>]*><summary>/);expect(html).not.toMatch(/<details[^>]*open=/);expect(plain(html)).toContain(locale==='he'?'לא מקום בכיתה או מועד פתיחה':'not a class seat or start date');expect(plain(html)).toContain(locale==='he'?'שבעה ימים קלנדריים':'seven-calendar-day');});
 test("default action navigates to the exact localized form",()=>{const html=render(locale);expect(html).toContain(`href="/${locale}/florida/apply"`);expect(html).toContain(locale==='he'?'הרשמה מוקדמת בחינם':'Pre-register for free');expect(html).not.toMatch(/<form|<input|<textarea|<button|<iframe|<script|<img/);expect(html.match(/<a\b/g)).toHaveLength(1);});
 test.each(['same','sample'])("explicit %s action preserves narrow href whitelist",mode=>{const href=mode==='same'?`/${locale}/florida/apply`:'#apply';expect(render(locale,href)).toContain(`href="${href}"`);});
 test("does not duplicate floating WhatsApp",()=>{expect(render(locale)).not.toContain(whatsapp);expect(render(locale)).not.toContain('wa.me');});
});

test.each(["https://evil.invalid/"+CANARY,"//evil.invalid/"+CANARY,"javascript:"+CANARY,"/en/florida/apply?x="+CANARY,"/en/florida/apply#"+CANARY,"/he/florida/apply","/en/florida/apply/"," /en/florida/apply","#pricing","","#apply\n",null,123,true,{}])("invalid application href fails with only a fixed error (%s)",href=>{
 let caught:unknown;try{Reflect.apply(AcademyPricing,undefined,[{locale:"en",applicationHref:href}]);}catch(error){caught=error;}expect(caught).toBeInstanceOf(Error);if(!(caught instanceof Error))throw new Error("EXPECTED_SAFE_ERROR");expect(caught.message).toBe("ACADEMY_PRICING_UNAVAILABLE");expect(String(caught)).not.toContain(CANARY);expect(caught.cause).toBeUndefined();
});
test.each(["en-US","fr",CANARY,null,undefined])("invalid locale cannot build an arbitrary action (%s)",locale=>{
 expect(()=>Reflect.apply(AcademyPricing,undefined,[{locale}])).toThrow("ACADEMY_PRICING_UNAVAILABLE");
});
test("frozen props are not mutated and rendering uses no logs or effects",()=>{
 const props=Object.freeze({locale:"en" as const,applicationHref:"#apply"}),before={...props},spies=[vi.spyOn(console,"log"),vi.spyOn(console,"warn"),vi.spyOn(console,"error")];try{const first=renderToStaticMarkup(createElement(AcademyPricing,props));expect(renderToStaticMarkup(createElement(AcademyPricing,props))).toBe(first);expect(props).toEqual(before);for(const spy of spies)expect(spy).not.toHaveBeenCalled();}finally{for(const spy of spies)spy.mockRestore();}
});
test("compact comparison CSS supports narrow content, logical alignment and keyboard controls",()=>{
 const css=readFileSync(new URL("../../src/features/group-application/academy-pricing.module.css",import.meta.url),"utf8");for(const color of ['#052D50','#047AA8','#F4B12D','#FFF'])expect(css).toContain(color);expect(css).toContain('table-layout:fixed');expect(css).toContain('overflow-wrap:anywhere');expect(css).toContain('min-block-size:48px');expect(css).toContain(':focus-visible');expect(css).toContain('padding-inline-start');expect(css).not.toMatch(/@import|url\(|:global|!important|position:fixed/);
});

const explicitPre=campaignSnapshotSchema.parse({version:ACADEMY_CAMPAIGN,phase:'PRE_REGISTRATION',revision:1,capacity:30,occupied:1,remaining:29,firstFilledAt:null,asOf:'2026-10-23T14:00:00.000Z',reopeningPolicy:'PROPOSED_STICKY_REGULAR_PENDING_OWNER_CONFIRMATION'});
function renderToStaticMarkup(node:ReactNode){return renderPhaseRaw(createElement(AcademyCampaignProvider,{initial:explicitPre},node));}

test('actual phase gates founder promotion and family totals use the same commercial master',()=>{
 for(const locale of ['en','he'] as const)for(const initial of [explicitPre,null]){
  const html=renderPhaseRaw(createElement(AcademyCampaignProvider,{initial},createElement(AcademyRegistrationOffer,{locale,childrenCount:2})));
  expect(html).toContain(initial?'$3,200':'$3,400');expect(html).toContain(initial?'$1,550':'$1,650');
  if(!initial){expect(html).not.toContain('$3,200');expect(html).not.toContain('$300');expect(html).not.toContain(locale==='he'?'המשפחות הזכאיות הראשונות':'First 30 qualifying families');}
 }
});
