import {test,expect} from '@playwright/test';
for(const locale of ['he','en'] as const)for(const role of ['parent','practitioner'] as const)for(const width of [390,768,1440]){
 test(`${locale} ${role} ${width}: hydrated synthetic UI`,async({page})=>{
  await page.setViewportSize({width,height:width===390?844:1024});
  await page.goto(`/${locale}/dev/ui?role=${role}`);
  await page.locator('[data-lsw-hydrated="true"]').waitFor({state:'attached'});
  await expect(page.locator('.lsw')).toHaveAttribute('dir',locale==='he'?'rtl':'ltr');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.locator('#observation-body').waitFor();
  await page.evaluate(async()=>{await document.fonts.ready;await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));});
  await page.keyboard.press('Tab');await expect(page.locator('.lsw-skip')).toBeFocused();
  await page.keyboard.press('Enter');await expect(page.locator('#lsw-main')).toBeFocused();
  await page.locator('#observation-body').fill(locale==='he'?'דיווח סינתטי לבדיקה בלבד':'Synthetic report for testing only');
  await page.locator('#coordination-form-parent-1').uncheck();
  await expect(page.locator('#coordination-form-parent-0')).toBeChecked();
  await expect(page.locator('#coordination-form-parent-1')).not.toBeChecked();
  await page.locator('#coordination-form-mode-1').check();await expect(page.locator('#coordination-form-mode-1')).toBeChecked();
  await expect(page.locator('#notification-form-push')).toBeDisabled();
  await expect(page.locator('#notification-form-whatsapp')).toBeDisabled();
  await page.locator('[aria-controls="reschedule-dialog"]').click();
  await expect(page.locator('#reschedule-dialog')).toBeVisible();
  await page.keyboard.press('Escape');await expect(page.locator('#reschedule-dialog')).not.toBeVisible();
  await expect(page.locator('[aria-controls="reschedule-dialog"]')).toBeFocused();
  await expect(page.locator('#observation-body')).not.toHaveValue('');
  await page.locator('#state-tabs-tab-ready').focus();await page.keyboard.press(locale==='he'?'ArrowLeft':'ArrowRight');
  await expect(page.locator('#state-tabs-tab-empty')).toBeFocused();await expect(page.locator('#state-tabs-panel-empty')).toBeVisible();
  await page.screenshot({path:`test-results/ls020-${locale}-${role}-${width}.png`,fullPage:true});
 });
}
test('preview does not unlock protected client routes',async({request})=>{for(const path of ['/he/parent','/en/practitioner','/api/private/cases']){const response=await request.get(path);expect([401,403,404,503]).toContain(response.status());}});
