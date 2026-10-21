/** Actual mounted unavailable runtime, ordinary password actor and private HTTP.
 * This proves no admission expansion; successful proposal forms need the
 * separately admitted synthetic native-store/browser composition. */
import {expect,type Page,type Locator,type TestInfo} from '@playwright/test';
export async function academyRefundUnavailableJourney(page:Page,record:Locator,locale:'en'|'he',info:TestInfo){
 if(process.env.LS_ACADEMY_REFUND_UI_ONLY!=='true'||process.env.LS_ACADEMY_MONTHLY_UI_ONLY!=='true'||!/^https:\/\/localhost:310[56]$/.test(new URL(page.url()).origin))throw Error('EXACT_SYNTHETIC_REFUND_BROWSER_REQUIRED');
 const t=(en:string,he:string)=>locale==='he'?he:en,box=record.locator('[data-academy-refunds]');await expect(box).toBeVisible();
 const read=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/private/group-applications/refunds'&&r.request().method()==='GET');await box.getByRole('button',{name:t('Read current refund proposals','קריאת הצעות ההחזר העדכניות'),exact:true}).click();const response=await read;expect(response.status()).toBe(200);expect(response.headers()['cache-control']).toBe('private, no-store');expect((await response.json()).data).toEqual({state:'not_admitted'});
 await expect(box).toContainText(t('Refund proposal setup is awaiting approval. No refund can be sent here.','הגדרת הצעות ההחזר ממתינה לאישור. לא ניתן לשלוח כאן החזר.'));await expect(box.locator('input')).toHaveCount(0);await expect(box.getByRole('button')).toHaveCount(1);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await box.screenshot({path:info.outputPath(`academy-refund-unavailable-${locale}-${info.project.name}.png`)});
 if(info.project.name==='mobile390'){const bounds=await box.boundingBox();expect(bounds).not.toBeNull();expect(bounds!.width).toBeGreaterThanOrEqual(220);}
 await page.reload();await record.locator('[data-academy-family-setup] > summary').click();await expect(box).toBeVisible();
 // No client state or request field can persist an admission after reload.
 const refreshed=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/private/group-applications/refunds'&&r.request().method()==='GET');await box.getByRole('button',{name:t('Read current refund proposals','קריאת הצעות ההחזר העדכניות'),exact:true}).click();const result=await refreshed;expect(result.status()).toBe(200);expect((await result.json()).data).toEqual({state:'not_admitted'});await expect(box.locator('input')).toHaveCount(0);await expect(box.getByRole('button')).toHaveCount(1);
}
