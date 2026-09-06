import { test,expect } from "@playwright/test";
for(const locale of ["he","en"] as const){
 for(const view of ["parent","practitioner"] as const){
  test(`${locale} ${view} foundation`,async({page},testInfo)=>{
   const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
   const response=await page.goto(`/${locale}/foundation?view=${view}`);
   expect(response?.status()).toBe(200);
   await expect(page.locator("html")).toHaveAttribute("lang",locale);
   await expect(page.locator("html")).toHaveAttribute("dir",locale==="he"?"rtl":"ltr");
   await expect(page.locator("h1")).toBeVisible();await expect(page.locator("input,textarea,form")).toHaveCount(0);
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
   expect(response?.headers()["x-robots-tag"]).toContain("noindex");
   await page.screenshot({path:testInfo.outputPath(`${locale}-${view}.png`),fullPage:true});
   await page.keyboard.press("Tab");await expect(page.locator(".skip-link")).toBeFocused();
   await page.locator(".language-link").click();await expect(page.locator("html")).toHaveAttribute("lang",locale==="he"?"en":"he");
   expect(errors).toEqual([]);
  });
 }
}
test("liveness is not private readiness and private routes fail closed",async({request})=>{
 const health=await request.get("/api/health");expect(health.status()).toBe(200);expect((await health.json()).data).toEqual({status:"ok"});
 for(const path of ["/api/private/synthetic","/he/workspace","/en/app"]){const blocked=await request.get(path);expect(blocked.status()).toBe(503);expect((await blocked.json()).error.code).toBe("UNAVAILABLE");}
 const write=await request.post("/api/private/synthetic",{data:{synthetic:true}});expect(write.status()).toBe(503);
});
test("per-request CSP nonces and no session issuance",async({request})=>{
 const a=await request.get("/he/foundation"),b=await request.get("/he/foundation");
 const csp=a.headers()["content-security-policy"];
 expect(csp).toContain("frame-ancestors 'none'");expect(csp).not.toContain("unsafe-eval");expect(csp).not.toBe(b.headers()["content-security-policy"]);
 expect(a.headers()["set-cookie"]).toBeUndefined();expect(a.headers()["cache-control"]).toContain("no-store");
});
