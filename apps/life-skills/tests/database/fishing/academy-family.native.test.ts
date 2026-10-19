/** Actual retained SQL/auth/CSRF setup; disposable synthetic identities only.
 * Reading the isolated encrypted invitation here is test delivery, NOT mail or
 * production-token access. No provider transport or merchant action runs. */
import {randomUUID} from 'node:crypto';
import {afterEach,expect,test,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {programFixture,type ProgramFixture} from './native-program-fixture.ts';
import {ContactCutoverStore,type CutoverEvidence} from '../../../src/features/contact-ops/server/cutover-store.ts';
import {FishingLeadStore} from '../../../src/features/contact-ops/server/fishing-lead-store.ts';
import {PublicGroupApplicationStore} from '../../../src/features/group-application/store.ts';
import {floridaGroupApplicationNotice} from '../../../src/features/group-application/contract.ts';
import {ACADEMY_INTAKE_VERSION} from '../../../src/features/group-application/academy-intake.ts';
import {AcademyFamilyStore} from '../../../src/features/fishing/academy-family-store.ts';
import {academyFamilyHttp} from '../../../src/features/fishing/academy-family-http.ts';
import {academyFamilyVersion,type AcademyFamilyCommand} from '../../../src/features/fishing/academy-family-contract.ts';
import {IdentityAuthService} from '../../../src/features/identity/auth-service.ts';
import {IdentitySessions} from '../../../src/features/identity/session-adapter.ts';
import {PostgresIdentityRateStore} from '../../../src/features/identity/rate-store.ts';
import {durableAuditSink} from '../../../src/features/identity/history.ts';
import {systemClock} from '../../../src/features/identity/types.ts';
import {SESSION_COOKIE} from '../../../src/lib/security/session.ts';
import {unseal} from '../../../src/features/identity/crypto.ts';
import {asId} from '../../../src/lib/ids.ts';
const fixtures:ProgramFixture[]=[];afterEach(async()=>{await Promise.all(fixtures.splice(0).map(f=>f.close()));});
const proof=(epoch:number):CutoverEvidence=>({batchId:'SYNTHETIC_FAMILY_SETUP',sourceFileId:'synthetic-sheet',sourceRevision:'synthetic-only',expectedEpoch:epoch,observedNativeWritesSinceSwitch:0,backupRestored:true,snapshotMatched:true,imported:true,rowContentMatched:true,allRowsAccounted:true,identityConflicts:0,paymentsReconciled:true,writersFenced:true,inboundDurable:true,deltaDrained:true,consumersRepointed:true,sheetConsumersRepointed:true,nativeBrowserVerified:true,oldSchedulesDisabled:true,sourceFrozen:true,restorePlanReady:true}); // Fixture only; no real cutover evidence.
async function fixture(){
 const f=await programFixture();fixtures.push(f);const key=f.config.lookupKey.toString('hex'),cutover=new ContactCutoverStore(f.db,f.ring,key),leads=new FishingLeadStore(f.db,f.ring,key,'sunday_fishing_academy'),inquiries=new PublicGroupApplicationStore(f.db,f.workspaceId,f.ring,key);
 for(const [i,action]of ['prepare','freeze','switch_native'].entries())await cutover.advance(f.owner,{action:action as 'prepare'|'freeze'|'switch_native',operationId:action,proof:proof(i)});
 const store=new AcademyFamilyStore(f.db,f.config,inquiries,leads),auth=new IdentityAuthService(f.db,f.config,systemClock),sessions=new IdentitySessions(f.db,f.config,systemClock),runtime={config:f.config,sessions,limits:new PostgresIdentityRateStore(f.db),audit:durableAuditSink(f.db),clock:systemClock};
 const passwordLogin=async(email:string)=>{const pre=await auth.preauth();return (await auth.login(email,'Ab12cd',pre.token,randomUUID())).token;};
 const token=await passwordLogin(f.owner.id+'@example.invalid'),owner=await sessions.actor(token),csrf=sessions.csrf(token),origin=f.config.origin,endpoint='/api/private/group-applications/family';
 const get=(applicationId:string,session=token)=>academyFamilyHttp(new Request(origin+endpoint+'?applicationId='+applicationId,{headers:{cookie:SESSION_COOKIE+'='+session}}),async()=>({runtime,store}));
 const post=(body:AcademyFamilyCommand,headers:Record<string,string>={},session=token)=>academyFamilyHttp(new Request(origin+endpoint,{method:'POST',headers:{cookie:SESSION_COOKIE+'='+session,origin,'sec-fetch-site':'same-origin','content-type':'application/json','x-csrf-token':csrf,'idempotency-key':body.operationId,...headers},body:JSON.stringify(body)}),async()=>({runtime,store}));
 const inquiry=async(label='Synthetic owner setup')=>(await inquiries.submit({operationId:randomUUID(),fields:{parentName:label,contact:'+13055550182',language:'en',cityArea:'Synthetic Florida',programId:'sunday_fishing_academy',scheduleContext:'program_format_interest',schedulePreference:['sunday'],academyFit:{version:'RM-FIT-20261014-04-v1',learners:[{approximateAge:12,gear:'needs_advice',experience:'new'}],maximumDriveMinutes:30,parentDropoff:'yes'},academyIntake:{version:ACADEMY_INTAKE_VERSION,postalCode:'33004',driveLimit:30,preferredGroupLanguage:'en',stagePreference:'foundation',keysTravel:'parent_drive',offshoreInterest:'not_interested',nextStep:'enrollment_followup',learners:[{ageYears:12,gradeBand:'grade_6_8',schooling:'school',tackleBox:'need_advice'}]},permission:{confirmed:true,version:floridaGroupApplicationNotice.version,language:'en'}}})).item.id;
 const promote=async(applicationId:string)=>{const preview=await leads.preview(owner,{action:'preview_add',operationId:randomUUID(),expectedEpoch:3,expectedAssociationVersion:0,source:{kind:'inquiry',id:applicationId},relationship:'guardian'});if(preview.state!=='ready')throw Error('READY_NATIVE_LEAD_REQUIRED');return leads.confirm(owner,{action:'confirm',token:preview.token,confirmNewPerson:preview.newPerson});};
 const command=async(applicationId:string):Promise<AcademyFamilyCommand>=>{const response=await get(applicationId);expect(response.status).toBe(200);const c=(await response.json()).data;expect(c.state).toBe('ready');return {version:academyFamilyVersion,applicationId,operationId:randomUUID(),personId:c.personId,expectedEpoch:c.expectedEpoch,expectedAssociationVersion:c.expectedAssociationVersion,expectedFieldsDigest:c.fieldsDigest,parentEmail:'synthetic-parent@example.invalid',locale:'en',householdId:null,guardianVerified:true,verificationReference:'PRIVATE_GUARDIAN_EVIDENCE',children:[{learnerIndex:0,displayName:'Synthetic Academy child',existingLearnerId:null}]};};
 const protectedState=async()=>Promise.all(['ls_cases.cases','ls_cases.case_guardians','ls_education.account_grants','ls_calendar.appointments','ls_calendar.tasks','ls_fishing_stage.enrollments','ls_fishing_payments.purchases','ls_payments.charges','ls_payments.credit_events','ls_contact_ops.outbound_projections'].map(async table=>({table,rows:(await f.pool.query(`SELECT to_jsonb(t) AS row FROM ${table} t WHERE workspace_id=$1 ORDER BY to_jsonb(t)::text`,[f.workspaceId])).rows})));
 return {...f,auth,sessions,token,owner,leads,inquiries,store,get,post,inquiry,promote,command,passwordLogin,protectedState};
}
test('saved inquiry and deliberate guardian lead become one family only after owner verification; exact lost-response retries create one invitation and no case/payment/task',async()=>{
 const f=await fixture(),id=await f.inquiry(),before=await f.protectedState();expect((await (await f.get(id)).json()).data).toEqual({state:'not_ready',reason:'native_lead_required'});
 await f.promote(id);const command=await f.command(id);expect((await f.post({...command,guardianVerified:false} as unknown as AcademyFamilyCommand)).status).toBe(400);
 const responses=await Promise.all(Array.from({length:4},()=>f.post(command)));expect(responses.map(r=>r.status)).toEqual([200,200,200,200]);const bodies=await Promise.all(responses.map(r=>r.json())),saved=bodies[0].data.saved;expect(bodies.filter(b=>!b.data.replayed)).toHaveLength(1);expect(new Set(bodies.map(b=>b.data.saved.children[0].learnerId)).size).toBe(1);
 expect(saved).toMatchObject({personId:command.personId,parentState:'invited',invitation:'queued',enrollmentCreated:false});expect(JSON.stringify(bodies)).not.toMatch(/PRIVATE_GUARDIAN_EVIDENCE|token|synthetic-parent@example.invalid/);
 const count=await f.pool.query("SELECT (SELECT count(*)::integer FROM ls_identity.auth_mail_outbox WHERE workspace_id=$1 AND kind='invite') AS invites,(SELECT count(*)::integer FROM ls_identity.accounts WHERE workspace_id=$1 AND role='parent') AS parents,(SELECT count(*)::integer FROM ls_fishing_stage.command_receipts WHERE workspace_id=$1 AND action='academy.family.setup') AS receipts",[f.workspaceId]);expect(count.rows[0]).toEqual({invites:1,parents:1,receipts:1});expect(await f.protectedState()).toEqual(before);
 const reread=await f.get(id);expect((await reread.json()).data.saved.children).toEqual(saved.children);expect((await f.post({...command,operationId:randomUUID()})).status).toBe(409);expect((await f.post({...command,parentEmail:'different@example.invalid'})).status).toBe(409);
 const row=(await f.pool.query("SELECT id,payload_ciphertext FROM ls_identity.auth_mail_outbox WHERE workspace_id=$1 AND account_id=$2 AND kind='invite'",[f.workspaceId,saved.parentAccountId])).rows[0];const payload=JSON.parse(unseal(row.payload_ciphertext,`auth-mail:${f.workspaceId}:${row.id}`,f.ring));
 await f.auth.consumePasswordToken('invite',payload.token,'Ab12cd',randomUUID());const parentToken=await f.passwordLogin(command.parentEmail),parent=await f.sessions.actor(parentToken),context=await f.program.calendarChoices(parent);expect(context.children).toEqual([{learnerId:saved.children[0].learnerId,displayName:'Synthetic Academy child'}]);expect(context.stages).toEqual([]);
 expect((await f.get(id,parentToken)).status).toBe(403);expect((await f.get(id)).status).toBe(200);expect((await (await f.get(id)).json()).data.saved.parentState).toBe('active');expect(await f.protectedState()).toEqual(before);
});
test('owner transport, stale source, native lead removal and revoked guardian deny before setup or replay and preserve prior family history',async()=>{
 const f=await fixture(),id=await f.inquiry();await f.promote(id);const command=await f.command(id),before=await f.protectedState();
 expect((await f.post(command,{origin:'https://untrusted.invalid'})).status).toBe(403);expect((await f.post(command,{'x-csrf-token':'wrong'})).status).toBe(403);expect((await f.post(command,{'idempotency-key':randomUUID()})).status).toBe(400);expect((await f.post({...command,expectedFieldsDigest:'0'.repeat(64)})).status).toBe(409);
 const response=await f.post(command);expect(response.status).toBe(200);const saved=(await response.json()).data.saved;
 await f.pool.query('UPDATE ls_education.guardian_authorities SET active=false WHERE workspace_id=$1 AND learner_id=$2',[f.workspaceId,saved.children[0].learnerId]);expect((await f.post(command)).status).toBe(409);
 const preview=await f.leads.preview(f.owner,{action:'preview_remove',operationId:randomUUID(),expectedEpoch:3,personId:command.personId,expectedAssociationVersion:1});if(preview.state!=='ready')throw Error('PREVIEW_REQUIRED');await f.leads.confirm(f.owner,{action:'confirm',token:preview.token,confirmNewPerson:false});expect((await f.post(command)).status).toBe(409);
 expect((await f.pool.query('SELECT id FROM ls_identity.people WHERE workspace_id=$1 AND id=$2',[f.workspaceId,saved.children[0].learnerId])).rows).toHaveLength(1);expect(await f.protectedState()).toEqual(before);
 await f.auth.logout(f.owner,randomUUID());expect((await f.get(id)).status).toBe(401);expect((await f.post(command)).status).toBe(401);
});
test('another inquiry can deliberately reuse its existing household and verified child without a duplicate account, child or invitation',async()=>{
 const f=await fixture(),id=await f.inquiry();await f.promote(id);const original=await f.command(id),result=(await (await f.post(original)).json()).data.saved;
 const next=await f.inquiry('Synthetic follow-up inquiry'),command=await f.command(next);command.householdId=result.householdId;command.children=[{learnerIndex:0,displayName:result.children[0].displayName,existingLearnerId:result.children[0].learnerId}];
 const count=async()=>(await f.pool.query("SELECT (SELECT count(*)::integer FROM ls_identity.people WHERE workspace_id=$1) AS people,(SELECT count(*)::integer FROM ls_identity.accounts WHERE workspace_id=$1) AS accounts,(SELECT count(*)::integer FROM ls_identity.auth_mail_outbox WHERE workspace_id=$1 AND kind='invite') AS invites",[f.workspaceId])).rows[0],before=await count();
 expect((await f.post({...command,householdId:randomUUID()})).status).toBe(409);expect((await f.post({...command,children:[{...command.children[0]!,existingLearnerId:randomUUID()}]})).status).toBe(409);
 const response=await f.post(command);expect(response.status).toBe(200);const saved=(await response.json()).data.saved;expect(saved.parentAccountId).toBe(result.parentAccountId);expect(saved.children).toEqual(result.children);expect(saved.invitation).toBe('existing_account');expect(await count()).toEqual(before);
});
test('an occupied address or non-parent subject cannot be converted into Academy parent access',async()=>{
 const f=await fixture(),id=await f.inquiry();await f.promote(id);const command=await f.command(id),other=await f.account('parent');
 const counts=async()=>(await f.pool.query("SELECT (SELECT count(*)::integer FROM ls_identity.people WHERE workspace_id=$1) AS people,(SELECT count(*)::integer FROM ls_cases.families WHERE workspace_id=$1) AS families,(SELECT count(*)::integer FROM ls_identity.auth_mail_outbox WHERE workspace_id=$1) AS mail",[f.workspaceId])).rows[0],before=await counts();
 expect((await f.post({...command,parentEmail:other.id+'@example.invalid'})).status).toBe(409);expect(await counts()).toEqual(before);
 const client=await f.account('adult_client',asId(command.personId,'person')),next=await counts();expect((await f.post({...command,parentEmail:client.id+'@example.invalid'})).status).toBe(409);expect(await counts()).toEqual(next);expect((await f.pool.query('SELECT role FROM ls_identity.accounts WHERE workspace_id=$1 AND id=$2',[f.workspaceId,client.id])).rows[0].role).toBe('adult_client');
});
