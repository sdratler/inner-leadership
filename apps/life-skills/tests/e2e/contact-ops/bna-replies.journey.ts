import {readFileSync} from 'node:fs';
import {expect,test,type Page} from '@playwright/test';
import type {BnaRepliesBrowserRuntime} from './bna-replies-fixture.ts';
const file=process.env.LS_GROUP_INTEREST_FIXTURE_PATH;if(process.env.LS_BNA_REPLIES_UI_ONLY!=='true'||!file)throw Error('BNA_REPLIES_ISOLATED_BROWSER_REQUIRED');
const r=JSON.parse(readFileSync(file,'utf8')) as {origin:string;bnaReplies:BnaRepliesBrowserRuntime};
if(!/^https:\/\/localhost:310[5678]$/.test(r.origin)||!r.bnaReplies)throw Error('BNA_REPLIES_LOOPBACK_REQUIRED');
test.use({baseURL:r.origin});
async function login(page:Page,locale:'en'|'he',role='practitioner'){
 const c=r.bnaReplies.credentials.find(c=>c.role===role)!;await page.goto(`/${locale}/login?next=${encodeURIComponent(`/${locale}/app/clients`)}`);
 await page.getByLabel(locale==='he'?'דוא״ל':'Email',{exact:true}).fill(c.email);await page.getByLabel(locale==='he'?'סיסמה':'Password',{exact:true}).fill(c.password);
 const response=page.waitForResponse(x=>new URL(x.url()).pathname==='/api/identity/login'&&x.request().method()==='POST');await page.getByRole('button',{name:locale==='he'?'כניסה':'Sign in',exact:true}).click();expect((await response).status()).toBe(200);
 if(role==='practitioner')await expect(page.getByRole('heading',{name:locale==='he'?'אנשים':'People',exact:true})).toBeVisible();
}
for(const locale of ['en','he'] as const)test(`${locale}: closed inquiry, reply pagination, committed-response loss, same retry and another session`,async({page,browser,request},info)=>{
 const t=(en:string,he:string)=>locale==='he'?he:en,inquiry=r.bnaReplies.inquiries.find(i=>i.locale===locale)!;
 expect((await request.get(r.origin+'/api/private/bna-mailbox-replies?id='+inquiry.id)).status()).toBe(401);
 await login(page,locale);await expect(page.getByRole('combobox',{name:t('View','תצוגה'),exact:true})).toHaveValue('followup');
 await page.getByRole('button',{name:new RegExp(inquiry.name+' ·')}).click();
 const record=page.getByRole('region',{name:t('Selected record','הרשומה שנבחרה'),exact:true});await expect(record.getByRole('combobox',{name:t('Stage','שלב'),exact:true})).toHaveValue('closed');
 const panel=record.locator('details').filter({has:page.locator('summary').filter({hasText:t('Received email replies','תשובות שהתקבלו בדוא״ל')})});
 await panel.locator('summary').focus();await page.keyboard.press('Enter');await panel.getByRole('button',{name:t('Refresh received replies','רענון תשובות שהתקבלו'),exact:true}).click();
 await expect(panel).toContainText(t('Automatic inbox monitoring is not connected yet.','ניטור אוטומטי של תיבת הדואר עדיין אינו מחובר.'));
 await expect(panel.locator('li')).toHaveCount(Math.min(50,inquiry.count));
 if(inquiry.count>50){await panel.getByRole('button',{name:t('Load older replies','טעינת תשובות קודמות'),exact:true}).click();await expect(panel.locator('li')).toHaveCount(51);}
 let lost=false;const bodies:string[]=[];await page.route('**/api/private/bna-mailbox-replies',async route=>{
  if(route.request().method()!=='POST'){await route.continue();return;}bodies.push(route.request().postData()!);
  if(!lost){lost=true;const response=await route.fetch();expect(response.status()).toBe(200);await route.abort('failed');}else await route.continue();
 });
 await panel.getByRole('button',{name:t('Mark reviewed','סימון כטופלה'),exact:true}).first().click();
 await expect(panel.getByRole('button',{name:t('Retry same review','ניסיון חוזר לאותו טיפול'),exact:true})).toBeVisible();
 await expect(record.getByRole('button',{name:t('Save follow-up','שמירת המשך טיפול'),exact:true})).toBeDisabled();
 await expect(page.getByRole('combobox',{name:t('View','תצוגה'),exact:true})).toBeDisabled();
 await panel.getByRole('button',{name:t('Retry same review','ניסיון חוזר לאותו טיפול'),exact:true}).click();await expect(panel.locator('li').filter({hasNot:page.getByRole('button',{name:t('Mark reviewed','סימון כטופלה'),exact:true})})).toHaveCount(1);
 expect(bodies).toHaveLength(2);expect(bodies[1]).toBe(bodies[0]);await expect(record.getByRole('combobox',{name:t('Stage','שלב'),exact:true})).toHaveValue('closed');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await panel.screenshot({path:info.outputPath('bna-replies-'+locale+'-'+info.project.name+'.png')});
 const fresh=await browser.newContext({baseURL:r.origin,ignoreHTTPSErrors:true,...(info.project.use.viewport===undefined?{}:{viewport:info.project.use.viewport})});
 try{const again=await fresh.newPage();await login(again,locale);await again.getByRole('combobox',{name:t('View','תצוגה'),exact:true}).selectOption('all');await again.getByRole('button',{name:new RegExp(inquiry.name+' ·')}).click();
  const saved=await again.request.get('/api/private/bna-mailbox-replies?id='+inquiry.id);expect(saved.status()).toBe(200);const data=(await saved.json()).data;
  expect(data.items.filter((i:{state:string})=>i.state==='reviewed')).toHaveLength(1);expect(data.monitor.state).toBe('unconnected');
  await expect(again.getByRole('region',{name:t('Selected record','הרשומה שנבחרה'),exact:true}).getByRole('combobox',{name:t('Stage','שלב'),exact:true})).toHaveValue('closed');
 }finally{await fresh.close();}
 if(locale==='en'){const parent=await browser.newContext({baseURL:r.origin,ignoreHTTPSErrors:true});try{const other=await parent.newPage();await login(other,'en','parent');expect((await other.request.get('/api/private/bna-mailbox-replies?id='+inquiry.id)).status()).toBe(403);}finally{await parent.close();}}
});
