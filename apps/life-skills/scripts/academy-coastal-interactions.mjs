import {chromium,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
const out='D:/academy-coastal-evidence-20261028',browser=await chromium.launch({headless:true}),results=[];
try{
 for(const locale of ['en','he']){
  const page=await browser.newPage({viewport:{width:390,height:844}}),prefix=locale==='he'?'/he':'';
  let posts=0,lastFields;
  await page.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url());
   if(url.hostname!=='127.0.0.1')return route.abort();
   if(req.method()==='POST'){
    posts++;const body=req.postDataJSON();lastFields=body.fields;
    return route.fulfill({json:{ok:true,data:{saved:true,item:{id:'synthetic-coastal-review',fields:body.fields},founder:{status:'reserved',email:'queued',reference:'synthetic-coastal-review'}}}});
   }
   return route.continue();
  });
  await page.goto(`http://127.0.0.1:7352${prefix}/fishing-academy/apply`);
  const form=page.locator('[data-academy-registration]'),submit=form.locator('button[type=submit]');await expect(submit).toBeEnabled();
  await submit.click();await expect(form.getByRole('alert')).toBeVisible();expect(posts).toBe(0);
  await page.screenshot({path:`${out}/after/${locale}-validation.png`});
  for(const [name,value] of Object.entries({parentName:'Synthetic Parent',receiptEmail:'synthetic@example.invalid',cityArea:'Test Only',postalCode:'01234',driveMinutes:'37'}))await form.locator(`[name=${name}]`).fill(value);
  await form.locator('button').filter({hasText:locale==='he'?'הוספת ילד נוסף':'Add another child'}).click();
  for(let i=0;i<2;i++){
   const child=form.locator('[data-registration-child]').nth(i);
   await child.locator('[name$="-name"]').fill(`Synthetic ${i}`);await child.locator('[name$="-age"]').fill('10');await child.locator('[name$="-grade"]').selectOption('5');await child.locator('[name$="-schooling"]').selectOption('homeschool');await child.locator('[name$="-experience"]').selectOption('new');
  }
  for(const [name,val] of [['preferredDays','sunday'],['preferredTimes','morning']]){await form.locator(`#registration-${name}`).click();await form.locator(`[name=${name}][value=${val}]`).check();}
  await form.locator('#registration-schoolHoursAvailability').click();await form.locator('[name=schoolHoursAvailability][value=outside_school_only]').check();
  await form.locator('[name=parentLanguage]').selectOption('en');
  const toggle=page.locator('[aria-label="Interface language"],[aria-label="שפת הממשק"]');await toggle.locator('button').filter({hasText:locale==='he'?'English':'עברית'}).click();
  await expect(form.locator('[name=postalCode]')).toHaveValue('01234');await expect(form.locator('[name=driveMinutes]')).toHaveValue('37');await expect(form.locator('[name=parentLanguage]')).toHaveValue('en');await expect(form.locator('[data-registration-child]')).toHaveCount(2);
  await page.locator('footer a[href="#academy-program-terms"]').click();await expect(form.locator('[name=postalCode]')).toHaveValue('01234');
  const disclosures=form.locator('[data-academy-information]');await disclosures.nth(0).locator('summary').click();await disclosures.nth(1).locator('summary').click();await expect(disclosures.nth(0)).not.toHaveAttribute('open');
  expect(await disclosures.nth(1).locator('[role=region]').evaluate(e=>getComputedStyle(e).overflowY)).toBe('visible');
  await form.locator('[name=conductExplained]').check();await form.locator('[name=permission]').check();await expect(form.locator('[name=privateWapi]')).not.toBeChecked();
  await submit.click();await expect(form.locator('[data-academy-saved]')).toBeVisible();expect(posts).toBe(1);await expect(form.locator('[name=parentName]')).toHaveCount(0);await expect(page.locator('header a[href="#academy-form"]:visible,footer a[href="#academy-form"]:visible')).toHaveCount(0);
  await page.locator('[aria-controls=academy-mobile-menu]').click();await expect(page.locator('[data-academy-registration-link]')).not.toBeVisible();await expect(page.locator('#academy-mobile-menu a[href^="https://wa.me/"]')).toBeVisible();await page.keyboard.press('Escape');
  await page.evaluate(()=>{location.hash='academy-information-safety';});await expect(page.locator('#academy-information-safety')).toBeFocused();expect(await page.locator('#academy-information-safety').evaluate(e=>e.tabIndex)).toBe(0);
  expect(lastFields.academyRegistration.driveMinutes).toBe(37);expect(lastFields.academyRegistration.postalCode).toBe('01234');
  await page.screenshot({path:`${out}/after/${locale}-saved-mocked.png`,fullPage:true});results.push({locale,form:'PASS',posts,source:'mocked response; no persistence or real sends'});
  await page.goto(`http://127.0.0.1:7352${prefix}/fishing-academy/stages/foundation`);await page.locator('[data-age-choice="2"]').check();await page.locator('[data-academy-curriculum-navigation] a').nth(1).click();await expect(page.locator('[data-age-choice="2"]')).toBeChecked();expect(await page.locator('[data-academy-lesson-list]>li').count()).toBe(12);
  await page.close();
 }
 console.log(results);await writeFile(`${out}/interaction-results.json`,JSON.stringify(results,null,2));
}finally{await browser.close();}
