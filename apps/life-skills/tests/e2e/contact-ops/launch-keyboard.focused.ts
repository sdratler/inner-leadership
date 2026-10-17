/** OPS-09 supplement, not the older functional suite or a sample journey.
 * Actual Tab/keyboard input on retained pages; one response is lost only AFTER
 * native commit. Test credentials live solely in the disposable runtime file.
 */
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {expect,test,type Locator,type Page} from "@playwright/test";
import copy from "../../../src/features/group-application/presentation-copy.json" with {type:"json"};
import coreCopy from "../../../src/features/group-application/jlfa-core-copy.json" with {type:"json"};

const fixturePath=process.env.LS_GROUP_INTEREST_FIXTURE_PATH;
if(process.env.LS_RM_LAUNCH_OPS09_ONLY!=="true"||process.env.LS_FISHING_LEAD_UI_ONLY!=="true"||!fixturePath)throw Error("OPS09_EXCLUSIVE_FIXTURE_REQUIRED");
const runtime=JSON.parse(readFileSync(fixturePath,"utf8")) as {origin:string;fishing:{credentials:{role:string;email:string;password:string}[]}};
const projects:Record<string,{port:number;width:number;height:number}>={desktop:{port:3105,width:1440,height:1000},mobile390:{port:3106,width:390,height:844},mobile340:{port:3107,width:340,height:844},tablet768:{port:3108,width:768,height:1024}};
const selected=process.env.LS_GROUP_INTEREST_TEST_PROJECT,project=selected?projects[selected]:undefined;
if(!project||runtime.origin!==`https://localhost:${project.port}`||!runtime.fishing)throw Error("OPS09_PROJECT_ORIGIN_MISMATCH");
test.use({baseURL:runtime.origin});

async function visibleFocus(control:Locator){
 await expect(control).toBeFocused();await expect(control).toBeVisible();
 expect(await control.evaluate(element=>{
  const rect=element.getBoundingClientRect(),style=getComputedStyle(element),front=document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2);
  return {inside:rect.left>=0&&rect.top>=0&&rect.right<=innerWidth+1&&rect.bottom<=innerHeight+1,
   uncovered:!!front&&(element.contains(front)||front.contains(element)),
   ring:style.outlineStyle!=="none"&&parseFloat(style.outlineWidth)>=1&&style.outlineColor!=="transparent"&&!/rgba\([^)]*,\s*0(?:\.0+)?\)$/.test(style.outlineColor)&&Number(style.opacity)>0};
 })).toEqual({inside:true,uncovered:true,ring:true});
}
async function tabTo(page:Page,control:Locator){
 // Never focus(), click(), fill(), DOM dispatch or change tabindex to get past
 // a broken traversal. Every control must be reached by the actual Tab order.
 for(let step=0;step<120;step++){
  if(await control.isVisible()&&await control.evaluate(element=>element===document.activeElement)){await visibleFocus(control);return;}
  await page.keyboard.press("Tab");
 }
 throw Error("OPS09_CONTROL_NOT_REACHED_BY_TAB");
}
async function typeInto(page:Page,control:Locator,text:string){await tabTo(page,control);await page.keyboard.type(text);expect(await control.inputValue()===text).toBe(true);}
async function noClipping(page:Page){expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);}

for(const locale of ["en","he"] as const)test(`OPS09 ${locale}: public keyboard validation, exact native save retry and ordinary owner readback`,async({page},info)=>{
 test.setTimeout(120000);
 expect(page.viewportSize()).toEqual({width:project.width,height:project.height});
 const t=(en:string,he:string)=>locale==="he"?he:en;
 const inquiry=copy.realMensch.inquiry,form=page.locator('form[data-inquiry-kind="parent"]');
 const name=`Synthetic OPS09 ${locale}`,contact=locale==="en"?"+13055550121":"synthetic-owner-inquiry@example.invalid";
 expect((await page.request.get("/api/private/group-applications")).status()).toBe(401);
 expect((await page.goto(`/${locale}/florida`))?.status()).toBe(200);
 await expect(page.locator(`div[lang="${locale}"][dir="${locale==="he"?"rtl":"ltr"}"]`).first()).toBeVisible();
 await expect(page.getByRole("heading",{level:1,name:copy.realMensch.academy.title[locale],exact:true})).toBeVisible();
 await expect(page).toHaveTitle("South Florida Jewish Leadership Fishing Academy");
 expect(await page.locator("[data-jlfa-primary]").evaluate(a=>getComputedStyle(a).backgroundColor)).toBe("rgb(5, 45, 80)");
 const logo="/groups/brand/jlfa-logo-locked-v1.png",logos=page.locator(`img[src="${logo}"]`),image=await page.request.get(logo);
 expect(image.status()).toBe(200);const logoBytes=await image.body();expect(logoBytes.length).toBe(1701549);
 expect(createHash("sha256").update(logoBytes).digest("hex")).toBe("e78ff6d3ef16c37613725507ce14da05883734a77f48b78ab9d6df3f92480356");
 await expect(logos).toHaveCount(2);await expect.poll(()=>logos.evaluateAll(images=>images.every(image=>(image as HTMLImageElement).complete&&(image as HTMLImageElement).naturalWidth===1254&&(image as HTMLImageElement).naturalHeight===1254))).toBe(true);
 const framed=await page.locator("[data-jlfa-logo-window]").evaluate(frame=>{const img=frame.querySelector("img")!,a=frame.getBoundingClientRect(),b=img.getBoundingClientRect(),scale=b.width/1254;return{left:a.left,top:(a.top-b.top)/scale,height:a.height/scale,x:a.left-b.left,objectFit:getComputedStyle(img).objectFit};});
 expect(framed.left).toBeLessThan(project.width/2);expect(Math.abs(framed.top-100)).toBeLessThan(1.5);expect(Math.abs(framed.height-1000)).toBeLessThan(1.5);expect(Math.abs(framed.x)).toBeLessThan(.5);expect(framed.objectFit).toBe("contain");
 const full=await page.locator("[data-jlfa-footer-logo] img").evaluate(img=>{const r=img.getBoundingClientRect(),p=img.parentElement!.getBoundingClientRect();return{ratio:r.width/r.height,whole:p.left<=r.left&&p.right>=r.right&&p.top<=r.top&&p.bottom>=r.bottom,fit:getComputedStyle(img).objectFit};});
 expect(full).toEqual({ratio:1,whole:true,fit:"contain"});expect(await page.locator("header").evaluate(header=>getComputedStyle(header).position)).toBe("static");
 expect(await page.locator("h1").evaluate(h=>{const range=document.createRange();range.selectNodeContents(h);return[...range.getClientRects()].every(r=>r.left>=0&&r.right<=innerWidth+1);})).toBe(true);
 const curriculum=page.getByRole("button",{name:t("Explore the program","הכירו את התוכנית"),exact:true}),dialog=page.locator("[data-jlfa-curriculum-dialog]");
 await expect(dialog).not.toBeVisible();await expect(page.locator("[data-jlfa-curriculum-content]")).toHaveCount(0);
 await tabTo(page,curriculum);await page.keyboard.press("Enter");await expect(dialog).toBeVisible();
 await expect(dialog.getByRole("heading",{name:t("Program overview","סקירת התוכנית"),exact:true})).toBeFocused();
 await expect(dialog.locator("[data-jlfa-stage]")).toHaveCount(4);for(const index of [27,28,29,30,32,33,34,35,37,38,39,40,42,43,44,45])await expect(dialog).toContainText(coreCopy.nodes[index]![locale]);
 for(const skill of copy.realMensch.extraSections.skills.items)await expect(dialog).toContainText(skill[locale]);
 expect(await dialog.evaluate(d=>[...d.querySelectorAll("h2,h3,h4,p,li,button")].every(e=>{const range=document.createRange();range.selectNodeContents(e);return[...range.getClientRects()].every(r=>r.left>=0&&r.right<=innerWidth+1);}))).toBe(true);
 await page.screenshot({path:info.outputPath(`ops09-curriculum-focus-${locale}-${info.project.name}.png`)});
 await page.keyboard.press("Escape");await expect(dialog).not.toBeVisible();await expect(curriculum).toBeFocused();await visibleFocus(curriculum);
 await page.keyboard.press("Enter");await expect(dialog).toBeVisible();await tabTo(page,dialog.getByRole("button",{name:t("Close","סגירה"),exact:true}));await page.keyboard.press("Enter");await expect(dialog).not.toBeVisible();await expect(curriculum).toBeFocused();
 const groups=page.locator("[data-jlfa-faq-group]");await expect(groups).toHaveCount(3);await expect(page.locator("[data-jlfa-faq-question]")).toHaveCount(11);
 expect(await groups.evaluateAll(items=>items.every(item=>!item.hasAttribute("open")))).toBe(true);
 const seenFaqIndexes:number[]=[];for(const group of await groups.all()){
  const summary=group.locator(":scope > summary");await tabTo(page,summary);await page.keyboard.press("Space");
  for(const question of await group.locator("[data-jlfa-faq-question]").all()){
   const summary=question.locator("summary"),answer=question.locator("p"),sourceIndex=Number(await question.getAttribute("data-jlfa-faq-question")),source=copy.realMensch.academy.faqs[sourceIndex]!;seenFaqIndexes.push(sourceIndex);
   await expect(summary).toHaveText(source[0]![locale]);await expect(answer).not.toBeVisible();await tabTo(page,summary);await page.keyboard.press("Space");await expect(answer).toBeVisible();await expect(answer).toHaveText(source[1]![locale]);await page.keyboard.press("Space");await expect(answer).not.toBeVisible();
  }
  await tabTo(page,summary);await page.keyboard.press("Space");
 }
 expect(seenFaqIndexes.sort((a,b)=>a-b)).toEqual(Array.from({length:11},(_,i)=>i));expect(await groups.evaluateAll(items=>items.every(item=>!item.hasAttribute("open")))).toBe(true);
 await page.evaluate(()=>window.scrollTo(0,0));await noClipping(page);await page.screenshot({path:info.outputPath(`ops09-landing-${locale}-${info.project.name}.png`),fullPage:true});
 if(project.width<=980){
  const menu=page.locator('header button[aria-controls="florida-page-nav"]');await expect(menu).toHaveAccessibleName(t("Open navigation","פתיחת ניווט"));
  await tabTo(page,menu);await page.keyboard.press("Space");await expect(menu).toHaveAttribute("aria-expanded","true");await expect(menu).toHaveAccessibleName(t("Close navigation","סגירת ניווט"));
  await expect(page.getByRole("navigation",{name:t("Page navigation","ניווט בדף"),exact:true})).toBeVisible();
  await page.keyboard.press("Space");await expect(menu).toHaveAttribute("aria-expanded","false");
  await page.keyboard.press("Space");await expect(menu).toHaveAttribute("aria-expanded","true");await tabTo(page,page.locator('#florida-page-nav a[href="#about"]'));await page.keyboard.press("Enter");await expect(menu).toHaveAttribute("aria-expanded","false");
 }
 const cta=page.locator('main a[href="#apply"]').first();await tabTo(page,cta);await page.keyboard.press("Enter");
 await expect(form).toBeVisible();
 const submit=form.getByRole("button",{name:inquiry.submit[locale],exact:true});await expect(submit).toBeEnabled();
 let posts=0;page.on("request",request=>{if(request.method()==="POST"&&new URL(request.url()).pathname==="/api/public/group-applications")posts++;});
 await tabTo(page,submit);await page.keyboard.press("Enter");
 const error=form.getByRole("alert");await expect(error).toContainText(t("required contact","פרטי הקשר"));await visibleFocus(error);expect(posts).toBe(0);
 await page.screenshot({path:info.outputPath(`ops09-validation-focus-${locale}-${info.project.name}.png`)});
 await typeInto(page,form.locator('[name="parentName"]'),name);
 await typeInto(page,form.locator('[name="contact"]'),contact);
 await typeInto(page,form.locator('[name="cityArea"]'),"Synthetic Florida");
 await typeInto(page,form.locator('[name="learnerAge-0"]'),"12");
 const sunday=form.locator('[name="schedulePreference"][value="sunday"]');await tabTo(page,sunday);await page.keyboard.press("Space");await expect(sunday).toBeChecked();
 const permission=form.locator('[name="permission"]');await tabTo(page,permission);await page.keyboard.press("Space");await expect(permission).toBeChecked();
 const endpoint="**/api/public/group-applications?program=sunday_fishing_academy";
 let savedId="",requestBytes="",commits=0;
 await page.route(endpoint,async route=>{
  if(route.request().method()!=="POST")return route.continue();
  requestBytes=route.request().postData()!;
  const upstream=await route.fetch({headers:{...route.request().headers(),origin:runtime.origin,"sec-fetch-site":"same-origin"}});
  expect(upstream.status()).toBe(201);const body=await upstream.json();savedId=body.data.item.id;commits++;
  await route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({ok:false,error:{code:"UNAVAILABLE"}})});
 });
 await tabTo(page,submit);await page.keyboard.press("Enter");
 await expect(error).toContainText(inquiry.unknownResult[locale]);await visibleFocus(error);
 expect(commits).toBe(1);expect(savedId).not.toBe("");expect(posts).toBe(1);
 await expect(form.locator('[name="parentName"]')).toHaveValue(name);await expect(form.locator('[name="contact"]')).toHaveValue(contact);
 await expect(form.locator('[name="parentName"]')).toBeDisabled();await noClipping(page);
 await page.screenshot({path:info.outputPath(`ops09-unknown-save-focus-${locale}-${info.project.name}.png`)});
 await page.unroute(endpoint);
 const retry=form.getByRole("button",{name:inquiry.retrySameSave[locale],exact:true});await tabTo(page,retry);
 const retried=page.waitForResponse(response=>response.request().method()==="POST"&&new URL(response.url()).pathname==="/api/public/group-applications");
 await page.keyboard.press("Enter");const response=await retried;
 expect(response.status()).toBe(200);expect(createHash("sha256").update(response.request().postData()!).digest("hex")).toBe(createHash("sha256").update(requestBytes).digest("hex"));
 expect(await response.json()).toMatchObject({ok:true,data:{saved:true,replayed:true,duplicate:true,item:{id:savedId,fields:{parentName:name,contact,programId:"sunday_fishing_academy"}}}});
 const status=form.getByRole("status");await expect(status).toContainText(inquiry.savedTitle[locale]);await expect(status).toContainText(savedId);
 await expect(error).toHaveCount(0);expect(posts).toBe(2);await visibleFocus(status);await noClipping(page);
 await page.screenshot({path:info.outputPath(`ops09-saved-focus-${locale}-${info.project.name}.png`)});
 const target=`/${locale}/app/group-applications`,credentials=runtime.fishing.credentials.find(value=>value.role==="practitioner")!;
 await page.goto(`/${locale}/login?next=${encodeURIComponent(target)}`);
 await typeInto(page,page.getByLabel(t("Email","דוא״ל"),{exact:true}),credentials.email);
 await typeInto(page,page.getByLabel(t("Password","סיסמה"),{exact:true}),credentials.password);
 const login=page.waitForResponse(result=>new URL(result.url()).pathname==="/api/identity/login"&&result.request().method()==="POST");
 await tabTo(page,page.getByRole("button",{name:t("Sign in","כניסה"),exact:true}));await page.keyboard.press("Enter");expect((await login).status()).toBe(200);await expect(page).toHaveURL(target);
 const record=page.locator("article").filter({has:page.getByRole("heading",{name,exact:true})});
 const readback=async()=>{
  const result=await page.request.get("/api/private/group-applications");expect(result.status()).toBe(200);const body=await result.json();
  expect(body.data.items.filter((item:{id:string})=>item.id===savedId)).toEqual([expect.objectContaining({id:savedId,fields:expect.objectContaining({parentName:name,contact,programId:"sunday_fishing_academy"})})]);
  await expect(record).toHaveCount(1);await expect(record).toContainText(savedId);
 };
 await readback();await page.reload();await readback();
 const details=record.locator("details").filter({has:page.getByRole("region",{name:t("Fishing lead membership controls","בקרות שיוך לרשימת המתעניינים בדיג"),includeHidden:true})});
 const summary=details.locator("summary");await tabTo(page,summary);await page.keyboard.press("Enter");
 await expect(details.getByRole("button",{name:t("Add to Lead List","הוספה לרשימת המתעניינים"),exact:true})).toBeVisible();await visibleFocus(summary);await noClipping(page);
 await page.screenshot({path:info.outputPath(`ops09-owner-readback-focus-${locale}-${info.project.name}.png`)});
 // Deliberately NO Add/Remove, provider action, session injection or sample UI.
});
