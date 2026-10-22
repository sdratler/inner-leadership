/** Actual ordinary-auth screens in the retained disposable harness. Synthetic agreements only. */
import {expect,type Page,type Locator,type TestInfo} from '@playwright/test';
import {writeFileSync} from 'node:fs';
function guard(page:Page){if(process.env.LS_ACADEMY_MONTHLY_UI_ONLY!=='true'||!/^https:\/\/localhost:310[56]$/.test(new URL(page.url()).origin))throw Error('EXCLUSIVE_SYNTHETIC_MONTHLY_BROWSER_REQUIRED');}
async function readableOwnerOffer(offer:Locator,locale:'en'|'he',info:TestInfo){
 if(!['mobile340','mobile390'].includes(info.project.name))return;
 expect((await offer.boundingBox())!.width).toBeGreaterThanOrEqual(220);
 const buttons=offer.getByRole('button').filter({visible:true});expect(await buttons.count()).toBeGreaterThanOrEqual(2);const actions=[];
 for(const button of await buttons.all()){
  const geometry=await button.evaluate(element=>{
   const box=element.getBoundingClientRect(),style=getComputedStyle(element),number=(value:string)=>Number.parseFloat(value)||0,range=document.createRange();range.selectNodeContents(element);
   return {width:box.width,height:box.height,textWidth:box.width-number(style.paddingLeft)-number(style.paddingRight)-number(style.borderLeftWidth)-number(style.borderRightWidth),lines:new Set(Array.from(range.getClientRects(),rect=>Math.round(rect.top))).size};
  });
  expect(geometry.width).toBeGreaterThanOrEqual(180);expect(geometry.height).toBeGreaterThanOrEqual(44);expect(geometry.height).toBeLessThanOrEqual(100);expect(geometry.textWidth).toBeGreaterThanOrEqual(140);expect(geometry.lines).toBeGreaterThan(0);expect(geometry.lines).toBeLessThanOrEqual(4);actions.push(geometry);
 }
 writeFileSync(info.outputPath(`academy-owner-offer-geometry-${locale}-${info.project.name}.json`),JSON.stringify({locale,project:info.project.name,offerWidth:(await offer.boundingBox())!.width,actions},null,2));
}
async function exactRetry(page:Page,path:string,submit:Locator,retry:Locator){
 const bodies:string[]=[],keys:string[]=[];let complete=()=>{};const done=new Promise<void>(resolve=>{complete=resolve;});
 const endpoint='**'+path;await page.route(endpoint,async route=>{if(route.request().method()!=='POST')return route.continue();bodies.push(route.request().postData()!);keys.push(route.request().headers()['idempotency-key']!);const upstream=await route.fetch();expect(upstream.status()).toBe(200);if(bodies.length===1)await route.abort('failed');else{await route.fulfill({response:upstream});complete();}});
 await submit.click();await expect(retry).toBeVisible();await retry.click();await done;expect(bodies).toHaveLength(2);expect(bodies[0]).toBe(bodies[1]);expect(keys[0]).toBeTruthy();expect(keys[0]).toBe(keys[1]);await page.unroute(endpoint);
}
export async function academyParentMonthlyJourney(page:Page,input:{learnerId:string;stageId:string;locale:'en'|'he'},info:TestInfo){
 guard(page);const {locale,learnerId,stageId}=input,t=(en:string,he:string)=>locale==='he'?he:en;
 const review=page.locator('[data-academy-enrollment-review]'),monthly=review.locator('[data-academy-monthly]');
 const open=async()=>{await review.locator(':scope > summary').click();await review.getByRole('combobox',{name:t('Choose an Academy group','בחירת קבוצת אקדמיה'),exact:true}).selectOption(stageId);};
 await page.goto(`/${locale}/family?fishing=1`);await page.getByLabel(t('Choose your child','בחירת ילדכם'),{exact:true}).selectOption(learnerId);await open();
 await expect(monthly).toContainText(t('Each later block needs a new authorization','כל מקבץ נוסף מחייב אישור חדש'));expect(await review.textContent()).not.toContain('PRIVATE_SYNTHETIC_OWNER_FIT');
 const lesson=(n:number)=>monthly.getByRole('checkbox',{name:new RegExp('^'+t('Lesson','שיעור')+' '+n+' ·')});
 const signature=monthly.locator('input[name="parentSignature"]'),ack=monthly.locator('input[name="childAcknowledged"]'),witness=monthly.locator('input[name="guardianWitnessed"]'),accepted=monthly.locator('input[name="accepted"]');
 const sign=async()=>{await signature.fill('Synthetic Guardian');await ack.check();await witness.check();await accepted.check();};
 for(const n of [1,2,3,4])await lesson(n).check();await expect(lesson(5)).toBeDisabled();await sign();
 await lesson(4).uncheck();await lesson(5).check();await expect(signature).toHaveValue('');await expect(ack).not.toBeChecked();await expect(witness).not.toBeChecked();await expect(accepted).not.toBeChecked();await lesson(5).uncheck();await lesson(4).check();await sign();
 const submit=monthly.getByRole('button',{name:t('Sign for this four-lesson block','חתימה למקבץ זה של ארבעה שיעורים'),exact:true});
 await exactRetry(page,'/api/private/group-applications/enrollment',submit,review.getByRole('button',{name:t('Retry the same registration review','ניסיון חוזר לאותה בדיקת הרשמה'),exact:true}));
 const history=monthly.getByRole('region',{name:t('Saved block authorizations','אישורי מקבצים שמורים'),exact:true});await expect(history.getByRole('listitem')).toHaveCount(1);
 for(const n of [1,2,3,4])await lesson(n).uncheck();for(const n of [5,6,7,8])await lesson(n).check();await expect(signature).toHaveValue('');await expect(ack).not.toBeChecked();await sign();await submit.click();await expect(history.getByRole('listitem')).toHaveCount(2);
 await page.reload();await open();await expect(history.getByRole('listitem')).toHaveCount(2);const response=await page.request.get('/api/private/group-applications/enrollment?learnerId='+learnerId);expect(response.status()).toBe(200);const data=await response.json(),stage=data.data.stages.find((s:{stageId:string})=>s.stageId===stageId);expect(stage.monthly.acceptedBlocks).toHaveLength(2);expect(stage.terms.acceptanceId).toBeNull();expect(JSON.stringify(data)).not.toContain('PRIVATE_SYNTHETIC_OWNER_FIT');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await monthly.screenshot({path:info.outputPath(`academy-parent-monthly-${locale}-${info.project.name}.png`)});
}
export async function academyOwnerMonthlyJourney(page:Page,record:Locator,input:{locale:'en'|'he';stageId:string;learnerId:string;ownerLogin:()=>Promise<void>},info:TestInfo){
 guard(page);const {locale,stageId,learnerId}=input,t=(en:string,he:string)=>locale==='he'?he:en;
 await page.goto(`/${locale}/family/settings/account`);const logout=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/identity/logout'&&r.request().method()==='POST');await page.getByRole('button',{name:t('Sign out this device','יציאה מהמכשיר הזה'),exact:true}).click();expect((await logout).status()).toBe(200);await input.ownerLogin();
 const review=record.locator('[data-academy-enrollment-review]'),offer=review.locator('[data-academy-offer]');
 const open=async()=>{await record.locator('[data-academy-family-setup] > summary').click();await review.locator(':scope > summary').click();await review.getByRole('combobox',{name:t('Choose the verified child','בחירת הילד המאומת'),exact:true}).selectOption(learnerId);await review.getByRole('combobox',{name:t('Choose an Academy group','בחירת קבוצת אקדמיה'),exact:true}).selectOption(stageId);await offer.locator(':scope > summary').click();await expect(offer).toContainText(t('Full-stage prepay requires separate acceptance of the full-stage terms.','תשלום מראש לשלב מלא מחייב אישור נפרד של תנאי השלב המלא.'));await expect(offer).not.toContainText(t('The parent must accept the actual approved terms first.','ההורה צריך לאשר תחילה את התנאים המאושרים.'));};await open();
 const fill=async(index:number)=>{await offer.getByRole('combobox',{name:t('Owner-selected payment option','אפשרות תשלום שנבחרה בידי המנהל'),exact:true}).selectOption('monthly_block');await offer.getByRole('combobox',{name:t('Choose this child’s signed four-lesson block','בחירת המקבץ החתום של ארבעה שיעורים לילד זה'),exact:true}).selectOption({index});await offer.locator('input[name="due1"]').fill('2026-11-01');await offer.locator('input[name="expiry"]').fill('2026-12-15');};
 const submit=offer.getByRole('button',{name:t('Prepare this payment offer','הכנת הצעת תשלום זו'),exact:true}),saved=offer.getByRole('region',{name:t('Saved payment offer','הצעת תשלום שמורה'),exact:true});
 await fill(1);await exactRetry(page,'/api/private/group-applications/offer',submit,offer.getByRole('button',{name:t('Retry the same offer request','ניסיון חוזר לאותה בקשת הצעה'),exact:true}));await expect(saved).toContainText('USD 650');await expect(saved.getByRole('listitem')).toHaveCount(1);
 await offer.locator('textarea[name="reason"]').fill('PRIVATE_SYNTHETIC_MONTHLY_WITHDRAWAL');await offer.getByRole('button',{name:t('Withdraw unissued offer and release places','ביטול הצעה שטרם הועברה ושחרור המקומות'),exact:true}).click();await expect(offer.getByRole('region',{name:t('Private offer withdrawal history','היסטוריה פרטית של ביטול הצעות'),exact:true})).toContainText('PRIVATE_SYNTHETIC_MONTHLY_WITHDRAWAL');await fill(2);await submit.click();await expect(saved).toContainText('USD 650');
 await page.reload();await open();await expect(saved).toContainText('USD 650');await expect(saved.getByRole('listitem')).toHaveCount(1);await expect(offer).toContainText('PRIVATE_SYNTHETIC_MONTHLY_WITHDRAWAL');
 const billing=offer.locator('[data-academy-billing]'),read=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/private/group-applications/billing'&&r.request().method()==='GET');await billing.getByRole('button',{name:t('Read current stage payments','קריאת תשלומי השלב העדכניים'),exact:true}).click();const response=await read;expect(response.status()).toBe(200);expect((await response.json()).data).toMatchObject({role:'practitioner',issuance:'not_admitted',payments:[],actions:[]});await expect(billing.getByRole('button',{name:t('Issue this approved offer','יצירת דרישת תשלום להצעה מאושרת זו'),exact:true})).toHaveCount(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await readableOwnerOffer(offer,locale,info);await offer.screenshot({path:info.outputPath(`academy-owner-monthly-${locale}-${info.project.name}.png`)});
}
