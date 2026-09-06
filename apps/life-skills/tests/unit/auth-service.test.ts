import { test } from 'vitest';
import assert from 'node:assert/strict';
import { randomUUID,randomBytes } from 'node:crypto';
import { asId } from '../../src/lib/ids.ts';
import { AppError } from '../../src/lib/errors.ts';
import { IdentityAuthService } from '../../src/features/identity/auth-service.ts';
import { IdentitySessions } from '../../src/features/identity/session-adapter.ts';
import { opaqueToken,hashPassword,tokenDigest,blindEmail,seal } from '../../src/features/identity/crypto.ts';
import type { IdentityConfig } from '../../src/features/identity/config.ts';
import type { AccountRow } from '../../src/features/identity/data.ts';
import type { IdentityStore,SqlSession } from '../../src/features/identity/store.ts';
interface Step {contains:string;rows:object[];check?:(values:readonly unknown[])=>void;}
class ScriptStore implements IdentityStore {
 constructor(private readonly steps:Step[]){}
 async transaction<T>(work:(tx:SqlSession)=>Promise<T>):Promise<T>{return work({query:async<R extends object>(sql:string,values:readonly unknown[]=[])=>{
  const step=this.steps.shift();assert.ok(step && sql.includes(step.contains),'unexpected database operation in scripted unit test');step.check?.(values);return step.rows as R[];
 }});}
 done(){assert.ok(this.steps.length===0,'all scripted operations should execute');}
}
function fixture(){
 const now=new Date(),clock={now:()=>new Date(now)},id=asId(randomUUID(),'account');
 const config:IdentityConfig={enabled:true,origin:'https://app.example.invalid',workspaceId:asId(randomUUID(),'workspace'),csrfKey:randomBytes(32),lookupKey:randomBytes(32),rateLimitKey:opaqueToken(),keyring:{activeKeyId:'test',keys:{test:randomBytes(32)}},sessionSeconds:28800};
 return {config,clock,id};
}
async function row(config:IdentityConfig,id:AccountRow['id'],password:string):Promise<AccountRow>{return {
 id,workspaceId:config.workspaceId,personId:asId(randomUUID(),'person'),role:'parent',state:'active',locale:'he',emailBlind:blindEmail('parent@example.invalid',config.lookupKey),emailCiphertext:seal('parent@example.invalid',`email:${config.workspaceId}:${id}`,config.keyring),emailVerifiedAt:new Date(),passwordHash:await hashPassword(password),phoneCiphertext:null,phoneVerifiedAt:null,
};}
test('real login service creates a fresh session digest rather than reusing the preauth token',async()=>{
 const {config,clock,id}=fixture(),password=opaqueToken(),preauth=opaqueToken(),candidate=await row(config,id,password);let storedDigest='';
 const store=new ScriptStore([
  {contains:'a.email_blind=$2',rows:[candidate]}, {contains:'FOR UPDATE',rows:[{id:config.workspaceId}]}, {contains:'a.id=$2',rows:[candidate]},
  {contains:'DELETE FROM ls_identity.preauth_sessions',rows:[{token_digest:tokenDigest(preauth)}]},
  {contains:'INSERT INTO ls_identity.sessions',rows:[],check(values){storedDigest=String(values[0]);assert.ok(storedDigest!==preauth && !values.includes(password),'raw credentials must not be persisted');}},
  {contains:'INSERT INTO ls_identity.action_history',rows:[]},
 ]);
 const result=await new IdentityAuthService(store,config,clock).login('parent@example.invalid',password,preauth,randomUUID());
 assert.ok(result.token!==preauth && tokenDigest(result.token)===storedDigest);store.done();
});
test('revocation during password verification prevents session creation',async()=>{
 const {config,clock,id}=fixture(),password=opaqueToken(),candidate=await row(config,id,password);
 const store=new ScriptStore([{contains:'a.email_blind=$2',rows:[candidate]},{contains:'FOR UPDATE',rows:[{id:config.workspaceId}]},{contains:'a.id=$2',rows:[{...candidate,state:'revoked'}]}]);
 await assert.rejects(()=>new IdentityAuthService(store,config,clock).login('parent@example.invalid',password,opaqueToken(),randomUUID()),e=>e instanceof AppError && e.code==='UNAUTHENTICATED');store.done();
});
test('credential replacement during verification prevents a stale-password session',async()=>{
 const {config,clock,id}=fixture(),password=opaqueToken(),candidate=await row(config,id,password),changed=await hashPassword(opaqueToken());
 const store=new ScriptStore([{contains:'a.email_blind=$2',rows:[candidate]},{contains:'FOR UPDATE',rows:[{id:config.workspaceId}]},{contains:'a.id=$2',rows:[{...candidate,passwordHash:changed}]}]);
 await assert.rejects(()=>new IdentityAuthService(store,config,clock).login('parent@example.invalid',password,opaqueToken(),randomUUID()),e=>e instanceof AppError && e.code==='UNAUTHENTICATED');store.done();
});
test('reset request uses the same blinded queue insert without account lookup',async()=>{
 const {config,clock}=fixture();
 for(const email of ['known@example.invalid','unknown@example.invalid']){
  const store=new ScriptStore([{contains:'INSERT INTO ls_identity.reset_requests',rows:[],check(v){assert.ok(!v.includes(email) && v[2]===blindEmail(email,config.lookupKey),'reset queue should contain only the blinded lookup value');}}]);
  await new IdentityAuthService(store,config,clock).requestReset(email,randomUUID());store.done();
 }
});
test('expired, used, revoked or wrong-purpose token cannot reach account writes',async()=>{
 const {config,clock}=fixture();
 const store=new ScriptStore([{contains:'FOR UPDATE',rows:[{id:config.workspaceId}]},{contains:'FROM ls_identity.auth_tokens',rows:[]}]);
 await assert.rejects(()=>new IdentityAuthService(store,config,clock).consumePasswordToken('invite',opaqueToken(),opaqueToken(),randomUUID()),e=>e instanceof AppError && e.code==='INVALID_REQUEST');store.done();
});
test('invited account cannot bypass invitation verification using the login route',async()=>{
 const {config,clock,id}=fixture(),password=opaqueToken(),candidate=await row(config,id,password);
 const store=new ScriptStore([{contains:'a.email_blind=$2',rows:[{...candidate,state:'invited',emailVerifiedAt:null}]}]);
 await assert.rejects(()=>new IdentityAuthService(store,config,clock).login('parent@example.invalid',password,opaqueToken(),randomUUID()),e=>e instanceof AppError && e.code==='UNAUTHENTICATED');store.done();
});
test('preauth expiry lookup fails closed',async()=>{
 const {config,clock}=fixture(),store=new ScriptStore([{contains:'FROM ls_identity.preauth_sessions',rows:[]}]);
 await assert.rejects(()=>new IdentityAuthService(store,config,clock).assertPreauth(opaqueToken()),e=>e instanceof AppError && e.code==='FORBIDDEN');store.done();
});
test('real session adapter rejects a revoked account even with a still-present session row',async()=>{
 const {config,clock,id}=fixture(),candidate=await row(config,id,opaqueToken());
 const store=new ScriptStore([{contains:'FROM ls_identity.sessions',rows:[{accountId:id,expiresAt:new Date(Date.now()+60000)}]},{contains:'a.id=$2',rows:[{...candidate,state:'revoked'}]}]);
 assert.ok(await new IdentitySessions(store,config,clock).resolve(opaqueToken())===null);store.done();
});
