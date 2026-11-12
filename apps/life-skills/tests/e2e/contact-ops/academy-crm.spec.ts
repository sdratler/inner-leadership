/** Actual retained Next routes, disposable PostgreSQL and ordinary synthetic
 * password login. The sole response fault follows a real committed POST. */
import {execFile} from "node:child_process";
import {readFileSync} from "node:fs";
import {createHash,randomUUID} from "node:crypto";
import {promisify} from "node:util";
import {expect,test,type BrowserContext,type Page,type Locator} from "@playwright/test";
import {syntheticChildFailure} from "../group-interest/synthetic-child-output.ts";
import type {AcademyCrmBrowserRuntime} from "./academy-crm-fixture.ts";
import {SESSION_COOKIE} from "../../../src/lib/security/session.ts";

const runtimePath=process.env.LS_GROUP_INTEREST_FIXTURE_PATH;
if(!runtimePath){
 test("Academy CRM ordinary-owner journey through the retained isolated harness",async({},info)=>{
  test.setTimeout(300000);
  const project=info.project.name==="mobile"?"mobile390":info.project.name;
  const result=await promisify(execFile)(process.execPath,["--conditions=react-server","--import","tsx","tests/e2e/group-interest/run.ts"],{
   timeout:270000,maxBuffer:2*1024*1024,env:{...process.env,LS_GROUP_INTEREST_TEST_PROJECT:project,
    LS_GROUP_INTEREST_TEST_ALLOW:"true",LS_CALENDAR_TEST_ALLOW:"true",LS_ACADEMY_CRM_UI_ONLY:"true"}})
   .catch(error=>{
    // The parent run can reach its fixed deadline before Playwright prints
    // its final failure report. Emit the existing bounded/redacted diagnostic
    // immediately, then preserve the same failed child result.
    const diagnostic=syntheticChildFailure(error);
    console.error(diagnostic);
    throw Error(diagnostic);
   });
  expect(result.stdout).toContain("ACADEMY_CRM_UI_ACCEPTANCE_PASS project="+project);
 });
}else{
 const runtime=JSON.parse(readFileSync(runtimePath,"utf8")) as {origin:string;parent:string;academyCrm:AcademyCrmBrowserRuntime};
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
  const result=await response;
  expect(result.status()).toBe(role==="practitioner"?200:401);
  if(role==="practitioner")await expect(page).toHaveURL(runtime.origin+target);
  else{
   // The selected owner runtime rejects valid historical parent credentials,
   // rather than opening a parent portal or issuing an owner session.
   expect(await result.headerValue("set-cookie")).toBeNull();
   await expect(page).toHaveURL(runtime.origin+"/"+locale+"/login?next="+encodeURIComponent(target));
  }
 }
 async function ownerFrame(page:Page,locale:"en"|"he"){
  const shell=page.locator('[data-fishing-owner-shell="true"]'),nav=shell.locator('[data-fishing-owner-navigation="true"]');
  await expect(shell).toHaveAttribute("dir",locale==="he"?"rtl":"ltr");
  await expect(nav).toHaveCount(1);
  const hrefs=await nav.locator("a").evaluateAll(links=>links.map(link=>link.getAttribute("href")).sort());
  expect(hrefs).toEqual(["clients","fishing-groups","group-applications","marketing","settings"].map(path=>"/"+locale+"/app/"+path).sort());
  await expect(nav.locator('[data-availability="unavailable"] a,[data-availability="unavailable"] button')).toHaveCount(0);
 }
 async function selectedOwnerRoutes(page:Page,locale:"en"|"he",returnPath:string){
  const owner=fixture.credentials.find(value=>value.role==="practitioner")!;
  await ownerFrame(page,locale);
  const nav=page.locator('[data-fishing-owner-navigation="true"]');
  const mobileToggle=nav.getByRole("button");
  if(await mobileToggle.isVisible()){
   await expect(mobileToggle).toHaveAccessibleName(t(locale,"Show work areas: Families & contacts","הצגת אזורי העבודה: משפחות ואנשי קשר"));
   await expect(mobileToggle).toHaveAttribute("aria-expanded","false");
   await mobileToggle.press("Space");
   await expect(mobileToggle).toHaveAttribute("aria-expanded","true");
   await expect(mobileToggle).toHaveAccessibleName(t(locale,"Hide work areas: Families & contacts","הסתרת אזורי העבודה: משפחות ואנשי קשר"));
  }
  await nav.locator('[data-fishing-owner-destination="settings"]').click();
  await expect(page).toHaveURL(runtime.origin+"/"+locale+"/app/settings");
  await ownerFrame(page,locale);
  const heading=page.getByRole("heading",{name:t(locale,"Settings","הגדרות"),exact:true});
  await expect(heading).toBeVisible();
  const headingBox=await heading.boundingBox(),viewport=page.viewportSize();
  if(!headingBox||!viewport)throw Error("OWNER_SETTINGS_INITIAL_VIEWPORT_REQUIRED");
  expect(headingBox.y).toBeGreaterThanOrEqual(0);
  expect(headingBox.y+headingBox.height).toBeLessThanOrEqual(viewport.height);
  await expect(page.locator("main").getByText(owner.email,{exact:true})).toBeVisible();
  await expect(page.locator("main").getByText(fixture.credentials.find(value=>value.role==="parent")!.email,{exact:true})).toHaveCount(0);
  const contacts=await page.request.get(runtime.origin+"/api/identity/contacts");
  expect(contacts.status()).toBe(200);
  expect((await contacts.json()).data).toEqual({email:owner.email,emailVerified:true,phone:null,phoneVerified:false});
  const groups=page.waitForResponse(value=>new URL(value.url()).pathname==="/api/private/fishing-group-preparations"&&value.request().method()==="GET");
  await page.goto(runtime.origin+"/"+locale+"/app/fishing-groups");
  const groupRead=await groups;expect(groupRead.status()).toBe(200);
  expect((await groupRead.json()).data).toMatchObject({kind:"list",page:{items:[]}});
  await expect(page.getByRole("heading",{name:t(locale,"Group preparation","הכנת קבוצות"),exact:true})).toBeVisible();
  await ownerFrame(page,locale);
  for(const path of["/"+locale+"/app/practice","/"+locale+"/family","/"+locale+"/app/payments",
   "/api/identity/preferences","/api/private/contact-profiles","/api/private/bna-mailbox-replies"]){
   const denied=await page.request.get(runtime.origin+path,{maxRedirects:0});
   expect(denied.status(),path).toBe(404);
   expect(await denied.text()).not.toContain(fixture.retired.marker);
  }
  const calendar=await page.request.get(runtime.origin+"/"+locale+"/app/calendar",{maxRedirects:0});
  expect(calendar.status()).toBe(307);
  const location=calendar.headers().location;
  if(!location)throw Error("OWNER_CALENDAR_REDIRECT_LOCATION_REQUIRED");
  expect(new URL(location,calendar.url()).href).toBe(runtime.origin+"/"+locale+"/app/group-applications");
  await page.goto(runtime.origin+returnPath);
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
  await selectedOwnerRoutes(page,locale,inquiryPath);
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

 test("selected owner runtime denies historical parent credentials and existing parent sessions",async({page,context})=>{
  await login(page,"en","/en/app/clients","parent");
  expect((await context.cookies()).some(value=>value.name===SESSION_COOKIE)).toBe(false);
  // Only the negative case receives the already-existing synthetic parent
  // token. All successful owner journeys still establish ordinary logins.
  expect(runtime.parent).toMatch(/^[A-Za-z0-9_-]{43}$/);
  await context.addCookies([{name:SESSION_COOKIE,value:runtime.parent,url:runtime.origin,httpOnly:true,secure:true,sameSite:"Lax"}]);
  const list=await page.request.get(runtime.origin+"/api/private/academy-crm");
  expect(list.status()).toBe(401);expect(await list.text()).not.toContain(fixture.inquiries[0]!.name);
  const session=await page.request.get(runtime.origin+"/api/identity/session");
  expect(session.status()).toBe(401);
  const denied=await page.request.post(runtime.origin+"/api/private/academy-crm",{headers:{origin:runtime.origin,"sec-fetch-site":"same-origin","x-csrf-token":"synthetic-parent-denied-before-csrf"},
   data:{action:"note",operationId:randomUUID(),expectedEpoch:1,personId:fixture.retired.personId,expectedVersion:1,text:"DENIED_PARENT_NOTE"}});
  expect(denied.status()).toBe(401);
  await page.goto(runtime.origin+"/en/app/clients");
  await expect(page).toHaveURL(new RegExp("^"+runtime.origin.replaceAll(".","\\.")+"/en/login(?:\\?|$)"));
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
