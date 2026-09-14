/** Synthetic fixture for an already-migrated, loopback-only disposable PostgreSQL database.
 * Never creates, drops or migrates a database. The Codex runner owns its lifecycle.
 */
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import pg from 'pg';
import { asId } from '../../../src/lib/ids.ts';
import { seal, tokenDigest, type Keyring } from '../../../src/features/identity/crypto.ts';
import { systemClock, type Actor, type AccountRole } from '../../../src/features/identity/types.ts';
import type { IdentityStore, SqlSession } from '../../../src/features/identity/store.ts';
import { CalendarStore } from '../../../src/features/calendar/store.ts';
import { CalendarService } from '../../../src/features/calendar/service.ts';
import type { AppointmentId, CreateBooking } from '../../../src/features/calendar/types.ts';
export function safeTestUrl():string {
 const raw=process.env.TEST_DATABASE_URL;
 // The frozen, secret-free repository CI already migrates this separate database.
 // Foundation tests use their own EMPTY LS_TEST_DATABASE_URL; never reuse that DB here.
 // No general fallback, remote host, provider credential or additional CI write is admitted.
 if(!raw&&process.env.CI==='true'){
  const ci=process.env.LS_MIGRATION_DATABASE_URL;
  if(process.env.LS_APP_MODE!=='foundation_locked'||process.env.LS_DATABASE_TLS!=='disable'||
   ci!=='postgresql://synthetic:synthetic_ci_only@127.0.0.1:5432/lifeskills_migration_test')throw new Error('CALENDAR_CI_DATABASE_NOT_EXACT_DISPOSABLE_TARGET');
  return ci;
 }
 if(!raw||process.env.LS_CALENDAR_TEST_ALLOW!=='true')throw new Error('CALENDAR_TEST_DATABASE_OPT_IN_REQUIRED');
 let url:URL;try{url=new URL(raw);}catch{throw new Error('CALENDAR_TEST_DATABASE_INVALID');}
 if(!['postgres:','postgresql:'].includes(url.protocol)||!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||!/^\/ls_calendar_test_[A-Za-z0-9_]+$/.test(url.pathname)||url.search||url.hash)throw new Error('CALENDAR_TEST_DATABASE_NOT_DISPOSABLE_LOOPBACK');
 return raw;
}
export function poolStore(pool:pg.Pool):IdentityStore {return {async transaction<T>(work:(tx:SqlSession)=>Promise<T>):Promise<T>{
 const client=await pool.connect();try{await client.query('BEGIN');const tx:SqlSession={async query<R extends object>(statement:string,values:readonly unknown[]=[]){return (await client.query(statement,[...values])).rows as R[];}};const result=await work(tx);await client.query('COMMIT');return result;}
 catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}};}
export async function fixture(options:{workspaceId?:string;keyring?:Keyring;termsVersion?:string}={}){
 const pool=new pg.Pool({connectionString:safeTestUrl(),max:8});
 const check=await pool.query("SELECT to_regclass('ls_calendar.appointments') AS calendar,to_regclass('ls_cases.cases') AS identity");
 if(!check.rows[0]?.calendar||!check.rows[0]?.identity){await pool.end();throw new Error('RUN_APPROVED_MIGRATION_REGISTRY_FIRST');}
 const workspaceId=asId(options.workspaceId??randomUUID(),'workspace'),keyring=options.keyring??{activeKeyId:'test',keys:{test:randomBytes(32)}},termsVersion=options.termsVersion??'synthetic-terms-v1';
 const store=poolStore(pool),db=new CalendarStore(store,keyring,systemClock),service=new CalendarService(db);
 const now=Date.now(),ago=new Date(now-7*86400000),expiresAt=now+8*3600000;
 await pool.query('INSERT INTO ls_identity.workspaces(id,created_at) VALUES($1,$2)',[workspaceId,ago]);
 async function account(role:AccountRole,label:string){
  const id=asId(randomUUID(),'account'),personId=asId(randomUUID(),'person'),token=randomBytes(32).toString('base64url');
  const actor:Actor={id,workspaceId,personId,role,state:'active',locale:'en',sessionDigest:tokenDigest(token),expiresAt};
  // These records only service authorization; no password/email provider is exercised.
  await pool.query('INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,\'adult\',$3,$4)',[personId,workspaceId,seal(JSON.stringify({displayName:label}),`person:${workspaceId}:${personId}`,keyring),ago]);
  await pool.query(`INSERT INTO ls_identity.accounts(id,workspace_id,role,state,locale,email_blind,email_ciphertext,email_verified_at,password_hash,created_at,updated_at)
   VALUES($1,$2,$3,'active','en',$4,$5,$6,'synthetic-non-login-hash',$6,$6)`,[id,workspaceId,role,createHash('sha256').update(id).digest('hex'),seal('synthetic-'+id+'@example.invalid',`account-email:${workspaceId}:${id}`,keyring),ago]);
  await pool.query('INSERT INTO ls_identity.account_subjects(workspace_id,account_id,person_id) VALUES($1,$2,$3)',[workspaceId,id,personId]);
  await pool.query('INSERT INTO ls_identity.sessions(token_digest,workspace_id,account_id,created_at,expires_at) VALUES($1,$2,$3,$4,$5)',[actor.sessionDigest,workspaceId,id,ago,new Date(expiresAt)]);
  return {actor,token};
 }
 const practitioner=await account('practitioner','Synthetic practitioner'),parent=await account('parent','Synthetic parent A'),parentTwo=await account('parent','Synthetic parent B'),outsider=await account('parent','Synthetic unrelated parent');
 async function caseRecord(label:string,parents= [parent.actor,parentTwo.actor]){
  const id=asId(randomUUID(),'case'),personId=asId(randomUUID(),'person'),clientId=randomUUID(),familyId=randomUUID(),audienceId=asId(randomUUID(),'audience'),engagementId=asId(randomUUID(),'engagement');
  await pool.query(`INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,'minor',$3,$4)`,[personId,workspaceId,seal(JSON.stringify({displayName:label}),`person:${workspaceId}:${personId}`,keyring),ago]);
  await pool.query('INSERT INTO ls_cases.families(id,workspace_id,label_ciphertext,created_at) VALUES($1,$2,$3,$4)',[familyId,workspaceId,seal(label,`family:${workspaceId}:${familyId}`,keyring),ago]);
  await pool.query('INSERT INTO ls_cases.clients(id,workspace_id,person_id,created_at) VALUES($1,$2,$3,$4)',[clientId,workspaceId,personId,ago]);
  await pool.query(`INSERT INTO ls_cases.cases(id,workspace_id,client_id,family_id,practitioner_account_id,state,created_at,updated_at) VALUES($1,$2,$3,$4,$5,'active',$6,$6)`,[id,workspaceId,clientId,familyId,practitioner.actor.id,ago]);
  await pool.query(`INSERT INTO ls_cases.engagements(id,workspace_id,case_id,terms_version,currency,appointment_rate_minor,attended_review_target,state,created_at) VALUES($1,$2,$3,$4,'ILS',55000,12,'active',$5)`,[engagementId,workspaceId,id,termsVersion,ago]);
  await pool.query(`INSERT INTO ls_cases.audiences(id,workspace_id,case_id,visibility,published,created_at) VALUES($1,$2,$3,'family_full',true,$4)`,[audienceId,workspaceId,id,ago]);
  for(const p of parents){await pool.query('INSERT INTO ls_cases.case_guardians(workspace_id,case_id,account_id,granted_at) VALUES($1,$2,$3,$4)',[workspaceId,id,p.id,ago]);await pool.query('INSERT INTO ls_cases.audience_accounts(workspace_id,case_id,audience_id,account_id,granted_at) VALUES($1,$2,$3,$4,$5)',[workspaceId,id,audienceId,p.id,ago]);}
  return {id,audienceId,engagementId};
 }
 const first=await caseRecord('Synthetic case A'),second=await caseRecord('Synthetic case B',[outsider.actor]);
 await pool.query(`INSERT INTO ls_calendar.availability(id,workspace_id,practitioner_id,starts_at,ends_at,kind) VALUES($1,$2,$3,$4,$5,'open')`,[randomUUID(),workspaceId,practitioner.actor.id,new Date(now-6*86400000),new Date(now+20*86400000)]);
 const booking=(startsAt:string,c=first):CreateBooking=>({caseId:c.id,audienceId:c.audienceId,kind:'individual',startsAt,parentForId:null,parentIds:[],bufferBefore:0,bufferAfter:0,location:'Synthetic agreed meeting place',checkinExceptionReason:null});
 async function seed(startsAt:string,c=first):Promise<AppointmentId>{
  const id=asId(randomUUID(),'appointment'),endsAt=new Date(Date.parse(startsAt)+3600000).toISOString();
  await pool.query(`INSERT INTO ls_calendar.appointments(id,workspace_id,case_id,audience_id,engagement_id,practitioner_id,terms_version,kind,starts_at,ends_at,parent_ids,buffer_before,buffer_after,location_ciphertext,created_by,created_at)
   VALUES($1,$2,$3,$4,$5,$6,$7,'individual',$8,$9,'{}',0,0,$10,$6,$11)`,[id,workspaceId,c.id,c.audienceId,c.engagementId,practitioner.actor.id,termsVersion,startsAt,endsAt,seal('Synthetic agreed meeting place',`calendar:location:${workspaceId}:${id}`,keyring),ago]);
  return id;
 }
 const at=(hours:number)=>new Date(now+hours*3600000).toISOString();
 const effects=async(id:AppointmentId)=>(await pool.query("SELECT payload->'reference'->>'effect' AS effect FROM ls_calendar.events WHERE workspace_id=$1 AND appointment_id=$2 AND topic='credit_effect' ORDER BY sequence",[workspaceId,id])).rows.map((r:{effect:string})=>r.effect);
 return {pool,db,service,workspaceId,keyring,practitioner,parent,parentTwo,outsider,first,second,booking,seed,at,effects};
}
export type Fixture=Awaited<ReturnType<typeof fixture>>;
