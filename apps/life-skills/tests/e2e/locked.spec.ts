import { test,expect } from "@playwright/test";
test("normal runtime does not expose the preview or private routes",async({request})=>{
 expect((await request.get("/api/health")).status()).toBe(200);
 for(const path of ["/","/he/foundation","/en/foundation","/api/private/synthetic"]){const response=await request.get(path);expect(response.status()).toBe(503);expect((await response.json()).error.code).toBe("UNAVAILABLE");expect(response.headers()["cache-control"]).toContain("no-store");}
 const robots=await request.get("/robots.txt");expect(await robots.text()).toContain("Disallow: /");
});
