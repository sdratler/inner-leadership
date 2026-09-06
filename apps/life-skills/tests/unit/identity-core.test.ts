import { test } from 'vitest';
import assert from 'node:assert/strict';
import { randomBytes,randomUUID } from 'node:crypto';
import { asId } from '../../src/lib/ids.ts';
import { AppError } from '../../src/lib/errors.ts';
import { requireSession,sessionCookieOptions } from '../../src/lib/security/session.ts';
import { verifyMutationOrigin,verifyCsrfToken } from '../../src/lib/security/csrf.ts';
import { enforceRateLimit,opaqueRateLimitKey } from '../../src/lib/security/rate-limit.ts';
import { visibilityValues,isVisibility } from '../../src/lib/visibility.ts';
import { caseAccess,audienceAccess,projectSharedItem,validateAssignees,requireOwnPreference,isCaseLifecycle } from '../../src/features/cases/policy.ts';
import type { CaseFacts,GuardianFacts,AudienceFacts } from '../../src/features/cases/policy.ts';
import type { AccountFacts } from '../../src/features/identity/types.ts';
import { opaqueToken,tokenDigest,hashPassword,verifyPassword,seal,unseal,csrfSecret,validatePassword,blindEmail } from '../../src/features/identity/crypto.ts';
import { parseIdentityConfig,identityEnabled } from '../../src/features/identity/config.ts';
import { defaultPreference,inQuietHours,validatePreference } from '../../src/features/identity/preferences.ts';
import { SyntheticAuthEmailSink } from '../../src/providers/email/sink.ts';
import { ResendAuthTransport,parseResendAuthConfig } from '../../src/providers/email/resend.ts';
import { AuthEmailDeliveryError } from '../../src/providers/email/transport.ts';
import { authEmailContent } from '../../src/providers/email/template.ts';
import { takeAuthTokenFragment } from '../../src/features/identity/client.ts';
const workspace=asId(randomUUID(),'workspace'),otherWorkspace=asId(randomUUID(),'workspace');
function account(role:AccountFacts['role'],state:AccountFacts['state']='active'):AccountFacts{return {id:asId(randomUUID(),'account'),workspaceId:workspace,personId:asId(randomUUID(),'person'),role,state,locale:'he'};}
const practitioner=account('practitioner'),parentA=account('parent'),parentB=account('parent'),outsider=account('parent'),adult=account('adult_client');
const item:CaseFacts={id:asId(randomUUID(),'case'),workspaceId:workspace,clientPersonId:asId(randomUUID(),'person'),practitionerAccountId:practitioner.id,kind:'minor',state:'active'};
const guardians:GuardianFacts[]=[parentA,parentB].map(a=>({accountId:a.id,workspaceId:workspace,caseId:item.id,revoked:false}));
const audience:AudienceFacts={id:asId(randomUUID(),'audience'),workspaceId:workspace,caseId:item.id,visibility:'family_full',published:true,accountIds:[parentA.id,parentB.id]};
function denied(fn:()=>unknown,code='NOT_FOUND'){assert.throws(fn,error=>error instanceof AppError && error.code===code);}
for(const actor of [practitioner,parentA,parentB]) test(`authorized ${actor.role} ${actor===parentB?'second':'first'} case read`,()=>assert.ok(caseAccess(actor,item,guardians,'read').caseId===item.id));
for(const actor of [parentA,parentB,adult,outsider]) for(const operation of ['write','publish'] as const) test(`deny ${actor.role} ${actor===parentB?'second':actor===outsider?'unrelated':'first'} ${operation}`,()=>denied(()=>caseAccess(actor,item,guardians,operation)));
test('practitioner may write and publish own case',()=>{assert.ok(caseAccess(practitioner,item,guardians,'write'));assert.ok(caseAccess(practitioner,item,guardians,'publish'));});
test('family context without case guardian grant does not authorize',()=>denied(()=>caseAccess(parentA,item,[],'read')));
test('foreign workspace is never enumerated',()=>denied(()=>caseAccess({...parentA,workspaceId:otherWorkspace},item,guardians,'read')));
test('unrelated practitioner cannot enumerate a case',()=>denied(()=>caseAccess(account('practitioner'),item,guardians,'read')));
test('absent case and unauthorized case use same denial',()=>{denied(()=>caseAccess(parentA,null,guardians,'read'));denied(()=>caseAccess(outsider,item,guardians,'read'));});
for(const state of ['invited','revoked'] as const)test(`nonactive ${state} account cannot read`,()=>denied(()=>caseAccess({...parentA,state},item,guardians,'read')));
test('revoked guardian cannot read despite cached audience',()=>denied(()=>audienceAccess(parentA,item,guardians.map(g=>({...g,revoked:true})),audience)));
test('parent B has independent access when parent A is revoked',()=>assert.ok(audienceAccess(parentB,item,guardians.map(g=>({...g,revoked:g.accountId===parentA.id})),audience)));
test('private material denies both parents',()=>{for(const a of [parentA,parentB])denied(()=>audienceAccess(a,item,guardians,{...audience,visibility:'private'}));});
test('unpublished audience is not visible to parents',()=>denied(()=>audienceAccess(parentA,item,guardians,{...audience,published:false})));
test('private audience exception is not expanded by membership',()=>denied(()=>audienceAccess(parentB,item,guardians,{...audience,accountIds:[parentA.id]})));
test('new parent has no historical audience access',()=>denied(()=>audienceAccess(outsider,item,[...guardians,{workspaceId:workspace,caseId:item.id,accountId:outsider.id,revoked:false}],audience)));
test('audience cannot cross cases or workspaces',()=>{denied(()=>audienceAccess(parentA,item,guardians,{...audience,caseId:asId(randomUUID(),'case')}));denied(()=>audienceAccess(parentA,item,guardians,{...audience,workspaceId:otherWorkspace}));});
test('title/completion projector contains no details or incidental private properties',()=>{
 const input={id:randomUUID(),title:'Synthetic task',completed:false,publicDetails:'Shareable synthetic detail',privateNotes:'not a permitted projection field'};
 const result=projectSharedItem(parentA,item,guardians,{...audience,visibility:'family_title_completion'},input);
 assert.deepEqual(Object.keys(result).sort(),['completed','id','title']);
});
test('full projector whitelists deliberately shared fields only',()=>{
 const input={id:randomUUID(),title:'Synthetic task',completed:false,publicDetails:'Shareable',privateNotes:'Do not project'};
 assert.deepEqual(Object.keys(projectSharedItem(parentA,item,guardians,audience,input)).sort(),['completed','details','id','title']);
});
test('adult compatibility is own adult case only',()=>{
 const own={...item,kind:'adult' as const,clientPersonId:adult.personId};assert.ok(caseAccess(adult,own,[],'read'));
 denied(()=>caseAccess(adult,item,[],'read'));denied(()=>caseAccess(account('adult_client'),own,[],'read'));
});
test('a revoked account is denied on an adult case too',()=>denied(()=>caseAccess({...adult,state:'revoked'},{...item,kind:'adult',clientPersonId:adult.personId},[],'read')));
test('shared assignees cannot expand a private audience',()=>denied(()=>validateAssignees(parentA,item,guardians,{...audience,accountIds:[parentA.id]},[parentA.id,parentB.id])));
test('shared assignees validate membership and uniqueness',()=>{assert.ok(validateAssignees(parentA,item,guardians,audience,[parentA.id,parentB.id]).length===2);denied(()=>validateAssignees(parentA,item,guardians,audience,[parentA.id,parentA.id]),'INVALID_REQUEST');});
test('parent cannot change another parent preference or consent',()=>{requireOwnPreference(parentA,parentA.id);denied(()=>requireOwnPreference(parentA,parentB.id));denied(()=>requireOwnPreference(practitioner,parentA.id));});
test('baseline visibility values are reused without another enum',()=>{assert.ok(visibilityValues.length===3);for(const v of visibilityValues)assert.ok(isVisibility(v));assert.ok(!isVisibility('student_shared'));});
for(const state of ['invited','intake','active','paused','completed','archived'])test(`canonical lifecycle ${state} supported without implicit revocation`,()=>{assert.ok(isCaseLifecycle(state));assert.ok(caseAccess(parentA,{...item,state:state as CaseFacts['state']},guardians,'read'));});
test('marketing lifecycle is not an app lifecycle',()=>{assert.ok(!isCaseLifecycle('qualified_lead'));assert.ok(!isCaseLifecycle('won'));});
test('opaque tokens are independent and only one-way digests persist',()=>{const a=opaqueToken(),b=opaqueToken();assert.ok(a!==b && a.length===43 && b.length===43);assert.ok(tokenDigest(a)!==a && tokenDigest(a).length===64);denied(()=>tokenDigest('../invalid'),'INVALID_REQUEST');});
test('blind email is canonicalized and keyed',()=>{const k=randomBytes(32);assert.ok(blindEmail(' PARENT@example.invalid ',k)===blindEmail('parent@example.invalid',k));assert.ok(blindEmail('parent@example.invalid',k)!==blindEmail('parent@example.invalid',randomBytes(32)));});
test('passwords are salted scrypt verifiers, not reversible or fixed fixtures',async()=>{
 const password=opaqueToken(),first=await hashPassword(password),second=await hashPassword(password);
 assert.ok(first!==second && !first.includes(password));assert.ok(await verifyPassword(password,first));assert.ok(!await verifyPassword(opaqueToken(),first));assert.ok(!await verifyPassword(password,'invalid-format'));
});
test('password policy counts Unicode codepoints, bounds bytes and allows paste-length passphrases',()=>{validatePassword(opaqueToken());denied(()=>validatePassword('x'.repeat(14)),'INVALID_REQUEST');denied(()=>validatePassword('x'.repeat(129)),'INVALID_REQUEST');validatePassword('א'.repeat(15));});
test('AES-GCM envelopes bind field, workspace and object; key rotation preserves old values',()=>{
 const old=randomBytes(32),ring={activeKeyId:'v1',keys:{v1:old}},message='Synthetic profile';const encrypted=seal(message,'person:synthetic:one',ring);
 assert.ok(!encrypted.includes(message));assert.ok(unseal(encrypted,'person:synthetic:one',ring)===message);
 denied(()=>unseal(encrypted,'person:synthetic:two',ring),'UNAVAILABLE');denied(()=>unseal(encrypted,'person:synthetic:one',{activeKeyId:'v1',keys:{v1:randomBytes(32)}}),'UNAVAILABLE');
 assert.ok(unseal(encrypted,'person:synthetic:one',{activeKeyId:'v2',keys:{v1:old,v2:randomBytes(32)}})===message);
});
test('corrupt ciphertext and malformed envelopes fail neutrally',()=>{const ring={activeKeyId:'a',keys:{a:randomBytes(32)}};denied(()=>unseal('{}','field',ring),'UNAVAILABLE');denied(()=>unseal('not-json','field',ring),'UNAVAILABLE');});
test('CSRF is bound to a particular token, purpose and private key',()=>{const key=randomBytes(32),token=opaqueToken(),pre=csrfSecret(token,key,'preauth');assert.ok(pre!==csrfSecret(token,key,'session'));verifyCsrfToken(pre,pre);denied(()=>verifyCsrfToken(null,pre),'FORBIDDEN');denied(()=>verifyCsrfToken(opaqueToken(),pre),'FORBIDDEN');});
test('mutation origin and fetch-site checks reject forged cross-site requests',()=>{
 verifyMutationOrigin(new Request('https://app.example.invalid',{method:'POST',headers:{Origin:'https://app.example.invalid','Sec-Fetch-Site':'same-origin'}}),'https://app.example.invalid');
 denied(()=>verifyMutationOrigin(new Request('https://app.example.invalid',{method:'POST',headers:{Origin:'https://evil.example.invalid'}}),'https://app.example.invalid'),'FORBIDDEN');
 denied(()=>verifyMutationOrigin(new Request('https://app.example.invalid',{method:'POST',headers:{Origin:'https://app.example.invalid','Sec-Fetch-Site':'cross-site'}}),'https://app.example.invalid'),'FORBIDDEN');
});
test('session expiry and revocation fail closed in reused baseline adapter contract',async()=>{
 const opaque=opaqueToken(),valid={accountId:parentA.id,workspaceId:workspace,expiresAt:Date.now()+60000,revoked:false};
 assert.ok(await requireSession(opaque,{async resolve(){return valid;}}));
 for(const bad of [{...valid,revoked:true},{...valid,expiresAt:0},null])await assert.rejects(()=>requireSession(opaque,{async resolve(){return bad;}}),e=>e instanceof AppError && e.code==='UNAUTHENTICATED');
 await assert.rejects(()=>requireSession(opaque,{async resolve(){throw new Error('unavailable');}}),e=>e instanceof AppError && e.code==='UNAVAILABLE');
});
test('host session cookie has strict transport and lifetime requirements',()=>{const c=sessionCookieOptions(3600);assert.ok(c.secure && c.httpOnly && c.path==='/' && c.sameSite==='lax');assert.throws(()=>sessionCookieOptions(86401));});
test('atomic rate contract denies excess and backend failure',async()=>{
 const key=opaqueRateLimitKey('synthetic-subject',opaqueToken());let count=0;
 const store={async consume(){return {count:++count,retryAfterMs:1000};}};
 await enforceRateLimit(store,key,1,1000);await assert.rejects(()=>enforceRateLimit(store,key,1,1000),e=>e instanceof AppError && e.code==='RATE_LIMITED');
 await assert.rejects(()=>enforceRateLimit({async consume(){throw new Error('unavailable');}},key,1,1000),e=>e instanceof AppError && e.code==='UNAVAILABLE');
});
test('identity stays disabled without explicit validated configuration',()=>{
 assert.ok(!identityEnabled({}));denied(()=>parseIdentityConfig({LS_IDENTITY_ENABLED:'true'}),'UNAVAILABLE');
 const env={LS_IDENTITY_ENABLED:'true',LS_APP_ORIGIN:'https://app.example.invalid',LS_IDENTITY_WORKSPACE_ID:workspace,LS_IDENTITY_DATA_KEYS:JSON.stringify({k1:opaqueToken()}),LS_IDENTITY_ACTIVE_KEY_ID:'k1',LS_IDENTITY_CSRF_KEY:opaqueToken(),LS_IDENTITY_LOOKUP_KEY:opaqueToken(),LS_IDENTITY_RATE_KEY:opaqueToken()};
 assert.ok(parseIdentityConfig(env).sessionSeconds===28800);denied(()=>parseIdentityConfig({...env,LS_APP_ORIGIN:'http://app.example.invalid'}),'UNAVAILABLE');denied(()=>parseIdentityConfig({...env,LS_IDENTITY_LOOKUP_KEY:env.LS_IDENTITY_CSRF_KEY}),'UNAVAILABLE');
});
test('preferences default to in-app only and keep overnight quiet windows local',()=>{
 assert.ok(defaultPreference('practice_due','in_app','he').enabled);assert.ok(!defaultPreference('practice_due','whatsapp','he').enabled);
 const p={...defaultPreference('practice_due','email','he'),enabled:true,quietStart:'22:00',quietEnd:'07:00'};
 assert.ok(inQuietHours(p,new Date('2026-09-06T20:30:00Z')));assert.ok(!inQuietHours(p,new Date('2026-09-06T10:00:00Z')));
 denied(()=>validatePreference({...p,timezone:'not/a-zone'}),'INVALID_REQUEST');denied(()=>validatePreference({...p,quietEnd:null}),'INVALID_REQUEST');
});
test('token fragments are removed immediately and never accepted from another parameter',()=>{
 let replaced='';const token=opaqueToken();const history={replaceState(_a:unknown,_b:string,url?:string|URL|null){replaced=String(url);}};
 assert.ok(takeAuthTokenFragment({hash:'#token='+token,pathname:'/auth/reset'},history)===token);assert.ok(replaced==='/auth/reset');
 assert.ok(takeAuthTokenFragment({hash:'#token='+token+'&other=x',pathname:'/auth/reset'},history)===null);
});
test('authentication email is neutral and uses a fragment rather than a query token',()=>{
 const token=opaqueToken(),message=authEmailContent('https://app.example.invalid','invite',{recipient:'parent@example.invalid',locale:'he',token});
 assert.ok(message.text.includes('/auth/invite#token=') && !message.text.includes('?token=') && !message.text.includes('parent@example.invalid'));
 denied(()=>authEmailContent('http://app.example.invalid','invite',{recipient:'parent@example.invalid',locale:'en',token}),'UNAVAILABLE');
});
test('synthetic sink is idempotent and rejects real destinations',async()=>{
 const sink=new SyntheticAuthEmailSink('synthetic-test'),message={from:'service@example.invalid',to:'parent@example.invalid',subject:'Synthetic account',text:'Synthetic',idempotencyKey:'ls-auth-'+randomUUID()};
 const a=await sink.send(message),b=await sink.send(message);assert.ok(a.providerId===b.providerId && sink.messages.length===1);
 await assert.rejects(()=>sink.send({...message,to:'not-a-synthetic-destination'}),e=>e instanceof AppError && e.code==='FORBIDDEN');sink.clear();
});
test('Resend adapter validates configuration and uses fixed endpoint with delivery-only data',async()=>{
 denied(()=>parseResendAuthConfig({}),'UNAVAILABLE');let inspected=false;
 const config=parseResendAuthConfig({LS_AUTH_EMAIL_ENABLED:'true',RESEND_API_KEY:'re_'+opaqueToken(),LS_AUTH_EMAIL_FROM:'service@example.invalid'});
 const transport=new ResendAuthTransport(config,(async(url,init)=>{
  assert.ok(url==='https://api.resend.com/emails' && init?.redirect==='error');const body=JSON.parse(String(init?.body));
  assert.deepEqual(Object.keys(body).sort(),['from','subject','text','to']);assert.ok(new Headers(init?.headers).has('Idempotency-Key'));inspected=true;
  return Response.json({id:randomUUID()});
 }) as typeof fetch);
 await transport.send({from:config.from,to:'parent@example.invalid',subject:'Synthetic account',text:'Synthetic',idempotencyKey:'ls-auth-'+randomUUID()});assert.ok(inspected);
});
test('Resend network errors contain no remote body or credential details',async()=>{
 const config={enabled:true,apiKey:'re_'+opaqueToken(),from:'service@example.invalid'},transport=new ResendAuthTransport(config,(async()=>{throw new Error('synthetic transport error');}) as typeof fetch);
 await assert.rejects(()=>transport.send({from:config.from,to:'parent@example.invalid',subject:'Account',text:'Synthetic',idempotencyKey:'ls-auth-'+randomUUID()}),e=>e instanceof AuthEmailDeliveryError && e.message==='AUTH_EMAIL_DELIVERY_FAILED' && e.retryable);
});
