import {expect,test,vi} from 'vitest';
import {randomBytes,randomUUID} from 'node:crypto';
import {ReminderHttp} from '../../../src/features/reminders/http.ts';
import {AppError} from '../../../src/lib/errors.ts';
import {asId} from '../../../src/lib/ids.ts';
import {opaqueRateLimitKey} from '../../../src/lib/security/rate-limit.ts';
import {csrfSecret,opaqueToken} from '../../../src/features/identity/crypto.ts';
import type {Actor} from '../../../src/features/identity/types.ts';
import type {IdentityConfig} from '../../../src/features/identity/config.ts';
function fixture(role:Actor['role']='parent'){
 const token=opaqueToken(),config:IdentityConfig={enabled:true,origin:'https://app.example.invalid',workspaceId:asId(randomUUID(),'workspace'),csrfKey:randomBytes(32),lookupKey:randomBytes(32),rateLimitKey:opaqueToken(),keyring:{activeKeyId:'test',keys:{test:randomBytes(32)}},sessionSeconds:3600};
 const actor:Actor={id:asId(randomUUID(),'account'),workspaceId:config.workspaceId,personId:asId(randomUUID(),'person'),role,state:'active',locale:'he',sessionDigest:'a'.repeat(64),expiresAt:Date.now()+3600000};
 const list=vi.fn(async()=>({items:[],nextCursor:null,morePending:false,externalDeliveryActive:false as const})),markRead=vi.fn(async(_actor:Actor,id:string)=>({id,readAt:new Date().toISOString()}));
 const consume=vi.fn(async(key:string,windowMs:number)=>{expect(key).toMatch(/^[a-f0-9]{64}$/);expect(windowMs).toBe(900000);return{count:1,retryAfterMs:1000};}),write=vi.fn(async(event:unknown)=>{expect(event).toMatchObject({kind:'access_denied',outcome:'denied'});});
 const sessions={actor:vi.fn(async()=>actor),csrf:(value:string)=>csrfSecret(value,config.csrfKey,'session')};
 const http=new ReminderHttp(config,{now:()=>new Date()},{sessions,limits:{consume},audit:{write},service:{list,markRead}});
 function request(method='GET',path:string[]=[],query='',body:unknown={},extra:Record<string,string>={},authenticated=true){const headers=new Headers({...extra});if(authenticated)headers.set('Cookie','__Host-ls-session='+token);if(method==='PATCH'){headers.set('Content-Type','application/json');if(!headers.has('Origin'))headers.set('Origin',config.origin);if(!headers.has('X-CSRF-Token'))headers.set('X-CSRF-Token',sessions.csrf(token));}return http.handle(new Request(config.origin+'/api/notifications'+(path.length?'/'+path.join('/'):'')+query,{method,headers,...(method==='GET'?{}:{body:JSON.stringify(body)})}),path);}
 return{actor,config,list,markRead,consume,write,sessions,request};
}
test.each(['parent','adult_client','practitioner']as const)('ordinary %s gets only its own minimal reminders and the shared account bucket',async role=>{
 const f=fixture(role),response=await f.request();expect(response.status).toBe(200);expect(f.list).toHaveBeenCalledWith(f.actor,null);
 expect(f.consume).toHaveBeenCalledWith(opaqueRateLimitKey('account:'+f.actor.id,f.config.rateLimitKey),900000);
 for(const [key,value]of [['Cache-Control','private, no-store'],['Vary','Cookie'],['Referrer-Policy','no-referrer'],['X-Content-Type-Options','nosniff']]as const)expect(response.headers.get(key)).toBe(value);
 expect(response.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
});
test('requires real session and separately enabled optional child account',async()=>{
 const f=fixture();expect((await f.request('GET',[],'',{}, {},false)).status).toBe(401);expect(f.list).not.toHaveBeenCalled();
 const child=fixture('child');expect((await child.request()).status).toBe(403);expect(child.write).toHaveBeenCalledTimes(1);child.config.childAccountsEnabled=true;expect((await child.request()).status).toBe(200);
});
test.each(['?accountId='+randomUUID(),'?caseId='+randomUUID(),'?cursor=a&cursor=a','?role=practitioner'])('rejects recipient/role/query expansion %s',async query=>{const f=fixture();expect((await f.request('GET',[],query)).status).toBe(400);expect(f.list).not.toHaveBeenCalled();});
test.each([['POST',[]],['GET',['deliver']],['PATCH',['x','send']],['PATCH',['not-an-id','read']]]as const)('has no public sender or alternate route: %s %j',async(method,path)=>{const f=fixture();expect([400,404]).toContain((await f.request(method,[...path])).status);expect(f.markRead).not.toHaveBeenCalled();});
test('read mutation is strict, CSRF protected and does not accept another account',async()=>{
 const f=fixture(),id=randomUUID();expect((await f.request('PATCH',[id,'read'])).status).toBe(200);expect(f.markRead).toHaveBeenCalledWith(f.actor,id);f.markRead.mockClear();
 for(const [body,headers]of [[{accountId:randomUUID()},{}],[{readAt:new Date().toISOString()},{}],[{}, {'Origin':'https://evil.invalid'}],[{}, {'X-CSRF-Token':'invalid'}]]as const){expect([400,403]).toContain((await f.request('PATCH',[id,'read'],'',body,headers)).status);}
 expect(f.markRead).not.toHaveBeenCalled();expect(f.write).toHaveBeenCalledTimes(2);
});
test('rate limit and failed durable denial audit stay fail closed',async()=>{
 const f=fixture();f.consume.mockResolvedValue({count:151,retryAfterMs:1000});expect((await f.request()).status).toBe(429);expect(f.list).not.toHaveBeenCalled();
 f.consume.mockResolvedValue({count:1,retryAfterMs:1000});f.list.mockRejectedValue(new AppError('NOT_FOUND'));f.write.mockRejectedValue(new Error('synthetic private failure'));const response=await f.request();expect(response.status).toBe(503);expect(JSON.stringify(await response.json())).not.toContain('synthetic private failure');
});
