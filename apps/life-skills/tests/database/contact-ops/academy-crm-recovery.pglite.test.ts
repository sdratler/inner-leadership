import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {afterAll,afterEach,beforeAll,expect,it,vi} from 'vitest';
import {asId} from '../../../src/lib/ids.ts';
import type {Actor} from '../../../src/features/identity/types.ts';
import type {IdentityStore} from '../../../src/features/identity/store.ts';
import {seal,tokenDigest} from '../../../src/features/identity/crypto.ts';
import {ContactCutoverStore} from '../../../src/features/contact-ops/server/cutover-store.ts';
import {AcademyCrmStore} from '../../../src/features/contact-ops/server/academy-crm-store.ts';
import {NativeCrmStore} from '../../../src/features/contact-ops/server/native-store.ts';
import type {AcademyCrmCommand,AcademyInitializationInput} from '../../../src/features/contact-ops/core/academy-crm.ts';
import {PublicGroupApplicationStore} from '../../../src/features/group-application/store.ts';
import {currentTrip390Fields} from '../../fixtures/trip390-current.ts';
import {requirePgliteMemoryEnvironment} from '../../fixtures/pglite-memory-environment.ts';
vi.mock('server-only',()=>({}));

// Actual stores and registered DDL, exported then loaded into a different
// in-memory PostgreSQL engine. This proves synthetic PGlite recovery only,
// not a production PostgreSQL backup, external fence, or cutover permit.
const engines:PGlite[]=[];
const ring={activeKeyId:'synthetic',keys:{synthetic:Buffer.alloc(32,19)}};
const integrityKey='synthetic-academy-recovery-integrity-key-only';
const clock={now:()=>new Date('2035-01-06T15:00:00Z')};
const network=vi.fn<typeof fetch>(async()=>{throw Error('NO_NETWORK_IN_CRM_RECOVERY');});
const admin={stage:'Manually sourced adult',nextAction:'Ask about a community partnership',followUpDate:'2035-01-08',notes:'Synthetic conversation only'};
beforeAll(()=>{requirePgliteMemoryEnvironment(process.env);vi.stubGlobal('fetch',network);});
afterEach(()=>{expect(globalThis.fetch).toBe(network);expect(network).not.toHaveBeenCalled();});
afterAll(async()=>{try{for(const engine of engines)if(!engine.closed)await engine.close();}finally{vi.unstubAllGlobals();}});

function stores(engine:PGlite){
 const db:IdentityStore={transaction:work=>engine.transaction(async tx=>work({query:async<T extends object>(sql:string,values:readonly unknown[]=[])=>
  (await tx.query<T>(sql,[...values])).rows}))};
 return {db,authority:new ContactCutoverStore(db,ring,integrityKey,clock),crm:new AcademyCrmStore(db,ring,integrityKey,clock)};
}
async function setup(){
 const engine=new PGlite();engines.push(engine);
 await engine.exec('CREATE SCHEMA ls_control');
 const manifest=JSON.parse(await readFile('migrations/manifest.json','utf8')) as {name:string;sha256:string}[];
 for(const name of ['0001_ls_foundation.sql','0010_ls_identity_cases_20260906.sql','0030_ls_calendar_attendance_20260907.sql',
  '0097_ls_demo_provenance.sql','0101_ls_contact_operations.sql','0102_ls_internal_tasks.sql','0105_ls_contact_authority.sql',
  '0110_ls_contact_outbound_projection.sql','0116_ls_acquisition_candidates.sql','0124_ls_group_interest.sql',
  '0131_ls_public_group_applications.sql','0133_ls_fishing_lead_memberships.sql','0135_ls_inquiry_email_outbox.sql','0138_ls_academy_crm.sql']){
  const sql=await readFile('migrations/'+name,'utf8');
  expect(createHash('sha256').update(sql.replaceAll('\r\n','\n')).digest('hex')).toBe(manifest.find(row=>row.name===name)?.sha256);
  await engine.exec(sql);
 }
 const workspace=asId(randomUUID(),'workspace'),id=asId(randomUUID(),'account'),personId=asId(randomUUID(),'person');
 const sessionDigest=tokenDigest(randomBytes(32).toString('base64url'));
 await engine.query('INSERT INTO ls_identity.workspaces(id,created_at) VALUES($1,$2)',[workspace,clock.now()]);
 await engine.query("INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,'adult',$3,$4)",
  [personId,workspace,seal(JSON.stringify({displayName:'Synthetic Recovery Owner'}),`person:${workspace}:${personId}`,ring),clock.now()]);
 await engine.query(`INSERT INTO ls_identity.accounts(id,workspace_id,role,state,locale,email_blind,email_ciphertext,email_verified_at,password_hash,created_at,updated_at)
  VALUES($1,$2,'practitioner','active','en',$3,$4,$5,'synthetic-non-login-hash',$5,$5)`,
  [id,workspace,createHash('sha256').update(id).digest('hex'),seal('synthetic-owner@example.invalid',`email:${workspace}:${id}`,ring),clock.now()]);
 await engine.query('INSERT INTO ls_identity.account_subjects(workspace_id,account_id,person_id) VALUES($1,$2,$3)',[workspace,id,personId]);
 await engine.query('INSERT INTO ls_identity.sessions(token_digest,workspace_id,account_id,created_at,expires_at) VALUES($1,$2,$3,$4,$5)',
  [sessionDigest,workspace,id,clock.now(),new Date('2036-01-01T00:00:00Z')]);
 const actor:Actor={id,personId,workspaceId:workspace,role:'practitioner',state:'active',locale:'en',sessionDigest,expiresAt:Date.parse('2036-01-01T00:00:00Z')};
 // Fixture hashes deliberately identify synthetic evidence. They may never
 // be carried into an actual initialization request or readiness receipt.
 const initialization:AcademyInitializationInput={operationId:randomUUID(),expectedEpoch:0,observedNativeWritesSinceSwitch:0,
  decisionId:'ACADEMY-ONLY-CRM-20261028-01',evidence:{retiredSourcesFence:'a'.repeat(64),retiredSchedulesFence:'b'.repeat(64),
   retainedAcademyRecords:'c'.repeat(64),queueReconciliation:'d'.repeat(64),restorePlan:'e'.repeat(64)}};
 return {engine,actor,initialization,...stores(engine)};
}
async function restore(engine:PGlite){
 const snapshot=await engine.dumpDataDir();
 expect(snapshot.size).toBeGreaterThan(0);
 await engine.close();
 const restored=new PGlite({loadDataDir:snapshot});engines.push(restored);await restored.waitReady;
 return {engine:restored,...stores(restored)};
}
async function rows(engine:PGlite,workspace:string,table:string){
 return (await engine.query(`SELECT to_jsonb(r) AS row FROM ${table} r WHERE workspace_id=$1 ORDER BY to_jsonb(r)::text`,[workspace])).rows;
}
const retainedTables=['ls_service_interest.public_applications','ls_service_interest.public_application_operations',
 'ls_contact_ops.cutover','ls_contact_ops.cutover_history','ls_contact_ops.profiles','ls_contact_ops.academy_crm_contacts',
 'ls_contact_ops.academy_crm_activity','ls_contact_ops.fishing_lead_operations','ls_contact_ops.fishing_lead_revisions'];

it('restores exact encrypted authority, inquiry, adult conversation and follow-up without duplicating contact operations',async()=>{
 const s=await setup();
 const source=new PublicGroupApplicationStore(s.db,s.actor.workspaceId,ring,integrityKey,clock,false);
 await source.submit({operationId:randomUUID(),fields:currentTrip390Fields()});
 const inquiryBefore=await rows(s.engine,s.actor.workspaceId,'ls_service_interest.public_applications');
 expect(await s.crm.list(s.actor)).toEqual({state:'setup_required',authorityEpoch:0});
 await s.authority.initializeAcademy(s.actor,s.initialization);
 expect(await rows(s.engine,s.actor.workspaceId,'ls_service_interest.public_applications')).toEqual(inquiryBefore);
 const create:AcademyCrmCommand={action:'create',operationId:randomUUID(),expectedEpoch:1,
  fields:{name:'Synthetic Community Partner',phone:null,email:'synthetic-partner@example.invalid',language:'en',relationship:'adult_partner',...admin}};
 const created=await s.crm.execute(s.actor,create);
 await s.crm.execute(s.actor,{action:'update',operationId:randomUUID(),expectedEpoch:1,personId:created.personId,expectedVersion:1,
  fields:{...admin,nextAction:'Owner to arrange a call',followUpDate:'2035-01-10'}});
 const note:AcademyCrmCommand={action:'note',operationId:randomUUID(),expectedEpoch:1,personId:created.personId,expectedVersion:2,
  text:'Synthetic community conversation; requested owner follow-up'};
 await s.crm.execute(s.actor,note);
 const before=await s.crm.read(s.actor,created.personId,1),stateBefore=await s.authority.read(s.actor);
 const bytesBefore=await Promise.all(retainedTables.map(table=>rows(s.engine,s.actor.workspaceId,table)));
 const encrypted=JSON.stringify(bytesBefore);
 expect(encrypted).not.toContain('Synthetic Community Partner');expect(encrypted).not.toContain(note.text);
 const r=await restore(s.engine);
 expect(await r.authority.read(s.actor)).toEqual(stateBefore);
 expect(await r.crm.read(s.actor,created.personId,1)).toEqual(before);
 expect(await Promise.all(retainedTables.map(table=>rows(r.engine,s.actor.workspaceId,table)))).toEqual(bytesBefore);
 expect((await r.authority.read(s.actor)).academy).toMatchObject({importedRows:0,operationId:s.initialization.operationId});
 expect(await r.crm.execute(s.actor,create)).toMatchObject({personId:created.personId,version:1,replayed:true,outboundEligible:false});
 expect(await r.crm.execute(s.actor,note)).toMatchObject({personId:created.personId,version:2,replayed:true,outboundEligible:false});
 expect(await r.crm.read(s.actor,created.personId,1)).toEqual(before);
 expect(await r.crm.list(s.actor,{search:'Owner to arrange a call'})).toMatchObject({state:'ready',total:1});
 for(const table of ['ls_contact_ops.legacy_links','ls_contact_ops.outbound_projections','ls_service_interest.inquiry_email_outbox'])
  expect(await rows(r.engine,s.actor.workspaceId,table)).toEqual([]);
 // A restored DB without its matching data key must fail closed.
 const wrongRing={activeKeyId:'synthetic',keys:{synthetic:Buffer.alloc(32,20)}};
 await expect(new AcademyCrmStore(r.db,wrongRing,integrityKey,clock).list(s.actor)).rejects.toThrow('UNAVAILABLE');
 await r.engine.query('UPDATE ls_identity.sessions SET revoked_at=$1 WHERE token_digest=$2',[clock.now(),s.actor.sessionDigest]);
 await expect(r.crm.list(s.actor)).rejects.toThrow('UNAUTHENTICATED');
},30000);

it('a restored pre-initialization database with an existing profile remains blocked and does not admit old records',async()=>{
 const s=await setup();
 await new NativeCrmStore(s.db,ring,integrityKey,clock).create(s.actor,{personId:s.actor.personId,...admin,legacyIds:[]},'synthetic-retired-profile');
 const before=await rows(s.engine,s.actor.workspaceId,'ls_contact_ops.profiles');
 const r=await restore(s.engine);
 await expect(r.authority.initializeAcademy(s.actor,s.initialization)).rejects.toThrow('CONFLICT');
 expect(await r.authority.read(s.actor)).toMatchObject({phase:'sheet_active',epoch:0,nativeWritesSinceSwitch:0});
 expect(await r.crm.list(s.actor)).toEqual({state:'setup_required',authorityEpoch:0});
 expect(await rows(r.engine,s.actor.workspaceId,'ls_contact_ops.profiles')).toEqual(before);
 expect(await rows(r.engine,s.actor.workspaceId,'ls_contact_ops.cutover_history')).toEqual([]);
 expect(await rows(r.engine,s.actor.workspaceId,'ls_contact_ops.academy_crm_contacts')).toEqual([]);
},30000);

it('restoring an unresolved outbound intent cannot bypass the initialization effect gate',async()=>{
 const s=await setup();
 await s.engine.query(`INSERT INTO ls_contact_ops.outbound_projections(workspace_id,operation_id,actor_account_id,legacy_lead_id,
  authority_epoch,request_digest,projection_ciphertext,state) VALUES($1,$2,$3,'LS-LEAD-synthetic-only',0,$4,$5,'prepared')`,
  [s.actor.workspaceId,randomUUID(),s.actor.id,'a'.repeat(64),'synthetic-private-projection']);
 const pending=await rows(s.engine,s.actor.workspaceId,'ls_contact_ops.outbound_projections');
 const r=await restore(s.engine);
 await expect(r.authority.initializeAcademy(s.actor,s.initialization)).rejects.toThrow('CONFLICT');
 expect(await r.authority.read(s.actor)).toMatchObject({phase:'sheet_active',epoch:0});
 expect(await rows(r.engine,s.actor.workspaceId,'ls_contact_ops.outbound_projections')).toEqual(pending);
 expect(await rows(r.engine,s.actor.workspaceId,'ls_contact_ops.cutover_history')).toEqual([]);
},30000);
