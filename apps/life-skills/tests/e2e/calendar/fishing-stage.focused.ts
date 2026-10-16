/** Actual retained routes, ordinary separate logins, disposable synthetic native
 * data only. These tests may NOT run before the exact native/browser recipe ACK. */
import {test,expect,type Page,type Browser,type BrowserContext,type Request,type Response,type ConsoleMessage,type Dialog} from "@playwright/test";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {readFileSync} from "node:fs";
import type {FishingStageBrowserData} from "./fishing-stage-fixture.ts";
import {fishingCalendarSearch,fishingCalendarChoicesSchema,fishingCalendarSelectionSchema,fishingCalendarSelectionQuery} from "../../../src/features/fishing/program-calendar-contract.ts";
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
 /** Observe only responses already requested by the UI. Never retain a DTO,
  * context identifier, query, header, token, lesson, raw error or user input. */
 function observeCalendar(page:Page){
  type Entry={method:"GET";pathname:string;status:number;bodyObserved:boolean;envelopeValid?:boolean;ok?:boolean;code?:string;choicesValid?:boolean;planSelectionValid?:boolean;planSelectionCanonicalMatch?:boolean;planSelectionJsonMatch?:boolean;planRoleMatch?:boolean};
  const events:Entry[]=[],pending=new Set<Promise<void>>();let sealed=false;
  const paths=["/api/calendar/fishing/context","/api/calendar/fishing/plan","/api/calendar/fishing/timeline"],codes=["INVALID_REQUEST","UNAUTHENTICATED","FORBIDDEN","NOT_FOUND","CONFLICT","PAYLOAD_TOO_LARGE","UNSUPPORTED_MEDIA_TYPE","RATE_LIMITED","UNAVAILABLE","INTERNAL"];
  const observed=(response:Response)=>{
   const url=new URL(response.url());if(events.length>=48||url.origin!==data.origin||!paths.includes(url.pathname)||response.request().method()!=="GET")return;
   const event:Entry={method:"GET",pathname:url.pathname,status:response.status(),bodyObserved:false};events.push(event);if(pending.size>=4)return;
   const location=new URL(page.url()),query=new URLSearchParams();for(const key of["learnerId","enrollmentId","cohortId","stageId","stage"])for(const value of location.searchParams.getAll(key))query.append(key,value);
   let expected:ReturnType<typeof fishingCalendarSelectionQuery>|null=null;try{expected=fishingCalendarSelectionQuery(query);}catch{/* No selected context; no inferred child. */}
   const role=/^\/(?:en|he)\/family(?:\/|$)/.test(location.pathname)?"parent":/^\/(?:en|he)\/app(?:\/|$)/.test(location.pathname)?"practitioner":null;
   const reading=response.json().then((raw:unknown)=>{
    if(sealed)return;event.bodyObserved=true;
    if(!raw||typeof raw!=="object"||!("ok"in raw)||typeof raw.ok!=="boolean"){event.envelopeValid=false;return;}event.envelopeValid=true;event.ok=raw.ok;
    if(!raw.ok){if("error"in raw&&raw.error&&typeof raw.error==="object"&&"code"in raw.error&&typeof raw.error.code==="string"&&codes.includes(raw.error.code))event.code=raw.error.code;return;}
    if(!("data"in raw)){event.envelopeValid=false;return;}
    if(url.pathname==="/api/calendar/fishing/context")event.choicesValid=fishingCalendarChoicesSchema.safeParse(raw.data).success;
    if(url.pathname==="/api/calendar/fishing/plan"){
     const value=raw.data;if(!value||typeof value!=="object")return;
     const parsed=fishingCalendarSelectionSchema.safeParse("selection"in value?value.selection:null);event.planSelectionValid=parsed.success;
     if(parsed.success&&expected){event.planSelectionCanonicalMatch=fishingCalendarSearch(parsed.data)===fishingCalendarSearch(expected);event.planSelectionJsonMatch=JSON.stringify("selection"in value?value.selection:null)===JSON.stringify(expected);}
     if(role&&"view"in value)event.planRoleMatch=value.view===null||!!value.view&&typeof value.view==="object"&&"role"in value.view&&value.view.role===role;
    }
   }).catch(()=>{if(!sealed)event.bodyObserved=false;}).finally(()=>{pending.delete(reading);});pending.add(reading);
  };
  page.on("response",observed);
  return async(failed:boolean)=>{
   page.off("response",observed);let timer:ReturnType<typeof setTimeout>|undefined;
   try{await Promise.race([Promise.allSettled([...pending]),new Promise<void>(resolve=>{timer=setTimeout(resolve,1000);})]);}finally{if(timer)clearTimeout(timer);sealed=true;}
   if(failed)console.log("SYNTHETIC_CALENDAR_DIAGNOSTIC "+JSON.stringify({events,pendingReads:pending.size}));
  };
 }
 const calendarObservers=new WeakMap<Page,ReturnType<typeof observeCalendar>>();
 test.beforeEach(({page})=>{calendarObservers.set(page,observeCalendar(page));});
 test.afterEach(async({page},info)=>{try{await calendarObservers.get(page)?.(info.status!==info.expectedStatus);}finally{calendarObservers.delete(page);}});
 async function login(page:Page,role:string,target:string,locale:string){
  const credentials=data.credentials.find(c=>c.role===role);if(!credentials)throw Error("EXACT_SYNTHETIC_ROLE_REQUIRED");
  const expected=new URL(target,data.origin),sameTarget=(url:URL)=>url.origin===expected.origin&&url.pathname===expected.pathname&&url.hash===''&&JSON.stringify([...url.searchParams].sort())===JSON.stringify([...expected.searchParams].sort());
  // Fixed categories only: never retain raw URLs, console text, errors, input
  // values, request bodies, headers, credentials or response payloads.
  const identityPaths=["/api/identity/csrf","/api/identity/login","/api/identity/session"],events:{kind:string;method:string;pathname:string;status?:number;failure?:string}[]=[],categories=new Set<string>();
  const state:{phase:string;documentComplete?:boolean;documentInteractive?:boolean;formPresent?:boolean;formValid?:boolean;responseHasScriptNonce?:boolean;scriptCount?:number;scriptsWithNonce?:number;scriptsMatchingResponseNonce?:number;scriptsMissingNonce?:number;hasNextRuntime?:boolean;flightQueuePresent?:boolean;flightQueueLength?:number;flightQueueConsumed?:boolean;reactRootPresent?:boolean;initialSessionObserved:boolean;passwordToggleResponded:boolean;scriptRequests:number;scriptResponses:number;scriptFailures:number;script4xx:number;script5xx:number;scriptMimeJavaScript:number;scriptMimeHtml:number;scriptMimeOther:number}={phase:"private-route",initialSessionObserved:false,passwordToggleResponded:false,scriptRequests:0,scriptResponses:0,scriptFailures:0,script4xx:0,script5xx:0,scriptMimeJavaScript:0,scriptMimeHtml:0,scriptMimeOther:0};let passed=false,responseNonce:string|null=null;
  const identity=(request:Request)=>{const url=new URL(request.url()),method=request.method();return url.origin===data.origin&&identityPaths.includes(url.pathname)&&["GET","POST","HEAD","OPTIONS"].includes(method)?{method,pathname:url.pathname}:null;};
  const record=(event:typeof events[number])=>{if(events.length<48)events.push(event);};
  const requestedIdentity=(request:Request)=>{const item=identity(request);if(item)record({kind:"request",...item});if(request.resourceType()==="script"&&new URL(request.url()).origin===data.origin)state.scriptRequests++;};
  const respondedIdentity=(response:Response)=>{
   const item=identity(response.request());if(item)record({kind:"response",...item,status:response.status()});
   const url=new URL(response.url());
   if(url.origin===data.origin&&response.request().resourceType()==="script"){state.scriptResponses++;if(response.status()>=400&&response.status()<500)state.script4xx++;if(response.status()>=500)state.script5xx++;const mime=(response.headers()["content-type"]??"").split(";",1)[0]!.trim().toLowerCase();if(["application/javascript","text/javascript","application/ecmascript","text/ecmascript","application/x-javascript"].includes(mime))state.scriptMimeJavaScript++;else if(mime==="text/html")state.scriptMimeHtml++;else state.scriptMimeOther++;}
   if(url.origin===data.origin&&url.pathname===`/${locale}/login`&&response.request().resourceType()==="document"&&response.request().frame()===page.mainFrame()){
    // The policy and nonce live only in this closure, never in evidence output.
    const directive=(response.headers()["content-security-policy"]??"").split(";").map(value=>value.trim()).find(value=>value.startsWith("script-src "));
    responseNonce=directive?.split(/\s+/).map(value=>/^'nonce-([A-Za-z0-9+/_-]+={0,2})'$/.exec(value)?.[1]).find(value=>value!==undefined)??null;
   }
  };
  const failedIdentity=(request:Request)=>{const item=identity(request);if(item){const code=request.failure()?.errorText??"";record({kind:"failure",...item,failure:["net::ERR_ABORTED","net::ERR_CONNECTION_REFUSED","net::ERR_CONNECTION_RESET","net::ERR_FAILED","net::ERR_CERT_AUTHORITY_INVALID"].includes(code)?code:"OTHER_NETWORK_FAILURE"});}if(request.resourceType()==="script"&&new URL(request.url()).origin===data.origin)state.scriptFailures++;};
  const classify=(text:string)=>{
   if(/content.security.policy|\bCSP\b|refused to (?:load|execute|connect)/i.test(text)){
    if(/script-src|(?:inline|external) script|javascript|unsafe-eval/i.test(text))return /unsafe-eval|evaluat/i.test(text)?"CSP_SCRIPT_EVAL":/inline/i.test(text)?"CSP_SCRIPT_INLINE":/external|load(?:ing)? (?:the )?script/i.test(text)?"CSP_SCRIPT_EXTERNAL":"CSP_SCRIPT_OTHER";
    if(/style-src|stylesheet|inline style/i.test(text))return /inline/i.test(text)?"CSP_STYLE_INLINE":"CSP_STYLE_EXTERNAL";
    return /connect-src|connect to/i.test(text)?"CSP_CONNECT":"CSP_OTHER";
   }
   return /ChunkLoadError|loading chunk|failed to fetch dynamically imported module/i.test(text)?"CHUNK":/hydrat/i.test(text)?"HYDRATION":"JS_RUNTIME";
  };
  const pageError=(error:Error)=>{categories.add(classify(error.message));};
  const consoleError=(message:ConsoleMessage)=>{if(message.type()==="error")categories.add(classify(message.text()));};
  const startupSnapshot=()=>page.evaluate(nonce=>{
   const form=document.querySelector("form"),scripts=[...document.scripts],withNonce=scripts.filter(script=>script.nonce!==""),runtime=window as Window&{next?:{appDir?:unknown};__next_f?:unknown},queue=runtime.__next_f;
   return {documentComplete:document.readyState==="complete",documentInteractive:document.readyState==="interactive",formPresent:form!==null,formValid:form?.checkValidity()??false,responseHasScriptNonce:nonce!==null,scriptCount:scripts.length,scriptsWithNonce:withNonce.length,scriptsMatchingResponseNonce:nonce===null?0:withNonce.filter(script=>script.nonce===nonce).length,scriptsMissingNonce:scripts.length-withNonce.length,hasNextRuntime:runtime.next?.appDir===true,flightQueuePresent:Array.isArray(queue),flightQueueLength:Array.isArray(queue)?queue.length:0,flightQueueConsumed:Array.isArray(queue)&&queue.push!==Array.prototype.push,reactRootPresent:Object.getOwnPropertyNames(document).some(key=>key.startsWith("__reactContainer$"))};
  },responseNonce);
  page.on("request",requestedIdentity);page.on("response",respondedIdentity);page.on("requestfailed",failedIdentity);page.on("pageerror",pageError);page.on("console",consoleError);
  try{
  expect((await page.context().cookies(data.origin)).filter(cookie=>cookie.name==='__Host-ls-session')).toHaveLength(0);
  // Observe the page's OWN mount effect. No test-issued auth API or session.
  const initialSession=page.waitForResponse(response=>{const url=new URL(response.url());return url.origin===data.origin&&url.pathname==="/api/identity/session"&&response.request().method()==="GET";});void initialSession.catch(()=>undefined);
  // Start at the original PRIVATE route: its proxy/layout must retain context.
  await page.goto(target);await expect(page).toHaveURL(url=>url.pathname===`/${locale}/login`,{timeout:45000});
  const requested=new URL(page.url()).searchParams.getAll('next');expect(requested).toHaveLength(1);expect(sameTarget(new URL(requested[0]!,data.origin))).toBe(true);
  Object.assign(state,await startupSnapshot());
  state.phase="empty-password-toggle";const password=page.getByLabel(t(locale,"Password","סיסמה"),{exact:true}),show=page.getByRole("button",{name:t(locale,"Show password","הצגת סיסמה"),exact:true});await expect(password).toHaveValue("");await expect(show).toHaveAttribute("aria-pressed","false");await show.click();const hide=page.getByRole("button",{name:t(locale,"Hide password","הסתרת סיסמה"),exact:true});await expect(hide).toHaveAttribute("aria-pressed","true");await expect(password).toHaveAttribute("type","text");state.passwordToggleResponded=true;await hide.click();await expect(show).toHaveAttribute("aria-pressed","false");await expect(password).toHaveAttribute("type","password");await expect(password).toHaveValue("");
  state.phase="await-initial-session";expect((await initialSession).status()).toBe(401);state.initialSessionObserved=true;
  state.phase="fill-ordinary-login";
  await page.getByLabel(t(locale,"Email","דוא״ל"),{exact:true}).fill(credentials.email);await password.fill(credentials.password);
  state.formValid=await page.evaluate(()=>document.querySelector("form")?.checkValidity()??false);
  state.phase="click-ordinary-login";
  const response=page.waitForResponse(r=>new URL(r.url()).pathname==="/api/identity/login"&&r.request().method()==="POST");await page.getByRole("button",{name:t(locale,"Sign in","כניסה"),exact:true}).click();state.phase="await-login-response";expect((await response).status()).toBe(200);state.phase="await-private-return";await expect(page).toHaveURL(sameTarget,{timeout:45000});passed=true;
  }finally{
   if(!passed&&!page.isClosed())try{Object.assign(state,await startupSnapshot());}catch{/* Keep the original failure; never serialize the page error. */}
   page.off("request",requestedIdentity);page.off("response",respondedIdentity);page.off("requestfailed",failedIdentity);page.off("pageerror",pageError);page.off("console",consoleError);
   if(!passed){const body=JSON.stringify({state,events,categories:[...categories].sort()});console.log("SYNTHETIC_LOGIN_DIAGNOSTIC "+body);await test.info().attach("synthetic-login-diagnostic",{body,contentType:"application/json"});}
  }
 }
 async function separate(browser:Browser,page:Page,contexts:BrowserContext[]){const viewport=page.viewportSize();if(!viewport)throw Error("VIEWPORT_REQUIRED");const c=await browser.newContext({baseURL:data.origin,ignoreHTTPSErrors:true,viewport,isMobile:viewport.width<=390,hasTouch:viewport.width<=768});contexts.push(c);return c.newPage();}
 async function closePractitionerContexts(contexts:BrowserContext[],primaryFailed:boolean){
  const results=await Promise.allSettled(contexts.map(async context=>context.close())),failed=results.filter(result=>result.status==="rejected").length;
  if(failed){console.log("SYNTHETIC_PRACTITIONER_CLEANUP "+JSON.stringify({failedContexts:failed,primaryFailed}));if(!primaryFailed)throw Error("SYNTHETIC_PRACTITIONER_CONTEXT_CLEANUP_FAILED");}
 }
 async function chooseSession(page:Page,form:ReturnType<Page["getByRole"]>,locale:string,id:string){
  const control=form.getByRole("combobox",{name:t(locale,"Session","מפגש"),exact:true}),message=t(locale,"Replace the unsaved session draft?","להחליף את טיוטת המפגש שלא נשמרה?");let decision:Promise<void>|null=null,confirmed=false,unexpected=false;
  const handle=(dialog:Dialog)=>{
   if(decision!==null||dialog.type()!=="confirm"||dialog.message()!==message){unexpected=true;decision=dialog.dismiss();}
   else{confirmed=true;decision=dialog.accept();}
   void decision.catch(()=>undefined);
  };
  page.on("dialog",handle);
  try{
   await control.selectOption(id);if(decision)await decision;if(unexpected)throw Error("UNEXPECTED_SYNTHETIC_SESSION_DIALOG");expect(confirmed).toBe(true);await expect(control).toHaveValue(id);
  }finally{page.off("dialog",handle);}
 }
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
   const contexts:BrowserContext[]=[];let primaryFailed=false,phase="open-current-plan";try{
   const operator={...family(locale).selection,learnerId:null,enrollmentId:null};await login(page,"practitioner",route(locale,"practitioner")+'&'+fishingCalendarSearch(operator),locale);const event=page.locator(`[data-fishing-occurrence-id="${data.occurrenceId}"]:visible`);await expect(event).toHaveCount(1);await event.getByRole("button").click();
   phase="open-editor";await page.getByRole("button",{name:t(locale,"Manage this stage","ניהול השלב"),exact:true}).click();const form=page.getByRole("form",{name:t(locale,"Manage fishing stage","ניהול שלב הדיג"),exact:true});
   phase="select-session";await form.getByLabel(t(locale,"Action","פעולה"),{exact:true}).selectOption("revise");await chooseSession(page,form,locale,data.occurrenceId);
   phase="fill-main-draft";const note=form.getByLabel(t(locale,"Family-visible logistical note","הערה לוגיסטית המוצגת למשפחות"),{exact:true}),draft="Synthetic retained draft / טיוטה סינתטית ".repeat(20);await note.fill(draft);await form.getByRole("textbox",{name:t(locale,"Reason visible to the enrolled family","סיבה המוצגת למשפחה הרשומה"),exact:true}).fill("Synthetic deliberate UI revision");
   // A second ordinary session saves a real competing native revision. No
   // fabricated 409 or permissive replacement adapter supplies this conflict.
   phase="second-login";const other=await separate(browser,page,contexts);await login(other,"practitioner",page.url().replace(data.origin,""),locale);await other.getByRole("button",{name:t(locale,"Manage this stage","ניהול השלב"),exact:true}).click();
   phase="second-edit";const otherForm=other.getByRole("form",{name:t(locale,"Manage fishing stage","ניהול שלב הדיג"),exact:true});await otherForm.getByLabel(t(locale,"Action","פעולה"),{exact:true}).selectOption("revise");await chooseSession(other,otherForm,locale,data.occurrenceId);await otherForm.getByLabel(t(locale,"Family-visible logistical note","הערה לוגיסטית המוצגת למשפחות"),{exact:true}).fill("Synthetic competing native revision");await otherForm.getByRole("textbox",{name:t(locale,"Reason visible to the enrolled family","סיבה המוצגת למשפחה הרשומה"),exact:true}).fill("Synthetic second-session revision");
   phase="competing-save";const competing=other.waitForResponse(r=>new URL(r.url()).pathname==="/api/calendar/fishing/command"&&r.request().method()==="POST");await otherForm.getByRole("button",{name:t(locale,"Save deliberate action","שמירת הפעולה שנבחרה"),exact:true}).click();expect((await competing).status()).toBe(200);
   phase="stale-save";const stale=page.waitForResponse(r=>new URL(r.url()).pathname==="/api/calendar/fishing/command"&&r.request().method()==="POST");await form.getByRole("button",{name:t(locale,"Save deliberate action","שמירת הפעולה שנבחרה"),exact:true}).click();expect((await stale).status()).toBe(409);await expect(page.getByRole("alert").filter({hasText:t(locale,"saved version, capacity or approval changed","הגרסה, הקיבולת או האישור השתנו")})).toBeVisible();await expect(note).toHaveValue(draft);
   phase="reload-ack";await page.getByRole("button",{name:t(locale,"Reload current access and plan","טעינת הרשאות ותוכנית עדכניות"),exact:true}).click();await expect(note).toHaveValue(draft);await form.getByRole("button",{name:t(locale,"Use current revision, keep my draft","שימוש בגרסה הנוכחית ושמירת הטיוטה"),exact:true}).click();
   phase="accepted-save-reload";const pending=page.waitForResponse(r=>new URL(r.url()).pathname==="/api/calendar/fishing/command"&&r.request().method()==="POST");await form.getByRole("button",{name:t(locale,"Save deliberate action","שמירת הפעולה שנבחרה"),exact:true}).click();expect((await pending).status()).toBe(200);await page.reload();const full=await openPlan(page,locale);await expect(full.getByText(draft,{exact:true})).toBeVisible();
   phase="saved-plan-screen";await screen(page,locale,info.outputPath(`practitioner-${locale}-saved-plan.png`));
   phase="agenda-screen";await page.goto(route(locale,"practitioner",false,"agenda"));await expect(page.locator(`[data-fishing-occurrence-id="${data.occurrenceId}"]:visible`)).toHaveCount(1);await expect(page.locator('[data-ls-calendar-grid]:visible')).toHaveCount(0);await screen(page,locale,info.outputPath(`practitioner-${locale}-agenda.png`));
   }catch(error){primaryFailed=true;console.log("SYNTHETIC_PRACTITIONER_PHASE "+JSON.stringify({phase}));throw error;}finally{await closePractitionerContexts(contexts,primaryFailed);}
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
  async function action(kind:string,occurrenceId:string){await page.getByRole("button",{name:"Manage this stage",exact:true}).click();const form=page.getByRole("form",{name:"Manage fishing stage",exact:true});await form.getByLabel("Action",{exact:true}).selectOption(kind);await chooseSession(page,form,locale,occurrenceId);await form.getByRole("textbox",{name:"Reason visible to the enrolled family",exact:true}).fill("Synthetic explicit "+kind);return form;}
  async function save(form:ReturnType<Page["getByRole"]>){const response=page.waitForResponse(r=>new URL(r.url()).pathname==="/api/calendar/fishing/command"&&r.request().method()==="POST");await form.getByRole("button",{name:"Save deliberate action",exact:true}).click();expect((await response).status()).toBe(200);await expect(form).toHaveCount(0);}
  await save(await action("complete",data.pastOccurrenceId));const attendance=await action("attendance",data.pastOccurrenceId);await expect(attendance.getByRole("button",{name:"Save deliberate action",exact:true})).toBeDisabled();await attendance.getByRole("combobox",{name:"Confirmed participant",exact:true}).selectOption(family(locale).selection.enrollmentId!);await attendance.getByRole("combobox",{name:"Actual attendance",exact:true}).selectOption("present");await save(attendance);
  const cancellation=await action("cancel",data.occurrenceId);await expect(cancellation.getByRole("alert")).toContainText("undelivered service");await save(cancellation);await page.reload();
  const canonical=await page.request.get("/api/calendar/fishing/plan?"+fishingCalendarSearch(selection));expect(canonical.status()).toBe(200);const view=(await canonical.json()).data.view;expect(view.occurrences.find((o:{id:string})=>o.id===data.pastOccurrenceId).state).toBe("completed");expect(view.occurrences.find((o:{id:string})=>o.id===data.occurrenceId).state).toBe("cancelled");expect(view.attendance).toHaveLength(1);expect(view.attendance[0]).toMatchObject({enrollmentId:family(locale).selection.enrollmentId,occurrenceId:data.pastOccurrenceId,state:"present"});await screen(page,locale,info.outputPath("operator-completion-attendance-cancellation.png"));
 });
}
