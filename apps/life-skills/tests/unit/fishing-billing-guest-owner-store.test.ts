import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {beforeAll,afterAll,afterEach,it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {asId} from '../../src/lib/ids.ts';
import {AppError} from '../../src/lib/errors.ts';
import {seal,unseal} from '../../src/features/identity/crypto.ts';
import type {Actor} from '../../src/features/identity/types.ts';
import type {IdentityStore,SqlSession} from '../../src/features/identity/store.ts';
import type {BillingAuthority,BillingContext,BillingAction,BillingScope} from '../../src/features/fishing-billing/native.ts';
import {syntheticDefinition} from '../../src/features/fishing-billing/fixtures.ts';
import {BILLING_DTO_VERSION,familyOfferSchema} from '../../src/features/fishing-billing/contracts.ts';
import {BILLING_GUEST_V3} from '../../src/lib/fishing-billing-guest-contract-v3.ts';
import {changeGuestBillingState} from '../../src/features/fishing-billing/guest-domain-v3.ts';
import {FishingBillingGuestOwnerStore} from '../../src/lib/fishing-billing-guest-owner-store.ts';

// Actual memory-only SQL/IdentityStore/fresh session/AEAD/pure-domain/journal.
// Family authority is synthetic; no actual program/legal/native target, account
// provisioning, grant, acceptance, HTTP, browser, provider or schema installation.
const db=new PGlite(),ws=asId(randomUUID(),'workspace'),other=asId(randomUUID(),'workspace');
const ring={activeKeyId:'synthetic',keys:{synthetic:Buffer.alloc(32,7)}},key=Buffer.alloc(32,9),at=new Date('2035-01-02T15:00:00.000Z');
let owner:Actor,parent:Actor,foreign:Actor,fault:string|null=null;
let onAuthority:((c:BillingContext,a:BillingAction,s:BillingScope)=>Promise<void>)|null=null;
const binder:IdentityStore={transaction:work=>db.transaction(tx=>work({query:async<T extends object>(sql:string,v:readonly unknown[]=[])=>{if(fault&&sql.startsWith(fault))throw Error('SYNTHETIC_SQL_FAILURE');return (await tx.query<T>(sql,[...v])).rows;}} as SqlSession))};
const authority:BillingAuthority={authorize:async(c,a,s)=>{
 if(s.programKey!=='fishing_monthly_club'||!s.familyId)throw new AppError('FORBIDDEN');
 const rows=await c.tx.query<{id:string}>("SELECT person_id AS id FROM ls_cases.family_members WHERE workspace_id=$1 AND family_id=$2 AND role='child'",[ws,s.familyId]);
 if(!s.childIds.length||s.childIds.some(id=>!rows.some(r=>r.id===id)))throw new AppError('FORBIDDEN');
 await onAuthority?.(c,a,s);
},reminderPermission:async()=>{throw Error('REMINDERS_NOT_ADMITTED');}};
const store=()=>new FishingBillingGuestOwnerStore(binder,ws,ring,key,{now:()=>new Date(at)},authority);
async function actor(role:'practitioner'|'parent',workspace=ws){
 const id=randomUUID(),digest=id.replaceAll('-','').padEnd(64,'0');
 await db.query("INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,'adult','SYNTHETIC',$3)",[id,workspace,at]);
 await db.query("INSERT INTO ls_identity.accounts(id,workspace_id,role,state,locale,email_blind,email_ciphertext,email_verified_at,password_hash,created_at,updated_at) VALUES($1,$2,$3,'active','he',$4,'SYNTHETIC',$5,'SYNTHETIC',$5,$5)",[id,workspace,role,digest,at]);
 await db.query('INSERT INTO ls_identity.account_subjects(workspace_id,account_id,person_id) VALUES($1,$2,$2)',[workspace,id]);
 await db.query('INSERT INTO ls_identity.sessions(token_digest,workspace_id,account_id,created_at,expires_at) VALUES($1,$2,$3,$4,$5)',[digest,workspace,id,at,new Date('2036-01-01T00:00:00Z')]);
 return {id:asId(id,'account'),workspaceId:workspace,personId:asId(id,'person'),role,state:'active',locale:'he',sessionDigest:digest,expiresAt:Date.parse('2036-01-01T00:00:00Z')} as Actor;
}
async function ownerSession(){
 const digest=randomUUID().replaceAll('-','').padEnd(64,'0');
 await db.query('INSERT INTO ls_identity.sessions(token_digest,workspace_id,account_id,created_at,expires_at) VALUES($1,$2,$3,$4,$5)',[digest,ws,owner.id,at,new Date('2036-01-01T00:00:00Z')]);return {...owner,sessionDigest:digest};
}
beforeAll(async()=>{
 await db.exec('CREATE SCHEMA ls_control');
 for(const f of ['0001_ls_foundation.sql','0010_ls_identity_cases_20260906.sql'])await db.exec(await readFile('migrations/'+f,'utf8'));
 await db.exec(await readFile('tests/fixtures/fishing-billing.sql','utf8'));
 for(const id of [ws,other])await db.query('INSERT INTO ls_identity.workspaces(id,created_at) VALUES($1,$2)',[id,at]);
 owner=await actor('practitioner');parent=await actor('parent');foreign=await actor('practitioner',other);
},20000);
afterEach(()=>{onAuthority=null;fault=null;});afterAll(async()=>{await db.close();});
async function scenario(){
 const family=randomUUID(),children=[randomUUID(),randomUUID()],d={...syntheticDefinition(),id:randomUUID(),publishedBy:owner.id};
 await db.query('INSERT INTO ls_cases.families(id,workspace_id,label_ciphertext,created_at) VALUES($1,$2,$3,$4)',[family,ws,'SYNTHETIC',at]);
 for(const id of children){await db.query("INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,'minor','SYNTHETIC',$3)",[id,ws,at]);await db.query("INSERT INTO ls_cases.family_members VALUES($1,$2,$3,'child')",[ws,family,id]);}
 await db.query('INSERT INTO ls_fishing_billing.definitions VALUES($1,$2,$3,$4)',[ws,d.id,seal(JSON.stringify(d),'ls_fishing_billing/v1/definition/'+ws+'/'+d.id,ring),new Date(d.publishedAt)]);
 const command={operationId:randomUUID(),id:randomUUID(),familyId:family,definitionId:d.id,override:null,children:children.map(childId=>({lineId:randomUUID(),childId,groupId:null,period:{id:randomUUID(),startsAt:'2035-01-01T05:00:00Z',endsAt:'2035-02-01T05:00:00Z',timeZone:'America/New_York' as const},dueAt:'2035-01-05T22:00:00Z'}))};
 return {family,children,definition:d,command};
}
const row=(id:string)=>db.query<{revision:number;ciphertext:string}>('SELECT revision,payload_ciphertext AS ciphertext FROM ls_fishing_billing.quotes WHERE workspace_id=$1 AND id=$2',[ws,id]);
const issue=(id:string)=>({operationId:randomUUID(),quoteId:id,expectedVersion:1});

it('saves and issues NEW V3 siblings without creating debt, then reloads through another store',async()=>{
 const f=await scenario(),created=await store().createOffer(owner,f.command),issued=await store().issueOffer(owner,issue(f.command.id)),read=await store().readQuote(owner,f.command.id);
 expect(created.quote).toMatchObject({version:BILLING_GUEST_V3,state:'draft',acceptance:null,revision:1});expect(issued.quote).toEqual(read);expect(read.lines.map(l=>l.childId)).toEqual(f.children);expect(read.state).toBe('issued');
 expect((await db.query('SELECT * FROM ls_fishing_billing.obligations WHERE quote_id=$1',[read.id])).rows).toHaveLength(0);
 const raw=(await row(read.id)).rows[0]!.ciphertext;expect(raw).not.toContain(f.family);expect(raw).not.toContain('SYNTHETIC-UNAPPROVED');
 expect((await db.query('SELECT DISTINCT actor_id FROM ls_fishing_billing.commands WHERE quote_id=$1',[read.id])).rows).toEqual([{actor_id:owner.id}]);
});
it('recovers exact create/issue results after lost responses, preserving original ciphertext and later state',async()=>{
 const f=await scenario(),first=await store().createOffer(owner,f.command),cmd=issue(f.command.id),issued=await store().issueOffer(owner,cmd),before=(await row(f.command.id)).rows[0]!.ciphertext;
 expect(await store().createOffer(owner,f.command)).toEqual({...first,replayed:true});expect(await store().issueOffer(owner,cmd)).toEqual({...issued,replayed:true});expect((await row(f.command.id)).rows[0]!.ciphertext).toBe(before);
 const later=changeGuestBillingState(issued.quote,2,{paused:true});await db.query('UPDATE ls_fishing_billing.quotes SET revision=3,payload_ciphertext=$2 WHERE id=$1',[later.id,seal(JSON.stringify(later),'ls_fishing_billing/guest/v3/quote/'+ws+'/'+later.id,ring)]);
 expect(await store().issueOffer(owner,cmd)).toEqual({...issued,replayed:true});expect((await store().readQuote(owner,later.id)).paused).toBe(true);
});
it('denies changed bodies, changed action or stale quote revisions without a second save',async()=>{
 const f=await scenario();await store().createOffer(owner,f.command);
 await expect(store().createOffer(owner,{...f.command,children:f.command.children.slice(0,1)})).rejects.toMatchObject({code:'UNAVAILABLE'});
 await expect(store().issueOffer(owner,{...issue(f.command.id),operationId:f.command.operationId})).rejects.toMatchObject({code:'UNAVAILABLE'});
 await store().issueOffer(owner,issue(f.command.id));await expect(store().issueOffer(owner,issue(f.command.id))).rejects.toMatchObject({code:'UNAVAILABLE'});
 expect((await row(f.command.id)).rows[0]!.revision).toBe(2);
});
it('denies parent, wrong workspace and revoked session while preserving answers/history',async()=>{
 const f=await scenario();await expect(store().createOffer(parent,f.command)).rejects.toMatchObject({code:'UNAVAILABLE'});await expect(store().createOffer(foreign,f.command)).rejects.toMatchObject({code:'UNAVAILABLE'});
 const local=await ownerSession();await db.query('UPDATE ls_identity.sessions SET revoked_at=$2 WHERE token_digest=$1',[local.sessionDigest,at]);await expect(store().createOffer(local,f.command)).rejects.toMatchObject({code:'UNAVAILABLE'});expect((await row(f.command.id)).rows).toHaveLength(0);
});
it('requires actual child membership and final current program/source authority',async()=>{
 const f=await scenario();await expect(store().createOffer(owner,{...f.command,children:[{...f.command.children[0]!,childId:randomUUID()}]})).rejects.toMatchObject({code:'UNAVAILABLE'});
 let calls=0;onAuthority=async()=>{if(++calls===2)throw new AppError('FORBIDDEN');};await expect(store().createOffer(owner,f.command)).rejects.toMatchObject({code:'UNAVAILABLE'});expect(calls).toBe(2);expect((await row(f.command.id)).rows).toHaveLength(0);
});
it('rechecks actual session after async authority and pins the same transaction before any write',async()=>{
 const f=await scenario(),local=await ownerSession();onAuthority=async c=>{await c.tx.query('UPDATE ls_identity.sessions SET revoked_at=$2 WHERE token_digest=$1',[local.sessionDigest,at]);};await expect(store().createOffer(local,f.command)).rejects.toMatchObject({code:'UNAVAILABLE'});expect((await row(f.command.id)).rows).toHaveLength(0);
 onAuthority=async c=>{c.tx={query:c.tx.query};};await expect(store().createOffer(owner,f.command)).rejects.toMatchObject({code:'UNAVAILABLE'});expect((await row(f.command.id)).rows).toHaveLength(0);
});
it.each(['family_id','revision','definition_id','created_at'] as const)('denies indexed quote %s tamper against its sealed payload',async column=>{
 const f=await scenario();await store().createOffer(owner,f.command);
 if(column==='family_id')await db.query('UPDATE ls_fishing_billing.quotes SET family_id=$2 WHERE id=$1',[f.command.id,randomUUID()]);
 else if(column==='revision')await db.query('UPDATE ls_fishing_billing.quotes SET revision=9 WHERE id=$1',[f.command.id]);
 else if(column==='created_at')await db.query("UPDATE ls_fishing_billing.quotes SET created_at='2035-02-01T00:00:00Z' WHERE id=$1",[f.command.id]);
 else{const other=await scenario();await db.query('UPDATE ls_fishing_billing.quotes SET definition_id=$2 WHERE id=$1',[f.command.id,other.definition.id]);}
 await expect(store().readQuote(owner,f.command.id)).rejects.toMatchObject({code:'UNAVAILABLE'});
});
it('authenticates definition metadata and journal metadata rather than trusting indexed hints',async()=>{
 const f=await scenario();await db.query("UPDATE ls_fishing_billing.definitions SET published_at='2034-12-02T00:00:00Z' WHERE id=$1",[f.definition.id]);await expect(store().createOffer(owner,f.command)).rejects.toMatchObject({code:'UNAVAILABLE'});
 const g=await scenario();await store().createOffer(owner,g.command);await db.query("UPDATE ls_fishing_billing.commands SET action='guest_issue' WHERE operation_id=$1",[g.command.operationId]);await expect(store().createOffer(owner,g.command)).rejects.toMatchObject({code:'UNAVAILABLE'});
});
it('rolls back a created quote or an issued revision when the same transaction journal fails',async()=>{
 const f=await scenario();fault='INSERT INTO ls_fishing_billing.commands';await expect(store().createOffer(owner,f.command)).rejects.toMatchObject({code:'UNAVAILABLE'});expect((await row(f.command.id)).rows).toHaveLength(0);
 fault=null;await store().createOffer(owner,f.command);const before=(await row(f.command.id)).rows[0]!;fault='INSERT INTO ls_fishing_billing.commands';await expect(store().issueOffer(owner,issue(f.command.id))).rejects.toMatchObject({code:'UNAVAILABLE'});expect((await row(f.command.id)).rows[0]!).toEqual(before);
});
it('does not convert an existing account quote or grant readback after family access is withdrawn',async()=>{
 const f=await scenario(),created=await store().createOffer(owner,f.command),raw=(await row(f.command.id)).rows[0]!.ciphertext;
 const decoded=JSON.parse(unseal(raw,'ls_fishing_billing/guest/v3/quote/'+ws+'/'+f.command.id,ring)),payload=familyOfferSchema.parse({...decoded,version:BILLING_DTO_VERSION});const legacy=seal(JSON.stringify(payload),'ls_fishing_billing/v1/quote/'+ws+'/'+payload.id,ring);await db.query('UPDATE ls_fishing_billing.quotes SET payload_ciphertext=$2 WHERE id=$1',[payload.id,legacy]);
 await expect(store().readQuote(owner,payload.id)).rejects.toMatchObject({code:'UNAVAILABLE'});expect((await row(payload.id)).rows[0]!.ciphertext).toBe(legacy);
 const g=await scenario();await store().createOffer(owner,g.command);onAuthority=async()=>{throw new AppError('FORBIDDEN');};await expect(store().createOffer(owner,g.command)).rejects.toMatchObject({code:'UNAVAILABLE'});expect(created.quote.acceptance).toBeNull();
});
