/** Actual native SQL/auth/CSRF regression through the retained fixture. */
import {randomUUID} from 'node:crypto';
import {expect,test,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {academyFamilyFixture as fixture} from './academy-family-fixture.ts';
import {unseal} from '../../../src/features/identity/crypto.ts';
import {asId} from '../../../src/lib/ids.ts';
import type {AcademyFamilyCommand} from '../../../src/features/fishing/academy-family-contract.ts';

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

// Versioned named registration never fabricates legacy fit/gear fields.
test('named exact-grade registration binds immutable submitted child IDs to the correct native learners',async()=>{
 const {ACADEMY_REGISTRATION_VERSION,registrationConsent}=await import('../../../src/features/group-application/academy-registration.ts'),{academyRegistrationNotice}=await import('../../../src/features/group-application/academy-registration-notice.ts');
 const f=await fixture(),children=[{id:randomUUID(),fullName:'Synthetic named child A',ageYears:10,grade:'5' as const,schooling:'school' as const,experience:'new' as const},{id:randomUUID(),fullName:'Synthetic named child B',ageYears:13,grade:'8' as const,schooling:'homeschool' as const,experience:'some' as const}];
 const saved=await f.inquiries.submit({operationId:randomUUID(),fields:{parentName:'Synthetic named guardian',contact:'+13055550184',cityArea:'Synthetic Florida',language:'en',programId:'sunday_fishing_academy',schedulePreference:[],permission:{confirmed:true,version:academyRegistrationNotice.version,language:'en'},academyRegistration:{version:ACADEMY_REGISTRATION_VERSION,learners:children,postalCode:'00123',driveMinutes:37,preferredDays:['sunday','tuesday'],preferredTimes:['morning'],schoolHoursAvailability:'permission_needed',preferredGroupLanguage:'he',stageInterest:'foundation',intent:'information',consent:registrationConsent('en')}}});
 await f.promote(saved.item.id);const context=(await (await f.get(saved.item.id)).json()).data;expect(context.registrationChildren).toEqual(children.map(c=>({id:c.id,fullName:c.fullName,grade:c.grade})));
 const base=await f.command(saved.item.id),command={...base,children:children.map((c,learnerIndex)=>({learnerIndex,displayName:c.fullName,registrationChildId:c.id,existingLearnerId:null}))},before=await f.protectedState();
 expect((await f.post({...command,children:[{...command.children[0]!,registrationChildId:children[1]!.id},command.children[1]!]})).status).toBe(409);
 const response=await f.post(command);expect(response.status).toBe(200);const result=(await response.json()).data.saved;expect(result.children.map((c:{registrationChildId:string})=>c.registrationChildId)).toEqual(children.map(c=>c.id));
 for(let i=0;i<children.length;i++){const row=(await f.pool.query('SELECT profile_ciphertext FROM ls_identity.people WHERE workspace_id=$1 AND id=$2',[f.workspaceId,result.children[i].learnerId])).rows[0],profile=JSON.parse(unseal(row.profile_ciphertext,'person:'+f.workspaceId+':'+result.children[i].learnerId,f.ring));expect(profile).toMatchObject({displayName:children[i]!.fullName,registrationChildId:children[i]!.id,grade:children[i]!.grade,ageYears:children[i]!.ageYears});}
 expect((await f.post(command)).status).toBe(200);expect(await f.protectedState()).toEqual(before);
});
