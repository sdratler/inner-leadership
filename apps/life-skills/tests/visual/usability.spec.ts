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
  await page.screenshot({path:testInfo.outputPath(`${locale}-login.png`),fullPage:true});
 });
 for(const role of ["parent","practitioner"] as const){
  test(`${locale} ${role} organized routes, contrast and return`,async({page},testInfo)=>{
   const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
   const base=`/${locale}/dev/ui/workspace?role=${role}&page=`;
   await page.goto(`${base}${role==="parent"?"family/schedule":"app/calendar"}`);
   await expect(page.locator(".lsu")).toHaveAttribute("dir",locale==="he"?"rtl":"ltr");
   if(testInfo.project.name==="desktop")await expect(page.locator(".lsu-header>.lsu-top-tabs")).toBeVisible();
   else await expect(page.locator(".lsu-mobile-tabs")).toBeVisible();
   await expect(page.locator(".lsu-review-calendar")).toBeVisible();
   await expect(page.locator(".lsu-review-calendar>section")).toHaveCount(5);
   if(testInfo.project.name==="desktop"){
    const sidebar=page.locator(".lsu-sidebar");
    await expect(sidebar).toHaveCSS("background-color","rgb(22, 63, 72)");
    await expect(sidebar.locator('[aria-current="page"]')).toHaveCSS("color","rgb(255, 255, 255)");
   }else{
    const strip=page.locator(".lsu-mobile-tabs .lsu-top-tabs");
    await expect(strip).toHaveCSS("overflow-x","auto");
    await expect(page.locator(".lsu-account summary")).toBeVisible();
   }
   await page.screenshot({path:testInfo.outputPath(`${locale}-${role}-calendar.png`),fullPage:true});
   const next=role==="parent"?"family/practice":"app/clients";
   const top=testInfo.project.name==="desktop"?page.locator(".lsu-header>.lsu-top-tabs"):page.locator(".lsu-mobile-tabs .lsu-top-tabs");
   if(role==="practitioner"&&testInfo.project.name==="mobile")await page.locator(".lsu-menu").click();
   const major=role==="practitioner"?(testInfo.project.name==="desktop"?page.locator(".lsu-sidebar"):page.locator(".lsu-drawer")):top;
   await major.locator("a").filter({hasText:role==="parent"?(locale==="he"?"תרגול":"Practice"):(locale==="he"?"לקוחות":"Clients")}).first().click();
   await expect(page).toHaveURL(new RegExp(`page=${next.replace("/","%2F")}`));
   await expect(page.locator(".lsu-review-calendar")).toHaveCount(0);
   await page.goBack();
   await expect(page.locator(".lsu-review-calendar")).toBeVisible();
   if(role==="practitioner"){
    if(testInfo.project.name==="mobile")await page.locator(".lsu-menu").click();
    const majorNav=testInfo.project.name==="desktop"?page.locator(".lsu-sidebar"):page.locator(".lsu-drawer");
    await majorNav.locator("a").filter({hasText:locale==="he"?"שיווק":"Marketing"}).first().click();
    const tabs=testInfo.project.name==="desktop"?page.locator(".lsu-header>.lsu-top-tabs"):page.locator(".lsu-mobile-tabs .lsu-top-tabs");
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
