/** Root1119 design acceptance. Invoke only via the separately reviewed and
 * admitted exact-head disposable native recipe; never a provider/browser job. */
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {test,expect,type Page} from "@playwright/test";
const file=process.env.LS_ACADEMY_INTAKE_FIXTURE;
if(!file||process.env.LS_ACADEMY_INTAKE_NATIVE_ALLOW!=="ROOT_REGISTERED_ONLY"||process.env.LS_ACADEMY_DESIGN_NATIVE_ALLOW!=="ROOT_REGISTERED_ONLY")throw Error("ACADEMY_DESIGN_RECIPE_REQUIRED");
const data=JSON.parse(readFileSync(file,"utf8")) as {origin:string;project:"desktop"|"mobile340"};
if(data.origin!==(data.project==="desktop"?"https://localhost:3105":"https://localhost:3107"))throw Error("ACADEMY_EXACT_ORIGIN");
test.use({baseURL:data.origin});
const widths=data.project==="desktop"?[1440]:[390,320],stages=["foundation","independent","advanced","leadership"] as const;
async function frames(page:Page){await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));}
async function fits(page:Page){expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);}

async function readableLinks(page:Page,selector:string){
 const readings=await page.locator(selector).evaluateAll(nodes=>nodes.map(node=>{
  const rgb=(value:string)=>{const parts=value.match(/[\d.]+/g)?.map(Number);return parts&&parts.length>=3&&(parts.length===3||parts[3]===1)?parts.slice(0,3):null;};
  const foreground=rgb(getComputedStyle(node).color);let background:number[]|null=null,element:Element|null=node;while(element&&!background){background=rgb(getComputedStyle(element).backgroundColor);element=element.parentElement;}if(!foreground||!background)throw Error("OPAQUE_LINK_COLORS_REQUIRED");
  const light=(color:number[])=>color.map(value=>{const v=value/255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((sum,value,index)=>sum+value*[.2126,.7152,.0722][index]!,0),a=light(foreground),b=light(background);return{contrast:(Math.max(a,b)+.05)/(Math.min(a,b)+.05),label:(node.textContent??"").trim().length};
 }));expect(readings.length).toBeGreaterThan(0);for(const reading of readings){expect(reading.contrast).toBeGreaterThanOrEqual(4.5);expect(reading.label).toBeGreaterThan(0);}
}

for(const locale of["en","he"] as const)for(const width of widths)test(`${locale} ${width}: exact hero, stage exploration, FAQ and non-overlapping contact`,async({page},info)=>{
 test.setTimeout(180000);expect(info.project.name).toBe(data.project);await page.setViewportSize({width,height:width===1440?1000:844});
 const outside:string[]=[],writes:string[]=[],images:string[]=[];page.on("request",request=>{const url=new URL(request.url());if(["http:","https:"].includes(url.protocol)&&url.origin!==data.origin)outside.push("OUTSIDE");if(["POST","PUT","PATCH","DELETE"].includes(request.method()))writes.push(url.pathname);if(url.pathname.startsWith("/groups/academy/"))images.push(url.pathname);});
 const t=(en:string,he:string)=>locale==="he"?he:en;
 const home=await page.goto(`/${locale}/florida`);expect(home?.status()).toBe(200);await page.evaluate(()=>document.fonts.ready);
 const image=page.locator("[data-academy-hero-image]");await expect(image).toBeVisible();await expect.poll(()=>image.evaluate(element=>(element as HTMLImageElement).complete&&(element as HTMLImageElement).naturalWidth>0)).toBe(true);
 const selected=width>=768?"desktop":"mobile",expectedHash=selected==="desktop"?"c04e07e489e866ad8153b283b5445f6d43f393a38005c9a8cacd40050be0bbaa":"12a450f6cff546171c40b46273e89acf5d142fd1a86bd94eacbb8724544b2e42";
 expect(await image.evaluate(element=>(element as HTMLImageElement).naturalWidth)).toBe(selected==="desktop"?2048:1143);
 expect(await image.evaluate(element=>new URL((element as HTMLImageElement).currentSrc).pathname)).toBe(`/groups/academy/hero-${selected}-20261018.png`);
 expect(images).toContain(`/groups/academy/hero-${selected}-20261018.png`);expect(images.every(path=>path===`/groups/academy/hero-${selected}-20261018.png`)).toBe(true);
 const asset=await page.request.get(`/groups/academy/hero-${selected}-20261018.png`);expect(asset.status()).toBe(200);expect(createHash("sha256").update(await asset.body()).digest("hex")).toBe(expectedHash);
 await expect(page.locator("h1")).toHaveCount(1);await expect(page.locator("h1")).toContainText(/Jewish Leadership\s*Fishing Academy/);
 expect(await page.locator("[data-academy-header]").evaluate(element=>!["fixed","sticky"].includes(getComputedStyle(element).position))).toBe(true);
 const geometry=await page.evaluate(()=>{const hero=document.querySelector("[data-academy-hero]")!.getBoundingClientRect(),heading=document.querySelector("[data-academy-hero-heading]")!.getBoundingClientRect(),invitation=document.querySelector("[data-academy-hero-invitation]")!.getBoundingClientRect(),header=document.querySelector("[data-academy-header]")!.getBoundingClientRect();return{headingEnd:(heading.bottom-hero.top)/hero.height,invitationStart:(invitation.top-hero.top)/hero.height,headerEndsBeforeHero:header.bottom<=hero.top+1,headlineCenterOffset:Math.abs((document.querySelector("h1")!.getBoundingClientRect().left+document.querySelector("h1")!.getBoundingClientRect().right)/2-(hero.left+hero.right)/2)};});
 expect(geometry.headerEndsBeforeHero).toBe(true);expect(geometry.headlineCenterOffset).toBeLessThanOrEqual(1);expect(geometry.headingEnd).toBeLessThan(width>=768 ? .28 : .29);expect(geometry.invitationStart).toBeGreaterThan(.60);
 await fits(page);await page.screenshot({path:info.outputPath(`academy-hero-${locale}-${width}.png`),fullPage:false});const founder=page.locator('img[src="/groups/people/founder-grass-group.webp"]');await founder.scrollIntoViewIfNeeded();await expect.poll(()=>founder.evaluate(element=>(element as HTMLImageElement).complete&&(element as HTMLImageElement).naturalWidth===1600)).toBe(true);await page.evaluate(()=>scrollTo(0,0));await frames(page);await readableLinks(page,"[data-academy-pricing] a");await page.screenshot({path:info.outputPath(`academy-home-${locale}-${width}.png`),fullPage:true});
 const contact=page.locator("[data-academy-whatsapp]");await expect(contact).toHaveAttribute("data-visible","false");await expect(contact).toHaveAttribute("href","https://wa.me/972534932631?text=Hi%2C%20I%20came%20from%20your%20website.%20I%27d%20like%20to%20know%20more.");
 const heroEnd=await page.locator("[data-academy-hero]").evaluate(element=>Math.ceil(element.getBoundingClientRect().bottom+scrollY));let visible=false;
 for(let y=heroEnd;y<heroEnd+2200;y+=40){await page.evaluate(top=>scrollTo(0,top),y);await frames(page);if(await contact.getAttribute("data-visible")==="true"){visible=true;break;}}
 expect(visible).toBe(true);
 const overlaps=await page.evaluate(()=>{const bubble=document.querySelector("[data-academy-whatsapp]")!.getBoundingClientRect(),main=document.getElementById("main")!,walker=document.createTreeWalker(main,NodeFilter.SHOW_TEXT),overlap=(r:DOMRect)=>r.width>0&&r.height>0&&bubble.left<r.right&&bubble.right>r.left&&bubble.top<r.bottom&&bubble.bottom>r.top;let count=0;while(walker.nextNode()){const node=walker.currentNode;if(!node.textContent?.trim())continue;const range=document.createRange();range.selectNodeContents(node);for(const rect of range.getClientRects())if(overlap(rect))count++;range.detach();}return count;});expect(overlaps).toBe(0);
 await page.locator("[data-academy-footer]").scrollIntoViewIfNeeded();await frames(page);await expect(contact).toHaveAttribute("data-visible","false");
 await page.locator("#questions details").first().locator("summary").click();await expect(page.locator("#questions details").first()).toHaveAttribute("open","");
 await page.locator("#questions").screenshot({path:info.outputPath(`academy-faq-${locale}-${width}.png`)});
 for(const slug of stages){
  await page.goto(`/${locale}/florida#stages`);const card=page.locator(`[data-academy-stage-card="${slug}"]`);await card.locator("a").click();await expect(page).toHaveURL(`${data.origin}/${locale}/florida/stages/${slug}`);
  await expect(page.locator(`[data-academy-stage-view="${slug}"]`)).toBeVisible();await expect(page.locator("[data-jlfa-header-logo]")).toHaveCount(1);await expect(page.locator("[data-jlfa-footer-logo]")).toHaveCount(1);await expect(page.getByRole("tab")).toHaveCount(3);await expect(page.getByRole("tab").first()).toBeEnabled();await page.getByRole("tab").first().focus();await page.getByRole("tab").first().press("End");await expect(page.getByRole("tab").nth(2)).toHaveAttribute("aria-selected","true");await expect(page.getByRole("tabpanel")).toHaveCount(1);await page.getByRole("tab").nth(2).press("Home");await expect(page.getByRole("tab").first()).toHaveAttribute("aria-selected","true");await fits(page);await readableLinks(page,"[data-academy-stage-view] a");
  if(slug==="foundation")await page.getByRole("tabpanel").screenshot({path:info.outputPath(`academy-age-depth-${locale}-${width}.png`)});
 }
 await page.goto(`/${locale}/florida/apply`);const form=page.locator('[data-academy-full-inquiry] form[data-inquiry-kind="parent"]');await expect(form.locator('button[type="submit"]')).toBeEnabled();await form.locator('[name="parentName"]').fill("Synthetic design draft");
 const prices=page.getByText(t("Review tuition for one 12-session stage","לעיון במחירי שלב אחד בן 12 מפגשים"),{exact:true});await prices.click();await expect(page.locator("[data-academy-pricing]")).toBeVisible();await readableLinks(page,"[data-academy-pricing] a");await readableLinks(page,'[data-academy-full-inquiry] button[type="submit"]');await fits(page);await page.locator('[data-academy-pricing] a[href="#apply"]').click();await expect(form.locator('[name="parentName"]')).toHaveValue("Synthetic design draft");await fits(page);
 expect(outside).toEqual([]);expect(writes).toEqual([]);
});
