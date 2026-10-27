import {communicationPreferenceSelection,communicationPreferenceReadback} from '../../src/features/group-application/academy-communication-preferences.ts';
import {publicGroupApplicationHttp} from '../../src/features/group-application/http.ts';
import {issueFloridaGroupApplicationChallenge} from '../../src/features/group-application/challenge.ts';
import {ACADEMY_CAMPAIGN,PREREG_CREATIVE,type CampaignAttribution} from '../../src/features/group-application/academy-campaign-contract.ts';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {beforeAll,afterAll,it,expect,vi} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
vi.mock('server-only',()=>({}));
import {AcademyFounderStore,type FounderPaymentPort,type FounderNativeFamilyPort} from '../../src/features/group-application/academy-founder-store.ts';
import {PublicGroupApplicationStore} from '../../src/features/group-application/store.ts';
import {ACADEMY_REGISTRATION_VERSION,ACADEMY_PREVIOUS_FREE_REGISTRATION_VERSION,registrationConsent} from '../../src/features/group-application/academy-registration.ts';
import {privateDigest} from '../../src/features/contact-ops/server/digests.ts';
import {academyRegistrationNotice} from '../../src/features/group-application/academy-registration-notice.ts';
import {floridaAcademyRegistrationFieldsSchema} from '../../src/features/group-application/contract.ts';
import {INQUIRY_EMAIL_FROM} from '../../src/features/group-application/inquiry-email-copy.ts';
import {signupEmailReview} from '../../src/features/group-application/academy-signup-email-review.ts';
import {opaqueToken,seal,unseal} from '../../src/features/identity/crypto.ts';
import {AcademyFounderTransitionStore} from '../../src/features/group-application/academy-founder-transition-store.ts';
import {asId} from '../../src/lib/ids.ts';
import type {Actor} from '../../src/features/identity/types.ts';
import type {IdentityStore,SqlSession} from '../../src/features/identity/store.ts';
const db=new PGlite(),ring={activeKeyId:'synthetic',keys:{synthetic:Buffer.alloc(32,7)}},key='synthetic-founder-private-key-only',origin='https://academy.example.invalid';

it('upgrades preexisting queued/unknown/sent/canceled inquiry rows additively and rolls back a failed proposal completely',async()=>{
 const legacy=new PGlite();
 try{
  await legacy.exec('CREATE SCHEMA ls_control');
  for(const name of ['0001_ls_foundation.sql','0010_ls_identity_cases_20260906.sql','0124_ls_group_interest.sql','0131_ls_public_group_applications.sql','0135_ls_inquiry_email_outbox.sql'])await legacy.exec(await readFile('migrations/'+name,'utf8'));
  const workspace=randomUUID(),at=new Date('2026-10-24T12:00:00Z');
  await legacy.query('INSERT INTO ls_identity.workspaces(id,created_at) VALUES($1,$2)',[workspace,at]);
  for(const state of ['queued','unknown','sent','canceled']){
   const application=randomUUID(),id=randomUUID(),ciphertext=seal(JSON.stringify({synthetic:true,state}),`ls_service_interest/inquiry_email/v1/${workspace}/${id}`,ring);
   await legacy.query("INSERT INTO ls_service_interest.public_applications(workspace_id,id,contact_digest,request_digest,payload_ciphertext,notice_version,notice_language,received_at) VALUES($1,$2,$3,$4,$5,'synthetic','en',$6)",[workspace,application,'a'.repeat(64),application.replaceAll('-','').repeat(2),ciphertext,at]);
   await legacy.query("INSERT INTO ls_service_interest.inquiry_email_outbox(workspace_id,id,application_id,purpose,payload_ciphertext,state,created_at,reserved_at,completed_at,provider_id) VALUES($1,$2,$3,'academy_inquiry_acknowledgment_v1',$4,$5,$6,$7,$8,$9)",[workspace,id,application,ciphertext,state,at,['unknown','sent'].includes(state)?at:null,['sent','canceled'].includes(state)?at:null,state==='sent'?'synthetic_legacy_receipt':null]);
  }
  const columns='workspace_id,id,application_id,purpose,payload_ciphertext,state,created_at,reserved_at,completed_at,reconciled_by,provider_id';
  const before=(await legacy.query(`SELECT ${columns} FROM ls_service_interest.inquiry_email_outbox ORDER BY id`)).rows;
  const proposal=await readFile('migrations/proposals/0136_ls_academy_founder.sql','utf8');
  await legacy.exec('BEGIN');await expect(legacy.exec(proposal+'\nSELECT 1/0;')).rejects.toThrow();await legacy.exec('ROLLBACK');
  expect((await legacy.query("SELECT to_regclass('ls_service_interest.academy_founder_families') AS relation")).rows).toEqual([{relation:null}]);
  expect((await legacy.query("SELECT column_name FROM information_schema.columns WHERE table_schema='ls_service_interest' AND table_name='inquiry_email_outbox' AND column_name IN('founder_id','message_key')")).rows).toEqual([]);
  expect((await legacy.query(`SELECT ${columns} FROM ls_service_interest.inquiry_email_outbox ORDER BY id`)).rows).toEqual(before);
  await legacy.exec('BEGIN');await legacy.exec(proposal);await legacy.exec('COMMIT');
  const after=(await legacy.query(`SELECT ${columns} FROM ls_service_interest.inquiry_email_outbox ORDER BY id`)).rows;
  expect(after).toEqual(before);
  expect((await legacy.query('SELECT founder_id,message_key FROM ls_service_interest.inquiry_email_outbox')).rows).toEqual(before.map(()=>({founder_id:null,message_key:null})));
  for(const row of after){const saved=row as {id:string;payload_ciphertext:string;state:string};expect(JSON.parse(unseal(saved.payload_ciphertext,`ls_service_interest/inquiry_email/v1/${workspace}/${saved.id}`,ring))).toEqual({synthetic:true,state:saved.state});}
  const row=before[0] as {application_id:string};
  await expect(legacy.query("INSERT INTO ls_service_interest.inquiry_email_outbox(workspace_id,id,application_id,purpose,payload_ciphertext,state,created_at) VALUES($1,$2,$3,'academy_inquiry_acknowledgment_v1','synthetic','queued',$4)",[workspace,randomUUID(),row.application_id,at])).rejects.toThrow();
  await expect(legacy.query("UPDATE ls_service_interest.inquiry_email_outbox SET purpose='unapproved_purpose' WHERE workspace_id=$1",[workspace])).rejects.toThrow();
 }finally{await legacy.close();}
},30000);
let now=new Date('2026-10-23T14:00:00Z');const clock={now:()=>now};
const store:IdentityStore={transaction:fn=>db.transaction(tx=>fn({query:async<T extends object>(sql:string,values:readonly unknown[]=[])=> (await tx.query<T>(sql,[...values])).rows} as SqlSession))};
/** Embedded-memory historical fixture only. The current public command/notice
 * remains valid v5. Before assertions, restore precisely the pre-patch6d
 * encrypted family/outbox shape: no new content marker or exact identity.
 * New-v5 coverage opts out and exercises the untouched production store. */
class PrepatchV5FixtureFounder extends AcademyFounderStore{
 override async accept(...args:Parameters<AcademyFounderStore['accept']>){
  const result=await super.accept(...args),[tx,applicationId]=args;
  const rows=await tx.query<{workspace_id:string;id:string;payload_ciphertext:string}>('SELECT f.workspace_id,f.id,f.payload_ciphertext FROM ls_service_interest.academy_founder_families f JOIN ls_service_interest.academy_founder_applications a ON a.workspace_id=f.workspace_id AND a.family_id=f.id WHERE a.application_id=$1',[applicationId]);
  for(const row of rows){const aad=`ls_service_interest/founder/v1/${row.workspace_id}/${row.id}`,family=JSON.parse(unseal(row.payload_ciphertext,aad,ring));delete family.signupContent;await tx.query('UPDATE ls_service_interest.academy_founder_families SET payload_ciphertext=$3 WHERE workspace_id=$1 AND id=$2',[row.workspace_id,row.id,seal(JSON.stringify(family),aad,ring)]);
   const queued=await tx.query<{id:string;payload_ciphertext:string}>("SELECT id,payload_ciphertext FROM ls_service_interest.inquiry_email_outbox WHERE workspace_id=$1 AND founder_id=$2 AND state='queued'",[row.workspace_id,row.id]);
   for(const message of queued){const mailAad=`ls_service_interest/inquiry_email/v1/${row.workspace_id}/${message.id}`,payload=JSON.parse(unseal(message.payload_ciphertext,mailAad,ring));if(payload.transactional!==undefined||payload.templateCatalogSha256!==undefined){delete payload.transactional;delete payload.templateCatalogSha256;await tx.query('UPDATE ls_service_interest.inquiry_email_outbox SET payload_ciphertext=$3 WHERE workspace_id=$1 AND id=$2',[row.workspace_id,message.id,seal(JSON.stringify(payload),mailAad,ring)]);}}
  }return result;
 }
}
async function fixture(port:FounderPaymentPort|null=null,native:FounderNativeFamilyPort|null=null,prepatch=true){const workspace=asId(randomUUID(),'workspace');await db.query('INSERT INTO ls_identity.workspaces(id,created_at) VALUES($1,$2)',[workspace,now]);const owner=randomUUID(),digest=owner.replaceAll('-','').padEnd(64,'0');await db.query("INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,'adult','synthetic',$3)",[owner,workspace,now]);await db.query("INSERT INTO ls_identity.accounts(id,workspace_id,role,state,locale,email_blind,email_ciphertext,email_verified_at,password_hash,created_at,updated_at) VALUES($1,$2,'practitioner','active','en',$3,'synthetic',$4,'synthetic',$4,$4)",[owner,workspace,digest,now]);await db.query('INSERT INTO ls_identity.account_subjects(workspace_id,account_id,person_id) VALUES($1,$2,$2)',[workspace,owner]);await db.query('INSERT INTO ls_identity.sessions(token_digest,workspace_id,account_id,created_at,expires_at) VALUES($1,$2,$3,$4,$5)',[digest,workspace,owner,now,new Date('2035-01-01')]);const actor={id:owner,workspaceId:workspace,personId:owner,role:'practitioner',state:'active',locale:'en',sessionDigest:digest,expiresAt:new Date('2035-01-01').getTime()} as Actor;const Founder=prepatch?PrepatchV5FixtureFounder:AcademyFounderStore;const founder=new Founder(store,workspace,ring,key,clock,port,native),applications=new PublicGroupApplicationStore(store,workspace,ring,key,clock,false,founder);return {workspace,actor,founder,applications};}
function command(email=`family-${randomUUID()}@example.invalid`){return {operationId:randomUUID(),fields:floridaAcademyRegistrationFieldsSchema.parse({parentName:'Synthetic Parent '+email,contact:email,language:'en',cityArea:'Synthetic Florida',programId:'sunday_fishing_academy',schedulePreference:[],academyRegistration:{version:ACADEMY_REGISTRATION_VERSION,learners:[{id:randomUUID(),fullName:'Synthetic Child',ageYears:10,grade:'5',schooling:'school',experience:'new'}],postalCode:'33020',preferredDays:['monday'],preferredTimes:['afternoon'],driveMinutes:30,schoolHoursAvailability:'outside_school_only',preferredGroupLanguage:'either',stageInterest:'foundation',receiptEmail:email,intent:'information',consent:registrationConsent('en')},permission:{confirmed:true,version:academyRegistrationNotice.version,language:'en'}})};}
async function messages(workspace:string){return (await db.query<{id:string;founder_id:string;state:string;purpose:string;payload_ciphertext:string;application_id:string}>('SELECT * FROM ls_service_interest.inquiry_email_outbox WHERE workspace_id=$1 ORDER BY created_at,id',[workspace])).rows;}
async function token(workspace:string,id:string){const row=(await messages(workspace)).find(m=>m.id===id)!;return JSON.parse(unseal(row.payload_ciphertext,`ls_service_interest/inquiry_email/v1/${workspace}/${id}`,ring)).token as string;}
beforeAll(async()=>{await db.exec('CREATE SCHEMA ls_control');for(const n of ['0001_ls_foundation.sql','0010_ls_identity_cases_20260906.sql','0124_ls_group_interest.sql','0131_ls_public_group_applications.sql','0135_ls_inquiry_email_outbox.sql','proposals/0136_ls_academy_founder.sql'])await db.exec(await readFile('migrations/'+n,'utf8'));},25000);
afterAll(async()=>db.close());
it('replays an immutable historical v3 application with preferences and attribution after v4 without rewriting consent or placement',async()=>{
 const x=await fixture(),c=command(),id=randomUUID(),continuation=opaqueToken();
 c.fields.academyRegistration.version=ACADEMY_PREVIOUS_FREE_REGISTRATION_VERSION;
 c.fields.academyRegistration.consent=registrationConsent('en',ACADEMY_PREVIOUS_FREE_REGISTRATION_VERSION);
 c.fields.permission.version=c.fields.academyRegistration.consent.version;
 c.fields.academyRegistration.stageInterest='advanced';
 c.fields.academyRegistration.communicationPreferences=communicationPreferenceSelection('he',false,true,'en');
 const fields=floridaAcademyRegistrationFieldsSchema.parse(c.fields),at=new Date('2026-10-24T12:00:00Z');
 const touch={campaign:ACADEMY_CAMPAIGN,source:'facebook',medium:'social',content:PREREG_CREATIVE.id}as const,attribution:CampaignAttribution={first:touch,last:touch};
 const digest=privateDigest({domain:'public-group-application/v1',workspace:x.workspace,fields},key),ciphertext=seal(JSON.stringify(fields),`ls_service_interest/public_application/v1/${x.workspace}/${id}`,ring);
 // Seed the already-accepted historical tuple; the current public write API must reject new v3 tuples.
 await store.transaction(async tx=>{
  await tx.query('INSERT INTO ls_service_interest.public_applications(workspace_id,id,contact_digest,request_digest,payload_ciphertext,notice_version,notice_language,received_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[x.workspace,id,'a'.repeat(64),digest,ciphertext,fields.permission.version,fields.language,at]);
  await tx.query('INSERT INTO ls_service_interest.public_application_operations(workspace_id,operation_id,request_digest,application_id) VALUES($1,$2,$3,$4)',[x.workspace,c.operationId,digest,id]);
  await x.founder.accept(tx,id,fields,continuation);await x.founder.bindAttribution(tx,c.operationId,id,attribution);
 });
 const before=(await db.query('SELECT payload_ciphertext,request_digest,notice_version,received_at FROM ls_service_interest.public_applications WHERE id=$1',[id])).rows;
 const replay=await x.applications.replaySaved(c,attribution);expect(replay?.item).toMatchObject({id,receivedAt:at.toISOString(),fields});
 expect((await x.applications.submit(c,continuation,attribution)).item).toEqual(replay!.item);
 await expect(x.applications.replaySaved({...c,fields:{...c.fields,parentName:'Changed synthetic parent'}},attribution)).rejects.toMatchObject({code:'CONFLICT'});
 await expect(x.applications.replaySaved(c,{first:touch,last:{...touch,source:'whatsapp',medium:'message'}})).rejects.toMatchObject({code:'CONFLICT'});
 await expect(x.applications.submit({...c,operationId:randomUUID()},continuation,attribution)).rejects.toMatchObject({code:'INVALID_REQUEST'});
 expect((await db.query('SELECT payload_ciphertext,request_digest,notice_version,received_at FROM ls_service_interest.public_applications WHERE id=$1',[id])).rows).toEqual(before);
 expect(await x.founder.aggregate()).toMatchObject({occupied:1,remaining:29});
});
it('allocates at durable acceptance; exact replay/reload and sibling/language continuation consume one family allocation',async()=>{
 const x=await fixture(),c=command(),continuation=opaqueToken(),saved=await x.applications.submit(c,continuation);expect(saved.founder).toMatchObject({status:'reserved',email:'queued',deadline:null});expect(await x.founder.aggregate()).toMatchObject({remaining:29,capacity:30});
 expect((await x.applications.submit(c,continuation)).item.id).toBe(saved.item.id);expect((await x.applications.replaySaved(c))?.founder?.reference).toBe(saved.item.id);
 const sibling=command(c.fields.academyRegistration.receiptEmail);sibling.fields.academyRegistration.learners[0]!.fullName='Synthetic Sibling';sibling.fields.parentName=c.fields.parentName;sibling.fields.language='he';sibling.fields.permission.language='he';sibling.fields.academyRegistration.consent=registrationConsent('he');sibling.fields.academyRegistration.learners=[...c.fields.academyRegistration.learners,...sibling.fields.academyRegistration.learners];
 const amended=await x.applications.submit(sibling,continuation);expect(amended.founder?.reference).toBe(saved.item.id);expect(await x.founder.aggregate()).toMatchObject({remaining:29,capacity:30});const read=await x.founder.ownerList(x.actor);expect(read.metrics).toMatchObject({completedRegistrations:2,uniqueFamilies:1,children:2,collectedCents:0,paidFamilies:0,confirmedEnrollment:0});expect(await x.applications.list(x.actor)).toContainEqual(saved.item);expect((await messages(x.workspace))).toHaveLength(1);
 const sameName=command(c.fields.academyRegistration.receiptEmail);sameName.fields.parentName=c.fields.parentName;sameName.fields.academyRegistration.learners[0]!.fullName=c.fields.academyRegistration.learners[0]!.fullName;await x.applications.submit(sameName,continuation);expect((await x.founder.ownerList(x.actor)).metrics.children).toBe(3);expect(await x.founder.aggregate()).toMatchObject({remaining:29,capacity:30});
});
it('serializes simultaneous last-slot submissions, accepts the loser into interest list, and never backfills old inquiries',async()=>{
 const x=await fixture();for(let i=0;i<29;i++)await x.applications.submit(command(),opaqueToken());const both=await Promise.all([x.applications.submit(command(),opaqueToken()),x.applications.submit(command(),opaqueToken())]);expect(both.map(b=>b.founder?.status).sort()).toEqual(['regular_registration','reserved']);expect(await x.founder.aggregate()).toMatchObject({remaining:0,capacity:30});
 const conflict=command(both[0]!.item.fields && 'academyRegistration' in both[0]!.item.fields?both[0]!.item.fields.academyRegistration?.receiptEmail:undefined);const pending=await x.applications.submit(conflict,opaqueToken());expect(pending.founder?.status).toBe('pending_verification');expect(await x.founder.aggregate()).toMatchObject({remaining:0,capacity:30});
 const legacy=await db.query('SELECT id FROM ls_service_interest.public_applications WHERE workspace_id=$1',[x.workspace]);expect(legacy.rows.length).toBe(32);
},25000);
it('sends once after committed UNKNOWN, records actual successful SEND without starting an interest deadline, explicit confirmation is idempotent and cancels reminders',async()=>{
 const x=await fixture();await x.applications.submit(command(),opaqueToken());const m=(await messages(x.workspace))[0]!,secret=await token(x.workspace,m.id);await expect(x.founder.confirm(secret)).rejects.toMatchObject({code:'CONFLICT'});
 let mail='';const send=vi.fn(async(p:{text:string})=>{expect((await messages(x.workspace))[0]?.state).toBe('unknown');mail=p.text;return {providerId:'synthetic1'};});
 expect(await x.founder.dispatchOne(m.id,{send},INQUIRY_EMAIL_FROM,origin)).toBe('sent');expect(await x.founder.dispatchOne(m.id,{send},INQUIRY_EMAIL_FROM,origin)).toBe('idle');expect(send).toHaveBeenCalledTimes(1);expect(mail).toContain('Confirm My Interest');expect(mail).not.toContain('Pay');
 let f=(await x.founder.ownerList(x.actor)).families[0]!;expect(f.interest.deadline).toBeNull();expect(f.payment.deadline).toBeNull();now=new Date('2026-10-26T14:00:01Z');await x.founder.tick();expect((await messages(x.workspace)).some(m=>m.purpose==='academy_founder_interest_reminder')).toBe(true);
 expect(await x.founder.confirm(secret)).toMatchObject({confirmed:true});expect(await x.founder.confirm(secret)).toMatchObject({confirmed:true});f=(await x.founder.ownerList(x.actor)).families[0]!;expect(f.status).toBe('confirmed');expect((await messages(x.workspace)).filter(m=>m.purpose==='academy_founder_ack')).toHaveLength(1);expect((await messages(x.workspace)).filter(m=>m.purpose.includes('reminder')).every(m=>m.state==='canceled')).toBe(true);
 now=new Date('2026-10-23T14:00:00Z');
});
it('ambiguous send, process restart, suppression and unsent records cannot fabricate delivery or forfeit an allocation',async()=>{
 const x=await fixture();await x.applications.submit(command(),opaqueToken());const m=(await messages(x.workspace))[0]!;const send=vi.fn(async()=>{throw Error('ambiguous');});expect(await x.founder.dispatchOne(m.id,{send},INQUIRY_EMAIL_FROM,origin)).toBe('unknown');const restarted=new AcademyFounderStore(store,x.workspace,ring,key,clock);expect(await restarted.dispatchOne(m.id,{send},INQUIRY_EMAIL_FROM,origin)).toBe('idle');expect(send).toHaveBeenCalledTimes(1);
 now=new Date('2026-12-01T15:00:00Z');await restarted.tick();const f=(await restarted.ownerList(x.actor)).families[0]!;expect(f.status).toBe('provisional');expect(f.interest.deadline).toBeNull();expect(f.interest.exception).toBe(true);expect(await restarted.aggregate()).toMatchObject({remaining:29,capacity:30});now=new Date('2026-10-23T14:00:00Z');
});
it('does not expire an initial interest reservation or promote the waiting family merely after seven days',async()=>{
 const x=await fixture();for(let i=0;i<31;i++)await x.applications.submit(command(),opaqueToken());const rows=await messages(x.workspace),first=rows[0]!;await x.founder.dispatchOne(first.id,{send:async()=>({providerId:'synthetic_expire'})},INQUIRY_EMAIL_FROM,origin);
 now=new Date('2026-10-31T15:00:00Z');await x.founder.tick();const list=await x.founder.ownerList(x.actor);expect(list.families.filter(f=>f.status==='expired')).toHaveLength(0);expect(list.families[30]?.status).toBe('interest_list');expect(list.families[30]?.interest.deadline).toBeNull();expect(await x.founder.aggregate()).toMatchObject({remaining:0,capacity:30});await x.founder.tick();expect((await x.founder.ownerList(x.actor)).families.filter(f=>f.status==='expired')).toHaveLength(0);now=new Date('2026-10-23T14:00:00Z');
},25000);
it('requires a native offer capability, preserves internal scheduling holds, and reconciles paid/partial outcomes before release',async()=>{
 let settle=false;const port:FounderPaymentPort={activateWindow:async()=>true,extendWindow:async()=>true,inspect:async(_tx,f)=>({inFlight:false,paidChildIds:settle?[f.children[0]!.id]:[],collectedCents:settle?(f.offer?.children[0]?.amount??0)*100:0,enrolledChildIds:[]}),approve:async(_tx,_actor,f,input)=>({id:randomUUID(),group:'Synthetic suitable group',groupId:input.groupId,firstSession:input.firstSession,paymentUrl:origin+'/synthetic-payment',terms:'Synthetic reviewed terms',priceVersion:'synthetic-v1',children:input.expectedAmounts.map(p=>({...p,name:f.children.find(c=>c.id===p.id)!.name}))}),reconcileAndClose:async(_tx,f)=>({safeToRelease:!settle,paidChildIds:settle?[f.children[0]!.id]:[],collectedCents:settle?(f.offer?.children[0]?.amount??0)*100:0,enrolledChildIds:[]})};
 const householdId=randomUUID(),parentAccountId=randomUUID(),nativeLearners=new Map<string,string>(),native:FounderNativeFamilyPort={read:async(_tx,actor,family,source)=>({source,householdId,parentAccountId,verifiedBy:actor.id,verifiedAt:now.toISOString(),children:family.children.map(c=>({registrationChildId:c.id,learnerId:nativeLearners.get(c.id)??(nativeLearners.set(c.id,randomUUID()),nativeLearners.get(c.id)!)}))})};const x=await fixture(port,native),familyCommand=command();familyCommand.fields.academyRegistration.learners.push({...familyCommand.fields.academyRegistration.learners[0]!,id:randomUUID(),fullName:'Synthetic additional sibling'});await x.applications.submit(familyCommand,opaqueToken());const m=(await messages(x.workspace))[0]!;await x.founder.dispatchOne(m.id,{send:async()=>({providerId:'synthetic_confirm'})},INQUIRY_EMAIL_FROM,origin);await x.founder.confirm(await token(x.workspace,m.id));let f=(await x.founder.ownerList(x.actor)).families[0]!;
 const owner=(action:Record<string,unknown>)=>x.founder.execute(x.actor,{operationId:randomUUID(),familyId:f.id,expectedRevision:f.revision,reason:'Synthetic owner-reviewed evidence',...action} as Parameters<AcademyFounderStore['execute']>[1]);
 await expect(new AcademyFounderStore(store,x.workspace,ring,key,clock).execute(x.actor,{operationId:randomUUID(),familyId:f.id,expectedRevision:f.revision,reason:'Synthetic offer unavailable',action:'approve_offer',groupId:randomUUID(),firstSession:'2026-12-01T15:00:00Z',plan:'prepay'})).rejects.toMatchObject({code:'UNAVAILABLE'});
 await owner({action:'bind_native_family',binding:{applicationId:f.reference,personId:randomUUID(),expectedEpoch:3,expectedAssociationVersion:1,expectedFieldsDigest:'a'.repeat(64),expectedFamilyDigest:'b'.repeat(64)}});f=(await x.founder.ownerList(x.actor)).families[0]!;
 await owner({action:'approve_offer',groupId:randomUUID(),firstSession:'2026-12-01T15:00:00Z',plan:'prepay'});f=(await x.founder.ownerList(x.actor)).families[0]!;expect(f.payment.deadline).toBeNull();expect(f.offer?.children[0]?.amount).toBe(1650);
 const offerMail=(await messages(x.workspace)).find(m=>m.purpose==='academy_founder_offer')!;await x.founder.dispatchOne(offerMail.id,{send:async()=>({providerId:'synthetic_offer'})},INQUIRY_EMAIL_FROM,origin);f=(await x.founder.ownerList(x.actor)).families[0]!;expect(f.payment.deadline).toBe('2026-10-30T14:00:00.000Z');
 const activation=vi.spyOn(port,'extendWindow');await owner({action:'extend',window:'payment',deadline:'2026-11-01T14:00:00Z'});expect(activation).toHaveBeenCalledWith(expect.anything(),expect.anything(),expect.anything(),expect.objectContaining({deadline:'2026-11-01T14:00:00Z',timezone:'America/New_York'}));f=(await x.founder.ownerList(x.actor)).families[0]!;
 await owner({action:'scheduling_hold'});f=(await x.founder.ownerList(x.actor)).families[0]!;expect(f.status).toBe('scheduling_hold');expect(f.payment.deadline).toBeNull();now=new Date('2026-11-01T15:00:00Z');await x.founder.tick();expect((await x.founder.ownerList(x.actor)).families[0]?.status).toBe('scheduling_hold');
 await owner({action:'approve_offer',groupId:randomUUID(),firstSession:'2026-12-01T15:00:00Z',plan:'monthly_block'});f=(await x.founder.ownerList(x.actor)).families[0]!;expect(f.offer?.children[0]?.amount).toBe(650);expect(f.payment.deadline).toBeNull();const reoffer=(await messages(x.workspace)).filter(m=>m.purpose==='academy_founder_offer'&&m.state==='queued')[0]!;await x.founder.dispatchOne(reoffer.id,{send:async()=>({providerId:'synthetic_reoffer'})},INQUIRY_EMAIL_FROM,origin);settle=true;now=new Date('2026-11-10T15:00:00Z');await x.founder.tick();f=(await x.founder.ownerList(x.actor)).families[0]!;expect(f.status).toBe('redeemed');expect(f.children).toHaveLength(2);expect(f.redeemedChildIds).toHaveLength(1);expect(f.enrolledChildIds).toHaveLength(0);expect(await x.founder.aggregate()).toMatchObject({remaining:29,capacity:30});now=new Date('2026-10-23T14:00:00Z');
});
it('rejects cross-workspace/nonowner commands and rolls back accepted form if reservation persistence fails',async()=>{
 const x=await fixture(),y=await fixture();await expect(x.founder.ownerList(y.actor)).rejects.toMatchObject({code:'FORBIDDEN'});
 const broken:IdentityStore={transaction:fn=>store.transaction(tx=>fn({query:(sql,values)=>{if(sql.includes('INSERT INTO ls_service_interest.academy_founder_families'))throw Error('synthetic storage failure');return tx.query(sql,values);}}))};const founder=new AcademyFounderStore(broken,x.workspace,ring,key,clock),apps=new PublicGroupApplicationStore(broken,x.workspace,ring,key,clock,false,founder),c=command();await expect(apps.submit(c,opaqueToken())).rejects.toThrow('synthetic storage failure');expect(await x.applications.replaySaved(c)).toBeNull();expect(await x.founder.aggregate()).toMatchObject({remaining:30,capacity:30});
});
it('holds exact household conflicts across different email addresses for review without merging or consuming another slot',async()=>{
 const x=await fixture(),a=command(),b=command();b.fields.parentName=a.fields.parentName;await x.applications.submit(a,opaqueToken());const saved=await x.applications.submit(b,opaqueToken());expect(saved.founder?.status).toBe('pending_verification');const read=await x.founder.ownerList(x.actor);expect(read.families).toHaveLength(2);expect(read.metrics.activeFounderReservations).toBe(1);expect(read.families.map(f=>f.email)).toEqual([a.fields.academyRegistration.receiptEmail,b.fields.academyRegistration.receiptEmail]);
});
it('records delayed SEND success without a deadline receipt and never expires a verified NOT SENT result',async()=>{
 const x=await fixture();await x.applications.submit(command(),opaqueToken());const m=(await messages(x.workspace))[0]!;
 await x.founder.dispatchOne(m.id,{send:async()=>{now=new Date('2026-10-23T14:05:00Z');return {providerId:'synthetic_slow'};}},INQUIRY_EMAIL_FROM,origin);
 let f=(await x.founder.ownerList(x.actor)).families[0]!;expect(f.interest.sentAt).toBe('2026-10-23T14:05:00.000Z');expect(f.interest.deadline).toBeNull();expect((await messages(x.workspace)).filter(m=>m.purpose==='academy_founder_interest_deadline_receipt')).toHaveLength(0);
 f=(await x.founder.ownerList(x.actor)).families[0]!;const action={operationId:randomUUID(),familyId:f.id,expectedRevision:f.revision,reason:'Synthetic verified provider result proves no send',action:'delivery_review' as const,messageId:m.id,outcome:'not_sent' as const};await x.founder.execute(x.actor,action);await x.founder.execute(x.actor,action);now=new Date('2026-12-01T14:00:00Z');await x.founder.tick();f=(await x.founder.ownerList(x.actor)).families[0]!;expect(f.interest.deadline).toBeNull();expect(f.status).toBe('provisional');expect(f.allocated).toBe(true);now=new Date('2026-10-23T14:00:00Z');
});
it('pause then resume during network IO invalidates the old dispatch clock and retains its late provider receipt as an exception',async()=>{
 const x=await fixture();await x.applications.submit(command(),opaqueToken());const m=(await messages(x.workspace))[0]!;
 await x.founder.dispatchOne(m.id,{send:async()=>{for(const action of ['pause','resume'] as const){const f=(await x.founder.ownerList(x.actor)).families[0]!;await x.founder.execute(x.actor,{operationId:randomUUID(),familyId:f.id,expectedRevision:f.revision,reason:'Synthetic in-flight operator change',action});}return {providerId:'synthetic_late'};}},INQUIRY_EMAIL_FROM,origin);
 const f=(await x.founder.ownerList(x.actor)).families[0]!;expect(f.interest.deadline).toBeNull();expect(f.interest.exception).toBe(true);expect((await messages(x.workspace)).find(r=>r.id===m.id)?.state).toBe('sent');
});

it('binds only accepted application/native family authority, rechecks cached retries and keeps household uniqueness through history',async()=>{
 let deny=false;const householdId=randomUUID(),parentAccountId=randomUUID(),learners=new Map<string,string>(),read=vi.fn<FounderNativeFamilyPort['read']>(async(_tx,actor,family,source)=>{if(deny)throw Error('Synthetic guardian denied');return {source,householdId,parentAccountId,verifiedBy:actor.id,verifiedAt:now.toISOString(),children:family.children.map(c=>({registrationChildId:c.id,learnerId:learners.get(c.id)??(learners.set(c.id,randomUUID()),learners.get(c.id)!)}))};});
 const x=await fixture(null,{read});
 async function confirmed(){const saved=await x.applications.submit(command(),opaqueToken()),m=(await messages(x.workspace)).find(m=>m.application_id===saved.item.id)!;await x.founder.dispatchOne(m.id,{send:async()=>({providerId:'synthetic_binding'})},INQUIRY_EMAIL_FROM,origin);await x.founder.confirm(await token(x.workspace,m.id));return (await x.founder.ownerList(x.actor)).families.find(f=>f.reference===saved.item.id)!;}
 const f=await confirmed(),binding={applicationId:f.reference,personId:randomUUID(),expectedEpoch:3,expectedAssociationVersion:1,expectedFieldsDigest:'a'.repeat(64),expectedFamilyDigest:'b'.repeat(64)},action={action:'bind_native_family' as const,operationId:randomUUID(),familyId:f.id,expectedRevision:f.revision,reason:'Synthetic current native family evidence',binding};
 await expect(x.founder.execute(x.actor,{...action,binding:{...binding,applicationId:randomUUID()}})).rejects.toMatchObject({code:'CONFLICT'});expect(read).not.toHaveBeenCalled();
 await expect(new AcademyFounderStore(store,x.workspace,ring,key,clock).execute(x.actor,action)).rejects.toMatchObject({code:'UNAVAILABLE'});
 await x.founder.execute(x.actor,action);await x.founder.execute(x.actor,action);expect(read).toHaveBeenCalledTimes(2);const bound=(await x.founder.ownerList(x.actor)).families[0]!;expect(bound.nativeBinding?.householdId).toBe(householdId);
 deny=true;await expect(x.founder.execute(x.actor,action)).rejects.toThrow('Synthetic guardian denied');deny=false;
 await x.founder.execute(x.actor,{action:'withdraw',operationId:randomUUID(),familyId:f.id,expectedRevision:bound.revision,reason:'Synthetic unused withdrawal preserves binding history'});
 const other=await confirmed();await expect(x.founder.execute(x.actor,{...action,operationId:randomUUID(),familyId:other.id,expectedRevision:other.revision,binding:{...binding,applicationId:other.reference}})).rejects.toMatchObject({code:'CONFLICT'});
 expect((await x.founder.ownerList(x.actor)).families.find(f=>f.id===other.id)?.nativeBinding).toBeUndefined();expect(await x.founder.aggregate()).toMatchObject({remaining:29,capacity:30});
});

async function paymentScenario(overrides:Partial<FounderPaymentPort>={},beforeOffer?:(x:Awaited<ReturnType<typeof fixture>>)=>Promise<void>){
 const port:FounderPaymentPort={approve:async(_tx,_actor,f,input)=>({id:randomUUID(),group:'Synthetic bound group',groupId:input.groupId,firstSession:input.firstSession,paymentUrl:origin+'/synthetic-closed-link',terms:'Synthetic terms',priceVersion:'synthetic',children:input.expectedAmounts.map(c=>({...c,name:'Synthetic child'}))}),activateWindow:async()=>true,inspect:async()=>({inFlight:false,paidChildIds:[],collectedCents:0,enrolledChildIds:[]}),reconcileAndClose:async()=>({safeToRelease:true,paidChildIds:[],collectedCents:0,enrolledChildIds:[]}),...overrides};
 const householdId=randomUUID(),parentAccountId=randomUUID(),learners=new Map<string,string>(),native:FounderNativeFamilyPort={read:async(_tx,actor,family,source)=>({source,householdId,parentAccountId,verifiedBy:actor.id,verifiedAt:now.toISOString(),children:family.children.map(c=>({registrationChildId:c.id,learnerId:learners.get(c.id)??(learners.set(c.id,randomUUID()),learners.get(c.id)!)}))})};
 const x=await fixture(port,native),c=command();c.fields.academyRegistration.learners.push({...c.fields.academyRegistration.learners[0]!,id:randomUUID(),fullName:'Synthetic sibling'});await x.applications.submit(c,opaqueToken());const interest=(await messages(x.workspace))[0]!;await x.founder.dispatchOne(interest.id,{send:async()=>({providerId:'synthetic_interest'})},INQUIRY_EMAIL_FROM,origin);await x.founder.confirm(await token(x.workspace,interest.id));
 const current=async()=>(await x.founder.ownerList(x.actor)).families[0]!,owner=async(action:Record<string,unknown>)=>{const f=await current();return x.founder.execute(x.actor,{operationId:randomUUID(),familyId:f.id,expectedRevision:f.revision,reason:'Synthetic owner payment-boundary evidence',...action} as Parameters<AcademyFounderStore['execute']>[1]);};
 let f=await current();await owner({action:'bind_native_family',binding:{applicationId:f.reference,personId:randomUUID(),expectedEpoch:3,expectedAssociationVersion:1,expectedFieldsDigest:'a'.repeat(64),expectedFamilyDigest:'b'.repeat(64)}});await beforeOffer?.(x);await owner({action:'approve_offer',groupId:randomUUID(),firstSession:'2026-12-01T15:00:00Z',plan:'prepay'});f=await current();const mail=(await messages(x.workspace)).find(m=>m.purpose==='academy_founder_offer')!;return {...x,port,current,owner,mail,f};
}
it('activates only after durable matching sent evidence; reviewed delivery is recorded first and immutable extension requires a distinct capability',async()=>{
 const activation=vi.fn<FounderPaymentPort['activateWindow']>(async(tx,f,offer,evidence)=>{expect(evidence).toMatchObject({providerId:'synthetic_reviewed_offer',generation:f.payment.generation,timezone:'America/New_York'});expect(offer.id).toBe(f.offer!.id);const all=await tx.query<{state:string;providerId:string}>('SELECT state,provider_id AS "providerId" FROM ls_service_interest.inquiry_email_outbox WHERE id=$1',[evidence.messageId]);expect(all).toEqual([{state:'sent',providerId:evidence.providerId}]);return true;});
 const x=await paymentScenario({activateWindow:activation});expect(activation).not.toHaveBeenCalled();expect(await x.founder.dispatchOne(x.mail.id,{send:async()=>{throw Error('synthetic ambiguous');}},INQUIRY_EMAIL_FROM,origin)).toBe('unknown');expect(activation).not.toHaveBeenCalled();
 await x.owner({action:'delivery_review',messageId:x.mail.id,outcome:'sent',sentAt:now.toISOString(),providerId:'synthetic_reviewed_offer'});expect(activation).toHaveBeenCalledTimes(1);expect((await x.current()).payment.exception).toBe(false);
 await expect(x.owner({action:'extend',window:'payment',deadline:'2026-11-01T14:00:00Z'})).rejects.toMatchObject({code:'UNAVAILABLE'});expect((await x.current()).payment.deadline).toBe('2026-10-30T14:00:00.000Z');const extend=vi.fn<NonNullable<FounderPaymentPort['extendWindow']>>(async(_tx,_f,_o,w)=>{expect(w).toMatchObject({previousDeadline:'2026-10-30T14:00:00.000Z',messageId:x.mail.id,providerId:'synthetic_reviewed_offer'});return true;});x.port.extendWindow=extend;await x.owner({action:'extend',window:'payment',deadline:'2026-11-01T14:00:00Z'});expect(extend).toHaveBeenCalledTimes(1);expect(activation).toHaveBeenCalledTimes(1);
});
it('commits closure intent separately; an unsafe withdrawal cannot roll it back or release the founder allocation',async()=>{
 let closed=false;const marker=randomUUID(),close=vi.fn<NonNullable<FounderPaymentPort['requestClosure']>>(async(tx,f,input)=>{expect(input.operatorId).toBeDefined();await tx.query('INSERT INTO ls_service_interest.academy_founder_events(workspace_id,family_id,id,at,actor_id,payload_ciphertext) SELECT workspace_id,id,$2,$3,$4,$5 FROM ls_service_interest.academy_founder_families WHERE id=$1',[f.id,marker,now,input.operatorId,'SYNTHETIC_CLOSURE_INTENT_MARKER']);return true;});
 const x=await paymentScenario({requestClosure:close,reconcileAndClose:async()=>({safeToRelease:closed,paidChildIds:[],collectedCents:0,enrolledChildIds:[]})});await x.owner({action:'request_offer_closure'});expect((await x.current()).paused).toBe(true);expect((await x.current()).allocated).toBe(true);await expect(x.owner({action:'withdraw'})).rejects.toMatchObject({code:'CONFLICT'});expect((await db.query('SELECT id FROM ls_service_interest.academy_founder_events WHERE id=$1',[marker])).rows).toHaveLength(1);expect(close).toHaveBeenCalledTimes(1);expect(await x.founder.aggregate()).toMatchObject({remaining:29,capacity:30});closed=true;await x.owner({action:'withdraw'});expect((await x.current()).status).toBe('withdrawn');expect(await x.founder.aggregate()).toMatchObject({remaining:30,capacity:30});
});
it('continues sibling settlement/enrollment projection after redemption and rejects mismatched canonical child or money facts atomically',async()=>{
 let paid=1,enrolled=false,bad=false;const inspect:FounderPaymentPort['inspect']=async(_tx,f)=>({inFlight:false,paidChildIds:bad?[randomUUID()]:f.children.slice(0,paid).map(c=>c.id),collectedCents:paid===1?165000:320000,enrolledChildIds:enrolled?f.children.slice(0,paid).map(c=>c.id):[]});
 const x=await paymentScenario({inspect});await x.founder.reconcilePayment();let f=await x.current();expect(f.status).toBe('redeemed');expect(f.redeemedChildIds).toHaveLength(1);expect(f.enrolledChildIds).toHaveLength(0);paid=2;enrolled=true;await x.founder.reconcilePayment();f=await x.current();expect(f.redeemedChildIds).toHaveLength(2);expect(f.enrolledChildIds).toHaveLength(2);expect(f.collectedCents).toBe(320000);expect(await x.founder.aggregate()).toMatchObject({remaining:29,capacity:30});
 bad=true;await expect(x.founder.reconcilePayment()).rejects.toMatchObject({code:'UNAVAILABLE'});expect(await x.current()).toEqual(f);
 for(const projection of [{inFlight:false,paidChildIds:[],collectedCents:-1,enrolledChildIds:[]},{inFlight:false,paidChildIds:[],collectedCents:0,enrolledChildIds:[f.children[0]!.id]},{inFlight:false,paidChildIds:[f.children[0]!.id,f.children[0]!.id],collectedCents:330000,enrolledChildIds:[]}]){x.port.inspect=async()=>projection;await expect(x.founder.reconcilePayment()).rejects.toMatchObject({code:'UNAVAILABLE'});expect(await x.current()).toEqual(f);}
});

it('verified partial money permanently retains the allocation without pretending the child is paid or enrolled',async()=>{
 const x=await paymentScenario({inspect:async()=>({inFlight:false,paidChildIds:[],collectedCents:15000,enrolledChildIds:[]}),reconcileAndClose:async()=>({safeToRelease:true,paidChildIds:[],collectedCents:15000,enrolledChildIds:[]})});
 // Even a wrongly optimistic terminal-closure flag cannot release actual money.
 await expect(x.owner({action:'withdraw'})).rejects.toMatchObject({code:'CONFLICT'});await x.founder.reconcilePayment();const f=await x.current();expect(f).toMatchObject({status:'redeemed',everPaid:true,collectedCents:15000,redeemedChildIds:[],enrolledChildIds:[]});expect((await x.founder.ownerList(x.actor)).metrics).toMatchObject({paidFamilies:1,paidChildren:0,confirmedEnrollment:0});expect(await x.founder.aggregate()).toMatchObject({remaining:29,capacity:30});
 x.port.inspect=async()=>({inFlight:false,paidChildIds:[],collectedCents:0,enrolledChildIds:[]});await expect(x.founder.reconcilePayment()).rejects.toMatchObject({code:'UNAVAILABLE'});expect(await x.current()).toEqual(f);await expect(x.owner({action:'withdraw'})).rejects.toMatchObject({code:'CONFLICT'});
});

it('rolls back accepted registration and allocation when its adjacent transition cannot persist',async()=>{
 const x=await fixture(),c=command(),fault:IdentityStore={transaction:work=>store.transaction(tx=>work({query:(sql,values)=>{if(sql.startsWith('INSERT INTO ls_service_interest.academy_founder_events')&&sql.includes('transition_from'))throw Error('SYNTHETIC_TRANSITION_ROLLBACK');return tx.query(sql,values);}}))},founder=new AcademyFounderStore(fault,x.workspace,ring,key,clock),apps=new PublicGroupApplicationStore(fault,x.workspace,ring,key,clock,false,founder);
 await expect(apps.submit(c,opaqueToken())).rejects.toThrow('SYNTHETIC_TRANSITION_ROLLBACK');expect(await x.applications.replaySaved(c)).toBeNull();expect(await x.founder.aggregate()).toMatchObject({remaining:30,capacity:30});expect((await db.query('SELECT id FROM ls_service_interest.academy_founder_events WHERE workspace_id=$1',[x.workspace])).rows).toEqual([]);
});

it('records reviewed matching SENT provenance but never turns a controlled adapter result into authority',async()=>{
 const x=await paymentScenario(),journal=new AcademyFounderTransitionStore(store,x.workspace,ring,key,clock),anchor={familyId:x.f.id,fromRevision:x.f.revision,fromSha256:journal.stateHash(x.f)};
 await x.founder.dispatchOne(x.mail.id,{send:async()=>{throw Error('SYNTHETIC_UNKNOWN');}},INQUIRY_EMAIL_FROM,origin);await x.owner({action:'delivery_review',messageId:x.mail.id,outcome:'sent',sentAt:now.toISOString(),providerId:'SYNTHETIC_REVIEWED'});const read=await journal.read(x.actor,anchor);
 expect(read).toMatchObject({shape:'other',authority:false,activationAdmitted:false});expect(read.transitions.map(t=>t.purpose.kind)).toEqual(['other','offer_email_sent']);
 await expect(db.query('INSERT INTO ls_service_interest.academy_founder_events(workspace_id,family_id,id,at,payload_ciphertext,transition_from) VALUES($1,$2,$3,$4,$5,1)',[x.workspace,x.f.id,randomUUID(),now,'SYNTHETIC_INVALID_PARTIAL_HEADER'])).rejects.toThrow(/check|constraint/i);
 await expect(db.query('UPDATE ls_service_interest.academy_founder_events SET transition_to=NULL WHERE workspace_id=$1 AND family_id=$2',[x.workspace,x.f.id])).rejects.toThrow('public_group_application_append_only');
});

it('commits exact last-slot phase atomically, preserves immutable first fill after vacancy and keeps stale forms ordinary',async()=>{
 const x=await fixture();for(let i=0;i<29;i++)await x.applications.submit(command(),opaqueToken());
 const both=await Promise.all([x.applications.submit(command(),opaqueToken()),x.applications.submit(command(),opaqueToken())]);const winner=both.find(b=>b.founder?.status==='reserved')!,loser=both.find(b=>b.founder?.status==='regular_registration')!;
 const filled=await x.founder.aggregate();expect(filled).toMatchObject({phase:'REGULAR_REGISTRATION',remaining:0,occupied:30,revision:30,firstFilledAt:now.toISOString(),reopeningPolicy:'PROPOSED_STICKY_REGULAR_PENDING_OWNER_CONFIRMATION'});
 for(const reference of [loser.item.id,winner.item.id]){const f=(await x.founder.ownerList(x.actor)).families.find(f=>f.reference===reference)!;await x.founder.execute(x.actor,{action:'withdraw',familyId:f.id,expectedRevision:f.revision,operationId:randomUUID(),reason:'Synthetic unused allocation withdrawal'});}
 expect(await x.founder.aggregate()).toMatchObject({phase:'REGULAR_REGISTRATION',remaining:1,occupied:29,firstFilledAt:filled.firstFilledAt});const saved=await x.applications.submit(command(),opaqueToken());expect(saved.founder).toMatchObject({status:'regular_registration',initialStatus:'regular_registration'});await x.founder.tick();expect((await x.founder.aggregate()).occupied).toBe(30); // private FIFO promotion, never public reopening
 await expect(db.query('UPDATE ls_service_interest.academy_campaigns SET revision=revision+1,first_filled_at=NULL WHERE workspace_id=$1',[x.workspace])).rejects.toThrow();
},25000);
it('binds immutable campaign attribution across exact retry and family/language continuation without changing field hashes',async()=>{
 const x=await fixture(),c=command(),continuation=opaqueToken(),touch={campaign:ACADEMY_CAMPAIGN,source:'facebook' as const,medium:'social' as const,content:PREREG_CREATIVE.id} as const,a:CampaignAttribution={first:touch,last:touch};const first=await x.applications.submit(c,continuation,a);expect((await x.applications.submit(c,continuation,a)).item).toEqual(first.item);
 const changed:CampaignAttribution={first:touch,last:{...touch,source:'whatsapp',medium:'message'}};await expect(x.applications.submit(c,continuation,changed)).rejects.toMatchObject({code:'CONFLICT'});await expect(x.applications.replaySaved(c,changed)).rejects.toMatchObject({code:'CONFLICT'});
 const amendment=command(c.fields.academyRegistration.receiptEmail);amendment.fields.parentName=c.fields.parentName;await x.applications.submit(amendment,continuation,changed);const data=await x.founder.ownerList(x.actor);expect(data.metrics.uniqueFamilies).toBe(1);expect(data.attribution).toMatchObject({attributedUniqueFamilies:1,attributedAllocatedFamilies:1,byFirstSource:{facebook:1,whatsapp:0},byLastSource:{facebook:0,whatsapp:1}});const collision=command(c.fields.academyRegistration.receiptEmail);await x.applications.submit(collision,opaqueToken(),a);const unresolved=await x.founder.ownerList(x.actor);expect(unresolved.metrics).toMatchObject({uniqueFamilies:1,unresolvedIdentityRecords:1});expect(unresolved.attribution).toMatchObject({attributedUniqueFamilies:1,unresolvedAttributedRecords:1});
 await expect(db.query('DELETE FROM ls_service_interest.academy_campaign_touches WHERE workspace_id=$1',[x.workspace])).rejects.toThrow();
});
it('source-bound bilingual caption preparation preserves locale and unapproved provenance through allocation refresh',async()=>{
 const {academyOrganicCaptions,academyOrganicSource}=await import('../../src/features/group-application/academy-organic-captions.ts');
 const x=await fixture(),caption=academyOrganicCaptions('he')[0]!,c={action:'prepare_share' as const,operationId:randomUUID(),placement:'facebook_feed' as const,language:'he' as const,captionId:caption.id,captionVersion:caption.version,captionSha256:caption.sha256};
 for(const bad of [{...c,language:'en' as const},{...c,captionVersion:2},{...c,captionSha256:'0'.repeat(64)}])await expect(x.founder.campaignExecute(x.actor,bad)).rejects.toMatchObject({code:'CONFLICT'});
 const p=await x.founder.campaignExecute(x.actor,c);expect(p).toMatchObject({language:'he',captionApproval:'UNVERIFIED_EXISTING_COPY_WORKFLOW_REQUIRED',captionSource:{fileId:academyOrganicSource.sourceFileId,bankRevision:academyOrganicSource.bankRevision,bankSha256:academyOrganicSource.bankSha256}});expect(new URL(p.targetUrl).pathname).toBe('/he/fishing-academy');expect(new URL(p.targetUrl).origin).toBe('https://bneineviimacademy.org');
 await x.applications.submit(command(),opaqueToken());let shares=(await x.founder.ownerList(x.actor)).shares;expect(shares).toHaveLength(1);expect(shares[0]).toMatchObject({id:p.id,language:'he',snapshot:{occupied:1}});
 await x.founder.campaignExecute(x.actor,{action:'withdraw_share',operationId:randomUUID(),shareId:p.id,reason:'Synthetic owner withdraws draft'});await x.applications.submit(command(),opaqueToken());shares=(await x.founder.ownerList(x.actor)).shares;expect(shares).toHaveLength(1);expect(shares[0]!.status).toBe('withdrawn');
});
it.each(['target','creative','source'] as const)('fresh copy rejects stale %s and manual history retains warnings',async(kind)=>{
 const {academyOrganicCaptions}=await import('../../src/features/group-application/academy-organic-captions.ts');
 const x=await fixture(),caption=academyOrganicCaptions('en')[0]!,p=await x.founder.campaignExecute(x.actor,{action:'prepare_share',operationId:randomUUID(),placement:'facebook_feed',language:'en',captionId:caption.id,captionVersion:1,captionSha256:caption.sha256});
 const copy={action:'copy_share' as const,operationId:randomUUID(),shareId:p.id,reason:'Synthetic original copy'},copied=await x.founder.campaignExecute(x.actor,copy);
 const changed={...copied,creative:{...copied.creative},captionSource:{...copied.captionSource!}};
 if(kind==='target')changed.targetUrl='https://life-skills.bneineviimacademy.org/en/florida';
 if(kind==='creative')Object.assign(changed.creative,{path:'/obsolete.png'});
 if(kind==='source')changed.captionSource.bankRevision='old-source-revision';
 await db.query('UPDATE ls_service_interest.academy_campaign_shares SET payload_ciphertext=$3 WHERE workspace_id=$1 AND id=$2',[x.workspace,p.id,seal(JSON.stringify(changed),`academy/campaign/v1/${x.workspace}/${p.id}`,ring)]);
 expect(await x.founder.campaignExecute(x.actor,copy)).toEqual(copied);
 for(const action of ['copy_share','export_share'] as const)await expect(x.founder.campaignExecute(x.actor,{...copy,operationId:randomUUID(),action})).rejects.toMatchObject({code:'CONFLICT'});
 const recorded=await x.founder.campaignExecute(x.actor,{action:'confirm_manual_publication',operationId:randomUUID(),shareId:p.id,reason:'Synthetic historical manual publication only',publishedAt:now.toISOString()});
 expect(recorded).toMatchObject({needsReview:true,status:'manual_confirmed_published',captionApproval:'UNVERIFIED_EXISTING_COPY_WORKFLOW_REQUIRED'});
 const owner=await x.founder.ownerList(x.actor);expect(owner.organicCaptionReview.captions).toHaveLength(40);expect(JSON.stringify(await x.founder.aggregate())).not.toContain(caption.text);
 const other=await fixture();await expect(x.founder.ownerList(other.actor)).rejects.toMatchObject({code:'FORBIDDEN'});
});
it('coalesces unposted campaign shares, supersedes at first fill, distinguishes copying from manual publication and records stale historical posts honestly',async()=>{
 const x=await fixture(),prepare=()=>x.founder.campaignExecute(x.actor,{action:'prepare_share',operationId:randomUUID(),placement:'facebook_feed',language:'en',captionId:'synthetic-reviewed-caption',captionVersion:1,captionSha256:'a'.repeat(64)});
 const one=await prepare(),two=await prepare();expect((await x.founder.ownerList(x.actor)).shares.find(p=>p.id===one.id)?.status).toBe('superseded');const copy={action:'copy_share' as const,operationId:randomUUID(),shareId:two.id,reason:'Synthetic copied asset reference'};expect((await x.founder.campaignExecute(x.actor,copy)).status).toBe('copied');expect((await x.founder.campaignExecute(x.actor,copy)).history).toHaveLength(2);
 for(let i=0;i<30;i++)await x.applications.submit(command(),opaqueToken());expect((await x.founder.ownerList(x.actor)).shares.find(p=>p.id===two.id)?.status).toBe('superseded');await expect(x.founder.campaignExecute(x.actor,{...copy,operationId:randomUUID()})).rejects.toMatchObject({code:'CONFLICT'});await expect(prepare()).rejects.toMatchObject({code:'UNAVAILABLE'});
 const posted=await x.founder.campaignExecute(x.actor,{action:'confirm_manual_publication',operationId:randomUUID(),shareId:two.id,reason:'Synthetic owner confirms earlier manual publication',publishedAt:now.toISOString(),postUrl:'https://www.facebook.com/synthetic/posts/1'});expect(posted).toMatchObject({status:'manual_confirmed_published',needsReview:true,captionApproval:'UNVERIFIED_EXISTING_COPY_WORKFLOW_REQUIRED'});expect(JSON.stringify(posted)).not.toContain('provider_confirmed');
},25000);
it('refreshes one bound evergreen preparation per allocation without new owner approval, stale copied records or withdrawn-template resurrection',async()=>{
 const x=await fixture();await x.applications.submit(command(),opaqueToken());expect((await x.founder.ownerList(x.actor)).shares).toEqual([]);
 const prepare=(captionVersion=1)=>x.founder.campaignExecute(x.actor,{action:'prepare_share',operationId:randomUUID(),placement:'facebook_feed',language:'en',captionId:'synthetic-caption',captionVersion,captionSha256:'a'.repeat(64)});
 const first=await prepare();await x.applications.submit(command(),opaqueToken());let shares=(await x.founder.ownerList(x.actor)).shares;
 expect(shares).toHaveLength(1);expect(shares[0]).toMatchObject({id:first.id,status:'prepared',snapshot:{occupied:2,revision:2},captionApproval:'UNVERIFIED_EXISTING_COPY_WORKFLOW_REQUIRED'});expect(shares[0]!.history.at(-1)).toMatchObject({action:'allocation_preparation_refreshed',actor:'system:campaign-allocation',fromRevision:1,toRevision:2});
 await x.founder.campaignExecute(x.actor,{action:'copy_share',operationId:randomUUID(),shareId:first.id,reason:'Synthetic copy only'});await x.applications.submit(command(),opaqueToken());shares=(await x.founder.ownerList(x.actor)).shares;
 const next=shares.find(p=>p.status==='prepared')!;expect(next.id).not.toBe(first.id);expect(next).toMatchObject({captionVersion:1,snapshot:{occupied:3}});expect(next.publication).toBeUndefined();expect(shares.find(p=>p.id===first.id)?.status).toBe('superseded');
 await x.founder.campaignExecute(x.actor,{action:'withdraw_share',operationId:randomUUID(),shareId:next.id,reason:'Synthetic preparation withdrawn'});await x.applications.submit(command(),opaqueToken());expect((await x.founder.ownerList(x.actor)).shares.filter(p=>p.status==='prepared')).toEqual([]);
 const replacement=await prepare(2);await Promise.all([x.applications.submit(command(),opaqueToken()),x.applications.submit(command(),opaqueToken())]);shares=(await x.founder.ownerList(x.actor)).shares;expect(shares.filter(p=>p.status==='prepared')).toHaveLength(1);expect(shares.find(p=>p.id===replacement.id)).toMatchObject({captionVersion:2,snapshot:{occupied:6,revision:6}});
});
it('records actual earlier manual publication separately from server verification and preserves immutable retry evidence',async()=>{
 const x=await fixture(),before=now;
 try{
  const prepared=await x.founder.campaignExecute(x.actor,{action:'prepare_share',operationId:randomUUID(),placement:'facebook_feed',language:'en',captionId:'synthetic-caption',captionVersion:1,captionSha256:'a'.repeat(64)});
  const publishedAt=new Date(now.getTime()+60_000).toISOString();now=new Date(now.getTime()+120_000);
  const c={action:'confirm_manual_publication' as const,operationId:randomUUID(),shareId:prepared.id,reason:'Synthetic explicit late owner confirmation',publishedAt};
  const result=await x.founder.campaignExecute(x.actor,c);expect(result.publication).toEqual({method:'OWNER_MANUAL_CONFIRMATION',publishedAt,recordedAt:now.toISOString(),lastVerifiedAt:now.toISOString(),actor:x.actor.id,evidence:c.reason});
  now=new Date(now.getTime()+120_000);expect(await x.founder.campaignExecute(x.actor,c)).toEqual(result);
  await expect(x.founder.campaignExecute(x.actor,{...c,operationId:randomUUID()})).rejects.toMatchObject({code:'CONFLICT'});
  await x.applications.submit(command(),opaqueToken());const shares=(await x.founder.ownerList(x.actor)).shares;expect(shares.find(p=>p.id===prepared.id)?.publication).toEqual(result.publication);expect(shares.filter(p=>p.status==='prepared')).toHaveLength(1);const derived=shares.find(p=>p.status==='prepared')!;expect(derived.publication).toBeUndefined();
  await x.founder.campaignExecute(x.actor,{action:'withdraw_share',operationId:randomUUID(),shareId:prepared.id,reason:'Synthetic stop template reuse, not external post deletion'});
  for(const action of ['copy_share','export_share'] as const)await expect(x.founder.campaignExecute(x.actor,{action,operationId:randomUUID(),shareId:derived.id,reason:'Synthetic stale derived action denied'})).rejects.toMatchObject({code:'CONFLICT'});
  const withdrawn=(await x.founder.ownerList(x.actor)).shares;expect(withdrawn.find(p=>p.id===prepared.id)).toMatchObject({status:'manual_confirmed_published',publication:result.publication,templateSuperseded:true});expect(withdrawn.find(p=>p.id===derived.id)?.status).toBe('superseded');
  const second=await x.founder.campaignExecute(x.actor,{action:'prepare_share',operationId:randomUUID(),placement:'whatsapp_status',language:'en',captionId:'synthetic-caption',captionVersion:1,captionSha256:'a'.repeat(64)});
  for(const bad of [new Date(now.getTime()+60_000).toISOString(),before.toISOString()])await expect(x.founder.campaignExecute(x.actor,{...c,shareId:second.id,operationId:randomUUID(),publishedAt:bad})).rejects.toMatchObject({code:'INVALID_REQUEST'});
 }finally{now=before;}
});
it('plans one daily family payment reminder from authoritative unpaid sibling lines, rechecks balances before send and skips missed dates',async()=>{
 const paid=new Set<string>();let money=0;
 const port:FounderPaymentPort={activateWindow:async()=>true,inspect:async()=>({inFlight:false,paidChildIds:[...paid],collectedCents:money,enrolledChildIds:[]}),approve:async(_tx,_actor,f,input)=>({id:randomUUID(),group:'Synthetic group',groupId:input.groupId,firstSession:input.firstSession,paymentUrl:origin+'/synthetic-payment',terms:'Synthetic terms',priceVersion:'synthetic-v1',children:input.expectedAmounts.map(c=>({...c,name:f.children.find(k=>k.id===c.id)!.name}))}),reconcileAndClose:async()=>({safeToRelease:false,paidChildIds:[...paid],collectedCents:money,enrolledChildIds:[]}),reminderProjection:async(_tx,f)=>({version:'jlfa-unpaid-lines-v1',familyId:f.id,offerId:f.offer!.id,generation:f.payment.generation,lines:f.children.map(c=>({childId:c.id,offerId:f.offer!.id,revision:1,currency:'USD',unpaidCents:paid.has(c.id)?0:12345,state:paid.has(c.id)?'paid':'active',sentAt:f.payment.sentAt,deadline:f.payment.deadline}))})};
 const native:FounderNativeFamilyPort={read:async(_tx,actor,f,source)=>({source,householdId:randomUUID(),parentAccountId:randomUUID(),verifiedBy:actor.id,verifiedAt:now.toISOString(),children:f.children.map(c=>({registrationChildId:c.id,learnerId:randomUUID()}))})};
 // Bind once; keep identity stable for the mandatory current-owner recheck.
 let binding:Awaited<ReturnType<FounderNativeFamilyPort['read']>>|undefined;const stable:FounderNativeFamilyPort={read:async(...args)=>binding??(binding=await native.read(...args))};const x=await fixture(port,stable),c=command();c.fields.academyRegistration.learners.push({...c.fields.academyRegistration.learners[0]!,id:randomUUID(),fullName:'Synthetic sibling'});await x.applications.submit(c,opaqueToken());const initial=(await messages(x.workspace))[0]!;await x.founder.dispatchOne(initial.id,{send:async()=>({providerId:'synthetic_interest'})},INQUIRY_EMAIL_FROM,origin);await x.founder.confirm(await token(x.workspace,initial.id));let f=(await x.founder.ownerList(x.actor)).families[0]!;
 const owner=async(action:Record<string,unknown>)=>{await x.founder.execute(x.actor,{operationId:randomUUID(),familyId:f.id,expectedRevision:f.revision,reason:'Synthetic current owner evidence',...action} as Parameters<AcademyFounderStore['execute']>[1]);f=(await x.founder.ownerList(x.actor)).families[0]!;};await owner({action:'bind_native_family',binding:{applicationId:f.reference,personId:randomUUID(),expectedEpoch:1,expectedAssociationVersion:1,expectedFieldsDigest:'a'.repeat(64),expectedFamilyDigest:'b'.repeat(64)}});await owner({action:'approve_offer',groupId:randomUUID(),firstSession:'2026-12-01T15:00:00Z',plan:'prepay'});const offer=(await messages(x.workspace)).find(m=>m.purpose==='academy_founder_offer')!;await x.founder.dispatchOne(offer.id,{send:async()=>({providerId:'synthetic_offer'})},INQUIRY_EMAIL_FROM,origin);
 paid.add(f.children[0]!.id);money=307655;await x.founder.tick();expect((await messages(x.workspace)).filter(m=>m.purpose==='academy_founder_payment_reminder')).toHaveLength(0);now=new Date('2026-10-24T13:59:00Z');await x.founder.tick();expect((await messages(x.workspace)).filter(m=>m.purpose==='academy_founder_payment_reminder')).toHaveLength(0);now=new Date('2026-10-24T14:00:00Z');await x.founder.tick();await x.founder.tick();let reminders=(await messages(x.workspace)).filter(m=>m.purpose==='academy_founder_payment_reminder');expect(reminders).toHaveLength(1);let text='';await x.founder.dispatchOne(reminders[0]!.id,{send:async p=>{text=p.text;return {providerId:'synthetic_daily'};}},INQUIRY_EMAIL_FROM,origin);expect(text).toContain('Synthetic sibling: $123.45');expect(text).not.toContain('Synthetic Child: $');
 now=new Date('2026-10-27T14:00:00Z');await x.founder.tick();reminders=(await messages(x.workspace)).filter(m=>m.purpose==='academy_founder_payment_reminder');expect(reminders).toHaveLength(2);paid.add(f.children[1]!.id);money=320000;const send=vi.fn(async()=>({providerId:'must_not_send'}));await x.founder.dispatchOne(reminders.find(m=>m.state==='queued')!.id,{send},INQUIRY_EMAIL_FROM,origin);expect(send).not.toHaveBeenCalled();expect((await x.founder.ownerList(x.actor)).families[0]?.allocated).toBe(true);now=new Date('2026-10-23T14:00:00Z');
});


it.each(['sent','unknown','read_failed'] as const)('public signup returns durable post-send state, preserves saved inquiry and safely replays (%s)',async(outcome)=>{
 const x=await fixture(),c=command(),continuation=opaqueToken(),baseTime=now.getTime();
 const send=vi.fn(async()=>{if(outcome==='unknown')throw Error('ambiguous provider');return {providerId:'synthetic_'+randomUUID()};});
 const request=()=>new Request(origin+'/api/public/group-applications?program=sunday_fishing_academy',{method:'POST',headers:{origin,host:new URL(origin).host,'sec-fetch-site':'same-origin','content-type':'application/json',cookie:'ls_academy_registration='+continuation},body:JSON.stringify({...c,website:'',challenge:issueFloridaGroupApplicationChallenge(key,'sunday_fishing_academy',baseTime-3000)})});
 const deps=async()=>({enabled:true,environment:{NODE_ENV:'production',LS_APP_ORIGIN:origin},challengeKey:key,now:()=>baseTime,limits:{consume:async()=>({count:1,retryAfterMs:1000})},store:x.applications,
  afterCommit:async(reference:string)=>{await x.founder.dispatchForApplication(reference,{send},INQUIRY_EMAIL_FROM,origin);return 'not_requested' as const;},
  refreshFounder:async(reference:string)=>{if(outcome==='read_failed')throw Error('read temporarily unavailable');return store.transaction(tx=>x.founder.publicResult(tx,reference));}});
 const response=await publicGroupApplicationHttp(request(),deps);expect(response.status).toBe(201);const body=await response.json();
 expect(body).toMatchObject({ok:true,data:{saved:true,founder:{email:outcome==='sent'?'sent':'unknown'}}});
 const read=await x.founder.ownerList(x.actor);expect(read.families).toHaveLength(1);expect(read.metrics.children).toBe(1);
 expect(body.data.founder.deadline).toBe(outcome==='sent'?read.families[0]!.interest.deadline:null);
 expect(read.families[0]!.interest.deadline).toBeNull();
 const sends=send.mock.calls.length;expect(sends).toBe(1);
 const retry=await publicGroupApplicationHttp(request(),deps);expect(retry.status).toBe(200);expect((await retry.json()).data).toMatchObject({saved:true,replayed:true,founder:{email:outcome==='sent'?'sent':'unknown'}});
 expect(send).toHaveBeenCalledTimes(sends);expect((await x.founder.aggregate()).occupied).toBe(1);
});

it('signup-only dispatch leaves held payment messages unchanged even without a payment adapter',async()=>{
 const x=await fixture();await x.applications.submit(command(),opaqueToken());const initial=(await messages(x.workspace))[0]!;
 const payload=JSON.parse(unseal(initial.payload_ciphertext,`ls_service_interest/inquiry_email/v1/${x.workspace}/${initial.id}`,ring));
 for(const kind of ['offer','payment_reminder','payment_deadline_receipt']){
  const id=randomUUID(),sealed=seal(JSON.stringify({...payload,kind}),`ls_service_interest/inquiry_email/v1/${x.workspace}/${id}`,ring);
  await db.query("INSERT INTO ls_service_interest.inquiry_email_outbox(workspace_id,id,application_id,founder_id,purpose,message_key,payload_ciphertext,state,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,'queued',$8)",[x.workspace,id,initial.application_id,initial.founder_id,'academy_founder_'+kind,'held:'+kind,sealed,now]);
 }
 const heldBefore=(await messages(x.workspace)).filter(m=>['academy_founder_offer','academy_founder_payment_reminder','academy_founder_payment_deadline_receipt'].includes(m.purpose));
 const send=vi.fn(async()=>({providerId:'synthetic_'+randomUUID()}));
 for(const m of heldBefore)expect(await x.founder.dispatchOne(m.id,{send},INQUIRY_EMAIL_FROM,origin,'signup')).toBe('idle');
 expect(send).not.toHaveBeenCalled();
 await x.founder.dispatchQueued({send},INQUIRY_EMAIL_FROM,origin,'signup');
 expect(send).toHaveBeenCalledTimes(1);
 expect((await messages(x.workspace)).filter(m=>heldBefore.some(b=>b.id===m.id))).toEqual(heldBefore);
});

it.each(['accepted','unknown'] as const)('signup ACK %s after concurrent offer preserves financial family and held payment rows',async(outcome)=>{
 let release!:()=>void,started!:()=>void,ackId='',pending!:Promise<string>;
 const sentStarted=new Promise<void>(resolve=>{started=resolve;}),held=new Promise<void>(resolve=>{release=resolve;});
 const x=await paymentScenario({},async family=>{
  const ack=(await messages(family.workspace)).find(m=>m.purpose==='academy_founder_ack'&&m.state==='queued')!;ackId=ack.id;
  pending=family.founder.dispatchOne(ack.id,{send:async()=>{started();await held;if(outcome==='unknown')throw Error('Synthetic ambiguous transport');return {providerId:'synthetic_delayed_ack'};}},INQUIRY_EMAIL_FROM,origin,'signup');
  await sentStarted;
 });
 const beforeFamily=(await db.query('SELECT * FROM ls_service_interest.academy_founder_families WHERE workspace_id=$1',[x.workspace])).rows;
 const beforePayment=(await messages(x.workspace)).filter(m=>m.purpose==='academy_founder_offer');expect(beforePayment).toHaveLength(1);expect(beforePayment[0]!.state).toBe('queued');
 release();expect(await pending).toBe(outcome==='accepted'?'sent':'unknown');
 expect((await messages(x.workspace)).find(m=>m.id===ackId)?.state).toBe(outcome==='accepted'?'sent':'unknown');
 expect((await db.query('SELECT * FROM ls_service_interest.academy_founder_families WHERE workspace_id=$1',[x.workspace])).rows).toEqual(beforeFamily);
 expect((await messages(x.workspace)).filter(m=>m.purpose==='academy_founder_offer')).toEqual(beforePayment);
});

it('signup-only tick preserves an offered family and every payment queue row',async()=>{
 const x=await paymentScenario();
 const beforeFamily=(await db.query('SELECT * FROM ls_service_interest.academy_founder_families WHERE workspace_id=$1',[x.workspace])).rows,beforeMessages=await messages(x.workspace);
 await new AcademyFounderStore(store,x.workspace,ring,key,clock).tick(undefined,undefined,'signup');
 expect((await db.query('SELECT * FROM ls_service_interest.academy_founder_families WHERE workspace_id=$1',[x.workspace])).rows).toEqual(beforeFamily);
 expect(await messages(x.workspace)).toEqual(beforeMessages);
});

it('returns exact synthetic signup drafts only after current owner authorization without queuing or changing family records',async()=>{
 const x=await fixture(),other=await fixture(),c=command();await x.applications.submit(c,opaqueToken());
 const beforeMessages=await messages(x.workspace),beforeFamily=(await db.query('SELECT * FROM ls_service_interest.academy_founder_families WHERE workspace_id=$1',[x.workspace])).rows;
 const first=await x.founder.ownerList(x.actor),second=await x.founder.ownerList(x.actor);
 expect(first.signupEmailReview).toEqual(signupEmailReview());expect(second.signupEmailReview).toEqual(first.signupEmailReview);
 const drafts=JSON.stringify(first.signupEmailReview);expect(drafts).not.toContain(c.fields.academyRegistration.receiptEmail);expect(drafts).not.toContain(c.fields.parentName);expect(drafts).not.toContain(await token(x.workspace,beforeMessages[0]!.id));
 expect(await messages(x.workspace)).toEqual(beforeMessages);expect((await db.query('SELECT * FROM ls_service_interest.academy_founder_families WHERE workspace_id=$1',[x.workspace])).rows).toEqual(beforeFamily);
 await expect(x.founder.ownerList(other.actor)).rejects.toMatchObject({code:'FORBIDDEN'});
 await db.query("UPDATE ls_identity.accounts SET role='parent' WHERE id=$1 AND workspace_id=$2",[x.actor.id,x.workspace]);
 await expect(x.founder.ownerList(x.actor)).rejects.toMatchObject({code:'FORBIDDEN'});
 const revoked=await fixture();await db.query('DELETE FROM ls_identity.sessions WHERE workspace_id=$1',[revoked.workspace]);await expect(revoked.founder.ownerList(revoked.actor)).rejects.toThrow();
});


it('captures optional communication choices only from accepted immutable application, preserving legacy absence',async()=>{
 const x=await fixture(),legacy=command();await x.applications.submit(legacy,opaqueToken());const before=(await x.founder.ownerList(x.actor)).families[0]!;
 expect(before).not.toHaveProperty('communicationPreferences');expect(communicationPreferenceReadback(before.communicationPreferences)).toMatchObject({parentLanguage:null,nurtureEmail:'unknown',privateWapi:'unknown'});
 const c=command();c.fields.academyRegistration.communicationPreferences=communicationPreferenceSelection('he',false,true,'en');const saved=await x.applications.submit(c,opaqueToken());
 const f=(await x.founder.ownerList(x.actor)).families.find(row=>row.reference===saved.item.id)!;expect(f.locale).toBe('en');expect(f.communicationPreferences).toMatchObject({applicationId:saved.item.id,revision:1,recordedAt:now.toISOString(),source:'completed_parent_registration',selection:{parentLanguage:'he',nurtureEmail:false,privateWapi:true}});
 expect((await messages(x.workspace)).map(row=>row.purpose)).toEqual(['academy_founder_interest','academy_founder_interest']);expect(f.payment.sentAt).toBeNull();
});
it('choice changes conflict on same operation, exact retries do not duplicate, continuation records a new preference without changing old application',async()=>{
 const x=await fixture(),c=command(),continuation=opaqueToken();c.fields.academyRegistration.communicationPreferences=communicationPreferenceSelection('he',true,false,'en');const saved=await x.applications.submit(c,continuation);
 const changed=structuredClone(c);changed.fields.academyRegistration.communicationPreferences!.privateWapi=true;await expect(x.applications.submit(changed,continuation)).rejects.toMatchObject({code:'CONFLICT'});expect((await x.applications.submit(c,continuation)).item.id).toBe(saved.item.id);
 const later=structuredClone(c);later.operationId=randomUUID();later.fields.academyRegistration.communicationPreferences=communicationPreferenceSelection('en',false,false,'en');const amended=await x.applications.submit(later,continuation);
 const f=(await x.founder.ownerList(x.actor)).families[0]!;expect(f.communicationPreferences).toMatchObject({applicationId:amended.item.id,revision:2,selection:{parentLanguage:'en',nurtureEmail:false,privateWapi:false}});expect(await x.applications.list(x.actor)).toContainEqual(saved.item);expect((await messages(x.workspace))).toHaveLength(1);expect((await x.founder.ownerList(x.actor)).metrics.uniqueFamilies).toBe(1);
});
it('a later legacy continuation never fabricates or silently revokes recorded optional choices',async()=>{
 const x=await fixture(),c=command(),continuation=opaqueToken();c.fields.academyRegistration.communicationPreferences=communicationPreferenceSelection('he',true,false,'en');await x.applications.submit(c,continuation);const before=(await x.founder.ownerList(x.actor)).families[0]!.communicationPreferences;
 const later=structuredClone(c);later.operationId=randomUUID();delete later.fields.academyRegistration.communicationPreferences;await x.applications.submit(later,continuation);expect((await x.founder.ownerList(x.actor)).families[0]!.communicationPreferences).toEqual(before);
});


it.each(['queued','unknown','sent'])('preference continuation preserves %s outbox ciphertext bytes and prepared language',async state=>{
 const x=await fixture(),c=command(),continuation=opaqueToken();c.fields.academyRegistration.communicationPreferences=communicationPreferenceSelection('he',true,false,'en');await x.applications.submit(c,continuation);const row=(await messages(x.workspace))[0]!;
 if(state!=='queued')await db.query("UPDATE ls_service_interest.inquiry_email_outbox SET state=$3,reserved_at=$4,completed_at=$5,provider_id=$6 WHERE workspace_id=$1 AND id=$2",[x.workspace,row.id,state,now,state==='sent'?now:null,state==='sent'?'synthetic-prepared-receipt':null]);
 const columns='id,state,payload_ciphertext,reserved_at,completed_at,provider_id';const before=(await db.query(`SELECT ${columns} FROM ls_service_interest.inquiry_email_outbox WHERE workspace_id=$1 AND id=$2`,[x.workspace,row.id])).rows;
 expect(JSON.parse(unseal(row.payload_ciphertext,`ls_service_interest/inquiry_email/v1/${x.workspace}/${row.id}`,ring)).locale).toBe('he');
 const amended=structuredClone(c);amended.operationId=randomUUID();amended.fields.academyRegistration.communicationPreferences=communicationPreferenceSelection('en',false,false,'en');await x.applications.submit(amended,continuation);
 expect((await db.query(`SELECT ${columns} FROM ls_service_interest.inquiry_email_outbox WHERE workspace_id=$1 AND id=$2`,[x.workspace,row.id])).rows).toEqual(before);expect((await x.founder.ownerList(x.actor)).families[0]!.communicationPreferences?.selection.parentLanguage).toBe('en');expect((await messages(x.workspace))).toHaveLength(1);
});
it('future transactional messages adopt explicit parent language while an already prepared interest email stays version locked',async()=>{
 const x=await fixture(),c=command(),continuation=opaqueToken();c.fields.academyRegistration.communicationPreferences=communicationPreferenceSelection('he',false,false,'en');await x.applications.submit(c,continuation);const m=(await messages(x.workspace))[0]!,secret=await token(x.workspace,m.id),prepared=m.payload_ciphertext;
 const amended=structuredClone(c);amended.operationId=randomUUID();amended.fields.academyRegistration.communicationPreferences=communicationPreferenceSelection('en',false,false,'en');await x.applications.submit(amended,continuation);
 const fakeSend=vi.fn(async(mail:{text:string})=>{expect(mail.text).toContain('אישור ההתעניינות שלי');return {providerId:'synthetic-new-language-test'};});await x.founder.dispatchOne(m.id,{send:fakeSend},INQUIRY_EMAIL_FROM,origin);expect(fakeSend).toHaveBeenCalledTimes(1);await x.founder.confirm(secret);
 const rows=await messages(x.workspace);expect(rows.find(row=>row.id===m.id)!.payload_ciphertext).toBe(prepared);const ack=rows.find(row=>row.purpose==='academy_founder_ack')!;expect(JSON.parse(unseal(ack.payload_ciphertext,`ls_service_interest/inquiry_email/v1/${x.workspace}/${ack.id}`,ring)).locale).toBe('en');expect(rows.some(row=>row.purpose.includes('nurture')||row.purpose.includes('wapi'))).toBe(false);
});

// Proposed v2 population regressions. Synthetic PGlite ONLY, not executed during
// this outside-Git preparation. Original 6681de66 cases above remain byte-identical.
import {createSignupWorkerAdmission,signupRecipientDigest} from '../../src/features/group-application/academy-signup-worker-admission.ts';
import {dispatchAdmittedSignupCallback} from '../../src/features/group-application/academy-signup-population-runtime.ts';
const v2Origin='https://bneineviimacademy.org',v2Cutoff='2026-10-23T14:00:00.000Z';
async function v2Policy(workspace:string,refs?:{reference:string;email:string}[]){
 const {createHash}=await import('node:crypto'),sha=async(path:string)=>createHash('sha256').update(await readFile(path)).digest('hex');
 const bindings={templateModuleSha256:await sha('src/features/group-application/academy-founder-email.ts'),templateContractSha256:await sha('src/features/group-application/academy-founder-contract.ts'),templateCatalogSha256:await sha('src/features/group-application/academy-exact-email-copy.json'),templateFacadeSha256:await sha('src/features/group-application/academy-exact-copy.ts'),transportHashes:{gmail:await sha('src/providers/email/gmail.ts'),contract:await sha('src/providers/email/transport.ts'),resend:await sha('src/providers/email/resend.ts')}};
 const targets={workspaceId:workspace,projectId:'22222222-2222-4222-8222-222222222222',environmentId:'33333333-3333-4333-8333-333333333333',serviceId:'44444444-4444-4444-8444-444444444444'};
 const context={...targets,...bindings,enabled:true,freeEnabled:true,sendEnabled:true,founderApproved:true,sourceCommit:'a'.repeat(40),releaseCommit:'a'.repeat(40),origin:v2Origin,templateVersion:'JLFA-EXACT-COPY-20261026-05'};
 const data={...targets,...bindings,version:'JLFA-SIGNUP-WORKER-ADMISSION-v2',approvalReceiptSha256:'d'.repeat(64),sourceCommit:context.sourceCommit,origin:v2Origin,sender:INQUIRY_EMAIL_FROM,templateVersion:context.templateVersion,allowedTemplateIds:['R01','R02','R03'],cutoff:v2Cutoff,expiresAt:'2026-11-10T00:00:00.000Z',population:refs?{mode:'references',families:refs.map(f=>({reference:f.reference,recipientSha256:signupRecipientDigest(f.email)}))}:{mode:'future_submissions'}};
 const admission=createSignupWorkerAdmission(data,context,now);if(!admission)throw Error('synthetic v2 admission invalid');
 const env={LS_ACADEMY_SIGNUP_WORKER_ENABLED:'true',LS_ACADEMY_SIGNUP_WORKER_ADMISSION_JSON:JSON.stringify(data),LS_INQUIRY_EMAIL_QUEUE_ENABLED:'true',LS_ACADEMY_FREE_REGISTRATION_ENABLED:'true',LS_INQUIRY_EMAIL_SEND_ENABLED:'true',LS_ACADEMY_FOUNDER_EMAIL_APPROVED:'true',RAILWAY_GIT_COMMIT_SHA:data.sourceCommit,LIFE_SKILLS_RELEASE_COMMIT:data.sourceCommit,LS_IDENTITY_WORKSPACE_ID:workspace,RAILWAY_PROJECT_ID:data.projectId,RAILWAY_ENVIRONMENT_ID:data.environmentId,RAILWAY_SERVICE_ID:data.serviceId,LS_APP_ORIGIN:v2Origin};
 return {admission,env};
}
async function v2ConfirmedFixture(){
 const x=await fixture(),c=command();c.fields.academyRegistration.communicationPreferences=communicationPreferenceSelection('en',false,false,'en');const saved=await x.applications.submit(c,opaqueToken()),initial=(await messages(x.workspace))[0]!;
 // Explicit synthetic historical send setup, not a new-v2 initial/R00 dispatch.
 await x.founder.dispatchOne(initial.id,{send:async()=>({providerId:'synthetic_legacy_setup'})},INQUIRY_EMAIL_FROM,origin);
 const {admission,env}=await v2Policy(x.workspace),worker=new AcademyFounderStore(store,x.workspace,ring,key,clock,null,null,admission);
 await worker.confirm(await token(x.workspace,initial.id));
 const ack=(await messages(x.workspace)).find(m=>m.purpose==='academy_founder_ack')!;
 return {...x,saved,initial,admission,env,worker,ack};
}
async function v2FamilyRows(workspace:string,id:string){return (await db.query('SELECT * FROM ls_service_interest.academy_founder_families WHERE workspace_id=$1 AND id=$2',[workspace,id])).rows;}
async function v2SetFamilyState(workspace:string,id:string,status:'interest_list'|'withdrawn'){
 const row=(await messages(workspace)).find(m=>m.founder_id===id)!;void row;
 const source=(await db.query<{payload_ciphertext:string}>('SELECT payload_ciphertext FROM ls_service_interest.academy_founder_families WHERE workspace_id=$1 AND id=$2',[workspace,id])).rows[0]!;
 const f=JSON.parse(unseal(source.payload_ciphertext,`ls_service_interest/founder/v1/${workspace}/${id}`,ring));f.status=status;f.allocated=false;
 await db.query('UPDATE ls_service_interest.academy_founder_families SET status=$3,allocated=false,payload_ciphertext=$4 WHERE workspace_id=$1 AND id=$2',[workspace,id,status,seal(JSON.stringify(f),`ls_service_interest/founder/v1/${workspace}/${id}`,ring)]);
}
it('v2 new R00 remains a durable queued intent without acceptedSend, reservation or provider attempt',async()=>{
 const previous=now;try{now=new Date(v2Cutoff);const x=await fixture(),{admission}=await v2Policy(x.workspace),worker=new AcademyFounderStore(store,x.workspace,ring,key,clock,null,null,admission),applications=new PublicGroupApplicationStore(store,x.workspace,ring,key,clock,false,worker);
  const c=command();c.fields.academyRegistration.communicationPreferences=communicationPreferenceSelection('en',false,false,'en');await applications.submit(c,opaqueToken());const message=(await messages(x.workspace))[0]!,payload=JSON.parse(unseal(message.payload_ciphertext,`ls_service_interest/inquiry_email/v1/${x.workspace}/${message.id}`,ring)),send=vi.fn(async()=>({providerId:'not_attempted'}));
  expect(payload.transactional).toEqual({version:'JLFA-EXACT-COPY-20261026-05',templateId:'R00',r00Exception:{version:'JLFA-OWNER-PAYMENT-CLOCK-CORRECTION-20261027-01',approvalReceiptSha256:'caeab55524e61c98273b01c9884f15b707e502bc6e145360ebf4575ba55bde3a'}});expect(payload.templateCatalogSha256).toBe(admission.templateCatalogSha256);expect(payload.transactional.acceptedSend).toBeUndefined();
  expect(await worker.dispatchOne(message.id,{send},INQUIRY_EMAIL_FROM,v2Origin,'signup',admission)).toBe('idle');expect(send).not.toHaveBeenCalled();expect((await messages(x.workspace))[0]).toEqual(message);
 }finally{now=previous;}
});
it.each(['queued','unknown','sent'] as const)('v2 never upgrades existing %s legacy payloads or reserved bytes',async(state)=>{
 const previous=now;try{now=new Date(v2Cutoff);const x=await fixture();await x.applications.submit(command(),opaqueToken());const initial=(await messages(x.workspace))[0]!;
  if(state!=='queued')await db.query("UPDATE ls_service_interest.inquiry_email_outbox SET state=$3,reserved_at=$4,completed_at=$5,provider_id=$6 WHERE workspace_id=$1 AND id=$2",[x.workspace,initial.id,state,now,state==='sent'?now:null,state==='sent'?'synthetic_prior':null]);
  const before=await messages(x.workspace),family=await v2FamilyRows(x.workspace,initial.founder_id),{admission}=await v2Policy(x.workspace),worker=new AcademyFounderStore(store,x.workspace,ring,key,clock,null,null,admission),send=vi.fn(async()=>({providerId:'not_attempted'}));
  await worker.dispatchQueued({send},INQUIRY_EMAIL_FROM,v2Origin,'signup',admission);expect(send).not.toHaveBeenCalled();expect(await messages(x.workspace)).toEqual(before);expect(await v2FamilyRows(x.workspace,initial.founder_id)).toEqual(family);
 }finally{now=previous;}
});
it.each(['unchanged','canceled'] as const)('v2 expiry at reservation commit restores only its own %s reservation with no send',async(externalState)=>{
 const previous=now;try{now=new Date(v2Cutoff);const x=await v2ConfirmedFixture(),beforeFamily=await v2FamilyRows(x.workspace,x.ack.founder_id);let advanced=false;
  const boundaryStore:IdentityStore={transaction:async fn=>{let reserved=false;const result=await store.transaction(tx=>fn({query:async<T extends object>(sql:string,values:readonly unknown[]=[])=>{const rows=await tx.query<T>(sql,values);if(sql.includes("SET state='unknown',reserved_at"))reserved=true;return rows;}}));if(reserved&&!advanced){advanced=true;now=new Date(x.admission.expiresAt);if(externalState==='canceled')await db.query("UPDATE ls_service_interest.inquiry_email_outbox SET state='canceled',completed_at=$3 WHERE workspace_id=$1 AND id=$2",[x.workspace,x.ack.id,now]);}return result;}};
  const worker=new AcademyFounderStore(boundaryStore,x.workspace,ring,key,clock,null,null,x.admission),send=vi.fn(async()=>({providerId:'not_attempted'}));expect(await worker.dispatchOne(x.ack.id,{send},INQUIRY_EMAIL_FROM,v2Origin,'signup',x.admission)).toBe('idle');expect(advanced).toBe(true);expect(send).not.toHaveBeenCalled();
  const row=(await db.query<{state:string;reserved_at:Date|null;payload_ciphertext:string;provider_id:string|null}>('SELECT state,reserved_at,payload_ciphertext,provider_id FROM ls_service_interest.inquiry_email_outbox WHERE workspace_id=$1 AND id=$2',[x.workspace,x.ack.id])).rows[0]!;expect(row.state).toBe(externalState==='canceled'?'canceled':'queued');if(externalState==='unchanged')expect(row.reserved_at).toBeNull();expect(row.payload_ciphertext).toBe(x.ack.payload_ciphertext);expect(row.provider_id).toBeNull();expect(await v2FamilyRows(x.workspace,x.ack.founder_id)).toEqual(beforeFamily);
 }finally{now=previous;}
});
it('v2 preserves an actual late receipt after admission expiry without starting a new interest clock',async()=>{
 const previous=now;try{now=new Date(v2Cutoff);const x=await v2ConfirmedFixture(),before=(await x.worker.ownerList(x.actor)).families[0]!.interest,send=vi.fn(async()=>{now=new Date(x.admission.expiresAt);return {providerId:'synthetic_late_ack'};});
  expect(await x.worker.dispatchOne(x.ack.id,{send},INQUIRY_EMAIL_FROM,v2Origin,'signup',x.admission)).toBe('sent');expect(send).toHaveBeenCalledTimes(1);expect((await messages(x.workspace)).find(m=>m.id===x.ack.id)?.state).toBe('sent');expect((await x.worker.ownerList(x.actor)).families[0]!.interest).toEqual(before);
 }finally{now=previous;}
});
it('v2 callback excludes old families and needs policy before factory while new explicit ACK sends once',async()=>{
 const previous=now;try{now=new Date('2026-10-23T13:59:59.999Z');const old=await fixture(),saved=await old.applications.submit(command(),opaqueToken()),initial=(await messages(old.workspace))[0]!;await old.founder.dispatchOne(initial.id,{send:async()=>({providerId:'synthetic_old'})},INQUIRY_EMAIL_FROM,origin);
  now=new Date(v2Cutoff);const {admission,env}=await v2Policy(old.workspace),oldWorker=new AcademyFounderStore(store,old.workspace,ring,key,clock,null,null,admission);await oldWorker.confirm(await token(old.workspace,initial.id));const before=await messages(old.workspace),oldFamily=await v2FamilyRows(old.workspace,initial.founder_id),send=vi.fn(async()=>({providerId:'synthetic_ack'})),factory=vi.fn(()=>({transport:{send},from:INQUIRY_EMAIL_FROM}));
  await dispatchAdmittedSignupCallback(saved.item.id,oldWorker,v2Origin,{...env,LS_ACADEMY_SIGNUP_WORKER_ADMISSION_JSON:undefined},now,factory);expect(factory).not.toHaveBeenCalled();await dispatchAdmittedSignupCallback(saved.item.id,oldWorker,v2Origin,env,now,factory);expect(send).not.toHaveBeenCalled();expect(await messages(old.workspace)).toEqual(before);expect(await v2FamilyRows(old.workspace,initial.founder_id)).toEqual(oldFamily);
  const fresh=await v2ConfirmedFixture();await dispatchAdmittedSignupCallback(fresh.saved.item.id,fresh.worker,v2Origin,fresh.env,now,factory);expect(send).toHaveBeenCalledTimes(1);await dispatchAdmittedSignupCallback(fresh.saved.item.id,fresh.worker,v2Origin,fresh.env,now,factory);expect(send).toHaveBeenCalledTimes(1);
 }finally{now=previous;}
});
it('v2 exact recipient binding and UNKNOWN reservation survive restart without automatic resend',async()=>{
 const previous=now;try{now=new Date(v2Cutoff);const x=await v2ConfirmedFixture(),family=(await x.worker.ownerList(x.actor)).families[0]!,wrong=(await v2Policy(x.workspace,[{reference:family.reference,email:'wrong@example.invalid'}])).admission,good=(await v2Policy(x.workspace,[{reference:family.reference,email:family.email}])).admission,send=vi.fn(async()=>{throw Error('synthetic ambiguity');});
  expect(await x.worker.dispatchOne(x.ack.id,{send},INQUIRY_EMAIL_FROM,v2Origin,'signup',wrong)).toBe('idle');expect(send).not.toHaveBeenCalled();expect((await messages(x.workspace)).find(m=>m.id===x.ack.id)).toEqual(x.ack);
  expect(await x.worker.dispatchOne(x.ack.id,{send},INQUIRY_EMAIL_FROM,v2Origin,'signup',good)).toBe('unknown');const unknown=(await messages(x.workspace)).find(m=>m.id===x.ack.id)!;expect(unknown.payload_ciphertext).toBe(x.ack.payload_ciphertext);await new AcademyFounderStore(store,x.workspace,ring,key,clock,null,null,good).dispatchQueued({send},INQUIRY_EMAIL_FROM,v2Origin,'signup',good);expect(send).toHaveBeenCalledTimes(1);expect((await messages(x.workspace)).find(m=>m.id===x.ack.id)).toEqual(unknown);
 }finally{now=previous;}
});
it('v2 day3/day6 new identities use the actual sent clock and same-key payloads stay immutable',async()=>{
 const previous=now;try{now=new Date(v2Cutoff);const x=await fixture(),c=command();c.fields.academyRegistration.communicationPreferences=communicationPreferenceSelection('en',false,false,'en');await x.applications.submit(c,opaqueToken());const initial=(await messages(x.workspace))[0]!;await x.founder.dispatchOne(initial.id,{send:async()=>({providerId:'synthetic_setup'})},INQUIRY_EMAIL_FROM,origin);const {admission}=await v2Policy(x.workspace),worker=new AcademyFounderStore(store,x.workspace,ring,key,clock,null,null,admission),window=(await worker.ownerList(x.actor)).families[0]!.interest;
  for(const [at,id] of [['2026-10-26T14:00:00.000Z','R01'],['2026-10-29T14:00:00.000Z','R02']] as const){now=new Date(at);await worker.tick([3,6],10,'signup',admission);const rows=(await messages(x.workspace)).filter(m=>m.purpose==='academy_founder_interest_reminder'),payloads=rows.map(m=>JSON.parse(unseal(m.payload_ciphertext,`ls_service_interest/inquiry_email/v1/${x.workspace}/${m.id}`,ring)));expect(payloads.some(p=>p.transactional.templateId===id&&p.transactional.acceptedSend.sentAt===window.sentAt&&p.transactional.acceptedSend.deadline===undefined)).toBe(true);const before=await messages(x.workspace);await worker.tick([3,6],10,'signup',admission);expect(await messages(x.workspace)).toEqual(before);}
  expect((await messages(x.workspace)).find(m=>m.id===initial.id)?.payload_ciphertext).toBe(initial.payload_ciphertext);
 }finally{now=previous;}
});
it('v2 scoped tick never expires an old family and cannot bypass excluded eligible FIFO promotion',async()=>{
 const previous=now;try{now=new Date('2026-10-23T13:59:59.999Z');const x=await fixture();await x.applications.submit(command(),opaqueToken());const old=(await messages(x.workspace))[0]!;await v2SetFamilyState(x.workspace,old.founder_id,'interest_list');
  now=new Date(v2Cutoff);await x.applications.submit(command(),opaqueToken());const next=(await messages(x.workspace)).find(m=>m.founder_id!==old.founder_id)!;await v2SetFamilyState(x.workspace,next.founder_id,'interest_list');const beforeOld=await v2FamilyRows(x.workspace,old.founder_id),beforeNew=await v2FamilyRows(x.workspace,next.founder_id),{admission}=await v2Policy(x.workspace),worker=new AcademyFounderStore(store,x.workspace,ring,key,clock,null,null,admission);
  await worker.tick([],10,'signup',admission);expect(await v2FamilyRows(x.workspace,old.founder_id)).toEqual(beforeOld);expect(await v2FamilyRows(x.workspace,next.founder_id)).toEqual(beforeNew);await v2SetFamilyState(x.workspace,old.founder_id,'withdrawn');const closed=await v2FamilyRows(x.workspace,old.founder_id);await worker.tick([],10,'signup',admission);expect((await worker.ownerList(x.actor)).families.find(f=>f.id===next.founder_id)?.status).toBe('provisional');expect(await v2FamilyRows(x.workspace,old.founder_id)).toEqual(closed);
 }finally{now=previous;}
});
it('v2 expiry processing leaves an actually sent old window byte-identical while expiring the admitted new window',async()=>{
 const previous=now;try{now=new Date('2026-10-23T13:59:59.999Z');const x=await fixture();await x.applications.submit(command(),opaqueToken());const old=(await messages(x.workspace))[0]!;await x.founder.dispatchOne(old.id,{send:async()=>({providerId:'synthetic_old_sent'})},INQUIRY_EMAIL_FROM,origin);
  now=new Date(v2Cutoff);await x.applications.submit(command(),opaqueToken());const fresh=(await messages(x.workspace)).find(m=>m.founder_id!==old.founder_id)!;await x.founder.dispatchOne(fresh.id,{send:async()=>({providerId:'synthetic_new_sent'})},INQUIRY_EMAIL_FROM,origin);const beforeOld=await v2FamilyRows(x.workspace,old.founder_id),beforeMail=(await messages(x.workspace)).filter(m=>m.founder_id===old.founder_id),{admission}=await v2Policy(x.workspace),worker=new AcademyFounderStore(store,x.workspace,ring,key,clock,null,null,admission);
  now=new Date('2026-10-31T14:00:00.000Z');await worker.tick([3,6],10,'signup',admission);expect(await v2FamilyRows(x.workspace,old.founder_id)).toEqual(beforeOld);expect((await messages(x.workspace)).filter(m=>m.founder_id===old.founder_id)).toEqual(beforeMail);expect((await worker.ownerList(x.actor)).families.find(f=>f.id===fresh.founder_id)?.status).toBe('provisional');
 }finally{now=previous;}
});
it('v2 expired authority is rejected before mutations and concurrent ACK attempts reserve once',async()=>{
 const previous=now;try{now=new Date(v2Cutoff);const x=await v2ConfirmedFixture(),before=await messages(x.workspace);now=new Date(x.admission.expiresAt);await expect(x.worker.tick([],10,'signup',x.admission)).rejects.toThrow('SIGNUP_WORKER_NOT_ADMITTED');expect(await messages(x.workspace)).toEqual(before);now=new Date(v2Cutoff);
  let release!:()=>void,started!:()=>void;const gate=new Promise<void>(r=>release=r),begun=new Promise<void>(r=>started=r),send=vi.fn(async()=>{started();await gate;return {providerId:'synthetic_once'};});const first=x.worker.dispatchOne(x.ack.id,{send},INQUIRY_EMAIL_FROM,v2Origin,'signup',x.admission);await begun;expect(await x.worker.dispatchOne(x.ack.id,{send},INQUIRY_EMAIL_FROM,v2Origin,'signup',x.admission)).toBe('idle');release();expect(await first).toBe('sent');expect(send).toHaveBeenCalledTimes(1);
 }finally{now=previous;}
});

it('v2 bounded continuation reaches an ACK after 55 held R00/legacy intents without changing their bytes or state',async()=>{
 const previous=now;try{now=new Date(v2Cutoff);const x=await v2ConfirmedFixture(),heldIds:string[]=[],ackPayload=JSON.parse(unseal(x.ack.payload_ciphertext,`ls_service_interest/inquiry_email/v1/${x.workspace}/${x.ack.id}`,ring));
  for(let i=0;i<55;i++){
   const id=randomUUID(),payload=structuredClone(ackPayload);heldIds.push(id);
   if(i%2===0){payload.kind='interest';payload.transactional={version:'JLFA-EXACT-COPY-20261026-05',templateId:'R00'};}
   else{delete payload.transactional;delete payload.templateCatalogSha256;}
   await db.query("INSERT INTO ls_service_interest.inquiry_email_outbox(workspace_id,id,application_id,founder_id,message_key,purpose,payload_ciphertext,state,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,'queued',$8)",[x.workspace,id,x.ack.application_id,x.ack.founder_id,'synthetic-held-'+i,'academy_founder_'+payload.kind,seal(JSON.stringify(payload),`ls_service_interest/inquiry_email/v1/${x.workspace}/${id}`,ring),new Date(now.getTime()-1000)]);
  }
  const before=(await messages(x.workspace)).filter(m=>heldIds.includes(m.id)),send=vi.fn(async()=>({providerId:'synthetic_after_held_page'}));
  const first=await x.worker.dispatchQueued({send},INQUIRY_EMAIL_FROM,v2Origin,'signup',x.admission);
  expect(first).toMatchObject({processed:0,inspected:50,scanComplete:false});expect(first.continuation).toBeDefined();expect(send).not.toHaveBeenCalled();expect((await messages(x.workspace)).filter(m=>heldIds.includes(m.id))).toEqual(before);
  // A new per-cycle store receives the advisory cursor from its hosted caller.
  const next=new AcademyFounderStore(store,x.workspace,ring,key,clock,null,null,x.admission),second=await next.dispatchQueued({send},INQUIRY_EMAIL_FROM,v2Origin,'signup',x.admission,first.continuation);
  expect(second.processed).toBe(1);expect(second.inspected).toBeLessThanOrEqual(50);expect(second.scanComplete).toBe(true);expect(second.continuation).toBeUndefined();expect(send).toHaveBeenCalledTimes(1);expect((await messages(x.workspace)).find(m=>m.id===x.ack.id)?.state).toBe('sent');expect((await messages(x.workspace)).filter(m=>heldIds.includes(m.id))).toEqual(before);
  // Restart starts safely from the beginning; it grants no authority to held rows.
  const restarted=await new AcademyFounderStore(store,x.workspace,ring,key,clock,null,null,x.admission).dispatchQueued({send},INQUIRY_EMAIL_FROM,v2Origin,'signup',x.admission);expect(restarted.processed).toBe(0);expect(restarted.inspected).toBe(50);expect(send).toHaveBeenCalledTimes(1);expect((await messages(x.workspace)).filter(m=>heldIds.includes(m.id))).toEqual(before);
 }finally{now=previous;}
});

// Conditional proposal: all messages below use synthetic .invalid recipients
// and injected transport only. This is not production test/guardian authority.
async function controlledR00Fixture(){
 const x=await fixture(null,null,false),c=command();c.fields.academyRegistration.version=ACADEMY_REGISTRATION_VERSION;c.fields.academyRegistration.consent=registrationConsent('en');c.fields.permission.version=academyRegistrationNotice.version;c.fields.academyRegistration.communicationPreferences=communicationPreferenceSelection('en',false,false,'en');c.fields.academyRegistration.learners.push({...c.fields.academyRegistration.learners[0]!,id:randomUUID(),fullName:'Synthetic Second Child'});
 const {env}=await v2Policy(x.workspace),data=JSON.parse(env.LS_ACADEMY_SIGNUP_WORKER_ADMISSION_JSON);
 data.cutoff=now.toISOString();data.expiresAt=new Date(now.getTime()+60*60*1000).toISOString();data.allowedTemplateIds=['R00','R03'];
 data.r00Exception={version:'JLFA-OWNER-PAYMENT-CLOCK-CORRECTION-20261027-01',approvalReceiptSha256:'caeab55524e61c98273b01c9884f15b707e502bc6e145360ebf4575ba55bde3a'};
 data.population={mode:'controlled_test',admittedAt:now.toISOString(),recipientSha256:signupRecipientDigest(c.fields.academyRegistration.receiptEmail!),learnerIds:c.fields.academyRegistration.learners.map(l=>l.id)};
 env.LS_ACADEMY_SIGNUP_WORKER_ADMISSION_JSON=JSON.stringify(data);env.LS_INQUIRY_EMAIL_SEND_ENABLED='false';
 const controlledEnv={...env,LS_ACADEMY_FOUNDER_EMAIL_APPROVED:'false',LS_ACADEMY_SIGNUP_CONTROLLED_SEND_ENABLED:'true'};
 const {loadSignupPopulation}=await import('../../src/features/group-application/academy-signup-population-runtime.ts');
 const admission=loadSignupPopulation(controlledEnv,now);if(!admission)throw Error('Synthetic controlled admission refused');
 const worker=new AcademyFounderStore(store,x.workspace,ring,key,clock,null,null,admission),applications=new PublicGroupApplicationStore(store,x.workspace,ring,key,clock,false,worker);
 return {...x,c,env:controlledEnv,admission,worker,applications};
}
it('current R00 records actual provider acceptance with no initial seven-day deadline and delivers only initial plus explicit ACK',async()=>{
 const previous=now;try{
  now=new Date('2026-10-30T16:00:00.000Z');const x=await controlledR00Fixture(),saved=await x.applications.submit(x.c,opaqueToken()),initial=(await messages(x.workspace))[0]!;
  const queued=JSON.parse(unseal(initial.payload_ciphertext,`ls_service_interest/inquiry_email/v1/${x.workspace}/${initial.id}`,ring));expect(queued.transactional.r00Exception).toEqual(x.admission.r00Exception);expect(queued.transactional.acceptedSend).toBeUndefined();
  const readBefore=(await x.worker.ownerList(x.actor)).families[0]!;expect(readBefore.interest.sentAt).toBeNull();expect(readBefore.children).toHaveLength(2);
  const send=vi.fn(async(message:{text?:string})=>{expect(message.text).toContain('Once we announce it, you’ll have seven days to pay and secure your place.');expect(message.text).not.toContain('seven calendar days after this email');expect((await x.worker.ownerList(x.actor)).families[0]!.interest.sentAt).toBeNull();now=new Date('2026-10-30T16:03:00.000Z');return {providerId:'synthetic_controlled_initial'};});
  expect(await x.worker.dispatchOne(initial.id,{send},INQUIRY_EMAIL_FROM,v2Origin,'signup',x.admission)).toBe('sent');
  const family=(await x.worker.ownerList(x.actor)).families[0]!;expect(family.interest.sentAt).toBe(now.toISOString());expect(family.interest.deadline).toBeNull();expect(family.reference).toBe(saved.item.id);
  expect(await messages(x.workspace)).toHaveLength(1);const confirmation=await token(x.workspace,initial.id),beforeRead=await messages(x.workspace);
  const context=await x.worker.confirmationContext(confirmation);expect(context.confirmed).toBe(false);expect(context.deadline).toBe(family.interest.deadline);expect(await messages(x.workspace)).toEqual(beforeRead);
  await x.worker.confirm(confirmation);const ack=(await messages(x.workspace)).find(m=>m.purpose==='academy_founder_ack')!;expect(ack).toBeDefined();
  const ackSend=vi.fn(async()=>({providerId:'synthetic_controlled_ack'}));const restarted=new AcademyFounderStore(store,x.workspace,ring,key,clock,null,null,x.admission);
  await restarted.dispatchQueued({send:ackSend},INQUIRY_EMAIL_FROM,v2Origin,'signup',x.admission);await restarted.confirm(confirmation);await restarted.dispatchQueued({send:ackSend},INQUIRY_EMAIL_FROM,v2Origin,'signup',x.admission);
  expect(ackSend).toHaveBeenCalledTimes(1);expect(await messages(x.workspace)).toHaveLength(2);expect((await restarted.ownerList(x.actor)).families[0]!.interest.sentAt).toBe(family.interest.sentAt);
  const before=await messages(x.workspace);expect(await restarted.tick([3,6],10,'signup',x.admission)).toEqual({prepared:false});expect(await messages(x.workspace)).toEqual(before);
 }finally{now=previous;}
});
it('conditional R00 refuses another newly submitted family and never upgrades its legacy intent',async()=>{
 const previous=now;try{now=new Date(v2Cutoff);const x=await controlledR00Fixture();await x.applications.submit(command(),opaqueToken());const initial=(await messages(x.workspace))[0]!,send=vi.fn(async()=>({providerId:'must_not_send'}));
  const payload=JSON.parse(unseal(initial.payload_ciphertext,`ls_service_interest/inquiry_email/v1/${x.workspace}/${initial.id}`,ring));expect(payload.transactional).toBeUndefined();
  expect(await x.worker.dispatchOne(initial.id,{send},INQUIRY_EMAIL_FROM,v2Origin,'signup',x.admission)).toBe('idle');expect(send).not.toHaveBeenCalled();expect((await messages(x.workspace))[0]).toEqual(initial);
 }finally{now=previous;}
});
it('conditional R00 unknown response survives restart without a clock, ACK, extra receipt or automatic resend',async()=>{
 const previous=now;try{now=new Date(v2Cutoff);const x=await controlledR00Fixture();await x.applications.submit(x.c,opaqueToken());const initial=(await messages(x.workspace))[0]!,send=vi.fn(async()=>{throw Error('synthetic ambiguous outcome');});
  expect(await x.worker.dispatchOne(initial.id,{send},INQUIRY_EMAIL_FROM,v2Origin,'signup',x.admission)).toBe('unknown');await new AcademyFounderStore(store,x.workspace,ring,key,clock,null,null,x.admission).dispatchQueued({send},INQUIRY_EMAIL_FROM,v2Origin,'signup',x.admission);
  expect(send).toHaveBeenCalledTimes(1);expect(await messages(x.workspace)).toHaveLength(1);const family=(await x.worker.ownerList(x.actor)).families[0]!;expect(family.interest.sentAt).toBeNull();expect(family.interest.deadline).toBeNull();expect(family.interest.exception).toBe(true);
 }finally{now=previous;}
});

it('conditional R00 known-not-attempted adapter fence restores only its reservation without UNKNOWN or a clock',async()=>{
 const previous=now;try{now=new Date(v2Cutoff);const x=await controlledR00Fixture();await x.applications.submit(x.c,opaqueToken());const initial=(await messages(x.workspace))[0]!,{SignupEmailNotAttemptedError}=await import('../../src/features/group-application/academy-signup-worker-admission.ts');
  const send=vi.fn(async()=>{throw new SignupEmailNotAttemptedError();});expect(await x.worker.dispatchOne(initial.id,{send},INQUIRY_EMAIL_FROM,v2Origin,'signup',x.admission)).toBe('idle');
  const after=(await messages(x.workspace))[0]!;expect(after.state).toBe('queued');expect(after.payload_ciphertext).toBe(initial.payload_ciphertext);const family=(await x.worker.ownerList(x.actor)).families[0]!;expect(family.interest.exception).toBe(false);expect(family.interest.sentAt).toBeNull();expect(family.interest.deadline).toBeNull();
 }finally{now=previous;}
});
it('conditional R00 retains an actual late accepted receipt and clock after finite expiry but does not send ACK without renewed authority',async()=>{
 const previous=now;try{now=new Date(v2Cutoff);const x=await controlledR00Fixture();await x.applications.submit(x.c,opaqueToken());const initial=(await messages(x.workspace))[0]!,send=vi.fn(async()=>{now=new Date(x.admission.expiresAt);return {providerId:'synthetic_late_initial'};});
  expect(await x.worker.dispatchOne(initial.id,{send},INQUIRY_EMAIL_FROM,v2Origin,'signup',x.admission)).toBe('sent');const family=(await x.worker.ownerList(x.actor)).families[0]!;expect(family.interest.sentAt).toBe(now.toISOString());expect(await messages(x.workspace)).toHaveLength(1);
  await expect(x.worker.dispatchQueued({send},INQUIRY_EMAIL_FROM,v2Origin,'signup',x.admission)).rejects.toThrow('SIGNUP_WORKER_NOT_ADMITTED');expect(send).toHaveBeenCalledTimes(1);
 }finally{now=previous;}
});

it('conditional R00 actual OAuth expiry makes zero message requests and restores only its unsent reservation',async()=>{
 const previous=now;try{now=new Date(v2Cutoff);const x=await controlledR00Fixture();await x.applications.submit(x.c,opaqueToken());const initial=(await messages(x.workspace))[0]!;
  const {createInquiryEmailTransport}=await import('../../src/features/group-application/inquiry-email.ts');
  const env={...x.env,LS_AUTH_EMAIL_ENABLED:'true',LS_AUTH_EMAIL_PROVIDER:'gmail',LS_AUTH_EMAIL_FROM:INQUIRY_EMAIL_FROM,LS_AUTH_GOOGLE_CLIENT_ID:'synthetic-client',LS_AUTH_GOOGLE_CLIENT_SECRET:'synthetic-secret',LS_AUTH_GOOGLE_REFRESH_TOKEN:'synthetic-refresh'};let messagesSent=0,oauth=0;
  const fetcher=(async(url:string|URL|Request)=>{if(String(url).includes('oauth2')){oauth++;now=new Date(x.admission.expiresAt);return Response.json({access_token:'synthetic'});}messagesSent++;return Response.json({id:'must_not_send'});}) as typeof fetch;
  const {transport,from}=createInquiryEmailTransport(env,fetcher,{policy:x.admission,now:clock.now});expect(await x.worker.dispatchOne(initial.id,transport,from,v2Origin,'signup',x.admission)).toBe('idle');expect(oauth).toBe(1);expect(messagesSent).toBe(0);
  const row=(await messages(x.workspace))[0]!;expect(row.state).toBe('queued');expect(row.payload_ciphertext).toBe(initial.payload_ciphertext);const f=(await x.worker.ownerList(x.actor)).families[0]!;expect(f.interest.sentAt).toBeNull();expect(f.interest.exception).toBe(false);
 }finally{now=previous;}
});
it('conditional exact confirmation after policy expiry creates one exact ACK without send authority and supports a fresh ACK-only window',async()=>{
 const previous=now;try{now=new Date(v2Cutoff);const x=await controlledR00Fixture();await x.applications.submit(x.c,opaqueToken());const initial=(await messages(x.workspace))[0]!;
  await x.worker.dispatchOne(initial.id,{send:async()=>({providerId:'synthetic_exact_initial'})},INQUIRY_EMAIL_FROM,v2Origin,'signup',x.admission);const secret=await token(x.workspace,initial.id),original=initial.payload_ciphertext;
  now=new Date('2026-10-25T14:00:00.000Z');const inactive=new AcademyFounderStore(store,x.workspace,ring,key,clock);const before=await messages(x.workspace);expect((await inactive.confirmationContext(secret)).confirmed).toBe(false);expect(await messages(x.workspace)).toEqual(before);
  await inactive.confirm(secret);await inactive.confirm(secret);const rows=await messages(x.workspace),ack=rows.find(m=>m.purpose==='academy_founder_ack')!,p=JSON.parse(unseal(ack.payload_ciphertext,`ls_service_interest/inquiry_email/v1/${x.workspace}/${ack.id}`,ring));expect(rows).toHaveLength(2);expect(p.transactional).toMatchObject({version:'JLFA-EXACT-COPY-20261026-05',templateId:'R03',confirmed:true});expect(p.templateCatalogSha256).toBe(x.admission.templateCatalogSha256);expect(rows.find(m=>m.id===initial.id)!.payload_ciphertext).toBe(original);
  const send=vi.fn(async()=>({providerId:'synthetic_renewed_ack'}));expect(await inactive.dispatchOne(ack.id,{send},INQUIRY_EMAIL_FROM,v2Origin,'signup')).toBe('idle');expect(send).not.toHaveBeenCalled();
  const data=JSON.parse(x.env.LS_ACADEMY_SIGNUP_WORKER_ADMISSION_JSON);data.population.admittedAt=now.toISOString();data.expiresAt=new Date(now.getTime()+3600000).toISOString();data.allowedTemplateIds=['R03'];const {loadSignupPopulation}=await import('../../src/features/group-application/academy-signup-population-runtime.ts');const renewal=loadSignupPopulation({...x.env,LS_ACADEMY_SIGNUP_WORKER_ADMISSION_JSON:JSON.stringify(data)},now)!;expect(renewal).not.toBeNull();
  const worker=new AcademyFounderStore(store,x.workspace,ring,key,clock,null,null,renewal);await worker.dispatchQueued({send},INQUIRY_EMAIL_FROM,v2Origin,'signup',renewal);await worker.dispatchQueued({send},INQUIRY_EMAIL_FROM,v2Origin,'signup',renewal);expect(send).toHaveBeenCalledTimes(1);expect((await messages(x.workspace)).filter(m=>m.state==='sent')).toHaveLength(2);
 }finally{now=previous;}
});
it.each([['en','he'],['he','en']] as const)('conditional R00 and ACK use saved parent %s/%s language rather than UI/group',async(ui,parent)=>{
 const previous=now;try{now=new Date(v2Cutoff);const x=await controlledR00Fixture();x.c.fields.language=ui;x.c.fields.permission.language=ui;x.c.fields.academyRegistration.consent=registrationConsent(ui);x.c.fields.academyRegistration.preferredGroupLanguage=ui;x.c.fields.academyRegistration.communicationPreferences=communicationPreferenceSelection(parent,false,false,ui);
  await x.applications.submit(x.c,opaqueToken());const initial=(await messages(x.workspace))[0]!,payload=JSON.parse(unseal(initial.payload_ciphertext,`ls_service_interest/inquiry_email/v1/${x.workspace}/${initial.id}`,ring));expect(payload.locale).toBe(parent);
  const copy=JSON.parse(await readFile('src/features/group-application/academy-exact-email-copy.json','utf8')).locales[parent];
  const send=vi.fn(async(m:{subject:string;text:string;html?:string})=>{expect(m.subject).toBe(copy.templates.R00.subject);expect(m.text).toContain(parent==='he'?'שבעה ימים לשלם':'seven days to pay');expect(m.text).not.toContain(parent==='he'?'seven days to pay':'שבעה ימים לשלם');expect(m.html).toContain('lang="'+parent+'"');return {providerId:'synthetic_parent_language_initial'};});
  await x.worker.dispatchOne(initial.id,{send},INQUIRY_EMAIL_FROM,v2Origin,'signup',x.admission);await x.worker.confirm(await token(x.workspace,initial.id));const ack=(await messages(x.workspace)).find(m=>m.purpose==='academy_founder_ack')!,ackPayload=JSON.parse(unseal(ack.payload_ciphertext,`ls_service_interest/inquiry_email/v1/${x.workspace}/${ack.id}`,ring));expect(ackPayload.locale).toBe(parent);
  const ackSend=vi.fn(async(m:{subject:string;html?:string})=>{expect(m.subject).toBe(copy.templates.R03.subject);expect(m.html).toContain('lang="'+parent+'"');return {providerId:'synthetic_parent_language_ack'};});await x.worker.dispatchOne(ack.id,{send:ackSend},INQUIRY_EMAIL_FROM,v2Origin,'signup',x.admission);expect(ackSend).toHaveBeenCalledTimes(1);expect((await messages(x.workspace)).find(m=>m.id===initial.id)!.payload_ciphertext).toBe(initial.payload_ciphertext);
 }finally{now=previous;}
});
it.each([['en','he'],['he','en']] as const)('new synthetic R01/R02 use parent %s/%s language and retain initial bytes without actual reminder dispatch',async(ui,parent)=>{
 const previous=now;try{now=new Date(v2Cutoff);const x=await controlledR00Fixture();x.c.fields.language=ui;x.c.fields.permission.language=ui;x.c.fields.academyRegistration.consent=registrationConsent(ui);x.c.fields.academyRegistration.preferredGroupLanguage=ui;x.c.fields.academyRegistration.communicationPreferences=communicationPreferenceSelection(parent,false,false,ui);await x.applications.submit(x.c,opaqueToken());const initial=(await messages(x.workspace))[0]!;
  await x.worker.dispatchOne(initial.id,{send:async()=>({providerId:'synthetic_reminder_language_setup'})},INQUIRY_EMAIL_FROM,v2Origin,'signup',x.admission);const saved=(await x.worker.ownerList(x.actor)).families[0]!,{admission}=await v2Policy(x.workspace,[{reference:saved.reference,email:saved.email}]),worker=new AcademyFounderStore(store,x.workspace,ring,key,clock,null,null,admission);
  for(const [at,id] of [['2026-10-26T14:00:00.000Z','R01'],['2026-10-29T14:00:00.000Z','R02']] as const){now=new Date(at);await worker.tick([3,6],10,'signup',admission);const payloads=(await messages(x.workspace)).filter(m=>m.purpose==='academy_founder_interest_reminder').map(m=>JSON.parse(unseal(m.payload_ciphertext,`ls_service_interest/inquiry_email/v1/${x.workspace}/${m.id}`,ring)));expect(payloads.some(p=>p.transactional.templateId===id&&p.locale===parent&&p.transactional.acceptedSend.sentAt===saved.interest.sentAt&&p.transactional.acceptedSend.deadline===undefined)).toBe(true);}
  expect((await messages(x.workspace)).find(m=>m.id===initial.id)!.payload_ciphertext).toBe(initial.payload_ciphertext);
 }finally{now=previous;}
});

it('new v5 captures exact R00 while sends are off; later finite admission sends the same bytes and ACK uses recorded language',async()=>{
 const previous=now;try{now=new Date(v2Cutoff);const x=await controlledR00Fixture(),inactive=new PublicGroupApplicationStore(store,x.workspace,ring,key,clock,false,x.founder);x.c.fields.academyRegistration.communicationPreferences=communicationPreferenceSelection('he',false,false,'en');
  await inactive.submit(x.c,opaqueToken());const initial=(await messages(x.workspace))[0]!,payload=JSON.parse(unseal(initial.payload_ciphertext,`ls_service_interest/inquiry_email/v1/${x.workspace}/${initial.id}`,ring));expect(payload.transactional.templateId).toBe('R00');expect(payload.locale).toBe('he');expect(payload.transactional.r00Exception.approvalReceiptSha256).toBe('caeab55524e61c98273b01c9884f15b707e502bc6e145360ebf4575ba55bde3a');
  const send=vi.fn(async()=>({providerId:'synthetic_new_v5'}));expect(await x.founder.dispatchOne(initial.id,{send},INQUIRY_EMAIL_FROM,v2Origin,'signup')).toBe('idle');expect(send).not.toHaveBeenCalled();
  expect(await x.worker.dispatchOne(initial.id,{send},INQUIRY_EMAIL_FROM,v2Origin,'signup',x.admission)).toBe('sent');expect(send).toHaveBeenCalledTimes(1);expect((await messages(x.workspace))[0]!.payload_ciphertext).toBe(initial.payload_ciphertext);
  await x.founder.confirm(await token(x.workspace,initial.id));const ack=(await messages(x.workspace)).find(m=>m.purpose==='academy_founder_ack')!,p=JSON.parse(unseal(ack.payload_ciphertext,`ls_service_interest/inquiry_email/v1/${x.workspace}/${ack.id}`,ring));expect(p.transactional.templateId).toBe('R03');expect(p.locale).toBe('he');expect(ack.state).toBe('queued');
 }finally{now=previous;}
});
it('missing saved parent language never sends or upgrades a held new-v5 intent after a later choice',async()=>{
 const previous=now;try{now=new Date(v2Cutoff);const x=await controlledR00Fixture(),continuation=opaqueToken();delete x.c.fields.academyRegistration.communicationPreferences;await x.applications.submit(x.c,continuation);const initial=(await messages(x.workspace))[0]!,send=vi.fn(async()=>({providerId:'must_not_send'}));
  const p=JSON.parse(unseal(initial.payload_ciphertext,`ls_service_interest/inquiry_email/v1/${x.workspace}/${initial.id}`,ring));expect(p.transactional).toBeUndefined();expect(await x.worker.dispatchOne(initial.id,{send},INQUIRY_EMAIL_FROM,v2Origin)).toBe('idle');expect(await x.worker.dispatchOne(initial.id,{send},INQUIRY_EMAIL_FROM,v2Origin,'signup',x.admission)).toBe('idle');
  const amended=structuredClone(x.c);amended.operationId=randomUUID();amended.fields.academyRegistration.communicationPreferences=communicationPreferenceSelection('he',false,false,'en');await x.applications.submit(amended,continuation);expect((await messages(x.workspace))[0]!.payload_ciphertext).toBe(initial.payload_ciphertext);expect(await x.worker.dispatchOne(initial.id,{send},INQUIRY_EMAIL_FROM,v2Origin,'signup',x.admission)).toBe('idle');expect(send).not.toHaveBeenCalled();
 }finally{now=previous;}
});
it('prepatch v5 family never gains new content provenance through continuation',async()=>{
 const x=await fixture(),c=command(),continuation=opaqueToken();await x.applications.submit(c,continuation);const initial=(await messages(x.workspace))[0]!;const next=structuredClone(c);next.operationId=randomUUID();next.fields.academyRegistration.version=ACADEMY_REGISTRATION_VERSION;next.fields.academyRegistration.consent=registrationConsent('en');next.fields.permission.version=academyRegistrationNotice.version;next.fields.academyRegistration.communicationPreferences=communicationPreferenceSelection('he',false,false,'en');const current=new AcademyFounderStore(store,x.workspace,ring,key,clock),applications=new PublicGroupApplicationStore(store,x.workspace,ring,key,clock,false,current);await applications.submit(next,continuation);expect((await current.ownerList(x.actor)).families[0]).not.toHaveProperty('signupContent');expect((await messages(x.workspace))[0]!.payload_ciphertext).toBe(initial.payload_ciphertext);
});

it.each(['future_submissions','references'] as const)('new v5 exact intent can later use separately admitted %s R00 without replacing stored bytes',async mode=>{
 const previous=now;try{now=new Date(v2Cutoff);const x=await fixture(null,null,false),c=command();c.fields.academyRegistration.communicationPreferences=communicationPreferenceSelection('en',false,false,'en');await x.applications.submit(c,opaqueToken());const initial=(await messages(x.workspace))[0]!,f=(await x.founder.ownerList(x.actor)).families[0]!,{env}=await v2Policy(x.workspace,mode==='references'?[{reference:f.reference,email:f.email}]:undefined),data=JSON.parse(env.LS_ACADEMY_SIGNUP_WORKER_ADMISSION_JSON);
  data.allowedTemplateIds=['R00','R03'];data.r00Exception={version:'JLFA-OWNER-PAYMENT-CLOCK-CORRECTION-20261027-01',approvalReceiptSha256:'caeab55524e61c98273b01c9884f15b707e502bc6e145360ebf4575ba55bde3a'};const {loadSignupPopulation}=await import('../../src/features/group-application/academy-signup-population-runtime.ts');const policy=loadSignupPopulation({...env,LS_ACADEMY_SIGNUP_WORKER_ADMISSION_JSON:JSON.stringify(data)},now)!;expect(policy).not.toBeNull();
  const send=vi.fn(async()=>({providerId:'synthetic_broad_initial'}));expect(await x.founder.dispatchOne(initial.id,{send},INQUIRY_EMAIL_FROM,v2Origin,'signup')).toBe('idle');expect(send).not.toHaveBeenCalled();expect(await x.founder.dispatchOne(initial.id,{send},INQUIRY_EMAIL_FROM,v2Origin,'signup',policy)).toBe('sent');expect(send).toHaveBeenCalledTimes(1);expect((await messages(x.workspace))[0]!.payload_ciphertext).toBe(initial.payload_ciphertext);expect((await x.founder.ownerList(x.actor)).families[0]!.interest.sentAt).toBe(now.toISOString());
 }finally{now=previous;}
});
it('exact late ACK refuses lost recorded parent-language evidence without confirming or queuing legacy copy',async()=>{
 const previous=now;try{now=new Date(v2Cutoff);const x=await controlledR00Fixture();await x.applications.submit(x.c,opaqueToken());const initial=(await messages(x.workspace))[0]!;await x.worker.dispatchOne(initial.id,{send:async()=>({providerId:'synthetic_initial_before_missing_choice'})},INQUIRY_EMAIL_FROM,v2Origin,'signup',x.admission);const secret=await token(x.workspace,initial.id),family=(await x.worker.ownerList(x.actor)).families[0]!;delete family.communicationPreferences;await db.query('UPDATE ls_service_interest.academy_founder_families SET payload_ciphertext=$3 WHERE workspace_id=$1 AND id=$2',[x.workspace,family.id,seal(JSON.stringify(family),`ls_service_interest/founder/v1/${x.workspace}/${family.id}`,ring)]);
  now=new Date(x.admission.expiresAt);await expect(x.founder.confirm(secret)).rejects.toMatchObject({code:'UNAVAILABLE'});expect((await messages(x.workspace))).toHaveLength(1);expect((await x.founder.confirmationContext(secret)).confirmed).toBe(false);
 }finally{now=previous;}
});

it('late ACK rejects a SENT predecessor whose exception receipt is not the approved authority',async()=>{
 const previous=now;try{now=new Date(v2Cutoff);const x=await controlledR00Fixture();await x.applications.submit(x.c,opaqueToken());const initial=(await messages(x.workspace))[0]!;await x.worker.dispatchOne(initial.id,{send:async()=>({providerId:'synthetic_predecessor'})},INQUIRY_EMAIL_FROM,v2Origin,'signup',x.admission);const secret=await token(x.workspace,initial.id),aad=`ls_service_interest/inquiry_email/v1/${x.workspace}/${initial.id}`,p=JSON.parse(unseal(initial.payload_ciphertext,aad,ring));p.transactional.r00Exception.approvalReceiptSha256='0'.repeat(64);await db.query('UPDATE ls_service_interest.inquiry_email_outbox SET payload_ciphertext=$3 WHERE workspace_id=$1 AND id=$2',[x.workspace,initial.id,seal(JSON.stringify(p),aad,ring)]);
  now=new Date(x.admission.expiresAt);await expect(x.founder.confirm(secret)).rejects.toMatchObject({code:'UNAVAILABLE'});expect((await messages(x.workspace))).toHaveLength(1);expect((await x.founder.confirmationContext(secret)).confirmed).toBe(false);
 }finally{now=previous;}
});
it('markerless historical family without saved language cannot stamp exact ACK or reminders under broad admission',async()=>{
 const previous=now;try{now=new Date(v2Cutoff);const x=await fixture();await x.applications.submit(command(),opaqueToken());const initial=(await messages(x.workspace))[0]!;await x.founder.dispatchOne(initial.id,{send:async()=>({providerId:'synthetic_legacy'})},INQUIRY_EMAIL_FROM,v2Origin);const {admission}=await v2Policy(x.workspace),worker=new AcademyFounderStore(store,x.workspace,ring,key,clock,null,null,admission),send=vi.fn(async()=>({providerId:'must_not_send'}));
  now=new Date('2026-10-26T14:00:00.000Z');await worker.tick([3,6],10,'signup',admission);await worker.confirm(await token(x.workspace,initial.id));const rows=await messages(x.workspace);for(const row of rows){const p=JSON.parse(unseal(row.payload_ciphertext,`ls_service_interest/inquiry_email/v1/${x.workspace}/${row.id}`,ring));expect(p.transactional).toBeUndefined();}
  expect(rows.some(row=>row.purpose==='academy_founder_ack')).toBe(true);expect(rows.some(row=>row.purpose==='academy_founder_interest_reminder')).toBe(true);await worker.dispatchQueued({send},INQUIRY_EMAIL_FROM,v2Origin,'signup',admission);expect(send).not.toHaveBeenCalled();expect(rows.find(row=>row.id===initial.id)!.payload_ciphertext).toBe(initial.payload_ciphertext);
 }finally{now=previous;}
});
it('already prepared exact broad ACK remains immutable and unsent if recorded language evidence is lost',async()=>{
 const previous=now;try{now=new Date(v2Cutoff);const x=await v2ConfirmedFixture(),family=(await x.worker.ownerList(x.actor)).families[0]!,before=(await messages(x.workspace)).find(row=>row.id===x.ack.id)!;expect(JSON.parse(unseal(before.payload_ciphertext,`ls_service_interest/inquiry_email/v1/${x.workspace}/${before.id}`,ring)).transactional.templateId).toBe('R03');delete family.communicationPreferences;await db.query('UPDATE ls_service_interest.academy_founder_families SET payload_ciphertext=$3 WHERE workspace_id=$1 AND id=$2',[x.workspace,family.id,seal(JSON.stringify(family),`ls_service_interest/founder/v1/${x.workspace}/${family.id}`,ring)]);const send=vi.fn(async()=>({providerId:'must_not_send'}));expect(await x.worker.dispatchOne(before.id,{send},INQUIRY_EMAIL_FROM,v2Origin,'signup',x.admission)).toBe('idle');expect(send).not.toHaveBeenCalled();expect((await messages(x.workspace)).find(row=>row.id===before.id)).toEqual(before);
 }finally{now=previous;}
});

it('retains historical initial deadline audit but permits confirmation weeks later without expiring or releasing the reservation',async()=>{
 const previous=now;try{
  const x=await fixture();await x.applications.submit(command(),opaqueToken());const initial=(await messages(x.workspace))[0]!,secret=await token(x.workspace,initial.id);
  await x.founder.dispatchOne(initial.id,{send:async()=>({providerId:'synthetic_historical_clock'})},INQUIRY_EMAIL_FROM,origin);
  const family=(await x.founder.ownerList(x.actor)).families[0]!,historical='2026-10-30T14:00:00.000Z';family.interest.deadline=historical;
  await db.query('UPDATE ls_service_interest.academy_founder_families SET payload_ciphertext=$3 WHERE workspace_id=$1 AND id=$2',[x.workspace,family.id,seal(JSON.stringify(family),`ls_service_interest/founder/v1/${x.workspace}/${family.id}`,ring)]);
  const sent=(await messages(x.workspace)).find(m=>m.id===initial.id)!;now=new Date('2026-11-20T15:00:00Z');await x.founder.tick();
  const after=(await x.founder.ownerList(x.actor)).families[0]!;expect(after.status).toBe('provisional');expect(after.allocated).toBe(true);expect(after.interest.deadline).toBe(historical);expect(after.payment.deadline).toBeNull();
  expect(await x.founder.confirmationContext(secret)).toMatchObject({available:true,unusable:false,deadline:null});expect(await x.founder.confirm(secret)).toMatchObject({confirmed:true});expect((await messages(x.workspace)).find(m=>m.id===initial.id)).toEqual(sent);
  expect((await x.founder.ownerList(x.actor)).families[0]!.interest.deadline).toBe(historical);expect(await x.founder.aggregate()).toMatchObject({remaining:29});
 }finally{now=previous;}
});

it.each(['missing','current'] as const)('keeps historical exact ACK held under active current admission with %s family content provenance',async marker=>{
 const previous=now;try{now=new Date(v2Cutoff);const x=await controlledR00Fixture();await x.applications.submit(x.c,opaqueToken());const initial=(await messages(x.workspace))[0]!;
  await x.worker.dispatchOne(initial.id,{send:async()=>({providerId:'synthetic_original_historical'})},INQUIRY_EMAIL_FROM,v2Origin,'signup',x.admission);
  const secret=await token(x.workspace,initial.id),family=(await x.worker.ownerList(x.actor)).families[0]!,aad=`ls_service_interest/inquiry_email/v1/${x.workspace}/${initial.id}`,old=JSON.parse(unseal(initial.payload_ciphertext,aad,ring));
  old.transactional.r00Exception={version:'JLFA-R00-RELATIVE-SEND-CLOCK-20261027-01',approvalReceiptSha256:'7dfc71f18f0f853bb11f4bc1de0547484c13a9bbfa1f82eeab30d0eaf95aca87'};old.templateCatalogSha256='175d4bbc87d94d2632c6a1be0092784ad14e4eb7dbc25825c6ec0106d2f3e1ea';
  await db.query('UPDATE ls_service_interest.inquiry_email_outbox SET payload_ciphertext=$3 WHERE workspace_id=$1 AND id=$2',[x.workspace,initial.id,seal(JSON.stringify(old),aad,ring)]);
  if(marker==='missing'){delete family.signupContent;await db.query('UPDATE ls_service_interest.academy_founder_families SET payload_ciphertext=$3 WHERE workspace_id=$1 AND id=$2',[x.workspace,family.id,seal(JSON.stringify(family),`ls_service_interest/founder/v1/${x.workspace}/${family.id}`,ring)]);}
  const before=(await messages(x.workspace))[0]!;expect(await x.worker.confirm(secret)).toMatchObject({confirmed:true});const ack=(await messages(x.workspace)).find(m=>m.purpose==='academy_founder_ack')!;const payload=JSON.parse(unseal(ack.payload_ciphertext,`ls_service_interest/inquiry_email/v1/${x.workspace}/${ack.id}`,ring));expect(payload.heldSignupContent).toBe('historical_clock');expect(payload.transactional).toBeUndefined();
  const send=vi.fn(async()=>({providerId:'must_not_send'}));expect(await x.worker.dispatchOne(ack.id,{send},INQUIRY_EMAIL_FROM,v2Origin,'signup',x.admission)).toBe('idle');expect(await x.worker.dispatchOne(ack.id,{send},INQUIRY_EMAIL_FROM,v2Origin)).toBe('idle');expect(send).not.toHaveBeenCalled();expect((await messages(x.workspace)).find(m=>m.id===initial.id)).toEqual(before);
 }finally{now=previous;}
});
it.each([{kind:'ack'},{templateId:'R03'}])('rejects mismatched historical SENT predecessor identity %j before confirming',async mismatch=>{
 const previous=now;try{now=new Date(v2Cutoff);const x=await controlledR00Fixture();await x.applications.submit(x.c,opaqueToken());const initial=(await messages(x.workspace))[0]!;await x.worker.dispatchOne(initial.id,{send:async()=>({providerId:'synthetic_mismatch_historical'})},INQUIRY_EMAIL_FROM,v2Origin,'signup',x.admission);
  const secret=await token(x.workspace,initial.id),aad=`ls_service_interest/inquiry_email/v1/${x.workspace}/${initial.id}`,old=JSON.parse(unseal(initial.payload_ciphertext,aad,ring));old.transactional.r00Exception={version:'JLFA-R00-RELATIVE-SEND-CLOCK-20261027-01',approvalReceiptSha256:'7dfc71f18f0f853bb11f4bc1de0547484c13a9bbfa1f82eeab30d0eaf95aca87'};old.templateCatalogSha256='175d4bbc87d94d2632c6a1be0092784ad14e4eb7dbc25825c6ec0106d2f3e1ea';if(mismatch.kind)old.kind=mismatch.kind;else old.transactional.templateId=mismatch.templateId;
  await db.query('UPDATE ls_service_interest.inquiry_email_outbox SET payload_ciphertext=$3 WHERE workspace_id=$1 AND id=$2',[x.workspace,initial.id,seal(JSON.stringify(old),aad,ring)]);await expect(x.worker.confirm(secret)).rejects.toMatchObject({code:'UNAVAILABLE'});expect((await x.worker.confirmationContext(secret)).confirmed).toBe(false);expect(await messages(x.workspace)).toHaveLength(1);
 }finally{now=previous;}
});
