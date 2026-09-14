import { test,expect } from "@playwright/test";

test("isolated preview requires credentials and leaves private APIs closed",async({request})=>{
 const denied=await fetch("http://127.0.0.1:3003/he/preview",{redirect:"manual"});
 expect(denied.status).toBe(401);expect(denied.headers.get("www-authenticate")).toContain("Life Skills private preview");
 const health=await request.get("/api/health");expect(health.status()).toBe(200);
 const privateApi=await request.get("/api/private/synthetic");expect(privateApi.status()).toBe(503);
 expect((await privateApi.json()).error.code).toBe("UNAVAILABLE");
 const foundation=await request.get("/he/foundation");expect(foundation.status()).toBe(404);
});

test("authorized owner can review the bilingual synthetic parent and practitioner journeys",async({page},testInfo)=>{
 for(const locale of ["he","en"] as const)for(const role of ["parent","practitioner"] as const){
  const response=await page.goto(`/${locale}/preview?role=${role}`);expect(response?.status()).toBe(200);
  await expect(page.locator("html")).toHaveAttribute("lang",locale);await expect(page.locator("#lsw-main")).toBeVisible();
  await expect(page.locator("[data-lsw-hydrated=true]")).toHaveCount(1);expect(response?.headers()["x-robots-tag"]).toContain("noindex");
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath(`${locale}-${role}.png`),fullPage:true});
 }
});
