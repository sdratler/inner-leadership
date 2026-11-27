// Local rendered integration harness. Next serves the real component; Playwright
// routes only its API transport to real native services in a disposable PGlite.
// This is not a deployed PostgreSQL/provider or physical-device acceptance test.
import { mkdir,writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium,expect } from '@playwright/test';
import { tripDatabase } from '../fixtures/individual-trips-database.ts';
import { IndividualTripsHttp } from '../../src/features/individual-trips/http.ts';
import { IndividualTripRegistrationService } from '../../src/features/individual-trips/registration-service.ts';
import { IndividualTripOwnerActions } from '../../src/features/individual-trips/owner-actions.ts';
import { IdentityAuthService } from '../../src/features/identity/auth-service.ts';
import { IdentitySessions } from '../../src/features/identity/session-adapter.ts';
import { IdentityHttp } from '../../src/features/identity/http.ts';
import { IdentityAccountService } from '../../src/features/identity/account-service.ts';
import { IdentityPreferenceService } from '../../src/features/identity/preferences.ts';
import { PostgresIdentityRateStore } from '../../src/features/identity/rate-store.ts';
import { durableAuditSink } from '../../src/features/identity/history.ts';
import { CaseService } from '../../src/features/cases/service.ts';
import { SESSION_COOKIE } from '../../src/lib/security/session.ts';
import { blindEmail,unseal } from '../../src/features/identity/crypto.ts';
import { processResetRequest } from '../../src/providers/email/dispatch.ts';

const root=new URL('../../../../.private/trips-20261127/browser/',import.meta.url),f=await tripDatabase();
await mkdir(root,{recursive:true});
const services={auth:new IdentityAuthService(f.store,f.config,f.clock),sessions:new IdentitySessions(f.store,f.config,f.clock),accounts:new IdentityAccountService(f.store,f.config,f.clock),preferences:new IdentityPreferenceService(f.store,f.config,f.clock),limits:new PostgresIdentityRateStore(f.store),audit:durableAuditSink(f.store),cases:new CaseService(f.store,f.config,f.clock)};
const identity=new IdentityHttp(f.config,f.clock,services),actions=new IndividualTripOwnerActions(f.trips,null);
const http=new IndividualTripsHttp({config:f.config,trips:f.trips,registration:new IndividualTripRegistrationService(f.store,f.config,f.clock),...services,capabilities:{stripeLookup:false,mailAdmission:false,ownerChat:false},ownerAction:(actor,input)=>actions.execute(actor,input)});
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true}),errors:string[]=[],results:object[]=[];
let failNextReload=false;
async function surface(role:'parent'|'owner'|'anonymous',locale='en',width=390,height=844){
 const context=await browser.newContext({viewport:{width,height},extraHTTPHeaders:{'x-forwarded-proto':'https','x-forwarded-host':'localhost:3107'},reducedMotion:'reduce'}),page=await context.newPage();
 const jar=new Map<string,string>(role==='anonymous'?[]:[[SESSION_COOKIE,f[role].token]]);
 let resetRequestId:string|null=null,resetContext:string|null=null;
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/api/**',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.pathname==='/api/individual-trips'&&request.method()==='GET'&&failNextReload){failNextReload=false;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({ok:false,error:{code:'UNAVAILABLE'}})});return;}
  const headers=new Headers(await request.allHeaders());headers.set('cookie',[...jar].map(([key,value])=>key+'='+value).join('; '));headers.set('origin',f.origin);headers.delete('host');headers.delete('x-forwarded-host');headers.delete('x-forwarded-proto');
  const input=new Request(f.origin+url.pathname,{method:request.method(),headers,...(request.postData()?{body:request.postData()!}:{})});
  const response=await (url.pathname.startsWith('/api/identity')?identity:http).handle(input);
  for(const cookie of response.headers.getSetCookie()){const pair=cookie.split(';')[0]!,separator=pair.indexOf('='),name=pair.slice(0,separator),value=pair.slice(separator+1);if(value)jar.set(name,value);else jar.delete(name);}
  const responseText=await response.text();
  if(url.pathname==='/api/identity/reset/request'&&response.status===202){resetRequestId=JSON.parse(responseText).requestId;resetContext=headers.get('x-ls-auth-context');}
  await route.fulfill({status:response.status,contentType:'application/json',body:responseText});
 });
 await page.goto(role==='owner'?`http://localhost:3107/${locale}/dev/ui/trips?mode=owner`:`http://localhost:3107/${locale}/trips`);
 await page.getByRole('heading',{level:1}).waitFor();
 return{page,context,getReset:()=>({requestId:resetRequestId,context:resetContext})};
}
async function shot(page:Awaited<ReturnType<typeof surface>>['page'],name:string){
 await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:fileURLToPath(new URL(name+'.png',root)),fullPage:true});
 await page.screenshot({path:fileURLToPath(new URL(name+'-viewport.png',root)),fullPage:false});
 if(name.includes('populated')||name.includes('cancellation'))await page.locator('#offers').screenshot({path:fileURLToPath(new URL(name+'-offers.png',root))});
 const geometry=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,broken:[...document.images].filter(i=>!i.complete||i.naturalWidth===0).length}));
 expect(geometry.scroll).toBeLessThanOrEqual(geometry.width+1);expect(geometry.broken).toBe(0);results.push({name,...geometry});
}
try{
 const {page,context}=await surface('parent');
 await page.getByRole('heading',{name:'Create your Fishing household'}).waitFor();
 await page.locator('input[name=guardianName]').fill('Synthetic Parent');await page.locator('input[name=pickupAreas]').fill('Boca Raton');
 await page.locator('input[name=contactConsent]').check();await page.locator('input[name=adultJoin]').check();
 await page.getByRole('button',{name:'Create my free household'}).click();await page.getByRole('heading',{name:'Who is joining us?'}).waitFor();
 await page.getByText('Add a child',{exact:true}).click();await page.locator('input[name=childName]').fill('Synthetic Boy');await page.locator('input[name=age]').fill('10');await page.locator('select[name=mediaUse]').selectOption('no');
 await page.getByRole('button',{name:'Save child',exact:true}).click();await page.locator('article').filter({has:page.getByRole('heading',{name:'Synthetic Boy',exact:true})}).waitFor();
 await page.getByLabel('Sunday date 1').fill('2026-12-06');await page.getByRole('button',{name:'Add another date option'}).click();await page.getByLabel('Sunday date 2').fill('2026-12-13');
 await page.getByRole('button',{name:'Save free date interest'}).click();await expect(page.getByText('2026-12-06 · Local fishing',{exact:false})).toBeVisible();
 let native=await f.trips.read(f.parent.actor);expect(native.households[0]!.availability[0]!.options).toHaveLength(2);expect(native.offers).toHaveLength(0);
 await shot(page,'parent-en-390');await page.reload();await page.getByRole('heading',{name:'Who is joining us?'}).waitFor();await expect(page.getByRole('heading',{name:'Synthetic Boy'})).toBeVisible();
 // A failed post-save read keeps the mounted draft and disables new mutations.
 await page.getByText('Add a child',{exact:true}).click();await page.locator('input[name=childName]').fill('Saved Despite Reload Failure');await page.locator('input[name=age]').fill('11');await page.locator('select[name=mediaUse]').selectOption('no');failNextReload=true;
 await page.getByRole('button',{name:'Save child',exact:true}).click();await expect(page.getByText('The server accepted the save.',{exact:false})).toBeVisible();await expect(page.locator('input[name=childName]')).toHaveValue('Saved Despite Reload Failure');await expect(page.getByRole('button',{name:'Save child',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.getByRole('heading',{name:'Saved Despite Reload Failure',exact:true}).waitFor();
 native=await f.trips.read(f.parent.actor);expect(native.households[0]!.children).toHaveLength(2);await context.close();
 // Exercise owner planning and a populated delivered/accepted/paid offer via UI.
 const ownerFlow=await surface('owner'),op=ownerFlow.page;
 const plan=op.locator('#departure-editor form');await plan.locator('[name=kind]').selectOption('keys');await expect(plan.locator('[name=desired]')).toHaveValue('15');await expect(plan.locator('[name=son]')).toBeChecked();await plan.locator('[name=kind]').selectOption('local');
 for(const [name,value] of Object.entries({title:'Synthetic Boca outing',departureAt:'2026-12-06T10:00',fishingStartAt:'2026-12-06T10:30',fishingEndAt:'2026-12-06T13:30',returnAt:'2026-12-06T14:00',vehicle:'synthetic-van',ownerResource:'synthetic-guide',seats:'15',hubId:'boca',hubLabel:'Synthetic approved Boca pickup'}))await plan.locator(`[name=${name}]`).fill(value);
 for(const name of ['transportVerified','hubPermission','operationalReady'])await plan.locator(`[name=${name}]`).check();
 await plan.getByRole('button',{name:'Save departure plan'}).click();await op.getByRole('heading',{name:'Synthetic Boca outing',exact:true}).waitFor();
 let all=await f.trips.read(f.owner.actor);const departure=all.departures[0]!;
 const offerForm=op.locator('form').filter({has:op.getByRole('button',{name:'Prepare offer and hold places',exact:true})});
 await offerForm.locator('[name=departureId]').selectOption(departure.id);await offerForm.locator('[name=offerChild]').first().check();await offerForm.getByRole('button',{name:'Prepare offer and hold places',exact:true}).click();await expect(op.locator('#offers article')).toHaveCount(1);
 all=await f.trips.read(f.owner.actor);let offer=all.offers[0]!;expect(offer.sentAt).toBeNull();
 f.time.now=new Date(f.clock.now().getTime()+60000);
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(f.clock.now()),part=(name:string)=>parts.find(p=>p.type===name)!.value;
 await op.locator('#offers summary').filter({hasText:'Delivery, invoice & payment actions'}).click();await op.locator('[name=sentAt]').fill(`${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}${part('second')==='00'?'':':'+part('second')}`);await op.locator('[name=reference]').fill('Synthetic manual WhatsApp receipt');await op.getByRole('button',{name:'Record actual manual delivery',exact:true}).click();
 await expect(op.locator('[name=sentAt]')).toHaveCount(0);offer=(await f.trips.read(f.owner.actor)).offers[0]!;expect(Date.parse(offer.paymentDeadline!)-Date.parse(offer.sentAt!)).toBe(48*3600000);
 const parentOffer=await surface('parent');await parentOffer.page.locator('[name=acceptOffer]').check();await parentOffer.page.getByRole('button',{name:'Accept this exact offer',exact:true}).click();await expect(parentOffer.page.locator('[name=acceptOffer]')).toHaveCount(0);
 await op.getByRole('button',{name:'Refresh',exact:true}).click();await op.locator('[name=cashAmount]').fill('160.00');await op.locator('[name=receiptReference]').fill('synthetic-browser-cash');await op.locator('[name=cashReceived]').check();await op.getByRole('button',{name:'Record cash actually received',exact:true}).click();
 await op.getByText('Payment receipts & credit history',{exact:true}).click();await op.getByText('Resolve unallocated payment',{exact:false}).click();await shot(op,'owner-populated-review-en-390');
 await parentOffer.page.getByRole('button',{name:'Refresh',exact:true}).click();await parentOffer.page.getByRole('button',{name:'Request cancellation',exact:true}).click();await expect(parentOffer.page.getByText('Cancellation received',{exact:false})).toBeVisible();await shot(parentOffer.page,'parent-cancellation-pending-en-390');
 await op.getByRole('button',{name:'Refresh',exact:true}).click();const creditForm=op.locator('form').filter({has:op.getByRole('button',{name:'Convert reviewed amount to household credit',exact:true})});await creditForm.locator('[name=amount]').fill('10.00');await creditForm.locator('[name=note]').fill('Synthetic review of actual overpayment');await creditForm.getByRole('button',{name:'Convert reviewed amount to household credit',exact:true}).click();await expect(op.getByText('Resolve unallocated payment',{exact:false})).toHaveCount(0);
 all=await f.trips.read(f.owner.actor);expect(all.creditLedger.reduce((sum,r)=>sum+r.amountMinor,0)).toBe(16000);expect(all.offers[0]!.children[0]!.status).toBe('cancelled');
 await parentOffer.context.close();await ownerFlow.context.close();
 for(const locale of ['en','he'])for(const [width,height] of [[320,568],[390,844],[430,932],[1440,900]]){
  const parent=await surface('parent',locale,width!,height!);await parent.page.locator('#household').waitFor();await shot(parent.page,`parent-${locale}-${width}`);await parent.context.close();
  const owner=await surface('owner',locale,width!,height!);await owner.page.locator('#demand').waitFor();await shot(owner.page,`owner-${locale}-${width}`);await owner.context.close();
 }
 const anonymous=await surface('anonymous');await anonymous.page.getByRole('heading',{name:'Create your free parent account'}).waitFor();await shot(anonymous.page,'signup-en-390');
 await anonymous.page.locator('[name=displayName]').fill('New Synthetic Parent');await anonymous.page.locator('[name=email]').fill('new-synthetic-parent@example.invalid');await anonymous.page.locator('[name=adult]').check();await anonymous.page.getByRole('button',{name:'Request free account activation',exact:true}).click();await expect(anonymous.page.getByText('Request accepted.',{exact:false})).toBeVisible();
 const account=(await f.db.query<{id:string}>('SELECT id FROM ls_identity.accounts WHERE workspace_id=$1 AND email_blind=$2',[f.workspace,blindEmail('new-synthetic-parent@example.invalid',f.config.lookupKey)])).rows[0]!;
 const mail=(await f.db.query<{id:string;payload_ciphertext:string}>("SELECT id,payload_ciphertext FROM ls_identity.auth_mail_outbox WHERE workspace_id=$1 AND account_id=$2 AND kind='invite'",[f.workspace,account.id])).rows[0]!,activation=JSON.parse(unseal(mail.payload_ciphertext,`auth-mail:${f.workspace}:${mail.id}`,f.config.keyring));
 await anonymous.page.goto('http://localhost:3107/en/login?mode=invite&next=%2Fen%2Ftrips#token='+activation.token);await anonymous.page.getByRole('heading',{name:'Activate your account',exact:true}).waitFor();
 await anonymous.page.locator('[name=password]').fill('synthetic new password');await anonymous.page.locator('[name=confirmation]').fill('synthetic new password');await anonymous.page.locator('button[type=submit]').click();await anonymous.page.getByRole('heading',{name:'Sign in to Fishing Academy',exact:true}).waitFor();
 await anonymous.page.locator('[name=email]').fill('new-synthetic-parent@example.invalid');await anonymous.page.locator('[name=password]').fill('synthetic new password');await anonymous.page.locator('button[type=submit]').click();await expect(anonymous.page).toHaveURL('http://localhost:3107/en/trips');await anonymous.page.getByRole('heading',{name:'Create your Fishing household',exact:true}).waitFor();await shot(anonymous.page,'activated-parent-entry-en-390');
 await anonymous.page.locator('[name=guardianName]').fill('New Synthetic Parent');await anonymous.page.locator('[name=contactConsent]').check();await anonymous.page.locator('[name=adultJoin]').check();await anonymous.page.getByRole('button',{name:'Create my free household',exact:true}).click();await anonymous.page.getByRole('heading',{name:'Who is joining us?',exact:true}).waitFor();await expect(anonymous.page.getByRole('heading',{name:'Synthetic Boy',exact:true})).toHaveCount(0);
 expect((await f.db.query<{count:number}>('SELECT count(*)::int AS count FROM ls_cases.case_guardians WHERE account_id=$1',[account.id])).rows[0]!.count).toBe(0);
 await anonymous.page.evaluate(async()=>{const session=await(await fetch('/api/identity/session')).json();await fetch('/api/identity/logout',{method:'POST',headers:{'content-type':'application/json','x-csrf-token':session.data.csrfToken},body:'{}'});});
 await anonymous.page.goto('http://localhost:3107/en/login?next=%2Fen%2Ftrips');await anonymous.page.getByRole('button',{name:'Forgot password?',exact:true}).click();await anonymous.page.locator('[name=email]').fill('new-synthetic-parent@example.invalid');await anonymous.page.getByRole('button',{name:'Send reset email',exact:true}).click();await expect(anonymous.page.getByText('reset email is queued',{exact:false})).toBeVisible();
 const reset=anonymous.getReset();expect(reset.context).toBe('fishing-trips');expect(reset.requestId).toBeTruthy();const resetOutbox=await processResetRequest(f.store,f.config,f.clock,reset.requestId!);expect(resetOutbox).toBeTruthy();
 const resetMail=(await f.db.query<{payload_ciphertext:string}>('SELECT payload_ciphertext FROM ls_identity.auth_mail_outbox WHERE id=$1',[resetOutbox])).rows[0]!,resetPayload=JSON.parse(unseal(resetMail.payload_ciphertext,`auth-mail:${f.workspace}:${resetOutbox}`,f.config.keyring));
 await anonymous.page.goto('http://localhost:3107/en/login?mode=reset&next=%2Fen%2Ftrips#token='+resetPayload.token);await anonymous.page.getByRole('heading',{name:'Choose a new password',exact:true}).waitFor();await anonymous.page.locator('[name=password]').fill('synthetic reset password');await anonymous.page.locator('[name=confirmation]').fill('synthetic reset password');await anonymous.page.locator('button[type=submit]').click();await anonymous.page.getByRole('heading',{name:'Sign in to Fishing Academy',exact:true}).waitFor();await anonymous.page.locator('[name=email]').fill('new-synthetic-parent@example.invalid');await anonymous.page.locator('[name=password]').fill('synthetic reset password');await anonymous.page.locator('button[type=submit]').click();await expect(anonymous.page).toHaveURL('http://localhost:3107/en/trips');await anonymous.page.getByRole('heading',{name:'Who is joining us?',exact:true}).waitFor();await shot(anonymous.page,'reset-parent-entry-en-390');
 await anonymous.context.close();
 const enlarged=await surface('parent','he',375,667);await enlarged.page.locator('#household').waitFor();await enlarged.page.evaluate(()=>{const sizes=[...document.querySelectorAll<HTMLElement>('main *')].map(el=>[el,parseFloat(getComputedStyle(el).fontSize)] as const);for(const [el,size] of sizes)el.style.fontSize=size*2+'px';});await shot(enlarged.page,'parent-he-375-css-text200');await enlarged.page.keyboard.press('Tab');expect(await enlarged.page.evaluate(()=>document.activeElement?.tagName)).not.toBe('BODY');await enlarged.context.close();
 expect(errors).toEqual([]);await writeFile(new URL('report.json',root),JSON.stringify({scope:'Next component + native disposable PGlite APIs; no live provider or physical-phone claim',results,errors,passed:true},null,2));
 console.log(JSON.stringify({passed:true,screenshots:results.length,directory:root.pathname,scope:'native disposable SQL + rendered component'}));
}finally{await browser.close();await f.db.close();}
