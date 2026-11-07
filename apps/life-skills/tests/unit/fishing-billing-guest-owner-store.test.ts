import {randomUUID,createHmac} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {beforeAll,afterAll,afterEach,it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {asId} from '../../src/lib/ids.ts';
import {AppError} from '../../src/lib/errors.ts';
import {seal,unseal,opaqueToken,tokenDigest} from '../../src/features/identity/crypto.ts';
import type {Actor} from '../../src/features/identity/types.ts';
import type {IdentityStore,SqlSession} from '../../src/features/identity/store.ts';
import type {BillingAuthority,BillingContext,BillingAction,BillingScope} from '../../src/features/fishing-billing/native.ts';
import {syntheticDefinition} from '../../src/features/fishing-billing/fixtures.ts';
import {BILLING_DTO_VERSION,familyOfferSchema,reminderIntentSchema} from '../../src/features/fishing-billing/contracts.ts';
import {ledgerReceiptV2Schema} from '../../src/features/fishing-billing/contracts-v2.ts';
import {CARD_VERSION,cardAttemptSchema} from '../../src/features/fishing-billing/card-contracts.ts';
import {BILLING_GUEST_V3,type GuestFamilyOffer} from '../../src/lib/fishing-billing-guest-contract-v3.ts';
import {bindGuestIssuedMaterial,bindGuestDisplayBundle} from '../../src/lib/fishing-billing-guest-material-v3.ts';
import {guestGrantLifecycleSchema,FishingBillingGuestGrantResolver,type BillingGuestGrantAuthority} from '../../src/lib/fishing-billing-guest-grant-resolver.ts';
import {FishingBillingGuestNativeV3} from '../../src/features/fishing-billing/guest-native-v3.ts';
import {changeGuestBillingState} from '../../src/features/fishing-billing/guest-domain-v3.ts';
import {FishingBillingGuestOwnerStore} from '../../src/lib/fishing-billing-guest-owner-store.ts';

// Actual memory-only SQL/IdentityStore/fresh session/AEAD/pure-domain/journal.
// Family authority is synthetic; no actual program/legal/native target, account
// provisioning, grant, acceptance, HTTP, browser, provider or schema installation.
const db=new PGlite(),ws=asId(randomUUID(),'workspace'),other=asId(randomUUID(),'workspace');
const ring={activeKeyId:'synthetic',keys:{synthetic:Buffer.alloc(32,7)}},key=Buffer.alloc(32,9),at=new Date('2035-01-02T15:00:00.000Z');
let owner:Actor,parent:Actor,foreign:Actor,fault:string|null=null;
let onAuthority:((c:BillingContext,a:BillingAction,s:BillingScope)=>Promise<void>)|null=null;
let afterSql:((sql:string,rows:readonly object[])=>Promise<void>)|null=null;
const binder:IdentityStore={transaction:work=>db.transaction(tx=>work({query:async<T extends object>(sql:string,v:readonly unknown[]=[])=>{if(fault&&sql.startsWith(fault))throw Error('SYNTHETIC_SQL_FAILURE');const rows=(await tx.query<T>(sql,[...v])).rows;await afterSql?.(sql,rows);return rows;}} as SqlSession))};
const authority:BillingAuthority={authorize:async(c,a,s)=>{
 if(s.programKey!=='fishing_monthly_club'||!s.familyId)throw new AppError('FORBIDDEN');
 const rows=await c.tx.query<{id:string}>("SELECT person_id AS id FROM ls_cases.family_members WHERE workspace_id=$1 AND family_id=$2 AND role='child'",[ws,s.familyId]);
 if(!s.childIds.length||s.childIds.some(id=>!rows.some(r=>r.id===id)))throw new AppError('FORBIDDEN');
 await onAuthority?.(c,a,s);
},reminderPermission:async()=>{throw Error('REMINDERS_NOT_ADMITTED');}};
const store=(now=at)=>new FishingBillingGuestOwnerStore(binder,ws,ring,key,{now:()=>new Date(now)},authority);
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
 await db.exec(await readFile('migrations/proposals/UNNUMBERED_ls_fishing_billing_guest_v3.sql','utf8'));
 for(const id of [ws,other])await db.query('INSERT INTO ls_identity.workspaces(id,created_at) VALUES($1,$2)',[id,at]);
 owner=await actor('practitioner');parent=await actor('parent');foreign=await actor('practitioner',other);
},20000);
afterEach(()=>{onAuthority=null;fault=null;afterSql=null;});afterAll(async()=>{await db.close();});
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
it('does not let a retained authority context replace the actual owner or trusted journal time',async()=>{
 const f=await scenario();let retained:BillingContext|null=null,changed=false;
 onAuthority=async c=>{retained=c;};
 afterSql=async sql=>{if(sql.startsWith('INSERT INTO ls_fishing_billing.quotes')&&retained){
  try{retained.actor={...retained.actor,id:parent.id};changed=true;}catch{}
  retained.now.setUTCFullYear(2099);
 }};
 await store().createOffer(owner,f.command);
 const journal=await db.query<{actor_id:string;created_at:Date}>('SELECT actor_id,created_at FROM ls_fishing_billing.commands WHERE operation_id=$1',[f.command.operationId]);
 expect(changed).toBe(false);expect(journal.rows[0]!.actor_id).toBe(owner.id);expect(journal.rows[0]!.created_at.valueOf()).toBe(at.valueOf());
});
it('cannot shrink the final authorized child scope after one membership is withdrawn',async()=>{
 const f=await scenario();let calls=0;
 onAuthority=async(c,_,s)=>{if(++calls===1){try{s.childIds.pop();}catch{}await c.tx.query("DELETE FROM ls_cases.family_members WHERE workspace_id=$1 AND family_id=$2 AND person_id=$3",[ws,f.family,f.children[1]]);}};
 await expect(store().createOffer(owner,f.command)).rejects.toMatchObject({code:'UNAVAILABLE'});expect((await row(f.command.id)).rows).toHaveLength(0);
});

// Connected owner -> actual Native accept -> owner read. Grant issuance and
// assurance/legal/source records below are explicitly SYNTHETIC seeded inputs,
// not a verified real owner issuance/parent/legal/provider or browser journey.
async function nativeAccepted(){
 const f=await scenario(),created=await store().createOffer(owner,f.command),issued=await store().issueOffer(owner,issue(f.command.id)),q=issued.quote;
 const offer=bindGuestIssuedMaterial({workspaceId:ws,familyId:q.familyId,quoteId:q.id,issuedRevision:q.revision,definition:q.definition,lines:q.lines,createdAt:q.createdAt,issuedAt:q.issuedAt,override:q.override});
 const bundle=bindGuestDisplayBundle({id:randomUUID(),version:'SYNTHETIC_ONLY',locale:'he',offerSnapshotSha256:offer.sha256,documents:[{purpose:'financial_terms',source:q.definition.terms,displayedTextSha256:'b'.repeat(64),releaseEvidenceId:randomUUID()}]});
 const token=opaqueToken(),lifecycle=guestGrantLifecycleSchema.parse({version:BILLING_GUEST_V3,grant:{version:BILLING_GUEST_V3,id:randomUUID(),action:'accept_financial_offer',offer,displayBundle:bundle,recipientBindingEvidenceId:randomUUID(),admissionPolicy:q.definition.source,tokenDigest:tokenDigest(token),issuedAt:at.toISOString(),expiresAt:'2035-01-03T15:00:00.000Z',issuedByAccountId:owner.id},state:'active',revokedAt:null,use:null}),g=lifecycle.grant;
 await db.query('INSERT INTO ls_fishing_billing.guest_grants VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[ws,g.id,q.id,g.action,g.tokenDigest,'active',g.issuedAt,g.expiresAt,seal(JSON.stringify(lifecycle),'ls_fishing_billing/guest_grant/v3/'+ws+'/'+g.id,ring)]);
 const currentEvidence={workspaceId:ws,familyId:q.familyId,quoteId:q.id,grantId:g.id,recipientBindingEvidenceId:g.recipientBindingEvidenceId,assuranceEvidenceId:randomUUID(),admissionPolicy:g.admissionPolicy};
 const presentation={action:'accept_financial_offer' as const,grantId:g.id,displayBundleId:bundle.id,displayBundleSha256:bundle.sha256,locale:bundle.locale,evidenceId:randomUUID(),affirmation:{version:'SYNTHETIC-v1',guardianAuthorityText:'SYNTHETIC GUARDIAN ONLY',financialTermsText:'SYNTHETIC FINANCIAL ONLY'}};
 const guestAuthority:BillingGuestGrantAuthority={target:async()=>{},current:async c=>{
  const children=await c.tx.query<{id:string}>("SELECT person_id AS id FROM ls_cases.family_members WHERE workspace_id=$1 AND family_id=$2 AND role='child'",[ws,q.familyId]);if(q.lines.some(l=>!children.some(c=>c.id===l.childId)))throw new AppError('FORBIDDEN');return currentEvidence;
 },display:async(_,__,challenge)=>{if(challenge!=='z'.repeat(43))throw new AppError('UNAVAILABLE');return presentation;}};
 const resolver=new FishingBillingGuestGrantResolver(ws,ring,key,{now:()=>new Date(at)},guestAuthority),native=new FishingBillingGuestNativeV3(binder,ws,ring,{now:()=>new Date(at)},resolver);
 const acceptance=await native.acceptFinancialOffer(token,{operationId:randomUUID(),expectedVersion:q.revision,displayBundleId:bundle.id,displayBundleSha256:bundle.sha256,displayChallenge:'z'.repeat(43),parent:{submittedName:'SYNTHETIC PARENT ONLY',guardianAuthorityAttested:true,financialTermsAffirmed:true}});
 return {...f,created,issued,acceptance,lifecycle};
}
async function seedMoney(q:GuestFamilyOffer){
 const common={quoteId:q.id,familyId:q.familyId,kind:'cash',currency:'USD',originalReceiptId:null,actorId:owner.id,recordedAt:at.toISOString(),reason:null,provider:null};
 const receipts=[ledgerReceiptV2Schema.parse({...common,id:randomUUID(),operationId:randomUUID(),amountMinor:20000,allocations:[{lineId:q.lines[0]!.id,amountMinor:20000}],receivedPrecision:'date',receivedDate:'2035-01-02',timeZone:'America/New_York'}),ledgerReceiptV2Schema.parse({...common,id:randomUUID(),operationId:randomUUID(),amountMinor:10000,allocations:[{lineId:q.lines[1]!.id,amountMinor:10000}],receivedAt:at.toISOString()})];
 for(const r of receipts)await db.query('INSERT INTO ls_fishing_billing.receipts VALUES($1,$2,$3,$4,$5,$6,$7)',[ws,r.id,q.id,r.operationId,null,seal(JSON.stringify(r),'ls_fishing_billing/v1/receipt/'+ws+'/'+r.id,ring),at]);return receipts;
}
it('current-owner reloads actual Native acceptance and siblings while original owner operation stays original',async()=>{
 const f=await nativeAccepted(),snapshot=await store().readSnapshot(owner,f.command.id),again=await store().readSnapshot(owner,f.command.id);
 expect(snapshot).toEqual(again);expect(snapshot.quote.acceptance?.id).toBe(f.acceptance.acceptanceId);expect(snapshot.quote.acceptance?.parent.submittedName).toBe('SYNTHETIC PARENT ONLY');
 expect(snapshot.balance).toMatchObject({version:BILLING_GUEST_V3,dueMinor:130000,paidMinor:0,remainingMinor:130000,state:'unpaid'});expect(snapshot.balance.lines.map(l=>l.childId)).toEqual(f.children);
 expect(await store().createOffer(owner,f.command)).toEqual({...f.created,replayed:true});expect(snapshot.quote.revision).toBe(3);
});
it('current-owner preserves literal Florida cash dates separately from exact instants and recording time',async()=>{
 const f=await nativeAccepted(),q=await store().readQuote(owner,f.command.id),receipts=await seedMoney(q),s=await store().readSnapshot(owner,q.id);
 expect(s.balance).toMatchObject({paidMinor:30000,remainingMinor:100000,state:'partial'});
 const date=s.balance.receipts.find(r=>r.id===receipts[0]!.id)!;expect(date).toMatchObject({receivedDate:'2035-01-02',timeZone:'America/New_York',recordedAt:at.toISOString()});expect(date).not.toHaveProperty('receivedAt');expect(s.balance.receipts.find(r=>r.id===receipts[1]!.id)).toHaveProperty('receivedAt',at.toISOString());
});
it('current-owner history remains readable after guest expiry/revocation and a later cancelled revision',async()=>{
 const f=await nativeAccepted(),q=await store().readQuote(owner,f.command.id);await seedMoney(q);
 const later=changeGuestBillingState(q,q.revision,{cancel:true,paused:true});await db.query('UPDATE ls_fishing_billing.quotes SET revision=$2,payload_ciphertext=$3 WHERE id=$1',[q.id,later.revision,seal(JSON.stringify(later),'ls_fishing_billing/guest/v3/quote/'+ws+'/'+q.id,ring)]);
 const gr=await db.query<{payload_ciphertext:string}>('SELECT payload_ciphertext FROM ls_fishing_billing.guest_grants WHERE id=$1',[f.lifecycle.grant.id]),original=guestGrantLifecycleSchema.parse(JSON.parse(unseal(gr.rows[0]!.payload_ciphertext,'ls_fishing_billing/guest_grant/v3/'+ws+'/'+f.lifecycle.grant.id,ring))),revoked=guestGrantLifecycleSchema.parse({...original,state:'revoked',revokedAt:at.toISOString()});
 await db.query("UPDATE ls_fishing_billing.guest_grants SET state='revoked',payload_ciphertext=$2 WHERE id=$1",[original.grant.id,seal(JSON.stringify(revoked),'ls_fishing_billing/guest_grant/v3/'+ws+'/'+original.grant.id,ring)]);
 const s=await store(new Date('2035-01-04T15:00:00Z')).readSnapshot(owner,q.id);expect(s.balance).toMatchObject({paidMinor:30000,remainingMinor:100000,cancelled:true,paused:true});expect(s.quote.acceptance).toEqual(q.acceptance);
});
it('current-owner denies a quote whose statement differs from the actual immutable financial evidence',async()=>{
 const f=await nativeAccepted(),q=await store().readQuote(owner,f.command.id);q.acceptance!.parent.statementSha256='f'.repeat(64);
 await db.query('UPDATE ls_fishing_billing.quotes SET payload_ciphertext=$2 WHERE id=$1',[q.id,seal(JSON.stringify(q),'ls_fishing_billing/guest/v3/quote/'+ws+'/'+q.id,ring)]);await expect(store().readSnapshot(owner,q.id)).rejects.toMatchObject({code:'UNAVAILABLE'});
});
it.each(['missing','overflow'] as const)('current-owner denies %s obligations with a bounded actual SQL read',async kind=>{
 const f=await nativeAccepted();let seen=0;
 if(kind==='missing')await db.query('DELETE FROM ls_fishing_billing.obligations WHERE quote_id=$1 AND line_id=$2',[f.command.id,f.command.children[0]!.lineId]);
 else for(let i=0;i<12;i++)await db.query('INSERT INTO ls_fishing_billing.obligations VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[ws,f.command.id,randomUUID(),f.family,randomUUID(),randomUUID(),'2035-01-01T05:00:00Z','2035-02-01T05:00:00Z']);
 afterSql=async(sql,rows)=>{if(sql.includes('FROM ls_fishing_billing.obligations'))seen=rows.length;};await expect(store().readSnapshot(owner,f.command.id)).rejects.toMatchObject({code:'UNAVAILABLE'});expect(seen).toBe(kind==='missing'?1:11);
});
it('current-owner authenticates money receipt metadata instead of trusting an indexed operation',async()=>{
 const f=await nativeAccepted(),q=await store().readQuote(owner,f.command.id),r=await seedMoney(q);await db.query('UPDATE ls_fishing_billing.receipts SET operation_id=$2 WHERE id=$1',[r[0]!.id,randomUUID()]);await expect(store().readSnapshot(owner,q.id)).rejects.toMatchObject({code:'UNAVAILABLE'});
});
it('current-owner rechecks actual access after the asynchronous evidence and money reads',async()=>{
 const f=await nativeAccepted();let reads=0;onAuthority=async(_,a)=>{if(a==='read'&&++reads===2)throw new AppError('FORBIDDEN');};await expect(store().readSnapshot(owner,f.command.id)).rejects.toMatchObject({code:'UNAVAILABLE'});expect(reads).toBe(2);
 expect((await db.query('SELECT id FROM ls_fishing_billing.guest_financial_acceptances WHERE quote_id=$1',[f.command.id])).rows).toHaveLength(1);
});
it('current-owner shows authenticated pending card facts without declaring payment, and rejects state tampering',async()=>{
 const f=await nativeAccepted(),q=await store().readQuote(owner,f.command.id),id=randomUUID(),command={operationId:randomUUID(),quoteId:q.id,expectedVersion:q.revision,selection:[{lineId:q.lines[0]!.id,amountMinor:1000}]};
 const a=cardAttemptSchema.parse({version:CARD_VERSION,id,workspaceId:ws,quoteId:q.id,familyId:q.familyId,actorId:owner.id,revision:1,balanceVersion:q.revision,binding:{accountId:'acct_SYNTHETIC',livemode:false,apiVersion:'2026-09-30.endive',verifiedBindingId:'SYNTHETIC_ONLY'},command,requestDigest:'d'.repeat(64),preparation:{version:CARD_VERSION,operationId:command.operationId,quoteId:q.id,entityVersion:q.revision,replayed:false,result:{attemptId:id,amountMinor:1000,allocations:command.selection}},createdAt:at.toISOString(),state:'unknown',dispatchId:randomUUID(),sessionId:null,checkoutUrl:null,paymentIntentId:null});
 await db.query('INSERT INTO ls_fishing_billing.card_attempts VALUES($1,$2,$3,$4,$5,$6)',[ws,id,q.id,a.revision,a.state,seal(JSON.stringify(a),'ls_fishing_billing/card/v1/attempt/'+ws+'/'+id,ring)]);
 expect((await store().readSnapshot(owner,q.id)).balance).toMatchObject({pendingAttemptIds:[id],paidMinor:0,state:'unpaid'});
 await db.query("UPDATE ls_fishing_billing.card_attempts SET state='failed' WHERE id=$1",[id]);await expect(store().readSnapshot(owner,q.id)).rejects.toMatchObject({code:'UNAVAILABLE'});
});
it('current-owner authenticates the complete reminder status set before exposing statuses',async()=>{
 const f=await nativeAccepted(),q=await store().readQuote(owner,f.command.id),id=randomUUID();
 const i=reminderIntentSchema.parse({version:BILLING_DTO_VERSION,id,key:'SYNTHETIC_STATUS_'+id,quoteId:q.id,familyId:q.familyId,guardianId:parent.id,channel:'email',audience:'individual',locale:'he',policyId:'SYNTHETIC_ONLY',policyRevision:1,sequence:0,dueAt:'2035-01-05T22:00:00Z',scheduledAt:'2035-01-05T22:00:00Z',state:'queued',dispatchId:null,providerId:null,reason:null});
 const hash=(v:unknown)=>createHmac('sha256',key).update(JSON.stringify(v)).digest('hex');
 await db.query('INSERT INTO ls_fishing_billing.reminders VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[ws,id,q.id,hash({key:i.key}),i.state,seal(JSON.stringify(i),'ls_fishing_billing/v1/reminder/'+ws+'/'+id,ring),'SYNTHETIC_POLICY_NOT_DISPATCHABLE',i.scheduledAt,hash({guardianId:i.guardianId,quoteId:i.quoteId})]);
 expect((await store().readSnapshot(owner,q.id)).balance.reminders).toEqual([{id,state:'queued'}]);
 await db.query("UPDATE ls_fishing_billing.reminders SET audience_key=$2 WHERE id=$1",[id,'a'.repeat(64)]);await expect(store().readSnapshot(owner,q.id)).rejects.toMatchObject({code:'UNAVAILABLE'});
});
