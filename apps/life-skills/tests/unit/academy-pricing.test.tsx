/** Pure static markup/CSS contracts; no browser, checkout or viewport acceptance. */
import {readFileSync} from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import dgram from "node:dgram";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {afterAll,afterEach,beforeAll,describe,expect,test,vi} from "vitest";
import type {Locale} from "../../src/lib/locale.ts";
import {AcademyPricing} from "../../src/features/group-application/academy-pricing.tsx";

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
function article(html:string,kind:string){const found=new RegExp(`<article\\b[^>]*data-price-kind="${kind}"[^>]*>([\\s\\S]*?)</article>`).exec(html);expect(found).not.toBeNull();return found![1]!;}

describe.each(["en","he"] as const)("%s static Academy prices",locale=>{
 test("uses the pricing anchor and a static family offer with per-child stage scope",()=>{
  const html=render(locale);expect(html).toContain('id="pricing"');expect(html).toContain('data-academy-pricing=""');expect(html).toContain(`lang="${locale}"`);expect(html).toContain(`dir="${locale==="he"?"rtl":"ltr"}"`);
  expect(html).toContain(`<h2 id="academy-pricing-title">${locale==="he"?"20 המשפחות המייסדות":"Founding 20 Families"}</h2>`);expect(plain(html)).toContain(locale==="he"?"שלב אחד בן 12 מפגשים, לכל ילד, בדולר ארה״ב.":"One 12-session stage, per child, in US dollars.");
  expect(html.match(/data-price-kind=/g)).toHaveLength(5);expect(html).not.toMatch(/countdown|remaining|spots left|deadline|data-counter|<time|role="timer"|מקומות נותרו|ספירה לאחור/);
 });
 test("founding primary first-stage price compares1950 to1650 and saves300",()=>{
  const html=article(render(locale),"founding-primary");expect(html).toContain('<del><bdi dir="ltr">$1,950</bdi></del>');expect(html).toContain('<bdi dir="ltr">$1,650</bdi>');expect(plain(html)).toContain(locale==="he"?"חיסכון של $300 לעומת $1,950":"Save $300 vs. $1,950");expect(plain(html)).toContain(locale==="he"?"לשלב הראשון בלבד":"first-stage prepay only");
 });
 test.each([["regular-prepay",1750,200],["founding-sibling",1550,400],["ordinary-sibling",1650,300]] as const)("%s preserves the approved amount/savings distinction",(kind,amount,saving)=>{
  const html=article(render(locale),kind);expect(html).toContain(`<bdi dir="ltr">$${amount.toLocaleString("en-US")}</bdi>`);expect(plain(html)).toContain(locale==="he"?`חיסכון של $${saving} לעומת $1,950`:`Save $${saving} vs. $1,950`);expect(amount+saving).toBe(1950);
  if(kind==="founding-sibling")expect(plain(html)).toContain(locale==="he"?"השלב הראשון בלבד":"first-stage prepay only");
  if(kind!=="regular-prepay")expect(plain(html)).toContain(locale==="he"?"זכאי":"eligible");
 });
 test("primary and sibling installment totals are exactly three650 dues with no discount",()=>{
  const html=article(render(locale),"installments");expect(html).toContain('<bdi dir="ltr">$1,950</bdi>');expect(plain(html)).toContain("3 × $650 = $1,950");expect(plain(html)).toContain(locale==="he"?"אין הנחת אחים במסלול התשלומים":"No sibling installment discount");expect(plain(html)).toContain(locale==="he"?"לילד הראשון ולאחים":"Primary learners and siblings");expect(html).not.toMatch(/Save|חיסכון|\$1,550|\$1,650|\$1,750/);expect(3*650).toBe(1950);
 });
 test("does not sell annual prepay, stacked discounts, automatic next stages or800 savings",()=>{
  const text=plain(render(locale));for(const expected of locale==="he"?["השלב הראשון בלבד","אין כפל הנחות","תשלום מראש לשנה שלמה","חיוב אוטומטי לשלב הבא"]:["first stage only","Discounts do not stack","No full-year prepay","automatic next-stage charge"])expect(text).toContain(expected);
  expect(text).not.toMatch(/\$800|\$[678],\d{3}|cancel.anytime|membership|subscription|annually|renewal/);
 });
 test("requires full form before payment, qualifying verified payment and real offer/capacity",()=>{
  const text=plain(render(locale));for(const expected of locale==="he"?["טופס ההרשמה המלא","לפני התשלום","פרטי לוח הזמנים והנסיעה","רק תשלום מזכה שאומת","בקשה לשיחת חזרה","אינם יוצרים שמירה זמנית","לוח זמנים ומיקומים","מקום פנוי","תנאים שהתקבלו","הצעת תשלום מורשית","ללא חיוב","שמצבו אינו ידוע"]:["Complete the registration form, including schedule and travel details, before payment","only verified qualifying payment secures a founding-family reservation","Form submission, a callback request and pending/failed payment do not reserve it or create a temporary promotional hold","actual eligible group","disclosed schedule/locations","capacity","accepted terms","authorized payment offer","without charging","Pending, failed or unknown payment remains unreserved"])expect(text).toContain(expected);
 });
 test("default action navigates to the exact locale-specific full form",()=>{
  const html=render(locale);expect(html).toContain(`href="/${locale}/florida/apply"`);expect(html).toContain(locale==="he"?"הגשת בקשה / המשך להרשמה":"Apply / Continue to Enrollment");expect(html).not.toMatch(/<form|<input|<textarea|<button|<iframe|<script|<img|<svg/);expect(html.match(/<a\b/g)).toHaveLength(2);expect(plain(html)).not.toMatch(/Pay now|Checkout now|Reserve now|Pay here/);
 });
 test.each(["same","sample"])("explicit %s action preserves the narrow href whitelist",mode=>{
  const href=mode==="same"?`/${locale}/florida/apply`:"#apply";expect(render(locale,href)).toContain(`href="${href}"`);
 });
 test("WhatsApp is the exact source destination/prefill and user-initiated external anchor",()=>{
  const html=render(locale),url=new URL(whatsapp);expect(html).toContain(`href="${whatsapp}" target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer"`);expect(url.hostname).toBe("wa.me");expect(url.pathname).toBe("/972534932631");expect(url.searchParams.get("text")).toBe("Hi, I came from your website. I'd like to know more.");expect(html).toContain(locale==="he"?"יש שאלות? כתבו לנו בוואטסאפ":"Questions? Message on WhatsApp");
 });
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
test("authored CSS supports narrow/wide layouts and usable links without assets or global styles",()=>{
 const css=readFileSync(new URL("../../src/features/group-application/academy-pricing.module.css",import.meta.url),"utf8");for(const color of ["#052D50","#047AA8","#F4B12D","#FFF"])expect(css).toContain(color);expect(css).toContain("grid-template-columns:minmax(0,1fr)");expect(css).toContain("@media(min-width:48rem)");expect(css).toContain("@media(min-width:70rem)");expect(css).toContain("repeat(4,minmax(0,1fr))");expect(css).toContain("min-block-size:48px");expect(css).toContain(":focus-visible");expect(css).toContain("outline:3px solid #F4B12D");expect(css).toContain("padding-inline-start");expect(css).not.toMatch(/@import|url\(|:global|!important|position:fixed|min-width:340px/);
});
