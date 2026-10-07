import {expect,test} from "@playwright/test";

for(const locale of ["he","en"] as const){
 test(`${locale} login uses approved brand and keeps entered password on visibility toggle`,async({page},testInfo)=>{
  await page.goto(`/${locale}/login`);
  await expect(page.locator("html")).toHaveAttribute("dir",locale==="he"?"rtl":"ltr");
  const logo=page.locator('img[src="/intake-brand/life-skills-logo.png"]');
  await expect(logo).toBeVisible();
  await expect.poll(()=>logo.evaluate(image=>(image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  const password=page.locator('#login-password');
  await password.fill('synthetic-six-character-check');
  const toggle=page.getByRole('button',{name:locale==='he'?'הצגת סיסמה':'Show password'});
  await toggle.click();
  await expect(password).toHaveAttribute('type','text');
  await expect(password).toHaveValue('synthetic-six-character-check');
  await page.getByRole('button',{name:locale==='he'?'הסתרת סיסמה':'Hide password'}).click();
  await expect(password).toHaveAttribute('type','password');
  await expect(password).toHaveValue('synthetic-six-character-check');
  await page.getByRole('button',{name:locale==='he'?'הצגת סיסמה':'Show password'}).click();
  await page.getByRole('button',{name:locale==='he'?'שכחתי סיסמה':'Forgot password?'}).click();
  await page.getByRole('button',{name:locale==='he'?'חזרה לכניסה':'Back to sign in'}).click();
  await expect(page.locator('#login-password')).toHaveAttribute('type','password');
  await page.screenshot({path:testInfo.outputPath(`${locale}-login.png`),fullPage:true});
 });
 for(const role of ["parent","practitioner"] as const){
  test(`${locale} ${role} account panel retains readable sizing and keyboard focus`,async({page},testInfo)=>{
   // Retained WorkspaceShell component/cascade regression, not authenticated journey proof.
   for(const width of [340,390,768,1440]){
    await page.setViewportSize({width,height:width===768?1024:900});
    await page.goto(`/${locale}/dev/ui/workspace?role=${role}&page=${role==='parent'?'family/schedule':'app/calendar'}`,{waitUntil:'networkidle'});
    const trigger=page.locator('.lsu-account summary'),panel=page.locator('.lsu-account-panel');
    await trigger.press('Enter');
    await expect(panel).toBeVisible();
    const box=await panel.boundingBox();expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(248);expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(width);
    const settings=panel.getByRole('link',{name:locale==='he'?'הגדרות':'Settings',exact:true});
    const linkBox=await settings.boundingBox();expect(linkBox!.height).toBeGreaterThanOrEqual(44);expect(linkBox!.height).toBeLessThan(65);
    await page.keyboard.press('Tab');await expect(settings).toBeFocused();
    await page.screenshot({path:testInfo.outputPath(`${locale}-${role}-${width}-account-menu.png`)});
    await page.keyboard.press('Escape');await expect(panel).not.toBeVisible();await expect(trigger).toBeFocused();
   }
  });
  test(`${locale} ${role} organized routes, contrast and return`,async({page},testInfo)=>{
   const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
   const base=`/${locale}/dev/ui/workspace?role=${role}&page=`;
   await page.goto(`${base}${role==="parent"?"family/schedule":"app/calendar"}`);
   await expect(page.locator(".lsu")).toHaveAttribute("dir",locale==="he"?"rtl":"ltr");
   await expect(page.locator(".lsu-header>.lsu-top-tabs")).toBeVisible();
   await expect(page.locator(".lsu-top-tabs")).toHaveCount(1);
   await expect(page.locator(".lsu-review-calendar")).toBeVisible();
   await expect(page.locator(".lsu-review-calendar>section")).toHaveCount(5);
   if(testInfo.project.name==="desktop"){
    const sidebar=page.locator(".lsu-sidebar");
    await expect(sidebar).toHaveCSS("background-color","rgb(22, 63, 72)");
    await expect(sidebar.locator('[aria-current="page"]')).toHaveCSS("color","rgb(255, 255, 255)");
   }else{
    const strip=page.locator(".lsu-header>.lsu-top-tabs");
    await expect(strip).toHaveCSS("overflow-x","auto");
    await expect(page.locator(".lsu-account summary")).toBeVisible();
   }
   await page.screenshot({path:testInfo.outputPath(`${locale}-${role}-calendar.png`),fullPage:true});
   const next=role==="parent"?"family/practice":"app/clients";
   const top=page.locator(".lsu-header>.lsu-top-tabs");
   if(role==="practitioner"&&testInfo.project.name==="mobile")await page.locator(".lsu-menu").click();
   const major=role==="practitioner"?(testInfo.project.name==="desktop"?page.locator(".lsu-sidebar"):page.locator(".lsu-drawer")):top;
   await major.locator("a").filter({hasText:role==="parent"?(locale==="he"?"תרגול":"Practice"):(locale==="he"?"אנשים":"People")}).first().click();
   await expect(page).toHaveURL(new RegExp(`page=${next.replace("/","%2F")}`));
   await expect(page.locator(".lsu-review-calendar")).toHaveCount(0);
   await page.goBack();
   await expect(page.locator(".lsu-review-calendar")).toBeVisible();
   if(role==="practitioner"){
    if(testInfo.project.name==="mobile")await page.locator(".lsu-menu").click();
    const majorNav=testInfo.project.name==="desktop"?page.locator(".lsu-sidebar"):page.locator(".lsu-drawer");
    await majorNav.locator("a").filter({hasText:locale==="he"?"שיווק":"Marketing"}).first().click();
    const tabs=page.locator(".lsu-header>.lsu-top-tabs");
    await tabs.locator("a").filter({hasText:locale==="he"?"מודעות":"Ads"}).click();
    await expect(page).toHaveURL(/section=ads/);
    await expect(page.getByRole("heading",{name:locale==="he"?"מודעות — נתוני דוגמה":"Ads — sample data"})).toBeVisible();
    await page.screenshot({path:testInfo.outputPath(`${locale}-practitioner-marketing-ads.png`),fullPage:true});
    await page.goBack();
    await page.goBack();
    await expect(page.locator(".lsu-review-calendar")).toBeVisible();
   }
   await page.locator(".lsu-account summary").click();
   await expect(page.locator(`.lsu-account-panel a[href*="page=${role==="parent"?"family":"app"}%2Fsettings"]`)).toHaveCount(1);
   await expect(page.locator(`.lsu-account-panel a[href="/${locale}/sample"]`)).toHaveCount(1);
   await page.keyboard.press("Escape");
   await expect(page.locator(".lsu-account")).not.toHaveAttribute("open");
   expect(errors).toEqual([]);
  });
 }
}
