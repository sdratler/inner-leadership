import {expect,test} from "@playwright/test";

for(const locale of ["he","en"] as const){
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
   await top.locator("a").filter({hasText:role==="parent"?(locale==="he"?"תרגול":"Practice"):(locale==="he"?"לקוחות":"Clients")}).first().click();
   await expect(page).toHaveURL(new RegExp(`page=${next.replace("/","%2F")}`));
   await expect(page.locator(".lsu-review-calendar")).toHaveCount(0);
   await page.goBack();
   await expect(page.locator(".lsu-review-calendar")).toBeVisible();
   await page.locator(".lsu-account summary").click();
   await expect(page.locator(`.lsu-account-panel a[href*="page=${role==="parent"?"family":"app"}%2Fsettings"]`)).toHaveCount(1);
   await expect(page.locator(`.lsu-account-panel a[href="/${locale}/sample"]`)).toHaveCount(1);
   await page.keyboard.press("Escape");
   await expect(page.locator(".lsu-account")).not.toHaveAttribute("open");
   expect(errors).toEqual([]);
  });
 }
}
