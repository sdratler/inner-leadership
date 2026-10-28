import {chromium,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
const browser=await chromium.launch({headless:true}),results=[],out='D:/academy-coastal-evidence-20261028';
try{
 for(const locale of ['en','he']){
  const prefix=locale==='he'?'/he':'',page=await browser.newPage({viewport:{width:950,height:800},reducedMotion:'reduce'});
  await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
  await page.goto(`http://127.0.0.1:7352${prefix}/fishing-academy`);
  const menu=page.locator('[aria-controls=academy-mobile-menu]');await menu.click();await expect(menu).toHaveAttribute('aria-expanded','true');await page.keyboard.press('Escape');await expect(menu).toBeFocused();
  await page.setViewportSize({width:1000,height:800});await expect(menu).not.toBeVisible();await expect(page.locator('header nav').first()).toBeVisible();
  await page.setViewportSize({width:320,height:568});await page.evaluate(()=>{document.documentElement.style.fontSize='200%';document.querySelectorAll('[data-hero-heading],[data-hero-actions]').forEach(e=>{e.style.fontSize='200%';for(const child of e.querySelectorAll('h1,p,a'))child.style.fontSize='200%';});});
  await expect(page.locator('[data-enlarged=true]')).toBeVisible();const oversized=await page.evaluate(()=>Array.from(document.querySelectorAll('body *')).filter(e=>e.getBoundingClientRect().right>innerWidth+1).map(e=>({tag:e.tagName,cls:e.className,width:e.getBoundingClientRect().width,text:e.textContent?.slice(0,50)})));console.log({locale,oversized});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.screenshot({path:`${out}/after/${locale}-enlarged-text.png`,fullPage:true});
  await page.route('**/hero-*-20261018.png',r=>r.abort());await page.reload();await expect(page.locator('[data-hero-image-failed=true]')).toBeVisible();await expect(page.locator('[data-jlfa-primary]')).toBeVisible();await page.screenshot({path:`${out}/after/${locale}-image-failure.png`});
  const values=[];for(const slug of ['foundation','independent','advanced','leadership']){await page.goto(`http://127.0.0.1:7352${prefix}/fishing-academy/stages/${slug}`);await expect(page.locator('[data-academy-lesson-list]>li')).toHaveCount(12);for(let i=0;i<3;i++){await page.locator(`[data-age-choice="${i}"]`).check();await expect(page.locator(`[data-age-panel="${i}"]`)).toBeVisible();}values.push(slug);}
  results.push({locale,menuEscapeAndBreakpoint:'PASS',enlargedTextAndImageFailure:'PASS',reducedMotion:'emulated',allStagesAndAgePanels:values});await page.close();
 }
 await writeFile(`${out}/resilience-results.json`,JSON.stringify(results,null,2));console.log(results);
}finally{await browser.close();}
