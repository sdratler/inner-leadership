import {academyExactCopy} from '../../src/features/group-application/academy-exact-copy.ts';
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
function cell(html:string,kind:string){const found=new RegExp(`<p\\b[^>]*data-price-kind="${kind}"[^>]*>([\\s\\S]*?)</p>`).exec(html);expect(found).not.toBeNull();return found![1]!;}

describe.each(["en","he"] as const)("%s exact actual Academy prices",locale=>{
 test("uses one actual three-price panel without comparison or fabricated scarcity",()=>{
  const html=render(locale);expect(html).toContain('id="pricing"');expect(html).toContain('data-academy-pricing="true"');expect(html).toContain(`lang="${locale}"`);expect(html).toContain(`dir="${locale==="he"?"rtl":"ltr"}"`);
  expect(html).toContain(academyExactCopy[locale].pricing.heading);expect(html.match(/data-price-group=/g)).toHaveLength(1);expect(html.match(/data-price-kind=/g)).toHaveLength(3);
  expect(html).not.toMatch(/countdown|spots left|role="timer"|מקומות נותרו|<table|<del>|\$1,950|\$800|\$1,850/);expect(plain(html)).toContain(academyExactCopy[locale].pricing.unit);
 });
 test.each([['founding-primary',1650],['founding-sibling',1550],['monthly-block',650]] as const)('%s shows its actual master amount', (kind,amount)=>{expect(cell(render(locale),kind)).toContain(`$${amount.toLocaleString('en-US')}`);});
 test('ordinary and unknown snapshots show only ordinary rates without a founder claim',()=>{
  for(const initial of [null,campaignSnapshotSchema.parse({...explicitPre,phase:'REGULAR_REGISTRATION',revision:2,occupied:30,remaining:0,firstFilledAt:explicitPre.asOf})]){
   const html=renderPhaseRaw(createElement(AcademyCampaignProvider,{initial},createElement(AcademyPricing,{locale})));
   for(const [kind,amount] of [['regular-prepay',1750],['ordinary-sibling',1650],['monthly-block',650]] as const)expect(cell(html,kind)).toContain(`$${amount.toLocaleString('en-US')}`);
   expect(html).toContain(academyExactCopy[locale].pricing.ordinaryBelow);expect(html).not.toMatch(/founding-primary|founding-sibling|\$300|\$1,550/);
  }
 });
 test('does not add renewal, comparison or a payment action to the short panel',()=>{
  const html=render(locale);expect(html).toContain(academyExactCopy[locale].pricing.founderQualifier);expect(html).toContain(academyExactCopy[locale].pricing.noPayment);expect(html).not.toMatch(/<details|<form|<input|<textarea|<button|<iframe|<script|<img|Pay now|subscription/);
 });
 test("default action navigates to the exact localized form",()=>{const html=render(locale);expect(html).toContain(`href="/${locale}/florida/apply"`);expect(html).toContain(academyExactCopy[locale].nav.preRegister);expect(html.match(/<a\b/g)).toHaveLength(1);});
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
test("actual-price CSS supports readable narrow content and keyboard controls",()=>{
 const css=readFileSync(new URL("../../src/features/group-application/academy-pricing.module.css",import.meta.url),"utf8");for(const token of ['#092668','#fdc844','min-block-size:48px',':focus-visible','max-inline-size:1120px','font-size:16px','text-align:start'])expect(css).toContain(token);expect(css).not.toMatch(/@import|url\(|:global|!important|position:fixed|table-layout/);
});

const explicitPre=campaignSnapshotSchema.parse({version:ACADEMY_CAMPAIGN,phase:'PRE_REGISTRATION',revision:1,capacity:30,occupied:1,remaining:29,firstFilledAt:null,asOf:'2026-10-23T14:00:00.000Z',reopeningPolicy:'PROPOSED_STICKY_REGULAR_PENDING_OWNER_CONFIRMATION'});
function renderToStaticMarkup(node:ReactNode){return renderPhaseRaw(createElement(AcademyCampaignProvider,{initial:explicitPre},node));}

test('actual phase gates founder promotion and family totals use the same commercial master',()=>{
 for(const locale of ['en','he'] as const)for(const initial of [explicitPre,null]){
  const html=renderPhaseRaw(createElement(AcademyCampaignProvider,{initial},createElement(AcademyRegistrationOffer,{locale,childrenCount:2})));
  expect(html).toContain(initial?'$1,650':'$1,750');expect(html).toContain(initial?'$1,550':'$1,650');expect(html).toContain('$650');if(initial)expect(html).toContain('$3,200');else expect(html).not.toContain('data-registration-family-price');
  if(!initial){expect(html).not.toContain('$3,200');expect(html).not.toContain('$300');expect(html).not.toContain(locale==='he'?'המשפחות הזכאיות הראשונות':'First 30 qualifying families');}
 }
});
