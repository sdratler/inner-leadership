/** Synthetic, nonce-owned PostgreSQL databases for the ordinary database test job.
 * The caller owns teardown. No provider target, production fallback or runtime flag. */
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import pg from 'pg';
import {safeTestUrl,poolStore} from './calendar/fixture.ts';
import {migrate} from '../../src/db/migration-runner.ts';
import type {Migration} from '../../src/db/migration-plan.ts';
import {asId} from '../../src/lib/ids.ts';
import {opaqueToken,seal,tokenDigest} from '../../src/features/identity/crypto.ts';
import {systemClock,type AccountRole,type Actor} from '../../src/features/identity/types.ts';
import type {IdentityConfig} from '../../src/features/identity/config.ts';
import {IdentitySessions} from '../../src/features/identity/session-adapter.ts';
import {PostgresIdentityRateStore} from '../../src/features/identity/rate-store.ts';
import {durableAuditSink} from '../../src/features/identity/history.ts';
import {AcademyFounderStore} from '../../src/features/group-application/academy-founder-store.ts';
import {PublicGroupApplicationStore} from '../../src/features/group-application/store.ts';
import {floridaAcademyRegistrationFieldsSchema} from '../../src/features/group-application/contract.ts';
import {ACADEMY_REGISTRATION_VERSION,registrationConsent} from '../../src/features/group-application/academy-registration.ts';
import {academyRegistrationNotice} from '../../src/features/group-application/academy-registration-notice.ts';
import {registrationAcknowledgments} from '../../src/features/group-application/academy-registration-acknowledgments.ts';
import {communicationPreferenceSelection} from '../../src/features/group-application/academy-communication-preferences.ts';

export function academyMigrationInventory():Migration[]{
 const entries=JSON.parse(readFileSync(new URL('../../migrations/manifest.json',import.meta.url),'utf8')) as {name:string;sha256:string}[];
 // The existing 57-entry founder/notification prefix stays in place; only the
 // fresh CRM preparation follows it. Every SQL file is still checksum-checked.
 if(entries.length!==58||entries[55]?.name!=='0136_ls_academy_founder.sql'||entries[56]?.name!=='0137_ls_academy_owner_notifications.sql'||entries[57]?.name!=='0138_ls_academy_crm.sql'||new Set(entries.map(e=>e.name)).size!==entries.length)throw Error('ACADEMY_TEST_MANIFEST_NOT_FULL_58');
 return entries.map(entry=>{
  if(!/^\d{4}_[a-z][a-z0-9_]*\.sql$/.test(entry.name))throw Error('ACADEMY_TEST_MANIFEST_PATH_INVALID');
  const bytes=readFileSync(new URL('../../migrations/'+entry.name,import.meta.url));
  if(createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw Error('ACADEMY_TEST_MIGRATION_CHECKSUM');
  return {name:entry.name,checksum:entry.sha256,sql:bytes.toString('utf8')};
 });
}

export async function academyTestDatabase(prefix:'full'|'before_founder'='full'){
 const target=new URL(safeTestUrl()),name='ls_calendar_test_academy_'+randomBytes(8).toString('hex');
 if(!['127.0.0.1','localhost','[::1]'].includes(target.hostname)||target.search||target.hash||!/^ls_calendar_test_academy_[a-f0-9]{16}$/.test(name))throw Error('ACADEMY_TEST_TARGET_INVALID');
 const adminTarget=new URL(target);adminTarget.pathname='/postgres';target.pathname='/'+name;
 const admin=new pg.Pool({connectionString:adminTarget.toString(),ssl:false,max:1}),pool=new pg.Pool({connectionString:target.toString(),ssl:false,max:8});let created=false,closed=false;
 const close=async()=>{
  if(closed)return;closed=true;
  try{await pool.end();if(created){await admin.query(`DROP DATABASE "${name}"`);created=false;}}
  finally{await admin.end();}
 };
 try{
  const inventory=academyMigrationInventory(),founderIndex=inventory.findIndex(file=>file.name==='0136_ls_academy_founder.sql');if(founderIndex<1)throw Error('ACADEMY_TEST_FOUNDER_MIGRATION_MISSING');await admin.query(`CREATE DATABASE "${name}"`);created=true;
  const client=await pool.connect();try{
   const actual=await client.query('SELECT current_database() AS name');if(actual.rows[0]?.name!==name)throw Error('ACADEMY_TEST_DATABASE_MISMATCH');
   await migrate({query:async(sql,values)=>client.query(sql,values?[...values]:undefined)},prefix==='full'?inventory:inventory.slice(0,founderIndex),false);
  }finally{client.release();}
  return {pool,inventory,name,close};
 }catch(error){await close();throw error;}
}

export async function academyWorkspace(pool:pg.Pool){
 const workspace=asId(randomUUID(),'workspace'),ring={activeKeyId:'synthetic',keys:{synthetic:randomBytes(32)}},digestKey=randomBytes(32).toString('hex'),origin='https://academy.example.invalid';
 const store=poolStore(pool),config:IdentityConfig={enabled:true,origin,workspaceId:workspace,csrfKey:randomBytes(32),lookupKey:randomBytes(32),rateLimitKey:randomBytes(32).toString('hex'),keyring:ring,sessionSeconds:3600};
 await pool.query('INSERT INTO ls_identity.workspaces(id,created_at) VALUES($1,now())',[workspace]);
 async function account(role:AccountRole){
  const id=asId(randomUUID(),'account'),personId=asId(randomUUID(),'person'),token=opaqueToken(),now=new Date(),expiresAt=now.getTime()+3600000;
  const client=await pool.connect();try{
   await client.query('BEGIN');
   await client.query("INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,'adult',$3,$4)",[personId,workspace,seal(JSON.stringify({displayName:'Synthetic '+role}),`person:${workspace}:${personId}`,ring),now]);
   await client.query("INSERT INTO ls_identity.accounts(id,workspace_id,role,state,locale,email_blind,email_ciphertext,email_verified_at,password_hash,created_at,updated_at) VALUES($1,$2,$3,'active','en',$4,$5,$6,'synthetic-non-login-hash',$6,$6)",[id,workspace,role,createHash('sha256').update(id).digest('hex'),seal('synthetic-'+id+'@example.invalid',`email:${workspace}:${id}`,ring),now]);
   await client.query('INSERT INTO ls_identity.account_subjects(workspace_id,account_id,person_id) VALUES($1,$2,$3)',[workspace,id,personId]);
   await client.query('INSERT INTO ls_identity.sessions(token_digest,workspace_id,account_id,created_at,expires_at) VALUES($1,$2,$3,$4,$5)',[tokenDigest(token),workspace,id,now,new Date(expiresAt)]);
   await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  const actor:Actor={id,personId,workspaceId:workspace,role,state:'active',locale:'en',sessionDigest:tokenDigest(token),expiresAt};return {actor,token};
 }
 const owner=await account('practitioner'),parent=await account('parent'),sessions=new IdentitySessions(store,config,systemClock);
 const founder=new AcademyFounderStore(store,workspace,ring,digestKey,systemClock),applications=new PublicGroupApplicationStore(store,workspace,ring,digestKey,systemClock,false,founder);
 const runtime={config,sessions,clock:systemClock,limits:new PostgresIdentityRateStore(store),audit:durableAuditSink(store)};
 return {pool,workspace,ring,digestKey,origin,owner,parent,founder,applications,runtime,account};
}

export function academyCommand(email='synthetic-'+randomUUID()+'@example.invalid'){
 const learners=[{id:randomUUID(),fullName:'Synthetic Older',ageYears:12,grade:'7',schooling:'school',experience:'new'},{id:randomUUID(),fullName:'Synthetic Younger',ageYears:9,grade:'4',schooling:'school',experience:'new'}];
 return {operationId:randomUUID(),fields:floridaAcademyRegistrationFieldsSchema.parse({parentName:'Synthetic Parent '+email,contact:email,language:'en',cityArea:'Synthetic Florida',programId:'sunday_fishing_academy',schedulePreference:[],academyRegistration:{version:ACADEMY_REGISTRATION_VERSION,learners,postalCode:'01234',preferredDays:['sunday'],preferredTimes:['morning'],driveMinutes:30,schoolHoursAvailability:'outside_school_only',preferredGroupLanguage:'either',stageInterest:'foundation',receiptEmail:email,intent:'information',communicationPreferences:communicationPreferenceSelection('en',false,'en'),acknowledgments:registrationAcknowledgments('en',learners.map(child=>child.id)),consent:registrationConsent('en')},permission:{confirmed:true,version:academyRegistrationNotice.version,language:'en'}})};
}
