/** Finite loopback-only synthetic review. No app route, DB or provider access. */
import {createServer} from 'node:http';
import {mkdir,readFile,writeFile,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';

const target=process.env.BILLING_UI_EVIDENCE_DIR;
if(!target||!path.isAbsolute(target))throw Error('Set an absolute private BILLING_UI_EVIDENCE_DIR');
const here=path.dirname(fileURLToPath(import.meta.url));
const worktree=path.resolve(here,'../../../../..');
const relative=path.relative(worktree,target);
assert(relative.startsWith(`..${path.sep}`)||path.isAbsolute(relative),'Evidence must be outside the worktree');
assert(process.env.BILLING_UI_ATTEMPT_ID==='B237-UI-RENDER-01-20261107','Exact one-attempt supervisor required');
assert.equal(await realpath(path.dirname(target)),path.resolve(path.dirname(target)),'No redirected evidence parent');
await mkdir(target); // Exclusive: never overwrite a previous run.
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
let server=null,browserServer=null,browser=null,page=null,base=null,port=null,timedOut=false,cleanupPromise=null;
const errors=[],results={kind:'synthetic_component_only',attempt:process.env.BILLING_UI_ATTEMPT_ID,nodePid:process.pid,checks:[],screenshots:[],consoleErrors:errors,success:false};
async function verifyExpected(pins){for(const [file,hash] of Object.entries(pins))assert.equal(sha(await readFile(file)),hash,`EXPECTED_INPUT_CHANGED ${file}`);}
async function lifecycle(){await writeFile(path.join(target,'lifecycle.json'),JSON.stringify({nodePid:process.pid,browserPid:browserServer?.process().pid??null,port,base,timedOut}));}
async function bounded(promise,ms){let timeout;try{return await Promise.race([promise,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('BOUNDED_SHUTDOWN_TIMEOUT')),ms);})]);}finally{clearTimeout(timeout);}}
function cleanup(){return cleanupPromise??=(async()=>{
 if(browserServer){try{await bounded(browserServer.close(),5000);}catch{await bounded(browserServer.kill(),3000);}finally{results.browserExited=browserServer.process().exitCode!==null;}}
 if(server){server.closeAllConnections();if(server.listening)await bounded(new Promise(resolve=>server.close(resolve)),3000);results.serverClosed=!server.listening;}
})();}
const deadline=setTimeout(()=>{
 timedOut=true;results.error='OVERALL_180_SECOND_DEADLINE';
 void cleanup().catch(error=>{results.cleanupError=String(error);}).finally(async()=>{await writeFile(path.join(target,'results.json'),JSON.stringify(results,null,2));await lifecycle();process.exit(124);});
},180000);
try{
 await lifecycle();
 const expectedBytes=await readFile(process.env.BILLING_UI_EXPECTED_MANIFEST);
 assert.equal(sha(expectedBytes),process.env.BILLING_UI_EXPECTED_MANIFEST_SHA256,'EXPECTED_MANIFEST_BINDING');
 const expected=JSON.parse(expectedBytes);
 assert.equal(expected.attempt,process.env.BILLING_UI_ATTEMPT_ID);
 const approvalBytes=await readFile(process.env.BILLING_UI_APPROVAL);
 assert.equal(sha(approvalBytes),process.env.BILLING_UI_APPROVAL_SHA256,'APPROVAL_RECEIPT_PIN');
 const approval=JSON.parse(approvalBytes);
 assert(approval.rootApproved===true&&approval.reviewerApproved===true&&approval.attempt===expected.attempt&&approval.expectedManifestSha256===sha(expectedBytes),'REVIEW_ADMISSION_REQUIRED');
 await verifyExpected(expected.executionPins);await verifyExpected(expected.inputPins);
 const {build}=await import('esbuild');const {chromium}=await import('@playwright/test');
 const buildResult=await build({entryPoints:[path.join(here,'browser-entry.tsx')],bundle:true,platform:'browser',format:'iife',jsx:'automatic',metafile:true,outfile:path.join(target,'harness.js'),define:{'process.env.NODE_ENV':'"production"'}});
 const inputPins={};
 for(const name of Object.keys(buildResult.metafile.inputs)){const file=await realpath(path.resolve(name));inputPins[file]=sha(await readFile(file));}
 results.inputPins=inputPins;
 assert.deepEqual(inputPins,expected.inputPins,'UNEXPECTED_BUNDLE_INPUT');
 results.bundlePins={js:sha(await readFile(path.join(target,'harness.js'))),css:sha(await readFile(path.join(target,'harness.css')))};
 assert.deepEqual(results.bundlePins,expected.bundlePins,'UNEXPECTED_BUNDLE_BYTES');
 await writeFile(path.join(target,'metafile.json'),JSON.stringify(buildResult.metafile,null,2));
const html='<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic Fishing billing component review</title><link rel="stylesheet" href="/harness.css"><style>html{font-family:Arial,sans-serif;background:#f2f5f9}body{margin:0}button,input,textarea{font-family:inherit}</style></head><body><div id="root"></div><script src="/harness.js"></script></body></html>';
const allowed=new Map([['/harness.js','text/javascript'],['/harness.css','text/css']]);
server=createServer(async(req,res)=>{
 try{
 if(req.method!=='GET'){res.statusCode=405;res.end();return;}
 const pathname=new URL(req.url,'http://localhost').pathname;
 if(pathname==='/favicon.ico'){res.statusCode=204;res.end();return;}
 if(pathname==='/'){res.setHeader('content-type','text/html');res.end(html);return;}
 const mime=allowed.get(pathname);
 if(!mime){res.statusCode=404;res.end();return;}
 res.setHeader('content-type',mime);res.end(await readFile(path.join(target,pathname.slice(1))));
 }catch{res.statusCode=500;res.end();}
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
port=server.address().port;base=`http://127.0.0.1:${port}`;results.base=base;await lifecycle();
results.browserExecutable={path:chromium.executablePath(),sha256:sha(await readFile(chromium.executablePath()))};
 assert.equal(expected.executionPins[await realpath(chromium.executablePath())],results.browserExecutable.sha256,'BROWSER_EXECUTABLE_PIN');
browserServer=await chromium.launchServer({headless:true,host:'127.0.0.1',timeout:15000});await lifecycle();
browser=await chromium.connect(browserServer.wsEndpoint(),{timeout:10000});
const context=await browser.newContext();
await context.route('**/*',route=>new URL(route.request().url()).origin===base&&route.request().method()==='GET'?route.continue():route.abort());
page=await context.newPage();page.setDefaultTimeout(8000);page.setDefaultNavigationTimeout(8000);
page.on('pageerror',error=>errors.push(error.message));
page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
async function open(query,width=390,height=844){await page.setViewportSize({width,height});await page.goto(`${base}/?${query}`);await page.locator('[data-billing-owner-panel]').waitFor();await page.evaluate(()=>document.fonts.ready);}
async function check(name,fn){await fn();results.checks.push(name);}
async function capture(name){for(const fullPage of [false,true]){const file=path.join(target,`${name}${fullPage?'':'-viewport'}.png`);await page.screenshot({path:file,fullPage});results.screenshots.push(file);}}
async function noOverflow(){assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'horizontal page overflow');}
async function cash(locale='en'){
 await page.getByRole('button',{name:locale==='he'?'התקבל מזומן':'Cash received',exact:true}).click();
 await page.getByRole('dialog').waitFor();
}
 for(const locale of ['en','he'])for(const [width,height,label] of [[320,568,'narrow'],[390,844,'mobile'],[1440,900,'desktop']]){
  await open(`locale=${locale}&mode=disabled`,width,height);await capture(`${locale}-${label}`);await check(`${locale}-${label}-overflow`,noOverflow);
 }
 await open('locale=en');await cash();await capture('en-cash-edit');
 await check('native dialog focus contained',async()=>{for(let n=0;n<14;n++){await page.keyboard.press('Tab');assert(await page.evaluate(()=>document.querySelector('dialog').contains(document.activeElement)));}});
 await page.keyboard.press('Escape');
 await check('Escape closes and restores original focus',async()=>{assert.equal(await page.getByRole('dialog').count(),0);assert.equal(await page.locator(':focus').innerText(),'Cash received');});
 await open('locale=en&mode=deferred');await cash();await page.getByRole('button',{name:'Review entry',exact:true}).click();await page.getByLabel('Amount received (USD)',{exact:false}).fill('10');
 await page.evaluate(()=>window.releaseBillingDate());await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>resolve())));
 await check('same-dialog editing rejects the late prepared command',async()=>{assert.equal(await page.getByRole('button',{name:'Confirm entry',exact:true}).count(),0);assert.equal(await page.getByLabel('Amount received (USD)',{exact:false}).inputValue(),'10');assert.equal(await page.evaluate(()=>window.billingUiQa.commands.length),0);});
 await page.keyboard.press('Escape');await cash();await page.getByRole('button',{name:'Review entry',exact:true}).click();await page.keyboard.press('Escape');await cash();await page.evaluate(()=>window.releaseBillingDate());await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>resolve())));
 await check('same-family close and reopen rejects late preparation',async()=>assert.equal(await page.getByRole('button',{name:'Confirm entry',exact:true}).count(),0));
 await open('locale=en');
 await cash();await page.getByRole('button',{name:'Review entry',exact:true}).click();await page.getByRole('button',{name:'Confirm entry',exact:true}).waitFor();await capture('en-cash-review');
 await page.getByRole('button',{name:'Confirm entry',exact:true}).evaluate(button=>{button.click();button.click();});await page.getByRole('button',{name:'Done',exact:true}).waitFor();await page.getByRole('button',{name:'Done',exact:true}).click();
 await check('one confirmed command with current paid balance',async()=>{assert.equal(await page.evaluate(()=>window.billingUiQa.commands.length),1);assert.match(await page.locator('[aria-label="Authoritative balance"]').innerText(),/Paid/);});await capture('en-cash-confirmed');
 await open('locale=en&mode=unknown');await cash();await page.getByRole('button',{name:'Review entry',exact:true}).click();await page.getByRole('button',{name:'Confirm entry',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Check operation status'}).waitFor();await capture('en-unknown');
 await page.getByRole('dialog').getByRole('button',{name:'Check operation status'}).click();await page.getByRole('button',{name:'Done',exact:true}).waitFor();
 await check('unknown recovers only the original operation',async()=>{const qa=await page.evaluate(()=>window.billingUiQa);assert.equal(qa.commands.length,1);assert.deepEqual(qa.lookups,qa.commands);assert.equal(qa.generated,1);});
 await open('locale=en&mode=unresolved');await cash();await page.getByRole('button',{name:'Review entry',exact:true}).click();await page.getByRole('button',{name:'Confirm entry',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Check operation status'}).click();
 await check('absent operation stays unknown without another command',async()=>{const qa=await page.evaluate(()=>window.billingUiQa);assert.equal(qa.commands.length,1);assert.deepEqual(qa.lookups,qa.commands);assert.equal(await page.getByRole('button',{name:'Confirm entry',exact:true}).count(),0);});await capture('en-still-unresolved');
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
 await capture('he-holdout-intentionally-occluded');
 await check('intentional test-only occlusion is rejected',async()=>assert.equal(await visibleControl(),false));
 await page.locator('#qa-occlusion').evaluate(el=>el.remove());await check('holdout action restored after removing test mutation',async()=>assert(await visibleControl()));
 await capture('he-holdout-corrected');
 await page.keyboard.press('Escape');await page.evaluate(()=>{document.documentElement.style.fontSize='200%';document.body.style.fontSize='2rem';});await noOverflow();await capture('he-enlarged-text-emulation');
 await page.emulateMedia({reducedMotion:'reduce'});await noOverflow();results.checks.push('reduced-motion media applied without overflow');
 assert.deepEqual(errors,[]);results.checks.push('no browser page errors');
 for(const [file,hash] of Object.entries(inputPins))assert.equal(sha(await readFile(file)),hash,'IMPORTED_INPUT_CHANGED');
 await verifyExpected(expected.executionPins);
 results.importedInputsFrozen=true;results.success=true;
}catch(error){
 results.error=String(error);process.exitCode=1;
 if(page)try{await bounded(page.screenshot({path:path.join(target,'failure.png'),fullPage:true}),3000);}catch{/* Cleanup still runs. */}
}finally{
 try{await cleanup();}catch(error){results.cleanupError=String(error);process.exitCode=1;}
 clearTimeout(deadline);
 await writeFile(path.join(target,'results.json'),JSON.stringify(results,null,2));await lifecycle();
}
console.log(JSON.stringify({evidence:target,checks:results.checks.length,screenshots:results.screenshots.length,success:results.success,error:results.error,errors},null,2));
