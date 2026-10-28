/** Actual retained Next routes, disposable PostgreSQL and ordinary synthetic
 * password login. The sole response fault follows a real committed POST. */
import {execFile} from "node:child_process";
import {readFileSync} from "node:fs";
import {createHash,randomUUID} from "node:crypto";
import {promisify} from "node:util";
import {expect,test,type BrowserContext,type Page,type Locator} from "@playwright/test";
import {syntheticChildFailure} from "../group-interest/synthetic-child-output.ts";
import type {AcademyCrmBrowserRuntime} from "./academy-crm-fixture.ts";

const runtimePath=process.env.LS_GROUP_INTEREST_FIXTURE_PATH;
if(!runtimePath){
 test("Academy CRM ordinary-owner journey through the retained isolated harness",async({},info)=>{
  test.setTimeout(300000);
  const project=info.project.name==="mobile"?"mobile390":info.project.name;
  const result=await promisify(execFile)(process.execPath,["--conditions=react-server","--import","tsx","tests/e2e/group-interest/run.ts"],{
   timeout:270000,maxBuffer:2*1024*1024,env:{...process.env,LS_GROUP_INTEREST_TEST_PROJECT:project,
    LS_GROUP_INTEREST_TEST_ALLOW:"true",LS_CALENDAR_TEST_ALLOW:"true",LS_ACADEMY_CRM_UI_ONLY:"true"}})
   .catch(error=>{throw Error(syntheticChildFailure(error));});
  expect(result.stdout).toContain("ACADEMY_CRM_UI_ACCEPTANCE_PASS project="+project);
 });
}else{
 const runtime=JSON.parse(readFileSync(runtimePath,"utf8")) as {origin:string;academyCrm:AcademyCrmBrowserRuntime};
 if(process.env.LS_ACADEMY_CRM_UI_ONLY!=="true"||!/^https:\/\/localhost:310[5678]$/.test(runtime.origin)||!runtime.academyCrm)
  throw Error("ACADEMY_CRM_ISOLATED_FIXTURE_REQUIRED");
 const fixture=runtime.academyCrm;
 test.use({baseURL:runtime.origin});
 const remoteRequests=new WeakMap<BrowserContext,string[]>();
 async function guard(context:BrowserContext){
  const blocked:string[]=[];remoteRequests.set(context,blocked);
  await context.route("**/*",async route=>{
   const url=new URL(route.request().url());
   if(url.origin===runtime.origin)return route.continue();
   blocked.push(url.origin);await route.abort("blockedbyclient");
  });
 }
 test.beforeEach(async({context})=>{await guard(context);});
 test.afterEach(async({context})=>{expect(remoteRequests.get(context)??[]).toEqual([]);});
 const t=(locale:"en"|"he",en:string,he:string)=>locale==="he"?he:en;
 const details=(page:Page,locale:"en"|"he")=>page.getByRole("region",{name:t(locale,"Contact details","פרטי איש קשר"),exact:true});
 const contactList=(page:Page,locale:"en"|"he")=>page.getByRole("region",{name:t(locale,"Academy contact list","רשימת אנשי האקדמיה"),exact:true});
 async function login(page:Page,locale:"en"|"he",target:string,role:"practitioner"|"parent"="practitioner"){
  const credentials=fixture.credentials.find(value=>value.role===role)!;
  await page.goto(runtime.origin+"/"+locale+"/login?next="+encodeURIComponent(target));
  await page.getByLabel(t(locale,"Email","דוא״ל"),{exact:true}).fill(credentials.email);
  await page.getByLabel(t(locale,"Password","סיסמה"),{exact:true}).fill(credentials.password);
  const response=page.waitForResponse(value=>new URL(value.url()).pathname==="/api/identity/login"&&value.request().method()==="POST");
  await page.getByRole("button",{name:t(locale,"Sign in","כניסה"),exact:true}).click();
  expect((await response).status()).toBe(200);
  if(role==="practitioner")await expect(page).toHaveURL(runtime.origin+target);
  else await expect(page).toHaveURL(new RegExp("/"+locale+"/family"));
 }
 async function submit(page:Page,button:Locator,action:string){
  const response=page.waitForResponse(value=>new URL(value.url()).pathname==="/api/private/academy-crm"&&
   value.request().method()==="POST"&&value.request().postDataJSON()?.action===action);
  await button.click();const saved=await response;expect(saved.status()).toBe(200);
  return (await saved.json()).data as {personId:string;authorityEpoch:number};
 }

 for(const locale of["en","he"]as const)test(locale+": inquiry, uncertain save replay, next action, conversation, new session and contact isolation",async({page,browser},info)=>{
  const inquiry=fixture.inquiries.find(value=>value.locale===locale)!;
  const inquiryPath="/"+locale+"/app/clients?inquiryId="+inquiry.id;
  await login(page,locale,inquiryPath);
  const panel=details(page,locale);
  await expect(panel.getByRole("heading",{name:t(locale,"Add this Academy inquiry","הוספת הפנייה לאקדמיה"),exact:true})).toBeVisible();
  await expect(panel.getByLabel(t(locale,"Email","דוא״ל"),{exact:true})).toHaveValue(inquiry.email);
  await expect(panel.getByLabel(t(locale,"Phone","טלפון"),{exact:true})).toHaveValue("");
  const payloads:string[]=[];let lost=false,personId="";
  await page.route("**/api/private/academy-crm",async route=>{
   const request=route.request();if(request.method()!=="POST"||request.postDataJSON()?.action!=="from_inquiry")return route.continue();
   payloads.push(request.postData()!);
   const committed=await route.fetch();expect(committed.status()).toBe(200);
   const result=(await committed.json()).data;personId=result.personId;
   if(!lost){lost=true;await route.abort("failed");}else{expect(result.replayed).toBe(true);await route.fulfill({response:committed});}
  });
  await panel.getByRole("button",{name:t(locale,"Add to Academy CRM","הוספה לרשימת האקדמיה"),exact:true}).click();
  const retry=page.getByRole("button",{name:t(locale,"Retry the same save","ניסיון חוזר לאותה שמירה"),exact:true});
  await expect(retry).toBeVisible();
  await expect(page.getByRole("button",{name:t(locale,"Search","חיפוש"),exact:true})).toBeDisabled();
  await expect(page.getByRole("button",{name:t(locale,"Add contact","הוספת איש קשר"),exact:true})).toBeDisabled();
  await retry.click();
  await expect(panel.getByRole("heading",{name:inquiry.name,exact:true})).toBeVisible();
  expect(payloads).toHaveLength(2);
  expect(createHash("sha256").update(payloads[0]!).digest("hex")).toBe(createHash("sha256").update(payloads[1]!).digest("hex"));
  await expect(retry).toHaveCount(0);await page.unrouteAll({behavior:"wait"});
  const nextAction=t(locale,"Send available Sunday dates","שליחת מועדי יום ראשון אפשריים");
  const conversation=t(locale,"Synthetic parent asked about the Sunday group.","הורה סינתטי שאל על קבוצת יום ראשון.");
  await panel.getByLabel(t(locale,"Next action","הפעולה הבאה"),{exact:true}).fill(nextAction);
  await panel.getByLabel(t(locale,"Follow-up date","תאריך מעקב"),{exact:true}).fill("2026-12-01");
  await submit(page,panel.getByRole("button",{name:t(locale,"Save changes","שמירת שינויים"),exact:true}),"update");
  await expect(panel.getByRole("button",{name:t(locale,"Save changes","שמירת שינויים"),exact:true})).toBeEnabled();
  await panel.getByLabel(t(locale,"Record a conversation note","תיעוד סיכום שיחה"),{exact:true}).fill(conversation);
  await submit(page,panel.getByRole("button",{name:t(locale,"Save note","שמירת סיכום"),exact:true}),"note");
  await expect(panel.getByLabel(t(locale,"Record a conversation note","תיעוד סיכום שיחה"),{exact:true})).toHaveValue("");
  await expect(panel.getByText(conversation,{exact:true})).toBeVisible();
  // The original inquiry link resolves its exact existing contact, not another
  // Add form or an endpoint-based identity merge.
  await page.goto(runtime.origin+inquiryPath);
  await expect(panel.getByRole("heading",{name:inquiry.name,exact:true})).toBeVisible();
  await expect(panel.getByRole("button",{name:t(locale,"Add to Academy CRM","הוספה לרשימת האקדמיה"),exact:true})).toHaveCount(0);
  await expect(panel.getByLabel(t(locale,"Next action","הפעולה הבאה"),{exact:true})).toHaveValue(nextAction);
  await page.goto(runtime.origin+"/"+locale+"/app/clients?personId="+personId);await page.reload();
  await expect(panel.getByText(conversation,{exact:true})).toBeVisible();
  const other=await browser.newContext({ignoreHTTPSErrors:true,viewport:page.viewportSize()??{width:1440,height:1000}});
  await guard(other);
  try{
   const reopened=await other.newPage();await login(reopened,locale,"/"+locale+"/app/clients?personId="+personId);
   await expect(details(reopened,locale).getByLabel(t(locale,"Next action","הפעולה הבאה"),{exact:true})).toHaveValue(nextAction);
   await expect(details(reopened,locale).getByText(conversation,{exact:true})).toBeVisible();
   expect(remoteRequests.get(other)).toEqual([]);
  }finally{await other.close();}
  await page.getByRole("button",{name:t(locale,"Add contact","הוספת איש קשר"),exact:true}).click();
  const manualName=t(locale,"Synthetic manual Academy EN","איש קשר סינתטי נוסף"),manualEmail="synthetic-crm-manual-"+locale+"@example.invalid";
  await panel.getByLabel(t(locale,"Name","שם"),{exact:true}).fill(manualName);
  await panel.getByLabel(t(locale,"Email","דוא״ל"),{exact:true}).fill(manualEmail);
  const manual=await submit(page,panel.getByRole("button",{name:t(locale,"Add to Academy CRM","הוספה לרשימת האקדמיה"),exact:true}),"create");
  await expect(panel.getByRole("heading",{name:manualName,exact:true})).toBeVisible();
  await contactList(page,locale).getByRole("button",{name:inquiry.name,exact:true}).click();
  await expect(panel.getByRole("heading",{name:inquiry.name,exact:true})).toBeVisible();
  await panel.getByLabel(t(locale,"Record a conversation note","תיעוד סיכום שיחה"),{exact:true}).fill("UNSAVED_CONTACT_NOTE_"+locale);
  await contactList(page,locale).getByRole("button",{name:manualName,exact:true}).click();
  await expect(panel.getByRole("heading",{name:manualName,exact:true})).toBeVisible();
  await expect(panel.getByLabel(t(locale,"Record a conversation note","תיעוד סיכום שיחה"),{exact:true})).toHaveValue("");
  const manualRead=await page.request.get(runtime.origin+"/api/private/academy-crm?personId="+manual.personId+"&expectedEpoch=1");
  expect(manualRead.status()).toBe(200);expect(JSON.stringify(await manualRead.json())).not.toContain("UNSAVED_CONTACT_NOTE_");
  await expect(page.locator("main.academy-crm")).toHaveAttribute("dir",locale==="he"?"rtl":"ltr");
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.locator("main.academy-crm").screenshot({path:info.outputPath("academy-crm-"+locale+"-"+info.project.name+".png")});
  await expect(page.locator("main.academy-crm")).not.toContainText(fixture.retired.name);
  const denied=await page.request.get(runtime.origin+"/api/private/academy-crm?personId="+fixture.retired.personId+"&expectedEpoch=1");
  expect(denied.status()).toBe(404);expect(await denied.text()).not.toContain(fixture.retired.marker);
  const search=await page.request.get(runtime.origin+"/api/private/academy-crm?search="+encodeURIComponent(fixture.retired.name));
  expect(search.status()).toBe(200);expect((await search.json()).data).toMatchObject({total:0,items:[]});
 });

 test("ordinary parent login cannot read, mutate or render Academy contacts",async({page})=>{
  await login(page,"en","/en/app/clients","parent");
  const list=await page.request.get(runtime.origin+"/api/private/academy-crm");
  expect(list.status()).toBe(403);expect(await list.text()).not.toContain(fixture.inquiries[0]!.name);
  const session=await (await page.request.get(runtime.origin+"/api/identity/session")).json();
  const denied=await page.request.post(runtime.origin+"/api/private/academy-crm",{headers:{origin:runtime.origin,"sec-fetch-site":"same-origin","x-csrf-token":session.data.csrfToken},
   data:{action:"note",operationId:randomUUID(),expectedEpoch:1,personId:fixture.retired.personId,expectedVersion:1,text:"DENIED_PARENT_NOTE"}});
  expect(denied.status()).toBe(403);
  await page.goto(runtime.origin+"/en/app/clients");
  await expect(page.getByRole("heading",{name:"Academy people",exact:true})).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(fixture.inquiries[0]!.name);
 });

 test("revoked ordinary session hides cached contacts and drafts when Save checks its session",async({page})=>{
  const inquiry=fixture.inquiries[0]!;
  await login(page,"en","/en/app/clients?inquiryId="+inquiry.id);
  const panel=details(page,"en");await expect(panel.getByRole("heading",{name:inquiry.name,exact:true})).toBeVisible();
  await panel.getByLabel("Record a conversation note",{exact:true}).fill("UNSAVED_CONTACT_NOTE_REVOKED");
  const session=await (await page.request.get(runtime.origin+"/api/identity/session")).json();
  const loggedOut=await page.request.post(runtime.origin+"/api/identity/logout",{headers:{origin:runtime.origin,"sec-fetch-site":"same-origin","x-csrf-token":session.data.csrfToken},data:{}});
  expect(loggedOut.status()).toBe(200);
  await panel.getByRole("button",{name:"Save note",exact:true}).click();
  await expect(page.locator("main.academy-crm").getByRole("alert")).toContainText("Your session ended");
  await expect(page.locator("main.academy-crm").getByRole("link",{name:"Sign in",exact:true})).toBeVisible();
  await expect(page.locator("main.academy-crm")).not.toContainText(inquiry.name);
  await expect(page.locator("main.academy-crm")).not.toContainText("UNSAVED_CONTACT_NOTE_REVOKED");
  await expect(page.getByRole("region",{name:"Academy contact list",exact:true})).toHaveCount(0);
  await expect(page.getByRole("button",{name:"Retry the same save",exact:true})).toHaveCount(0);
 });
}
