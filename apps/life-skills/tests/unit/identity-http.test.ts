import { test,vi } from 'vitest';
import assert from 'node:assert/strict';
import { randomBytes,randomUUID } from 'node:crypto';
import { asId } from '../../src/lib/ids.ts';
import { AppError } from '../../src/lib/errors.ts';
import { IdentityHttp,identityRouteMethods,type IdentityHttpServices } from '../../src/features/identity/http.ts';
import { opaqueToken,csrfSecret } from '../../src/features/identity/crypto.ts';
import type { IdentityConfig } from '../../src/features/identity/config.ts';
import type { Actor } from '../../src/features/identity/types.ts';
import {accountRead} from '../../src/features/identity/client.ts';
function fixture(role:Actor['role']='parent'){
 const config:IdentityConfig={enabled:true,origin:'https://app.example.invalid',workspaceId:asId(randomUUID(),'workspace'),csrfKey:randomBytes(32),lookupKey:randomBytes(32),rateLimitKey:opaqueToken(),keyring:{activeKeyId:'test',keys:{test:randomBytes(32)}},sessionSeconds:28800};
 const token=opaqueToken(),preauth=opaqueToken(),actor:Actor={id:asId(randomUUID(),'account'),workspaceId:config.workspaceId,personId:asId(randomUUID(),'person'),role,state:'active',locale:'he',sessionDigest:'a'.repeat(64),expiresAt:Date.now()+60000};
 const denied=async()=>{throw new AppError('NOT_FOUND');};
 const list=vi.fn(async()=>[]);
 const services={auth:{preauth:async()=>({token:preauth,csrf:csrfSecret(preauth,config.csrfKey,'preauth')}),assertPreauth:async()=>{},requestReset:vi.fn(async()=>{})},sessions:{actor:async()=>actor,csrf:(value:string)=>csrfSecret(value,config.csrfKey,'session')},cases:{create:denied,audience:denied,list},accounts:{inviteParent:denied},preferences:{replace:vi.fn(async()=>{})},limits:{consume:async()=>({count:1,retryAfterMs:1000})},audit:{write:async()=>{}}} as unknown as IdentityHttpServices;
 return {config,services,token,preauth,actor,list,http:new IdentityHttp(config,{now:()=>new Date()},services)};
}
for(const path of ['/api/identity/child/login','/api/identity/student/reset','/api/identity/register','/api/identity/bootstrap'])test(`route is absent: ${path}`,async()=>{
 const {http,config}=fixture();const response=await http.handle(new Request(config.origin+path,{method:'POST'}));assert.ok(response.status===404);
});
test('protected API denies missing session before any body mutation',async()=>{const f=fixture(),response=await f.http.handle(new Request(f.config.origin+'/api/identity/cases'));assert.ok(response.status===401 && response.headers.get('Cache-Control')==='private, no-store');});

test('audience management is an explicit owning-practitioner view, not a broadened shared read',async()=>{
 const f=fixture('practitioner'),id=asId(randomUUID(),'case'),audiences=vi.fn(async(...args:unknown[])=>{void args;return[];});
 f.services.cases.audiences=audiences;
 const headers={Cookie:'__Host-ls-session='+f.token};
 assert.equal((await f.http.handle(new Request(f.config.origin+'/api/identity/audiences?caseId='+id,{headers}))).status,200);
 assert.deepEqual(audiences.mock.calls,[[f.actor,id]]);audiences.mockClear();
 assert.equal((await f.http.handle(new Request(f.config.origin+'/api/identity/audiences?caseId='+id+'&view=management',{headers}))).status,200);
 assert.deepEqual(audiences.mock.calls,[[f.actor,id,'management']]);audiences.mockClear();
 for(const query of ['&view=shared','&view=','&view=management&view=management','&view=management&audienceId='+randomUUID(),'&role=practitioner'])
  assert.equal((await f.http.handle(new Request(f.config.origin+'/api/identity/audiences?caseId='+id+query,{headers}))).status,400);
 assert.equal(audiences.mock.calls.length,0);
});
test.each(['parent','child','adult_client'] as const)('%s cannot discover unpublished management audiences',async role=>{
 const f=fixture(role),audiences=vi.fn(async(...args:unknown[])=>{void args;return[];});f.services.cases.audiences=audiences;
 assert.equal((await f.http.handle(new Request(f.config.origin+'/api/identity/audiences?caseId='+randomUUID()+'&view=management',{headers:{Cookie:'__Host-ls-session='+f.token}}))).status,404);
 assert.equal(audiences.mock.calls.length,0);
});

test.each(['practitioner','parent','child','adult_client'] as const)('%s Messages audience page uses only an exact bounded authorized cursor',async role=>{
 const f=fixture(role),id=asId(randomUUID(),'case'),before=asId(randomUUID(),'audience'),audiences=vi.fn(async(...args:unknown[])=>{void args;return[];});f.services.cases.audiences=audiences;
 const url=f.config.origin+'/api/identity/audiences?caseId='+id,headers={Cookie:'__Host-ls-session='+f.token};
 assert.equal((await f.http.handle(new Request(url+'&view=messages',{headers}))).status,200);assert.deepEqual(audiences.mock.calls,[[f.actor,id,'messages',undefined]]);audiences.mockClear();
 assert.equal((await f.http.handle(new Request(url+'&view=messages&beforeAudienceId='+before,{headers}))).status,200);assert.deepEqual(audiences.mock.calls,[[f.actor,id,'messages',before]]);audiences.mockClear();
 for(const query of ['&beforeAudienceId='+before,'&view=management&beforeAudienceId='+before,'&view=messages&audienceId='+before,'&view=messages&beforeAudienceId=bad','&view=messages&beforeAudienceId='+before+'&beforeAudienceId='+before])
  assert.equal((await f.http.handle(new Request(url+query,{headers}))).status,400);assert.equal(audiences.mock.calls.length,0);
});

test.each(['live','demo'] as const)('passes only a validated practitioner %s case query to the pre-limit service',async mode=>{
 const f=fixture('practitioner'),response=await f.http.handle(new Request(f.config.origin+'/api/identity/cases?mode='+mode,{headers:{Cookie:'__Host-ls-session='+f.token}}));
 assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'private, no-store');
 assert.deepEqual(f.list.mock.calls,[[f.actor,mode]]);
});
test.each(['parent','child','adult_client'] as const)('retains the ordinary %s case selector and denies practitioner-only filtering',async role=>{
 const f=fixture(role),headers={Cookie:'__Host-ls-session='+f.token};
 assert.equal((await f.http.handle(new Request(f.config.origin+'/api/identity/cases',{headers}))).status,200);
 assert.deepEqual(f.list.mock.calls,[[f.actor,undefined]]);f.list.mockClear();
 assert.equal((await f.http.handle(new Request(f.config.origin+'/api/identity/cases?mode=demo',{headers}))).status,403);
 assert.equal(f.list.mock.calls.length,0);
});
test.each(['?mode=all','?mode=','?mode=live&mode=live','?mode=live&caseId='+randomUUID(),'?mode=live&role=practitioner','?token='+opaqueToken()])('rejects unrecognized or repeated case query %s',async query=>{
 const f=fixture('practitioner');assert.equal((await f.http.handle(new Request(f.config.origin+'/api/identity/cases'+query,{headers:{Cookie:'__Host-ls-session='+f.token}}))).status,400);
 assert.equal(f.list.mock.calls.length,0);
});
test('explicit case filtering still requires a session and the configured origin',async()=>{
 const f=fixture('practitioner');assert.equal((await f.http.handle(new Request(f.config.origin+'/api/identity/cases?mode=live'))).status,401);
 assert.equal((await f.http.handle(new Request('https://foreign.invalid/api/identity/cases?mode=live',{headers:{Cookie:'__Host-ls-session='+f.token}}))).status,400);
 assert.equal(f.list.mock.calls.length,0);
});
test('browser bridge encodes only a cases-specific mode and preserves ordinary authorized reads',async()=>{
 const fetch=vi.fn(async(path:string,init:RequestInit)=>({ok:Boolean(path&&init),json:async()=>({ok:true,data:[]})}));vi.stubGlobal('fetch',fetch);
 try{
  await accountRead('cases','live');assert.equal(fetch.mock.calls[0]?.[0],'/api/identity/cases?mode=live');
  await accountRead('cases');assert.equal(fetch.mock.calls[1]?.[0],'/api/identity/cases');
  await accountRead('cases','demo');assert.equal(fetch.mock.calls[2]?.[0],'/api/identity/cases?mode=demo');
  assert.equal((fetch.mock.calls[0]?.[1] as RequestInit).credentials,'same-origin');
  assert.equal((fetch.mock.calls[0]?.[1] as RequestInit).cache,'no-store');
  for(const [resource,mode] of [['contacts','live'],['cases','all'],['cases','live&role=practitioner']] as const)
   await assert.rejects(accountRead(resource,mode as 'live'),{code:'INVALID_REQUEST'});
  assert.equal(fetch.mock.calls.length,3);
 }finally{vi.unstubAllGlobals();}
});
test('protected mutation rejects missing CSRF and a cross-origin request',async()=>{
 const f=fixture();for(const headers of [{Origin:f.config.origin},{Origin:'https://evil.example.invalid','X-CSRF-Token':csrfSecret(f.token,f.config.csrfKey,'session')}]){
  const response=await f.http.handle(new Request(f.config.origin+'/api/identity/preferences',{method:'PUT',headers:{...headers,Cookie:'__Host-ls-session='+f.token,'Content-Type':'application/json'},body:'{}'}));assert.ok(response.status===403);
 }
});
test('strict preference boundary refuses another account identifier',async()=>{
 const f=fixture(),response=await f.http.handle(new Request(f.config.origin+'/api/identity/preferences',{method:'PUT',headers:{Origin:f.config.origin,Cookie:'__Host-ls-session='+f.token,'X-CSRF-Token':csrfSecret(f.token,f.config.csrfKey,'session'),'Content-Type':'application/json'},body:JSON.stringify({accountId:randomUUID(),preferences:[]})}));assert.ok(response.status===400);
});
test('reset response is identical for known and unknown addresses and never exposes an identifier',async()=>{
 const f=fixture();const bodies=[];
 for(const email of ['known@example.invalid','unknown@example.invalid']){
  const response=await f.http.handle(new Request(f.config.origin+'/api/identity/reset/request',{method:'POST',headers:{Origin:f.config.origin,Cookie:'__Host-ls-preauth='+f.preauth,'X-CSRF-Token':csrfSecret(f.preauth,f.config.csrfKey,'preauth'),'Content-Type':'application/json'},body:JSON.stringify({email})}));
  assert.ok(response.status===202);const body=await response.json();bodies.push(body.data);assert.deepEqual(Object.keys(body).sort(),['data','ok','requestId']);
 }
 assert.deepEqual(bodies[0],bodies[1]);
});
test('account-supplied role/child subject fields do not pass parent-invite schema',async()=>{
 const f=fixture(),response=await f.http.handle(new Request(f.config.origin+'/api/identity/invites/parent',{method:'POST',headers:{Origin:f.config.origin,Cookie:'__Host-ls-session='+f.token,'X-CSRF-Token':csrfSecret(f.token,f.config.csrfKey,'session'),'Content-Type':'application/json'},body:JSON.stringify({caseId:randomUUID(),email:'parent@example.invalid',displayName:'Synthetic Parent',locale:'he',role:'child'})}));assert.ok(response.status===400);
});
test('auth routes refuse query-string credentials and unrecognized methods',async()=>{
 const f=fixture();assert.ok((await f.http.handle(new Request(f.config.origin+'/api/identity/reset/complete?token='+opaqueToken(),{method:'POST'}))).status===400);
 assert.ok((await f.http.handle(new Request(f.config.origin+'/api/identity/login',{method:'GET'}))).status===404);
});
test('the optional child invitation is the only registered child route and no public bootstrap exists',()=>{
 const matching=Object.keys(identityRouteMethods).filter(path=>/(child|student|register|bootstrap)/.test(path));
 assert.deepEqual(matching,['/api/identity/invites/child']);
 assert.deepEqual(identityRouteMethods['/api/identity/invites/child'],['POST']);
});
