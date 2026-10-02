/** Actual production SQL binder, encrypted storage, proxy and Updates HTTP.
 * Persisted synthetic fixture sessions are not ordinary password-login proof.
 */
import {afterEach,expect,test,vi} from 'vitest';
import {NextRequest} from 'next/server';
import {randomBytes,randomUUID} from 'node:crypto';
import {fixture,poolStore,type Fixture} from '../calendar/fixture.ts';
import {systemClock} from '../../../src/features/identity/types.ts';
import type {IdentityConfig} from '../../../src/features/identity/config.ts';
import {IdentitySessions} from '../../../src/features/identity/session-adapter.ts';
import {PostgresIdentityRateStore} from '../../../src/features/identity/rate-store.ts';
import {durableAuditSink} from '../../../src/features/identity/history.ts';
import {HomePracticeService} from '../../../src/features/home-practice/service.ts';
import {SqlPublishedPracticeVersionReader} from '../../../src/features/updates/practice-reader.ts';
import {UpdateService} from '../../../src/features/updates/service.ts';
import {Ls080Http} from '../../../src/features/updates/http.ts';
import {proxy} from '../../../src/proxy.ts';
const opened:Fixture[]=[];
afterEach(async()=>{vi.unstubAllEnvs();await Promise.all(opened.splice(0).map(f=>f.pool.end()));});
async function setup(){
 const f=await fixture();opened.push(f);const config:IdentityConfig={enabled:true,origin:'https://synthetic.example.invalid',workspaceId:f.workspaceId,csrfKey:randomBytes(32),lookupKey:randomBytes(32),rateLimitKey:randomUUID(),keyring:f.keyring,sessionSeconds:3600},store=poolStore(f.pool),sessions=new IdentitySessions(store,config,systemClock),practice=new HomePracticeService(store,config,systemClock);
 const updates=new UpdateService(store,config,systemClock,new SqlPublishedPracticeVersionReader(store),practice),http=new Ls080Http(config,systemClock,{sessions,updates,limits:new PostgresIdentityRateStore(store),audit:durableAuditSink(store)});
 vi.stubEnv('NODE_ENV','production');vi.stubEnv('LS_APP_MODE','foundation_locked');vi.stubEnv('LS_APP_ORIGIN',config.origin);vi.stubEnv('LS_PRIVATE_APP_ENABLED','true');
 async function request(method:'GET'|'POST',path:string,body?:unknown,token:string|null=f.parent.token,extra:Record<string,string>={}){
  const headers=new Headers({host:'synthetic.example.invalid','x-forwarded-host':'synthetic.example.invalid','x-forwarded-proto':'https'});if(token)headers.set('Cookie',`__Host-ls-session=${token}`);
  if(method==='POST'){headers.set('Origin',config.origin);headers.set('Content-Type','application/json');if(token)headers.set('X-CSRF-Token',sessions.csrf(token));}for(const[k,v]of Object.entries(extra))headers.set(k,v);
  const inbound=new NextRequest('http://127.0.0.1:8080'+path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})}),perimeter=proxy(inbound);
  if(perimeter.headers.get('x-middleware-next')!=='1')return perimeter;const forwarded=new Headers(inbound.headers);
  for(const key of (perimeter.headers.get('x-middleware-override-headers')??'').split(',').filter(Boolean)){const value=perimeter.headers.get('x-middleware-request-'+key);if(value===null)forwarded.delete(key);else forwarded.set(key,value);}
  return http.handle(new Request(inbound,{headers:forwarded}));
 }
 const list=(c=f.first)=>'/api/updates?'+new URLSearchParams({caseId:c.id,audienceId:c.audienceId});
 async function report(){const source=await practice.createDraft(f.practitioner.actor,{caseId:f.first.id,audienceId:f.first.audienceId,templateKey:'DEMO updates native',templateVersion:'synthetic-v1',instructions:'DEMO exact published source',startsOn:f.at(0).slice(0,10),endsOn:null},randomUUID());await practice.publish(f.practitioner.actor,source.assignmentId,source.versionId,randomUUID());
  const input={action:'submit_report',caseId:f.first.id,audienceId:f.first.audienceId,practiceVersionId:source.versionId,body:'DEMO attributed report / תצפית סינתטית',idempotencyKey:randomUUID()},response=await request('POST','/api/updates',input);expect(response.status).toBe(201);return{source,input,record:(await response.json()).data};
 }
 return{f,config,request,list,report};
}
test('native forwarded report and published practitioner reply persist with exact provenance; replay preserves one encrypted record',async()=>{
 const h=await setup(),{f}=h;expect((await h.request('GET',h.list())).status).toBe(200);const {source,input,record}=await h.report();
 expect(record).toMatchObject({caseId:f.first.id,audienceId:f.first.audienceId,authorAccountId:f.parent.actor.id,practice:{versionId:source.versionId,assignmentId:source.assignmentId}});
 const replay=await h.request('POST','/api/updates',input);expect(replay.status).toBe(201);expect((await replay.json()).data).toEqual(record);
 const conflict=await h.request('POST','/api/updates',{...input,body:'DEMO different body'});expect(conflict.status).toBe(409);
 const encrypted=(await f.pool.query('SELECT body_ciphertext FROM ls_updates.parent_reports WHERE workspace_id=$1',[f.workspaceId])).rows;expect(encrypted).toHaveLength(1);expect(encrypted[0].body_ciphertext).not.toContain(input.body);
 expect((await h.request('POST','/api/updates',{action:'review',reportId:record.id},f.practitioner.token)).status).toBe(201);
 const reply={action:'reply',reportId:record.id,body:'DEMO exact published reply',publish:true,idempotencyKey:randomUUID()},response=await h.request('POST','/api/updates',reply,f.practitioner.token);expect(response.status).toBe(201);const receipt=(await response.json()).data;
 expect((await (await h.request('POST','/api/updates',reply,f.practitioner.token)).json()).data).toEqual(receipt);
 expect((await h.request('POST','/api/updates',{...reply,publish:false,body:'DEMO private draft',idempotencyKey:randomUUID()},f.practitioner.token)).status).toBe(201);
 const parentRead=await h.request('GET',h.list());expect(parentRead.headers.get('cache-control')).toBe('private, no-store');const threads=(await parentRead.json()).data;
 expect(threads).toHaveLength(1);expect(threads[0].report.reviewState).toBe('replied');expect(threads[0].replies).toEqual([receipt]);expect(JSON.stringify(threads)).not.toContain('DEMO private draft');
 expect((await (await h.request('GET',h.list(),undefined,f.practitioner.token)).json()).data[0].replies).toHaveLength(2);
});
test('native forwarded Updates preserves unauthenticated, wrong-family, CSRF, private-reply and revoked membership denials',async()=>{
 const h=await setup(),{f}=h,{input,record}=await h.report();
 expect((await h.request('GET',h.list(),undefined,null)).status).toBe(401);expect((await h.request('GET',h.list(),undefined,f.outsider.token)).status).toBe(404);expect((await h.request('GET',h.list(f.second))).status).toBe(404);
 expect((await h.request('POST','/api/updates',{action:'reply',reportId:record.id,body:'DEMO forbidden',publish:true,idempotencyKey:randomUUID()})).status).toBe(404);
 expect((await h.request('POST','/api/updates',input,f.parent.token,{'X-CSRF-Token':'invalid'})).status).toBe(403);expect((await h.request('POST','/api/updates',input,f.parent.token,{Origin:'https://foreign.invalid'})).status).toBe(403);
 await f.pool.query('UPDATE ls_cases.audience_accounts SET revoked_at=clock_timestamp() WHERE workspace_id=$1 AND case_id=$2 AND account_id=$3',[f.workspaceId,f.first.id,f.parent.actor.id]);
 expect((await h.request('GET',h.list())).status).toBe(404);expect((await h.request('POST','/api/updates',input)).status).toBe(404);expect((await f.pool.query('SELECT count(*)::int AS n FROM ls_updates.parent_reports WHERE workspace_id=$1',[f.workspaceId])).rows[0].n).toBe(1);
});
test.each([
 {'x-forwarded-proto':'http'}, {'x-forwarded-proto':'https,http'},
 {'x-forwarded-host':'foreign.invalid'}, {'x-forwarded-host':'synthetic.example.invalid,foreign.invalid'},
 {host:'foreign.invalid'}, {'x-forwarded-proto':''}, {'x-forwarded-host':''},
])('native proxy rejects invalid Updates transport without rewriting it or changing stored reports: %j',async extra=>{
 const h=await setup();expect((await h.request('GET',h.list(),undefined,h.f.parent.token,extra)).status).toBe(503);expect((await h.f.pool.query('SELECT count(*)::int AS n FROM ls_updates.parent_reports WHERE workspace_id=$1',[h.f.workspaceId])).rows[0].n).toBe(0);
});
