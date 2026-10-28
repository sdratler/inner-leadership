import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {afterAll,beforeAll,expect,it,vi} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
vi.mock('server-only',()=>({}));
import {PublicGroupApplicationStore} from '../../src/features/group-application/store.ts';
import {floridaGroupApplicationNotice,groupApplicationNotice,type FloridaProgramId,type GroupApplicationRecord} from '../../src/features/group-application/contract.ts';
import {privateDigest} from '../../src/features/contact-ops/server/digests.ts';
import {seal} from '../../src/features/identity/crypto.ts';
import type {IdentityStore,SqlSession} from '../../src/features/identity/store.ts';
import type {Actor} from '../../src/features/identity/types.ts';
import {asId} from '../../src/lib/ids.ts';

const db=new PGlite(),workspaceId=asId(randomUUID(),'workspace'),now=new Date('2029-01-01T12:00:00Z');
const ring={activeKeyId:'test',keys:{test:Buffer.alloc(32,9)}},key='synthetic-academy-owner-scope-digest-key';
const identity:IdentityStore={transaction:work=>db.transaction(tx=>work({query:async<T extends object>(sql:string,values:readonly unknown[]=[]) =>(await tx.query<T>(sql,[...values])).rows} as SqlSession))};
const academy=new PublicGroupApplicationStore(identity,workspaceId,ring,key,{now:()=>now});
const actors:Actor[]=[];let genuine:GroupApplicationRecord,privateFishing:GroupApplicationRecord,legacyId:string,legacyCiphertext:string;
const programStore=(program:FloridaProgramId)=>new PublicGroupApplicationStore(identity,workspaceId,ring,key,{now:()=>now},false,undefined,program);
async function save(programId:FloridaProgramId,name:string){now.setTime(now.getTime()+1000);return (await academy.submit({operationId:randomUUID(),fields:{parentName:name,contact:randomUUID()+'@example.invalid',language:'en',cityArea:'Synthetic Florida',programId,schedulePreference:['flexible'],permission:{confirmed:true,version:floridaGroupApplicationNotice.version,language:'en'}}})).item;}
beforeAll(async()=>{
 await db.exec('CREATE SCHEMA ls_control');
 for(const file of ['0001_ls_foundation.sql','0010_ls_identity_cases_20260906.sql','0124_ls_group_interest.sql','0131_ls_public_group_applications.sql'])await db.exec(await readFile('migrations/'+file,'utf8'));
 await db.query('INSERT INTO ls_identity.workspaces(id,created_at) VALUES($1,$2)',[workspaceId,now]);
 for(const role of ['practitioner','parent'] as const){
  const id=randomUUID(),digest=id.replaceAll('-','').padEnd(64,'0');
  await db.query("INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,'adult','synthetic',$3)",[id,workspaceId,now]);
  await db.query("INSERT INTO ls_identity.accounts(id,workspace_id,role,state,locale,email_blind,email_ciphertext,email_verified_at,password_hash,created_at,updated_at) VALUES($1,$2,$3,'active','en',$4,'synthetic',$5,'synthetic',$5,$5)",[id,workspaceId,role,digest,now]);
  await db.query('INSERT INTO ls_identity.account_subjects(workspace_id,account_id,person_id) VALUES($1,$2,$2)',[workspaceId,id]);
  await db.query('INSERT INTO ls_identity.sessions(token_digest,workspace_id,account_id,created_at,expires_at) VALUES($1,$2,$3,$4,$5)',[digest,workspaceId,id,now,new Date(now.getTime()+86400000)]);
  actors.push({id,workspaceId,personId:id,role,state:'active',locale:'en',sessionDigest:digest,expiresAt:now.getTime()+86400000} as Actor);
 }
 genuine=await save('sunday_fishing_academy','Genuine Academy history');
 privateFishing=await save('private_fishing_life_skills','Separate Florida private fishing');
 // A historical encrypted row is seeded directly; no retired public form is used.
 legacyId=randomUUID();const fields={parentName:'Retired Israel contact',parentPhone:'+972520009999',language:'he',childAge:10,town:'Modiin',townChoice:'modiin',neighborhood:'Synthetic',schedulePreference:'evening',observations:{},permission:{confirmed:true,version:groupApplicationNotice.version,language:'he'}};
 legacyCiphertext=seal(JSON.stringify(fields),`ls_service_interest/public_application/v1/${workspaceId}/${legacyId}`,ring);
 await db.query('INSERT INTO ls_service_interest.public_applications(workspace_id,id,contact_digest,request_digest,payload_ciphertext,notice_version,notice_language,received_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[workspaceId,legacyId,privateDigest({legacyId},key),privateDigest({domain:'public-group-application/v1',workspace:workspaceId,fields},key),legacyCiphertext,groupApplicationNotice.version,'he',now]);
 for(let i=0;i<205;i++)await save('morning_torah_learning',`Separate school record ${i}`);
},30000);
afterAll(async()=>db.close());

it('keeps older Academy history reachable across a full page of other programs without returning their IDs',async()=>{
 const first=await academy.listPage(actors[0]!);expect(first.items).toEqual([]);expect(first.nextCursor).toMatch(/^[A-Za-z0-9_-]{64,2048}$/);
 const rows=(await db.query<{id:string}>('SELECT id FROM ls_service_interest.public_applications')).rows;
 const decoded=Buffer.from(first.nextCursor!,'base64url').toString('utf8');for(const row of rows)expect(decoded).not.toContain(row.id);
 const second=await academy.listPage(actors[0]!,{cursor:first.nextCursor!});expect(second).toEqual({items:[genuine],nextCursor:null});
 expect(await academy.list(actors[0]!)).toEqual([genuine]);
});
it('does not match retired names, phone numbers, IDs or another Florida program',async()=>{
 for(const search of ['Retired Israel contact','+972520009999',legacyId,'Separate school','Separate Florida private fishing']){
  let cursor:string|undefined;const found:GroupApplicationRecord[]=[];
  do{const page=await academy.listPage(actors[0]!,{search,cursor});found.push(...page.items);cursor=page.nextCursor??undefined;}while(cursor);
  expect(found).toEqual([]);
 }
});
it('binds pagination to the configured program, workspace and search and requires the owner',async()=>{
 const first=await academy.listPage(actors[0]!,{search:'Academy'}),cursor=first.nextCursor!;
 await expect(programStore('morning_torah_learning').listPage(actors[0]!,{search:'Academy',cursor})).rejects.toMatchObject({code:'INVALID_REQUEST'});
 await expect(academy.listPage(actors[0]!,{search:'another search',cursor})).rejects.toMatchObject({code:'INVALID_REQUEST'});
 await expect(academy.listPage(actors[0]!,{search:'Academy',cursor:cursor.slice(0,-4)+'AAAA'})).rejects.toMatchObject({code:'INVALID_REQUEST'});
 await expect(academy.listPage(actors[0]!,{cursor:legacyId})).rejects.toMatchObject({code:'INVALID_REQUEST'});
 await expect(academy.listPage({...actors[0]!,workspaceId:asId(randomUUID(),'workspace')},{cursor})).rejects.toMatchObject({code:'FORBIDDEN'});
 await expect(academy.listPage(actors[1]!,{cursor})).rejects.toMatchObject({code:'FORBIDDEN'});
});
it('denies direct retired/other-program reads while preserving explicitly scoped current Florida work',async()=>{
 await expect(identity.transaction(tx=>academy.readForOwnerInTransaction(tx,actors[0]!,legacyId))).rejects.toMatchObject({code:'NOT_FOUND'});
 await expect(identity.transaction(tx=>academy.readForOwnerInTransaction(tx,actors[0]!,privateFishing.id))).rejects.toMatchObject({code:'NOT_FOUND'});
 expect(await identity.transaction(tx=>academy.readForOwnerInTransaction(tx,actors[0]!,genuine.id))).toEqual(genuine);
 expect(await identity.transaction(tx=>programStore('private_fishing_life_skills').readForOwnerInTransaction(tx,actors[0]!,privateFishing.id))).toEqual(privateFishing);
 expect((await db.query<{payload_ciphertext:string}>('SELECT payload_ciphertext FROM ls_service_interest.public_applications WHERE id=$1',[legacyId])).rows[0]!.payload_ciphertext).toBe(legacyCiphertext);
});
