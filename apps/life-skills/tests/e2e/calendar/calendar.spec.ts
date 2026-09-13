/** Mounted, authenticated, real-DB browser tests. NOT RUN in GPT. No network mocking or auth bypass. */
import { test,expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { text } from '../../../src/features/calendar/copy.ts';
type Data={cases:Record<string,{futureId:string;pastId:string;futureDate:string;pastDate:string}>;caseId:string;foreignId:string;parent:string;practitioner:string};
const file=process.env.LS_CALENDAR_FIXTURE_PATH;
if(!file)throw new Error('USE_ISOLATED_CALENDAR_RUNNER');
const data=JSON.parse(readFileSync(file,'utf8')) as Data;
for(const locale of ['he','en'] as const){
 const t=text(locale);
 test(`parent ${locale}: receipt is durable and protected; direction, mobile width, keyboard and private-family isolation`,async({page,context},info)=>{
  const d=data.cases[info.project.name+':'+locale]!;
  await context.addCookies([{name:'__Host-ls-session',value:data.parent,url:'https://127.0.0.1:3445',httpOnly:true,secure:true,sameSite:'Lax'}]);
  const route=`/${locale}/family/schedule?date=${d.futureDate}&view=day&caseId=${data.caseId}`;
  const response=await page.goto(route);expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading',{name:t.familyTitle,exact:true})).toBeVisible();await expect(page.locator('main.ls-cal')).toHaveAttribute('dir',locale==='he'?'rtl':'ltr');
  await expect(page.locator(`[data-appointment-id="${d.futureId}"]:visible`)).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.keyboard.press('Tab');expect(await page.evaluate(()=>document.activeElement?.tagName)).not.toBe('BODY');
  const denied=await page.request.get('/api/calendar/appointments/'+data.foreignId);expect(denied.status()).toBe(404);expect(await denied.text()).not.toContain('Synthetic case B');
  await page.locator(`[data-appointment-id="${d.futureId}"]:visible`).click();const dialog=page.locator('#ls-cal-detail');
  await expect(dialog).toBeVisible();await dialog.locator('#notice-consent').check();await dialog.getByRole('button',{name:t.sendNotice,exact:true}).click();
  await expect(dialog.getByRole('heading',{name:t.received,exact:true})).toBeVisible();await expect(dialog.locator('.lsw-status').filter({hasText:t.protected})).toBeVisible();await expect(dialog.getByText(t.pending,{exact:true})).toBeVisible();
  const receipt=await page.request.get('/api/calendar/appointments/'+d.futureId);expect(receipt.headers()['cache-control']).toContain('no-store');
  const body=await receipt.json();expect(body.data.notice.eligibility).toBe('credit_preserved');expect(body.data.attendance).toBeNull();const receivedAt=body.data.notice.receivedAt;
  await page.reload();await page.locator(`[data-appointment-id="${d.futureId}"]:visible`).click();await expect(page.getByRole('heading',{name:t.received,exact:true})).toBeVisible();
  expect((await (await page.request.get('/api/calendar/appointments/'+d.futureId)).json()).data.notice.receivedAt).toBe(receivedAt);
  await page.screenshot({path:info.outputPath(`parent-${locale}-receipt.png`),fullPage:true});
  expect(await page.evaluate(()=>localStorage.length+sessionStorage.length)).toBe(0);
 });
 test(`practitioner ${locale}: accepted shared route reaches real attendance form, not a preview bypass`,async({page,context},info)=>{
  const d=data.cases[info.project.name+':'+locale]!;
  await context.addCookies([{name:'__Host-ls-session',value:data.practitioner,url:'https://127.0.0.1:3445',httpOnly:true,secure:true,sameSite:'Lax'}]);
  const response=await page.goto(`/${locale}/app/calendar?date=${d.pastDate}&view=day&caseId=${data.caseId}`);
  expect(response?.status(),'IR-LS030-PROXY must be accepted and installed; do not bypass the foundation lock').toBe(200);
  await expect(page.getByRole('heading',{name:t.title,exact:true})).toBeVisible();
  await page.locator(`[data-appointment-id="${d.pastId}"]:visible`).click();const dialog=page.locator('#ls-cal-detail');
  await dialog.locator('#attendance-state').selectOption('no_show');await dialog.getByRole('button',{name:t.recordAttendance,exact:true}).click();
  await expect.poll(async()=>{const r=await page.request.get('/api/calendar/appointments/'+d.pastId);return (await r.json()).data.attendance?.state;}).toBe('no_show');
  const a=(await (await page.request.get('/api/calendar/appointments/'+d.pastId)).json()).data;expect(a.countsAsChildSession).toBe(false);expect(a.creditException).toBeNull();
  await page.screenshot({path:info.outputPath(`practitioner-${locale}-attendance.png`),fullPage:true});
 });
}
test('API denies unauthenticated access and timestamp-forged notices; no secret response or partial receipt',async({page,context})=>{
 const noSession=await page.request.get('/api/calendar/appointments/'+data.foreignId);expect(noSession.status()).toBe(401);
 await context.addCookies([{name:'__Host-ls-session',value:data.parent,url:'https://127.0.0.1:3445',httpOnly:true,secure:true,sameSite:'Lax'}]);
 const malformed=await page.request.get('/api/calendar/appointments/not-a-uuid');expect(malformed.status()).toBe(400);
 const forged=await page.request.post('/api/calendar/appointments/'+data.foreignId+'/notice',{headers:{Origin:'https://127.0.0.1:3445'},data:{kind:'cancel',proposedWindows:[],receivedAt:'2026-01-01T00:00:00Z'}});expect(forged.status()).toBe(400);
});
