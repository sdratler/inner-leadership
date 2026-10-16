/** Actual retained routes, ordinary separate logins, disposable synthetic native
 * data only. These tests may NOT run before the exact native/browser recipe ACK. */
import {test,expect,type Page,type Browser,type BrowserContext} from "@playwright/test";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {readFileSync} from "node:fs";
import type {FishingStageBrowserData} from "./fishing-stage-fixture.ts";
import {fishingCalendarSearch} from "../../../src/features/fishing/program-calendar-contract.ts";
import {syntheticChildFailure} from "../group-interest/synthetic-child-output.ts";
const file=process.env.LS_FISHING_STAGE_FIXTURE_PATH;
if(!file){
 // Explicit focused execution runs the isolated ordinary-role gate, never the
 // foundation server. Missing exact target/SQL opt-in remains a failure.
 test("ordinary-role fishing Calendar through the registered isolated native harness",async({},info)=>{
  test.setTimeout(480000);const project=info.project.name==="mobile"?"mobile390":info.project.name;
  const result=await promisify(execFile)(process.execPath,["--conditions=react-server","--import","tsx","tests/e2e/calendar/run.ts"],{timeout:450000,maxBuffer:2*1024*1024,windowsHide:true,
   env:{...process.env,LS_CALENDAR_TEST_PROJECT:project,LS_RM_FISHING_STAGE_UI_ONLY:"true",LS_CALENDAR_TEST_SHARED_ROUTES_ACCEPTED:"true"}}).catch(error=>{throw Error(syntheticChildFailure(error));});
  expect(result.stdout).toContain("FISHING_STAGE_BROWSER_ACCEPTANCE_PASS project="+project);
 });
}else{
 if(process.env.LS_RM_FISHING_STAGE_UI_ONLY!=="true"||process.env.LS_RM_PROGRAM_NATIVE_ALLOW!=="MAIN_REGISTERED_ONLY")throw Error("FISHING_BROWSER_RECIPE_REQUIRED");
 const data=JSON.parse(readFileSync(file,"utf8"))as FishingStageBrowserData;
 const projects=["desktop","mobile390","mobile340","tablet768"],project=process.env.LS_CALENDAR_TEST_PROJECT,index=projects.indexOf(project??"");
 if(index<0||data.origin!==`https://127.0.0.1:${3445+index}`)throw Error("FISHING_BROWSER_TARGET_MISMATCH");
 test.use({baseURL:data.origin});
 const t=(locale:string,en:string,he:string)=>locale==="he"?he:en;
 const family=(locale:string)=>data.families[locale]!;
 const route=(locale:string,role:string,selected=false,view="day")=>`/${locale}/${role==="practitioner"?"app/calendar":role==="child"||role==="adult_client"?"client/calendar":"family/schedule"}?`+new URLSearchParams({date:data.date,view,...(selected?Object.fromEntries(new URLSearchParams(fishingCalendarSearch(family(locale).selection))):{})});
 async function login(page:Page,role:string,target:string,locale:string){
  const credentials=data.credentials.find(c=>c.role===role);if(!credentials)throw Error("EXACT_SYNTHETIC_ROLE_REQUIRED");
  const expected=new URL(target,data.origin),sameTarget=(url:URL)=>url.origin===expected.origin&&url.pathname===expected.pathname&&url.hash===''&&JSON.stringify([...url.searchParams].sort())===JSON.stringify([...expected.searchParams].sort());
  expect((await page.context().cookies(data.origin)).filter(cookie=>cookie.name==='__Host-ls-session')).toHaveLength(0);
  // Start at the original PRIVATE route: its proxy/layout must retain context.
  await page.goto(target);await expect(page).toHaveURL(url=>url.pathname===`/${locale}/login`,{timeout:45000});
  const requested=new URL(page.url()).searchParams.getAll('next');expect(requested).toHaveLength(1);expect(sameTarget(new URL(requested[0]!,data.origin))).toBe(true);
  await page.getByLabel(t(locale,"Email","דוא״ל"),{exact:true}).fill(credentials.email);await page.getByLabel(t(locale,"Password","סיסמה"),{exact:true}).fill(credentials.password);
  const response=page.waitForResponse(r=>new URL(r.url()).pathname==="/api/identity/login"&&r.request().method()==="POST");await page.getByRole("button",{name:t(locale,"Sign in","כניסה"),exact:true}).click();expect((await response).status()).toBe(200);await expect(page).toHaveURL(sameTarget,{timeout:45000});
 }
 async function separate(browser:Browser,page:Page,contexts:BrowserContext[]){const viewport=page.viewportSize();if(!viewport)throw Error("VIEWPORT_REQUIRED");const c=await browser.newContext({baseURL:data.origin,ignoreHTTPSErrors:true,viewport,isMobile:viewport.width<=390,hasTouch:viewport.width<=768});contexts.push(c);return c.newPage();}
 async function openPlan(page:Page,locale:string){const summary=page.getByText(t(locale,"Full twelve-session plan and received notices","התוכנית המלאה ל־12 מפגשים והדיווחים שהתקבלו"),{exact:true});const detail=summary.locator("..");if(!await detail.getAttribute("open").then(v=>v!==null))await summary.click();return detail;}
 async function screen(page:Page,locale:string,path:string){await expect(page.locator("main.ls-cal")).toHaveAttribute("dir",locale==="he"?"rtl":"ltr");expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.keyboard.press("Tab");expect(await page.evaluate(()=>document.activeElement?.tagName)).not.toBe("BODY");await page.screenshot({path,fullPage:true});}

 for(const locale of["en","he"]as const){
  test(`${locale}: ordinary case-free parent, one shared grid/agenda, child context, durable absence/replay and existing Materials`,async({page},info)=>{
   await login(page,"parent-"+locale,route(locale,"parent",true),locale);
   await expect(page.getByLabel(t(locale,"Authorized child","ילד מורשה"),{exact:true})).toHaveValue(family(locale).selection.learnerId!);await expect(page.getByLabel(t(locale,"Stage enrollment","רישום לשלב"),{exact:true})).toHaveValue(family(locale).selection.enrollmentId!);
   await page.goto(route(locale,"parent"));
   const child=page.getByLabel(t(locale,"Authorized child","ילד מורשה"),{exact:true});await expect(child).toHaveValue("");await expect(page.locator('[data-fishing-occurrence-id]:visible')).toHaveCount(0);
   await child.selectOption(family(locale).selection.learnerId!);await expect(page.getByLabel(t(locale,"Stage enrollment","רישום לשלב"),{exact:true})).toHaveValue("");
   const event=page.locator(`[data-fishing-occurrence-id="${data.occurrenceId}"]:visible`);await expect(event).toHaveCount(1);await expect(page.locator('[data-ls-calendar-grid]:visible')).toHaveCount(info.project.name.startsWith("mobile")?0:1);
   await screen(page,locale,info.outputPath(`parent-${locale}-one-calendar.png`));await event.getByRole("button",{name:t(locale,"Open session details","פתיחת פרטי מפגש"),exact:true}).click();
   await expect(page.getByLabel(t(locale,"Stage enrollment","רישום לשלב"),{exact:true})).toHaveValue(family(locale).selection.enrollmentId!);
   const plan=await openPlan(page,locale);await expect(plan.getByRole("heading",{name:/Session 1 ·|מפגש 1 ·/})).toBeVisible();
   let discarded=false;const bodies:string[]=[],keys:string[]=[];
   await page.route("**/api/calendar/fishing/command",async intercepted=>{bodies.push(intercepted.request().postData()??"");keys.push(intercepted.request().headers()["idempotency-key"]??"");if(!discarded){discarded=true;const actual=await intercepted.fetch();expect(actual.status()).toBe(200);await intercepted.abort("failed");}else await intercepted.continue();});
   const item=plan.locator("li").filter({has:page.getByRole("heading",{name:/Session 1 ·|מפגש 1 ·/})});await item.getByRole("combobox").selectOption("unavoidable");await item.getByRole("button",{name:t(locale,"Report absence","דיווח על היעדרות"),exact:true}).click();
   await expect(page.getByRole("button",{name:t(locale,"Retry the same operation","ניסיון חוזר לאותה פעולה"),exact:true})).toBeVisible();await expect(item.getByRole("combobox")).toHaveValue("unavoidable");
   await page.getByRole("button",{name:t(locale,"Retry the same operation","ניסיון חוזר לאותה פעולה"),exact:true}).click();await expect(page.getByText(t(locale,"Saved in the app. No message, charge or enrollment was created.","נשמר במערכת. לא נוצרו הודעה, חיוב או רישום לקורס."),{exact:true})).toBeVisible();expect(bodies).toHaveLength(2);expect(bodies[0]).toBe(bodies[1]);expect(keys[0]).toBe(keys[1]);await page.unrouteAll({behavior:"wait"});
   await page.reload();const reopened=await openPlan(page,locale);await expect(reopened.getByRole("heading",{name:t(locale,"Notice received","הדיווח התקבל"),exact:true})).toHaveCount(1);
   const canonical=await page.request.get("/api/calendar/fishing/plan?"+fishingCalendarSearch(family(locale).selection));expect(canonical.status()).toBe(200);expect((await canonical.json()).data.view.notices).toHaveLength(1);
   const wrong=await page.request.get("/api/calendar/fishing/context?learnerId="+family(locale).otherLearnerId);expect(wrong.status()).toBe(404);
   const link=reopened.getByRole("link",{name:t(locale,"Open lesson","פתיחת שיעור"),exact:true}).first();await expect(link).toBeVisible();await link.click();await expect(page.getByLabel("Describe your synthetic hookless practice.",{exact:true})).toBeVisible();expect(await page.locator("body").innerText()).not.toContain("PRIVATE_SYNTHETIC_TEACHER_CANARY");
   await page.goBack();await expect(page.getByLabel(t(locale,"Stage enrollment","רישום לשלב"),{exact:true})).toHaveValue(family(locale).selection.enrollmentId!);await screen(page,locale,info.outputPath(`parent-${locale}-saved-and-return.png`));
  });

  test(`${locale}: practitioner real native edit, long draft/reload conflict and retained shared agenda`,async({page,browser},info)=>{
   const contexts:BrowserContext[]=[];try{
   const operator={...family(locale).selection,learnerId:null,enrollmentId:null};await login(page,"practitioner",route(locale,"practitioner")+'&'+fishingCalendarSearch(operator),locale);const event=page.locator(`[data-fishing-occurrence-id="${data.occurrenceId}"]:visible`);await expect(event).toHaveCount(1);await event.getByRole("button").click();
   await page.getByRole("button",{name:t(locale,"Manage this stage","ניהול השלב"),exact:true}).click();const form=page.getByRole("form",{name:t(locale,"Manage fishing stage","ניהול שלב הדיג"),exact:true});
   await form.getByLabel(t(locale,"Action","פעולה"),{exact:true}).selectOption("revise");await form.getByLabel(t(locale,"Session","מפגש"),{exact:true}).selectOption(data.occurrenceId);
   const note=form.getByLabel(t(locale,"Family-visible logistical note","הערה לוגיסטית המוצגת למשפחות"),{exact:true}),draft="Synthetic retained draft / טיוטה סינתטית ".repeat(20);await note.fill(draft);await form.getByLabel(t(locale,"Reason visible to the enrolled family","סיבה המוצגת למשפחה הרשומה"),{exact:true}).fill("Synthetic deliberate UI revision");
   // A second ordinary session saves a real competing native revision. No
   // fabricated 409 or permissive replacement adapter supplies this conflict.
   const other=await separate(browser,page,contexts);await login(other,"practitioner",page.url().replace(data.origin,""),locale);await other.getByRole("button",{name:t(locale,"Manage this stage","ניהול השלב"),exact:true}).click();
   const otherForm=other.getByRole("form",{name:t(locale,"Manage fishing stage","ניהול שלב הדיג"),exact:true});await otherForm.getByLabel(t(locale,"Action","פעולה"),{exact:true}).selectOption("revise");await otherForm.getByLabel(t(locale,"Session","מפגש"),{exact:true}).selectOption(data.occurrenceId);await otherForm.getByLabel(t(locale,"Family-visible logistical note","הערה לוגיסטית המוצגת למשפחות"),{exact:true}).fill("Synthetic competing native revision");await otherForm.getByLabel(t(locale,"Reason visible to the enrolled family","סיבה המוצגת למשפחה הרשומה"),{exact:true}).fill("Synthetic second-session revision");
   const competing=other.waitForResponse(r=>new URL(r.url()).pathname==="/api/calendar/fishing/command"&&r.request().method()==="POST");await otherForm.getByRole("button",{name:t(locale,"Save deliberate action","שמירת הפעולה שנבחרה"),exact:true}).click();expect((await competing).status()).toBe(200);
   const stale=page.waitForResponse(r=>new URL(r.url()).pathname==="/api/calendar/fishing/command"&&r.request().method()==="POST");await form.getByRole("button",{name:t(locale,"Save deliberate action","שמירת הפעולה שנבחרה"),exact:true}).click();expect((await stale).status()).toBe(409);await expect(page.getByRole("alert").filter({hasText:t(locale,"saved version, capacity or approval changed","הגרסה, הקיבולת או האישור השתנו")})).toBeVisible();await expect(note).toHaveValue(draft);
   await page.getByRole("button",{name:t(locale,"Reload current access and plan","טעינת הרשאות ותוכנית עדכניות"),exact:true}).click();await expect(note).toHaveValue(draft);await form.getByRole("button",{name:t(locale,"Use current revision, keep my draft","שימוש בגרסה הנוכחית ושמירת הטיוטה"),exact:true}).click();
   const pending=page.waitForResponse(r=>new URL(r.url()).pathname==="/api/calendar/fishing/command"&&r.request().method()==="POST");await form.getByRole("button",{name:t(locale,"Save deliberate action","שמירת הפעולה שנבחרה"),exact:true}).click();expect((await pending).status()).toBe(200);await page.reload();const full=await openPlan(page,locale);await expect(full.getByText(draft,{exact:true})).toBeVisible();
   await screen(page,locale,info.outputPath(`practitioner-${locale}-saved-plan.png`));
   await page.goto(route(locale,"practitioner",false,"agenda"));await expect(page.locator(`[data-fishing-occurrence-id="${data.occurrenceId}"]:visible`)).toHaveCount(1);await expect(page.locator('[data-ls-calendar-grid]:visible')).toHaveCount(0);await screen(page,locale,info.outputPath(`practitioner-${locale}-agenda.png`));
   }finally{await Promise.all(contexts.map(c=>c.close()));}
  });

  test(`${locale}: separately authenticated optional child and adult cannot gain parent/operator capabilities`,async({page,browser},info)=>{
   const contexts:BrowserContext[]=[];
   try{
    await login(page,"child-"+locale,route(locale,"child",true),locale);const full=await openPlan(page,locale);await expect(full.getByRole("button",{name:t(locale,"Report absence","דיווח על היעדרות"),exact:true})).toHaveCount(0);await expect(page.getByRole("button",{name:t(locale,"Manage this stage","ניהול השלב"),exact:true})).toHaveCount(0);await expect(full.getByRole("link",{name:t(locale,"Open lesson","פתיחת שיעור"),exact:true})).toHaveCount(0);
    const wrong=await page.request.get("/api/calendar/fishing/context?learnerId="+family(locale).otherLearnerId);expect(wrong.status()).toBe(403);expect(await page.locator("body").innerText()).not.toMatch(/PRIVATE_SYNTHETIC|paidCents|termsAcceptanceId/);await screen(page,locale,info.outputPath(`child-${locale}-own-readonly.png`));
    const adult=await separate(browser,page,contexts);await login(adult,"adult_client",route(locale,"adult_client"),locale);await expect(adult.locator("#fishing-calendar-heading")).toHaveCount(0);expect((await adult.request.get("/api/calendar/fishing/context")).status()).toBe(403);
   }finally{await Promise.all(contexts.map(c=>c.close()));}
  });
 }
 test("ordinary operator completion, explicit attendance and cancellation remain separate native actions with private family readback",async({page},info)=>{
  const locale="en",selection={...family(locale).selection,learnerId:null,enrollmentId:null};await login(page,"practitioner",route(locale,"practitioner")+"&"+fishingCalendarSearch(selection),locale);
  async function action(kind:string,occurrenceId:string){await page.getByRole("button",{name:"Manage this stage",exact:true}).click();const form=page.getByRole("form",{name:"Manage fishing stage",exact:true});await form.getByLabel("Action",{exact:true}).selectOption(kind);await form.getByLabel("Session",{exact:true}).selectOption(occurrenceId);await form.getByLabel("Reason visible to the enrolled family",{exact:true}).fill("Synthetic explicit "+kind);return form;}
  async function save(form:ReturnType<Page["getByRole"]>){const response=page.waitForResponse(r=>new URL(r.url()).pathname==="/api/calendar/fishing/command"&&r.request().method()==="POST");await form.getByRole("button",{name:"Save deliberate action",exact:true}).click();expect((await response).status()).toBe(200);await expect(form).toHaveCount(0);}
  await save(await action("complete",data.pastOccurrenceId));const attendance=await action("attendance",data.pastOccurrenceId);await expect(attendance.getByRole("button",{name:"Save deliberate action",exact:true})).toBeDisabled();await attendance.getByLabel("Confirmed participant",{exact:true}).selectOption(family(locale).selection.enrollmentId!);await attendance.getByLabel("Actual attendance",{exact:true}).selectOption("present");await save(attendance);
  const cancellation=await action("cancel",data.occurrenceId);await expect(cancellation.getByRole("alert")).toContainText("undelivered service");await save(cancellation);await page.reload();
  const canonical=await page.request.get("/api/calendar/fishing/plan?"+fishingCalendarSearch(selection));expect(canonical.status()).toBe(200);const view=(await canonical.json()).data.view;expect(view.occurrences.find((o:{id:string})=>o.id===data.pastOccurrenceId).state).toBe("completed");expect(view.occurrences.find((o:{id:string})=>o.id===data.occurrenceId).state).toBe("cancelled");expect(view.attendance).toHaveLength(1);expect(view.attendance[0]).toMatchObject({enrollmentId:family(locale).selection.enrollmentId,occurrenceId:data.pastOccurrenceId,state:"present"});await screen(page,locale,info.outputPath("operator-completion-attendance-cancellation.png"));
 });
}
