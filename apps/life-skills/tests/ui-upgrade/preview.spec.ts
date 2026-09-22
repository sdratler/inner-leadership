import {test,expect} from '@playwright/test';
for(const locale of ['en','he'] as const)for(const role of ['parent','practitioner'] as const)for(const width of [390,1440])test(`${locale}/${role}/${width} synthetic workspace`,async({page})=>{
 const outbound:string[]=[];
 await page.route('**/*',async route=>{const u=new URL(route.request().url());if(u.hostname!=='127.0.0.1'){outbound.push(u.origin);await route.abort();}else await route.continue();});
 await page.setViewportSize({width,height:900});
 await page.goto(`/${locale}/dev/ui/workspace?role=${role}`);
 await expect(page.locator('.lsu-header')).toBeVisible();await expect(page.locator('h1')).toHaveCount(1);
 await expect(page.locator('.lsu-brand img')).toHaveJSProperty('complete',true);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await expect(page.locator('.lsu-language')).toBeVisible();
 if(width===390){const menu=page.locator('.lsu-menu');await menu.click();await expect(page.locator('.lsu-drawer')).toBeVisible();await page.keyboard.press('Escape');await expect(page.locator('.lsu-drawer')).not.toBeVisible();await expect(menu).toBeFocused();}
 expect(outbound).toEqual([]);
});
test('synthetic preview does not open the private practitioner application',async({request})=>{const response=await request.get('/en/app/calendar');expect([403,404,503]).toContain(response.status());});
