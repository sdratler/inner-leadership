import { test,vi } from 'vitest';
import assert from 'node:assert/strict';
import { randomBytes,randomUUID } from 'node:crypto';
import { asId } from '../../src/lib/ids.ts';
import { AppError } from '../../src/lib/errors.ts';
import { IdentityHttp,identityRouteMethods,type IdentityHttpServices } from '../../src/features/identity/http.ts';
import { opaqueToken,csrfSecret } from '../../src/features/identity/crypto.ts';
import type { IdentityConfig } from '../../src/features/identity/config.ts';
import type { Actor } from '../../src/features/identity/types.ts';
function fixture(){
 const config:IdentityConfig={enabled:true,origin:'https://app.example.invalid',workspaceId:asId(randomUUID(),'workspace'),csrfKey:randomBytes(32),lookupKey:randomBytes(32),rateLimitKey:opaqueToken(),keyring:{activeKeyId:'test',keys:{test:randomBytes(32)}},sessionSeconds:28800};
 const token=opaqueToken(),preauth=opaqueToken(),actor:Actor={id:asId(randomUUID(),'account'),workspaceId:config.workspaceId,personId:asId(randomUUID(),'person'),role:'parent',state:'active',locale:'he',sessionDigest:'a'.repeat(64),expiresAt:Date.now()+60000};
 const denied=async()=>{throw new AppError('NOT_FOUND');};
 const services={auth:{preauth:async()=>({token:preauth,csrf:csrfSecret(preauth,config.csrfKey,'preauth')}),assertPreauth:async()=>{},requestReset:vi.fn(async()=>{})},sessions:{actor:async()=>actor,csrf:(value:string)=>csrfSecret(value,config.csrfKey,'session')},cases:{create:denied,audience:denied,list:async()=>[]},accounts:{inviteParent:denied},preferences:{replace:vi.fn(async()=>{})},limits:{consume:async()=>({count:1,retryAfterMs:1000})},audit:{write:async()=>{}}} as unknown as IdentityHttpServices;
 return {config,services,token,preauth,http:new IdentityHttp(config,{now:()=>new Date()},services)};
}
for(const path of ['/api/identity/child/login','/api/identity/student/reset','/api/identity/register','/api/identity/bootstrap'])test(`route is absent: ${path}`,async()=>{
 const {http,config}=fixture();const response=await http.handle(new Request(config.origin+path,{method:'POST'}));assert.ok(response.status===404);
});
test('protected API denies missing session before any body mutation',async()=>{const f=fixture(),response=await f.http.handle(new Request(f.config.origin+'/api/identity/cases'));assert.ok(response.status===401 && response.headers.get('Cache-Control')==='private, no-store');});
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
test('no child/student route or public bootstrap is registered',()=>assert.ok(Object.keys(identityRouteMethods).every(path=>!/(child|student|register|bootstrap)/.test(path))));
