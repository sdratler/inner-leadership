import { randomUUID } from 'node:crypto';
import { afterEach, expect, test } from 'vitest';
import { fixture, type Fixture } from '../calendar/fixture.ts';
import { CaseService } from '../../../src/features/cases/service.ts';
import { IdentityHttp, type IdentityHttpServices } from '../../../src/features/identity/http.ts';
import { systemClock } from '../../../src/features/identity/types.ts';
import { IdentityAccountService } from '../../../src/features/identity/account-service.ts';
const opened:Fixture[]=[];
afterEach(async()=>{await Promise.all(opened.splice(0).map(f=>f.pool.end()))});
async function open(){const f=await fixture();opened.push(f);const config={enabled:true,origin:'https://synthetic.example.invalid',workspaceId:f.workspaceId,csrfKey:Buffer.alloc(32,3),lookupKey:Buffer.alloc(32,4),rateLimitKey:'synthetic-rate-key-material-0123456789',keyring:f.keyring,sessionSeconds:3600};return{...f,config,cases:new CaseService(f.db.store,config,systemClock)}}
test('case-account read decrypts accounts written by the actual invitation service, without sending mail',async()=>{
 const f=await open();const accounts=new IdentityAccountService(f.db.store,f.config,systemClock);
 await accounts.revokeGuardian(f.practitioner.actor,f.first.id,f.parentTwo.actor.id,randomUUID());
 const invited=await accounts.inviteParent(f.practitioner.actor,{caseId:f.first.id,email:'Actual-Writer@example.invalid',displayName:'Synthetic invited guardian',locale:'en'},randomUUID());
 const member=(await f.cases.caseAccessInfo(f.practitioner.actor,f.first.id)).members.find(m=>m.accountId===invited.accountId);
 expect(member).toMatchObject({email:'actual-writer@example.invalid',displayName:'Synthetic invited guardian',state:'invited',locale:'en',guardianRevokedAt:null});
 const queued=await f.pool.query("SELECT state FROM ls_identity.auth_mail_outbox WHERE workspace_id=$1 AND account_id=$2",[f.workspaceId,invited.accountId]);
 expect(queued.rows).toEqual([{state:'queued'}]);
});
test('case-account read is practitioner-only, case/workspace scoped, minimal and shows explicit revocation',async()=>{
 const f=await open();const result=await f.cases.caseAccessInfo(f.practitioner.actor,f.first.id);
 expect(result.kind).toBe('minor');expect(result.members).toHaveLength(2);expect(result.members.map(m=>m.displayName)).toContain('Synthetic parent A');
 expect(Object.keys(result.members[0]!).sort()).toEqual(['accountId','displayName','email','guardianRevokedAt','locale','role','state'].sort());
 expect(result.members.every(m=>m.email.endsWith('@example.invalid'))).toBe(true);
 await expect(f.cases.caseAccessInfo(f.parent.actor,f.first.id)).rejects.toMatchObject({code:'FORBIDDEN'});
 const other=await open();await expect(other.cases.caseAccessInfo(other.practitioner.actor,f.first.id)).rejects.toMatchObject({code:'NOT_FOUND'});
 await f.pool.query('UPDATE ls_cases.case_guardians SET revoked_at=now() WHERE workspace_id=$1 AND case_id=$2 AND account_id=$3',[f.workspaceId,f.first.id,f.parent.actor.id]);
 expect((await f.cases.caseAccessInfo(f.practitioner.actor,f.first.id)).members.find(m=>m.accountId===f.parent.actor.id)?.guardianRevokedAt).not.toBeNull();
 await f.pool.query("UPDATE ls_identity.accounts SET state='revoked' WHERE workspace_id=$1 AND id=$2",[f.workspaceId,f.practitioner.actor.id]);
 await expect(f.cases.caseAccessInfo(f.practitioner.actor,f.first.id)).rejects.toMatchObject({code:'UNAUTHENTICATED'});
});
test('audience list includes truthful publication and excludes another parent-only audience',async()=>{
 const f=await open();const privateAudience=await f.cases.createAudience(f.practitioner.actor,f.first.id,{visibility:'private',published:true},randomUUID());
 const parentB=await f.cases.createAudience(f.practitioner.actor,f.first.id,{visibility:'family_full',published:true,accountIds:[f.parentTwo.actor.id]},randomUUID());
 const practitioner=await f.cases.audiences(f.practitioner.actor,f.first.id);expect(practitioner.every(a=>a.published===true)).toBe(true);expect(practitioner.some(a=>a.id===parentB.audienceId)).toBe(true);
 const parentA=await f.cases.audiences(f.parent.actor,f.first.id);expect(parentA.some(a=>a.id===f.first.audienceId&&a.published)).toBe(true);expect(parentA.some(a=>a.id===parentB.audienceId||a.id===privateAudience.audienceId)).toBe(false);
});
test('HTTP exposes only exact case query behind session boundary, with private no-store response',async()=>{
 const f=await open(),token=f.practitioner.token;
 const services={cases:f.cases,sessions:{async actor(){return f.practitioner.actor},csrf(){return 'c'.repeat(43)}},limits:{async consume(){return{count:1,retryAfterMs:0}}},audit:{async write(){}}} as unknown as IdentityHttpServices;
 const http=new IdentityHttp(f.config,systemClock,services),url=f.config.origin+'/api/identity/case-access?caseId='+f.first.id,headers={cookie:'__Host-ls-session='+token};
 expect((await http.handle(new Request(url))).status).toBe(401);
 const good=await http.handle(new Request(url,{headers}));expect(good.status).toBe(200);expect(good.headers.get('cache-control')).toBe('private, no-store');expect((await good.json()).data.members).toHaveLength(2);
 expect((await http.handle(new Request(url+'&caseId='+f.first.id,{headers}))).status).toBe(400);
 expect((await http.handle(new Request(url+'&other=value',{headers}))).status).toBe(400);
});
