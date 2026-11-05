import {academyR2Copy as trip390Copy} from '../../../src/features/group-application/academy-r2-copy.ts';
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {expect,test} from '@playwright/test';
import {trip390CommandSchema,TRIP390_NOTICE_VERSION,TRIP390_INTEREST_VERSION,TRIP390_OFFER,TRIP390_DRIVING_VERSION,type Trip390Command} from '../../../src/features/group-application/academy-trip390-contract.ts';
import {trip390ReservationNotice} from '../../../src/features/group-application/academy-trip390-reservation-notice.ts';
import {trip390StudentConduct} from '../../../src/features/group-application/academy-trip390-student-conduct.ts';
import {trip390LearningAssets} from '../../../src/features/group-application/academy-trip390-learning-assets.ts';
import {TRIP390_MEDIA_TYPE} from '../../../src/features/group-application/academy-trip390-transport.ts';
import {inspectLanding,inspectDialog,inspectFaqContact,inspectBodyHeadings,inspectBodyContact} from './academy-trip390.visual-checks.ts';
import scenes from '../../../src/features/group-application/academy-scenes.json' with {type:'json'};

import iconManifest from '../../../public/groups/academy/icons/r2/manifest.json' with {type:'json'};

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
 for(const asset of iconManifest){
  const bytes=readFileSync('public/groups/academy/icons/r2/'+asset.name+'.svg');
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(asset.sha256);
 }
});

for(const locale of ['en','he'] as const)test(`${locale}: real two-child save, response loss, exact retry and authenticated owner readback`,async({page})=>{
 const copy=trip390Copy[locale],other=locale==='en'?'he':'en';
 const guardian='Synthetic Trip390 '+locale+' '+randomUUID(),email='synthetic-trip390-'+randomUUID()+'@example.invalid';
 const city='Synthetic Unlisted District '+locale,zip='01234-5678';
 const children=[{name:'Synthetic older '+locale,ageYears:12,experience:'some'},{name:'Synthetic younger '+locale,ageYears:9,experience:'new'}];
 await page.goto('/'+locale+'/florida');
 await expect(page.locator('#trip390-title')).toBeVisible();
 await expect(page).toHaveTitle(copy.exact.pageTitle);
 await expect(page.locator('meta[name=description]')).toHaveAttribute('content',copy.exact.metaDescription);
 const cost=copy.faqs.find(item=>item.id==='cost')!,costDetails=page.locator('#faq #cost');
 await expect(costDetails.locator('summary')).toContainText(cost.q);
 await costDetails.locator('summary').click();
 await expect(costDetails.locator('p')).toBeVisible();await expect(costDetails.locator('p')).toHaveText(cost.a);
 await costDetails.locator('summary').click();await page.evaluate(()=>window.scrollTo(0,0));
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
 await page.screenshot({path:test.info().outputPath(locale+'-trip390-landing.png'),fullPage:true});
 await page.goto('/'+locale+'/florida/apply#academy-form');
 await expect(page).toHaveURL('/'+locale+'/florida/apply#interest');
 const dialog=page.getByRole('dialog'),form=dialog.locator('form');
 await expect.poll(()=>page.locator('img[src="/groups/people/founder-head.jpg"]').evaluate(node=>(node as HTMLImageElement).complete&&(node as HTMLImageElement).naturalWidth>0)).toBe(true);
 await expect(dialog).toBeVisible();
 await expect(form.locator('button[type=submit]')).toBeVisible();
 await expect(form.locator('button[type=submit]')).toBeEnabled();
 await expect(form.locator('input[type=checkbox]')).toHaveCount(3);
 expect(await form.locator('input[type=checkbox]').evaluateAll(nodes=>nodes.map(node=>({name:(node as HTMLInputElement).name,required:(node as HTMLInputElement).required})))).toEqual([{name:'interest',required:true},{name:'conduct',required:true},{name:'whatsapp',required:false}]);
 await expect(form.locator('[name=guardianTypedName],[name=guardianSignature],[data-program-terms-version],[data-student-agreement-version]')).toHaveCount(0);
 await expect(form.locator('[name=email]')).toHaveAttribute('required','');
 await expect(form.locator('[name=phoneE164]')).toHaveAttribute('required','');
 await expect(form.locator('[name=interest]').locator('..').locator('span[lang]')).toHaveText(trip390ReservationNotice(locale).acknowledgment);
 await expect(form.locator('[name=conduct]').locator('..').locator('span[lang]')).toHaveText(trip390StudentConduct(locale).acknowledgment);
 for(const name of ['conduct','interest','whatsapp'])await expect(form.locator('[name='+name+']')).not.toBeChecked();
 for(const [name,value] of Object.entries({guardianName:guardian,email,phoneE164:'+12025550107',city,postalCode:zip}))await form.locator('[name='+name+']').fill(value);
 await form.locator('[name=lessonDayDriving]').selectOption('up_to_90');
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
 await dialog.getByRole('button',{name:copy.exact.form.close,exact:true}).click();
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
 const issued=page.waitForResponse(response=>response.request().method()==='GET'&&new URL(response.url()).pathname==='/api/public/group-applications');
 await form.locator('button[type=submit]').click();
 await expect(form.locator('button[type=submit]')).toBeDisabled();
 await expect(form.locator('button[type=submit]')).toHaveText(copy.form.sending);
 await expect(form.getByRole('alert')).toHaveText(copy.form.save_unknown);
 await expect(form.locator('[name=guardianName]')).toBeDisabled();expect(requests).toHaveLength(1);
 const challenge=await issued;expect(challenge.status()).toBe(200);expect(challenge.request().headers().accept).toBe(TRIP390_MEDIA_TYPE);
 expect((await challenge.json()).data).toMatchObject({version:TRIP390_INTEREST_VERSION,offerVersion:TRIP390_OFFER.version,noticeVersion:TRIP390_NOTICE_VERSION});
 // The native modal makes the page header inert; locale switching is local to it.
 const languageToggle=dialog.locator('button[lang="'+other+'"]');await languageToggle.click();
 await expect(form.locator('[name=city]')).toHaveValue(city);await expect(form.locator('[name=postalCode]')).toHaveValue(zip);
 await expect(form.locator('[name=messageLanguage]')).toHaveValue(other);
 await expect(form.locator('[name=phoneE164]')).toHaveValue('+12025550107');await expect(form.locator('[name=lessonDayDriving]')).toHaveValue('up_to_90');
 await form.locator('button[type=submit]').click();
 const status=dialog.locator('[role=status]');
 await expect(status).toContainText(reference);await expect(status).toContainText(trip390Copy[other].form.saved);
 await expect(status).toContainText(trip390Copy[other].form.email_not_queued);
 expect(requests).toHaveLength(2);expect(requests[1]).toEqual(requests[0]);
 const fields=requests[0]!.fields;
 expect(fields).toMatchObject({version:TRIP390_INTEREST_VERSION,offerVersion:TRIP390_OFFER.version,guardianName:guardian,email,phone:'+12025550107',city,postalCode:zip,messageLanguage:other,instructionLanguage:'either',lessonDayDriving:{version:TRIP390_DRIVING_VERSION,limit:'up_to_90'},
  acknowledgment:{version:TRIP390_NOTICE_VERSION,language:locale,conductExplained:true,interestPrivacySafety:true,whatsapp:false}});
 for(const [key,document] of [['reservationNotice',trip390ReservationNotice(locale)],['studentConduct',trip390StudentConduct(locale)]] as const){
  expect(fields.acknowledgment[key]).toEqual({version:document.version,language:locale,text:document.text,textDigest:document.textDigest});
 }
 expect(fields.acknowledgment).not.toHaveProperty('studentAgreement');expect(fields.acknowledgment).not.toHaveProperty('programTerms');
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
 const followup=await page.request.get('/api/private/group-applications/followups?id='+reference);
 expect(followup.status()).toBe(200);
 const followupResult=await followup.json();expect(followupResult.ok).toBe(true);expect(followupResult.data.followup.version).toBe(0);
 await expect(page.getByText(locale==='en'?'Follow-up could not be read. Try again.':'לא ניתן לקרוא את המעקב. אפשר לנסות שוב.',{exact:true})).toHaveCount(0);
 await page.screenshot({path:test.info().outputPath(locale+'-owner-detail.png'),fullPage:true});
 await page.getByRole('button',{name:locale==='en'?'Back to all inquiries':'חזרה לכל הפניות',exact:true}).click();
 await expect(page).not.toHaveURL(/inquiryId=/);
 // Start at the ordinary list URL, without inheriting the initial direct-link
 // reference; selection must survive a real reload in its own right.
 await page.goto('/'+locale+'/app/group-applications');
 await page.getByLabel(locale==='en'?'Search saved inquiries':'חיפוש בפניות שמורות',{exact:true}).fill(guardian);
 await page.getByRole('button',{name:locale==='en'?'Search':'חיפוש',exact:true}).click();
 const row=page.locator(`[data-inquiry-row="${reference}"]`);await expect(row).toContainText(guardian);
 for(const child of children)await expect(row).toContainText(child.name);
 await page.screenshot({path:test.info().outputPath(locale+'-owner-list.png'),fullPage:true});
 await row.getByRole('button',{name:locale==='en'?'Open inquiry from '+guardian:'פתיחת הפנייה של '+guardian,exact:true}).click();
 await expect(page).toHaveURL(new RegExp('inquiryId='+reference));
 await expect(article).toContainText(zip);await expect(article).toContainText(fields.children[1]!.name);
 await page.reload();await expect(article).toContainText(fields.children[0]!.name);await expect(article).toContainText(fields.children[1]!.name);
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
   await page.evaluate(()=>document.fonts.ready);
   // Cold page / no scroll: eager portrait must load on every route and size.
   await expect.poll(()=>page.locator('img[src="/groups/people/founder-head.jpg"]').evaluate(node=>(node as HTMLImageElement).complete&&(node as HTMLImageElement).naturalWidth>0)).toBe(true);
   const cards=page.locator('[data-trip390-skill]');await expect(cards).toHaveCount(6);
   for(const [index,asset] of trip390LearningAssets.entries()){
    const card=cards.nth(index);await expect(card).toHaveAttribute('data-trip390-skill',String(index+1));
    await expect(card.locator('h3')).toHaveText(trip390Copy[locale].skills[index]!.title);await expect(card.locator('p')).toHaveText(trip390Copy[locale].skills[index]!.body);
    await card.scrollIntoViewIfNeeded();
    const image=card.locator('img');await expect(image).toHaveAttribute('src',asset.src);await expect(image).toHaveAttribute('alt',trip390Copy[locale].skills[index]!.alt);
    await expect.poll(()=>image.evaluate(node=>(node as HTMLImageElement).complete&&(node as HTMLImageElement).naturalWidth>0)).toBe(true);
    const response=await page.request.get(new URL(asset.src,page.url()).href);expect(response.status()).toBe(200);
    const sourceFile='filePath' in asset?asset.filePath:asset.src;
    expect(createHash('sha256').update(await response.body()).digest('hex')).toBe(createHash('sha256').update(readFileSync('public'+sourceFile)).digest('hex'));
    const frame=card.locator('img,[data-trip390-image-unavailable]');const ratio=await frame.evaluate(node=>{const b=node.getBoundingClientRect();return b.width/b.height;});expect(Math.abs(ratio-16/9)).toBeLessThan(.005);
   }
   await expect(page.locator('[data-trip390-image-unavailable]')).toHaveCount(0);
   await expect(page.locator('[data-trip390-scene]')).toHaveCount(0);
   const values=page.locator('#values article');
   await expect(values).toHaveCount(4);
   for(const [index,item] of trip390Copy[locale].exact.values.items.entries()){
    const card=values.nth(index),icon=card.locator('svg');
    await expect(card.locator('h3')).toHaveText(item.title);await expect(card.locator('p')).toHaveText(item.body);
    await card.scrollIntoViewIfNeeded();await expect(icon).toBeVisible();
    await expect(icon).toHaveAttribute('aria-hidden','true');await expect(icon).toHaveAttribute('focusable','false');
    await expect(icon).toHaveAttribute('viewBox','0 0 24 24');await expect(icon).toHaveAttribute('stroke','currentColor');
    const record=iconManifest[index]!;expect([record.name,record.role]).toEqual([item.icon,item.id]);
    const artwork=readFileSync('public/groups/academy/icons/r2/'+record.name+'.svg','utf8');
    const geometry=await icon.evaluate((svg,source)=>{
     const original=new DOMParser().parseFromString(source,'image/svg+xml').documentElement;
     const shapes=(node:Element)=>Array.from(node.children,child=>[child.localName,...Array.from(child.attributes,a=>a.name+'='+a.value).sort()]);
     const bounds=svg.getBoundingClientRect();
     return {actual:shapes(svg),expected:shapes(original),width:bounds.width,height:bounds.height};
    },artwork);
    expect(geometry.actual).toEqual(geometry.expected);expect(geometry.width).toBeGreaterThan(0);expect(Math.abs(geometry.width/geometry.height-1)).toBeLessThan(.005);
    if(width===1440||width===390){
     await expect.poll(async()=>(await inspectBodyContact(page)).findings).toEqual([]);
     await page.screenshot({path:info.outputPath(`${locale}-${width}x${height}-${item.id}-placement.png`)});
    }
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
   if(width===320||width===375||height===390){
    const submit=dialog.locator('button[type=submit]');
    await dialog.locator('[name=whatsapp]').focus();await page.keyboard.press('Tab');await expect(submit).toBeFocused();
    await expect.poll(async()=>{const b=await submit.boundingBox(),h=await dialog.getByRole('heading',{name:trip390Copy[locale].form.title,exact:true}).locator('..').boundingBox();return b!==null&&h!==null&&b.y>=h.y+h.height&&b.y+b.height<=height;}).toBe(true);
    await page.screenshot({path:info.outputPath(`${locale}-${width}x${height}-dialog-submit-keyboard.png`)});
    await submit.click();await expect(dialog.getByRole('alert')).toBeVisible();
    await expect(dialog.locator('[name=guardianName]')).toHaveAttribute('aria-invalid','true');
    await page.screenshot({path:info.outputPath(`${locale}-${width}x${height}-dialog-validation.png`)});
   }
   await page.keyboard.press('Escape');await expect(dialog).not.toBeVisible();
   await expect(page.locator('[data-hero-action] a')).toBeFocused();
  }
  await page.setViewportSize({width:1440,height:900});
  await page.goto('/'+locale+'/florida#faq');
  const details=page.locator('[data-trip390-faq]');
  const publicFaqs=trip390Copy[locale].faqs.filter(item=>item.id!=='cancellation'&&item.id!=='conduct');
  await expect(details).toHaveCount(12);
  expect(await details.evaluateAll(nodes=>nodes.map(x=>x.id))).toEqual(publicFaqs.map(x=>x.id));
  await details.nth(0).locator('summary').click();await expect(details.nth(0)).toHaveAttribute('open','');
  await details.nth(1).locator('summary').click();await expect(page.locator('[data-trip390-faq][open]')).toHaveCount(1);
  await expect(details.nth(0)).not.toHaveAttribute('open','');
  const longest=publicFaqs.reduce((best,item,index,array)=>item.a.length>array[best]!.a.length?index:best,0);
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
  await menu.click();await page.locator('#trip390-menu a[href="#values"]').click();
  await expect(page.locator('#trip390-menu')).not.toBeVisible();
  const anchor=await page.locator('#values').boundingBox(),header=await page.locator('header').boundingBox();
  expect(anchor!.y).toBeGreaterThanOrEqual(header!.height);
  await page.locator('header button[lang="'+locale+'"]').click();
  await expect(page.locator('header button[lang="'+locale+'"]')).toHaveAttribute('aria-pressed','true');
  await menu.click();await page.locator('#trip390-menu a[href="#faq"]').click();
  const faqHeading=page.locator('#trip390-faq-title');await expect.poll(async()=>{const h=await page.locator('header').boundingBox(),q=await faqHeading.boundingBox();return q!.y>=h!.height;}).toBe(true);
  await details.nth(longest).locator('summary').click();await expect(details.nth(longest)).toHaveAttribute('open','');
  await details.nth(longest).locator('summary').scrollIntoViewIfNeeded();
  await expect.poll(async()=>(await inspectBodyContact(page)).findings).toEqual([]);
  await page.screenshot({path:info.outputPath(`${locale}-mobile-faq-expanded.png`)});
  await details.nth(longest).locator('summary').click();
  await page.evaluate(()=>document.querySelector('#faq')?.scrollIntoView({block:'start'}));
  await expect.poll(async()=>(await inspectFaqContact(page)).findings).toEqual([]);
  await page.screenshot({path:info.outputPath(`${locale}-mobile-faq-viewport.png`)});
  const faqPositions=[];
  for(const index of [0,Math.floor((publicFaqs.length-1)/3),Math.floor(2*(publicFaqs.length-1)/3),publicFaqs.length-1]){
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
  await page.locator('#values h2').scrollIntoViewIfNeeded();
  await expect.poll(async()=>(await inspectBodyContact(page)).findings).toEqual([]);
  await page.screenshot({path:info.outputPath(`${locale}-200percent-values-viewport.png`)});
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
 for(const [name,value] of Object.entries({guardianName:'Synthetic long-label holdout',email:'holdout@example.invalid',phoneE164:'+12025550108',city:'Synthetic district',postalCode:'01234'}))await form.locator('[name='+name+']').fill(value);
 await form.locator('[name=lessonDayDriving]').selectOption('up_to_60');
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
 await form.locator('button[type=submit]').click();await expect(form.getByRole('alert')).toHaveText(trip390Copy.he.exact.form.unavailable);
 await expect(form.locator('[name=postalCode]')).toHaveValue('01234');
 await page.screenshot({path:info.outputPath('holdout-unavailable.png')});
 const metricsPath=info.outputPath('measured-visual-and-negative-case-evidence.json');
 writeFileSync(metricsPath,JSON.stringify(diagnostics,null,2));
 await info.attach('measured-visual-and-negative-case-evidence',{path:metricsPath,contentType:'application/json'});
});
