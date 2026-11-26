import {createHash,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {afterAll,beforeAll,expect,it,vi} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
vi.mock('server-only',()=>({}));
import {KeysInterestStore} from '../../src/features/keys-trip/store.ts';
import {KEYS_CONSENT,keysCurrentContact,type KeysOwnerUpdate} from '../../src/features/keys-trip/contract.ts';
import {PublicGroupApplicationStore} from '../../src/features/group-application/store.ts';
import {FishingInquiryFollowupStore} from '../../src/features/group-application/fishing-followup-store.ts';
import {floridaGroupApplicationNotice} from '../../src/features/group-application/contract.ts';
import type {IdentityStore,SqlSession} from '../../src/features/identity/store.ts';
import type {Actor} from '../../src/features/identity/types.ts';
import {asId} from '../../src/lib/ids.ts';
import {keysFixture} from '../fixtures/keys-trip.ts';

const db=new PGlite(),workspace=asId(randomUUID(),'workspace'),now=new Date('2026-11-26T21:00:00Z');
const ring={activeKeyId:'synthetic',keys:{synthetic:Buffer.alloc(32,19)}},key='synthetic-keys-trip-digest-key-at-least32chars';
const adapter:IdentityStore={transaction:fn=>db.transaction(tx=>fn({query:async<T extends object>(sql:string,values:readonly unknown[]=[])=> (await tx.query<T>(sql,[...values])).rows} as SqlSession))};
const clock={now:()=>now};let owner:Actor,parent:Actor,other:Actor;
function store(){return new KeysInterestStore(adapter,workspace,ring,key,owner.id,clock);}
async function actor(role:'practitioner'|'parent',scope=workspace){
 const id=randomUUID(),digest=id.replaceAll('-','').padEnd(64,'0');
 await db.query("INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,'adult','synthetic',$3)",[id,scope,now]);
 await db.query("INSERT INTO ls_identity.accounts(id,workspace_id,role,state,locale,email_blind,email_ciphertext,email_verified_at,password_hash,created_at,updated_at) VALUES($1,$2,$3,'active','en',$4,'synthetic',$5,'synthetic',$5,$5)",[id,scope,role,digest,now]);
 await db.query('INSERT INTO ls_identity.account_subjects(workspace_id,account_id,person_id) VALUES($1,$2,$2)',[scope,id]);
 await db.query('INSERT INTO ls_identity.sessions(token_digest,workspace_id,account_id,created_at,expires_at) VALUES($1,$2,$3,$4,$5)',[digest,scope,id,now,new Date('2030-01-01')]);
 return {id,workspaceId:scope,personId:id,role,state:'active',locale:'en',sessionDigest:digest,expiresAt:new Date('2030-01-01').getTime()} as Actor;
}
beforeAll(async()=>{
 await db.exec('CREATE SCHEMA ls_control');
 const manifest=JSON.parse(await readFile('migrations/manifest.json','utf8')) as {name:string;sha256:string}[];
 for(const name of ['0001_ls_foundation.sql','0010_ls_identity_cases_20260906.sql','0124_ls_group_interest.sql','0131_ls_public_group_applications.sql','0135_ls_inquiry_email_outbox.sql','0136_ls_academy_founder.sql','0140_ls_fishing_inquiry_followups.sql']){
  const sql=await readFile('migrations/'+name,'utf8');expect(createHash('sha256').update(sql).digest('hex')).toBe(manifest.find(row=>row.name===name)?.sha256);await db.exec(sql);
 }
 await db.query('INSERT INTO ls_identity.workspaces(id,created_at) VALUES($1,$2)',[workspace,now]);
 owner=await actor('practitioner');parent=await actor('parent');const otherWorkspace=asId(randomUUID(),'workspace');await db.query('INSERT INTO ls_identity.workspaces(id,created_at) VALUES($1,$2)',[otherWorkspace,now]);other=await actor('practitioner',otherWorkspace);
},30000);
afterAll(async()=>db.close());
it('stores an encrypted one-day request with exact consent and no mail, person, booking or payment side effects',async()=>{
 const before=(await db.query('SELECT (SELECT count(*) FROM ls_identity.people) AS people,(SELECT count(*) FROM ls_cases.cases) AS cases,(SELECT count(*) FROM ls_service_interest.inquiry_email_outbox) AS mail')).rows;
 const input=keysFixture(),saved=await store().submit(input);expect(saved).toMatchObject({saved:true,replayed:false,duplicate:false,item:{fields:input.fields}});
 const row=(await db.query<{payload_ciphertext:string;notice_version:string;received_at:Date}>('SELECT payload_ciphertext,notice_version,received_at FROM ls_service_interest.public_applications WHERE id=$1',[saved.item.id])).rows[0]!;
 expect(row.payload_ciphertext).not.toContain(input.fields.email);expect(row.payload_ciphertext).not.toContain(input.fields.children[0]!.name);expect(row.notice_version).toBe(KEYS_CONSENT.version);expect(row.received_at.toISOString()).toBe(now.toISOString());
 expect((await db.query('SELECT (SELECT count(*) FROM ls_identity.people) AS people,(SELECT count(*) FROM ls_cases.cases) AS cases,(SELECT count(*) FROM ls_service_interest.inquiry_email_outbox) AS mail')).rows).toEqual(before);
 expect((await store().read(owner,saved.item.id)).application.fields).toEqual(input.fields);
 expect((await store().listPage(owner)).items.map(item=>item.application.id)).toContain(saved.item.id);
});
it('replays identical operations, deduplicates exact new keys and rejects a changed payload under either key',async()=>{
 const input=keysFixture('replay-keys@example.invalid'),saved=await store().submit(input);
 expect(await store().submit(input)).toMatchObject({replayed:true,duplicate:true,item:{id:saved.item.id}});
 const alias={...input,operationId:randomUUID()};expect(await store().submit(alias)).toMatchObject({replayed:false,duplicate:true,item:{id:saved.item.id}});
 for(const command of [input,alias])await expect(store().submit({...command,fields:{...command.fields,notes:'Changed content'}})).rejects.toMatchObject({code:'CONFLICT'});
 expect((await db.query<{n:number}>('SELECT count(*)::int AS n FROM ls_service_interest.public_application_operations WHERE application_id=$1',[saved.item.id])).rows[0]!.n).toBe(2);
});
it('closes new collection after the New York trip date while preserving saved retries and duplicates',async()=>{
 let current=new Date('2026-12-07T04:59:59.999Z');
 const boundaryStore=new KeysInterestStore(adapter,workspace,ring,key,owner.id,{now:()=>current});
 const input=keysFixture('cutoff-keys@example.invalid'),saved=await boundaryStore.submit(input);
 current=new Date('2026-12-07T05:00:00.000Z');
 expect(await boundaryStore.submit(input)).toMatchObject({replayed:true,duplicate:true,item:{id:saved.item.id}});
 expect(await boundaryStore.submit({...input,operationId:randomUUID()})).toMatchObject({replayed:false,duplicate:true,item:{id:saved.item.id}});
 await expect(boundaryStore.submit({...input,fields:{...input.fields,notes:'Changed after cutoff'}})).rejects.toMatchObject({code:'CONFLICT'});
 const late=keysFixture('late-keys@example.invalid');
 await expect(boundaryStore.submit(late)).rejects.toMatchObject({code:'NOT_FOUND'});
 expect((await db.query('SELECT operation_id FROM ls_service_interest.public_application_operations WHERE operation_id=$1',[late.operationId])).rows).toEqual([]);
 expect((await boundaryStore.read(owner,saved.item.id)).application.fields).toEqual(input.fields);
});
it('limits Keys records to the exact live owner and keeps ordinary legacy readers compatible',async()=>{
 const saved=await store().submit(keysFixture('private-keys@example.invalid'));
 for(const denied of [parent,other,{...owner,workspaceId:asId(randomUUID(),'workspace')}]){
  await expect(store().listPage(denied)).rejects.toMatchObject({code:'NOT_FOUND'});await expect(store().read(denied,saved.item.id)).rejects.toMatchObject({code:'NOT_FOUND'});
 }
 const legacy=new PublicGroupApplicationStore(adapter,workspace,ring,key,clock);
 expect((await legacy.listPage(owner)).items.map(item=>item.id)).not.toContain(saved.item.id);
 await expect(legacy.readForOwner(other,saved.item.id)).rejects.toMatchObject({code:'FORBIDDEN'});
 const previous=await legacy.submit({operationId:randomUUID(),fields:{parentName:'Synthetic prior parent',contact:'prior@example.invalid',language:'en',cityArea:'Hollywood',programId:'sunday_fishing_academy',schedulePreference:['sunday'],permission:{confirmed:true,version:floridaGroupApplicationNotice.version,language:'en'}}});
 expect((await legacy.listPage(owner)).items).toContainEqual(previous.item);
 expect((await store().listPage(owner)).items.map(item=>item.application.id)).not.toContain(previous.item.id);
 await expect(store().read(owner,previous.item.id)).rejects.toMatchObject({code:'NOT_FOUND'});
});
it('records contact correction and contacted state append-only, survives reload and enforces versions and replay',async()=>{
 const input=keysFixture('correction-keys@example.invalid'),saved=await store().submit(input);
 const before=(await db.query<{payload_ciphertext:string}>('SELECT payload_ciphertext FROM ls_service_interest.public_applications WHERE id=$1',[saved.item.id])).rows[0]!.payload_ciphertext;
 const correction={version:'JLFA-KEYS-CONTACT-CORRECTION-v1' as const,...keysCurrentContact(input.fields),phone:'+13055550456',pickupPreferences:['boca_raton' as const],reason:'Parent supplied a different number and meeting preference.'};
 const command:KeysOwnerUpdate={operationId:randomUUID(),applicationId:saved.item.id,expectedVersion:0,status:'contacted',note:'Synthetic call completed.',nextAction:null,dueDate:null,waitingCondition:'Await parent response',contactCorrection:correction};
 expect(await store().update(owner,command)).toMatchObject({version:1,status:'contacted',replayed:false});
 expect(await store().update(owner,command)).toMatchObject({version:1,replayed:true});
 await expect(store().update(owner,{...command,note:'Different note'})).rejects.toMatchObject({code:'CONFLICT'});
 await expect(store().update(owner,{...command,operationId:randomUUID()})).rejects.toMatchObject({code:'CONFLICT'});
 const loaded=await store().read(owner,saved.item.id);expect(loaded.currentContact.phone).toBe('+13055550456');expect(loaded.currentContact.pickupPreferences).toEqual(['boca_raton']);expect(loaded.application.fields).toEqual(input.fields);expect(loaded.history).toHaveLength(1);
 expect((await db.query<{payload_ciphertext:string}>('SELECT payload_ciphertext FROM ls_service_interest.public_applications WHERE id=$1',[saved.item.id])).rows[0]!.payload_ciphertext).toBe(before);
 await expect(store().update(other,{...command,operationId:randomUUID(),expectedVersion:1})).rejects.toMatchObject({code:'NOT_FOUND'});
 const followups=new FishingInquiryFollowupStore(adapter,workspace,ring,key,owner.id,clock);
 await expect(followups.followup(owner,{operationId:randomUUID(),applicationId:saved.item.id,expectedVersion:1,status:'closed',note:'Synthetic close.',nextAction:null,dueDate:null,waitingCondition:null})).rejects.toMatchObject({code:'INVALID_REQUEST'});
 expect(await store().update(owner,{...command,operationId:randomUUID(),expectedVersion:1,status:'closed',waitingCondition:null})).toMatchObject({version:2});
 expect((await store().read(owner,saved.item.id)).currentContact.phone).toBe('+13055550456');
 expect((await db.query('SELECT count(*)::int AS n FROM ls_service_interest.inquiry_email_outbox')).rows).toEqual([{n:0}]);
});
it('rechecks a revoked owner session and does not trust a stale Actor object',async()=>{
 const saved=await store().submit(keysFixture('revocation-keys@example.invalid'));
 await db.query('UPDATE ls_identity.sessions SET revoked_at=$1 WHERE token_digest=$2',[now,owner.sessionDigest]);
 await expect(store().read(owner,saved.item.id)).rejects.toMatchObject({code:'UNAUTHENTICATED'});
 await db.query('UPDATE ls_identity.sessions SET revoked_at=NULL WHERE token_digest=$1',[owner.sessionDigest]);
});
it('summarizes interest and overlapping pickup preferences without claiming reserved seats',async()=>{
 const summary=await store().summary(owner);expect(summary.complete).toBe(true);expect(summary.families).toBeGreaterThan(0);expect(summary.boys).toBe(summary.families*2);expect(summary.pickupAreas.boca_raton).toEqual({families:1,boys:2});expect(summary.meaning).toContain('do not represent booked seats');
});
