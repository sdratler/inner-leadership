/** Root-only mounted email setup readback. Execute only through the exact
 * reviewed/admitted disposable native recipe; no ordinary CI fallback. */
import {readFileSync} from "node:fs";
import {test,expect,type Page} from "@playwright/test";
import type {InquiryEmailSetupReport} from "../../../src/features/group-application/inquiry-email-setup.ts";
import {verifyInquiryEmailSetupReadback,expectInquiryEmailSetupAbsent} from "./inquiry-email-setup.journey.ts";

const fixturePath=process.env.LS_INQUIRY_EMAIL_SETUP_FIXTURE;
if(!fixturePath||process.env.LS_INQUIRY_EMAIL_SETUP_NATIVE_ALLOW!=="ROOT_REGISTERED_ONLY")throw Error("EMAIL_SETUP_NATIVE_RECIPE_REQUIRED");
const data=JSON.parse(readFileSync(fixturePath,"utf8")) as {origin:string;project:"desktop"|"mobile340";configured:boolean;queueEnabled:boolean;accounts:{role:"practitioner"|"parent";email:string;password:string}[];forbidden:string[]};
if(data.origin!==(data.project==="desktop"?"https://localhost:3105":"https://localhost:3107"))throw Error("EMAIL_SETUP_EXACT_ORIGIN");
test.use({baseURL:data.origin});
const endpoint="/api/private/group-applications",marker="[data-inquiry-email-setup]";
async function ordinaryLogin(page:Page,locale:"en"|"he",role:"practitioner"|"parent",target:string){
 const account=data.accounts.find(a=>a.role===role);if(!account)throw Error("EMAIL_SETUP_ORDINARY_ACTOR_REQUIRED");
 await page.goto(`/${locale}/login?next=${encodeURIComponent(target)}`);
 await page.getByLabel(locale==="he"?"דוא״ל":"Email",{exact:true}).fill(account.email);await page.getByLabel(locale==="he"?"סיסמה":"Password",{exact:true}).fill(account.password);
 const login=page.waitForResponse(r=>new URL(r.url()).origin===data.origin&&new URL(r.url()).pathname==="/api/identity/login"&&r.request().method()==="POST");
 await page.getByRole("button",{name:locale==="he"?"כניסה":"Sign in",exact:true}).click();expect((await login).status()).toBe(200);
}
function reviewResponse(page:Page){const waiting=page.waitForResponse(r=>new URL(r.url()).origin===data.origin&&new URL(r.url()).pathname===endpoint&&!new URL(r.url()).search&&r.request().method()==="GET");void waiting.catch(()=>undefined);return waiting;}
async function checkedReport(response:Awaited<ReturnType<typeof reviewResponse>>):Promise<InquiryEmailSetupReport>{
 expect(response.status()).toBe(200);expect(await response.finished()).toBeNull();expect(response.headers()["cache-control"]).toContain("no-store");
 const raw=await response.text();for(const secret of data.forbidden)expect(raw.includes(secret)).toBe(false);
 const body=JSON.parse(raw);expect(body.ok).toBe(true);expect(Object.keys(body.data).sort()).toEqual(["emailSetup","items"]);expect(body.data.items).toEqual([]);
 const report=body.data.emailSetup as InquiryEmailSetupReport;expect(Object.keys(report).sort()).toEqual(["deliveryVerified","fields","providerSetup","purpose","queueEnabled","sendPermitted","senderVerified","status"]);
 expect(Object.keys(report.fields).sort()).toEqual(["LS_AUTH_EMAIL_ENABLED","LS_AUTH_EMAIL_FROM","LS_AUTH_EMAIL_PROVIDER","LS_AUTH_GOOGLE_CLIENT_ID","LS_AUTH_GOOGLE_CLIENT_SECRET","LS_AUTH_GOOGLE_REFRESH_TOKEN","LS_INQUIRY_EMAIL_QUEUE_ENABLED","LS_INQUIRY_EMAIL_SEND_ENABLED"].sort());
 expect(report).toMatchObject({purpose:"academy_inquiry_acknowledgment_v1",status:"SEND_DISABLED",queueEnabled:data.queueEnabled,providerSetup:data.configured?"CONFIGURED_UNVERIFIED":"INCOMPLETE",sendPermitted:false,senderVerified:false,deliveryVerified:false});return report;
}
for(const locale of ["en","he"] as const)test(`${locale}: ordinary authorized inquiry email setup, native privacy and controlled failure clearing`,async({page,browser},info)=>{
 test.setTimeout(120000);expect(info.project.name).toBe(data.project);const t=(en:string,he:string)=>locale==="he"?he:en,target=`/${locale}/app/group-applications`,unexpectedWrites:string[]=[],outside:string[]=[];
 const track=(p:Page)=>{p.on("request",r=>{const u=new URL(r.url());if(["http:","https:"].includes(u.protocol)&&u.origin!==data.origin)outside.push("OFF_ORIGIN");if(["POST","PUT","PATCH","DELETE"].includes(r.method())&&u.pathname!=="/api/identity/login")unexpectedWrites.push("UNEXPECTED_WRITE");});};track(page);
 // Ordinary anonymous/private-page denial, not fabricated session cookies.
 expect((await page.request.get(endpoint)).status()).toBe(401);await page.goto(target);await expect(page).toHaveURL(`/${locale}/login?next=${encodeURIComponent(target)}`);await expectInquiryEmailSetupAbsent(page,{fixture:"SYNTHETIC_ONLY",origin:data.origin});
 const initial=reviewResponse(page);await ordinaryLogin(page,locale,"practitioner",target);const report=await checkedReport(await initial);await expect(page).toHaveURL(target);
 async function visibleSetup(current:InquiryEmailSetupReport){const details=page.locator(marker);await expect(details).toHaveCount(1);if(await details.getAttribute("open")===null)await details.locator("summary").click();expect(await verifyInquiryEmailSetupReadback(page,{fixture:"SYNTHETIC_ONLY",origin:data.origin,locale,report:current})).toEqual({available:true,queueEnabled:data.queueEnabled,holdRequired:false,providerConfigured:data.configured});for(const secret of data.forbidden)expect((await details.innerText()).includes(secret)).toBe(false);}
 await visibleSetup(report);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.screenshot({path:info.outputPath(`email-setup-${locale}-${data.project}.png`),fullPage:true});
 // These are explicit UI fault injections AFTER native authorized readback,
 // not claims of native session revocation or changed real configuration.
 for(const status of [503,403,401]){
  let release:()=>void=()=>{};let began=false;
  await page.route("**/api/private/group-applications",async route=>{began=true;await new Promise<void>(resolve=>{release=resolve;});await route.fulfill({status,contentType:"application/json",body:JSON.stringify({ok:false,error:{code:status===503?"UNAVAILABLE":status===403?"FORBIDDEN":"UNAUTHENTICATED"}})});});
  try{await page.getByRole("button",{name:t("Refresh","רענון"),exact:true}).click();await expect.poll(()=>began).toBe(true);await expectInquiryEmailSetupAbsent(page,{fixture:"SYNTHETIC_ONLY",origin:data.origin});}
  finally{release();}
  await expect(page.getByRole("alert")).toHaveCount(1);await expectInquiryEmailSetupAbsent(page,{fixture:"SYNTHETIC_ONLY",origin:data.origin});await page.unrouteAll({behavior:"wait"});
  const restored=reviewResponse(page);await page.getByRole("button",{name:t("Refresh","רענון"),exact:true}).click();await visibleSetup(await checkedReport(await restored));
 }
 const parent=await browser.newContext({baseURL:data.origin,ignoreHTTPSErrors:true});try{
  const p=await parent.newPage();track(p);await ordinaryLogin(p,locale,"parent",`/${locale}/family/schedule`);await expect(p).toHaveURL(new RegExp(`/${locale}/family/schedule`));
  const denied=await p.request.get(endpoint);expect(denied.status()).toBe(403);const text=await denied.text();expect(text.includes("emailSetup")).toBe(false);for(const secret of data.forbidden)expect(text.includes(secret)).toBe(false);
  await p.goto(target);await expectInquiryEmailSetupAbsent(p,{fixture:"SYNTHETIC_ONLY",origin:data.origin});
 }finally{await parent.close();}
 expect(unexpectedWrites).toEqual([]);expect(outside).toEqual([]);
});
