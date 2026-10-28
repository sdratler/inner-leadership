import {chromium} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
const base='D:/academy-coastal-evidence-20261028';
const browser=await chromium.launch({headless:true});
const results=[];
try{
 for(const variant of ['before','after']){
  for(const locale of ['en','he']){
   const context=await browser.newContext();
   const page=await context.newPage();
   await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
   const prefix=locale==='he'?'/he':'';
   for(const [width,height] of [[1280,720],[1366,768],[1440,900],[1920,1080],[320,568],[360,800],[390,844],[430,932],[768,1024],[950,800]]){
    await page.setViewportSize({width,height});
    await page.goto(`http://127.0.0.1:7352${prefix}/fishing-academy?variant=${variant}`);
    await page.locator('[data-campaign-phase=PRE_REGISTRATION]').waitFor();
    await page.locator('[data-academy-hero-image]').evaluate(img=>img.decode());
    const data=await page.evaluate(()=>{const action=document.querySelector('[data-hero-actions]').getBoundingClientRect(),img=document.querySelector('[data-academy-hero-image]'),r=img.getBoundingClientRect();return {overflow:document.documentElement.scrollWidth>innerWidth,actionBottom:action.bottom,visible:action.bottom<=innerHeight,photoRatio:r.width/r.height,naturalRatio:img.naturalWidth/img.naturalHeight};});
    results.push({variant,locale,width,height,...data});
    await page.screenshot({path:`${base}/${variant}/${locale}-hero-${width}x${height}.png`});
   }
   await page.setViewportSize({width:1440,height:900});
   for(const suffix of ['', '/stages/foundation','/pricing','/apply',...(variant==='after'?['/confirm']:[])]){
    await page.goto(`http://127.0.0.1:7352${prefix}/fishing-academy${suffix}?variant=${variant}`);
    await page.locator('[data-academy-site]').waitFor();await page.locator('img').evaluateAll(async images=>{await Promise.all(images.map(async img=>{img.loading='eager';try{await img.decode();}catch{}}));});
    await page.screenshot({path:`${base}/${variant}/${locale}-${suffix.replaceAll('/','-')||'landing'}-desktop.png`,fullPage:true});
   }
   await page.setViewportSize({width:390,height:844});
   await page.goto(`http://127.0.0.1:7352${prefix}/fishing-academy/apply?variant=${variant}`);
   await page.locator('[data-academy-registration]').waitFor();
   await page.screenshot({path:`${base}/${variant}/${locale}-form-mobile.png`,fullPage:true});
   const first=await page.locator('[data-academy-information]').first();await first.locator('summary').click();
   await first.screenshot({path:`${base}/${variant}/${locale}-terms.png`});
   results.push({variant,locale,firstFieldTop:await page.locator('[name=parentName]').evaluate(el=>el.getBoundingClientRect().top+scrollY)});
   await context.close();
  }
 }
 await writeFile(`${base}/visual-results.json`,JSON.stringify(results,null,2));
 console.log(JSON.stringify(results.filter(r=>r.variant==='after'),null,2));
}finally{await browser.close();}
