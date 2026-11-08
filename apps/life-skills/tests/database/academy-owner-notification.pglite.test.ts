import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {afterAll,beforeAll,expect,it,vi} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {requirePgliteMemoryEnvironment} from '../fixtures/pglite-memory-environment.ts';
import {currentTrip390Fields} from '../fixtures/trip390-current.ts';
vi.mock('server-only',()=>({}));
import {AcademyFounderStore} from '../../src/features/group-application/academy-founder-store.ts';
import {AcademyOwnerNotificationOutbox,queueAcademyOwnerNotification,ACADEMY_OWNER_NOTIFICATION_PURPOSE,ACADEMY_OWNER_NOTIFICATION_TO} from '../../src/features/group-application/academy-owner-notification.ts';
import {PublicGroupApplicationStore} from '../../src/features/group-application/store.ts';
import {ACADEMY_REGISTRATION_VERSION,registrationConsent} from '../../src/features/group-application/academy-registration.ts';
import {academyRegistrationNotice} from '../../src/features/group-application/academy-registration-notice.ts';
import {registrationAcknowledgments} from '../../src/features/group-application/academy-registration-acknowledgments.ts';
import {communicationPreferenceSelection} from '../../src/features/group-application/academy-communication-preferences.ts';
import {floridaAcademyRegistrationFieldsSchema} from '../../src/features/group-application/contract.ts';
import {INQUIRY_EMAIL_FROM,INQUIRY_EMAIL_PURPOSE} from '../../src/features/group-application/inquiry-email-copy.ts';
import {trip390V1InterestSchema,TRIP390_V1_INTEREST_VERSION,TRIP390_V1_NOTICE_VERSION,TRIP390_V1_OFFER} from '../../src/features/group-application/academy-trip390-v1.ts';
import {trip390V3InterestSchema,TRIP390_V3_INTEREST_VERSION,TRIP390_V3_OFFER,TRIP390_DRIVING_VERSION as V3_DRIVING_VERSION} from '../../src/features/group-application/academy-trip390-v3.ts';
import {opaqueToken,seal,unseal} from '../../src/features/identity/crypto.ts';
import type {Trip390Command} from '../../src/features/group-application/academy-trip390-contract.ts';
import type {Actor} from '../../src/features/identity/types.ts';
import type {IdentityStore,SqlSession} from '../../src/features/identity/store.ts';
import {asId} from '../../src/lib/ids.ts';

const db=new PGlite(),workspace=asId(randomUUID(),'workspace'),now=new Date('2026-10-27T20:30:00.000Z'),clock={now:()=>now};
const ring={activeKeyId:'owner',keys:{owner:Buffer.alloc(32,4)}},key='owner-notification-private-digest';
let failOwnerInsert=false,ownerInsertFaultReached=false;
const store:IdentityStore={transaction:fn=>db.transaction(tx=>fn({query:async<T extends object>(sql:string,values:readonly unknown[]=[])=>{
 // Inject a real SQL error at the owner INSERT; all other queries use the actual driver.
 if(failOwnerInsert&&values[3]===ACADEMY_OWNER_NOTIFICATION_PURPOSE&&/INSERT INTO ls_service_interest\.inquiry_email_outbox/.test(sql)){
  ownerInsertFaultReached=true;await tx.query('SELECT 1/0');
 }
 return (await tx.query<T>(sql,[...values])).rows;
}} as SqlSession))};
const founder=new AcademyFounderStore(store,workspace,ring,key,clock,null,null,null,true),applications=new PublicGroupApplicationStore(store,workspace,ring,key,clock,false,founder),outbox=new AcademyOwnerNotificationOutbox(store,workspace,ring,clock);
function command(){const learners=[{id:randomUUID(),fullName:'Synthetic learner',ageYears:10,grade:'5',schooling:'school',experience:'new'}],email=`owner-notify-${randomUUID()}@example.invalid`;return {operationId:randomUUID(),fields:floridaAcademyRegistrationFieldsSchema.parse({parentName:'Synthetic owner notification parent',contact:email,language:'en',cityArea:'Hollywood',programId:'sunday_fishing_academy',schedulePreference:[],academyRegistration:{version:ACADEMY_REGISTRATION_VERSION,learners,postalCode:'33020',preferredDays:['sunday'],preferredTimes:['morning'],driveMinutes:37,schoolHoursAvailability:'outside_school_only',preferredGroupLanguage:'either',stageInterest:'foundation',receiptEmail:email,intent:'information',communicationPreferences:communicationPreferenceSelection('he',false,'en'),acknowledgments:registrationAcknowledgments('en',learners.map(child=>child.id)),consent:registrationConsent('en')},permission:{confirmed:true,version:academyRegistrationNotice.version,language:'en'}})};}
async function ownerRow(reference:string){return (await db.query<{id:string;state:string;payload_ciphertext:string;provider_id:string|null;founder_id:string|null}>('SELECT id,state,payload_ciphertext,provider_id,founder_id FROM ls_service_interest.inquiry_email_outbox WHERE workspace_id=$1 AND application_id=$2 AND purpose=$3',[workspace,reference,ACADEMY_OWNER_NOTIFICATION_PURPOSE])).rows[0];}
async function ownerActor(){const id=randomUUID(),digest=id.replaceAll('-','').padEnd(64,'0');await db.query("INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,'adult','synthetic',$3)",[id,workspace,now]);await db.query("INSERT INTO ls_identity.accounts(id,workspace_id,role,state,locale,email_blind,email_ciphertext,email_verified_at,password_hash,created_at,updated_at) VALUES($1,$2,'practitioner','active','en',$3,'synthetic',$4,'synthetic',$4,$4)",[id,workspace,digest,now]);await db.query('INSERT INTO ls_identity.account_subjects(workspace_id,account_id,person_id) VALUES($1,$2,$2)',[workspace,id]);await db.query('INSERT INTO ls_identity.sessions(token_digest,workspace_id,account_id,created_at,expires_at) VALUES($1,$2,$3,$4,$5)',[digest,workspace,id,now,new Date('2035-01-01')]);return {id,workspaceId:workspace,personId:id,role:'practitioner',state:'active',locale:'en',sessionDigest:digest,expiresAt:new Date('2035-01-01').getTime()} as Actor;}

beforeAll(async()=>{requirePgliteMemoryEnvironment(process.env);vi.stubGlobal('fetch',vi.fn(async()=>{throw Error('REAL_NETWORK_NOT_ADMITTED');}));await db.exec('CREATE SCHEMA ls_control');for(const name of ['0001_ls_foundation.sql','0010_ls_identity_cases_20260906.sql','0124_ls_group_interest.sql','0131_ls_public_group_applications.sql','0135_ls_inquiry_email_outbox.sql','0136_ls_academy_founder.sql','0137_ls_academy_owner_notifications.sql'])await db.exec(await readFile('migrations/'+name,'utf8'));await db.query('INSERT INTO ls_identity.workspaces(id,created_at) VALUES($1,$2)',[workspace,now]);},25000);
afterAll(async()=>{try{await db.close();}finally{vi.unstubAllGlobals();}});

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

// Current R2 uses the actual Root-owned store seam. No production mail or admission is established here.
const r2Now=new Date('2026-11-08T20:00:00.000Z'),r2Clock={now:()=>r2Now};
const r2Store=(ownerEnabled=true,ackEnabled=true)=>new PublicGroupApplicationStore(store,workspace,ring,key,r2Clock,ackEnabled,undefined,'sunday_fishing_academy',ownerEnabled);
const r2Outbox=new AcademyOwnerNotificationOutbox(store,workspace,ring,r2Clock);
function r2Command(language:'en'|'he'='he',children=2):Trip390Command{
 const base=currentTrip390Fields();
 return {operationId:randomUUID(),fields:{...base,guardianName:'Synthetic R2 notification parent',email:`r2-owner-${randomUUID()}@example.invalid`,messageLanguage:language,instructionLanguage:'en',
  children:Array.from({length:children},(_,i)=>({...base.children[0]!,id:randomUUID(),name:`Synthetic R2 private child ${i+1}`}))}};
}
async function noticeRows(reference:string){return (await db.query<{id:string;purpose:string;state:string;payload_ciphertext:string;provider_id:string|null}>(
 'SELECT id,purpose,state,payload_ciphertext,provider_id FROM ls_service_interest.inquiry_email_outbox WHERE workspace_id=$1 AND application_id=$2 ORDER BY purpose',[workspace,reference])).rows;}
async function leadCipher(reference:string){return (await db.query<{payload_ciphertext:string}>('SELECT payload_ciphertext FROM ls_service_interest.public_applications WHERE workspace_id=$1 AND id=$2',[workspace,reference])).rows[0]!.payload_ciphertext;}
async function counts(){return (await db.query<{applications:number;operations:number;intents:number}>(`SELECT
 (SELECT count(*)::int FROM ls_service_interest.public_applications WHERE workspace_id=$1) AS applications,
 (SELECT count(*)::int FROM ls_service_interest.public_application_operations WHERE workspace_id=$1) AS operations,
 (SELECT count(*)::int FROM ls_service_interest.inquiry_email_outbox WHERE workspace_id=$1) AS intents`,[workspace])).rows[0]!;}

it('R2 saves both encrypted intents once, using selected parent language, and preserves original and new-key replay',async()=>{
 const input=r2Command(),saved=await r2Store().submit(input),reference=saved.item.id;
 expect(saved).toMatchObject({saved:true,replayed:false,duplicate:false,acknowledgment:'queued'});
 expect(input.fields.acknowledgment.language).toBe('en');expect(input.fields.messageLanguage).toBe('he');
 const rows=await noticeRows(reference),owner=(await ownerRow(reference))!,ack=rows.find(row=>row.purpose===INQUIRY_EMAIL_PURPOSE)!;
 expect(rows).toHaveLength(2);expect(rows.map(row=>row.state)).toEqual(['queued','queued']);expect(owner.founder_id).toBeNull();
 expect(JSON.parse(unseal(owner.payload_ciphertext,`ls_service_interest/academy_owner_notification/v1/${workspace}/${owner.id}`,ring))).toEqual({
  purpose:ACADEMY_OWNER_NOTIFICATION_PURPOSE,reference,parentName:input.fields.guardianName,receiptEmail:input.fields.email,parentLanguage:'he',childCount:2,submittedAt:r2Now.toISOString()});
 expect(JSON.parse(unseal(ack.payload_ciphertext,`ls_service_interest/inquiry_email/v1/${workspace}/${ack.id}`,ring))).toMatchObject({locale:'he',childIds:input.fields.children.map(child=>child.id)});
 expect(owner.payload_ciphertext).not.toContain(input.fields.guardianName);expect(owner.payload_ciphertext).not.toContain(input.fields.email);
 const originalLead=await leadCipher(reference);
 expect(await r2Store().submit(input)).toMatchObject({replayed:true,duplicate:true,item:{id:reference}});
 expect(await r2Store().submit({...input,operationId:randomUUID()})).toMatchObject({replayed:false,duplicate:true,item:{id:reference}});
 await expect(r2Store().submit({...input,fields:{...input.fields,guardianName:'Different synthetic parent'}})).rejects.toMatchObject({code:'CONFLICT'});
 expect(await noticeRows(reference)).toEqual(rows);expect(await leadCipher(reference)).toBe(originalLead);
});

it.each([
 {name:'owner disabled',owner:false,ack:true,purposes:[INQUIRY_EMAIL_PURPOSE]},
 {name:'ACK disabled',owner:true,ack:false,purposes:[ACADEMY_OWNER_NOTIFICATION_PURPOSE]},
 {name:'both disabled',owner:false,ack:false,purposes:[]},
])('R2 keeps queue flags independent: $name, without replay backfill',async({owner,ack,purposes})=>{
 const input=r2Command(),saved=await r2Store(owner,ack).submit(input),rows=await noticeRows(saved.item.id);
 expect(rows.map(row=>row.purpose).sort()).toEqual([...purposes].sort());
 expect(await r2Store(true,true).submit(input)).toMatchObject({replayed:true,item:{id:saved.item.id}});
 expect(await r2Store(true,true).submit({...input,operationId:randomUUID()})).toMatchObject({duplicate:true,item:{id:saved.item.id}});
 expect(await noticeRows(saved.item.id)).toEqual(rows);
});

it.each(['en','he'] as const)('R2 %s owner dispatch reserves UNKNOWN first, omits child names and preserves ACK and SENT bytes',async(language)=>{
 const input=r2Command(language,language==='en'?1:2),saved=await r2Store().submit(input),row=(await ownerRow(saved.item.id))!,beforeRows=await noticeRows(saved.item.id),beforeLead=await leadCipher(saved.item.id);
 const send=vi.fn(async(message:{to:string;subject:string;text:string;idempotencyKey:string})=>{
  expect((await ownerRow(saved.item.id))?.state).toBe('unknown');expect(message.to).toBe(ACADEMY_OWNER_NOTIFICATION_TO);
  expect(message.subject).toBe('New Fishing Academy registration');expect(message.text).toContain(input.fields.guardianName);
  expect(message.text).toContain(input.fields.email);expect(message.text).toContain(`Parent message language: ${language}`);
  expect(message.text).toContain(`Children on this submission: ${input.fields.children.length}`);expect(message.text).toContain(saved.item.id);
  for(const child of input.fields.children)expect(message.text).not.toContain(child.name);
  expect(message.idempotencyKey).toBe(`ls-auth-${row.id}`);return {providerId:`synthetic_r2_owner_${language}`};
 });
 await expect(r2Outbox.dispatchOne(row.id,{send},INQUIRY_EMAIL_FROM,'other@example.invalid','https://life-skills.bneineviimacademy.org')).rejects.toMatchObject({code:'INVALID_REQUEST'});
 expect(send).not.toHaveBeenCalled();expect((await ownerRow(saved.item.id))?.state).toBe('queued');
 expect(await r2Outbox.dispatchForApplication(saved.item.id,{send},INQUIRY_EMAIL_FROM,ACADEMY_OWNER_NOTIFICATION_TO,'https://life-skills.bneineviimacademy.org')).toBe('sent');
 const sent=await ownerRow(saved.item.id);expect(sent).toMatchObject({state:'sent',payload_ciphertext:row.payload_ciphertext,provider_id:`synthetic_r2_owner_${language}`});
 expect(await r2Outbox.dispatchForApplication(saved.item.id,{send},INQUIRY_EMAIL_FROM,ACADEMY_OWNER_NOTIFICATION_TO,'https://life-skills.bneineviimacademy.org')).toBe('sent');
 expect(await ownerRow(saved.item.id)).toEqual(sent);expect(send).toHaveBeenCalledTimes(1);
 expect((await noticeRows(saved.item.id)).filter(r=>r.purpose===INQUIRY_EMAIL_PURPOSE)).toEqual(beforeRows.filter(r=>r.purpose===INQUIRY_EMAIL_PURPOSE));
 expect(await leadCipher(saved.item.id)).toBe(beforeLead);expect(fetch).not.toHaveBeenCalled();
});

it.each(['throw','invalid_receipt'] as const)('R2 %s owner outcome stays UNKNOWN without losing lead/ACK or resending',async(kind)=>{
 const input=r2Command(),saved=await r2Store().submit(input),row=(await ownerRow(saved.item.id))!,beforeLead=await leadCipher(saved.item.id),beforeAck=(await noticeRows(saved.item.id)).filter(r=>r.purpose===INQUIRY_EMAIL_PURPOSE);
 const send=vi.fn(async()=>{expect((await ownerRow(saved.item.id))?.state).toBe('unknown');if(kind==='throw')throw Error('SYNTHETIC_AMBIGUOUS_OWNER_OUTCOME');return {providerId:'invalid provider receipt'};});
 expect(await r2Outbox.dispatchForApplication(saved.item.id,{send},INQUIRY_EMAIL_FROM,ACADEMY_OWNER_NOTIFICATION_TO,'https://life-skills.bneineviimacademy.org')).toBe('unknown');
 const uncertain=await ownerRow(saved.item.id);expect(uncertain).toMatchObject({state:'unknown',provider_id:null,payload_ciphertext:row.payload_ciphertext});
 expect(await r2Outbox.dispatchForApplication(saved.item.id,{send},INQUIRY_EMAIL_FROM,ACADEMY_OWNER_NOTIFICATION_TO,'https://life-skills.bneineviimacademy.org')).toBe('unknown');
 expect(send).toHaveBeenCalledTimes(1);expect(await ownerRow(saved.item.id)).toEqual(uncertain);
 expect(await r2Store().replaySaved(input)).toMatchObject({item:{id:saved.item.id},acknowledgment:'queued'});
 expect(await leadCipher(saved.item.id)).toBe(beforeLead);expect((await noticeRows(saved.item.id)).filter(r=>r.purpose===INQUIRY_EMAIL_PURPOSE)).toEqual(beforeAck);
 expect(fetch).not.toHaveBeenCalled();
});

it('R2 owner INSERT SQL failure rolls back the actual saved lead, operation and ACK together, then retries once',async()=>{
 const input=r2Command(),before=await counts();ownerInsertFaultReached=false;failOwnerInsert=true;
 try{await expect(r2Store().submit(input)).rejects.toMatchObject({code:'22012'});}finally{failOwnerInsert=false;}
 expect(ownerInsertFaultReached).toBe(true);expect(await counts()).toEqual(before);
 expect((await db.query('SELECT application_id FROM ls_service_interest.public_application_operations WHERE workspace_id=$1 AND operation_id=$2',[workspace,input.operationId])).rows).toEqual([]);
 const saved=await r2Store().submit(input);expect(saved).toMatchObject({replayed:false,duplicate:false,acknowledgment:'queued'});
 expect(await noticeRows(saved.item.id)).toHaveLength(2);expect(await r2Store().submit(input)).toMatchObject({replayed:true,item:{id:saved.item.id}});
 expect(await noticeRows(saved.item.id)).toHaveLength(2);
});

it.each(['v1','v3'] as const)('R2 adapter never creates an owner notice for valid historical Trip %s',async(version)=>{
 const current=currentTrip390Fields(),{lessonDayDriving:oldDriving,acknowledgment:oldAck,...oldBase}=current;
 const historical=version==='v1'?trip390V1InterestSchema.parse({...oldBase,version:TRIP390_V1_INTEREST_VERSION,offerVersion:TRIP390_V1_OFFER.version,
  acknowledgment:{version:TRIP390_V1_NOTICE_VERSION,language:oldAck.language,conductExplained:true,interestPrivacySafety:true,whatsapp:false}}):
  trip390V3InterestSchema.parse({...current,version:TRIP390_V3_INTEREST_VERSION,offerVersion:TRIP390_V3_OFFER.version,lessonDayDriving:{...oldDriving,version:V3_DRIVING_VERSION}});
 const reference=randomUUID(),before=await counts();
 expect(await store.transaction(tx=>queueAcademyOwnerNotification(tx,workspace,reference,historical,ring,r2Now))).toBe('not_requested');
 expect(await ownerRow(reference)).toBeUndefined();expect(await counts()).toEqual(before);
});

it('R2 owner payload mismatch is denied before reservation or I/O and leaves the lead and ACK intact',async()=>{
 const input=r2Command(),saved=await r2Store().submit(input),row=(await ownerRow(saved.item.id))!,beforeLead=await leadCipher(saved.item.id),beforeAck=(await noticeRows(saved.item.id)).filter(r=>r.purpose===INQUIRY_EMAIL_PURPOSE);
 const aad=`ls_service_interest/academy_owner_notification/v1/${workspace}/${row.id}`,payload=JSON.parse(unseal(row.payload_ciphertext,aad,ring));
 await db.query('UPDATE ls_service_interest.inquiry_email_outbox SET payload_ciphertext=$3 WHERE workspace_id=$1 AND id=$2',[workspace,row.id,seal(JSON.stringify({...payload,childCount:1}),aad,ring)]);
 const send=vi.fn();await expect(r2Outbox.dispatchOne(row.id,{send},INQUIRY_EMAIL_FROM,ACADEMY_OWNER_NOTIFICATION_TO,'https://life-skills.bneineviimacademy.org')).rejects.toMatchObject({code:'UNAVAILABLE'});
 expect(send).not.toHaveBeenCalled();expect((await ownerRow(saved.item.id))?.state).toBe('queued');
 expect(await leadCipher(saved.item.id)).toBe(beforeLead);expect((await noticeRows(saved.item.id)).filter(r=>r.purpose===INQUIRY_EMAIL_PURPOSE)).toEqual(beforeAck);expect(fetch).not.toHaveBeenCalled();
});
