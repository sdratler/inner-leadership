/** Mounted authenticated R35 owner journeys. No API mocking, request interception, real contacts or provider effects. */
import {expect,test} from "@playwright/test";
import {execFile} from "node:child_process";
import {readFileSync} from "node:fs";
import {promisify} from "node:util";
type Runtime={origin:string;workspaceId:string;owner:string;parent:string;caseId:string};
const runtimePath=process.env.LS_PROVIDER_INDEX_FIXTURE_PATH;
if(!runtimePath){
 if(process.env.LS_PROVIDER_INDEX_TEST_RUNNER_ACTIVE==="true")throw new Error("R35_FIXTURE_REQUIRED");
 test("isolated R35 authenticated journeys for the current browser project",async({},info)=>{test.setTimeout(300_000);if(!["desktop","mobile390","mobile340"].includes(info.project.name))throw new Error("R35_BROWSER_PROJECT_NOT_SUPPORTED");
  const result=await promisify(execFile)(process.execPath,["--import","tsx","tests/e2e/provider-index/run.ts"],{timeout:270_000,maxBuffer:2*1024*1024,env:{...process.env,LS_PROVIDER_INDEX_TEST_PROJECT:info.project.name,LS_PROVIDER_INDEX_TEST_ALLOW:"true",LS_CALENDAR_TEST_ALLOW:"true"}});
  expect(result.stdout).toContain(`R35_BROWSER_ACCEPTANCE_PASS project=${info.project.name}`);console.log(result.stdout);
 });
}else{
 const data=JSON.parse(readFileSync(runtimePath,"utf8")) as Runtime,selected=process.env.LS_PROVIDER_INDEX_TEST_PROJECT;
 if(!["https://localhost:3125","https://localhost:3126","https://localhost:3127"].includes(data.origin)||!selected)throw new Error("R35_BROWSER_ORIGIN_NOT_ISOLATED");
 test.use({baseURL:data.origin});
 for(const locale of ["en","he"] as const)test(`owner ${locale}: save, reload, find and case referral`,async({page,context},info)=>{
  await context.addCookies([{name:"__Host-ls-session",value:data.owner,url:data.origin,httpOnly:true,secure:true,sameSite:"Lax"}]);
  const name=`R35 ${info.project.name}-${locale} Provider`,service=locale==="he"?"הדרכת הורים סינתטית":"Synthetic parent coaching",location=locale==="he"?"אזור סינתטי":"Synthetic area";
  const response=await page.goto(`/${locale}/app/providers`);expect(response?.status()).toBe(200);await expect(page.getByRole("heading",{name:locale==="he"?"מאגר נותני שירות פרטי":"Private provider index",exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.keyboard.press("Tab");expect(await page.evaluate(()=>document.activeElement?.tagName)).not.toBe("BODY");
  await page.getByRole("button",{name:locale==="he"?"הוספת נותן שירות":"Add provider",exact:true}).click();
  await page.getByLabel(locale==="he"?"שם נותן השירות / העסק":"Provider / practice name").fill(name);await page.getByLabel(locale==="he"?"שירותים (שירות אחד בכל שורה)":"Services (one per line)").fill(service);
    await page.getByRole("textbox",{name:locale==="he"?"מיקום / אזור שירות":"Location / service area",exact:true}).fill(location);await page.getByLabel(locale==="he"?"אתר":"Website").fill(`https://${info.project.name}-${locale}.example.test/`);
  await page.getByLabel(locale==="he"?"הערות פרטיות על נותן השירות":"Private provider notes").fill(locale==="he"?"הערה סינתטית לא קלינית":"Synthetic nonclinical note");
  await page.getByRole("button",{name:locale==="he"?"שמירת נותן השירות":"Save provider",exact:true}).click();const editor=page.getByRole("region",{name:locale==="he"?"פתיחה":"Open",exact:true});await expect(editor.getByRole("status")).toContainText(locale==="he"?"נשמר":"Saved");
  await page.reload();await expect(page.getByRole("heading",{name,exact:true})).toBeVisible();
  await page.getByLabel(locale==="he"?"חיפוש נותן שירות":"Find a provider").fill(name);await page.getByRole("button",{name:locale==="he"?"חיפוש":"Search",exact:true}).click();await expect(page.getByRole("heading",{name,exact:true})).toHaveCount(1);
  await page.goto(`/${locale}/app/cases/${data.caseId}/provider-referrals`);const card=page.locator("li").filter({hasText:name});await card.getByRole("button",{name:locale==="he"?"פתיחה":"Open",exact:true}).click();
  await page.getByRole("button",{name:locale==="he"?"תיעוד הקשר להפניה":"Record referral context",exact:true}).click();const referral=locale==="he"?"תיאום סינתטי ללא מידע קליני":"Synthetic coordination without clinical information";
  await page.getByLabel(locale==="he"?"הקשר תיאומי כללי":"Neutral coordination context").fill(referral);await page.getByLabel(locale==="he"?"הפעולה הבאה":"Next action").fill(locale==="he"?"מעקב סינתטי":"Synthetic follow-up");
  const referralRegion=page.getByRole("region",{name:locale==="he"?"תיאום הפניה פרטי":"Private referral coordination",exact:true});await page.getByRole("button",{name:locale==="he"?"שמירת הפניה פרטית":"Save private referral",exact:true}).click();await expect(referralRegion.getByRole("status")).toContainText(locale==="he"?"נשמר":"Saved");await page.reload();
  const reloaded=page.locator("li").filter({hasText:name});await reloaded.getByRole("button",{name:locale==="he"?"פתיחה":"Open",exact:true}).click();await expect(page.getByText(referral,{exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:info.outputPath(`r35-${locale}-${info.project.name}.png`),fullPage:true});
 });
 test("parent sees the maintained denial state and cannot call either API",async({page,context},info)=>{
  await context.addCookies([{name:"__Host-ls-session",value:data.parent,url:data.origin,httpOnly:true,secure:true,sameSite:"Lax"}]);
  for(const locale of ["en","he"] as const){await page.goto(`/${locale}/app/providers`);await expect(page.getByRole("heading",{name:locale==="he"?"העמוד אינו זמין":"Page unavailable",exact:true})).toBeVisible();expect(await page.locator("body").innerText()).not.toContain(`R35 ${info.project.name}-${locale} Provider`);}
  const session=await page.request.get(`${data.origin}/api/identity/session`),csrf=(await session.json()).data.csrfToken;
  for(const surface of ["provider-index","provider-referrals"]){const denied=await page.request.post(`${data.origin}/api/${surface}`,{headers:{Origin:data.origin,"X-CSRF-Token":csrf},data:surface==="provider-index"?{action:"search",query:{}}:{action:"list",providerId:"00000000-0000-4000-8000-000000000000",caseId:null}});expect([403,404]).toContain(denied.status());expect(await denied.text()).not.toContain("R35 ");}
 });
}
