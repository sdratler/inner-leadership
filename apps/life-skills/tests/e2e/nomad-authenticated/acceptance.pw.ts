import {expect,test} from "@playwright/test";
import {mkdirSync,writeFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {loadRuntime} from "./guards.ts";
const {path,runtime}=loadRuntime(process.env);
test.use({baseURL:runtime.origin});
test.beforeEach(async({context})=>{await context.route("**/*",route=>{if(new URL(route.request().url()).origin!==runtime.origin)throw Error("EXTERNAL_BROWSER_REQUEST_BLOCKED");return route.continue();});});
async function capture(page:import("@playwright/test").Page,name:string,width:number){
 await page.evaluate(()=>document.fonts.ready);const metrics=await page.evaluate(()=>({inner:innerWidth,client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,visual:visualViewport?.width}));
 expect(metrics).toEqual({inner:width,client:width,scroll:width,visual:width});
 const dir=dirname(path!);mkdirSync(dir,{recursive:true});
 const bytes=await page.screenshot({path:resolve(dir,name+".png"),fullPage:true});expect(bytes.readUInt32BE(16)).toBe(width);
 writeFileSync(resolve(dir,name+".json"),JSON.stringify(metrics));
}
for(const locale of ["en","he"] as const)test(locale+": real owner route hydrated selection, save, readback and exact replay",async({page,context},info)=>{
 if(!["desktop","mobile390"].includes(info.project.name))throw Error("R18_UNSUPPORTED_PROJECT");
 const c=runtime.cases[(info.project.name+"-"+locale) as keyof typeof runtime.cases],width=info.project.name==="desktop"?1440:390;
 await context.addCookies([{name:"__Host-ls-session",value:runtime.practitioner,url:runtime.origin,httpOnly:true,secure:true,sameSite:"Lax"}]);
 const get=page.waitForResponse(r=>r.request().method()==="GET"&&new URL(r.url()).pathname==="/api/private/contact-acquisition");
 const response=await page.goto("/"+locale+"/app/clients?section=needs_review&search="+encodeURIComponent(c.phone));
 expect(response?.status()).toBe(200);const body=await (await get).json();expect(body).toMatchObject({ok:true,data:{source:"native",total:1,items:[{id:c.candidateId,state:"NEEDS_REVIEW",matching:{state:"existing",people:[{personId:c.personId,eligible:true}]}}]}});
 const card=page.locator("article").filter({has:page.getByRole("heading",{name:c.name,exact:true})});await expect(card).toBeVisible();
 await expect(card.getByText(/previous caller|מתקשר קודם/)).toBeVisible();
 await expect(card.locator("details")).not.toHaveAttribute("open","");
 await capture(page,info.project.name+"-"+locale+"-needs-review",width);
 await card.locator("summary").focus();await page.keyboard.press("Enter");
 const match=card.getByRole("button",{name:locale==="he"?"שיוך לאיש קשר קיים":"Match existing person",exact:true});await expect(match).toBeDisabled();
 await card.getByRole("combobox",{name:locale==="he"?"איש קשר קיים":"Existing person",exact:true}).selectOption(c.personId);await expect(match).toBeEnabled();
 await capture(page,info.project.name+"-"+locale+"-selected",width);
 const sent=page.waitForRequest(r=>r.method()==="POST"&&new URL(r.url()).pathname==="/api/private/contact-acquisition");
 const saved=page.waitForResponse(r=>r.request().method()==="POST"&&new URL(r.url()).pathname==="/api/private/contact-acquisition");
 await match.click();const req=await sent,res=await saved;expect(res.status()).toBe(200);expect(await res.json()).toMatchObject({ok:true,data:{candidateId:c.candidateId,personId:c.personId,state:"MATCHED",replayed:false}});
 const command=req.postDataJSON(),csrf=req.headers()["x-csrf-token"];if(!csrf)throw Error("R18_CSRF_TOKEN_MISSING");
 const replay=await page.request.post("/api/private/contact-acquisition",{headers:{Origin:runtime.origin,"X-CSRF-Token":csrf},data:command});
 expect(replay.status()).toBe(200);expect(await replay.json()).toMatchObject({ok:true,data:{candidateId:c.candidateId,personId:c.personId,state:"MATCHED",replayed:true}});
 const reread=await page.request.get("/api/private/contact-acquisition?search="+encodeURIComponent(c.phone));expect(await reread.json()).toMatchObject({ok:true,data:{total:0,items:[]}});
 await expect(page.getByRole("link",{name:locale==="he"?"פתיחת איש הקשר":"Open person",exact:true})).toBeVisible();
 await page.getByRole("link",{name:locale==="he"?"פתיחת איש הקשר":"Open person",exact:true}).click();
 await expect(page.getByText(locale==="he"?"הודעות על שיחות נכנסות":"Incoming call notifications",{exact:true})).toBeVisible();
 await page.locator("summary").filter({hasText:locale==="he"?"הודעות על שיחות נכנסות":"Incoming call notifications"}).click();
 await page.locator("summary").filter({hasText:locale==="he"?"המשך טיפול והערות מנהליות":"Follow-up and administrative notes"}).click();
 await expect(page.getByRole("textbox",{name:locale==="he"?"הערה מנהלית":"Administrative note",exact:true})).toHaveValue("Synthetic preserved note");
 await capture(page,info.project.name+"-"+locale+"-person-readback",width);
 await page.reload();await expect(page.getByText(locale==="he"?"הודעות על שיחות נכנסות":"Incoming call notifications",{exact:true})).toBeVisible();
 const p=await page.request.get("/api/private/people?personId="+c.personId),data=await p.json();expect(p.status()).toBe(200);expect(data).toMatchObject({ok:true,data:{source:"native",page:{items:[{personId:c.personId,notes:"Synthetic preserved note",nextAction:"Keep synthetic next action",callActivity:{items:[{id:c.candidateId}]}}]}}});
});
test("wrong-role and unauthenticated page/API cannot read or save",async({page,context})=>{
 const command={action:"match",candidateId:runtime.cases["desktop-en"].candidateId,personId:runtime.cases["desktop-en"].personId,expectedVersion:1,expectedEpoch:3,operationId:"00000000-0000-4000-8000-000000000018"};
 for(const token of [runtime.parent,null]){
  await context.clearCookies();if(token)await context.addCookies([{name:"__Host-ls-session",value:token,url:runtime.origin,httpOnly:true,secure:true,sameSite:"Lax"}]);
  for(const endpoint of ["/api/private/contact-acquisition","/api/private/people"]){const r=await page.request.get(endpoint);expect(r.status()).toBe(token?403:401);expect(await r.text()).not.toContain("Synthetic desktop");}
  const denied=await page.request.post("/api/private/contact-acquisition",{headers:{Origin:runtime.origin,"X-CSRF-Token":"invalid-synthetic"},data:command});expect(denied.status()).toBe(token?403:401);
  await page.goto("/en/app/clients?section=needs_review");
  if(token)await expect(page.getByRole("heading",{name:"Page unavailable",exact:true})).toBeVisible();else await expect(page).toHaveURL(/\/login\?/);
  await expect(page.getByRole("heading",{name:"People — Needs review",exact:true})).toHaveCount(0);
  expect(await page.locator("body").innerText()).not.toContain("Synthetic desktop");
 }
});
