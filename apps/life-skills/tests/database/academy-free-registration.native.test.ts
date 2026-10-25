import {afterAll,beforeAll,expect,test,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
vi.mock('server-only',()=>({}));
import {academyTestDatabase,academyWorkspace,academyCommand} from './academy-free-registration-fixture.ts';
import {publicGroupApplicationHttp} from '../../src/features/group-application/http.ts';
import {groupApplicationReviewHttp} from '../../src/features/group-application/review-http.ts';
import {founderOwnerHttp,founderPublicHttp} from '../../src/features/group-application/academy-founder-http.ts';
import {ACADEMY_CAMPAIGN,PREREG_CREATIVE} from '../../src/features/group-application/academy-campaign-contract.ts';
import {opaqueToken,unseal} from '../../src/features/identity/crypto.ts';
import {SESSION_COOKIE} from '../../src/lib/security/session.ts';

let db:Awaited<ReturnType<typeof academyTestDatabase>>;
beforeAll(async()=>{db=await academyTestDatabase();},60000);
afterAll(async()=>{await db?.close();});

test('real public HTTP saves two children as one family, replays durably and rejects changed operation or attribution',async()=>{
 const f=await academyWorkspace(db.pool),command=academyCommand();let now=Date.now();
 const touch={campaign:ACADEMY_CAMPAIGN,source:'facebook',medium:'social',content:PREREG_CREATIVE.id} as const,attribution={first:touch,last:touch};
 const dependencies=async()=>({enabled:true,environment:{NODE_ENV:'production',LS_APP_ORIGIN:f.origin},challengeKey:f.digestKey,now:()=>now,limits:f.runtime.limits,store:f.applications});
 const url=f.origin+'/api/public/group-applications?program=sunday_fishing_academy',host=new URL(f.origin).host;
 const get=await publicGroupApplicationHttp(new Request(url,{headers:{host}}),dependencies);expect(get.status).toBe(200);expect(get.headers.get('set-cookie')).toContain('HttpOnly; Secure; SameSite=Strict');
 const challenge=(await get.json()).data.challenge as string,cookie=get.headers.get('set-cookie')!.split(';')[0]!;now+=1600;
 const post=(body:unknown)=>publicGroupApplicationHttp(new Request(url,{method:'POST',headers:{host,origin:f.origin,'sec-fetch-site':'same-origin','content-type':'application/json',cookie},body:JSON.stringify(body)}),dependencies);
 const body={...command,website:'',challenge,attribution},saved=await post(body);expect(saved.status).toBe(201);const result=(await saved.json()).data;
 expect(result).toMatchObject({saved:true,replayed:false,duplicate:false,founder:{status:'reserved',email:'queued',deadline:null}});expect(result.item.fields).toEqual(command.fields);
 const exact=await post(body);expect(exact.status).toBe(200);expect((await exact.json()).data).toMatchObject({saved:true,replayed:true,item:{id:result.item.id}});
 const alias=await post({...body,operationId:randomUUID()});expect(alias.status).toBe(200);expect((await alias.json()).data).toMatchObject({duplicate:true,item:{id:result.item.id}});
 expect((await post({...body,fields:{...command.fields,parentName:'Changed payload'}})).status).toBe(409);
 expect((await post({...body,attribution:{first:touch,last:{...touch,source:'whatsapp',medium:'message'}}})).status).toBe(409);
 const owner=await f.founder.ownerList(f.owner.actor);expect(owner.metrics).toMatchObject({completedRegistrations:1,uniqueFamilies:1,children:2,activeFounderReservations:1,confirmedInterest:0,offersSent:0,paidFamilies:0,paidChildren:0,collectedCents:0,confirmedEnrollment:0});
 expect(owner.families).toHaveLength(1);expect(owner.families[0]!.children.map(c=>c.id)).toEqual(command.fields.academyRegistration.learners.map(c=>c.id));expect(owner.families[0]!.payment.sentAt).toBeNull();expect(owner.messages).toHaveLength(1);expect(owner.messages[0]!.state).toBe('queued');expect(await f.founder.aggregate()).toMatchObject({phase:'PRE_REGISTRATION',occupied:1,remaining:29});
 const fresh=await academyWorkspace(db.pool);expect(await fresh.applications.list(fresh.owner.actor)).toEqual([]);
 const durable=(await db.pool.query('SELECT payload_ciphertext FROM ls_service_interest.public_applications WHERE workspace_id=$1',[f.workspace])).rows;expect(durable).toHaveLength(1);expect(durable[0].payload_ciphertext).not.toContain('Synthetic Older');
 expect(await f.applications.replaySaved(command,{first:{...touch,source:'facebook',medium:'social'},last:{...touch,source:'facebook',medium:'social'}})).toMatchObject({item:{id:result.item.id}});
},30000);

test('ordinary owner HTTP decrypts the saved family, with real session role, workspace and revocation denials',async()=>{
 const f=await academyWorkspace(db.pool),other=await academyWorkspace(db.pool),command=academyCommand(),saved=await f.applications.submit(command,opaqueToken());
 const request=(token:string,path='/api/private/group-applications')=>new Request(f.origin+path,{headers:{host:new URL(f.origin).host,'x-forwarded-proto':'https',cookie:SESSION_COOKIE+'='+token}});
 const load=async()=>({origin:f.origin,actor:(token:string)=>f.runtime.sessions.actor(token),store:f.applications});
 const owner=await groupApplicationReviewHttp(request(f.owner.token),load);expect(owner.status).toBe(200);const read=(await owner.json()).data;expect(read.items).toHaveLength(1);expect(read.items[0]).toEqual(saved.item);
 const founderLoad=async()=>({runtime:f.runtime,store:f.founder});
 const founder=await founderOwnerHttp(request(f.owner.token,'/api/private/group-applications/founder'),founderLoad);expect(founder.status).toBe(200);expect((await founder.json()).data.metrics).toMatchObject({uniqueFamilies:1,children:2,paidChildren:0,confirmedEnrollment:0});
 for(const response of [await groupApplicationReviewHttp(request(f.parent.token),load),await founderOwnerHttp(request(f.parent.token,'/api/private/group-applications/founder'),founderLoad)]){expect(response.status).toBe(403);expect(await response.text()).not.toContain(command.fields.parentName);}
 expect((await groupApplicationReviewHttp(request(other.owner.token),load)).status).toBe(401);
 // A real authenticated actor from another workspace still cannot read this store.
 const cross=await groupApplicationReviewHttp(request(other.owner.token),async()=>({origin:f.origin,actor:(token:string)=>other.runtime.sessions.actor(token),store:f.applications}));expect(cross.status).toBe(403);expect(await cross.text()).not.toContain(command.fields.parentName);
 await expect(f.founder.ownerList(other.owner.actor)).rejects.toMatchObject({code:'FORBIDDEN'});
 await db.pool.query('UPDATE ls_identity.sessions SET revoked_at=now() WHERE workspace_id=$1 AND token_digest=$2',[f.workspace,f.owner.actor.sessionDigest]);
 expect((await groupApplicationReviewHttp(request(f.owner.token),load)).status).toBe(401);expect((await founderOwnerHttp(request(f.owner.token,'/api/private/group-applications/founder'),founderLoad)).status).toBe(401);
 await expect(f.applications.list(f.owner.actor)).rejects.toMatchObject({code:'UNAUTHENTICATED'});await expect(f.founder.ownerList(f.owner.actor)).rejects.toMatchObject({code:'UNAUTHENTICATED'});
},30000);

test('independent pool transactions serialize the 29-to-30 race and preserve founders when regular registration opens',async()=>{
 const f=await academyWorkspace(db.pool);for(let i=0;i<29;i++)await f.applications.submit(academyCommand(),opaqueToken());expect(await f.founder.aggregate()).toMatchObject({occupied:29,remaining:1,phase:'PRE_REGISTRATION'});
 const clients=await Promise.all([db.pool.connect(),db.pool.connect()]);try{const ids=await Promise.all(clients.map(c=>c.query('SELECT pg_backend_pid() AS pid')));expect(ids[0]!.rows[0].pid).not.toBe(ids[1]!.rows[0].pid);}finally{clients.forEach(c=>c.release());}
 const leased=new Set<PoolClient>();let peak=0;
 const acquire=(client:PoolClient)=>{leased.add(client);peak=Math.max(peak,leased.size);},release=(_error:Error|undefined,client:PoolClient)=>{leased.delete(client);};
 db.pool.on('acquire',acquire);db.pool.on('release',release);
 try{const both=await Promise.all([academyCommand(),academyCommand()].map(c=>f.applications.submit(c,opaqueToken())));expect(both.map(r=>r.founder?.status).sort()).toEqual(['regular_registration','reserved']);expect(peak).toBeGreaterThanOrEqual(2);}finally{db.pool.off('acquire',acquire);db.pool.off('release',release);}
 expect(await f.founder.aggregate()).toMatchObject({occupied:30,remaining:0,phase:'REGULAR_REGISTRATION',firstFilledAt:expect.any(String)});
 const ordinary=await f.applications.submit(academyCommand(),opaqueToken());expect(ordinary.founder?.status).toBe('regular_registration');
 const read=await f.founder.ownerList(f.owner.actor);expect(read.metrics).toMatchObject({completedRegistrations:32,uniqueFamilies:32,children:64,activeFounderReservations:30,collectedCents:0,paidChildren:0,confirmedEnrollment:0});expect(read.families.filter(family=>family.allocated)).toHaveLength(30);
 expect((await db.pool.query('SELECT count(*)::int AS n FROM ls_service_interest.public_applications WHERE workspace_id=$1',[f.workspace])).rows[0].n).toBe(32);
},60000);

test('public GET and confirmation-context read are inert; explicit confirmation cannot start before a successful send',async()=>{
 const f=await academyWorkspace(db.pool);await f.applications.submit(academyCommand(),opaqueToken());
 const mail=(await db.pool.query('SELECT id,payload_ciphertext FROM ls_service_interest.inquiry_email_outbox WHERE workspace_id=$1',[f.workspace])).rows[0];
 const token=JSON.parse(unseal(mail.payload_ciphertext,`ls_service_interest/inquiry_email/v1/${f.workspace}/${mail.id}`,f.ring)).token as string;
 const readState=async()=>({families:(await db.pool.query('SELECT to_jsonb(f) AS row FROM ls_service_interest.academy_founder_families f WHERE workspace_id=$1',[f.workspace])).rows,messages:(await db.pool.query('SELECT to_jsonb(m) AS row FROM ls_service_interest.inquiry_email_outbox m WHERE workspace_id=$1',[f.workspace])).rows});const before=await readState();
 const dependencies=async()=>({enabled:true,store:f.founder,environment:{NODE_ENV:'production',LS_APP_ORIGIN:f.origin},limits:f.runtime.limits,rateKey:f.digestKey}),url=f.origin+'/api/public/academy-founder',headers={host:new URL(f.origin).host,origin:f.origin,'sec-fetch-site':'same-origin','content-type':'application/json'};
 const get=await founderPublicHttp(new Request(url,{headers}),dependencies);expect(get.status).toBe(200);expect(await readState()).toEqual(before);
 const context=await founderPublicHttp(new Request(url,{method:'POST',headers,body:JSON.stringify({action:'read_confirmation',token})}),dependencies);expect(context.status).toBe(200);expect((await context.json()).data).toMatchObject({available:false,confirmed:false,deadline:null});expect(await readState()).toEqual(before);
 const forbidden=await founderPublicHttp(new Request(url,{method:'POST',headers:{...headers,origin:'https://foreign.example.invalid'},body:JSON.stringify({action:'confirm_interest',token})}),dependencies);expect(forbidden.status).toBe(403);
 const confirm=await founderPublicHttp(new Request(url,{method:'POST',headers,body:JSON.stringify({action:'confirm_interest',token})}),dependencies);expect(confirm.status).toBe(409);expect(await readState()).toEqual(before);
},30000);
