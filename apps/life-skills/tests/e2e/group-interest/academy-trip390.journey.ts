import {createHash,randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {expect,test} from '@playwright/test';
import {trip390CommandSchema,trip390Copy,TRIP390_NOTICE_VERSION,type Trip390Command} from '../../../src/features/group-application/academy-trip390-contract.ts';
import {TRIP390_MEDIA_TYPE} from '../../../src/features/group-application/academy-trip390-transport.ts';
import {inspectLanding,inspectDialog,inspectFaqContact,inspectBodyHeadings} from './academy-trip390.visual-checks.ts';
import scenes from '../../../src/features/group-application/academy-scenes.json' with {type:'json'};

const fixture=process.env.LS_GROUP_INTEREST_FIXTURE_PATH;
if(!fixture||process.env.LS_ACADEMY_TRIP390_UI_ONLY!=='true')throw Error('TRIP390_DISPOSABLE_FIXTURE_REQUIRED');
const runtime=JSON.parse(readFileSync(fixture,'utf8')) as {origin:string;academy:{email:string;password:string}};
if(!/^https:\/\/localhost:310[5678]$/.test(runtime.origin)||!runtime.academy)throw Error('TRIP390_FIXTURE_ORIGIN_REQUIRED');
test.use({baseURL:runtime.origin});
test.beforeAll(()=>{
 for(const slot of ['foundation','advanced','advanced-mobile','form']){
  const asset=scenes.assets.find(item=>item.slot===slot)!;
  const bytes=readFileSync('public'+asset.publicPath);
  expect(bytes.length).toBe(asset.bytes);expect(createHash('sha256').update(bytes).digest('hex')).toBe(asset.sha256);
 }
});

for(const locale of ['en','he'] as const)test(`${locale}: real two-child save, response loss, exact retry and authenticated owner readback`,async({page})=>{
 const copy=trip390Copy[locale],other=locale==='en'?'he':'en';
 const guardian='Synthetic Trip390 '+locale+' '+randomUUID(),email='synthetic-trip390-'+randomUUID()+'@example.invalid';
 const city='Synthetic Unlisted District '+locale,zip='01234-5678';
 const children=[{name:'Synthetic older '+locale,ageYears:12,experience:'some'},{name:'Synthetic younger '+locale,ageYears:9,experience:'new'}];
 await page.goto('/'+locale+'/florida');
 await expect(page.locator('#trip390-title')).toBeVisible();
 await expect(page).toHaveTitle(copy.metadata.title);
 await expect(page.locator('#main')).toContainText(copy.hero.offer);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
 await page.screenshot({path:test.info().outputPath(locale+'-trip390-landing.png'),fullPage:true});
 await page.goto('/'+locale+'/florida/apply#academy-form');
 await expect(page).toHaveURL('/'+locale+'/florida/apply#interest');
 const dialog=page.getByRole('dialog'),form=dialog.locator('form');
 await expect(dialog).toBeVisible();
 await expect(form.locator('button[type=submit]')).toBeVisible();
 await expect(form.locator('button[type=submit]')).toBeEnabled();
 await expect(form.locator('input[type=checkbox]')).toHaveCount(3);
 for(const name of ['conduct','interest','whatsapp'])await expect(form.locator('[name='+name+']')).not.toBeChecked();
 for(const [name,value] of Object.entries({guardianName:guardian,email,city,postalCode:zip}))await form.locator('[name='+name+']').fill(value);
 await form.getByRole('button',{name:copy.form.add_child}).click();
 for(let i=0;i<children.length;i++){
  const child=children[i]!,name=form.locator('input[name^="child-"][name$="-name"]').nth(i),section=name.locator('xpath=ancestor::fieldset[1]');
  await name.fill(child.name);await section.locator('input[type=number]').fill(String(child.ageYears));await section.locator('select').selectOption(child.experience);
 }
 await form.locator('[name=messageLanguage]').selectOption(other);
 await form.locator('[name=instructionLanguage]').selectOption('either');
 await form.locator('[name=conduct]').check();await form.locator('[name=interest]').check();
 // Closing is presentation only: preserve the one mounted form and sibling IDs.
 const siblingInputs=await form.locator('input[name^="child-"][name$="-name"]').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('name')));
 await dialog.getByRole('button',{name:locale==='en'?'Close interest form':'סגירת טופס ההתעניינות',exact:true}).click();
 await expect(dialog).not.toBeVisible();
 await page.locator('[data-hero-action] a').click();
 await expect(dialog).toBeVisible();
 expect(await form.locator('input[name^="child-"][name$="-name"]').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('name')))).toEqual(siblingInputs);
 await expect(form.locator('[name=postalCode]')).toHaveValue(zip);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
 await page.screenshot({path:test.info().outputPath(locale+'-trip390-form.png'),fullPage:true});
 const requests:Trip390Command[]=[];let reference='';
 const endpoint='**/api/public/group-applications?program=sunday_fishing_academy';
 await page.route(endpoint,async route=>{
  if(route.request().method()!=='POST')return route.continue();
  expect(route.request().headers().accept).toBe(TRIP390_MEDIA_TYPE);
  const {operationId,fields}=route.request().postDataJSON();requests.push(trip390CommandSchema.parse({operationId,fields}));
  // Route.fetch performs the real POST against the fixture. Only the first
  // committed reply is discarded. The next click must reconcile the same command.
  const upstream=await route.fetch({headers:{...route.request().headers(),origin:runtime.origin,'sec-fetch-site':'same-origin'}});
  const response=await upstream.json();
  expect(upstream.status()).toBe(requests.length===1?201:200);
  expect(response.ok).toBe(true);
  expect(response.data).toEqual({reference:expect.stringMatching(/^[0-9a-f-]{36}$/),operationId,acknowledgment:'not_queued',replayed:requests.length===2});
  if(requests.length===1){reference=response.data.reference;await route.abort('failed');}
  else{expect(response.data.reference).toBe(reference);await route.fulfill({response:upstream});}
 });
 await form.locator('button[type=submit]').click();
 await expect(form.locator('button[type=submit]')).toBeDisabled();
 await expect(form.locator('button[type=submit]')).toHaveText(copy.form.sending+'↗');
 await expect(form.getByRole('alert')).toHaveText(copy.form.save_unknown);
 await expect(form.locator('[name=guardianName]')).toBeDisabled();expect(requests).toHaveLength(1);
 // The native modal makes the page header inert; locale switching is local to it.
 const languageToggle=dialog.locator('button[lang="'+other+'"]');await languageToggle.click();
 await expect(form.locator('[name=city]')).toHaveValue(city);await expect(form.locator('[name=postalCode]')).toHaveValue(zip);
 await expect(form.locator('[name=messageLanguage]')).toHaveValue(other);
 await form.locator('button[type=submit]').click();
 const status=dialog.locator('[role=status]');
 await expect(status).toContainText(reference);await expect(status).toContainText(trip390Copy[other].form.saved);
 await expect(status).toContainText(other==='en'?'No confirmation email has been queued.':'לא הוכנסה הודעת אישור לתור השליחה.');
 expect(requests).toHaveLength(2);expect(requests[1]).toEqual(requests[0]);
 const fields=requests[0]!.fields;
 expect(fields).toMatchObject({guardianName:guardian,email,city,postalCode:zip,messageLanguage:other,instructionLanguage:'either',
  acknowledgment:{version:TRIP390_NOTICE_VERSION,language:locale,conductExplained:true,interestPrivacySafety:true,whatsapp:false}});
 expect(fields.children.map(({name,ageYears,experience})=>({name,ageYears,experience}))).toEqual(children);
 expect(new Set(fields.children.map(child=>child.id)).size).toBe(2);
 await page.unroute(endpoint);
 const privatePath='/api/private/group-applications?reference='+reference;
 expect((await page.request.get(privatePath)).status()).toBe(401);
 const ownerPath='/'+locale+'/app/group-applications?inquiryId='+reference;
 await page.goto(ownerPath);
 await page.getByLabel(locale==='en'?'Email':'דוא״ל',{exact:true}).fill(runtime.academy.email);
 await page.getByLabel(locale==='en'?'Password':'סיסמה',{exact:true}).fill(runtime.academy.password);
 const login=page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname==='/api/identity/login');
 await page.getByRole('button',{name:locale==='en'?'Sign in':'כניסה',exact:true}).click();expect((await login).status()).toBe(200);
 await expect(page).toHaveURL(ownerPath);
 const article=page.locator(`article[data-trip390-interest="${reference}"]`);
 await expect(article).toContainText(guardian);await expect(article).toContainText(zip);await expect(article).toContainText(city);
 for(const child of fields.children){await expect(article).toContainText(child.name);await expect(article).toContainText(child.id);}
 const read=await page.request.get(privatePath);expect(read.status()).toBe(200);expect(read.headers()['cache-control']).toContain('no-store');
 const {data}=await read.json();expect(data.items).toHaveLength(1);expect(data.items[0].id).toBe(reference);expect(data.items[0].fields).toEqual(fields);
 await page.reload();await expect(article).toContainText(reference);await expect(article).toContainText(fields.children[1]!.name);
});

test('landing matrix, native dialog interactions and independent holdout regression',async({page},info)=>{
 test.skip(info.project.name!=='desktop','One responsive matrix covers both locales; each project retains its real save/readback cases.');
 const diagnostics:unknown[]=[];
 const sizes=[[320,568],[375,667],[390,844],[430,932],[768,1024],[1366,768],[1440,900],[844,390]] as const;
 for(const locale of ['en','he'] as const){
  for(const [width,height] of sizes){
   await page.setViewportSize({width,height});
   await page.goto('/'+locale+'/florida');
   await expect(page.locator('#trip390-title')).toBeVisible();
   await expect(page.locator('[data-trip390-scene]')).toHaveCount(3);
   for(const slot of ['foundation','advanced','form']){
    const figure=page.locator(`[data-trip390-scene="${slot}"]`),image=figure.locator('img');
    await image.scrollIntoViewIfNeeded();
    await expect.poll(()=>image.evaluate(node=>(node as HTMLImageElement).complete&&(node as HTMLImageElement).naturalWidth>0)).toBe(true);
    const selected=slot==='advanced'&&width<768?'advanced-mobile':slot;
    const asset=scenes.assets.find(item=>item.slot===selected)!;
    const dimensions=await image.evaluate(node=>{const image=node as HTMLImageElement,b=image.getBoundingClientRect();return{source:new URL(image.currentSrc).pathname,width:image.naturalWidth,height:image.naturalHeight,ratio:b.width/b.height};});
    expect(dimensions).toMatchObject({source:asset.publicPath,width:asset.width,height:asset.height});
    expect(Math.abs(dimensions.ratio-asset.width/asset.height)).toBeLessThan(.005);
    if(width===1440||width===390)await page.screenshot({path:info.outputPath(`${locale}-${width}x${height}-${slot}-placement.png`)});
   }
   const portrait=page.locator('img[src="/groups/people/founder-head.jpg"]');
   await portrait.scrollIntoViewIfNeeded();
   await expect.poll(()=>portrait.evaluate(image=>(image as HTMLImageElement).complete&&(image as HTMLImageElement).naturalWidth>0)).toBe(true);
   if(width===1440||width===390)await page.screenshot({path:info.outputPath(`${locale}-${width}x${height}-founder.png`)});
   await page.evaluate(async()=>{await document.fonts.ready;window.scrollTo(0,0);});
   await expect.poll(()=>page.locator('section[aria-labelledby="trip390-title"] picture img').evaluate(image=>(image as HTMLImageElement).complete&&(image as HTMLImageElement).naturalWidth>0)).toBe(true);
   await expect.poll(async()=>(await inspectLanding(page)).findings).toEqual([]);
   const landing=await inspectLanding(page);diagnostics.push({locale,width,height,landing});
   await page.screenshot({path:info.outputPath(`${locale}-${width}x${height}-hero.png`)});
   expect(landing.findings,JSON.stringify(landing)).toEqual([]);
   if(width===1440||width===390)await page.screenshot({path:info.outputPath(`${locale}-${width}x${height}-full.png`),fullPage:true});
   await page.locator('[data-hero-action] a').click();
   const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();
   await expect.poll(async()=>(await inspectDialog(page)).findings).toEqual([]);
   await page.screenshot({path:info.outputPath(`${locale}-${width}x${height}-dialog.png`)});
   await page.keyboard.press('Escape');await expect(dialog).not.toBeVisible();
   await expect(page.locator('[data-hero-action] a')).toBeFocused();
  }
  await page.setViewportSize({width:1440,height:900});
  await page.goto('/'+locale+'/florida#faq');
  const details=page.locator('[data-trip390-faq]');
  expect(await details.evaluateAll(nodes=>nodes.map(x=>x.id))).toEqual(trip390Copy[locale].faqs.map(x=>x.id));
  await details.nth(0).locator('summary').click();await expect(details.nth(0)).toHaveAttribute('open','');
  await details.nth(1).locator('summary').click();await expect(page.locator('[data-trip390-faq][open]')).toHaveCount(1);
  await expect(details.nth(0)).not.toHaveAttribute('open','');
  const longest=trip390Copy[locale].faqs.reduce((best,item,index,array)=>item.a.length>array[best]!.a.length?index:best,0);
  await details.nth(longest).locator('summary').click();
  await page.locator('#trip390-faq-title').scrollIntoViewIfNeeded();
  await page.screenshot({path:info.outputPath(`${locale}-faq-viewport.png`)});
  await page.screenshot({path:info.outputPath(`${locale}-faq-expanded.png`),fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.goto('/'+locale+'/florida');
  const menu=page.locator('header button[aria-controls="trip390-menu"]');
  await menu.click();await expect(page.locator('#trip390-menu')).toBeVisible();
  await page.screenshot({path:info.outputPath(`${locale}-mobile-menu.png`)});
  await page.keyboard.press('Escape');await expect(menu).toBeFocused();await expect(page.locator('#trip390-menu')).not.toBeVisible();
  await page.locator('header button[lang="en"]').click();await expect(page.locator('header button[lang="he"]')).toBeVisible();
  await menu.click();await page.locator('#trip390-menu a[href="#included"]').click();
  await expect(page.locator('#trip390-menu')).not.toBeVisible();
  const anchor=await page.locator('#included').boundingBox(),header=await page.locator('header').boundingBox();
  expect(anchor!.y).toBeGreaterThanOrEqual(header!.height);
  await page.locator('header button[lang="'+locale+'"]').click();
  await expect(page.locator('header button[lang="'+locale+'"]')).toHaveAttribute('aria-pressed','true');
  await page.evaluate(()=>document.querySelector('#faq')?.scrollIntoView({block:'start'}));
  await expect.poll(async()=>(await inspectFaqContact(page)).findings).toEqual([]);
  await page.screenshot({path:info.outputPath(`${locale}-mobile-faq-viewport.png`)});
  const faqPositions=[];
  for(const index of [0,5,11,18]){
   await details.nth(index).locator('summary').scrollIntoViewIfNeeded();
   await expect.poll(async()=>(await inspectFaqContact(page)).findings).toEqual([]);
   faqPositions.push({index,...await inspectFaqContact(page)});
  }
  diagnostics.push({locale,faqPositions});
  // 200% text-size emulation is explicitly not physical-device/browser zoom.
  await page.goto('/'+locale+'/florida');await page.emulateMedia({reducedMotion:'reduce'});
  await page.evaluate(()=>{
   const sizes=[...document.querySelectorAll<HTMLElement>('body *')].map(node=>({node,size:parseFloat(getComputedStyle(node).fontSize)}));
   sizes.forEach(({node,size})=>node.style.setProperty('font-size',`${size*2}px`,'important'));
  });
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await expect.poll(()=>page.locator('section[data-reflow="true"]').count()).toBe(1);
  const enlargedPortrait=page.locator('img[src="/groups/people/founder-head.jpg"]');await enlargedPortrait.scrollIntoViewIfNeeded();
  await expect.poll(()=>enlargedPortrait.evaluate(image=>(image as HTMLImageElement).complete&&(image as HTMLImageElement).naturalWidth>0)).toBe(true);
  await expect.poll(()=>inspectBodyHeadings(page)).toEqual([]);
  diagnostics.push({locale,enlargedBodyHeadingFindings:await inspectBodyHeadings(page)});
  await page.evaluate(()=>document.querySelector('#trip390-dates-title')?.scrollIntoView({block:'start'}));
  await page.screenshot({path:info.outputPath(`${locale}-200percent-dates-viewport.png`)});
  await page.evaluate(()=>window.scrollTo(0,0));
  await expect.poll(async()=>(await inspectLanding(page)).findings).toEqual([]);
  const enlarged=await inspectLanding(page);diagnostics.push({locale,textEmulation:'200% computed font sizes',enlarged});
  expect(enlarged.findings,JSON.stringify(enlarged)).toEqual([]);
  await page.screenshot({path:info.outputPath(`${locale}-200percent-text-viewport.png`)});
  await page.screenshot({path:info.outputPath(`${locale}-200percent-text-emulation.png`),fullPage:true});
  await page.emulateMedia({reducedMotion:'no-preference'});
 }
 // Different holdout: long Hebrew answers, two siblings and server rejection.
 await page.setViewportSize({width:375,height:667});await page.goto('/he/florida/apply#interest');
 const dialog=page.getByRole('dialog'),form=dialog.locator('form');await expect(dialog).toBeVisible();
 await form.locator('[name=email]').fill('not-an-email');
 expect(await form.locator('[name=email]').evaluate(node=>(node as HTMLInputElement).validity.typeMismatch)).toBe(true);
 await form.getByRole('button',{name:trip390Copy.he.form.add_child}).click();
 await form.getByRole('button',{name:trip390Copy.he.form.add_child}).click();
 const retainedSibling=await form.locator('input[name^="child-"][name$="-name"]').nth(1).getAttribute('name');
 await form.getByRole('button',{name:trip390Copy.he.form.remove_child+' 3',exact:true}).click();
 expect(await form.locator('input[name^="child-"][name$="-name"]').nth(1).getAttribute('name')).toBe(retainedSibling);
 for(const [name,value] of Object.entries({guardianName:'Synthetic long-label holdout',email:'holdout@example.invalid',city:'Synthetic district',postalCode:'01234'}))await form.locator('[name='+name+']').fill(value);
 for(let i=0;i<2;i++){await form.locator('input[name^="child-"][name$="-name"]').nth(i).fill('Synthetic boy '+i);await form.locator('input[name^="child-"][name$="-age"]').nth(i).fill('10');}
 await form.locator('[name=conduct]').check();await form.locator('[name=interest]').check();
 await page.route('**/api/public/group-applications?program=sunday_fishing_academy',route=>route.request().method()==='GET'?route.continue():route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({ok:false,requestId:randomUUID(),error:{code:'INVALID_REQUEST'}})}));
 await form.locator('button[type=submit]').click();await expect(form.getByRole('alert')).toBeVisible();
 await expect(form.locator('[name=guardianName]')).toBeEnabled();
 // The same detector must reject an actual test-only painted occlusion.
 const closeControl=dialog.locator('button[aria-label]');
 const originalStyle=await closeControl.getAttribute('style');
 await closeControl.evaluate(node=>(node as HTMLElement).style.setProperty('transform','translateX(200vw)','important'));
 const rejected=await inspectDialog(page);expect(rejected.findings).toContain('dialog-close-obscured');
 await page.screenshot({path:info.outputPath('holdout-rejected.png')});
 await closeControl.evaluate((node,original)=>{if(original===null)node.removeAttribute('style');else node.setAttribute('style',original);},originalStyle);
 const corrected=await inspectDialog(page);expect(corrected.findings).toEqual([]);
 await page.screenshot({path:info.outputPath('holdout-corrected.png')});
 await form.locator('input[name^="child-"][name$="-name"]').nth(1).scrollIntoViewIfNeeded();
 await page.screenshot({path:info.outputPath('holdout-two-siblings.png')});
 diagnostics.push({holdout:{rejected,corrected,transport:'test-only rejection; no persistence claimed'}});
 const first=dialog.locator('button[aria-label]'),last=form.locator('button[type=submit]');
 await last.focus();await page.keyboard.press('Tab');await expect(first).toBeFocused();
 await first.focus();await page.keyboard.press('Shift+Tab');await expect(last).toBeFocused();
 await page.keyboard.press('Escape');await expect(dialog).not.toBeVisible();
 await page.locator('[data-hero-action] a').click();await expect(dialog).toBeVisible();
 await page.goBack();await expect(dialog).not.toBeVisible();await page.goForward();await expect(dialog).toBeVisible();
 await expect(form.locator('[name=postalCode]')).toHaveValue('01234');
 await page.unroute('**/api/public/group-applications?program=sunday_fishing_academy');
 await page.route('**/api/public/group-applications?program=sunday_fishing_academy',route=>route.fulfill({status:503,body:'unavailable'}));
 await form.locator('button[type=submit]').click();await expect(form.getByRole('alert')).toContainText('השמירה אינה זמינה');
 await expect(form.locator('[name=postalCode]')).toHaveValue('01234');
 await page.screenshot({path:info.outputPath('holdout-unavailable.png')});
 const metricsPath=info.outputPath('measured-visual-and-negative-case-evidence.json');
 writeFileSync(metricsPath,JSON.stringify(diagnostics,null,2));
 await info.attach('measured-visual-and-negative-case-evidence',{path:metricsPath,contentType:'application/json'});
});
