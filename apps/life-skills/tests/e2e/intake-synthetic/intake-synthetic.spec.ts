import {expect,test} from "@playwright/test";
import {mkdirSync,readFileSync} from "node:fs";
import {join} from "node:path";

type Runtime={origin:string;practitioner:string;parent:string};
const path=process.env.LS_INTAKE_SYNTHETIC_BROWSER_FIXTURE_PATH;
const dedicated=process.env.LS_INTAKE_SYNTHETIC_BROWSER_ALLOW==="true";
if(Boolean(path)!==dedicated)throw new Error("R43_BROWSER_FIXTURE_GATE_MISMATCH");
const runtime=path?JSON.parse(readFileSync(path,"utf8")) as Runtime:{origin:"https://127.0.0.1:3471",practitioner:"",parent:""};
if(dedicated&&runtime.origin!=="https://127.0.0.1:3471")throw new Error("R43_BROWSER_ORIGIN_NOT_ISOLATED");
test.skip(!dedicated,"R43 requires its explicit isolated PostgreSQL/HTTPS runner");
test.use({baseURL:runtime.origin});

const copy={
 en:{alert:"Persistent technical test: invented data only. Do not pay. Consent fields exercise validation only; this is not real clinical consent.",saved:"Synthetic test data saved",parent:"Parent name",phone:"Phone",age:"Child 1 age",location:"Preferred location",day:"Sun",window:"Evening",consent:"I have read the text and agree to the three numbered statements above",signer:"Signer name",submit:"Submit",list:"Synthetic test data",note:"Synthetic test data only. This is not real parental consent, a payment or an appointment.",syntheticNext:"Technical test only. Do not contact anyone, verify payment or book an appointment from this record.",parentValue:"Synthetic Browser Parent",childValue:"Synthetic Browser Child",phoneValue:"+15555550126",emailValue:"synthetic.browser@example.test"},
 he:{alert:"בדיקה טכנית שנשמרת: יש להזין נתונים מומצאים בלבד. אין לשלם.",saved:"נתוני הבדיקה נשמרו",parent:"שם ההורה",phone:"טלפון",age:"גיל ילד/ה 1",location:"מיקום מועדף",day:"א׳",window:"ערב",consent:"קראתי את הנוסח ואני מסכים/ה לשלוש ההצהרות הממוספרות לעיל",signer:"שם החותם/ת",submit:"שליחה",list:"נתוני בדיקה",note:"נתוני בדיקה בלבד. אין כאן הסכמה קלינית של הורה אמיתי, תשלום או פגישה.",syntheticNext:"בדיקה טכנית בלבד. אין ליצור קשר, לאמת תשלום או לקבוע פגישה על סמך רשומה זו.",parentValue:"הורה בדיקה מומצא",childValue:"ילד בדיקה מומצא",phoneValue:"+972555550126",emailValue:"synthetic.hebrew@example.test"},
} as const;

function configuredWidth(projectName:string){return projectName==="mobile340"?340:projectName==="mobile390"?390:1440;}
async function expectConfiguredLayout(page:import("@playwright/test").Page,width:number){
 const metrics=await page.evaluate(()=>{
  const visible=[...document.querySelectorAll<HTMLElement>("body *")].filter(element=>{const style=getComputedStyle(element),rect=element.getBoundingClientRect();return style.display!=="none"&&style.visibility!=="hidden"&&rect.width>0&&rect.height>0;});
  return {innerWidth,clientWidth:document.documentElement.clientWidth,visualWidth:visualViewport?.width??null,scrollWidth:document.documentElement.scrollWidth,mainWidth:document.querySelector("main")?.getBoundingClientRect().width??null,minLeft:Math.min(0,...visible.map(element=>element.getBoundingClientRect().left)),maxRight:Math.max(0,...visible.map(element=>element.getBoundingClientRect().right))};
 });
 expect(metrics.innerWidth).toBe(width);expect(metrics.clientWidth).toBe(width);expect(metrics.visualWidth).toBe(width);expect(metrics.scrollWidth).toBe(width);expect(metrics.mainWidth).not.toBeNull();expect(metrics.mainWidth!).toBeLessThanOrEqual(width);expect(metrics.minLeft).toBeGreaterThanOrEqual(-1);expect(metrics.maxRight).toBeLessThanOrEqual(width+1);
}
async function screenshotAtConfiguredWidth(page:import("@playwright/test").Page,path:string,width:number,fullPage:boolean){
 await page.screenshot({path,fullPage});
 expect(readFileSync(path).readUInt32BE(16)).toBe(width);
}
async function recordSavedHeader(page:import("@playwright/test").Page,locale:"en"|"he",project:string){
 const phase=process.env.LS_SHARED_UI_POLISH_EXPECT??"verify",evidenceRoot=process.env.LS_SHARED_UI_POLISH_EVIDENCE_ROOT;
 if(evidenceRoot)mkdirSync(evidenceRoot,{recursive:true});
 await page.evaluate(()=>scrollTo(0,0));
 const brand=page.getByRole("link",{name:locale==="he"?"כישורי חיים — חזרה לאתר":"Life Skills — return to website"});
 const menu=page.getByRole("button",{name:locale==="he"?"פתיחת תפריט":"Open menu"});
 const language=page.getByRole("button",{name:locale==="he"?"View this form in English":"עברית"});
 const metrics=await page.evaluate(({brandLabel,menuLabel,languageLabel})=>{
  const byLabel=(label:string)=>document.querySelector<HTMLElement>(`[aria-label="${CSS.escape(label)}"]`),rect=(element:HTMLElement|null)=>element?element.getBoundingClientRect().toJSON():null;
  return {direction:getComputedStyle(document.documentElement).direction,brand:rect(byLabel(brandLabel)),menu:rect(byLabel(menuLabel)),language:rect(byLabel(languageLabel))};
 },{brandLabel:locale==="he"?"כישורי חיים — חזרה לאתר":"Life Skills — return to website",menuLabel:locale==="he"?"פתיחת תפריט":"Open menu",languageLabel:locale==="he"?"View this form in English":"עברית"});
 if(evidenceRoot)await page.screenshot({path:join(evidenceRoot,`${phase}-intake-${locale}-${project}-saved-header.png`),fullPage:false});
 console.log(`SHARED_UI_INTAKE_HEADER ${JSON.stringify({phase,locale,project,...metrics})}`);
 if(project!=="desktop"){
  await expect(brand).toBeVisible();await expect(menu).toBeVisible();await expect(language).toBeVisible();
  if(phase==="before"&&locale==="en")expect(metrics.brand!.x).toBeGreaterThan(metrics.menu!.x);
  else expect(locale==="en"?metrics.brand!.x<metrics.menu!.x:metrics.brand!.x>metrics.menu!.x).toBe(true);
 }else if(phase!=="before"){
  await expect(brand).toBeVisible();
 }
}

for(const locale of ["en","he"] as const)test(`${locale}: authenticated synthetic intake persists and reads back without payment`,async({page,context},info)=>{
 const t=copy[locale];
 const width=configuredWidth(info.project.name);
 await context.addCookies([{name:"__Host-ls-session",value:runtime.practitioner,url:runtime.origin,httpOnly:true,secure:true,sameSite:"Lax"}]);
 const session=await page.request.get("/api/identity/session");expect(session.status()).toBe(200);
 const csrf=(await session.json()).data.csrfToken as string,operationId=crypto.randomUUID();
 const issuedResponse=await page.request.post("/api/intake/staff",{headers:{Origin:runtime.origin,"X-CSRF-Token":csrf},data:{action:"issue_synthetic_fixture",operationId}});
 expect(issuedResponse.status()).toBe(201);const issued=(await issuedResponse.json()).data as {token:string;replayed:boolean};expect(issued.replayed).toBe(false);
 const replay=await page.request.post("/api/intake/staff",{headers:{Origin:runtime.origin,"X-CSRF-Token":csrf},data:{action:"issue_synthetic_fixture",operationId}});
 expect(replay.status()).toBe(201);expect((await replay.json()).data).toMatchObject({token:issued.token,replayed:true});

 const response=await page.goto(`/${locale}/intake#${issued.token}`);expect(response?.status()).toBe(200);
 await expect(page.locator('aside[role="alert"]')).toContainText(t.alert);await expect(page.locator("html")).toHaveAttribute("dir",locale==="he"?"rtl":"ltr");
 await expect(page.getByText(locale==="he"?"לתשלום בקישור המאובטח":"Pay using the secure link",{exact:true})).toHaveCount(0);
 await page.getByLabel(t.parent,{exact:false}).fill(t.parentValue);await page.getByLabel(t.phone,{exact:false}).fill(t.phoneValue);await page.locator('input[name="email"]').fill(t.emailValue);
 await page.locator('input:not([name])[required][maxlength="120"]').fill(t.childValue);
 await page.getByRole("combobox",{name:t.age,exact:true}).click();await page.getByRole("option",{name:"8",exact:true}).click();
 await page.getByLabel(t.location,{exact:false}).fill(locale==="he"?"פארק בדיקה מומצא":"Synthetic browser park");
 await page.getByLabel(t.day,{exact:true}).check();await page.getByLabel(t.window,{exact:true}).check();
 await page.getByLabel(t.consent,{exact:false}).check();await page.getByLabel(t.signer,{exact:false}).fill(locale==="he"?"חותם בדיקה":"Synthetic Browser Signer");
 await page.keyboard.press("Tab");expect(await page.evaluate(()=>document.activeElement?.tagName)).not.toBe("BODY");
 await expectConfiguredLayout(page,width);
 const submitted=page.waitForResponse(response=>response.url()===runtime.origin+"/api/intake"&&response.request().method()==="POST");
 await page.getByRole("button",{name:t.submit,exact:true}).click();const submitResponse=await submitted;expect(submitResponse.status()).toBe(200);expect((await submitResponse.json()).data).toMatchObject({projectionPending:false});await expect(page.getByRole("heading",{name:t.saved,exact:true})).toBeVisible();
 await recordSavedHeader(page,locale,info.project.name);
 await expectConfiguredLayout(page,width);await screenshotAtConfiguredWidth(page,info.outputPath(`intake-${locale}-saved.png`),width,true);

 const staff=await page.goto(`/${locale}/intake/staff`);expect(staff?.status()).toBe(200);
 const item=page.getByRole("button").filter({hasText:t.list}).first();await expect(item).toBeVisible();await item.click();
 await expect(page.getByText(t.note,{exact:true})).toBeVisible();await expect(page.getByText(t.parentValue,{exact:false})).toBeVisible();await expect(page.getByText(t.childValue,{exact:false})).toBeVisible();await expect(page.getByText(t.syntheticNext,{exact:true})).toBeVisible();
 const phone=page.locator('bdi[dir="ltr"]').filter({hasText:t.phoneValue}).first();await expect(phone).toHaveText(t.phoneValue);expect(await phone.evaluate(element=>getComputedStyle(element).direction)).toBe("ltr");
 const email=page.locator('bdi[dir="ltr"]').filter({hasText:t.emailValue}).first();await expect(email).toHaveText(t.emailValue);expect(await email.evaluate(element=>getComputedStyle(element).direction)).toBe("ltr");
 await expect(page.getByText(locale==="he"?"לא כרגע":"Not now",{exact:false})).toBeVisible();await expect(page.getByText(/not_now/,{exact:true})).toHaveCount(0);
 const consent=page.locator("details").first();await expect(consent.locator("summary")).toContainText(locale==="he"?"חותם בדיקה":"Synthetic Browser Signer");await consent.locator("summary").click();
 await expect(consent.getByText("פסקת הסכמה סינתטית לבדיקה בלבד.",{exact:true})).toBeVisible();for(const acknowledgement of ["הצהרה אחת.","הצהרה שתיים.","הצהרה שלוש."])await expect(consent.getByText(acknowledgement,{exact:false})).toBeVisible();
 await expectConfiguredLayout(page,width);
 await screenshotAtConfiguredWidth(page,info.outputPath(`staff-${locale}-viewport.png`),width,false);
 await screenshotAtConfiguredWidth(page,info.outputPath(`staff-${locale}-readback.png`),width,true);
});

test("role boundary denies a parent and no session",async({page,context})=>{
 const unauthenticated=await page.request.post("/api/intake/staff",{headers:{Origin:runtime.origin,"X-CSRF-Token":"invalid"},data:{action:"issue_synthetic_fixture",operationId:crypto.randomUUID()}});expect(unauthenticated.status()).toBe(401);
 await context.clearCookies();await context.addCookies([{name:"__Host-ls-session",value:runtime.parent,url:runtime.origin,httpOnly:true,secure:true,sameSite:"Lax"}]);
 const session=await page.request.get("/api/identity/session");expect(session.status()).toBe(200);const csrf=(await session.json()).data.csrfToken as string;
 const denied=await page.request.post("/api/intake/staff",{headers:{Origin:runtime.origin,"X-CSRF-Token":csrf},data:{action:"issue_synthetic_fixture",operationId:crypto.randomUUID()}});expect(denied.status()).toBe(403);
 const list=await page.request.get("/api/intake/staff");expect(list.status()).toBe(403);expect(await list.text()).not.toContain("Synthetic Browser Parent");
 const rendered=await page.goto("/en/intake/staff");expect(rendered?.status()).toBe(200);await expect(page.getByText("Synthetic Browser Parent",{exact:false})).toHaveCount(0);
});
