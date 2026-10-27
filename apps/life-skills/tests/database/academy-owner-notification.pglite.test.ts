import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {afterAll,beforeAll,expect,it,vi} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
vi.mock('server-only',()=>({}));
import {AcademyFounderStore} from '../../src/features/group-application/academy-founder-store.ts';
import {AcademyOwnerNotificationOutbox,ACADEMY_OWNER_NOTIFICATION_PURPOSE,ACADEMY_OWNER_NOTIFICATION_TO} from '../../src/features/group-application/academy-owner-notification.ts';
import {PublicGroupApplicationStore} from '../../src/features/group-application/store.ts';
import {ACADEMY_REGISTRATION_VERSION,registrationConsent} from '../../src/features/group-application/academy-registration.ts';
import {academyRegistrationNotice} from '../../src/features/group-application/academy-registration-notice.ts';
import {registrationAcknowledgments} from '../../src/features/group-application/academy-registration-acknowledgments.ts';
import {communicationPreferenceSelection} from '../../src/features/group-application/academy-communication-preferences.ts';
import {floridaAcademyRegistrationFieldsSchema} from '../../src/features/group-application/contract.ts';
import {INQUIRY_EMAIL_FROM} from '../../src/features/group-application/inquiry-email-copy.ts';
import {opaqueToken} from '../../src/features/identity/crypto.ts';
import type {Actor} from '../../src/features/identity/types.ts';
import type {IdentityStore,SqlSession} from '../../src/features/identity/store.ts';
import {asId} from '../../src/lib/ids.ts';

const db=new PGlite(),workspace=asId(randomUUID(),'workspace'),now=new Date('2026-10-27T20:30:00.000Z'),clock={now:()=>now};
const ring={activeKeyId:'owner',keys:{owner:Buffer.alloc(32,4)}},key='owner-notification-private-digest';
const store:IdentityStore={transaction:fn=>db.transaction(tx=>fn({query:async<T extends object>(sql:string,values:readonly unknown[]=[])=> (await tx.query<T>(sql,[...values])).rows} as SqlSession))};
const founder=new AcademyFounderStore(store,workspace,ring,key,clock,null,null,null,true),applications=new PublicGroupApplicationStore(store,workspace,ring,key,clock,false,founder),outbox=new AcademyOwnerNotificationOutbox(store,workspace,ring,clock);
function command(){const learners=[{id:randomUUID(),fullName:'Synthetic learner',ageYears:10,grade:'5',schooling:'school',experience:'new'}],email=`owner-notify-${randomUUID()}@example.invalid`;return {operationId:randomUUID(),fields:floridaAcademyRegistrationFieldsSchema.parse({parentName:'Synthetic owner notification parent',contact:email,language:'en',cityArea:'Hollywood',programId:'sunday_fishing_academy',schedulePreference:[],academyRegistration:{version:ACADEMY_REGISTRATION_VERSION,learners,postalCode:'33020',preferredDays:['sunday'],preferredTimes:['morning'],driveMinutes:37,schoolHoursAvailability:'outside_school_only',preferredGroupLanguage:'either',stageInterest:'foundation',receiptEmail:email,intent:'information',communicationPreferences:communicationPreferenceSelection('he',false,'en'),acknowledgments:registrationAcknowledgments('en',learners.map(child=>child.id)),consent:registrationConsent('en')},permission:{confirmed:true,version:academyRegistrationNotice.version,language:'en'}})};}
async function ownerRow(reference:string){return (await db.query<{id:string;state:string;payload_ciphertext:string;provider_id:string|null;founder_id:string|null}>('SELECT id,state,payload_ciphertext,provider_id,founder_id FROM ls_service_interest.inquiry_email_outbox WHERE workspace_id=$1 AND application_id=$2 AND purpose=$3',[workspace,reference,ACADEMY_OWNER_NOTIFICATION_PURPOSE])).rows[0];}
async function ownerActor(){const id=randomUUID(),digest=id.replaceAll('-','').padEnd(64,'0');await db.query("INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,'adult','synthetic',$3)",[id,workspace,now]);await db.query("INSERT INTO ls_identity.accounts(id,workspace_id,role,state,locale,email_blind,email_ciphertext,email_verified_at,password_hash,created_at,updated_at) VALUES($1,$2,'practitioner','active','en',$3,'synthetic',$4,'synthetic',$4,$4)",[id,workspace,digest,now]);await db.query('INSERT INTO ls_identity.account_subjects(workspace_id,account_id,person_id) VALUES($1,$2,$2)',[workspace,id]);await db.query('INSERT INTO ls_identity.sessions(token_digest,workspace_id,account_id,created_at,expires_at) VALUES($1,$2,$3,$4,$5)',[digest,workspace,id,now,new Date('2035-01-01')]);return {id,workspaceId:workspace,personId:id,role:'practitioner',state:'active',locale:'en',sessionDigest:digest,expiresAt:new Date('2035-01-01').getTime()} as Actor;}

beforeAll(async()=>{await db.exec('CREATE SCHEMA ls_control');for(const name of ['0001_ls_foundation.sql','0010_ls_identity_cases_20260906.sql','0124_ls_group_interest.sql','0131_ls_public_group_applications.sql','0135_ls_inquiry_email_outbox.sql','0136_ls_academy_founder.sql','0137_ls_academy_owner_notifications.sql'])await db.exec(await readFile('migrations/'+name,'utf8'));await db.query('INSERT INTO ls_identity.workspaces(id,created_at) VALUES($1,$2)',[workspace,now]);},25000);
afterAll(async()=>db.close());

it('queues one encrypted owner notification in the same saved-registration transaction',async()=>{
 const input=command(),saved=await applications.submit(input,opaqueToken()),row=await ownerRow(saved.item.id);expect(row).toMatchObject({state:'queued',founder_id:null});expect(row?.payload_ciphertext).not.toContain(input.fields.parentName);expect(row?.payload_ciphertext).not.toContain(input.fields.academyRegistration.receiptEmail);
 expect((await applications.submit(input,opaqueToken())).item.id).toBe(saved.item.id);expect((await db.query('SELECT count(*)::int AS n FROM ls_service_interest.inquiry_email_outbox WHERE workspace_id=$1 AND application_id=$2 AND purpose=$3',[workspace,saved.item.id,ACADEMY_OWNER_NOTIFICATION_PURPOSE])).rows).toEqual([{n:1}]);
});

it('keeps owner rows outside founder confirmation cancellation and ordinary founder dispatch',async()=>{
 const saved=await applications.submit(command(),opaqueToken()),actor=await ownerActor(),family=(await founder.ownerList(actor)).families.find(item=>item.reference===saved.item.id)!;
 await founder.execute(actor,{action:'withdraw',operationId:randomUUID(),familyId:family.id,expectedRevision:family.revision,reason:'Synthetic owner-notification cancellation isolation'});expect((await ownerRow(saved.item.id))?.state).toBe('queued');
 const send=vi.fn(async()=>({providerId:'synthetic_founder_dispatch'}));await expect(founder.dispatchForApplication(saved.item.id,{send},INQUIRY_EMAIL_FROM,'https://life-skills.bneineviimacademy.org')).resolves.toBeUndefined();expect(send).not.toHaveBeenCalled();expect((await ownerRow(saved.item.id))?.state).toBe('queued');
});

it('sends only to the pinned owner address and never duplicates a settled or unknown provider attempt',async()=>{
 const input=command(),saved=await applications.submit(input,opaqueToken()),row=(await ownerRow(saved.item.id))!,send=vi.fn(async(message:{to:string;subject:string;text:string;idempotencyKey:string})=>{expect((await ownerRow(saved.item.id))?.state).toBe('unknown');expect(message.to).toBe(ACADEMY_OWNER_NOTIFICATION_TO);expect(message.subject).toBe('New Fishing Academy registration');expect(message.text).toContain(input.fields.parentName);expect(message.text).toContain(input.fields.academyRegistration.receiptEmail);expect(message.text).toContain(saved.item.id);expect(message.text).not.toContain('Synthetic learner');expect(message.idempotencyKey).toBe(`ls-auth-${row.id}`);return {providerId:'synthetic_owner_notice'};});
 expect(await outbox.dispatchForApplication(saved.item.id,{send},INQUIRY_EMAIL_FROM,ACADEMY_OWNER_NOTIFICATION_TO,'https://life-skills.bneineviimacademy.org')).toBe('sent');expect(await outbox.dispatchForApplication(saved.item.id,{send},INQUIRY_EMAIL_FROM,ACADEMY_OWNER_NOTIFICATION_TO,'https://life-skills.bneineviimacademy.org')).toBe('sent');expect(send).toHaveBeenCalledTimes(1);expect(await ownerRow(saved.item.id)).toMatchObject({state:'sent',provider_id:'synthetic_owner_notice'});
 const uncertain=await applications.submit(command(),opaqueToken()),unknownSend=vi.fn(async()=>{throw Error('ambiguous provider outcome');});expect(await outbox.dispatchForApplication(uncertain.item.id,{send:unknownSend},INQUIRY_EMAIL_FROM,ACADEMY_OWNER_NOTIFICATION_TO,'https://life-skills.bneineviimacademy.org')).toBe('unknown');expect(await outbox.dispatchForApplication(uncertain.item.id,{send:unknownSend},INQUIRY_EMAIL_FROM,ACADEMY_OWNER_NOTIFICATION_TO,'https://life-skills.bneineviimacademy.org')).toBe('unknown');expect(unknownSend).toHaveBeenCalledTimes(1);
});

it('rejects any unapproved owner destination before a provider call',async()=>{
 const saved=await applications.submit(command(),opaqueToken()),row=(await ownerRow(saved.item.id))!,send=vi.fn();await expect(outbox.dispatchOne(row.id,{send},INQUIRY_EMAIL_FROM,'other@example.invalid','https://life-skills.bneineviimacademy.org')).rejects.toMatchObject({code:'INVALID_REQUEST'});expect(send).not.toHaveBeenCalled();expect((await ownerRow(saved.item.id))?.state).toBe('queued');
});
