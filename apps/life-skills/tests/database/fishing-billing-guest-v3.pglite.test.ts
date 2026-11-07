import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {beforeAll,beforeEach,afterAll,it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {asId} from '../../src/lib/ids.ts';
import {AppError} from '../../src/lib/errors.ts';
import {seal,unseal,tokenDigest} from '../../src/features/identity/crypto.ts';
import type {IdentityStore,SqlSession} from '../../src/features/identity/store.ts';
import type {BillingLedgerContext} from '../../src/features/fishing-billing/native.ts';
import {syntheticDefinition,syntheticDraft,syntheticAccepted,syntheticId,syntheticOwner,syntheticWorkspace} from '../../src/features/fishing-billing/fixtures.ts';
import {createGuestFamilyOffer,issueGuestFamilyOffer,changeGuestBillingState,projectGuestBalanceV3} from '../../src/features/fishing-billing/guest-domain-v3.ts';
import {FishingBillingGuestNativeV3,guestFinancialEvidenceEnvelopeSchema} from '../../src/features/fishing-billing/guest-native-v3.ts';
import {BILLING_GUEST_V3} from '../../src/lib/fishing-billing-guest-contract-v3.ts';
import {bindGuestIssuedMaterial,bindGuestDisplayBundle,verifyGuestFamilyOffer} from '../../src/lib/fishing-billing-guest-material-v3.ts';
import {FishingBillingGuestGrantResolver,guestGrantLifecycleSchema,guestFinancialStatementSha256,type BillingGuestGrantAuthority} from '../../src/lib/fishing-billing-guest-grant-resolver.ts';

// Actual memory PostgreSQL/transaction/AEAD/HMAC/resolver/native consumer.
// Authority records/hooks are SYNTHETIC ONLY, not real source/parent/legal
// admission. PGlite serializes requests: no multi-connection/live proof.
const db=new PGlite(),ws=asId(syntheticWorkspace,'workspace'),other=asId(syntheticId(1800),'workspace');
const ring={activeKeyId:'synthetic',keys:{synthetic:Buffer.alloc(32,7)}},digestKey=Buffer.alloc(32,9);
const token='x'.repeat(43),challenge='z'.repeat(43),initial='2035-01-02T15:01:00.000Z';
const quoteAad=(id:string)=>'ls_fishing_billing/guest/v3/quote/'+ws+'/'+id;
const grantAad=(id:string)=>'ls_fishing_billing/guest_grant/v3/'+ws+'/'+id;
let currentTime=Date.parse(initial),denyTarget=false,denyCurrent=false,displayCalls=0,clockCalls=0,expireOnRead=Infinity;
let finalMutation:''|'assurance'|'display'|'expire'|'expireAfterCheck'|'revoke'='';
let failStage='',zeroStage='',alterGrantIndex=false,alterQuoteIndex=false,dropResult=false;
let failSecondObligation=false,obligationWrites=0,alterGrantCipher=false;
let corruptReplay:''|'journal'|'evidence'|'statement'='';
let retainedContext:BillingLedgerContext|null=null,replacementQueries=0;
let swapAtRead:''|'quote'|'operation'|'evidence'|'obligations'='';
let expireAtRead:''|'evidence'|'obligations'='',revokeAtRead:''|'evidence'|'obligations'='';
const trace:{sql:string;values:readonly unknown[]}[]=[];
const clock={now:()=>{clockCalls++;return new Date(clockCalls>=expireOnRead?'2035-01-03T15:00:00.000Z':currentTime);}};
const query=async<T extends object=Record<string,unknown>>(sql:string,values:unknown[]=[])=> (await db.query<T>(sql,values)).rows;
let seeded:Awaited<ReturnType<typeof seed>>;

const stage=(sql:string)=>sql.startsWith('INSERT INTO ls_fishing_billing.guest_operations')?'journal':sql.startsWith('INSERT INTO ls_fishing_billing.guest_financial_acceptances')?'evidence':sql.startsWith('INSERT INTO ls_fishing_billing.obligations')?'obligation':sql.startsWith('UPDATE ls_fishing_billing.quotes SET revision')?'quote':sql.startsWith('UPDATE ls_fishing_billing.guest_grants SET state')?'grant':'';
const binder:IdentityStore={transaction:async work=>{
 const result=await db.transaction(raw=>work({query:async<T extends object>(sql:string,values:readonly unknown[]=[])=>{
  trace.push({sql,values:[...values]});const s=stage(sql);
  if(s&&s===failStage)throw Error('SYNTHETIC_'+s);
  if(s==='obligation'&&++obligationWrites===2&&failSecondObligation)throw Error('SYNTHETIC_SECOND_CHILD_FAILURE');
  if(s&&s===zeroStage)return [];
  if(s==='grant'&&alterGrantIndex)await raw.query('UPDATE ls_fishing_billing.guest_grants SET token_digest=$1 WHERE workspace_id=$2 AND id=$3',['f'.repeat(64),ws,seeded.grant.id]);
  if(s==='grant'&&alterGrantCipher)await raw.query('UPDATE ls_fishing_billing.guest_grants SET payload_ciphertext=$1 WHERE workspace_id=$2 AND id=$3',[seal(JSON.stringify(seeded.lifecycle),grantAad(seeded.grant.id),ring),ws,seeded.grant.id]);
  if(s==='quote'&&alterQuoteIndex)await raw.query('UPDATE ls_fishing_billing.quotes SET family_id=$1 WHERE workspace_id=$2 AND id=$3',[syntheticId(1999),ws,seeded.quote.id]);
  const rows=(await raw.query<T>(sql,[...values])).rows;
  const read=sql.startsWith('SELECT id,family_id AS')?'quote':sql.startsWith('SELECT operation_id AS')?'operation':sql.startsWith('SELECT id,quote_id AS "quoteId",grant_id AS')?'evidence':sql.startsWith('SELECT line_id AS')?'obligations':'';
  if(read&&read===swapAtRead){
   swapAtRead='';if(!retainedContext)throw Error('SYNTHETIC_NO_RETAINED_CONTEXT');
   retainedContext.tx={query:async<U extends object>(statement:string,parameters:readonly unknown[]=[])=>{replacementQueries++;return (await raw.query<U>(statement,[...parameters])).rows;}};
  }
  if(read&&read===expireAtRead){expireAtRead='';currentTime=Date.parse(seeded.grant.expiresAt);}
  if(read&&read===revokeAtRead){revokeAtRead='';denyCurrent=true;}
  // Deliberately corrupt a SQL read result after real persisted acceptance;
  // no production trigger is weakened and the underlying rows stay intact.
  if(corruptReplay==='journal'&&sql.startsWith('SELECT operation_id AS'))return rows.map(row=>({...row,ciphertext:'SYNTHETIC CORRUPT JOURNAL'}));
  if((corruptReplay==='evidence'||corruptReplay==='statement')&&sql.startsWith('SELECT id,quote_id AS "quoteId",grant_id AS'))return rows.map(row=>{
   if(corruptReplay==='evidence')return {...row,ciphertext:'SYNTHETIC CORRUPT EVIDENCE'};
   const ciphertext=Reflect.get(row,'ciphertext'),id=values[1];if(typeof ciphertext!=='string'||typeof id!=='string')throw Error('SYNTHETIC_BAD_READ_FIXTURE');
   const key='ls_fishing_billing/guest/v3/financial_acceptance/'+ws+'/'+id;
   const envelope=guestFinancialEvidenceEnvelopeSchema.parse(JSON.parse(unseal(ciphertext,key,ring)));
   if(envelope.presentation.action!=='accept_financial_offer')throw Error('SYNTHETIC_WRONG_PURPOSE');
   envelope.presentation.affirmation.financialTermsText='SYNTHETIC TAMPERED ORIGINAL TEXT';
   return {...row,ciphertext:seal(JSON.stringify(envelope),key,ring)};
  });
  return rows;
 }} as SqlSession));
 if(dropResult){dropResult=false;throw Error('SYNTHETIC_COMMITTED_RESULT_LOST');}return result;
}};

const authority:BillingGuestGrantAuthority={
 target:async c=>{retainedContext=c;if(denyTarget||c.workspaceId!==ws)throw new AppError('UNAVAILABLE');const rows=await c.tx.query('SELECT id FROM ls_identity.workspaces WHERE id=$1',[ws]);if(rows.length!==1)throw new AppError('UNAVAILABLE');},
 current:async(c,g,mode)=>{
  if(denyCurrent)throw new AppError('FORBIDDEN');
  const records=await c.tx.query<{recipient:string;assurance:string}>('SELECT recipient_id AS recipient,assurance_id AS assurance FROM synthetic_guest.admissions WHERE workspace_id=$1 AND family_id=$2 AND active=true',[ws,g.offer.material.familyId]);
  const children=await c.tx.query<{id:string}>("SELECT person_id AS id FROM ls_cases.family_members WHERE workspace_id=$1 AND family_id=$2 AND role='child'",[ws,g.offer.material.familyId]);
  const owner=await c.tx.query("SELECT id FROM ls_identity.accounts WHERE workspace_id=$1 AND id=$2 AND role='practitioner' AND state='active'",[ws,g.issuedByAccountId]);
  if(records.length!==1||owner.length!==1||!g.offer.material.lines.every(l=>children.some(p=>p.id===l.childId)))throw new AppError('FORBIDDEN');
  const q=await c.tx.query<{ciphertext:string}>('SELECT payload_ciphertext AS ciphertext FROM ls_fishing_billing.quotes WHERE workspace_id=$1 AND id=$2',[ws,g.offer.material.quoteId]);
  if(q.length!==1)throw new AppError('FORBIDDEN');const value=JSON.parse(unseal(q[0]!.ciphertext,quoteAad(g.offer.material.quoteId),ring));
  if(mode==='fresh'?value.state!=='issued':!value.acceptance||value.acceptance.grantId!==g.id)throw new AppError('FORBIDDEN');
  return {workspaceId:ws,familyId:g.offer.material.familyId,quoteId:g.offer.material.quoteId,grantId:g.id,recipientBindingEvidenceId:records[0]!.recipient,assuranceEvidenceId:records[0]!.assurance,admissionPolicy:g.admissionPolicy};
 },
 display:async(c,g,key)=>{
  if(key!==challenge)throw new AppError('FORBIDDEN');displayCalls++;
  if(displayCalls===3){
   if(finalMutation==='expire')currentTime=Date.parse(g.expiresAt);
   if(finalMutation==='expireAfterCheck')expireOnRead=clockCalls+2;
   if(finalMutation==='assurance')await c.tx.query('UPDATE synthetic_guest.admissions SET assurance_id=$1',[syntheticId(1998)]);
   if(finalMutation==='display')await c.tx.query('UPDATE synthetic_guest.presentations SET body=$1',[JSON.stringify({...seeded.presentation,affirmation:{...seeded.presentation.affirmation,financialTermsText:'SYNTHETIC CHANGED'}})]);
   if(finalMutation==='revoke')await c.tx.query("UPDATE ls_fishing_billing.guest_grants SET state='revoked' WHERE workspace_id=$1 AND id=$2",[ws,g.id]);
  }
  const rows=await c.tx.query<{body:string}>('SELECT body FROM synthetic_guest.presentations WHERE grant_id=$1',[g.id]);if(rows.length!==1)throw new AppError('FORBIDDEN');return JSON.parse(rows[0]!.body);
 },
};
const service=(store:IdentityStore=binder,workspace=ws)=>new FishingBillingGuestNativeV3(store,workspace,ring,clock,new FishingBillingGuestGrantResolver(workspace,ring,digestKey,clock,authority));

async function seed(){
 const old=syntheticDraft(),command={operationId:syntheticId(1810),id:old.id,familyId:old.familyId,definitionId:old.definition.id,override:null,children:old.lines.map(l=>({lineId:l.id,childId:l.childId,period:l.period,groupId:l.groupId,dueAt:l.dueAt}))};
 command.children[1]!.period={id:syntheticId(1811),startsAt:'2035-02-01T05:00:00Z',endsAt:'2035-03-01T05:00:00Z',timeZone:'America/New_York'};
 const draft=createGuestFamilyOffer(syntheticDefinition(),command,{workspaceId:ws,actorId:syntheticOwner,now:'2035-01-02T15:00:00.000Z'}),quote=issueGuestFamilyOffer(draft,1,'2035-01-02T15:00:00.000Z');
 const offer=bindGuestIssuedMaterial({workspaceId:ws,familyId:quote.familyId,quoteId:quote.id,issuedRevision:quote.revision,definition:quote.definition,lines:quote.lines,createdAt:quote.createdAt,issuedAt:quote.issuedAt,override:quote.override});
 const displayBundle=bindGuestDisplayBundle({id:syntheticId(1812),version:'SYNTHETIC TERMS ONLY',locale:'he',offerSnapshotSha256:offer.sha256,documents:[{purpose:'financial_terms',source:quote.definition.terms,displayedTextSha256:'b'.repeat(64),releaseEvidenceId:syntheticId(1813)}]});
 const lifecycle=guestGrantLifecycleSchema.parse({version:BILLING_GUEST_V3,state:'active',revokedAt:null,use:null,grant:{version:BILLING_GUEST_V3,id:syntheticId(1814),action:'accept_financial_offer',offer,displayBundle,recipientBindingEvidenceId:syntheticId(1815),admissionPolicy:quote.definition.source,tokenDigest:tokenDigest(token),issuedAt:'2035-01-02T15:00:10.000Z',expiresAt:'2035-01-03T15:00:00.000Z',issuedByAccountId:syntheticOwner}});
 const grant=lifecycle.grant,presentation={action:'accept_financial_offer' as const,grantId:grant.id,displayBundleId:displayBundle.id,displayBundleSha256:displayBundle.sha256,locale:displayBundle.locale,evidenceId:syntheticId(1816),affirmation:{version:'SYNTHETIC STATEMENT v1',guardianAuthorityText:'SYNTHETIC AUTHORITY TEXT',financialTermsText:'SYNTHETIC FINANCIAL TEXT'}};
 await query('INSERT INTO ls_fishing_billing.definitions VALUES($1,$2,$3,$4)',[ws,quote.definition.id,'SYNTHETIC DEFINITION ONLY',quote.definition.publishedAt]);
 await query('INSERT INTO ls_fishing_billing.quotes VALUES($1,$2,$3,$4,$5,$6,$7)',[ws,quote.id,quote.familyId,quote.definition.id,quote.revision,seal(JSON.stringify(quote),quoteAad(quote.id),ring),quote.createdAt]);
 await query('INSERT INTO ls_fishing_billing.guest_grants VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[ws,grant.id,quote.id,grant.action,grant.tokenDigest,'active',grant.issuedAt,grant.expiresAt,seal(JSON.stringify(lifecycle),grantAad(grant.id),ring)]);
 await query('INSERT INTO synthetic_guest.admissions VALUES($1,$2,$3,$4,true)',[ws,quote.familyId,grant.recipientBindingEvidenceId,syntheticId(1817)]);
 await query('INSERT INTO synthetic_guest.presentations VALUES($1,$2)',[grant.id,JSON.stringify(presentation)]);
 return {quote,grant,lifecycle,presentation,command:{operationId:syntheticId(1818),expectedVersion:2,displayBundleId:displayBundle.id,displayBundleSha256:displayBundle.sha256,displayChallenge:challenge,parent:{submittedName:'SYNTHETIC SIGNER ONLY',guardianAuthorityAttested:true,financialTermsAffirmed:true}}};
}
async function counts(){
 const row=(await query<{operations:number;evidence:number;obligations:number}>(`SELECT
 (SELECT count(*)::int FROM ls_fishing_billing.guest_operations) AS operations,
 (SELECT count(*)::int FROM ls_fishing_billing.guest_financial_acceptances) AS evidence,
 (SELECT count(*)::int FROM ls_fishing_billing.obligations) AS obligations`))[0]!;return row;
}
async function storedQuote(){const row=(await query<{ciphertext:string}>('SELECT payload_ciphertext AS ciphertext FROM ls_fishing_billing.quotes WHERE workspace_id=$1 AND id=$2',[ws,seeded.quote.id]))[0]!;return verifyGuestFamilyOffer(JSON.parse(unseal(row.ciphertext,quoteAad(seeded.quote.id),ring)));}
async function snapshot(){return {counts:await counts(),quote:await query('SELECT revision,payload_ciphertext FROM ls_fishing_billing.quotes WHERE workspace_id=$1',[ws]),grant:await query('SELECT state,token_digest,payload_ciphertext FROM ls_fishing_billing.guest_grants WHERE workspace_id=$1',[ws])};}
const accept=()=>service().acceptFinancialOffer(token,seeded.command);

beforeAll(async()=>{
 await db.exec('CREATE SCHEMA ls_control');
 for(const f of ['0001_ls_foundation.sql','0010_ls_identity_cases_20260906.sql'])await db.exec(await readFile('migrations/'+f,'utf8'));
 await db.exec(await readFile('tests/fixtures/fishing-billing.sql','utf8'));
 await db.exec(await readFile('migrations/proposals/UNNUMBERED_ls_fishing_billing_guest_v3.sql','utf8'));
 await db.exec('CREATE SCHEMA synthetic_guest;CREATE TABLE synthetic_guest.admissions(workspace_id uuid,family_id uuid,recipient_id uuid,assurance_id uuid,active boolean);CREATE TABLE synthetic_guest.presentations(grant_id uuid,body text);');
 for(const id of [ws,other])await query('INSERT INTO ls_identity.workspaces(id,created_at) VALUES($1,$2)',[id,initial]);
 for(const [id,kind] of [[syntheticOwner,'adult'],[syntheticId(20),'minor'],[syntheticId(21),'minor']])await query('INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,$3,$4,$5)',[id,ws,kind,'SYNTHETIC ONLY',initial]);
 await query("INSERT INTO ls_identity.accounts(id,workspace_id,role,state,locale,email_blind,email_ciphertext,email_verified_at,password_hash,created_at,updated_at) VALUES($1,$2,'practitioner','active','en',$3,'SYNTHETIC',$4,'SYNTHETIC-NONLOGIN',$4,$4)",[syntheticOwner,ws,'a'.repeat(64),initial]);
 await query('INSERT INTO ls_identity.account_subjects VALUES($1,$2,$2)',[ws,syntheticOwner]);
 const family=syntheticDraft().familyId;await query('INSERT INTO ls_cases.families(id,workspace_id,label_ciphertext,created_at) VALUES($1,$2,$3,$4)',[family,ws,'SYNTHETIC ONLY',initial]);
 for(const id of [syntheticId(20),syntheticId(21)])await query("INSERT INTO ls_cases.family_members VALUES($1,$2,$3,'child')",[ws,family,id]);
},20000);
beforeEach(async()=>{
 await db.exec('TRUNCATE ls_fishing_billing.definitions CASCADE;TRUNCATE synthetic_guest.admissions,synthetic_guest.presentations;');
 currentTime=Date.parse(initial);denyTarget=false;denyCurrent=false;displayCalls=0;clockCalls=0;expireOnRead=Infinity;finalMutation='';failStage='';zeroStage='';alterGrantIndex=false;alterQuoteIndex=false;dropResult=false;trace.length=0;failSecondObligation=false;obligationWrites=0;alterGrantCipher=false;corruptReplay='';retainedContext=null;replacementQueries=0;swapAtRead='';expireAtRead='';revokeAtRead='';
 seeded=await seed();
});
afterAll(async()=>{await db.close();});

it('durably saves actual encrypted evidence, journal, two child/period obligations and consumed grant together',async()=>{
 const receipt=await accept();expect(receipt).toMatchObject({quoteId:seeded.quote.id,acceptedRevision:3,acceptedAt:initial,replayed:false,paymentStateAtAcceptance:'unpaid'});
 expect(await counts()).toEqual({operations:1,evidence:1,obligations:2});const quote=await storedQuote();
 expect(projectGuestBalanceV3(quote,[])).toMatchObject({dueMinor:130000,remainingMinor:130000,state:'unpaid'});
 const rows=await query<{id:string;ciphertext:string}>('SELECT id,evidence_ciphertext AS ciphertext FROM ls_fishing_billing.guest_financial_acceptances WHERE workspace_id=$1',[ws]);
 const evidence=JSON.parse(unseal(rows[0]!.ciphertext,'ls_fishing_billing/guest/v3/financial_acceptance/'+ws+'/'+receipt.acceptanceId,ring));
 expect(evidence.acceptance.parent.privateEvidenceId).toBe(rows[0]!.id);expect(evidence.acceptance.id).toBe(rows[0]!.id);
 expect(evidence.acceptance.parent.submittedName).toBe(seeded.command.parent.submittedName);expect(evidence.presentation).toEqual(seeded.presentation);
 expect(evidence.acceptance.parent.statementSha256).toBe(guestFinancialStatementSha256(evidence.presentation));
 expect(evidence.acceptance.assuranceEvidenceId).toBe(syntheticId(1817));expect(evidence.acceptance.assuranceEvidenceId).not.toBe(seeded.grant.recipientBindingEvidenceId);
 expect(quote.acceptance).toEqual(evidence.acceptance);expect(quote.lines.map(l=>l.period.id)).toEqual(seeded.quote.lines.map(l=>l.period.id));
 expect(JSON.stringify(receipt)).not.toContain('SYNTHETIC SIGNER');expect(JSON.stringify(trace)).not.toContain(token);expect(JSON.stringify(trace)).not.toContain(seeded.command.parent.submittedName);
});
it('replays in a new service/resolver after reload without any write or new presentation',async()=>{
 const receipt=await accept(),before=await snapshot();displayCalls=0;trace.length=0;
 expect(await accept()).toEqual({...receipt,replayed:true});expect(await snapshot()).toEqual(before);expect(displayCalls).toBe(0);
 expect(trace.every(t=>t.sql.startsWith('SELECT'))).toBe(true);
});
it('recovers the original receipt after a committed result is lost',async()=>{
 dropResult=true;await expect(accept()).rejects.toMatchObject({code:'UNAVAILABLE'});expect(await counts()).toEqual({operations:1,evidence:1,obligations:2});
 const result=await accept();expect(result.replayed).toBe(true);expect(result.acceptedAt).toBe(initial);expect(await counts()).toEqual({operations:1,evidence:1,obligations:2});
});
it('serializes queued concurrent requests into one acceptance and original replay',async()=>{
 const receipts=await Promise.all([accept(),accept()]);expect(receipts[0]!.acceptanceId).toBe(receipts[1]!.acceptanceId);expect(receipts.map(r=>r.replayed)).toEqual([false,true]);expect(await counts()).toEqual({operations:1,evidence:1,obligations:2});
});
it.each(['body','operation'])('denies changed %s on a consumed grant while retaining all original facts',async what=>{
 await accept();const before=await snapshot(),command=what==='body'?{...seeded.command,parent:{...seeded.command.parent,submittedName:'SYNTHETIC OTHER'}}:{...seeded.command,operationId:syntheticId(1900)};
 await expect(service().acceptFinancialOffer(token,command)).rejects.toMatchObject({code:'UNAVAILABLE'});expect(await snapshot()).toEqual(before);
});
it('denies a new grant against an already accepted quote',async()=>{
 await accept();const g={...seeded.grant,id:syntheticId(1901),tokenDigest:tokenDigest('y'.repeat(43))},life={...seeded.lifecycle,grant:g};
 await query('INSERT INTO ls_fishing_billing.guest_grants VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[ws,g.id,seeded.quote.id,g.action,g.tokenDigest,'active',g.issuedAt,g.expiresAt,seal(JSON.stringify(life),grantAad(g.id),ring)]);
 await expect(service().acceptFinancialOffer('y'.repeat(43),seeded.command)).rejects.toThrow();expect(await counts()).toEqual({operations:1,evidence:1,obligations:2});
});
it.each(['journal','evidence','obligation','quote','grant'])('rolls back every effect on %s write failure',async s=>{
 const before=await snapshot();failStage=s;await expect(accept()).rejects.toMatchObject({code:'UNAVAILABLE'});expect(await snapshot()).toEqual(before);
});
it('rolls back journal/evidence and the first child when the second child write fails',async()=>{
 const before=await snapshot();failSecondObligation=true;await expect(accept()).rejects.toMatchObject({code:'UNAVAILABLE'});expect(obligationWrites).toBe(2);expect(await snapshot()).toEqual(before);
});
it('retains an existing other-quote obligation when child/period uniqueness rejects the new acceptance',async()=>{
 const q={...seeded.quote,id:syntheticId(1902)};
 await query('INSERT INTO ls_fishing_billing.quotes VALUES($1,$2,$3,$4,$5,$6,$7)',[ws,q.id,q.familyId,q.definition.id,q.revision,seal(JSON.stringify(q),quoteAad(q.id),ring),q.createdAt]);
 const l=q.lines[0]!;await query('INSERT INTO ls_fishing_billing.obligations VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[ws,q.id,syntheticId(1903),q.familyId,l.childId,l.period.id,l.period.startsAt,l.period.endsAt]);
 const before=await snapshot();await expect(accept()).rejects.toMatchObject({code:'UNAVAILABLE'});expect(await snapshot()).toEqual(before);
});
it.each(['quote','grant'])('rolls back on a zero-row %s CAS',async s=>{
 const before=await snapshot();zeroStage=s;await expect(accept()).rejects.toMatchObject({code:'UNAVAILABLE'});expect(await snapshot()).toEqual(before);
});
it.each(['grant','quote'])('rolls back an indexed %s mutation after final authority check',async s=>{
 const before=await snapshot();alterGrantIndex=s==='grant';alterQuoteIndex=s==='quote';await expect(accept()).rejects.toMatchObject({code:'UNAVAILABLE'});expect(await snapshot()).toEqual(before);
});
it('requires the original active grant ciphertext even if replacement plaintext is identical',async()=>{
 const before=await snapshot();alterGrantCipher=true;await expect(accept()).rejects.toMatchObject({code:'UNAVAILABLE'});expect(await snapshot()).toEqual(before);
});
it.each(['target','current','family','child','workspace'])('denies missing current %s authority without persistence',async kind=>{
 if(kind==='target')denyTarget=true;if(kind==='current')denyCurrent=true;
 if(kind==='family')await query('UPDATE synthetic_guest.admissions SET active=false');
 if(kind==='child')await query("UPDATE ls_cases.family_members SET role='parent' WHERE person_id=$1",[syntheticId(20)]);
 const before=await snapshot();await expect((kind==='workspace'?service(binder,other):service()).acceptFinancialOffer(token,seeded.command)).rejects.toThrow();expect(await snapshot()).toEqual(before);
 if(kind==='child')await query("UPDATE ls_cases.family_members SET role='child' WHERE person_id=$1",[syntheticId(20)]);
});
it.each(['revision','family','created','cipher'])('denies changed quote %s metadata/ciphertext',async kind=>{
 if(kind==='revision')await query('UPDATE ls_fishing_billing.quotes SET revision=7');
 if(kind==='family')await query('UPDATE ls_fishing_billing.quotes SET family_id=$1',[syntheticId(1999)]);
 if(kind==='created')await query("UPDATE ls_fishing_billing.quotes SET created_at='infinity'");
 if(kind==='cipher')await query("UPDATE ls_fishing_billing.quotes SET payload_ciphertext='CORRUPT SYNTHETIC'");
 const before=await snapshot();await expect(accept()).rejects.toMatchObject({code:'UNAVAILABLE'});expect(await snapshot()).toEqual(before);
});
it.each(['expired','revoked','wrongPurpose'])('denies an initially %s grant',async kind=>{
 if(kind==='expired')currentTime=Date.parse(seeded.grant.expiresAt);
 if(kind==='revoked')await query("UPDATE ls_fishing_billing.guest_grants SET state='revoked'");
 if(kind==='wrongPurpose')await query("UPDATE ls_fishing_billing.guest_grants SET action='submit_private_completion'");
 const before=await snapshot();await expect(accept()).rejects.toMatchObject({code:'UNAVAILABLE'});expect(await snapshot()).toEqual(before);
});
it.each(['display','expire','expireAfterCheck','revoke'] as const)('rolls back %s at the final current/write boundary',async kind=>{
 const before=await snapshot();finalMutation=kind;await expect(accept()).rejects.toMatchObject({code:'UNAVAILABLE'});expect(await snapshot()).toEqual(before);
});
it('denies a changed assurance record between initial and final resolution',async()=>{
 let calls=0;const current=authority.current;
 const changing:BillingGuestGrantAuthority={...authority,current:async(c,g,mode)=>{const e=await current(c,g,mode);return {...e,assuranceEvidenceId:++calls>=3?syntheticId(1998):e.assuranceEvidenceId};}};
 const consumer=new FishingBillingGuestNativeV3(binder,ws,ring,clock,new FishingBillingGuestGrantResolver(ws,ring,digestKey,clock,changing)),before=await snapshot();
 await expect(consumer.acceptFinancialOffer(token,seeded.command)).rejects.toMatchObject({code:'UNAVAILABLE'});expect(await snapshot()).toEqual(before);
});
it('replays original stored statements and assurance after later quote revisions, cancellation and new current evidence',async()=>{
 const receipt=await accept(),accepted=await storedQuote(),cancelled=changeGuestBillingState(accepted,3,{cancel:true,paused:true});
 await query('UPDATE ls_fishing_billing.quotes SET revision=$1,payload_ciphertext=$2',[6,seal(JSON.stringify({...cancelled,revision:6}),quoteAad(cancelled.id),ring)]);
 await query('UPDATE synthetic_guest.admissions SET assurance_id=$1',[syntheticId(1997)]);
 await query('UPDATE synthetic_guest.presentations SET body=$1',[JSON.stringify({...seeded.presentation,affirmation:{...seeded.presentation.affirmation,version:'SYNTHETIC CURRENT TEXT v2'}})]);
 const before=await snapshot(),evidence=await query('SELECT evidence_ciphertext FROM ls_fishing_billing.guest_financial_acceptances');displayCalls=0;
 expect(await accept()).toEqual({...receipt,replayed:true});expect(displayCalls).toBe(0);expect(await snapshot()).toEqual(before);expect(await query('SELECT evidence_ciphertext FROM ls_fishing_billing.guest_financial_acceptances')).toEqual(evidence);
});
it.each(['expired','revoked','access'])('denies %s original-operation replay with no writes',async kind=>{
 await accept();if(kind==='expired')currentTime=Date.parse(seeded.grant.expiresAt);if(kind==='revoked')await query("UPDATE ls_fishing_billing.guest_grants SET state='revoked'");if(kind==='access')denyCurrent=true;
 const before=await snapshot();await expect(accept()).rejects.toMatchObject({code:'UNAVAILABLE'});expect(await snapshot()).toEqual(before);
});
it.each(['journal','evidence','statement'] as const)('denies corrupted original %s readback without rewriting anything',async kind=>{
 await accept();const before=await snapshot();corruptReplay=kind;await expect(accept()).rejects.toMatchObject({code:'UNAVAILABLE'});expect(await snapshot()).toEqual(before);
});
it('denies a resealed consumed lifecycle that points at a different original receipt',async()=>{
 await accept();const rows=await query<{ciphertext:string}>('SELECT payload_ciphertext AS ciphertext FROM ls_fishing_billing.guest_grants');
 const life=guestGrantLifecycleSchema.parse(JSON.parse(unseal(rows[0]!.ciphertext,grantAad(seeded.grant.id),ring)));if(!life.use)throw Error('SYNTHETIC_MISSING_USE');life.use.receiptId=syntheticId(1996);
 await query('UPDATE ls_fishing_billing.guest_grants SET payload_ciphertext=$1',[seal(JSON.stringify(life),grantAad(seeded.grant.id),ring)]);
 const before=await snapshot();await expect(accept()).rejects.toMatchObject({code:'UNAVAILABLE'});expect(await snapshot()).toEqual(before);
});
it('preserves and denies a historical V1 account quote rather than converting it',async()=>{
 const old=syntheticAccepted(),cipher=seal(JSON.stringify(old),'ls_fishing_billing/v1/quote/'+ws+'/'+old.id,ring);
 await query('UPDATE ls_fishing_billing.quotes SET payload_ciphertext=$1,revision=$2',[cipher,old.revision]);const before=await snapshot();
 await expect(accept()).rejects.toThrow();expect(await snapshot()).toEqual(before);expect((await query<{ciphertext:string}>('SELECT payload_ciphertext AS ciphertext FROM ls_fishing_billing.quotes'))[0]!.ciphertext).toBe(cipher);
});

async function durable(){return {base:await snapshot(),operations:await query('SELECT * FROM ls_fishing_billing.guest_operations ORDER BY operation_id'),evidence:await query('SELECT * FROM ls_fishing_billing.guest_financial_acceptances ORDER BY id'),obligations:await query('SELECT * FROM ls_fishing_billing.obligations ORDER BY line_id')};}
it.each(['quote','operation'] as const)('Native review R01 refuses a retained-context swap during fresh %s read before another transaction can query',async read=>{
 const before=await durable();swapAtRead=read;
 await expect(accept()).rejects.toMatchObject({code:'UNAVAILABLE'});expect(replacementQueries).toBe(0);expect(await durable()).toEqual(before);
});
it.each(['operation','evidence','quote','obligations'] as const)('Native review R01 refuses a retained-context swap during replay %s read',async read=>{
 await accept();const before=await durable();trace.length=0;swapAtRead=read;
 await expect(accept()).rejects.toMatchObject({code:'UNAVAILABLE'});expect(replacementQueries).toBe(0);expect(await durable()).toEqual(before);
 expect(trace.every(t=>t.sql.startsWith('SELECT'))).toBe(true);
});
it.each(['evidence','obligations'] as const)('Native review R02 refuses clock expiry during replay %s read with original state intact',async read=>{
 await accept();const before=await durable();trace.length=0;expireAtRead=read;
 await expect(accept()).rejects.toMatchObject({code:'UNAVAILABLE'});expect(await durable()).toEqual(before);expect(trace.every(t=>t.sql.startsWith('SELECT'))).toBe(true);
});
it.each(['evidence','obligations'] as const)('Native review R02 refuses current-access expiry during replay %s read with original state intact',async read=>{
 await accept();const before=await durable();trace.length=0;revokeAtRead=read;
 await expect(accept()).rejects.toMatchObject({code:'UNAVAILABLE'});expect(await durable()).toEqual(before);expect(trace.every(t=>t.sql.startsWith('SELECT'))).toBe(true);
});
