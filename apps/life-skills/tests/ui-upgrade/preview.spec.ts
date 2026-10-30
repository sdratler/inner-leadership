import {test,expect} from '@playwright/test';
for(const locale of ['en','he'] as const)for(const role of ['parent','practitioner'] as const)for(const width of [320,360,390,768,1024,1440])test(`${locale}/${role}/${width} synthetic workspace`,async({page})=>{
 const outbound:string[]=[];
 await page.route('**/*',async route=>{const u=new URL(route.request().url());if(u.hostname!=='127.0.0.1'){outbound.push(u.origin);await route.abort();}else await route.continue();});
 await page.setViewportSize({width,height:900});
 await page.goto(`/${locale}/dev/ui/workspace?role=${role}${role==='practitioner'?'&page=app%2Fclients':''}`);
 await expect(page.locator('.lsu-header')).toBeVisible();await expect(page.locator('h1')).toHaveCount(1);
 await expect(page.locator('.lsu-brand img')).toHaveJSProperty('complete',true);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await expect(page.locator('.lsu-language')).toBeVisible();
 const selectedTab=page.locator('.lsu-top-tabs [aria-current="page"]');await expect(selectedTab).toHaveCount(1);await expect.poll(()=>selectedTab.evaluate(node=>{const strip=node.parentElement!,a=strip.getBoundingClientRect(),b=node.getBoundingClientRect();return b.left>=a.left-1&&b.right<=a.left+strip.clientWidth+1;})).toBe(true);
 const header=await page.locator('.lsu-header').boundingBox(),label=await page.locator('.lsu-brand strong').boundingBox(),controls=await page.locator('.lsu-header-controls').boundingBox();
 expect(header&&label&&controls).toBeTruthy();
 expect(Math.min(label!.x+label!.width,controls!.x+controls!.width)-Math.max(label!.x,controls!.x)).toBeLessThanOrEqual(0);
 if(width<=390)expect(header!.height).toBeLessThan(150);
 if(width>=1024)expect(header!.height).toBeLessThan(120);
 if(role==='practitioner')await expect(page.locator('.lsu-brand small')).toHaveText(locale==='he'?'מרחב האקדמיה':'Academy workspace');
 const account=page.locator('.lsu-account>summary');await account.click();const accountPanel=await page.locator('.lsu-account-panel').boundingBox();expect(accountPanel).toBeTruthy();expect(accountPanel!.x).toBeGreaterThanOrEqual(0);expect(accountPanel!.x+accountPanel!.width).toBeLessThanOrEqual(await page.evaluate(()=>document.documentElement.clientWidth));await account.press('Escape');await expect(page.locator('.lsu-account')).not.toHaveAttribute('open');
 if(width<1024){const menu=page.locator('.lsu-menu');await expect(menu).toHaveAttribute('aria-expanded','false');await menu.click();await expect(page.locator('.lsu-drawer')).toBeVisible();await expect(menu).toHaveAttribute('aria-expanded','true');await expect(menu).toHaveAttribute('aria-label',locale==='he'?'סגירת התפריט':'Close navigation');await page.keyboard.press('Escape');await expect(page.locator('.lsu-drawer')).not.toBeVisible();await expect(menu).toHaveAttribute('aria-expanded','false');await expect(menu).toBeFocused();}
 expect(outbound).toEqual([]);
});
test('synthetic preview does not open the private practitioner application',async({request})=>{const response=await request.get('/en/app/calendar');expect([403,404,503]).toContain(response.status());});
