import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {beforeAll,afterAll,afterEach,it,expect,vi} from 'vitest';
import {asId} from '../../../src/lib/ids.ts';
import type {Actor} from '../../../src/features/identity/types.ts';
import type {IdentityStore,SqlSession} from '../../../src/features/identity/store.ts';
import {seal,unseal,tokenDigest} from '../../../src/features/identity/crypto.ts';
import {AcademyCrmStore,type AcademyInquiryContactDataInput} from '../../../src/features/contact-ops/server/academy-crm-store.ts';
import {freshActor,lockWorkspace} from '../../../src/features/identity/data.ts';
import {requirePractitioner} from '../../../src/features/cases/policy.ts';
import {FishingBillingInquiryFamilyProposals} from '../../../src/lib/fishing-billing-inquiry-family-proposal.ts';
import {ContactCutoverStore} from '../../../src/features/contact-ops/server/cutover-store.ts';
import {privateDigest} from '../../../src/features/contact-ops/server/digests.ts';
import {crmProfileAad} from '../../../src/features/contact-ops/server/native-store.ts';
import type {AcademyCrmCommand,AcademyInitializationInput} from '../../../src/features/contact-ops/core/academy-crm.ts';
import {PublicGroupApplicationStore} from '../../../src/features/group-application/store.ts';
import {floridaGroupApplicationNotice,groupApplicationFieldsSchema,isTrip390Interest,type GroupApplicationFields} from '../../../src/features/group-application/contract.ts';
import {groupApplicationPayloadAad,groupApplicationRequestDigest} from '../../../src/features/group-application/group-application-record.ts';
import {trip390V1InterestSchema} from '../../../src/features/group-application/academy-trip390-v1.ts';
import {trip390V3InterestSchema} from '../../../src/features/group-application/academy-trip390-v3.ts';
import {currentTrip390Fields} from '../../fixtures/trip390-current.ts';
import {historicalTrip390V2Fields} from '../../fixtures/trip390-v2.ts';
import {requirePgliteMemoryEnvironment} from '../../fixtures/pglite-memory-environment.ts';
vi.mock('server-only',()=>({}));

// Actual source/CRM/Cutover/identity stores and baseline DDL in a new no-URL
// memory database. No authority/store mocks, runtime binding or provider calls.
let engine:PGlite;
const network=vi.fn<typeof fetch>(async()=>{throw Error('NO_NETWORK_IN_MEMORY_CRM_TEST');});
const initial=new Date('2035-01-06T15:00:00Z');
const key='synthetic-trip390-crm-integrity-only';
const ring={activeKeyId:'synthetic',keys:{synthetic:Buffer.alloc(32,7)}};
const admin={stage:'New inquiry',nextAction:null,followUpDate:null,notes:''};
beforeAll(async()=>{
 requirePgliteMemoryEnvironment(process.env);vi.stubGlobal('fetch',network);engine=new PGlite();
 await engine.exec('CREATE SCHEMA ls_control');
 const manifest=JSON.parse(await readFile('migrations/manifest.json','utf8')) as {name:string;sha256:string}[];
 for(const name of ['0001_ls_foundation.sql','0010_ls_identity_cases_20260906.sql','0030_ls_calendar_attendance_20260907.sql',
  '0097_ls_demo_provenance.sql','0101_ls_contact_operations.sql','0102_ls_internal_tasks.sql','0105_ls_contact_authority.sql',
  '0110_ls_contact_outbound_projection.sql','0116_ls_acquisition_candidates.sql','0124_ls_group_interest.sql',
  '0131_ls_public_group_applications.sql','0133_ls_fishing_lead_memberships.sql','0135_ls_inquiry_email_outbox.sql','0138_ls_academy_crm.sql']){
  const sql=await readFile('migrations/'+name,'utf8');
  expect(createHash('sha256').update(sql.replaceAll('\r\n','\n')).digest('hex')).toBe(manifest.find(m=>m.name===name)?.sha256);
  await engine.exec(sql);
 }
 await engine.exec('CREATE SCHEMA ls_fishing_billing');
 await engine.exec(await readFile('migrations/proposals/UNNUMBERED_ls_fishing_inquiry_family_proposals.sql','utf8'));
},20000);
afterEach(()=>{expect(globalThis.fetch).toBe(network);expect(network).not.toHaveBeenCalled();});
afterAll(async()=>{try{if(engine)await engine.close();}finally{vi.unstubAllGlobals();}});

type QueryObserver=(direct:SqlSession,sql:string,values:readonly unknown[])=>Promise<void>;
async function setup(initialize=true,emailQueue=false){
 const workspace=asId(randomUUID(),'workspace');let at=new Date(initial),observer:QueryObserver|null=null;
 let transactions=0;
 const statements:string[]=[];
 const clock={now:()=>new Date(at)};
 const db:IdentityStore={transaction:work=>{transactions++;return engine.transaction(async raw=>{
  const direct:SqlSession={query:async<T extends object>(sql:string,values:readonly unknown[]=[])=>
   (await raw.query<T>(sql,[...values])).rows};
  const tx:SqlSession={query:async<T extends object>(sql:string,values:readonly unknown[]=[])=>{
   const rows=await direct.query<T>(sql,values);statements.push(sql);
   // Fault timing observes completed REAL queries; it never supplies rows or
   // substitutes any store/authority. Injected changes use the actual same TX.
   if(observer)await observer(direct,sql,values);return rows;
  }};
  return work(tx);
 });}};
 await engine.query('INSERT INTO ls_identity.workspaces(id,created_at) VALUES($1,$2)',[workspace,initial]);
 async function actor(role:Actor['role']){
  const id=asId(randomUUID(),'account'),personId=asId(randomUUID(),'person'),digest=tokenDigest(randomBytes(32).toString('base64url'));
  await engine.query("INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,'adult',$3,$4)",
   [personId,workspace,seal(JSON.stringify({displayName:'Synthetic '+role}),`person:${workspace}:${personId}`,ring),initial]);
  await engine.query(`INSERT INTO ls_identity.accounts(id,workspace_id,role,state,locale,email_blind,email_ciphertext,email_verified_at,password_hash,created_at,updated_at)
   VALUES($1,$2,$3,'active','en',$4,$5,$6,'synthetic-non-login-hash',$6,$6)`,
   [id,workspace,role,createHash('sha256').update(id).digest('hex'),seal(id+'@example.invalid',`email:${workspace}:${id}`,ring),initial]);
  await engine.query('INSERT INTO ls_identity.account_subjects(workspace_id,account_id,person_id) VALUES($1,$2,$3)',[workspace,id,personId]);
  const expiresAt=Date.parse('2036-01-01T00:00:00Z');
  await engine.query('INSERT INTO ls_identity.sessions(token_digest,workspace_id,account_id,created_at,expires_at) VALUES($1,$2,$3,$4,$5)',
   [digest,workspace,id,initial,new Date(expiresAt)]);
  return {id,workspaceId:workspace,personId,role,state:'active',locale:'en',sessionDigest:digest,expiresAt} as Actor;
 }
 const owner=await actor('practitioner'),parent=await actor('parent');
 const initialization:AcademyInitializationInput={operationId:randomUUID(),expectedEpoch:0,observedNativeWritesSinceSwitch:0,
  decisionId:'ACADEMY-ONLY-CRM-20261028-01',evidence:{retiredSourcesFence:'a'.repeat(64),retiredSchedulesFence:'b'.repeat(64),
   retainedAcademyRecords:'c'.repeat(64),queueReconciliation:'d'.repeat(64),restorePlan:'e'.repeat(64)}};
 const authority=new ContactCutoverStore(db,ring,key,clock),crm=new AcademyCrmStore(db,ring,key,clock);
 const source=new PublicGroupApplicationStore(db,workspace,ring,key,clock,emailQueue);
 if(initialize)await authority.initializeAcademy(owner,initialization);
 const submit=async()=>{
  const fields=currentTrip390Fields();fields.children.push({id:randomUUID(),name:'Synthetic sibling',ageYears:13,experience:'some'});
  return source.submit({operationId:randomUUID(),fields});
 };
 const applications=async()=>({
  records:(await engine.query('SELECT * FROM ls_service_interest.public_applications WHERE workspace_id=$1 ORDER BY id',[workspace])).rows,
  operations:(await engine.query('SELECT * FROM ls_service_interest.public_application_operations WHERE workspace_id=$1 ORDER BY operation_id',[workspace])).rows,
 });
 const count=async(table:string)=>(await engine.query<{n:number}>(`SELECT count(*)::int AS n FROM ${table} WHERE workspace_id=$1`,[workspace])).rows[0]!.n;
 const effects=async()=>Promise.all(['ls_identity.people','ls_identity.accounts','ls_cases.cases','ls_cases.families','ls_cases.family_members',
  'ls_calendar.tasks','ls_contact_ops.outbound_projections','ls_service_interest.inquiry_email_outbox'].map(count));
 const convert=async(reference:string)=>{
  const preview=await crm.previewInquiry(owner,reference,1);
  const command:AcademyCrmCommand={action:'from_inquiry',operationId:randomUUID(),expectedEpoch:1,
   sourceApplicationId:reference,sourceDigest:preview.sourceDigest,fields:admin};
  return {preview,command,result:await crm.execute(owner,command)};
 };
 // Historical acquisition is seeded with its ACTUAL decoder's AAD/HMAC and
 // operation ledger. A new historical public submission remains forbidden.
 const savedHistorical=async(input:GroupApplicationFields)=>{
  const fields=groupApplicationFieldsSchema.parse(input);
  if(!('version' in fields))throw Error('HISTORICAL_TRIP_ONLY');
  const id=randomUUID(),operationId=randomUUID(),digest=groupApplicationRequestDigest(workspace,fields,key);
  await engine.query(`INSERT INTO ls_service_interest.public_applications(workspace_id,id,contact_digest,request_digest,payload_ciphertext,notice_version,notice_language,received_at)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[workspace,id,
   privateDigest({domain:'public-group-application-contact/v1',workspace,contact:fields.email},key),digest,
   seal(JSON.stringify(fields),groupApplicationPayloadAad(workspace,id),ring),fields.acknowledgment.version,fields.acknowledgment.language,initial]);
  await engine.query('INSERT INTO ls_service_interest.public_application_operations(workspace_id,operation_id,request_digest,application_id) VALUES($1,$2,$3,$4)',
   [workspace,operationId,digest,id]);
  return {id,operationId,fields};
 };
 return {workspace,owner,parent,db,clock,crm,source,authority,initialization,submit,applications,count,effects,convert,savedHistorical,statements,
  observe:(next:QueryObserver|null)=>{observer=next;},advance:(next:Date)=>{at=new Date(next);},transactionCount:()=>transactions};
}

it('current v4 siblings retain exact saved bytes through explicit CRM conversion, reload and operation replay',async()=>{
 const s=await setup(),saved=await s.submit(),before=await s.applications(),effects=await s.effects();
 expect(await s.count('ls_contact_ops.academy_crm_contacts')).toBe(0);
 const {preview,command,result}=await s.convert(saved.item.id);
 expect(preview).toEqual({sourceApplicationId:saved.item.id,
  sourceDigest:privateDigest({workspaceId:s.workspace,record:saved.item},key),
  name:'Synthetic Guardian',phone:'+12025550101',email:'synthetic@example.invalid',language:'he',existingPersonId:null});
 expect(preview).not.toHaveProperty('record');expect(preview).not.toHaveProperty('fields');
 const reloaded=new AcademyCrmStore(s.db,ring,key,s.clock),detail=await reloaded.read(s.owner,result.personId,1);
 expect(detail.contact).toMatchObject({name:'Synthetic Guardian',version:1,outboundEligible:false,origin:{
  kind:'inquiry',initializationId:s.initialization.operationId,sourceApplicationId:saved.item.id,
  sourceDigest:preview.sourceDigest,language:'he',phone:'+12025550101',email:'synthetic@example.invalid'}});
 expect(await reloaded.execute(s.owner,command)).toEqual({...result,replayed:true});
 expect(await reloaded.previewInquiry(s.owner,saved.item.id,1)).toEqual({...preview,existingPersonId:result.personId});
 expect(await s.count('ls_contact_ops.academy_crm_contacts')).toBe(1);
 expect(await s.count('ls_contact_ops.academy_crm_activity')).toBe(1);
 expect(await s.effects()).toEqual([effects[0]!+1,...effects.slice(1)]);
 const membership=(await engine.query<{ciphertext:string}>(`SELECT payload_ciphertext AS ciphertext FROM ls_contact_ops.fishing_lead_revisions
  WHERE workspace_id=$1 AND person_id=$2`,[s.workspace,result.personId])).rows[0]!;
 expect(JSON.parse(unseal(membership.ciphertext,`ls_contact_ops/fishing-membership/v1/${s.workspace}/sunday_fishing_academy/${result.personId}/1`,ring)))
  .toMatchObject({permission:{state:'unknown'}});
 expect(await s.source.readForOwner(s.owner,saved.item.id)).toEqual(saved.item);
 expect(await s.applications()).toEqual(before);
});

const v1=()=>trip390V1InterestSchema.parse({version:'JLFA-TRIP390-INTEREST-v1',offerVersion:'JLFA-KEYS390-v1',
 guardianName:'Historical email-only parent',email:'old@example.invalid',city:'Synthetic old city',postalCode:'01234',messageLanguage:'he',
 children:[{id:randomUUID(),name:'Historical child',ageYears:7,experience:'not_sure'}],notes:'Historical answer unchanged',
 acknowledgment:{version:'JLFA-TRIP390-INTEREST-NOTICE-v1',language:'en',conductExplained:true,interestPrivacySafety:true,whatsapp:false}});
const v3=()=>trip390V3InterestSchema.parse({...currentTrip390Fields(),version:'JLFA-TRIP390-INTEREST-v3',offerVersion:'JLFA-KEYS390-v2',
 lessonDayDriving:{version:'JLFA-SUNDAY-TOTAL-DRIVE-v1',limit:'up_to_60'}});
it.each([['v1 email-only',v1],['v2 frozen agreement',historicalTrip390V2Fields],['v3 frozen notice',v3]] as const)(
 'historical %s preserves original offer, consent and optional phone without becoming a new public write',async(_version,fields)=>{
  const s=await setup(),saved=await s.savedHistorical(fields()),before=await s.applications();
  await expect(s.source.submit({operationId:randomUUID(),fields:saved.fields})).rejects.toThrow('INVALID_REQUEST');
  const replay=await s.source.submit({operationId:saved.operationId,fields:saved.fields});
  expect(replay).toMatchObject({saved:true,replayed:true,duplicate:true,item:{id:saved.id,fields:saved.fields}});
  const {preview,result}=await s.convert(saved.id);
  expect(preview).toMatchObject({language:'he',phone:saved.fields.phone??null,email:saved.fields.email,
   sourceDigest:privateDigest({workspaceId:s.workspace,record:replay.item},key)});
  const read=await new AcademyCrmStore(s.db,ring,key,s.clock).read(s.owner,result.personId,1);
  expect(read.contact.origin).toMatchObject({sourceApplicationId:saved.id,phone:saved.fields.phone??null,language:'he'});
  expect(await s.applications()).toEqual(before);
 });

it('legacy Sunday projection keeps its existing response and source digest',async()=>{
 const s=await setup(),saved=await s.source.submit({operationId:randomUUID(),fields:{parentName:'Synthetic legacy Sunday',
  contact:'legacy@example.invalid',language:'en',cityArea:'Synthetic Florida',programId:'sunday_fishing_academy',schedulePreference:['sunday'],
  permission:{confirmed:true,version:floridaGroupApplicationNotice.version,language:'en'}}});
 const before=await s.applications(),{preview}=await s.convert(saved.item.id);
 expect(preview).toEqual({sourceApplicationId:saved.item.id,sourceDigest:privateDigest({workspaceId:s.workspace,record:saved.item},key),
  name:'Synthetic legacy Sunday',phone:null,email:'legacy@example.invalid',language:'en',existingPersonId:null});
 expect(await s.applications()).toEqual(before);
});

it('a changed source digest or reused operation with different input creates no extra contact',async()=>{
 const s=await setup(),saved=await s.submit(),preview=await s.crm.previewInquiry(s.owner,saved.item.id,1);
 const command:AcademyCrmCommand={action:'from_inquiry',operationId:randomUUID(),expectedEpoch:1,
  sourceApplicationId:saved.item.id,sourceDigest:'0'.repeat(64),fields:admin};
 await expect(s.crm.execute(s.owner,command)).rejects.toThrow('CONFLICT');
 expect(await s.count('ls_contact_ops.academy_crm_contacts')).toBe(0);
 const result=await s.crm.execute(s.owner,{...command,sourceDigest:preview.sourceDigest});
 await expect(s.crm.execute(s.owner,{...command,sourceDigest:preview.sourceDigest,fields:{...admin,notes:'changed'}})).rejects.toThrow('CONFLICT');
 expect((await s.crm.read(s.owner,result.personId,1)).contact.version).toBe(1);
 expect(await s.count('ls_contact_ops.academy_crm_contacts')).toBe(1);
});

it('preview and conversion reject actual parent, revoked owner, cross-workspace reference and stale epoch',async()=>{
 const s=await setup(),other=await setup(),saved=await s.submit(),before=await s.applications();
 await expect(s.crm.previewInquiry({...s.parent,role:'practitioner'},saved.item.id,1)).rejects.toThrow('FORBIDDEN');
 await expect(s.crm.previewInquiry(s.owner,saved.item.id,0)).rejects.toThrow('CONFLICT');
 await expect(other.crm.previewInquiry(other.owner,saved.item.id,1)).rejects.toThrow('NOT_FOUND');
 await engine.query('UPDATE ls_identity.sessions SET revoked_at=$2 WHERE token_digest=$1',[s.owner.sessionDigest,initial]);
 await expect(s.crm.previewInquiry(s.owner,saved.item.id,1)).rejects.toThrow('UNAUTHENTICATED');
 expect(await s.count('ls_contact_ops.academy_crm_contacts')).toBe(0);expect(await s.applications()).toEqual(before);
});

it('retired or other-program source cannot enter the Sunday CRM',async()=>{
 const s=await setup(),saved=await s.source.submit({operationId:randomUUID(),fields:{parentName:'Synthetic other program',
  contact:'other-program@example.invalid',language:'en',cityArea:'Synthetic Florida',programId:'private_fishing_life_skills',
  schedulePreference:['sunday'],permission:{confirmed:true,version:floridaGroupApplicationNotice.version,language:'en'}}});
 const before=await s.applications();await expect(s.crm.previewInquiry(s.owner,saved.item.id,1)).rejects.toThrow('NOT_FOUND');
 await expect(s.crm.withInquiryContact(s.owner,{reference:saved.item.id,expectedEpoch:1,intent:'read'},async()=>true)).rejects.toThrow('NOT_FOUND');
 expect(await s.count('ls_contact_ops.academy_crm_contacts')).toBe(0);expect(await s.applications()).toEqual(before);
});

it('source AEAD and full-record HMAC are verified by the real decoder',async()=>{
 const s=await setup(),fields=currentTrip390Fields(),id=randomUUID();
 await engine.query(`INSERT INTO ls_service_interest.public_applications(workspace_id,id,contact_digest,request_digest,payload_ciphertext,notice_version,notice_language,received_at)
  VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[s.workspace,id,'a'.repeat(64),'b'.repeat(64),
  seal(JSON.stringify(fields),groupApplicationPayloadAad(s.workspace,id),ring),fields.acknowledgment.version,'en',initial]);
 await expect(s.crm.previewInquiry(s.owner,id,1)).rejects.toThrow('UNAVAILABLE');
 const other=randomUUID(),digest=groupApplicationRequestDigest(s.workspace,fields,key);
 await engine.query(`INSERT INTO ls_service_interest.public_applications(workspace_id,id,contact_digest,request_digest,payload_ciphertext,notice_version,notice_language,received_at)
  VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[s.workspace,other,'c'.repeat(64),digest,
  seal(JSON.stringify(fields),groupApplicationPayloadAad(s.workspace,id),ring),fields.acknowledgment.version,'en',initial]);
 await expect(s.crm.previewInquiry(s.owner,other,1)).rejects.toThrow('UNAVAILABLE');
 expect(await s.count('ls_contact_ops.academy_crm_contacts')).toBe(0);
});

it('the internal read port returns only exact admitted source/contact provenance in a genuine read-only transaction',async()=>{
 const s=await setup(),saved=await s.submit(),{result,preview}=await s.convert(saved.item.id),before=await s.applications();
 const counter=(await s.authority.read(s.owner)).nativeWritesSinceSwitch;s.statements.length=0;
 const answer=await s.crm.withInquiryContact(s.owner,{reference:saved.item.id,expectedEpoch:1,intent:'read'},async context=>{
  expect(context.record).toEqual(saved.item);expect(context.sourceDigest).toBe(preview.sourceDigest);
  expect(context.contact).toMatchObject({personId:result.personId,outboundEligible:false,origin:{language:'he',kind:'inquiry'}});
  expect(context.authorityEpoch).toBe(1);expect(context).not.toHaveProperty('guardianVerified');
  const mode=await context.tx.query<{transaction_read_only:string}>('SHOW transaction_read_only');expect(mode[0]?.transaction_read_only).toBe('on');
  return context.contact.personId;
 });
 expect(answer).toBe(result.personId);expect((await s.authority.read(s.owner)).nativeWritesSinceSwitch).toBe(counter);
 expect(s.statements.some(sql=>sql.includes('FOR SHARE'))).toBe(false);
 expect(await s.applications()).toEqual(before);
});

it('the read port cannot execute a real database mutation',async()=>{
 const s=await setup(),saved=await s.submit();await s.convert(saved.item.id);
 const before=(await engine.query('SELECT * FROM ls_contact_ops.cutover WHERE workspace_id=$1',[s.workspace])).rows;
 await expect(s.crm.withInquiryContact(s.owner,{reference:saved.item.id,expectedEpoch:1,intent:'read'},async c=>{
  await c.tx.query("UPDATE ls_identity.accounts SET locale='he' WHERE workspace_id=$1 AND id=$2",[s.workspace,s.owner.id]);
 })).rejects.toThrow('read-only transaction');
 expect((await engine.query<{locale:string}>('SELECT locale FROM ls_identity.accounts WHERE id=$1',[s.owner.id])).rows[0]?.locale).toBe('en');
 expect((await engine.query('SELECT * FROM ls_contact_ops.cutover WHERE workspace_id=$1',[s.workspace])).rows).toEqual(before);
});

it('the port never matches a manual contact by email or uses a contact from another source',async()=>{
 const s=await setup(),saved=await s.submit();
 await s.crm.execute(s.owner,{action:'create',operationId:randomUUID(),expectedEpoch:1,
  fields:{...admin,name:'Manual same endpoint',phone:null,email:'synthetic@example.invalid',language:'he',relationship:'guardian'}});
 const work=vi.fn(async()=>true);
 await expect(s.crm.withInquiryContact(s.owner,{reference:saved.item.id,expectedEpoch:1,intent:'read'},work)).rejects.toThrow('NOT_FOUND');
 const otherFields=currentTrip390Fields();otherFields.email='another@example.invalid';otherFields.phone='+12025550102';
 const other=await s.source.submit({operationId:randomUUID(),fields:otherFields});await s.convert(other.item.id);
 await expect(s.crm.withInquiryContact(s.owner,{reference:saved.item.id,expectedEpoch:1,intent:'write'},work)).rejects.toThrow('NOT_FOUND');
 expect(work).not.toHaveBeenCalled();
});

it('the port rejects stale epoch, raw subject mismatch and a current-session reference in another workspace',async()=>{
 const s=await setup(),other=await setup(),saved=await s.submit();await s.convert(saved.item.id);
 const work=vi.fn(async()=>true);
 await expect(s.crm.withInquiryContact(s.owner,{reference:saved.item.id,expectedEpoch:0,intent:'read'},work)).rejects.toThrow('CONFLICT');
 await expect(s.crm.withInquiryContact({...s.owner,personId:s.parent.personId},{reference:saved.item.id,expectedEpoch:1,intent:'write'},work)).rejects.toThrow('UNAUTHENTICATED');
 await expect(other.crm.withInquiryContact(other.owner,{reference:saved.item.id,expectedEpoch:1,intent:'read'},work)).rejects.toThrow('NOT_FOUND');
 expect(work).not.toHaveBeenCalled();
});

it('the write port commits callback work and one existing Cutover counter only after fresh terminal checks',async()=>{
 const s=await setup(),saved=await s.submit();await s.convert(saved.item.id);
 const before=(await s.authority.read(s.owner)).nativeWritesSinceSwitch,source=await s.applications();s.statements.length=0;
 expect(await s.crm.withInquiryContact(s.owner,{reference:saved.item.id,expectedEpoch:1,intent:'write'},async c=>{
  await c.tx.query("UPDATE ls_identity.accounts SET locale='he' WHERE workspace_id=$1 AND id=$2",[s.workspace,s.owner.id]);return 'saved';
 })).toBe('saved');
 const last=s.statements.at(-1)!;expect(last).toContain('JOIN ls_identity.account_subjects');expect(last).toContain('subject.person_id=$4');
 expect(s.statements.some(sql=>sql.includes('FOR SHARE OF s,a,subject'))).toBe(true);
 expect(s.statements.some(sql=>sql.includes('FOR SHARE OF a,p,i,r'))).toBe(true);
 expect((await s.authority.read(s.owner)).nativeWritesSinceSwitch).toBe(before+1);
 expect((await engine.query<{locale:string}>('SELECT locale FROM ls_identity.accounts WHERE id=$1',[s.owner.id])).rows[0]?.locale).toBe('he');
 expect(await s.applications()).toEqual(source);
});

it('callback rejection rolls back the real callback mutation and does not advance the counter',async()=>{
 const s=await setup(),saved=await s.submit();await s.convert(saved.item.id);
 const before=(await engine.query('SELECT * FROM ls_contact_ops.cutover WHERE workspace_id=$1',[s.workspace])).rows;
 await expect(s.crm.withInquiryContact(s.owner,{reference:saved.item.id,expectedEpoch:1,intent:'write'},async c=>{
  await c.tx.query("UPDATE ls_identity.accounts SET locale='he' WHERE id=$1",[s.owner.id]);throw Error('SYNTHETIC_CALLBACK_REJECTED');
 })).rejects.toThrow('SYNTHETIC_CALLBACK_REJECTED');
 expect((await engine.query<{locale:string}>('SELECT locale FROM ls_identity.accounts WHERE id=$1',[s.owner.id])).rows[0]?.locale).toBe('en');
 expect((await engine.query('SELECT * FROM ls_contact_ops.cutover WHERE workspace_id=$1',[s.workspace])).rows).toEqual(before);
});

it('actual session revocation after the counter save rolls back callback, session change and counter',async()=>{
 const s=await setup(),saved=await s.submit();await s.convert(saved.item.id);
 const before=(await engine.query('SELECT * FROM ls_contact_ops.cutover WHERE workspace_id=$1',[s.workspace])).rows;
 const count=(await s.authority.read(s.owner)).nativeWritesSinceSwitch,events:string[]=[];let armed=false;
 s.observe(async(direct,sql)=>{
  if(!armed||!sql.startsWith('INSERT INTO ls_contact_ops.cutover('))return;armed=false;
  const stored=(await direct.query<{ciphertext:string}>('SELECT state_ciphertext AS ciphertext FROM ls_contact_ops.cutover WHERE workspace_id=$1',[s.workspace]))[0]!;
  expect(JSON.parse(unseal(stored.ciphertext,`ls_contact_ops/cutover/v1/${s.workspace}/1`,ring)).nativeWritesSinceSwitch).toBe(count+1);
  events.push('actual_counter_saved');await direct.query('UPDATE ls_identity.sessions SET revoked_at=$2 WHERE token_digest=$1',[s.owner.sessionDigest,initial]);
  events.push('actual_session_revoked');
 });
 try{
  await expect(s.crm.withInquiryContact(s.owner,{reference:saved.item.id,expectedEpoch:1,intent:'write'},async c=>{
   await c.tx.query("UPDATE ls_identity.accounts SET locale='he' WHERE id=$1",[s.owner.id]);armed=true;return 'must not commit';
  })).rejects.toThrow('UNAUTHENTICATED');
 }finally{s.observe(null);}
 expect(events).toEqual(['actual_counter_saved','actual_session_revoked']);
 expect((await engine.query('SELECT * FROM ls_contact_ops.cutover WHERE workspace_id=$1',[s.workspace])).rows).toEqual(before);
 expect((await engine.query<{locale:string}>('SELECT locale FROM ls_identity.accounts WHERE id=$1',[s.owner.id])).rows[0]?.locale).toBe('en');
 expect((await engine.query<{revoked_at:Date|null}>('SELECT revoked_at FROM ls_identity.sessions WHERE token_digest=$1',[s.owner.sessionDigest])).rows[0]?.revoked_at).toBeNull();
});

it('terminal source/contact integrity rejects changed origin and rolls it back with the counter',async()=>{
 const s=await setup(),saved=await s.submit(),{result}=await s.convert(saved.item.id);
 const before=(await engine.query('SELECT * FROM ls_contact_ops.cutover WHERE workspace_id=$1',[s.workspace])).rows;
 const original=(await engine.query<{payload_ciphertext:string}>('SELECT payload_ciphertext FROM ls_contact_ops.profiles WHERE workspace_id=$1 AND person_id=$2',[s.workspace,result.personId])).rows[0]!;
 await expect(s.crm.withInquiryContact(s.owner,{reference:saved.item.id,expectedEpoch:1,intent:'write'},async c=>{
  const profile=JSON.parse(unseal(original.payload_ciphertext,crmProfileAad(s.workspace,result.personId),ring));
  profile.academyOrigin.sourceDigest='e'.repeat(64);
  await c.tx.query('UPDATE ls_contact_ops.profiles SET payload_ciphertext=$3 WHERE workspace_id=$1 AND person_id=$2',
   [s.workspace,result.personId,seal(JSON.stringify(profile),crmProfileAad(s.workspace,result.personId),ring)]);
 })).rejects.toThrow('CONFLICT');
 expect((await engine.query<{payload_ciphertext:string}>('SELECT payload_ciphertext FROM ls_contact_ops.profiles WHERE workspace_id=$1 AND person_id=$2',[s.workspace,result.personId])).rows[0]).toEqual(original);
 expect((await engine.query('SELECT * FROM ls_contact_ops.cutover WHERE workspace_id=$1',[s.workspace])).rows).toEqual(before);
});

it('terminal validation rejects a changed actual account subject and an expired session after read work',async()=>{
 const s=await setup(),saved=await s.submit(),{result}=await s.convert(saved.item.id);
 await expect(s.crm.withInquiryContact(s.owner,{reference:saved.item.id,expectedEpoch:1,intent:'write'},async c=>{
  await c.tx.query('UPDATE ls_identity.account_subjects SET person_id=$3 WHERE workspace_id=$1 AND account_id=$2',[s.workspace,s.owner.id,result.personId]);
 })).rejects.toThrow('UNAUTHENTICATED');
 expect((await engine.query<{person_id:string}>('SELECT person_id FROM ls_identity.account_subjects WHERE workspace_id=$1 AND account_id=$2',[s.workspace,s.owner.id])).rows[0]?.person_id).toBe(s.owner.personId);
 await expect(s.crm.withInquiryContact(s.owner,{reference:saved.item.id,expectedEpoch:1,intent:'read'},async()=>{
  s.advance(new Date('2036-01-01T00:00:00Z'));return true;
 })).rejects.toThrow('UNAUTHENTICATED');
});

it.each(['read','write'] as const)('the %s port denies a revoked real session and forged parent role before callback',async intent=>{
 const s=await setup(),saved=await s.submit();await s.convert(saved.item.id);
 const work=vi.fn(async()=>true),before=(await engine.query('SELECT * FROM ls_contact_ops.cutover WHERE workspace_id=$1',[s.workspace])).rows;
 await expect(s.crm.withInquiryContact({...s.parent,role:'practitioner'},{reference:saved.item.id,expectedEpoch:1,intent},work)).rejects.toThrow('FORBIDDEN');
 await engine.query('UPDATE ls_identity.sessions SET revoked_at=$2 WHERE token_digest=$1',[s.owner.sessionDigest,initial]);
 await expect(s.crm.withInquiryContact(s.owner,{reference:saved.item.id,expectedEpoch:1,intent},work)).rejects.toThrow('UNAUTHENTICATED');
 expect(work).not.toHaveBeenCalled();
 expect((await engine.query('SELECT * FROM ls_contact_ops.cutover WHERE workspace_id=$1',[s.workspace])).rows).toEqual(before);
});

it('uninitialized Academy source has no automatic initialization or retired Sheet fallback',async()=>{
 const s=await setup(false),saved=await s.submit(),before=await s.applications(),work=vi.fn(async()=>true);
 await expect(s.crm.withInquiryContact(s.owner,{reference:saved.item.id,expectedEpoch:0,intent:'read'},work)).rejects.toThrow('CONFLICT');
 expect(await s.authority.read(s.owner)).toMatchObject({phase:'sheet_active',epoch:0,nativeWritesSinceSwitch:0});
 expect(await s.count('ls_contact_ops.cutover_history')).toBe(0);expect(await s.count('ls_contact_ops.academy_crm_contacts')).toBe(0);
 expect(work).not.toHaveBeenCalled();expect(await s.applications()).toEqual(before);
});

it('an admitted profile from a different initialization cannot supply a port context',async()=>{
 const s=await setup(),saved=await s.submit(),{result}=await s.convert(saved.item.id),work=vi.fn(async()=>true);
 const original=(await engine.query<{payload_ciphertext:string}>('SELECT payload_ciphertext FROM ls_contact_ops.profiles WHERE workspace_id=$1 AND person_id=$2',[s.workspace,result.personId])).rows[0]!;
 const profile=JSON.parse(unseal(original.payload_ciphertext,crmProfileAad(s.workspace,result.personId),ring));
 profile.academyOrigin.initializationId=randomUUID();
 await engine.query('UPDATE ls_contact_ops.profiles SET payload_ciphertext=$3 WHERE workspace_id=$1 AND person_id=$2',
  [s.workspace,result.personId,seal(JSON.stringify(profile),crmProfileAad(s.workspace,result.personId),ring)]);
 await expect(s.crm.withInquiryContact(s.owner,{reference:saved.item.id,expectedEpoch:1,intent:'read'},work)).rejects.toThrow('UNAVAILABLE');
 expect(work).not.toHaveBeenCalled();
});

type Setup=Awaited<ReturnType<typeof setup>>;
const dataInput=(s:Setup,reference:string,lock:'shared'|'snapshot'='snapshot'):AcademyInquiryContactDataInput=>
 ({workspaceId:s.workspace,reference,expectedEpoch:1,lock});
const dataRead=(s:Setup,reference:string,lock:'shared'|'snapshot'='snapshot')=>s.db.transaction(tx=>s.crm.readInquiryContactDataInTransaction(tx,dataInput(s,reference,lock)));

it('current-data snapshot reuses one actually authenticated owner TX and preserves source, native, proposal, old ACK and counter bytes',async()=>{
  const s=await setup(true,true),saved=await s.submit(),{result,preview}=await s.convert(saved.item.id);
  if(!isTrip390Interest(saved.item.fields))throw Error('SYNTHETIC_CURRENT_SOURCE');
  const familyId=randomUUID();await engine.query('INSERT INTO ls_cases.families VALUES($1,$2,$3,$4)',[familyId,s.workspace,seal('SYNTHETIC Family',`family:${s.workspace}:${familyId}`,ring),initial]);
  await engine.query("INSERT INTO ls_cases.family_members VALUES($1,$2,$3,'guardian')",[s.workspace,familyId,result.personId]);
  const children=[];
  for(const child of saved.item.fields.children){const nativeChildId=randomUUID();
   await engine.query("INSERT INTO ls_identity.people VALUES($1,$2,'minor',$3,$4)",[nativeChildId,s.workspace,seal(JSON.stringify({displayName:'SYNTHETIC native child'}),`person:${s.workspace}:${nativeChildId}`,ring),initial]);
   await engine.query("INSERT INTO ls_cases.family_members VALUES($1,$2,$3,'child')",[s.workspace,familyId,nativeChildId]);children.push({applicationChildId:child.id,nativeChildId});
  }
  const proposals=new FishingBillingInquiryFamilyProposals(s.db,s.workspace,ring,key,s.clock),selection={reference:saved.item.id,familyId,children};
  const p=await proposals.preview(s.owner,{selection,expectedEpoch:1});
  const proposal=(await proposals.propose(s.owner,{operationId:randomUUID(),expectedEpoch:1,selection,expectedSourceDigest:p.sourceDigest,expectedNativeDigest:p.nativeDigest})).record;
  expect(proposal).toMatchObject({state:'proposed',guardianVerified:false,recipientVerified:false,financialAcceptance:false,outboundEligible:false});
  expect((await engine.query('SELECT purpose,state FROM ls_service_interest.inquiry_email_outbox WHERE workspace_id=$1',[s.workspace])).rows)
   .toEqual([{purpose:'academy_inquiry_acknowledgment_v1',state:'queued'}]);
  const protectedRows=async()=>Promise.all(['ls_service_interest.public_applications','ls_service_interest.public_application_operations',
   'ls_service_interest.inquiry_email_outbox','ls_fishing_billing.inquiry_family_proposals','ls_identity.people','ls_cases.families','ls_cases.family_members',
   'ls_contact_ops.cutover','ls_contact_ops.academy_crm_contacts','ls_contact_ops.academy_crm_activity'].map(async table=>
   (await engine.query(`SELECT to_jsonb(t) AS row FROM ${table} t WHERE workspace_id=$1 ORDER BY to_jsonb(t)::text`,[s.workspace])).rows));
  const before=await protectedRows(),transactions=s.transactionCount();let dataStatements:string[]=[];
  const data=await s.db.transaction(async tx=>{
   await tx.query('SET TRANSACTION READ ONLY');requirePractitioner(await freshActor(tx,s.owner,s.clock.now()));
   const begin=s.statements.length,value=await s.crm.readInquiryContactDataInTransaction(tx,dataInput(s,saved.item.id));dataStatements=s.statements.slice(begin);return value;
  });
  expect(s.transactionCount()).toBe(transactions+1);
  expect(data).toEqual({classification:'current_scope_data_only_not_authority',record:saved.item,sourceDigest:preview.sourceDigest,
   contact:(await s.crm.read(s.owner,result.personId,1)).contact,authorityEpoch:1,initializationId:s.initialization.operationId,consistency:'snapshot'});
  expect(dataStatements.every(sql=>sql.trimStart().startsWith('SELECT'))).toBe(true);
  expect(dataStatements.some(sql=>/FOR (SHARE|UPDATE)|advisory|SET TRANSACTION/.test(sql))).toBe(false);
  expect(Object.isFrozen(data)).toBe(true);expect(Object.isFrozen(data.record.fields)).toBe(true);expect(Object.isFrozen(data.contact.origin)).toBe(true);
  if('children' in data.record.fields)expect(Object.isFrozen(data.record.fields.children[0])).toBe(true);
  expect(()=>Object.defineProperty(data.contact.origin,'language',{value:'en'})).toThrow(TypeError);
  expect(data).not.toHaveProperty('actor');expect(data).not.toHaveProperty('permission');expect(await protectedRows()).toEqual(before);
});

it('current-data shared mode executes the existing nonblocking fence before actual Cutover/source locks inside a workspace-held TX',async()=>{
 const s=await setup(),saved=await s.submit();await s.convert(saved.item.id);
 const before=(await engine.query('SELECT * FROM ls_contact_ops.cutover WHERE workspace_id=$1',[s.workspace])).rows;
 const calls:{sql:string;values:readonly unknown[]}[]=[];
 const data=await s.db.transaction(async tx=>{
  await lockWorkspace(tx,s.workspace);requirePractitioner(await freshActor(tx,s.owner,s.clock.now()));
  return s.crm.readInquiryContactDataInTransaction({query:async<T extends object>(sql:string,values:readonly unknown[]=[])=>{
   const rows=await tx.query<T>(sql,values);calls.push({sql,values});return rows;
  }},dataInput(s,saved.item.id,'shared'));
 });
 expect(data.consistency).toBe('shared');expect(calls[0]).toEqual({sql:'SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS locked',values:[`${s.workspace}:contact-authority`]});
 expect(calls[1]!.sql).toContain('ls_contact_ops.cutover');expect(calls[1]!.sql).toContain('FOR SHARE');
 expect(calls.some(c=>c.sql.includes('FOR SHARE OF a,p,i,r'))).toBe(true);
 expect((await engine.query('SELECT * FROM ls_contact_ops.cutover WHERE workspace_id=$1',[s.workspace])).rows).toEqual(before);
});

it.each(['false','missing'] as const)('current-data %s fence result fails closed before row locks using qualified real-query-result fault injection',async fault=>{
 const s=await setup(),saved=await s.submit();await s.convert(saved.item.id);const statements:string[]=[];
 const before=await s.applications(),counter=(await engine.query('SELECT * FROM ls_contact_ops.cutover WHERE workspace_id=$1',[s.workspace])).rows;
 await expect(s.db.transaction(async tx=>{
  await lockWorkspace(tx,s.workspace);
  return s.crm.readInquiryContactDataInTransaction({query:async<T extends object>(sql:string,values:readonly unknown[]=[])=>{
   const rows=await tx.query<T>(sql,values);statements.push(sql);
   // Execute actual pg_try first, then inject only a DENIAL result. This is
   // failure-branch testing, NOT competing PostgreSQL connection contention.
   if(sql.startsWith('SELECT pg_try_advisory_xact_lock'))return fault==='missing'?[]:rows.map(r=>({...r,locked:false}));
   return rows;
  }},dataInput(s,saved.item.id,'shared'));
 })).rejects.toThrow('CONFLICT');
 expect(statements).toEqual(['SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS locked']);
 expect(await s.applications()).toEqual(before);
 expect((await engine.query('SELECT * FROM ls_contact_ops.cutover WHERE workspace_id=$1',[s.workspace])).rows).toEqual(counter);
});

it('current-data snapshot is genuine READONLY compatible while shared row locking is rejected by the database',async()=>{
 const s=await setup(),saved=await s.submit();await s.convert(saved.item.id);
 expect(await s.db.transaction(async tx=>{await tx.query('SET TRANSACTION READ ONLY');return s.crm.readInquiryContactDataInTransaction(tx,dataInput(s,saved.item.id));}))
  .toMatchObject({consistency:'snapshot',contact:{outboundEligible:false}});
 await expect(s.db.transaction(async tx=>{await tx.query('SET TRANSACTION READ ONLY');return s.crm.readInquiryContactDataInTransaction(tx,dataInput(s,saved.item.id,'shared'));})).rejects.toThrow('read-only transaction');
});

it('current-data preserves authenticated historical email-only source bytes without granting current offer authority',async()=>{
 const s=await setup(),saved=await s.savedHistorical(v1()),before=await s.applications();await s.convert(saved.id);
 const data=await dataRead(s,saved.id);expect(data).toMatchObject({classification:'current_scope_data_only_not_authority',record:{fields:saved.fields},contact:{origin:{phone:null,language:'he'},outboundEligible:false}});
 expect(await s.applications()).toEqual(before);
});

it('current-data rejects absent initialization and stale epochs with no initialization or counter writes',async()=>{
 const empty=await setup(false),source=await empty.submit();
 for(const mode of ['snapshot','shared'] as const)await expect(empty.db.transaction(tx=>empty.crm.readInquiryContactDataInTransaction(tx,{...dataInput(empty,source.item.id,mode),expectedEpoch:0}))).rejects.toThrow('CONFLICT');
 expect(await empty.count('ls_contact_ops.cutover')).toBe(0);expect(await empty.count('ls_contact_ops.cutover_history')).toBe(0);
 const s=await setup(),saved=await s.submit();await s.convert(saved.item.id);
 await expect(s.db.transaction(tx=>s.crm.readInquiryContactDataInTransaction(tx,{...dataInput(s,saved.item.id),expectedEpoch:0}))).rejects.toThrow('CONFLICT');
});

it('current-data requires exact admitted source, workspace and program without matching by identity endpoints',async()=>{
 const s=await setup(),other=await setup(),saved=await s.submit();
 await expect(dataRead(s,saved.item.id)).rejects.toThrow('NOT_FOUND');await s.convert(saved.item.id);
 await expect(dataRead(other,saved.item.id)).rejects.toThrow('NOT_FOUND');await expect(dataRead(s,randomUUID())).rejects.toThrow('NOT_FOUND');
 const wrong=await s.source.submit({operationId:randomUUID(),fields:{parentName:'SYNTHETIC other program',contact:'other@example.invalid',language:'en',cityArea:'SYNTHETIC Florida',
  programId:'private_fishing_life_skills',schedulePreference:['sunday'],permission:{confirmed:true,version:floridaGroupApplicationNotice.version,language:'en'}}});
 await expect(dataRead(s,wrong.item.id)).rejects.toThrow('NOT_FOUND');
});

it('current-data authenticates the real source decoder before an unadmitted record can hide corruption',async()=>{
 const s=await setup(),id=randomUUID(),fields=currentTrip390Fields();
 await engine.query(`INSERT INTO ls_service_interest.public_applications(workspace_id,id,contact_digest,request_digest,payload_ciphertext,notice_version,notice_language,received_at)
  VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[s.workspace,id,'a'.repeat(64),'b'.repeat(64),seal(JSON.stringify(fields),groupApplicationPayloadAad(s.workspace,id),ring),fields.acknowledgment.version,'en',initial]);
 await expect(dataRead(s,id)).rejects.toThrow('UNAVAILABLE');
});

it('current-data rejects a sealed profile whose initialization disagrees with current immutable admission',async()=>{
 const s=await setup(),saved=await s.submit(),{result}=await s.convert(saved.item.id);
 const row=(await engine.query<{payload_ciphertext:string}>('SELECT payload_ciphertext FROM ls_contact_ops.profiles WHERE workspace_id=$1 AND person_id=$2',[s.workspace,result.personId])).rows[0]!;
 const profile=JSON.parse(unseal(row.payload_ciphertext,crmProfileAad(s.workspace,result.personId),ring));profile.academyOrigin.initializationId=randomUUID();
 await engine.query('UPDATE ls_contact_ops.profiles SET payload_ciphertext=$3 WHERE workspace_id=$1 AND person_id=$2',[s.workspace,result.personId,seal(JSON.stringify(profile),crmProfileAad(s.workspace,result.personId),ring)]);
 await expect(dataRead(s,saved.item.id)).rejects.toThrow('UNAVAILABLE');
});

it('current-data rejects invalid or authority-shaped inputs before any query',async()=>{
 const s=await setup(),saved=await s.submit();s.statements.length=0;
 for(const bad of [{...dataInput(s,saved.item.id),actor:s.owner},{...dataInput(s,saved.item.id),expectedEpoch:-1},{...dataInput(s,saved.item.id),lock:'write'}])
  await expect(s.db.transaction(tx=>s.crm.readInquiryContactDataInTransaction(tx,bad as AcademyInquiryContactDataInput))).rejects.toThrow('INVALID_REQUEST');
 expect(s.statements).toEqual([]);
});

it('current-data pins caller workspace, reference and bound transaction before the first awaited query',async()=>{
 const s=await setup(),saved=await s.submit();await s.convert(saved.item.id);const request=dataInput(s,saved.item.id);let changed=false;
 const data=await s.db.transaction(async direct=>{
  const tx:SqlSession={query:async<T extends object>(sql:string,values:readonly unknown[]=[])=>{
   const rows=await direct.query<T>(sql,values);if(!changed){changed=true;request.workspaceId=asId(randomUUID(),'workspace');request.reference=randomUUID();request.expectedEpoch=0;
    tx.query=undefined as unknown as SqlSession['query'];}return rows;
  }};
  return s.crm.readInquiryContactDataInTransaction(tx,request);
 });
 expect(changed).toBe(true);expect(data.record.id).toBe(saved.item.id);expect(data.authorityEpoch).toBe(1);expect(data.contact.origin.language).toBe('he');
});

it('current-data recorded scope is not current owner session access',async()=>{
 const s=await setup(),saved=await s.submit();await s.convert(saved.item.id);
 await engine.query('UPDATE ls_identity.sessions SET revoked_at=$2 WHERE token_digest=$1',[s.owner.sessionDigest,initial]);
 expect(await dataRead(s,saved.item.id)).toMatchObject({classification:'current_scope_data_only_not_authority',contact:{outboundEligible:false}});
 await expect(s.crm.withInquiryContact(s.owner,{reference:saved.item.id,expectedEpoch:1,intent:'read'},async()=>true)).rejects.toThrow('UNAUTHENTICATED');
});
