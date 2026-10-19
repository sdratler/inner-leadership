/** Real retained Next pages and native DB, ordinary synthetic login; no data API mock.
 * One controlled response loss occurs after the actual confirm commit. */
import {execFile} from "node:child_process";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {promisify} from "node:util";
import {expect,test} from "@playwright/test";
import {syntheticChildFailure} from "../group-interest/synthetic-child-output.ts";
import inquiryCopy from "../../../src/features/group-application/presentation-copy.json" with {type:"json"};
const runtimePath=process.env.LS_GROUP_INTEREST_FIXTURE_PATH;
if(!runtimePath){
 test("mounted fishing lead controls through existing isolated native harness",async({},info)=>{
  test.setTimeout(240000);const project=info.project.name==="mobile"?"mobile390":info.project.name;
  const result=await promisify(execFile)(process.execPath,["--conditions=react-server","--import","tsx","tests/e2e/group-interest/run.ts"],{timeout:210000,maxBuffer:2*1024*1024,
   env:{...process.env,LS_GROUP_INTEREST_TEST_PROJECT:project,LS_GROUP_INTEREST_TEST_ALLOW:"true",LS_CALENDAR_TEST_ALLOW:"true",LS_FISHING_LEAD_UI_ONLY:"true"}})
   .catch(error=>{throw new Error(syntheticChildFailure(error));});
  expect(result.stdout).toContain("FISHING_LEAD_UI_ACCEPTANCE_PASS project="+project);
 });
}else{
 const runtime=JSON.parse(readFileSync(runtimePath,"utf8")) as {origin:string;fishing:{credentials:{role:string;email:string;password:string}[];inquiries:{locale:string;id:string;name:string}[];protectedPersonId:string}};
 if(process.env.LS_FISHING_LEAD_UI_ONLY!=="true"||!/^https:\/\/localhost:310[5678]$/.test(runtime.origin)||!runtime.fishing)throw Error("FISHING_UI_ISOLATED_FIXTURE_REQUIRED");
 test.use({baseURL:runtime.origin});
 for(const locale of ["en","he"] as const)test(`${locale}: anonymous saved inquiry, exact retry, ordinary owner re-login and deliberate lead addition`,async({page},info)=>{
  const t=(en:string,he:string)=>locale==="he"?he:en,copy=inquiryCopy.realMensch.inquiry;
  const name=`Synthetic composed ${locale}`,contact=locale==="en"?"+13055550111":"+13055550112";
  const target=`/${locale}/app/group-applications`,credentials=runtime.fishing.credentials.find(c=>c.role==="practitioner")!;
  expect((await page.request.get("/api/private/group-applications")).status()).toBe(401);
  expect((await page.goto(`/${locale}/florida`))?.status()).toBe(200);
  await page.locator(`a[href="/${locale}/florida/apply"]`).first().click();await expect(page).toHaveURL(`/${locale}/florida/apply`);
  const form=page.locator('form[data-inquiry-kind="parent"]');
  await form.locator('[name="parentName"]').fill(name);await form.locator('[name="contact"]').fill(contact);
  await form.locator('[name="learnerAge-0"]').fill("12");await form.locator('[name="cityArea"]').fill("Synthetic Florida");
  await form.locator('[name="postalCode"]').fill("33021");
  for(const [field,value] of Object.entries({driveLimit:"30",schoolHoursAvailability:"discuss",preferredGroupLanguage:locale,stagePreference:"foundation",keysTravel:"discuss",offshoreInterest:"discuss",nextStep:"callback","learnerGrade-0":"grade_6_8","learnerSchooling-0":"school","learnerTackleBox-0":"need_advice"}))await form.locator(`[name="${field}"]`).selectOption(value);
  await form.locator('[name="schedulePreference"][value="sunday"]').check();await form.locator('[name="permission"]').check();
  const endpoint="**/api/public/group-applications?program=sunday_fishing_academy";
  let savedId="",requestHash="",commits=0;
  // Lose only the response AFTER the real native save. Never fabricate a
  // successful receipt or inject a session to bridge public and private UI.
  await page.route(endpoint,async route=>{
   if(route.request().method()!=="POST")return route.continue();
   requestHash=createHash("sha256").update(route.request().postData()!).digest("hex");
   const upstream=await route.fetch({headers:{...route.request().headers(),origin:runtime.origin,"sec-fetch-site":"same-origin"}});
   expect(upstream.status()).toBe(201);const body=await upstream.json();savedId=body.data.item.id;commits++;
   await route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({ok:false,error:{code:"UNAVAILABLE"}})});
  });
  await form.locator('button[type="submit"]').click();
  await expect(form.getByRole("alert")).toContainText(copy.unknownResult[locale]);expect(commits).toBe(1);expect(savedId).not.toBe("");
  await page.unroute(endpoint);
  const retriedRequest=page.waitForRequest(r=>r.method()==="POST"&&new URL(r.url()).pathname==="/api/public/group-applications");
  const retriedResponse=page.waitForResponse(r=>r.request().method()==="POST"&&new URL(r.url()).pathname==="/api/public/group-applications");
  await form.getByRole("button",{name:copy.retrySameSave[locale],exact:true}).click();
  expect(createHash("sha256").update((await retriedRequest).postData()!).digest("hex")).toBe(requestHash);
  const retried=await retriedResponse;expect(retried.status()).toBe(200);
  expect(await retried.json()).toMatchObject({ok:true,data:{saved:true,replayed:true,duplicate:true,item:{id:savedId,fields:{parentName:name,contact,programId:"sunday_fishing_academy"}}}});
  await expect(form.getByRole("status")).toContainText(t("Inquiry saved","הפנייה נשמרה"));
  const ownerLogin=async()=>{
   await page.goto(`/${locale}/login?next=${encodeURIComponent(target)}`);
   await page.getByLabel(t("Email","דוא״ל"),{exact:true}).fill(credentials.email);
   await page.getByLabel(t("Password","סיסמה"),{exact:true}).fill(credentials.password);
   const login=page.waitForResponse(r=>new URL(r.url()).pathname==="/api/identity/login"&&r.request().method()==="POST",{timeout:30000});
   await page.getByRole("button",{name:t("Sign in","כניסה"),exact:true}).click();expect((await login).status()).toBe(200);
   await expect(page).toHaveURL(target);
  };
  const verifyInquiry=async()=>{
   const read=await page.request.get("/api/private/group-applications");expect(read.status()).toBe(200);
   const body=await read.json();expect(body.data.items.filter((item:{id:string})=>item.id===savedId)).toEqual([
    expect.objectContaining({id:savedId,fields:expect.objectContaining({parentName:name,contact,programId:"sunday_fishing_academy"})})]);
   await expect(page.locator("article").filter({has:page.getByRole("heading",{name,exact:true})})).toHaveCount(1);
  };
  await ownerLogin();await verifyInquiry();await page.reload();await verifyInquiry();
  // Ordinary device sign-out and password sign-in, not clearing/injecting cookies.
  await page.goto(`/${locale}/app/settings/account`);
  const logout=page.waitForResponse(r=>new URL(r.url()).pathname==="/api/identity/logout"&&r.request().method()==="POST");
  await page.getByRole("button",{name:t("Sign out this device","יציאה מהמכשיר הזה"),exact:true}).click();expect((await logout).status()).toBe(200);
  await expect(page).not.toHaveURL(`/${locale}/app/settings/account`);
  expect((await page.request.get("/api/private/group-applications")).status()).toBe(401);
  await ownerLogin();await verifyInquiry();
  const record=page.locator("article").filter({has:page.getByRole("heading",{name,exact:true})});
  const details=record.locator("details").filter({has:page.getByRole("region",{name:t("Fishing lead membership controls","בקרות שיוך לרשימת המתעניינים בדיג"),includeHidden:true})});
  await details.locator("summary").click();await details.getByRole("button",{name:t("Add to Lead List","הוספה לרשימת המתעניינים"),exact:true}).click();
  await expect(details.getByRole("button",{name:t("Confirm Add","אישור הוספה"),exact:true})).toBeDisabled();
  await details.getByRole("checkbox",{name:t("I confirm creation of this new adult contact.","אני מאשר/ת יצירת איש קשר מבוגר חדש זה."),exact:true}).check();
  await details.getByRole("button",{name:t("Confirm Add","אישור הוספה"),exact:true}).click();
  await expect(details.getByRole("status")).toContainText(t("Added to Leads. No follow-up task was created.","נוסף לרשימת המתעניינים. לא נוצרה משימת המשך."));
  const membership=async()=>{
   const read=await page.request.get(`/api/private/fishing-leads/sunday_fishing_academy?source=inquiry&sourceId=${savedId}`);expect(read.status()).toBe(200);
   const body=await read.json();expect(body.data.membership.state).toBe("active");expect(body.data.personId).toBeTruthy();return body.data.personId as string;
  };
  const personId=await membership();await page.reload();await verifyInquiry();expect(await membership()).toBe(personId);
  await details.locator("summary").click();await expect(details.getByRole("button",{name:t("Remove from Lead List","הסרה מרשימת המתעניינים"),exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await record.screenshot({path:info.outputPath(`composed-inquiry-owner-lead-${locale}-${info.project.name}.png`)});
 });
 for(const locale of ["en","he"] as const)test(`${locale}: normal login, preview/cancel, collapsed draft, lost-response retry, Remove and reload`,async({page},info)=>{
  const t=(en:string,he:string)=>locale==="he"?he:en,credentials=runtime.fishing.credentials.find(c=>c.role==="practitioner")!,inquiry=runtime.fishing.inquiries.find(i=>i.locale===locale)!;
  await page.goto(`/${locale}/login?next=${encodeURIComponent(`/${locale}/app/group-applications`)}`);
  await page.getByLabel(t("Email","דוא״ל"),{exact:true}).fill(credentials.email);await page.getByLabel(t("Password","סיסמה"),{exact:true}).fill(credentials.password);
  // Observe the real authentication boundary before asserting navigation. The
  // isolated dev server compiles identity routes on its first ordinary login;
  // a failed HTTP login must remain a failure, not a retried/forced session.
  const loginResponse=page.waitForResponse(response=>new URL(response.url()).pathname==="/api/identity/login"&&response.request().method()==="POST",{timeout:30000});
  await page.getByRole("button",{name:t("Sign in","כניסה"),exact:true}).click();
  expect((await loginResponse).status()).toBe(200);
  await expect(page).toHaveURL(`/${locale}/app/group-applications`);
  const record=page.locator("article").filter({has:page.getByRole("heading",{name:inquiry.name,exact:true})}),details=record.locator("details").filter({has:page.getByRole("region",{name:t("Fishing lead membership controls","בקרות שיוך לרשימת המתעניינים בדיג"),includeHidden:true})});
  await details.locator("summary").focus();await page.keyboard.press("Enter");await expect(details.getByRole("button",{name:t("Add to Lead List","הוספה לרשימת המתעניינים"),exact:true})).toBeVisible();
  await details.getByRole("button",{name:t("Add to Lead List","הוספה לרשימת המתעניינים"),exact:true}).click();await expect(details.getByRole("heading",{name:t("Review lead-list addition","בדיקת הוספה לרשימת המתעניינים"),exact:true})).toBeFocused();
  await details.getByRole("button",{name:t("Cancel","ביטול"),exact:true}).click();await expect(details.getByRole("button",{name:t("Add to Lead List","הוספה לרשימת המתעניינים"),exact:true})).toBeVisible();
  await details.getByRole("button",{name:t("Add to Lead List","הוספה לרשימת המתעניינים"),exact:true}).click();
  await expect(details.getByRole("button",{name:t("Confirm Add","אישור הוספה"),exact:true})).toBeDisabled();
  await details.getByRole("checkbox",{name:t("I confirm creation of this new adult contact.","אני מאשר/ת יצירת איש קשר מבוגר חדש זה."),exact:true}).check();
  await details.locator("summary").click();await details.locator("summary").click();await expect(details.getByRole("checkbox")).toBeChecked();
  let lost=false;const bodies:string[]=[];
  await page.route("**/api/private/fishing-leads/sunday_fishing_academy",async route=>{
   const req=route.request();if(req.method()!=="POST"||req.postDataJSON()?.action!=="confirm")return route.continue();bodies.push(req.postData()!);
   const upstream=await route.fetch();expect(upstream.status()).toBe(200);
   if(!lost){lost=true;await route.abort("failed");}else await route.fulfill({response:upstream});
  });
  await details.getByRole("button",{name:t("Confirm Add","אישור הוספה"),exact:true}).click();await expect(details.getByRole("alert")).toContainText(t("outcome could not be confirmed","לא ניתן לאשר את התוצאה"));
  await expect(details.getByRole("button",{name:t("Cancel","ביטול"),exact:true})).toBeDisabled();
  await details.getByRole("button",{name:t("Retry the same operation","ניסיון נוסף לאותה פעולה"),exact:true}).click();await expect.poll(()=>bodies.length).toBe(2);
  expect(createHash("sha256").update(bodies[0]!).digest("hex")).toBe(createHash("sha256").update(bodies[1]!).digest("hex"));
  await expect(details.getByRole("status")).toContainText(t("Added to Leads. No follow-up task was created.","נוסף לרשימת המתעניינים. לא נוצרה משימת המשך."));await page.unrouteAll({behavior:"wait"});
  await expect(details).toContainText(t("Not configured","לא מוגדר"));expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  // Deliberate Academy-only administrative details, through the real mounted
  // UI and ordinary login. The native readback below must retain them on Remove.
  const leadDetails={status:"follow_up",notes:`Synthetic Academy note ${locale}`,nextAction:"Owner callback",followUpDate:"2026-11-05"};
  await details.getByRole("combobox",{name:t("Academy lead status","מצב המתעניין באקדמיה"),exact:true}).selectOption(leadDetails.status);
  await details.getByRole("textbox",{name:t("Academy notes","הערות לאקדמיה"),exact:true}).fill(leadDetails.notes);
  await details.getByLabel(t("Next Academy action","הפעולה הבאה באקדמיה"),{exact:true}).fill(leadDetails.nextAction);
  await details.getByLabel(t("Follow-up date","תאריך למעקב"),{exact:true}).fill(leadDetails.followUpDate);
  await details.getByRole("button",{name:t("Review details","בדיקת הפרטים"),exact:true}).click();
  await expect(details.getByRole("heading",{name:t("Review Academy lead details","בדיקת פרטי המתעניין באקדמיה"),exact:true})).toBeFocused();
  await expect(details).toContainText(leadDetails.notes);
  await details.getByRole("button",{name:t("Confirm Save","אישור שמירה"),exact:true}).click();
  await expect(details.getByRole("status")).toContainText(t("Academy lead details saved. No task or message was created.","פרטי המתעניין באקדמיה נשמרו. לא נוצרו משימה או הודעה."));
  await page.reload();await details.locator("summary").click();
  await expect(details.getByRole("combobox",{name:t("Academy lead status","מצב המתעניין באקדמיה"),exact:true})).toHaveValue(leadDetails.status);
  await expect(details.getByRole("textbox",{name:t("Academy notes","הערות לאקדמיה"),exact:true})).toHaveValue(leadDetails.notes);
  await expect(details.getByLabel(t("Next Academy action","הפעולה הבאה באקדמיה"),{exact:true})).toHaveValue(leadDetails.nextAction);
  await expect(details.getByLabel(t("Follow-up date","תאריך למעקב"),{exact:true})).toHaveValue(leadDetails.followUpDate);
  await record.screenshot({path:info.outputPath(`fishing-added-${locale}-${info.project.name}.png`)});
  await details.getByRole("button",{name:t("Remove from Lead List","הסרה מרשימת המתעניינים"),exact:true}).click();await details.getByRole("button",{name:t("Confirm Remove","אישור הסרה"),exact:true}).click();
  await expect(details.getByRole("status")).toContainText(t("Contact and history retained.","פרטי הקשר וההיסטוריה נשמרו."));
  await page.reload();await details.locator("summary").click();await expect(details).toContainText(t("Removed","הוסר"));await expect(details.getByRole("button",{name:t("Add to Lead List","הוספה לרשימת המתעניינים"),exact:true})).toBeVisible();
  await record.screenshot({path:info.outputPath(`fishing-removed-${locale}-${info.project.name}.png`)});
  const current=await page.request.get(`/api/private/fishing-leads/sunday_fishing_academy?source=inquiry&sourceId=${inquiry.id}`),body=await current.json();expect(body.data.membership.state).toBe("removed");
  expect(body.data.membership.details).toEqual(leadDetails);
  await page.goto(`/${locale}/app/clients?personId=${body.data.personId}`);await expect(page.getByRole("heading",{name:inquiry.name,exact:true})).toBeVisible();
  await expect(page.getByRole("region",{name:t("Fishing interests","התעניינות בדיג"),includeHidden:true})).toBeVisible();
  const personSection=page.getByRole("region",{name:t("Fishing interests","התעניינות בדיג"),includeHidden:true});await personSection.locator("summary").first().click();await expect(personSection).toContainText(t("Removed","הוסר"));
 });
 test("normal parent login denies fishing mutation/context without exposing practitioner records",async({page})=>{
  const c=runtime.fishing.credentials.find(c=>c.role==="parent")!;await page.goto("/en/login");await page.getByLabel("Email",{exact:true}).fill(c.email);await page.getByLabel("Password",{exact:true}).fill(c.password);await page.getByRole("button",{name:"Sign in",exact:true}).click();await expect(page).toHaveURL(/\/en\/family/);
  expect((await page.request.get(`/api/private/fishing-leads/sunday_fishing_academy?source=person&sourceId=${runtime.fishing.protectedPersonId}`)).status()).toBe(403);
  await page.goto("/en/app/group-applications");await expect(page.getByRole("heading",{name:"Group inquiries",exact:true})).toHaveCount(0);await expect(page.getByRole("button",{name:"Add to Lead List",exact:true})).toHaveCount(0);
 });
 test("expired practitioner session clears the already-rendered inquiry and private lead preview",async({page})=>{
  const c=runtime.fishing.credentials.find(c=>c.role==="practitioner")!;await page.goto("/en/login?next=%2Fen%2Fapp%2Fgroup-applications");await page.getByLabel("Email",{exact:true}).fill(c.email);await page.getByLabel("Password",{exact:true}).fill(c.password);await page.getByRole("button",{name:"Sign in",exact:true}).click();await expect(page).toHaveURL("/en/app/group-applications");
  const name=runtime.fishing.inquiries[0]!.name,record=page.locator("article").filter({has:page.getByRole("heading",{name,exact:true})});await expect(record).toBeVisible();
  const session=await (await page.request.get("/api/identity/session")).json();const logout=await page.request.post("/api/identity/logout-all",{headers:{origin:runtime.origin,"sec-fetch-site":"same-origin","x-csrf-token":session.data.csrfToken},data:{}});expect(logout.status()).toBe(200);
  await record.getByText("Fishing lead list · Fishing Academy",{exact:true}).click();await expect(page.locator("main").getByRole("alert")).toContainText("Your session ended");await expect(page.locator("article")).toHaveCount(0);await expect(page.getByRole("link",{name:"Sign in",exact:true})).toBeVisible();await expect(page.locator("main")).not.toContainText(name);
 });
 for(const locale of ["en","he"] as const)test(`${locale}: native membership stays visible separately from durable unsupported/unknown provider states`,async({page},info)=>{
  const c=runtime.fishing.credentials.find(c=>c.role==="practitioner")!,target=`/${locale}/app/clients?personId=${runtime.fishing.protectedPersonId}`;
  await page.goto(`/${locale}/login?next=${encodeURIComponent(target)}`);await page.locator('input[name="email"]').fill(c.email);await page.locator('input[name="password"]').fill(c.password);await page.getByRole("button",{name:locale==="he"?"כניסה":"Sign in",exact:true}).click();await expect(page).toHaveURL(target);
  const region=page.getByRole("region",{name:locale==="he"?"התעניינות בדיג":"Fishing interests"}),summaries=region.locator("summary");await summaries.first().click();await summaries.nth(1).click();
  await expect(region).toContainText(locale==="he"?"אינו נתמך בחשבון המחובר":"Not supported by this connected account");await expect(region).toContainText(locale==="he"?"התוצאה אינה ידועה — נדרשת בדיקה חוזרת":"Outcome unknown — reconciliation needed");
  await expect(region.getByRole("button",{name:locale==="he"?"הסרה מרשימת המתעניינים":"Remove from Lead List",exact:true})).toHaveCount(2);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  expect(await region.evaluate(element=>{
   const bounds=element.getBoundingClientRect(),outside:string[]=[];
   for(const item of element.querySelectorAll("p,summary,label")){
    if(!item.getClientRects().length)continue;
    const range=document.createRange();range.selectNodeContents(item);
    if([...range.getClientRects()].some(rect=>rect.width>0&&(rect.left<bounds.left-1||rect.right>bounds.right+1)))outside.push(item.textContent?.slice(0,80)??"");
   }
   return outside;
  })).toEqual([]); // Check actual text bounds, not only the document scroll width.
  await region.screenshot({path:info.outputPath(`fishing-provider-states-${locale}-${info.project.name}.png`)});
  await page.reload();await region.locator("summary").first().click();await region.locator("summary").nth(1).click();await expect(region).toContainText(locale==="he"?"אינו נתמך בחשבון המחובר":"Not supported by this connected account");await expect(region).toContainText(locale==="he"?"התוצאה אינה ידועה":"Outcome unknown");
  const uncertain=region.locator("details").nth(1);
  await uncertain.getByRole("button",{name:locale==="he"?"הסרה מרשימת המתעניינים":"Remove from Lead List",exact:true}).click();
  await uncertain.getByRole("button",{name:locale==="he"?"אישור הסרה":"Confirm Remove",exact:true}).click();
  await expect(uncertain.getByRole("status")).toContainText(locale==="he"?"הוסר":"Removed");
  await page.reload();await region.locator("summary").first().click();await region.locator("summary").nth(1).click();
  await expect(uncertain).toContainText(locale==="he"?"התוצאה אינה ידועה":"Outcome unknown");
  const removed=await (await page.request.get(`/api/private/fishing-leads/private_fishing_life_skills?source=person&sourceId=${runtime.fishing.protectedPersonId}`)).json();
  expect(removed.data.membership.state).toBe("removed");expect(removed.data.projection.unresolvedEffect.generation).toBe(1);
  await region.screenshot({path:info.outputPath(`fishing-removed-unknown-${locale}-${info.project.name}.png`)});
  // Restore through the ordinary UI, not a fixture reset; the next language
  // must see the same original unknown ancestry on the retained contact.
  await uncertain.getByRole("button",{name:locale==="he"?"הוספה לרשימת המתעניינים":"Add to Lead List",exact:true}).click();
  await uncertain.getByRole("button",{name:locale==="he"?"אישור הוספה":"Confirm Add",exact:true}).click();
  await expect(uncertain.getByRole("status")).toContainText(locale==="he"?"נוסף":"Added");
  const restored=await (await page.request.get(`/api/private/fishing-leads/private_fishing_life_skills?source=person&sourceId=${runtime.fishing.protectedPersonId}`)).json();
  expect(restored.data.membership.state).toBe("active");expect(restored.data.projection.unresolvedEffect.generation).toBe(1);
  await expect(uncertain).toContainText(locale==="he"?"התוצאה אינה ידועה":"Outcome unknown");
 });
}
