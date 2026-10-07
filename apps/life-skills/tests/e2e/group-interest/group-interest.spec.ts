/** Mounted authenticated synthetic browser acceptance. No request interception or API mocking. */
import {expect,test} from "@playwright/test";
import {execFile} from "node:child_process";
import {randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import {promisify} from "node:util";
type Runtime={origin:string;workspaceId:string;practitioner:string;parent:string};
const runtimePath=process.env.LS_GROUP_INTEREST_FIXTURE_PATH;
if(!runtimePath){
 if(process.env.LS_GROUP_INTEREST_TEST_RUNNER_ACTIVE==="true")throw new Error("ISOLATED_GROUP_INTEREST_FIXTURE_REQUIRED");
 test("isolated Group Intake authenticated journeys for the current browser project",async({},info)=>{
  test.setTimeout(240_000);if(!["desktop","mobile390","mobile340"].includes(info.project.name))throw new Error("GROUP_INTEREST_BROWSER_PROJECT_NOT_SUPPORTED");
  const result=await promisify(execFile)(process.execPath,["--import","tsx","tests/e2e/group-interest/run.ts"],{timeout:210_000,maxBuffer:2*1024*1024,
   env:{...process.env,LS_GROUP_INTEREST_TEST_PROJECT:info.project.name,LS_GROUP_INTEREST_TEST_ALLOW:"true",LS_CALENDAR_TEST_ALLOW:"true"}});
  expect(result.stdout).toContain(`GROUP_INTEREST_ACCEPTANCE_PASS project=${info.project.name}`);console.log(result.stdout);
 });
}else{
 const data=JSON.parse(readFileSync(runtimePath,"utf8")) as Runtime;
 if(!["https://localhost:3105","https://localhost:3106","https://localhost:3107"].includes(data.origin))throw new Error("GROUP_INTEREST_BROWSER_ORIGIN_NOT_ISOLATED");
 const selected=process.env.LS_GROUP_INTEREST_TEST_PROJECT;
 const ports:Record<string,number>={desktop:3105,mobile390:3106,mobile340:3107};if(selected!==undefined&&data.origin!==`https://localhost:${ports[selected]}`)throw new Error("GROUP_INTEREST_BROWSER_PROJECT_ORIGIN_MISMATCH");
 test.use({baseURL:data.origin});
 for(const locale of ["en","he"] as const)test(`practitioner ${locale}: save, exact replay, rejection, reload and responsive readback`,async({page,context},info)=>{
  await context.addCookies([{name:"__Host-ls-session",value:data.practitioner,url:data.origin,httpOnly:true,secure:true,sameSite:"Lax"}]);
  const initialRead=page.waitForResponse(response=>response.request().method()==="GET"&&new URL(response.url()).pathname==="/api/private/group-interest");
  const response=await page.goto(`/${locale}/app/group-interest`);expect(response?.status()).toBe(200);expect((await initialRead).status()).toBe(200);
  const main=page.locator("main");await expect(main).toHaveAttribute("dir",locale==="he"?"rtl":"ltr");
  await expect(page.getByRole("heading",{name:locale==="he"?"התעניינות בקבוצה ובתגבור":"Group and tutoring interest",exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  const skip=page.locator(".lsu-skip"),skipState=async()=>skip.evaluate(element=>{const rect=element.getBoundingClientRect();return {active:document.activeElement===element,top:rect.top,bottom:rect.bottom,scrollY,intersects:rect.bottom>0&&rect.top<innerHeight};});
  const resting=await skipState();expect(resting.active).toBe(false);expect(resting.intersects).toBe(false);expect(resting.bottom).toBeLessThanOrEqual(0);
  await page.keyboard.press("Tab");await expect(skip).toBeFocused();const focused=await skipState();expect(focused.intersects).toBe(true);expect(focused.top).toBeGreaterThanOrEqual(0);await page.screenshot({path:info.outputPath(`group-interest-skip-focused-${locale}-${info.project.name}.png`)});
  await page.keyboard.press("Enter");await expect(page.locator("#lsw-main")).toBeFocused();
  const suffix=`${info.project.name}-${locale}`,parentName=`Synthetic ${suffix} Parent`,childLabel=`Synthetic ${suffix} Child`;
  await page.locator('[name="serviceType"]').selectOption(locale==="he"?"group":"group_and_tutoring");
  await page.locator('[name="parentName"]').fill(parentName);await page.locator('[name="parentPhone"]').fill(locale==="he"?"+972500001111":"+15550001111");
  await page.locator('[name="language"]').selectOption(locale);await page.locator('[name="childLabel"]').fill(childLabel);await page.locator('[name="childAge"]').fill(locale==="he"?"9":"11");
  await page.locator('[name="area"]').fill(locale==="he"?"אזור בדיקה סינתטי":"Synthetic test area");await page.locator('[name="availability"]').fill(locale==="he"?"יום ראשון אחר הצהריים":"Sunday afternoon");
  await page.locator('[name="groupPreference"]').fill(locale==="he"?"קבוצה קטנה":"Small group");await page.locator('[name="permissionSource"]').selectOption("spoken");
  await page.locator('[name="permissionLanguage"]').selectOption(locale);await expect(page.locator('[name="permission"]')).toBeEnabled();await page.locator('[name="permission"]').check();
  const postRequest=page.waitForRequest(request=>request.method()==="POST"&&new URL(request.url()).pathname==="/api/private/group-interest");
  const postResponse=page.waitForResponse(response=>response.request().method()==="POST"&&new URL(response.url()).pathname==="/api/private/group-interest");
  await page.getByRole("button",{name:locale==="he"?"שמירת התעניינות":"Save interest",exact:true}).click();
  const sent=await postRequest,saved=await postResponse;expect(saved.status()).toBe(200);const savedBody=await saved.json();expect(savedBody).toMatchObject({ok:true,data:{saved:true,replayed:false,item:{fields:{parentName,childLabel}}}});
  await expect(page.getByRole("status")).toHaveText(locale==="he"?"הפנייה נשמרה ונקראה בחזרה ממסד הנתונים של האפליקציה.":"Inquiry saved and read back from the app database.");
  await expect(page.getByRole("heading",{name:`${parentName} — ${childLabel}`,exact:true})).toHaveCount(1);
  const phoneToken=page.locator("article").filter({hasText:parentName}).locator("bdi");await expect(phoneToken).toHaveText(locale==="he"?"+972500001111":"+15550001111");await expect(phoneToken).toHaveAttribute("dir","ltr");expect(await phoneToken.evaluate(element=>({direction:getComputedStyle(element).direction,bidi:getComputedStyle(element).unicodeBidi}))).toEqual({direction:"ltr",bidi:"isolate"});
  const body=sent.postDataJSON(),csrf=sent.headers()["x-csrf-token"];expect(csrf).toBeTruthy();
  const replay=await page.request.post(`${data.origin}/api/private/group-interest`,{headers:{Origin:data.origin,"X-CSRF-Token":csrf!},data:body});
  expect(replay.status()).toBe(200);expect(await replay.json()).toMatchObject({ok:true,data:{saved:true,replayed:true,duplicate:true,item:{id:savedBody.data.item.id}}});
  const stale=structuredClone(body);stale.operationId=randomUUID();stale.fields.parentName=`Stale ${parentName}`;stale.fields.permission.version="stale-version";
  const rejected=await page.request.post(`${data.origin}/api/private/group-interest`,{headers:{Origin:data.origin,"X-CSRF-Token":csrf!},data:stale});expect(rejected.status()).toBe(400);
  await page.reload();await expect(page.getByRole("heading",{name:`${parentName} — ${childLabel}`,exact:true})).toHaveCount(1);await expect(page.getByText(`Stale ${parentName}`,{exact:false})).toHaveCount(0);
  const unsaved=`Unsaved ${parentName}`;await page.locator('[name="parentName"]').fill(unsaved);await page.locator('[name="childLabel"]').fill(`Unsaved ${childLabel}`);await page.locator('[name="childAge"]').fill("8");
  await page.locator('[name="parentPhone"]').fill("+15550002222");await page.locator('[name="permissionSource"]').selectOption("written");await page.locator('[name="permissionLanguage"]').selectOption(locale);
  await page.getByRole("button",{name:locale==="he"?"שמירת התעניינות":"Save interest",exact:true}).click();
  await expect(page.locator('[name="permission"]')).not.toBeChecked();await expect(page.locator('[name="parentName"]')).toHaveValue(unsaved);
  const afterInvalid=await skipState();expect(afterInvalid.active).toBe(false);expect(afterInvalid.intersects).toBe(false);expect(afterInvalid.bottom).toBeLessThanOrEqual(0);expect(await page.evaluate(()=>document.activeElement?.getAttribute("name"))).toBe("permission");
  await page.screenshot({path:info.outputPath(`group-interest-${locale}-${info.project.name}.png`),fullPage:true});
 });
 test("parent is denied the owner-only page and API without disclosure",async({page,context},info)=>{
  await context.addCookies([{name:"__Host-ls-session",value:data.parent,url:data.origin,httpOnly:true,secure:true,sameSite:"Lax"}]);
  for(const locale of ["en","he"]){const denied=await page.goto(`/${locale}/app/group-interest`);expect([200,404]).toContain(denied?.status());await expect(page.getByRole("heading",{name:locale==="he"?"העמוד אינו זמין":"Page unavailable",exact:true})).toBeVisible();await expect(page.getByRole("heading",{name:/Group and tutoring interest|התעניינות בקבוצה ובתגבור/})).toHaveCount(0);await expect(page.locator('form')).toHaveCount(0);expect(await page.locator("body").innerText()).not.toContain(`Synthetic ${info.project.name}-${locale} Parent`);}
  const api=await page.request.get(`${data.origin}/api/private/group-interest`);expect(api.status()).toBe(403);expect(await api.text()).not.toContain("Synthetic");
 });
}
