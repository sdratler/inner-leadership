import {requirePgliteMemoryEnvironment} from '../fixtures/pglite-memory-environment.ts';
import {createHash,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {afterAll,beforeAll,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {asId} from '../../src/lib/ids.ts';
import {SESSION_COOKIE} from '../../src/lib/security/session.ts';
import {blindEmail,hashPassword,seal,unseal} from '../../src/features/identity/crypto.ts';
import {IdentityAuthService} from '../../src/features/identity/auth-service.ts';
import {IdentitySessions} from '../../src/features/identity/session-adapter.ts';
import {PostgresIdentityRateStore} from '../../src/features/identity/rate-store.ts';
import type {IdentityConfig} from '../../src/features/identity/config.ts';
import type {IdentityStore,SqlSession} from '../../src/features/identity/store.ts';
import {PublicGroupApplicationStore} from '../../src/features/group-application/store.ts';
import {publicGroupApplicationHttp} from '../../src/features/group-application/http.ts';
import {groupApplicationReviewHttp} from '../../src/features/group-application/review-http.ts';
import {verifyGroupApplicationChallenge} from '../../src/features/group-application/challenge.ts';
import {TRIP390_MEDIA_TYPE} from '../../src/features/group-application/academy-trip390-transport.ts';
import {TRIP390_INTEREST_VERSION,TRIP390_NOTICE_VERSION,TRIP390_DRIVING_VERSION,TRIP390_OFFER,type Trip390Command} from '../../src/features/group-application/academy-trip390-contract.ts';
import {trip390ReservationNotice} from '../../src/features/group-application/academy-trip390-reservation-notice.ts';
import {trip390StudentConduct} from '../../src/features/group-application/academy-trip390-student-conduct.ts';
import {academy650AckContent} from '../../src/features/group-application/academy650-r2-ack.ts';
import {INQUIRY_EMAIL_PURPOSE} from '../../src/features/group-application/inquiry-email-copy.ts';
import {currentTrip390Fields} from '../fixtures/trip390-current.ts';

// PREPARATION ONLY until the existing root/reviewer admits this exact file.
// In-memory SQL and real service-level password login/session validation; not
// browser login, PostgreSQL-server parity, provider send or inbox evidence.
// No fixture engine is constructed merely by importing this module.
let engine:PGlite,passwordHash:string;
let tick=0;const clock={now:()=>new Date(tick)};
const password='Synthetic-only-password-07!';
const ring={activeKeyId:'synthetic',keys:{synthetic:Buffer.alloc(32,51)}};
const binder:IdentityStore={transaction:work=>engine.transaction(tx=>work({query:async<T extends object>(sql:string,values:readonly unknown[]=[])=> (await tx.query<T>(sql,[...values])).rows} as SqlSession))};
const migrations=['0001_ls_foundation.sql','0010_ls_identity_cases_20260906.sql','0124_ls_group_interest.sql','0131_ls_public_group_applications.sql','0135_ls_inquiry_email_outbox.sql'];
beforeAll(async()=>{
 requirePgliteMemoryEnvironment(process.env);
 vi.stubGlobal('fetch',vi.fn(async()=>{throw Error('NETWORK_NOT_ADMITTED');}));
 tick=Date.now();engine=new PGlite();await engine.exec('CREATE SCHEMA ls_control');
 const manifest=JSON.parse(await readFile('migrations/manifest.json','utf8')) as {name:string;sha256:string}[];
 for(const name of migrations){const sql=await readFile('migrations/'+name,'utf8');expect(createHash('sha256').update(sql).digest('hex')).toBe(manifest.find(row=>row.name===name)?.sha256);await engine.exec(sql);}
 passwordHash=await hashPassword(password);
},20000);
afterAll(async()=>{try{await engine?.close();}finally{vi.unstubAllGlobals();}});

async function fixture(){
 const workspace=asId(randomUUID(),'workspace'),origin='https://synthetic-reservation.example.invalid';
 const config:IdentityConfig={enabled:true,workspaceId:workspace,origin,csrfKey:Buffer.alloc(32,52),lookupKey:Buffer.alloc(32,53),rateLimitKey:randomUUID(),keyring:ring,sessionSeconds:3600};
 const digestKey='synthetic-reservation07-key-'+workspace;
 await engine.query('INSERT INTO ls_identity.workspaces(id,created_at) VALUES($1,$2)',[workspace,clock.now()]);
 async function account(role:'practitioner'|'parent'){
  const id=randomUUID(),email=`synthetic-${role}-${id}@example.invalid`;
  await engine.query("INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,'adult',$3,$4)",[id,workspace,seal('SYNTHETIC ONLY',`profile:${workspace}:${id}`,ring),clock.now()]);
  await engine.query("INSERT INTO ls_identity.accounts(id,workspace_id,role,state,locale,email_blind,email_ciphertext,email_verified_at,password_hash,created_at,updated_at) VALUES($1,$2,$3,'active','en',$4,$5,$6,$7,$6,$6)",[id,workspace,role,blindEmail(email,config.lookupKey),seal(email,`email:${workspace}:${id}`,ring),clock.now(),passwordHash]);
  await engine.query('INSERT INTO ls_identity.account_subjects(workspace_id,account_id,person_id) VALUES($1,$2,$2)',[workspace,id]);
  return {id,email};
 }
 const owner=await account('practitioner'),parent=await account('parent');
 const store=()=>new PublicGroupApplicationStore(binder,workspace,ring,digestKey,clock,true);
 const sessions=()=>new IdentitySessions(binder,config,clock);
 async function login(email=owner.email){const auth=new IdentityAuthService(binder,config,clock),preauth=await auth.preauth();return auth.login(email,password,preauth.token,randomUUID());}
 const deps=async()=>({enabled:true,trip390ReservationAdmitted:true,environment:{NODE_ENV:'test',LS_APP_ORIGIN:origin,LS_ACADEMY_PUBLIC_OFFER:TRIP390_OFFER.version},challengeKey:digestKey,now:()=>tick,limits:new PostgresIdentityRateStore(binder),store:store()});
 const host=new URL(origin).host,url=origin+'/api/public/group-applications?program=sunday_fishing_academy';
 async function challenge(){
  const response=await publicGroupApplicationHttp(new Request(url,{headers:{host,accept:TRIP390_MEDIA_TYPE}}),deps);expect(response.status).toBe(200);
  const body=(await response.json()).data;expect(body).toMatchObject({version:TRIP390_INTEREST_VERSION,offerVersion:TRIP390_OFFER.version,noticeVersion:TRIP390_NOTICE_VERSION});
  const cookie=response.headers.get('set-cookie');expect(cookie).toContain('HttpOnly; Secure; SameSite=Strict');tick+=1600;
  expect(verifyGroupApplicationChallenge(body.challenge,digestKey,tick)).toMatchObject({v:6,version:TRIP390_INTEREST_VERSION,noticeVersion:TRIP390_NOTICE_VERSION});
  return {challenge:body.challenge as string,cookie:cookie!.split(';')[0]!};
 }
 async function post(command:Trip390Command,issued:Awaited<ReturnType<typeof challenge>>,options:{admitted?:boolean;origin?:string;cookie?:string}={}){
  return publicGroupApplicationHttp(new Request(url,{method:'POST',headers:{host,accept:TRIP390_MEDIA_TYPE,origin:options.origin??origin,'sec-fetch-site':'same-origin','content-type':'application/json',cookie:options.cookie??issued.cookie},body:JSON.stringify({...command,challenge:issued.challenge,website:''})}),async()=>({...await deps(),trip390ReservationAdmitted:options.admitted??true}));
 }
 async function review(token:string,query:string,resolver=sessions(),readStore=store()){
  return groupApplicationReviewHttp(new Request(origin+'/api/private/group-applications?'+query,{headers:{host,'x-forwarded-host':host,'x-forwarded-proto':'https',cookie:SESSION_COOKIE+'='+token}}),async()=>({origin,actor:value=>resolver.actor(value),store:readStore}));
 }
 async function counts(){return (await engine.query<{leads:number;operations:number;outbox:number}>('SELECT (SELECT count(*)::int FROM ls_service_interest.public_applications WHERE workspace_id=$1) AS leads,(SELECT count(*)::int FROM ls_service_interest.public_application_operations WHERE workspace_id=$1) AS operations,(SELECT count(*)::int FROM ls_service_interest.inquiry_email_outbox WHERE workspace_id=$1) AS outbox',[workspace])).rows[0]!;}
 return {workspace,config,owner,parent,store,sessions,login,challenge,post,review,counts};
}
function command(locale:'en'|'he'):Trip390Command{
 const fields=currentTrip390Fields(),notice=trip390ReservationNotice(locale),conduct=trip390StudentConduct(locale);
 return {operationId:randomUUID(),fields:{...fields,guardianName:'Synthetic Reservation Guardian '+randomUUID(),email:'synthetic-reservation-'+randomUUID()+'@example.invalid',phone:'+12025550107',city:locale==='he'?'עיר סינתטית מחוץ לרשימה':'Synthetic city outside suggestions',postalCode:'01234-5678',messageLanguage:locale==='en'?'he':'en',instructionLanguage:'either',lessonDayDriving:{version:TRIP390_DRIVING_VERSION,limit:'up_to_90'},children:[{id:randomUUID(),name:'Synthetic Older',ageYears:12,experience:'some'},{id:randomUUID(),name:'Synthetic Younger',ageYears:9,experience:'new'}],acknowledgment:{version:TRIP390_NOTICE_VERSION,language:locale,conductExplained:true,interestPrivacySafety:true,whatsapp:false,reservationNotice:{version:notice.version,language:locale,text:notice.text,textDigest:notice.textDigest},studentConduct:{version:conduct.version,language:locale,text:conduct.text,textDigest:conduct.textDigest}}}};
}
async function saved(response:Response,status=201){expect(response.status).toBe(status);const value=(await response.json()).data;expect(value).toMatchObject({reference:expect.stringMatching(/^[a-f0-9-]{36}$/),acknowledgment:'queued',replayed:status===200});return value as {reference:string;operationId:string;acknowledgment:string;replayed:boolean};}

it.each(['en','he'] as const)('v4 R2 %s actual HTTP save, lost-reply replay, encrypted ACK intent and new ordinary owner session reload',async locale=>{
 const f=await fixture(),input=command(locale),issued=await f.challenge();
 // The first successful body is deliberately not used by the caller; exact
 // retry recovers the same durable reference rather than inventing a new lead.
 const first=await f.post(input,issued);expect(first.status).toBe(201);
 const firstBody=(await first.clone().json()).data;await first.arrayBuffer();
 const replay=await saved(await f.post(input,issued),200);expect(replay).toEqual({...firstBody,replayed:true});expect(replay.operationId).toBe(input.operationId);
 expect((await f.post({...input,fields:{...input.fields,postalCode:'01235'}},issued)).status).toBe(409);
 expect(await f.counts()).toEqual({leads:1,operations:1,outbox:1});
 const rows=(await engine.query<{payload_ciphertext:string;notice_version:string;notice_language:string}>('SELECT payload_ciphertext,notice_version,notice_language FROM ls_service_interest.public_applications WHERE workspace_id=$1 AND id=$2',[f.workspace,replay.reference])).rows;
 expect(rows).toHaveLength(1);expect(rows[0]!.notice_version).toBe(TRIP390_NOTICE_VERSION);expect(rows[0]!.notice_language).toBe(locale);
 expect(rows[0]!.payload_ciphertext).not.toContain(input.fields.guardianName);
 expect(JSON.parse(unseal(rows[0]!.payload_ciphertext,`ls_service_interest/public_application/v1/${f.workspace}/${replay.reference}`,ring))).toEqual(input.fields);
 const queued=(await engine.query<{id:string;purpose:string;state:string;payload_ciphertext:string;provider_id:string|null}>('SELECT id,purpose,state,payload_ciphertext,provider_id FROM ls_service_interest.inquiry_email_outbox WHERE workspace_id=$1 AND application_id=$2',[f.workspace,replay.reference])).rows;
 expect(queued).toHaveLength(1);expect(queued[0]).toMatchObject({purpose:INQUIRY_EMAIL_PURPOSE,state:'queued',provider_id:null});expect(queued[0]!.payload_ciphertext).not.toContain(input.fields.email);
 const payload=JSON.parse(unseal(queued[0]!.payload_ciphertext,`ls_service_interest/inquiry_email/v1/${f.workspace}/${queued[0]!.id}`,ring));
 const content=academy650AckContent({reference:replay.reference,parentFirstName:'Synthetic',children:input.fields.children.map(({id,name})=>({id,name})),messageLanguage:input.fields.messageLanguage});
 expect(payload).toMatchObject({reference:replay.reference,recipient:input.fields.email,locale:input.fields.messageLanguage,copyVersion:content.version,subject:content.subject,text:content.text,html:content.html,contentSha256:content.contentSha256});
 const login1=await f.login(),actor1=await f.sessions().actor(login1.token);expect(actor1.role).toBe('practitioner');
 const search=await f.review(login1.token,'search='+encodeURIComponent(input.fields.guardianName));expect(search.status).toBe(200);expect((await search.json()).data.items).toHaveLength(1);
 const read1=await f.review(login1.token,'reference='+replay.reference);expect(read1.status).toBe(200);expect((await read1.json()).data.items[0].fields).toEqual(input.fields);
 const login2=await f.login(),freshSessions=f.sessions();expect(login2.token).not.toBe(login1.token);expect((await freshSessions.actor(login2.token)).sessionDigest).not.toBe(actor1.sessionDigest);
 const reload=await f.review(login2.token,'reference='+replay.reference,freshSessions,f.store());expect(reload.status).toBe(200);expect((await reload.json()).data.items).toEqual([{id:replay.reference,source:'public_group_application',state:'owner_review',receivedAt:expect.any(String),fields:input.fields}]);
 expect(await f.counts()).toEqual({leads:1,operations:1,outbox:1});expect(fetch).not.toHaveBeenCalled();
},20000);

it('concurrent double-click uses one lead, immutable operation and one ACK intent',async()=>{
 const f=await fixture(),input=command('en'),issued=await f.challenge();const responses=await Promise.all([f.post(input,issued),f.post(input,issued)]);
 expect(responses.map(r=>r.status).sort()).toEqual([200,201]);const bodies=await Promise.all(responses.map(async r=>(await r.json()).data));expect(bodies[0].reference).toBe(bodies[1].reference);expect(bodies[0].operationId).toBe(input.operationId);expect(bodies[1].operationId).toBe(input.operationId);expect(await f.counts()).toEqual({leads:1,operations:1,outbox:1});expect(fetch).not.toHaveBeenCalled();
});
it('actual parent, wrong-workspace and revoked ordinary sessions deny private fields',async()=>{
 const f=await fixture(),other=await fixture(),input=command('he'),reference=(await saved(await f.post(input,await f.challenge()))).reference;
 const parent=await f.login(f.parent.email),outsider=await other.login(),owner=await f.login();
 const denials=[await f.review(parent.token,'reference='+reference),await f.review(outsider.token,'reference='+reference,other.sessions())];
 for(const denial of denials){expect(denial.status).toBe(403);const body=await denial.text();expect(body).not.toContain(reference);expect(body).not.toContain(input.fields.guardianName);}
 const actor=await f.sessions().actor(owner.token);await new IdentityAuthService(binder,f.config,clock).logout(actor,randomUUID());
 const revoked=await f.review(owner.token,'reference='+reference);expect(revoked.status).toBe(401);expect(await revoked.text()).not.toContain(input.fields.email);
 await expect(f.store().readForOwner(actor,reference)).rejects.toMatchObject({code:'UNAUTHENTICATED'});expect(await f.counts()).toEqual({leads:1,operations:1,outbox:1});
},20000);
it('closed reservation admission, missing consent, wrong origin or continuation cannot create an inquiry',async()=>{
 const f=await fixture(),input=command('en'),issued=await f.challenge();
 expect((await f.post(input,issued,{admitted:false})).status).toBe(403);
 for(const field of ['conductExplained','interestPrivacySafety'] as const){const bad=structuredClone(input);Object.assign(bad.fields.acknowledgment,{[field]:false});expect((await f.post(bad,issued)).status).toBe(400);}
 expect((await f.post(input,issued,{origin:'https://different.example.invalid'})).status).toBe(403);
 expect((await f.post(input,issued,{cookie:'ls_academy_registration='+'a'.repeat(43)})).status).toBe(403);
 expect(await f.counts()).toEqual({leads:0,operations:0,outbox:0});expect(fetch).not.toHaveBeenCalled();
});
it('real outbox SQL failure rolls back lead and operation and cannot return success',async()=>{
 const f=await fixture(),input=command('he'),issued=await f.challenge();
 await engine.exec(`CREATE FUNCTION ls_service_interest.synthetic_reservation_ack_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'SYNTHETIC_RESERVATION_ACK_FAILURE'; END $$;
 CREATE TRIGGER synthetic_reservation_ack_failure BEFORE INSERT ON ls_service_interest.inquiry_email_outbox FOR EACH ROW WHEN (NEW.workspace_id='${f.workspace}'::uuid) EXECUTE FUNCTION ls_service_interest.synthetic_reservation_ack_failure();`);
 try{const response=await f.post(input,issued);expect(response.status).toBe(503);const body=await response.json();expect(body.ok).toBe(false);expect(body).not.toHaveProperty('data.reference');expect(await f.counts()).toEqual({leads:0,operations:0,outbox:0});expect(await f.store().replaySaved(input)).toBeNull();}
 finally{await engine.exec('DROP TRIGGER synthetic_reservation_ack_failure ON ls_service_interest.inquiry_email_outbox; DROP FUNCTION ls_service_interest.synthetic_reservation_ack_failure();');}
 expect(fetch).not.toHaveBeenCalled();
});
