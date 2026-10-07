import {expect,test} from "@playwright/test";
import {readFileSync} from "node:fs";

type Runtime={origin:string;practitioner:string;parent:string};
const path=process.env.LS_INTAKE_SYNTHETIC_BROWSER_FIXTURE_PATH;
if(!path)throw new Error("R43_BROWSER_FIXTURE_REQUIRED");
const runtime=JSON.parse(readFileSync(path,"utf8")) as Runtime;
if(runtime.origin!=="https://127.0.0.1:3471")throw new Error("R43_BROWSER_ORIGIN_NOT_ISOLATED");
test.use({baseURL:runtime.origin});

const copy={
 en:{alert:"Persistent technical test: invented data only. Do not pay. Consent fields exercise validation only; this is not real clinical consent.",saved:"Synthetic test data saved",parent:"Parent name",phone:"Phone",age:"Child 1 age",location:"Preferred location",day:"Sun",window:"Evening",consent:"I have read the text and agree to the three numbered statements above",signer:"Signer name",submit:"Submit",list:"Synthetic test data",note:"Synthetic test data only. This is not real parental consent, a payment or an appointment.",parentValue:"Synthetic Browser Parent",childValue:"Synthetic Browser Child"},
 he:{alert:"בדיקה טכנית שנשמרת: יש להזין נתונים מומצאים בלבד. אין לשלם.",saved:"נתוני הבדיקה נשמרו",parent:"שם ההורה",phone:"טלפון",age:"גיל ילד/ה 1",location:"מיקום מועדף",day:"א׳",window:"ערב",consent:"קראתי את הנוסח ואני מסכים/ה לשלוש ההצהרות הממוספרות לעיל",signer:"שם החותם/ת",submit:"שליחה",list:"נתוני בדיקה",note:"נתוני בדיקה בלבד. אין כאן הסכמה קלינית של הורה אמיתי, תשלום או פגישה.",parentValue:"הורה בדיקה מומצא",childValue:"ילד בדיקה מומצא"},
} as const;

for(const locale of ["en","he"] as const)test(`${locale}: authenticated synthetic intake persists and reads back without payment`,async({page,context},info)=>{
 const t=copy[locale];
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
 await page.getByLabel(t.parent,{exact:false}).fill(t.parentValue);await page.getByLabel(t.phone,{exact:false}).fill("+15555550126");
 await page.locator('input:not([name])[required][maxlength="120"]').fill(t.childValue);
 await page.getByRole("combobox",{name:t.age,exact:true}).click();await page.getByRole("option",{name:"8",exact:true}).click();
 await page.getByLabel(t.location,{exact:false}).fill(locale==="he"?"פארק בדיקה מומצא":"Synthetic browser park");
 await page.getByLabel(t.day,{exact:true}).check();await page.getByLabel(t.window,{exact:true}).check();
 await page.getByLabel(t.consent,{exact:false}).check();await page.getByLabel(t.signer,{exact:false}).fill(locale==="he"?"חותם בדיקה":"Synthetic Browser Signer");
 await page.keyboard.press("Tab");expect(await page.evaluate(()=>document.activeElement?.tagName)).not.toBe("BODY");
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 const submitted=page.waitForResponse(response=>response.url()===runtime.origin+"/api/intake"&&response.request().method()==="POST");
 await page.getByRole("button",{name:t.submit,exact:true}).click();const submitResponse=await submitted;expect(submitResponse.status()).toBe(200);expect((await submitResponse.json()).data).toMatchObject({projectionPending:false});await expect(page.getByRole("heading",{name:t.saved,exact:true})).toBeVisible();
 await page.screenshot({path:info.outputPath(`intake-${locale}-saved.png`),fullPage:true});

 const staff=await page.goto(`/${locale}/intake/staff`);expect(staff?.status()).toBe(200);
 const item=page.getByRole("button").filter({hasText:t.list}).first();await expect(item).toBeVisible();await item.click();
 await expect(page.getByText(t.note,{exact:true})).toBeVisible();await expect(page.getByText(t.parentValue,{exact:false})).toBeVisible();await expect(page.getByText(t.childValue,{exact:false})).toBeVisible();
 const consent=page.locator("details").first();await expect(consent.locator("summary")).toContainText(locale==="he"?"חותם בדיקה":"Synthetic Browser Signer");await consent.locator("summary").click();
 await expect(consent.getByText("פסקת הסכמה סינתטית לבדיקה בלבד.",{exact:true})).toBeVisible();for(const acknowledgement of ["הצהרה אחת.","הצהרה שתיים.","הצהרה שלוש."])await expect(consent.getByText(acknowledgement,{exact:false})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.screenshot({path:info.outputPath(`staff-${locale}-readback.png`),fullPage:true});
});

test("role boundary denies a parent and no session",async({page,context})=>{
 const unauthenticated=await page.request.post("/api/intake/staff",{headers:{Origin:runtime.origin,"X-CSRF-Token":"invalid"},data:{action:"issue_synthetic_fixture",operationId:crypto.randomUUID()}});expect(unauthenticated.status()).toBe(401);
 await context.clearCookies();await context.addCookies([{name:"__Host-ls-session",value:runtime.parent,url:runtime.origin,httpOnly:true,secure:true,sameSite:"Lax"}]);
 const session=await page.request.get("/api/identity/session");expect(session.status()).toBe(200);const csrf=(await session.json()).data.csrfToken as string;
 const denied=await page.request.post("/api/intake/staff",{headers:{Origin:runtime.origin,"X-CSRF-Token":csrf},data:{action:"issue_synthetic_fixture",operationId:crypto.randomUUID()}});expect(denied.status()).toBe(403);
 const list=await page.request.get("/api/intake/staff");expect(list.status()).toBe(403);expect(await list.text()).not.toContain("Synthetic Browser Parent");
 const rendered=await page.goto("/en/intake/staff");expect(rendered?.status()).toBe(200);await expect(page.getByText("Synthetic Browser Parent",{exact:false})).toHaveCount(0);
});
