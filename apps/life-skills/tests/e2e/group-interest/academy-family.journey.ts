/** Existing isolated harness only. Tokens below are synthetic queued-mail test
 * delivery; no sender, production URL, injected actor or successful API mock. */
import {createHash} from 'node:crypto';
import {expect,type Page,type Locator,type TestInfo} from '@playwright/test';
import pg from 'pg';
import {unseal,type Keyring} from '../../../src/features/identity/crypto.ts';
const mutable=new Map<string,number>([['ls_identity.accounts',2],['ls_identity.account_subjects',2],['ls_identity.people',4],['ls_cases.families',2],['ls_cases.family_members',4],['ls_education.guardian_authorities',2],['ls_identity.auth_mail_outbox',2],['ls_fishing_stage.command_receipts',2]]);
const protectedTables=['ls_cases.cases','ls_cases.case_guardians','ls_education.account_grants','ls_calendar.appointments','ls_calendar.tasks','ls_calendar.task_history','ls_contact_ops.outbound_projections','ls_onboarding.first_session_orders','ls_payments.charges','ls_payments.credit_events','ls_fishing_stage.enrollments','ls_fishing_payments.purchases','ls_fishing_payments.outbox'];
type Snapshot={table:string;rows:{row:Record<string,unknown>}[]}[];
export async function academyFamilyBrowserSnapshot(pool:pg.Pool,workspaceId:string):Promise<Snapshot>{return Promise.all([...mutable.keys(),...protectedTables].map(async table=>({table,rows:(await pool.query(`SELECT to_jsonb(t) AS row FROM ${table} t WHERE workspace_id=$1 ORDER BY to_jsonb(t)::text`,[workspaceId])).rows})));}
export async function verifyAcademyFamilyBrowser(pool:pg.Pool,workspaceId:string,before:Snapshot){
 const after=await academyFamilyBrowserSnapshot(pool,workspaceId);
 for(const prior of before){const current=after.find(v=>v.table===prior.table)!;expect(current.rows.length-prior.rows.length,prior.table).toBe(mutable.get(prior.table)??0);for(const row of prior.rows)expect(current.rows,prior.table+' original row').toContainEqual(row);}
 const receipts=(await pool.query("SELECT count(*)::int AS count FROM ls_fishing_stage.command_receipts WHERE workspace_id=$1 AND action='academy.family.setup'",[workspaceId])).rows[0];expect(receipts.count).toBe(2);
 const accounts=(await pool.query("SELECT count(*)::int AS count FROM ls_identity.accounts a WHERE workspace_id=$1 AND role='parent' AND state='active' AND EXISTS(SELECT 1 FROM ls_identity.auth_mail_outbox m WHERE m.workspace_id=a.workspace_id AND m.account_id=a.id AND m.kind='invite')",[workspaceId])).rows[0];expect(accounts.count).toBe(2);
}
export async function academyFamilyOwnerJourney(page:Page,record:Locator,input:{origin:string;workspaceId:string;locale:'en'|'he';applicationId:string},info:TestInfo){
 info.setTimeout(120000);
 const {origin,locale,applicationId,workspaceId}=input,t=(en:string,he:string)=>locale==='he'?he:en;
 if(process.env.LS_ACADEMY_FAMILY_UI_ONLY!=='true'||!/^https:\/\/localhost:310[56]$/.test(origin)||new URL(page.url()).origin!==origin)throw Error('EXCLUSIVE_SYNTHETIC_FAMILY_BROWSER_REQUIRED');
 const box=record.locator('[data-academy-family-setup]');await box.locator('summary').click();
 await expect(box.getByLabel(t('Parent sign-in email','דוא״ל כניסה של ההורה'),{exact:true})).toBeVisible();
 const parentEmail=`synthetic-composed-family-${locale}@example.invalid`,childName=`Synthetic verified child ${locale}`;
 await box.getByLabel(t('Parent sign-in email','דוא״ל כניסה של ההורה'),{exact:true}).fill(parentEmail);
 await box.getByLabel(t('Verified child name','שם הילד המאומת'),{exact:true}).fill(childName);
 await box.getByLabel(t('Private guardian verification reference','אסמכתה פרטית לאימות האפוטרופוס'),{exact:true}).fill('SYNTHETIC_PRIVATE_GUARDIAN_VERIFICATION');
 await box.getByRole('checkbox').check();let lost=false;const requests:string[]=[],responses:unknown[]=[];
 const endpoint='**/api/private/group-applications/family';
 await page.route(endpoint,async route=>{if(route.request().method()!=='POST')return route.continue();requests.push(route.request().postData()!);const upstream=await route.fetch();expect(upstream.status()).toBe(200);responses.push(await upstream.json());if(!lost){lost=true;await route.abort('failed');}else await route.fulfill({response:upstream});});
 await box.getByRole('button',{name:t('Prepare family access','הכנת גישה למשפחה'),exact:true}).click();await expect(box.getByRole('alert')).toBeVisible();
 await expect(box.getByLabel(t('Parent sign-in email','דוא״ל כניסה של ההורה'),{exact:true})).toBeDisabled();
 await box.getByRole('button',{name:t('Retry the same family setup','ניסיון חוזר לאותה הכנת משפחה'),exact:true}).click();
 await expect(box.getByRole('heading',{name:t('Family access prepared','הגישה למשפחה הוכנה'),exact:true})).toBeVisible();expect(requests.length).toBe(2);expect(createHash('sha256').update(requests[0]!).digest('hex')).toBe(createHash('sha256').update(requests[1]!).digest('hex'));
 expect(JSON.stringify(responses)).not.toMatch(/SYNTHETIC_PRIVATE_GUARDIAN_VERIFICATION|token|synthetic-composed-family/);await page.unroute(endpoint);
 const response=await page.request.get('/api/private/group-applications/family?applicationId='+applicationId);expect(response.status()).toBe(200);const saved=(await response.json()).data.saved;expect(saved.parentState).toBe('invited');expect(saved.invitation).toBe('queued');expect(saved.children).toHaveLength(1);expect(saved.children[0].displayName).toBe(childName);expect(saved.enrollmentCreated).toBe(false);
 await page.reload();await box.locator('summary').click();await expect(box).toContainText(childName);await expect(box).toContainText(t('queued invitation is not delivered email','הזמנה בתור אינה הודעת דוא״ל שנמסרה'));
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await record.screenshot({path:info.outputPath(`academy-family-saved-${locale}-${info.project.name}.png`)});
 // Deliberate owner logout. Read only this fresh fixture's encrypted invitation
 // as a test mail delivery, then use the normal browser activation and login.
 await page.goto(`/${locale}/app/settings/account`);const logout=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/identity/logout'&&r.request().method()==='POST');await page.getByRole('button',{name:t('Sign out this device','יציאה מהמכשיר הזה'),exact:true}).click();expect((await logout).status()).toBe(200);
 const url=new URL(process.env.TEST_DATABASE_URL??'');if(url.hostname!=='127.0.0.1'||!/^\/ls_calendar_test_rm_guard_[a-f0-9]{32}_test$/.test(url.pathname))throw Error('EXACT_DISPOSABLE_FAMILY_DATABASE_REQUIRED');
 const keyring:Keyring={activeKeyId:process.env.LS_IDENTITY_ACTIVE_KEY_ID!,keys:Object.fromEntries(Object.entries(JSON.parse(process.env.LS_IDENTITY_DATA_KEYS!) as Record<string,string>).map(([k,v])=>[k,Buffer.from(v,'base64url')]))},pool=new pg.Pool({connectionString:url.toString(),max:1});let invite:string;
 try{const rows=(await pool.query("SELECT id,payload_ciphertext FROM ls_identity.auth_mail_outbox WHERE workspace_id=$1 AND account_id=$2 AND kind='invite'",[workspaceId,saved.parentAccountId])).rows;expect(rows).toHaveLength(1);const row=rows[0];invite=JSON.parse(unseal(row.payload_ciphertext,`auth-mail:${workspaceId}:${row.id}`,keyring)).token;}finally{await pool.end();}
 await page.goto(`/${locale}/login?mode=invite#token=${encodeURIComponent(invite)}`);await page.locator('[name="password"]').fill('Synthetic12');await page.locator('[name="confirmation"]').fill('Synthetic12');const accepted=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/identity/invites/accept'&&r.request().method()==='POST');await expect(page.locator('form button[type="submit"]')).toBeEnabled();await page.locator('form button[type="submit"]').click();expect((await accepted).status()).toBe(200);
 await page.goto(`/${locale}/login?next=${encodeURIComponent(`/${locale}/family/schedule?fishing=1`)}`);await page.locator('[name="email"]').fill(parentEmail);await page.locator('[name="password"]').fill('Synthetic12');const login=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/identity/login'&&r.request().method()==='POST');await page.getByRole('button',{name:t('Sign in','כניסה'),exact:true}).click();expect((await login).status()).toBe(200);await expect(page).toHaveURL(`/${locale}/family/schedule?fishing=1`);
 const choices=await page.request.get('/api/calendar/fishing/context');expect(choices.status()).toBe(200);const context=(await choices.json()).data;expect(context.children).toEqual([{learnerId:saved.children[0].learnerId,displayName:childName}]);expect(context.stages).toEqual([]);expect((await page.request.get('/api/private/group-applications/family?applicationId='+applicationId)).status()).toBe(403);expect((await page.request.get('/api/private/group-applications')).status()).toBe(403);
 await page.reload();expect((await page.request.get('/api/calendar/fishing/context')).status()).toBe(200);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.screenshot({path:info.outputPath(`academy-family-parent-${locale}-${info.project.name}.png`)});
}
