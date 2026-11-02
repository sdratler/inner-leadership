import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {afterAll,beforeAll,expect,test,vi} from 'vitest';
import {safeTestUrl,poolStore} from './calendar/fixture.ts';
import {academyWorkspace} from './academy-free-registration-fixture.ts';
import {PublicGroupApplicationStore} from '../../src/features/group-application/store.ts';
import {publicGroupApplicationHttp} from '../../src/features/group-application/http.ts';
import {groupApplicationReviewHttp} from '../../src/features/group-application/review-http.ts';
import {verifyGroupApplicationChallenge} from '../../src/features/group-application/challenge.ts';
import {trip390Notice,TRIP390_MEDIA_TYPE} from '../../src/features/group-application/academy-trip390-transport.ts';
import {TRIP390_INTEREST_VERSION,TRIP390_NOTICE_VERSION,TRIP390_OFFER,type Trip390Command} from '../../src/features/group-application/academy-trip390-contract.ts';
import {opaqueToken,tokenDigest,unseal} from '../../src/features/identity/crypto.ts';
import {IdentitySessions} from '../../src/features/identity/session-adapter.ts';
import {systemClock} from '../../src/features/identity/types.ts';
import {SESSION_COOKIE} from '../../src/lib/security/session.ts';
vi.mock('server-only',()=>({}));

let pool:pg.Pool;
beforeAll(()=>{pool=new pg.Pool({connectionString:safeTestUrl(),ssl:false,max:5});});
afterAll(async()=>{await pool?.end();});

test('Trip390 v3 challenge, simultaneous save/replay, encrypted receipts and authenticated exact-reference readback',async()=>{
 const f=await academyWorkspace(pool),other=await academyWorkspace(pool);
 const command:Trip390Command={operationId:randomUUID(),fields:{
  version:TRIP390_INTEREST_VERSION,offerVersion:TRIP390_OFFER.version,
  guardianName:'Synthetic Trip390 Guardian',email:'trip390-'+randomUUID()+'@example.invalid',
  city:'עיר סינתטית שלא ברשימה',postalCode:'01234-5678',messageLanguage:'he',instructionLanguage:'either',
  children:[{id:randomUUID(),name:'Synthetic first child',ageYears:12,experience:'some'},{id:randomUUID(),name:'Synthetic sibling',ageYears:9,experience:'new'}],
  notes:'Synthetic preparation note',acknowledgment:{version:TRIP390_NOTICE_VERSION,language:'en',conductExplained:true,interestPrivacySafety:true,whatsapp:false}
 }};
 const host=new URL(f.origin).host;
 const url=f.origin+'/api/public/group-applications?program=sunday_fishing_academy';
 const headers={host,accept:TRIP390_MEDIA_TYPE};
 let now=Date.now();
 // Even when legacy dependencies exist, this version must bypass every legacy
 // founder, attribution and outbound branch. All stores below use the PG binder.
 const apps=()=>new PublicGroupApplicationStore(poolStore(pool),f.workspace,f.ring,f.digestKey,systemClock,true,f.founder);
 const founderCalls=[vi.spyOn(f.founder,'accept'),vi.spyOn(f.founder,'bindAttribution'),vi.spyOn(f.founder,'checkAttribution'),vi.spyOn(f.founder,'publicResult')];
 const afterCommit=vi.fn(async()=>undefined),refreshFounder=vi.fn(async()=>undefined);
 const deps=async(trip:boolean)=>{
  expect(trip).toBe(true);
  return {enabled:true,environment:{NODE_ENV:'test',LS_APP_ORIGIN:f.origin,LS_ACADEMY_PUBLIC_OFFER:TRIP390_OFFER.version},challengeKey:f.digestKey,now:()=>now,limits:f.runtime.limits,store:apps(),afterCommit,refreshFounder};
 };
 const get=await publicGroupApplicationHttp(new Request(url,{headers}),deps);
 expect(get.status).toBe(200);
 const issued=(await get.json()).data;
 expect(issued).toMatchObject({version:command.fields.version,offerVersion:command.fields.offerVersion,noticeVersion:TRIP390_NOTICE_VERSION,notice:trip390Notice});
 const setCookie=get.headers.get('set-cookie');
 expect(setCookie).toContain('HttpOnly; Secure; SameSite=Strict');
 const cookie=setCookie!.split(';')[0]!;
 now+=1600;
 expect(verifyGroupApplicationChallenge(issued.challenge,f.digestKey,now)).toMatchObject({v:3,programId:'sunday_fishing_academy',noticeVersion:TRIP390_NOTICE_VERSION});
 const body={...command,website:'',challenge:issued.challenge};
 const post=(payload:typeof body,continuation=cookie)=>publicGroupApplicationHttp(new Request(url,{method:'POST',headers:{...headers,origin:f.origin,'sec-fetch-site':'same-origin','content-type':'application/json',cookie:continuation},body:JSON.stringify(payload)}),deps);
 expect((await post(body,'ls_academy_registration='+opaqueToken())).status).toBe(403);
 const responses=await Promise.all([post(body),post(body)]);
 expect(responses.map(r=>r.status).sort()).toEqual([200,201]);
 const [created,replay]=await Promise.all(responses.sort((a,b)=>b.status-a.status).map(async response=>(await response.json()).data));
 expect(created).toEqual({reference:expect.stringMatching(/^[a-f0-9-]{36}$/),operationId:command.operationId,acknowledgment:'not_queued',replayed:false});
 const reference=created.reference as string;
 expect(replay).toEqual({...created,replayed:true});
 // A later exact retry uses a fresh store and the same operation/body.
 const again=await post(body);expect(again.status).toBe(200);expect((await again.json()).data).toEqual(replay);
 expect((await post({...body,fields:{...body.fields,postalCode:'01234'}})).status).toBe(409);
 expect(await apps().replaySaved(command)).toMatchObject({replayed:true,item:{id:reference,fields:command.fields}});
 const {rows}=await pool.query<{id:string;operation_id:string;payload_ciphertext:string;notice_version:string;notice_language:string;request_digest:string;operation_digest:string}>(`
  SELECT a.id,o.operation_id,a.payload_ciphertext,a.notice_version,a.notice_language,a.request_digest,o.request_digest AS operation_digest
  FROM ls_service_interest.public_applications a JOIN ls_service_interest.public_application_operations o
    ON o.workspace_id=a.workspace_id AND o.application_id=a.id WHERE a.workspace_id=$1`,[f.workspace]);
 expect(rows).toHaveLength(1);
 const row=rows[0]!;
 expect(row).toMatchObject({id:reference,operation_id:command.operationId,notice_version:TRIP390_NOTICE_VERSION,notice_language:'en',request_digest:row.operation_digest});
 expect(row.payload_ciphertext).not.toContain(command.fields.guardianName);
 expect(JSON.parse(unseal(row.payload_ciphertext,`ls_service_interest/public_application/v1/${f.workspace}/${reference}`,f.ring))).toEqual(command.fields);
 // A second genuine synthetic session for the same practitioner, read through
 // a new IdentitySessions adapter and application store after commit.
 const freshToken=opaqueToken();
 await pool.query(`INSERT INTO ls_identity.sessions(token_digest,workspace_id,account_id,created_at,expires_at)
  VALUES($1,$2,$3,clock_timestamp(),clock_timestamp()+interval '1 hour')`,[tokenDigest(freshToken),f.workspace,f.owner.actor.id]);
 const sessions=new IdentitySessions(poolStore(pool),f.runtime.config,systemClock);
 const actor=await sessions.actor(freshToken);
 expect(actor.id).toBe(f.owner.actor.id);expect(actor.sessionDigest).not.toBe(f.owner.actor.sessionDigest);
 const ownerPath=f.origin+'/api/private/group-applications?reference='+reference;
 const review=(token:string,ownerStore=apps(),resolver=sessions)=>groupApplicationReviewHttp(new Request(ownerPath,{headers:{host,'x-forwarded-host':host,'x-forwarded-proto':'https',cookie:SESSION_COOKIE+'='+token}}),async()=>({origin:f.origin,actor:t=>resolver.actor(t),store:ownerStore}));
 const accepted=await review(freshToken);expect(accepted.status).toBe(200);
 expect((await accepted.json()).data).toEqual({items:[{id:reference,source:'public_group_application',state:'owner_review',receivedAt:expect.any(String),fields:command.fields}],nextCursor:null,emailSetup:null});
 const wrongProgram=new PublicGroupApplicationStore(poolStore(pool),f.workspace,f.ring,f.digestKey,systemClock,false,undefined,'morning_torah_learning');
 for(const [response,status] of [
  [await review(opaqueToken()),401],[await review(f.parent.token),403],
  [await review(other.owner.token,apps(),other.runtime.sessions),403],[await review(other.owner.token,other.applications,other.runtime.sessions),404],
  [await review(freshToken,wrongProgram),404]
 ] as const){expect(response.status).toBe(status);const denial=await response.text();expect(denial).not.toContain(command.fields.guardianName);expect(denial).not.toContain(reference);}
 await pool.query('UPDATE ls_identity.sessions SET revoked_at=clock_timestamp() WHERE workspace_id=$1 AND token_digest=$2',[f.workspace,actor.sessionDigest]);
 await expect(apps().readForOwner(actor,reference)).rejects.toMatchObject({code:'UNAUTHENTICATED'});
 expect((await review(freshToken)).status).toBe(401);
 expect(afterCommit).not.toHaveBeenCalled();expect(refreshFounder).not.toHaveBeenCalled();
 for(const call of founderCalls)expect(call).not.toHaveBeenCalled();
 const counts=await pool.query<{apps:number;ops:number}>(`SELECT
  (SELECT count(*)::int FROM ls_service_interest.public_applications WHERE workspace_id=$1) AS apps,
  (SELECT count(*)::int FROM ls_service_interest.public_application_operations WHERE workspace_id=$1) AS ops`,[f.workspace]);
 expect(counts.rows).toEqual([{apps:1,ops:1}]);
 for(const table of ['academy_founder_families','academy_founder_applications','academy_founder_operations','academy_founder_events','academy_campaigns','academy_campaign_operations','academy_campaign_shares','academy_campaign_touches','inquiry_email_outbox']){
  const result=await pool.query<{count:number}>(`SELECT count(*)::int AS count FROM ls_service_interest.${table} WHERE workspace_id=$1`,[f.workspace]);
  expect(result.rows[0]?.count,table).toBe(0);
 }
},30000);
