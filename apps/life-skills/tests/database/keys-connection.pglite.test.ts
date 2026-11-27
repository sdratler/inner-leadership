import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {beforeAll,afterAll,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {KeysConnectionStore,keysConnectionSignature,parseKeysConnectionConfig,type KeysConnectionGrant} from '../../src/features/keys-trip/connection-store.ts';
import {KeysInterestStore} from '../../src/features/keys-trip/store.ts';
import {asId} from '../../src/lib/ids.ts';
import type {IdentityStore,SqlSession} from '../../src/features/identity/store.ts';
import {keysCurrentContact} from '../../src/features/keys-trip/contract.ts';
import {keysFixture} from '../fixtures/keys-trip.ts';
const db=new PGlite(),workspace=asId(randomUUID(),'workspace'),ownerId=randomUUID(),now=Date.now();
const ring={activeKeyId:'synthetic',keys:{synthetic:Buffer.alloc(32,27)}},digestKey='synthetic-connection-digest-key-atleast32characters';
const adapter:IdentityStore={transaction:fn=>db.transaction(tx=>fn({query:async<T extends object>(sql:string,values:readonly unknown[]=[])=> (await tx.query<T>(sql,[...values])).rows} as SqlSession))};
const grant:KeysConnectionGrant={key:Buffer.alloc(32,18).toString('base64url'),grantId:randomUUID(),siteId:'synthetic-site',userId:'synthetic-owner',email:'owner@example.invalid',notBefore:now-60_000,expiresAt:now+86400_000};
const clock={now:()=>new Date()};
const store=(g=grant,id=ownerId)=>new KeysConnectionStore(adapter,workspace,ring,digestKey,id,g,clock);
const appStore=()=>new KeysInterestStore(adapter,workspace,ring,digestKey,ownerId,clock);
function envelope(operation:string,args:unknown={},overrides:Record<string,unknown>={}){return JSON.stringify({version:1,grantId:grant.grantId,siteId:grant.siteId,userId:grant.userId,email:grant.email,issuedAt:Date.now(),nonce:randomUUID(),command:{operation,arguments:args},...overrides});}
function run(operation:string,args:unknown={},overrides:Record<string,unknown>={}){const body=envelope(operation,args,overrides);return store().executeSigned(body,keysConnectionSignature(grant.key,body));}
let applicationId:string;
beforeAll(async()=>{
 await db.exec('CREATE SCHEMA ls_control');
 for(const name of ['0001_ls_foundation.sql','0010_ls_identity_cases_20260906.sql','0124_ls_group_interest.sql','0131_ls_public_group_applications.sql','0135_ls_inquiry_email_outbox.sql','0136_ls_academy_founder.sql','0140_ls_fishing_inquiry_followups.sql'])await db.exec(await readFile('migrations/'+name,'utf8'));
 await db.query('INSERT INTO ls_identity.workspaces(id) VALUES($1)',[workspace]);
 await db.query("INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,'adult','synthetic',clock_timestamp())",[ownerId,workspace]);
 await db.query("INSERT INTO ls_identity.accounts(id,workspace_id,role,state,locale,email_blind,email_ciphertext,email_verified_at,password_hash,created_at,updated_at) VALUES($1,$2,'practitioner','active','en',$3,'synthetic',clock_timestamp(),'synthetic',clock_timestamp(),clock_timestamp())",[ownerId,workspace,'1'.repeat(64)]);
 await db.query('INSERT INTO ls_identity.account_subjects(workspace_id,account_id,person_id) VALUES($1,$2,$2)',[workspace,ownerId]);
 applicationId=(await appStore().submit(keysFixture('bridge-synthetic@example.invalid'))).item.id;
},30000);
afterAll(async()=>db.close());
it('is disabled by default and rejects incomplete or unbounded runtime grants',()=>{
 expect(parseKeysConnectionConfig({})).toBeNull();expect(()=>parseKeysConnectionConfig({LS_KEYS_CHAT_ENABLED:'true'})).toThrow();
 const env={LS_KEYS_CHAT_ENABLED:'true',LS_KEYS_CHAT_HMAC_KEY:grant.key,LS_KEYS_CHAT_GRANT_ID:grant.grantId,LS_KEYS_CHAT_SITE_ID:grant.siteId,LS_KEYS_CHAT_OWNER_USER_ID:grant.userId,LS_KEYS_CHAT_OWNER_EMAIL:grant.email,LS_KEYS_CHAT_NOT_BEFORE:new Date(grant.notBefore).toISOString(),LS_KEYS_CHAT_EXPIRES_AT:new Date(grant.expiresAt).toISOString()};
 expect(parseKeysConnectionConfig(env)).toEqual(grant);expect(()=>parseKeysConnectionConfig({...env,LS_KEYS_CHAT_EXPIRES_AT:new Date(grant.notBefore+32*86400_000).toISOString()})).toThrow();
});
it('rejects signature tampering, stale timestamp, other site/user/email and unknown operations',async()=>{
 const body=envelope('get_trip');await expect(store().executeSigned(body,'0'.repeat(64))).rejects.toMatchObject({code:'UNAUTHENTICATED'});
 await expect(store().executeSigned(body+' ',keysConnectionSignature(grant.key,body))).rejects.toMatchObject({code:'UNAUTHENTICATED'});
 for(const overrides of [{issuedAt:Date.now()-91_000},{siteId:'other-site'},{userId:'other-user'},{email:'other@example.invalid'},{grantId:randomUUID()}])await expect(run('get_trip',{},overrides)).rejects.toMatchObject({code:'UNAUTHENTICATED'});
 await expect(run('send_message')).rejects.toMatchObject({code:'INVALID_REQUEST'});
 expect((await db.query('SELECT count(*)::int AS n FROM ls_identity.rate_counters')).rows).toEqual([{n:0}]);
});
it('uses a real owner grant without a browser session and consumes replay nonce durably',async()=>{
 expect((await db.query('SELECT count(*)::int AS n FROM ls_identity.sessions')).rows).toEqual([{n:0}]);
 const body=envelope('get_inquiry',{applicationId}),signature=keysConnectionSignature(grant.key,body);
 expect(await store().executeSigned(body,signature)).toMatchObject({application:{id:applicationId},followup:{version:0}});
 await expect(store().executeSigned(body,signature)).rejects.toMatchObject({code:'CONFLICT'});
 expect(await run('list_inquiries',{limit:1})).toMatchObject({items:[{application:{id:applicationId}}],nextCursor:null});
 expect(await run('pickup_summary')).toMatchObject({requests:1,boyInterests:2,complete:true});
});
it('rechecks exact active verified practitioner in the same transaction and grant expiry',async()=>{
 const body=envelope('get_trip');await expect(store(grant,randomUUID()).executeSigned(body,keysConnectionSignature(grant.key,body))).rejects.toMatchObject({code:'UNAUTHENTICATED'});
 await db.query("UPDATE ls_identity.accounts SET state='revoked' WHERE id=$1",[ownerId]);await expect(run('get_trip')).rejects.toMatchObject({code:'UNAUTHENTICATED'});await db.query("UPDATE ls_identity.accounts SET state='active' WHERE id=$1",[ownerId]);
 await db.query("UPDATE ls_identity.accounts SET role='parent' WHERE id=$1",[ownerId]);await expect(run('get_trip')).rejects.toMatchObject({code:'UNAUTHENTICATED'});await db.query("UPDATE ls_identity.accounts SET role='practitioner' WHERE id=$1",[ownerId]);
 await expect(store({...grant,expiresAt:Date.now()-1}).executeSigned(body,keysConnectionSignature(grant.key,body))).rejects.toMatchObject({code:'UNAUTHENTICATED'});
});
it('appends shared canonical followups; exact retry is idempotent; rejects stale and altered writes',async()=>{
 const fixture=keysFixture('not-saved@example.invalid');const command={operationId:randomUUID(),applicationId,expectedVersion:0,status:'contacted',note:'Synthetic owner update',nextAction:null,dueDate:null,waitingCondition:'Await parent response',contactCorrection:{version:'JLFA-KEYS-CONTACT-CORRECTION-v1',...keysCurrentContact(fixture.fields),phone:'+13055550456',reason:'Parent supplied correction'}};
 const before=(await db.query('SELECT payload_ciphertext FROM ls_service_interest.public_applications WHERE id=$1',[applicationId])).rows;
 expect(await run('update_inquiry',command)).toMatchObject({saved:true,followup:{version:1,replayed:false}});
 expect(await run('update_inquiry',command)).toMatchObject({saved:true,followup:{version:1,replayed:true}});
 await expect(run('update_inquiry',{...command,note:'Different'})).rejects.toMatchObject({code:'CONFLICT'});
 await expect(run('update_inquiry',{...command,operationId:randomUUID()})).rejects.toMatchObject({code:'CONFLICT'});
 expect(await run('get_inquiry',{applicationId})).toMatchObject({followup:{version:1},currentContact:{phone:'+13055550456'}});
 expect((await db.query('SELECT payload_ciphertext FROM ls_service_interest.public_applications WHERE id=$1',[applicationId])).rows).toEqual(before);
 expect((await db.query('SELECT count(*)::int AS n FROM ls_service_interest.inquiry_email_outbox')).rows).toEqual([{n:0}]);
 await expect(run('get_inquiry',{applicationId:randomUUID()})).rejects.toMatchObject({code:'NOT_FOUND'});
});
