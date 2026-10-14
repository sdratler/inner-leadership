/** Real retained Next pages and native DB, ordinary synthetic login; no data API mock.
 * One controlled response loss occurs after the actual confirm commit. */
import {execFile} from "node:child_process";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {promisify} from "node:util";
import {expect,test} from "@playwright/test";
const runtimePath=process.env.LS_GROUP_INTEREST_FIXTURE_PATH;
if(!runtimePath){
 test("mounted fishing lead controls through existing isolated native harness",async({},info)=>{
  test.setTimeout(240000);const project=info.project.name==="mobile"?"mobile390":info.project.name;
  const result=await promisify(execFile)(process.execPath,["--conditions=react-server","--import","tsx","tests/e2e/group-interest/run.ts"],{timeout:210000,maxBuffer:2*1024*1024,
   env:{...process.env,LS_GROUP_INTEREST_TEST_PROJECT:project,LS_GROUP_INTEREST_TEST_ALLOW:"true",LS_CALENDAR_TEST_ALLOW:"true",LS_FISHING_LEAD_UI_ONLY:"true"}});
  expect(result.stdout).toContain("FISHING_LEAD_UI_ACCEPTANCE_PASS project="+project);
 });
}else{
 const runtime=JSON.parse(readFileSync(runtimePath,"utf8")) as {origin:string;fishing:{credentials:{role:string;email:string;password:string}[];inquiries:{locale:string;id:string;name:string}[];protectedPersonId:string}};
 if(process.env.LS_FISHING_LEAD_UI_ONLY!=="true"||!/^https:\/\/localhost:310[5678]$/.test(runtime.origin)||!runtime.fishing)throw Error("FISHING_UI_ISOLATED_FIXTURE_REQUIRED");
 test.use({baseURL:runtime.origin});
 for(const locale of ["en","he"] as const)test(`${locale}: normal login, preview/cancel, collapsed draft, lost-response retry, Remove and reload`,async({page},info)=>{
  const t=(en:string,he:string)=>locale==="he"?he:en,credentials=runtime.fishing.credentials.find(c=>c.role==="practitioner")!,inquiry=runtime.fishing.inquiries.find(i=>i.locale===locale)!;
  await page.goto(`/${locale}/login?next=${encodeURIComponent(`/${locale}/app/group-applications`)}`);
  await page.getByLabel(t("Email","דוא״ל"),{exact:true}).fill(credentials.email);await page.getByLabel(t("Password","סיסמה"),{exact:true}).fill(credentials.password);
  await page.getByRole("button",{name:t("Sign in","כניסה"),exact:true}).click();await expect(page).toHaveURL(`/${locale}/app/group-applications`);
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
  await record.screenshot({path:info.outputPath(`fishing-added-${locale}-${info.project.name}.png`)});
  await details.getByRole("button",{name:t("Remove from Lead List","הסרה מרשימת המתעניינים"),exact:true}).click();await details.getByRole("button",{name:t("Confirm Remove","אישור הסרה"),exact:true}).click();
  await expect(details.getByRole("status")).toContainText(t("Contact and history retained.","פרטי הקשר וההיסטוריה נשמרו."));
  await page.reload();await details.locator("summary").click();await expect(details).toContainText(t("Removed","הוסר"));await expect(details.getByRole("button",{name:t("Add to Lead List","הוספה לרשימת המתעניינים"),exact:true})).toBeVisible();
  await record.screenshot({path:info.outputPath(`fishing-removed-${locale}-${info.project.name}.png`)});
  const current=await page.request.get(`/api/private/fishing-leads/sunday_fishing_academy?source=inquiry&sourceId=${inquiry.id}`),body=await current.json();expect(body.data.membership.state).toBe("removed");
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
