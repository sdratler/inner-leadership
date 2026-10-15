import {test,expect} from "@playwright/test";
import {readFileSync} from "node:fs";
const file=process.env.LS_GROUP_INTEREST_FIXTURE_PATH;
if(process.env.LS_COMMUNITY_UI_ONLY!=="true"||!file)throw Error("COMMUNITY_EXPLICIT_FIXTURE_REQUIRED");
const {origin,community}=JSON.parse(readFileSync(file,"utf8"))as{origin:string;community:{credentials:{role:string;email:string;password:string}[];controlOrigin:string;secret:string}};
if(!/^https:\/\/localhost:310[5678]$/.test(origin)||!/^https:\/\/localhost:\d+$/.test(community.controlOrigin))throw Error("COMMUNITY_LOOPBACK_REQUIRED");
test.use({baseURL:origin});
let errors:string[]=[];
test.beforeEach(({page})=>{errors=[];page.on("pageerror",error=>errors.push(error.message));});
test.afterEach(()=>{expect(errors).toEqual([]);});
async function control(request:import("@playwright/test").APIRequestContext,mode:string){expect((await request.post(community.controlOrigin+"/control?mode="+mode,{headers:{Authorization:"Bearer "+community.secret}})).status()).toBe(200);}
async function login(page:import("@playwright/test").Page,role:string,locale:string){
 const c=community.credentials.find(c=>c.role===role)!;await page.goto(`/${locale}/login`);
 await page.getByLabel(locale==="he"?"דוא״ל":"Email",{exact:true}).fill(c.email);await page.getByLabel(locale==="he"?"סיסמה":"Password",{exact:true}).fill(c.password);
 const response=page.waitForResponse(r=>new URL(r.url()).pathname==="/api/identity/login"&&r.request().method()==="POST");
 await page.getByRole("button",{name:locale==="he"?"כניסה":"Sign in",exact:true}).click();expect((await response).status()).toBe(200);
 await expect(page).not.toHaveURL(new RegExp(`/${locale}/login`));
 expect((await(await page.request.get("/api/identity/session")).json()).data.role).toBe(role);
}
for(const locale of["en","he"]as const){
 test(`${locale}: retained inbox reading aid, exact source, filters and keyboard`,async({page,request},info)=>{
  await control(request,"normal");await login(page,"practitioner",locale);await page.goto(`/${locale}/app/marketing?section=community`);
  const aid=page.getByRole("region",{name:locale==="he"?"עזר קריאה באנגלית":"English reading aid"}).first();await expect(aid).toBeVisible();
  await expect(aid).toHaveAttribute("lang",locale);await expect(aid).toHaveAttribute("dir",locale==="he"?"rtl":"ltr");
  await expect(aid.locator("ul")).toHaveAttribute("lang","en");await expect(aid.locator("ul")).toHaveAttribute("dir","ltr");
  await expect(aid).toContainText("Synthetic English reading aid only.");await expect(page.getByText("Synthetic original without an English aid.",{exact:true})).toBeVisible();
  await expect(page.locator(".lsr-community-original").first()).toHaveText("שאלה ציבורית סינתטית בלבד. ".repeat(18).trim());
  await expect(page.locator(".lsr-community-original").first()).toHaveAttribute("dir","auto");
  await page.screenshot({path:`test-results/community-inbox-${locale}-${info.project.name}.png`,fullPage:false});
  await expect(page.getByText("constructor",{exact:true})).toBeVisible();
  await expect(page.getByText(locale==="he"?"אין עזר קריאה באנגלית לפוסט הזה.":"No English reading aid is available for this post.",{exact:false})).toBeVisible();
  const filter=page.getByRole("button",{name:locale==="he"?"מוכן":"Ready",exact:true});await filter.focus();await expect(filter).toBeFocused();
  await page.keyboard.press("Tab");await expect(page.getByRole("button",{name:locale==="he"?"חדש":"New",exact:true})).toBeFocused();
  await page.keyboard.press("Shift+Tab");await expect(filter).toBeFocused();await filter.press("Enter");await expect(filter).toHaveAttribute("aria-pressed","true");
  await expect(page.getByText("Synthetic original without an English aid.",{exact:true})).toHaveCount(0);
  await page.getByRole("button",{name:locale==="he"?"הכול":"All",exact:true}).click();await expect(page.getByText("constructor",{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
  await aid.scrollIntoViewIfNeeded();await page.screenshot({path:`test-results/community-reading-aid-${locale}-${info.project.name}.png`,fullPage:false});
 });
 test(`${locale}: real transport failure/retry preserves unsaved input; empty is distinct`,async({page,request})=>{
  await control(request,"normal");await login(page,"practitioner",locale);await page.goto(`/${locale}/app/marketing?section=community`);
  await expect(page.getByText("constructor",{exact:true})).toBeVisible();const question=page.getByRole("textbox",{name:locale==="he"?"השאלה הציבורית או קטע מהפוסט":"Public question or post excerpt",exact:true});
  await question.fill("Synthetic unsaved public question only.");await control(request,"fail");
  await page.getByRole("button",{name:locale==="he"?"מוכן":"Ready",exact:true}).click();await expect(page.getByRole("alert").filter({hasText:locale==="he"?"לא ניתן לטעון את תיבת הפוסטים":"captured-post inbox could not load"})).toBeVisible();
  await expect(question).toHaveValue("Synthetic unsaved public question only.");await control(request,"normal");await page.getByRole("button",{name:locale==="he"?"ניסיון חוזר":"Retry inbox",exact:true}).click();
  await expect(page.getByText("Synthetic English reading aid only.",{exact:true})).toBeVisible();await expect(question).toHaveValue("Synthetic unsaved public question only.");
  await question.fill("");await control(request,"empty");await page.reload();await expect(page.getByText(locale==="he"?"אין פוסטים שנקלטו בתצוגה זו.":"No captured posts in this view.",{exact:false})).toBeVisible();
 });
}
test("ordinary parent cannot request the practitioner inbox or contact its upstream",async({page,request})=>{
 await control(request,"normal");await login(page,"parent","en");const before=await(await request.get(community.controlOrigin+"/control",{headers:{Authorization:"Bearer "+community.secret}})).json();
 expect((await page.request.get("/api/community-posts")).status()).toBe(403);
 const after=await(await request.get(community.controlOrigin+"/control",{headers:{Authorization:"Bearer "+community.secret}})).json();expect(after.reads).toEqual(before.reads);expect(after.blocked).toEqual([]);
});
