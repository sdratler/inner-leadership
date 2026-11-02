import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {expect,test} from '@playwright/test';
import {trip390CommandSchema,trip390Copy,TRIP390_NOTICE_VERSION,type Trip390Command} from '../../../src/features/group-application/academy-trip390-contract.ts';
import {TRIP390_MEDIA_TYPE} from '../../../src/features/group-application/academy-trip390-transport.ts';

const fixture=process.env.LS_GROUP_INTEREST_FIXTURE_PATH;
if(!fixture||process.env.LS_ACADEMY_TRIP390_UI_ONLY!=='true')throw Error('TRIP390_DISPOSABLE_FIXTURE_REQUIRED');
const runtime=JSON.parse(readFileSync(fixture,'utf8')) as {origin:string;academy:{email:string;password:string}};
if(!/^https:\/\/localhost:310[5678]$/.test(runtime.origin)||!runtime.academy)throw Error('TRIP390_FIXTURE_ORIGIN_REQUIRED');
test.use({baseURL:runtime.origin});

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
 const form=page.locator('#interest form');
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
 await expect(form.getByRole('alert')).toHaveText(copy.form.save_unknown);
 await expect(form.locator('[name=guardianName]')).toBeDisabled();expect(requests).toHaveLength(1);
 const languageToggle=page.locator('header button[lang="'+other+'"]');await languageToggle.click();
 await expect(form.locator('[name=city]')).toHaveValue(city);await expect(form.locator('[name=postalCode]')).toHaveValue(zip);
 await expect(form.locator('[name=messageLanguage]')).toHaveValue(other);
 await form.locator('button[type=submit]').click();
 const status=page.locator('#interest [role=status]');
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
