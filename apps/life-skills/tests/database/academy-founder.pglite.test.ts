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
async function fixture(port:FounderPaymentPort|null=null,native:FounderNativeFamilyPort|null=null){const workspace=asId(randomUUID(),'workspace');await db.query('INSERT INTO ls_identity.workspaces(id,created_at) VALUES($1,$2)',[workspace,now]);const owner=randomUUID(),digest=owner.replaceAll('-','').padEnd(64,'0');await db.query("INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,'adult','synthetic',$3)",[owner,workspace,now]);await db.query("INSERT INTO ls_identity.accounts(id,workspace_id,role,state,locale,email_blind,email_ciphertext,email_verified_at,password_hash,created_at,updated_at) VALUES($1,$2,'practitioner','active','en',$3,'synthetic',$4,'synthetic',$4,$4)",[owner,workspace,digest,now]);await db.query('INSERT INTO ls_identity.account_subjects(workspace_id,account_id,person_id) VALUES($1,$2,$2)',[workspace,owner]);await db.query('INSERT INTO ls_identity.sessions(token_digest,workspace_id,account_id,created_at,expires_at) VALUES($1,$2,$3,$4,$5)',[digest,workspace,owner,now,new Date('2035-01-01')]);const actor={id:owner,workspaceId:workspace,personId:owner,role:'practitioner',state:'active',locale:'en',sessionDigest:digest,expiresAt:new Date('2035-01-01').getTime()} as Actor;const founder=new AcademyFounderStore(store,workspace,ring,key,clock,port,native),applications=new PublicGroupApplicationStore(store,workspace,ring,key,clock,false,founder);return {workspace,actor,founder,applications};}
function command(email=`family-${randomUUID()}@example.invalid`){return {operationId:randomUUID(),fields:floridaAcademyRegistrationFieldsSchema.parse({parentName:'Synthetic Parent '+email,contact:email,language:'en',cityArea:'Synthetic Florida',programId:'sunday_fishing_academy',schedulePreference:[],academyRegistration:{version:ACADEMY_REGISTRATION_VERSION,learners:[{id:randomUUID(),fullName:'Synthetic Child',ageYears:10,grade:'5',schooling:'school',experience:'new'}],postalCode:'33020',preferredDays:['monday'],preferredTimes:['afternoon'],driveMinutes:30,schoolHoursAvailability:'outside_school_only',preferredGroupLanguage:'either',stageInterest:'foundation',receiptEmail:email,intent:'information',consent:registrationConsent('en')},permission:{confirmed:true,version:academyRegistrationNotice.version,language:'en'}})};}
async function messages(workspace:string){return (await db.query<{id:string;founder_id:string;state:string;purpose:string;payload_ciphertext:string;application_id:string}>('SELECT * FROM ls_service_interest.inquiry_email_outbox WHERE workspace_id=$1 ORDER BY created_at,id',[workspace])).rows;}
async function token(workspace:string,id:string){const row=(await messages(workspace)).find(m=>m.id===id)!;return JSON.parse(unseal(row.payload_ciphertext,`ls_service_interest/inquiry_email/v1/${workspace}/${id}`,ring)).token as string;}
beforeAll(async()=>{await db.exec('CREATE SCHEMA ls_control');for(const n of ['0001_ls_foundation.sql','0010_ls_identity_cases_20260906.sql','0124_ls_group_interest.sql','0131_ls_public_group_applications.sql','0135_ls_inquiry_email_outbox.sql','proposals/0136_ls_academy_founder.sql'])await db.exec(await readFile('migrations/'+n,'utf8'));},25000);
afterAll(async()=>db.close());
it('replays an immutable historical v3 application with preferences and attribution after v4 without rewriting consent or placement',async()=>{
 const x=await fixture(),c=command(),id=randomUUID(),continuation=opaqueToken();
 c.fields.academyRegistration.version=ACADEMY_PREVIOUS_FREE_REGISTRATION_VERSION;
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
it('sends once after committed UNKNOWN, starts the confirmation clock only after provider acceptance, explicit confirmation is idempotent and cancels reminders',async()=>{
 const x=await fixture();await x.applications.submit(command(),opaqueToken());const m=(await messages(x.workspace))[0]!,secret=await token(x.workspace,m.id);await expect(x.founder.confirm(secret)).rejects.toMatchObject({code:'CONFLICT'});
 let mail='';const send=vi.fn(async(p:{text:string})=>{expect((await messages(x.workspace))[0]?.state).toBe('unknown');mail=p.text;return {providerId:'synthetic1'};});
 expect(await x.founder.dispatchOne(m.id,{send},INQUIRY_EMAIL_FROM,origin)).toBe('sent');expect(await x.founder.dispatchOne(m.id,{send},INQUIRY_EMAIL_FROM,origin)).toBe('idle');expect(send).toHaveBeenCalledTimes(1);expect(mail).toContain('Confirm My Interest');expect(mail).not.toContain('Pay');
 let f=(await x.founder.ownerList(x.actor)).families[0]!;expect(f.interest.deadline).toBe('2026-10-30T14:00:00.000Z');expect(f.payment.deadline).toBeNull();now=new Date('2026-10-26T14:00:01Z');await x.founder.tick();expect((await messages(x.workspace)).some(m=>m.purpose==='academy_founder_interest_reminder')).toBe(true);
 expect(await x.founder.confirm(secret)).toMatchObject({confirmed:true});expect(await x.founder.confirm(secret)).toMatchObject({confirmed:true});f=(await x.founder.ownerList(x.actor)).families[0]!;expect(f.status).toBe('confirmed');expect((await messages(x.workspace)).filter(m=>m.purpose==='academy_founder_ack')).toHaveLength(1);expect((await messages(x.workspace)).filter(m=>m.purpose.includes('reminder')).every(m=>m.state==='canceled')).toBe(true);
 now=new Date('2026-10-23T14:00:00Z');
});
it('ambiguous send, process restart, suppression and unsent records cannot fabricate delivery or forfeit an allocation',async()=>{
 const x=await fixture();await x.applications.submit(command(),opaqueToken());const m=(await messages(x.workspace))[0]!;const send=vi.fn(async()=>{throw Error('ambiguous');});expect(await x.founder.dispatchOne(m.id,{send},INQUIRY_EMAIL_FROM,origin)).toBe('unknown');const restarted=new AcademyFounderStore(store,x.workspace,ring,key,clock);expect(await restarted.dispatchOne(m.id,{send},INQUIRY_EMAIL_FROM,origin)).toBe('idle');expect(send).toHaveBeenCalledTimes(1);
 now=new Date('2026-12-01T15:00:00Z');await restarted.tick();const f=(await restarted.ownerList(x.actor)).families[0]!;expect(f.status).toBe('provisional');expect(f.interest.deadline).toBeNull();expect(f.interest.exception).toBe(true);expect(await restarted.aggregate()).toMatchObject({remaining:29,capacity:30});now=new Date('2026-10-23T14:00:00Z');
});
it('expires only successfully sent unused holds and promotes the next completed-form family in order with a fresh confirmation window',async()=>{
 const x=await fixture();for(let i=0;i<31;i++)await x.applications.submit(command(),opaqueToken());const rows=await messages(x.workspace),first=rows[0]!;await x.founder.dispatchOne(first.id,{send:async()=>({providerId:'synthetic_expire'})},INQUIRY_EMAIL_FROM,origin);
 now=new Date('2026-10-31T15:00:00Z');await x.founder.tick();const list=await x.founder.ownerList(x.actor);expect(list.families.filter(f=>f.status==='expired')).toHaveLength(1);expect(list.families[30]?.status).toBe('provisional');expect(list.families[30]?.interest.deadline).toBeNull();expect(await x.founder.aggregate()).toMatchObject({remaining:0,capacity:30});await x.founder.tick();expect((await x.founder.ownerList(x.actor)).families.filter(f=>f.status==='expired')).toHaveLength(1);now=new Date('2026-10-23T14:00:00Z');
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
it('anchors delayed send deadlines at actual success, emits one exact-deadline receipt and never expires a verified NOT SENT result',async()=>{
 const x=await fixture();await x.applications.submit(command(),opaqueToken());const m=(await messages(x.workspace))[0]!;
 await x.founder.dispatchOne(m.id,{send:async()=>{now=new Date('2026-10-23T14:05:00Z');return {providerId:'synthetic_slow'};}},INQUIRY_EMAIL_FROM,origin);
 let f=(await x.founder.ownerList(x.actor)).families[0]!;expect(f.interest.sentAt).toBe('2026-10-23T14:05:00.000Z');expect(f.interest.deadline).toBe('2026-10-30T14:05:00.000Z');const receipts=(await messages(x.workspace)).filter(m=>m.purpose==='academy_founder_interest_deadline_receipt');expect(receipts).toHaveLength(1);let text='';await x.founder.dispatchOne(receipts[0]!.id,{send:async p=>{text=p.text;return {providerId:'synthetic_deadline_receipt'};}},INQUIRY_EMAIL_FROM,origin);expect(text).toContain('America/New_York');expect(text).toContain('10:05');
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
 expect(body).toMatchObject({ok:true,data:{saved:true,founder:{email:outcome==='sent'?'sent':'delivery_problem'}}});
 const read=await x.founder.ownerList(x.actor);expect(read.families).toHaveLength(1);expect(read.metrics.children).toBe(1);
 expect(body.data.founder.deadline).toBe(outcome==='sent'?read.families[0]!.interest.deadline:null);
 expect(read.families[0]!.interest.deadline!==null).toBe(outcome!=='unknown');
 const sends=send.mock.calls.length;expect(sends).toBe(outcome==='unknown'?1:2);
 const retry=await publicGroupApplicationHttp(request(),deps);expect(retry.status).toBe(200);expect((await retry.json()).data).toMatchObject({saved:true,replayed:true,founder:{email:outcome==='sent'?'sent':'delivery_problem'}});
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
