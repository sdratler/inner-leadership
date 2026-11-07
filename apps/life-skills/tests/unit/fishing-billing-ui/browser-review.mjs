/** Finite loopback-only synthetic review. No app route, DB or provider access. */
import {build} from 'esbuild';
import {chromium} from '@playwright/test';
import {createServer} from 'node:http';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';

const target=process.env.BILLING_UI_EVIDENCE_DIR;
if(!target||!path.isAbsolute(target))throw Error('Set an absolute private BILLING_UI_EVIDENCE_DIR');
const here=path.dirname(fileURLToPath(import.meta.url));
await mkdir(target,{recursive:true});
await build({entryPoints:[path.join(here,'browser-entry.tsx')],bundle:true,platform:'browser',format:'iife',jsx:'automatic',outfile:path.join(target,'harness.js'),define:{'process.env.NODE_ENV':'"production"'}});
const html='<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic Fishing billing component review</title><link rel="stylesheet" href="/harness.css"><style>html{font-family:Arial,sans-serif;background:#f2f5f9}body{margin:0}button,input,textarea{font-family:inherit}</style></head><body><div id="root"></div><script src="/harness.js"></script></body></html>';
const allowed=new Map([['/harness.js','text/javascript'],['/harness.css','text/css']]);
const server=createServer(async(req,res)=>{
 const pathname=new URL(req.url,'http://localhost').pathname;
 if(pathname==='/'){res.setHeader('content-type','text/html');res.end(html);return;}
 const mime=allowed.get(pathname);
 if(!mime){res.statusCode=404;res.end();return;}
 res.setHeader('content-type',mime);res.end(await readFile(path.join(target,pathname.slice(1))));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true});
const context=await browser.newContext();
await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
const page=await context.newPage(),errors=[],results={kind:'synthetic_component_only',base,checks:[],screenshots:[],consoleErrors:errors};
page.on('pageerror',error=>errors.push(error.message));
async function open(query,width=390,height=844){await page.setViewportSize({width,height});await page.goto(`${base}/?${query}`);await page.locator('[data-billing-owner-panel]').waitFor();await page.evaluate(()=>document.fonts.ready);}
async function check(name,fn){await fn();results.checks.push(name);}
async function capture(name){const file=path.join(target,`${name}.png`);await page.screenshot({path:file,fullPage:true});results.screenshots.push(file);}
async function noOverflow(){assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'horizontal page overflow');}
async function cash(locale='en'){
 await page.getByRole('button',{name:locale==='he'?'התקבל מזומן':'Cash received',exact:true}).click();
 await page.getByRole('dialog').waitFor();
}
try{
 for(const locale of ['en','he'])for(const [width,height,label] of [[320,568,'narrow'],[390,844,'mobile'],[1440,900,'desktop']]){
  await open(`locale=${locale}&mode=disabled`,width,height);await check(`${locale}-${label}-overflow`,noOverflow);await capture(`${locale}-${label}`);
 }
 await open('locale=en');await cash();await capture('en-cash-edit');
 await check('native dialog focus contained',async()=>{for(let n=0;n<14;n++){await page.keyboard.press('Tab');assert(await page.evaluate(()=>document.querySelector('dialog').contains(document.activeElement)));}});
 await page.keyboard.press('Escape');
 await check('Escape closes and restores original focus',async()=>{assert.equal(await page.getByRole('dialog').count(),0);assert.equal(await page.locator(':focus').innerText(),'Cash received');});
 await cash();await page.getByRole('button',{name:'Review entry',exact:true}).click();await page.getByRole('button',{name:'Confirm entry',exact:true}).waitFor();await capture('en-cash-review');
 await page.getByRole('button',{name:'Confirm entry',exact:true}).evaluate(button=>{button.click();button.click();});await page.getByRole('button',{name:'Done',exact:true}).waitFor();await page.getByRole('button',{name:'Done',exact:true}).click();
 await check('one confirmed command with current paid balance',async()=>{assert.equal(await page.evaluate(()=>window.billingUiQa.commands.length),1);assert.match(await page.locator('[aria-label="Authoritative balance"]').innerText(),/Paid/);});await capture('en-cash-confirmed');
 await open('locale=en&mode=unknown');await cash();await page.getByRole('button',{name:'Review entry',exact:true}).click();await page.getByRole('button',{name:'Confirm entry',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Check operation status'}).waitFor();await capture('en-unknown');
 await page.getByRole('dialog').getByRole('button',{name:'Check operation status'}).click();await page.getByRole('button',{name:'Done',exact:true}).waitFor();
 await check('unknown recovers only the original operation',async()=>{const qa=await page.evaluate(()=>window.billingUiQa);assert.equal(qa.commands.length,1);assert.deepEqual(qa.lookups,qa.commands);assert.equal(qa.generated,1);});
 await open('locale=en&mode=conflict');await cash();await page.getByRole('button',{name:'Review entry',exact:true}).click();await page.getByRole('button',{name:'Confirm entry',exact:true}).click();await page.keyboard.press('Escape');await capture('en-conflict');
 await check('conflict does not claim payment confirmed',async()=>{assert.match(await page.locator('[data-billing-owner-panel]').innerText(),/Balance changed/);assert.doesNotMatch(await page.locator('[data-billing-owner-panel]').innerText(),/Recorded · balance refreshed/);});
 await open('locale=en&mode=date-unavailable');await cash();await page.getByRole('button',{name:'Review entry',exact:true}).click();await page.getByRole('alert').waitFor();
 await check('no invented timestamp or submission for date-only input',async()=>assert.equal(await page.evaluate(()=>window.billingUiQa.commands.length),0));await capture('en-date-unavailable');
 for(const [state,locale] of [['policyNotReady','en'],['pendingCard','en'],['failedCard','en'],['reversal','he'],['cancelled','he'],['forbiddenCrossFamily','he'],['unknownOperation','en']]){await open(`state=${state}&locale=${locale}&mode=disabled`);await noOverflow();await capture(`${locale}-${state}`);}
 // Holdout selected before viewing: long Hebrew names, two-child allocation error.
 await open('locale=he&long=1',320,568);await cash('he');
 await page.getByLabel('סכום שהתקבל (דולר)',{exact:false}).fill('10');await page.getByRole('button',{name:'בדיקת הרישום',exact:true}).click();await page.getByRole('alert').waitFor();await capture('he-holdout-error');await noOverflow();
 const review=page.getByRole('button',{name:'בדיקת הרישום',exact:true});await review.scrollIntoViewIfNeeded();
 async function visibleControl(){return review.evaluate(el=>{const r=el.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===el;});}
 await check('holdout action is painted and reachable',async()=>assert(await visibleControl()));
 await page.evaluate(()=>{const cover=document.createElement('div');cover.id='qa-occlusion';cover.style.cssText='position:fixed;inset:0;z-index:2147483647;background:#fff';document.body.append(cover);});
 await check('intentional test-only occlusion is rejected',async()=>assert.equal(await visibleControl(),false));
 await page.locator('#qa-occlusion').evaluate(el=>el.remove());await check('holdout action restored after removing test mutation',async()=>assert(await visibleControl()));
 await capture('he-holdout-corrected');
 await page.keyboard.press('Escape');await page.evaluate(()=>{document.documentElement.style.fontSize='200%';document.body.style.fontSize='2rem';});await noOverflow();await capture('he-enlarged-text-emulation');
 await page.emulateMedia({reducedMotion:'reduce'});await noOverflow();results.checks.push('reduced-motion media applied without overflow');
 assert.deepEqual(errors,[]);results.checks.push('no browser page errors');
}finally{
 await writeFile(path.join(target,'results.json'),JSON.stringify(results,null,2));
 await browser.close();await new Promise(resolve=>server.close(resolve));
}
console.log(JSON.stringify({evidence:target,checks:results.checks.length,screenshots:results.screenshots.length,errors},null,2));
