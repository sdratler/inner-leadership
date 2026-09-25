/** Mounted, authenticated, real-DB browser tests. NOT RUN in GPT. No network mocking or auth bypass. */
import { test,expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { text } from '../../../src/features/calendar/copy.ts';
type Data={origin:string;cases:Record<string,{futureId:string;pastId:string;futureDate:string;pastDate:string}>;caseId:string;foreignId:string;parent:string;practitioner:string};
const file=process.env.LS_CALENDAR_FIXTURE_PATH;
if(!file){
 if(process.env.LS_CALENDAR_TEST_RUNNER_ACTIVE==='true')throw new Error('ISOLATED_CALENDAR_FIXTURE_REQUIRED');
 // The foundation discovery includes this file. Run, rather than skip, the five
 // authenticated journeys for its exact desktop/mobile project in a separate TLS fixture.
 test('isolated calendar authenticated journeys for the current browser project',async({},info)=>{
  test.setTimeout(180_000);
  if(!['desktop','mobile'].includes(info.project.name))throw new Error('CALENDAR_BROWSER_PROJECT_NOT_SUPPORTED');
  const result=await promisify(execFile)(process.execPath,['--import','tsx','tests/e2e/calendar/run.ts'],{
   timeout:150_000,maxBuffer:2*1024*1024,
   env:{...process.env,LS_CALENDAR_TEST_PROJECT:info.project.name,LS_PRIVATE_APP_ENABLED:'true',LS_CALENDAR_TEST_SHARED_ROUTES_ACCEPTED:'true'},
  });
  expect(result.stdout).toContain('LS-030 isolated browser suite completed.');
  console.log(result.stdout);
 });
}else{
const data=JSON.parse(readFileSync(file,'utf8')) as Data;
if(!['https://127.0.0.1:3445','https://127.0.0.1:3446'].includes(data.origin))throw new Error('CALENDAR_BROWSER_ORIGIN_NOT_ISOLATED');
const selectedProject=process.env.LS_CALENDAR_TEST_PROJECT;
if(selectedProject!==undefined&&(!['desktop','mobile'].includes(selectedProject)||data.origin!==`https://127.0.0.1:${selectedProject==='mobile'?3446:3445}`))throw new Error('CALENDAR_BROWSER_PROJECT_ORIGIN_MISMATCH');
test.use({baseURL:data.origin});
for(const locale of ['he','en'] as const){
 const t=text(locale);
 test(`parent ${locale}: receipt is durable and protected; direction, mobile width, keyboard and private-family isolation`,async({page,context},info)=>{
  const d=data.cases[info.project.name+':'+locale]!;
  await context.addCookies([{name:'__Host-ls-session',value:data.parent,url:data.origin,httpOnly:true,secure:true,sameSite:'Lax'}]);
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
  await context.addCookies([{name:'__Host-ls-session',value:data.practitioner,url:data.origin,httpOnly:true,secure:true,sameSite:'Lax'}]);
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
test('an empty calendar keeps its grid on mobile, while populated dates keep the readable agenda',async({page,context},info)=>{
 await context.addCookies([{name:'__Host-ls-session',value:data.practitioner,url:data.origin,httpOnly:true,secure:true,sameSite:'Lax'}]);
 const empty=await page.goto('/en/app/calendar?date=2040-01-02&view=week');expect(empty?.status()).toBe(200);
 await expect(page.locator('main.ls-cal')).toHaveAttribute('data-has-appointments','false');
 await expect(page.locator('[data-ls-calendar-grid]')).toBeVisible();
 const d=data.cases[info.project.name+':en']!;
 const populated=await page.goto(`/en/app/calendar?date=${d.pastDate}&view=day&caseId=${data.caseId}`);expect(populated?.status()).toBe(200);
 await expect(page.locator('main.ls-cal')).toHaveAttribute('data-has-appointments','true');
 if(info.project.name==='mobile'){
  await expect(page.locator('.lsw-calendar-agenda')).toBeVisible();
  await expect(page.locator('.lsw-calendar-grid')).toBeHidden();
 }else await expect(page.locator('[data-ls-calendar-grid]')).toBeVisible();
});
test('API denies unauthenticated access and timestamp-forged notices; no secret response or partial receipt',async({page,context})=>{
 const noSession=await page.request.get('/api/calendar/appointments/'+data.foreignId);expect(noSession.status()).toBe(401);
 await context.addCookies([{name:'__Host-ls-session',value:data.parent,url:data.origin,httpOnly:true,secure:true,sameSite:'Lax'}]);
 const malformed=await page.request.get('/api/calendar/appointments/not-a-uuid');expect(malformed.status()).toBe(400);
 const forged=await page.request.post('/api/calendar/appointments/'+data.foreignId+'/notice',{headers:{Origin:data.origin},data:{kind:'cancel',proposedWindows:[],receivedAt:'2026-01-01T00:00:00Z'}});expect(forged.status()).toBe(400);
});
}
