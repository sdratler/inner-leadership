import {test,expect,type Page,type BrowserContext,type Browser} from "@playwright/test";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import pg from "pg";
import {safeTestUrl} from "../../database/calendar/fixture.ts";
import {educationSearch} from "../../../src/features/resources/education-query.ts";
import type {LessonReference} from "../../../src/features/resources/fishing-lesson-journey.ts";
import {syntheticChildFailure} from "../group-interest/synthetic-child-output.ts";
const runtimePath=process.env.LS_GROUP_INTEREST_FIXTURE_PATH;
if(!runtimePath){
 test("ordinary-session educational workflow through the existing disposable native harness",async({},info)=>{
  test.setTimeout(420000);const project=info.project.name==="mobile"?"mobile390":info.project.name;
  const result=await promisify(execFile)(process.execPath,["--conditions=react-server","--import","tsx","tests/e2e/group-interest/run.ts"],{
   timeout:390000,maxBuffer:2*1024*1024,env:{...process.env,LS_GROUP_INTEREST_TEST_ALLOW:"true",LS_CALENDAR_TEST_ALLOW:"true",LS_GROUP_INTEREST_TEST_PROJECT:project,LS_EDUCATION_UI_ONLY:"true"},
  }).catch(error=>{throw new Error(syntheticChildFailure(error));});
  expect(result.stdout).toContain("EDUCATION_BROWSER_ACCEPTANCE_PASS project="+project);
 });
}else{
 const runtime=JSON.parse(readFileSync(runtimePath,"utf8"))as{origin:string;education:{workspaceId:string;credentials:{role:string;accountId:string;email:string;password:string}[];references:Record<string,LessonReference>}};
 if(process.env.LS_EDUCATION_UI_ONLY!=="true"||!/^https:\/\/localhost:310[5678]$/.test(runtime.origin)||!runtime.education)throw Error("EDUCATION_DISPOSABLE_RUNTIME_REQUIRED");
 const edu=runtime.education,api="/api/resources/education/lesson";
 test.use({baseURL:runtime.origin});
 const t=(locale:string,en:string,he:string)=>locale==="he"?he:en;
 const href=(locale:string,ref:LessonReference,section:"lesson"|"portfolio"|"review"|"publication")=>`/${locale}/${section==="lesson"||section==="portfolio"?"family":"app"}/resources?`+educationSearch(ref,section);
 const query=(ref:LessonReference,view:string)=>api+"?"+new URLSearchParams({...ref,view});
 async function login(page:Page,role:string,target:string,locale="en"){
  const c=edu.credentials.find(c=>c.role===role)!;await page.goto(`/${locale}/login?next=${encodeURIComponent(target)}`);
  await page.getByLabel(t(locale,"Email","דוא״ל"),{exact:true}).fill(c.email);await page.getByLabel(t(locale,"Password","סיסמה"),{exact:true}).fill(c.password);
  const response=page.waitForResponse(r=>new URL(r.url()).pathname==="/api/identity/login"&&r.request().method()==="POST",{timeout:30000});
  await page.getByRole("button",{name:t(locale,"Sign in","כניסה"),exact:true}).click();expect((await response).status()).toBe(200);await expect(page).toHaveURL(target,{timeout:30000});
 }
 async function separate(contexts:BrowserContext[],browser:Browser,parent:Page){
  const viewport=parent.viewportSize();if(!viewport)throw Error("EXACT_ROLE_VIEWPORT_REQUIRED");
  const context=await browser.newContext({baseURL:runtime.origin,ignoreHTTPSErrors:true,viewport,isMobile:viewport.width<=390,hasTouch:viewport.width<=768});contexts.push(context);const page=await context.newPage();expect(page.viewportSize()).toEqual(viewport);return page;
 }
 const openDetails=async(page:Page,name:string)=>{const summary=page.getByText(name,{exact:true});if(!await summary.locator("..").getAttribute("open").then(value=>value!==null))await summary.click();};
 for(const locale of["en","he"]as const)test(`${locale}: real parent submission/replay, private teacher review, deliberate own-parent publication/reload`,async({page,browser},info)=>{
  const ref=edu.references[locale]!,contexts:BrowserContext[]=[];
  const draft=`Synthetic retained ${locale} answer. `+"תרגול סינתטי בלבד. ".repeat(35),note="SYNTHETIC PRIVATE OBSERVATION MUST NOT REACH FAMILY",summary=`Safe synthetic parent summary ${locale}.`;
  try{
   await login(page,"parent",href(locale,ref,"lesson"),locale);
   await expect(page.getByRole("navigation",{name:t(locale,"Lesson location","מיקום השיעור"),exact:true}).locator("ol")).toHaveCSS("display","flex");
   await expect(page.getByRole("navigation",{name:t(locale,"Lesson location","מיקום השיעור"),exact:true}).locator("ol")).toHaveCSS("list-style-type","none");
   await expect(page.getByRole("tablist",{name:t(locale,"Lesson views","תצוגות השיעור"),exact:true})).toHaveCSS("display","flex");await expect(page.locator(".lsw-feature-page [style]")).toHaveCount(0);
   const answer=page.getByLabel("Describe your synthetic hookless practice.",{exact:true});await answer.fill(draft);
   const navigationWarning=page.waitForEvent("dialog",{timeout:3000}).then(async dialog=>{await dialog.dismiss();return dialog.type();},()=>null);
   await page.getByRole("banner").getByRole("link",{name:"Fishing Academy",exact:true}).click();expect(await navigationWarning).toBe("beforeunload");await expect(page).toHaveURL(href(locale,ref,"lesson"));await expect(answer).toHaveValue(draft);
   const lessonTab=page.getByRole("tab",{name:t(locale,"Lesson","שיעור"),exact:true}),portfolioTab=page.getByRole("tab",{name:t(locale,"Published summary","סיכום שפורסם"),exact:true});
   await lessonTab.focus();await lessonTab.press(locale==="he"?"ArrowLeft":"ArrowRight");await expect(portfolioTab).toHaveAttribute("aria-selected","true");await expect(portfolioTab).toBeFocused();
   await page.goBack();await expect(lessonTab).toHaveAttribute("aria-selected","true");await expect(answer).toHaveValue(draft);
   let failedRead=false;await page.route("**/api/resources/education/lesson?*",async route=>{if(!failedRead&&new URL(route.request().url()).searchParams.get("view")==="parent"){failedRead=true;return route.abort("failed");}return route.continue();});
   await portfolioTab.click();await expect(page.locator(".lsw-feature-page").getByRole("alert")).toContainText(t(locale,"could not be loaded","לא ניתן לטעון"));
   await page.getByRole("button",{name:t(locale,"Reload lesson","טעינת השיעור מחדש"),exact:true}).click();await expect(page.getByText(t(locale,"No summary has been published for you for this lesson.","טרם פורסם עבורכם סיכום לשיעור זה."),{exact:true})).toBeVisible();await page.unrouteAll({behavior:"wait"});
   await lessonTab.click();await expect(answer).toHaveValue(draft);
   await page.getByRole("navigation",{name:t(locale,"Lesson location","מיקום השיעור"),exact:true}).getByRole("link").click();await expect(page.getByRole("button",{name:t(locale,"Stay here","להישאר כאן"),exact:true})).toBeFocused();
   await page.getByRole("button",{name:t(locale,"Stay here","להישאר כאן"),exact:true}).click();await expect(answer).toHaveValue(draft);
   await page.getByRole("tab",{name:t(locale,"Published summary","סיכום שפורסם"),exact:true}).click();await expect(page.getByText(t(locale,"No summary has been published for you for this lesson.","טרם פורסם עבורכם סיכום לשיעור זה."),{exact:true})).toBeVisible();
   await page.getByRole("tab",{name:t(locale,"Lesson","שיעור"),exact:true}).click();await expect(answer).toHaveValue(draft);
   await expect(page.locator("details").filter({hasText:t(locale,"Lesson instructions","הנחיות השיעור")})).not.toHaveAttribute("open");
   let lost=false;const bodies:string[]=[];
   await page.route("**/api/resources/education/lesson",async route=>{if(route.request().method()!=="POST")return route.continue();bodies.push(route.request().postData()!);
    const real=await route.fetch();expect(real.status()).toBe(200);if(!lost){lost=true;await route.abort("failed");}else await route.fulfill({response:real});
   });
   await page.getByRole("button",{name:t(locale,"Submit my work","שליחת העבודה שלי"),exact:true}).click();await expect(page.locator(".lsw-feature-page").getByRole("alert")).toContainText(t(locale,"save result is unknown","תוצאת השמירה אינה ידועה"));
   await page.getByRole("button",{name:t(locale,"Retry the same operation","ניסיון נוסף לאותה פעולה"),exact:true}).click();await expect(page.getByRole("status").filter({hasText:t(locale,"previously saved operation is confirmed","הפעולה שנשמרה אומתה")})).toBeVisible();
   expect(bodies).toHaveLength(2);expect(createHash("sha256").update(bodies[0]!).digest("hex")).toBe(createHash("sha256").update(bodies[1]!).digest("hex"));await page.unrouteAll({behavior:"wait"});
   await page.reload();await expect(answer).toHaveValue(draft.trim());await expect(page.getByRole("button",{name:t(locale,"Submit my work","שליחת העבודה שלי"),exact:true})).toBeDisabled();
   await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:info.outputPath(`education-parent-${locale}-${info.project.name}.png`)});
   const teacher=await separate(contexts,browser,page);await login(teacher,"practitioner",href(locale,ref,"review"),locale);
   await teacher.getByLabel(t(locale,"Observed task","המשימה שנצפתה"),{exact:true}).fill("Synthetic hookless task");await teacher.getByLabel(t(locale,"Assistance","סיוע"),{exact:true}).selectOption("with_guidance");
   await openDetails(teacher,t(locale,"Optional private note","הערה פרטית אופציונלית"));await teacher.getByLabel(t(locale,"Private teacher note","הערת מדריך פרטית"),{exact:true}).fill(note);
   await teacher.getByRole("tab",{name:t(locale,"Publish summary","פרסום סיכום"),exact:true}).click();await teacher.getByRole("tab",{name:t(locale,"Teacher review","עיון המדריך"),exact:true}).click();await openDetails(teacher,t(locale,"Optional private note","הערה פרטית אופציונלית"));await expect(teacher.getByLabel(t(locale,"Private teacher note","הערת מדריך פרטית"),{exact:true})).toHaveValue(note);
   await teacher.getByRole("button",{name:t(locale,"Save private observation","שמירת תצפית פרטית"),exact:true}).click();await expect(teacher.getByRole("status").filter({hasText:t(locale,"Saved in the app","נשמר במערכת")})).toBeVisible();await teacher.reload();await openDetails(teacher,t(locale,"Previous private observations","תצפיות פרטיות קודמות"));await expect(teacher.getByText(note,{exact:true})).toBeVisible();
   await teacher.evaluate(()=>scrollTo(0,0));await teacher.screenshot({path:info.outputPath(`education-teacher-${locale}-${info.project.name}.png`)});
   await teacher.getByRole("tab",{name:t(locale,"Publish summary","פרסום סיכום"),exact:true}).click();await teacher.getByLabel(t(locale,"Parent-safe summary","סיכום המתאים להורה"),{exact:true}).fill(summary);
   await expect(teacher.getByRole("button",{name:t(locale,"Publish selected summary","פרסום הסיכום שנבחר"),exact:true})).toBeDisabled();
   await teacher.getByLabel(edu.credentials.find(c=>c.role==="parent")!.email,{exact:true}).check();await teacher.getByRole("button",{name:t(locale,"Publish selected summary","פרסום הסיכום שנבחר"),exact:true}).click();await expect(teacher.getByRole("status").filter({hasText:t(locale,"Saved in the app","נשמר במערכת")})).toBeVisible();
   await page.getByRole("tab",{name:t(locale,"Published summary","סיכום שפורסם"),exact:true}).click();await expect(page.getByText(summary,{exact:true})).toBeVisible();await page.reload();await expect(page.getByText(summary,{exact:true})).toBeVisible();
   const body=await(await page.request.get(query(ref,"parent"))).json();expect(JSON.stringify(body)).not.toMatch(/PRIVATE OBSERVATION|TEACHER KEY|retained .* answer|summaryRecipients|privateNote|emailCiphertext/);
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:info.outputPath(`education-portfolio-${locale}-${info.project.name}.png`)});
  }finally{for(const c of contexts)await c.close();}
 });
 test("ordinary roles/anonymous access deny unauthorized lesson and private teacher content",async({page,browser})=>{
  const ref=edu.references.en!,contexts:BrowserContext[]=[];
  try{expect((await page.request.get(query(ref,"learner"))).status()).toBe(401);
   await login(page,"unauthorized_parent",href("en",ref,"lesson"));await expect(page.locator(".lsw-feature-page").getByRole("alert")).toContainText("cannot be authorized");expect((await page.request.get(query(ref,"learner"))).status()).toBe(403);expect((await page.request.get(query(ref,"teacher"))).status()).toBe(403);
   const adult=await separate(contexts,browser,page);await login(adult,"adult_client","/en/client");expect((await adult.request.get(query(ref,"parent"))).status()).toBe(403);
   expect(JSON.stringify(await(await page.request.get(query(ref,"parent"))).json())).not.toMatch(/PRIVATE OBSERVATION|TEACHER KEY|Safe synthetic/);
  }finally{for(const c of contexts)await c.close();}
 });
 test("recipient withdrawn after teacher read is denied; draft survives authorized reload and deliberate reselection",async({page,browser})=>{
  const ref=edu.references.control!,contexts:BrowserContext[]=[],pool=new pg.Pool({connectionString:safeTestUrl(),ssl:false,max:1});
  try{await login(page,"parent",href("en",ref,"lesson"));await page.getByLabel("Describe your synthetic hookless practice.",{exact:true}).fill("Synthetic control submission");await page.getByRole("button",{name:"Submit my work",exact:true}).click();await expect(page.getByRole("status").filter({hasText:"Saved in the app"})).toBeVisible();
   const teacher=await separate(contexts,browser,page);await login(teacher,"practitioner",href("en",ref,"review"));await teacher.getByLabel("Observed task",{exact:true}).fill("Synthetic reviewed control task");await teacher.getByLabel("Assistance",{exact:true}).selectOption("independent");await teacher.getByRole("button",{name:"Save private observation",exact:true}).click();await expect(teacher.getByRole("status").filter({hasText:"Saved in the app"})).toBeVisible();
   await teacher.getByRole("tab",{name:"Publish summary",exact:true}).click();await teacher.getByLabel("Parent-safe summary",{exact:true}).fill("Retained safe publication draft");await teacher.getByLabel(edu.credentials.find(c=>c.role==="parent")!.email,{exact:true}).check();
   await pool.query("UPDATE ls_education.account_grants SET permissions=ARRAY['submit','read_learner'] WHERE workspace_id=$1 AND account_id=$2 AND module_id=$3 AND version=$4",[edu.workspaceId,edu.credentials.find(c=>c.role==="parent")!.accountId,ref.moduleId,ref.version]);
   await teacher.getByRole("button",{name:"Publish selected summary",exact:true}).click();await expect(teacher.locator(".lsw-feature-page").getByRole("alert")).toContainText("cannot be authorized");await teacher.getByRole("button",{name:"Reload lesson",exact:true}).click();await expect(teacher.getByLabel("Parent-safe summary",{exact:true})).toHaveValue("Retained safe publication draft");await expect(teacher.getByLabel(edu.credentials.find(c=>c.role==="parent")!.email,{exact:true})).toHaveCount(0);
   await teacher.getByLabel(edu.credentials.find(c=>c.role==="other_parent")!.email,{exact:true}).check();await teacher.getByRole("button",{name:"Publish selected summary",exact:true}).click();await expect(teacher.getByRole("status").filter({hasText:"Saved in the app"})).toBeVisible();
   const recipient=await separate(contexts,browser,page);await login(recipient,"other_parent",href("en",ref,"portfolio"));await expect(recipient.getByText("Retained safe publication draft",{exact:true})).toBeVisible();expect((await page.request.get(query(ref,"parent"))).status()).toBe(403);expect((await page.request.get(query(ref,"learner"))).status()).toBe(200);
  }finally{await pool.end();for(const c of contexts)await c.close();}
 });
 test("saved source withdrawal and expired ordinary session clear rather than disclose retained work",async({page})=>{
  const ref=edu.references.en!,pool=new pg.Pool({connectionString:safeTestUrl(),ssl:false,max:1});
  try{await login(page,"parent",href("en",ref,"lesson"));await expect(page.getByLabel("Describe your synthetic hookless practice.",{exact:true})).toBeVisible();
   const session=await(await page.request.get("/api/identity/session")).json();expect((await page.request.post("/api/identity/logout-all",{headers:{origin:runtime.origin,"sec-fetch-site":"same-origin","x-csrf-token":session.data.csrfToken},data:{}})).status()).toBe(200);
   await page.getByRole("tab",{name:"Published summary",exact:true}).click();await expect(page.locator(".lsw-feature-page").getByRole("alert")).toContainText("session ended");await expect(page.getByText("Safe synthetic parent summary en.",{exact:true})).toHaveCount(0);
   await pool.query("UPDATE ls_education.catalog_versions SET approval_state='withdrawn' WHERE workspace_id=$1 AND module_id=$2 AND version=$3",[edu.workspaceId,ref.moduleId,ref.version]);
   await page.goto("/en/login");const c=edu.credentials.find(c=>c.role==="parent")!;await page.getByLabel("Email",{exact:true}).fill(c.email);await page.getByLabel("Password",{exact:true}).fill(c.password);const response=page.waitForResponse(r=>new URL(r.url()).pathname==="/api/identity/login"&&r.request().method()==="POST");await page.getByRole("button",{name:"Sign in",exact:true}).click();expect((await response).status()).toBe(200);await expect(page).toHaveURL(/\/en\/family(?:\/schedule)?$/,{timeout:30000});await page.goto(href("en",ref,"lesson"));await expect(page.locator(".lsw-feature-page").getByRole("alert")).toContainText("cannot be authorized");expect((await page.request.get(query(ref,"learner"))).status()).toBe(403);
  }finally{await pool.end();}
 });
 test("optional child educational access remains disabled after ordinary login; no role-switch shortcut",async({page})=>{
  const c=edu.credentials.find(c=>c.role==="child")!;await page.goto("/en/login");await page.getByLabel("Email",{exact:true}).fill(c.email);await page.getByLabel("Password",{exact:true}).fill(c.password);
  const response=page.waitForResponse(r=>new URL(r.url()).pathname==="/api/identity/login"&&r.request().method()==="POST");await page.getByRole("button",{name:"Sign in",exact:true}).click();expect((await response).status()).toBe(200);const session=await(await page.request.get("/api/identity/session")).json();expect(session.data.role).toBe("child");expect((await page.request.get(query(edu.references.he!,"learner"))).status()).toBe(403);expect((await page.request.get(query(edu.references.he!,"teacher"))).status()).toBe(403);
 });
}
