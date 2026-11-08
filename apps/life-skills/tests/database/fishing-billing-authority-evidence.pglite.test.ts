import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {beforeAll,afterAll,afterEach,it,expect,vi} from 'vitest';
import {asId} from '../../src/lib/ids.ts';
import {seal,tokenDigest} from '../../src/features/identity/crypto.ts';
import type {Actor} from '../../src/features/identity/types.ts';
import type {IdentityStore,SqlSession} from '../../src/features/identity/store.ts';
import {privateDigest} from '../../src/features/contact-ops/server/digests.ts';
import {ContactCutoverStore} from '../../src/features/contact-ops/server/cutover-store.ts';
import {AcademyCrmStore} from '../../src/features/contact-ops/server/academy-crm-store.ts';
import {PublicGroupApplicationStore} from '../../src/features/group-application/store.ts';
import {FishingBillingInquiryFamilyProposals} from '../../src/lib/fishing-billing-inquiry-family-proposal.ts';
import {FishingBillingAuthorityEvidenceStore,AUTHORITY_EVIDENCE_VERSION,AUTHORITY_REVOCATION_VERSION,authorityEvidenceRecordSchema,
 type AuthorityEvidenceRecord,type AuthorityEvidencePurpose,type AuthorityEvidenceFamily,type AuthorityEvidenceBatch,type AuthorityEvidenceContext} from '../../src/features/fishing-billing/authority-evidence-store.ts';
import {REMINDER_SERVICE_VERSION} from '../../src/features/fishing-billing/reminder-service.ts';
import {currentTrip390Fields} from '../fixtures/trip390-current.ts';
import {requirePgliteMemoryEnvironment} from '../fixtures/pglite-memory-environment.ts';
vi.mock('server-only',()=>({}));

// Only new no-URL memory databases. Actual baseline SQL, source/CRM/Cutover/
// proposal/identity/AEAD/HMAC code. SYNTHETIC recorded-release data below is NOT
// an actual source/legal/guardian/recipient approval, permission or runtime.
let engine:PGlite;
const at=new Date('2035-01-06T15:00:00Z'),clock={now:()=>new Date(at)};
const ring={activeKeyId:'synthetic',keys:{synthetic:Buffer.alloc(32,7)}},key='SYNTHETIC-AUTHORITY-EVIDENCE-INTEGRITY-ONLY';
const db:IdentityStore={transaction:work=>engine.transaction(tx=>work({query:async<T extends object>(sql:string,values:readonly unknown[]=[])=>
 (await tx.query<T>(sql,[...values])).rows} as SqlSession))};
const network=vi.fn<typeof fetch>(async()=>{throw Error('NO_NETWORK_IN_MEMORY_EVIDENCE_TEST');});
const fixtures:{assertUnchanged:()=>Promise<void>}[]=[];
const ref=(id:string)=>({id:'SYNTHETIC-'+id,sha256:createHash('sha256').update('SYNTHETIC-'+id).digest('hex')});
beforeAll(async()=>{
 requirePgliteMemoryEnvironment(process.env);vi.stubGlobal('fetch',network);engine=new PGlite();
 await engine.exec('CREATE SCHEMA ls_control');
 const manifest=JSON.parse(await readFile('migrations/manifest.json','utf8')) as {name:string;sha256:string}[];
 for(const name of ['0001_ls_foundation.sql','0010_ls_identity_cases_20260906.sql','0030_ls_calendar_attendance_20260907.sql',
  '0097_ls_demo_provenance.sql','0101_ls_contact_operations.sql','0102_ls_internal_tasks.sql','0105_ls_contact_authority.sql',
  '0110_ls_contact_outbound_projection.sql','0116_ls_acquisition_candidates.sql','0124_ls_group_interest.sql',
  '0131_ls_public_group_applications.sql','0133_ls_fishing_lead_memberships.sql','0135_ls_inquiry_email_outbox.sql','0138_ls_academy_crm.sql']){
  const sql=await readFile('migrations/'+name,'utf8');
  expect(createHash('sha256').update(sql.replaceAll('\r\n','\n')).digest('hex')).toBe(manifest.find(m=>m.name===name)?.sha256);
  await engine.exec(sql);
 }
 await engine.exec('CREATE SCHEMA ls_fishing_billing');
 await engine.exec(await readFile('migrations/proposals/UNNUMBERED_ls_fishing_inquiry_family_proposals.sql','utf8'));
 await engine.exec(await readFile('migrations/proposals/UNNUMBERED_ls_fishing_billing_authority_evidence.sql','utf8'));
},20000);
afterEach(async()=>{
 expect(globalThis.fetch).toBe(network);expect(network).not.toHaveBeenCalled();
 for(const f of fixtures.splice(0))await f.assertUnchanged();
});
afterAll(async()=>{try{await engine?.close();}finally{vi.unstubAllGlobals();}});

async function fixture(uppercaseSourceChild=false){
 const workspace=asId(randomUUID(),'workspace');await engine.query('INSERT INTO ls_identity.workspaces VALUES($1,$2)',[workspace,at]);
 async function actor(role:'practitioner'|'parent'){
  const id=asId(randomUUID(),'account'),personId=asId(randomUUID(),'person'),sessionDigest=tokenDigest(randomBytes(32).toString('base64url'));
  await engine.query("INSERT INTO ls_identity.people VALUES($1,$2,'adult',$3,$4)",[personId,workspace,seal(JSON.stringify({displayName:'SYNTHETIC '+role}),`person:${workspace}:${personId}`,ring),at]);
  await engine.query(`INSERT INTO ls_identity.accounts(id,workspace_id,role,state,locale,email_blind,email_ciphertext,email_verified_at,password_hash,created_at,updated_at)
   VALUES($1,$2,$3,'active','en',$4,$5,$6,'SYNTHETIC-NONLOGIN',$6,$6)`,[id,workspace,role,createHash('sha256').update(id).digest('hex'),seal(id+'@example.invalid',`email:${workspace}:${id}`,ring),at]);
  await engine.query('INSERT INTO ls_identity.account_subjects VALUES($1,$2,$3)',[workspace,id,personId]);
  const expiresAt=Date.parse('2036-01-01T00:00:00Z');
  await engine.query('INSERT INTO ls_identity.sessions(token_digest,workspace_id,account_id,created_at,expires_at) VALUES($1,$2,$3,$4,$5)',[sessionDigest,workspace,id,at,new Date(expiresAt)]);
  return {id,workspaceId:workspace,personId,role,state:'active',locale:'en',sessionDigest,expiresAt} as Actor;
 }
 const owner=await actor('practitioner'),parent=await actor('parent');
 await new ContactCutoverStore(db,ring,key,clock).initializeAcademy(owner,{operationId:randomUUID(),expectedEpoch:0,observedNativeWritesSinceSwitch:0,
  decisionId:'ACADEMY-ONLY-CRM-20261028-01',evidence:{retiredSourcesFence:'a'.repeat(64),retiredSchedulesFence:'b'.repeat(64),
   retainedAcademyRecords:'c'.repeat(64),queueReconciliation:'d'.repeat(64),restorePlan:'e'.repeat(64)}});
 const fields=currentTrip390Fields();fields.email='synthetic-'+randomUUID()+'@example.invalid';
 fields.children=[{id:uppercaseSourceChild?randomUUID().toUpperCase():randomUUID(),name:'SYNTHETIC One',ageYears:10,experience:'new'},
  {id:randomUUID(),name:'SYNTHETIC Two',ageYears:13,experience:'some'}];
 // Actual old-purpose ACK QUEUE only, never a sender. Its sealed bytes remain
 // unchanged through every evidence read/revocation fixture below.
 const saved=await new PublicGroupApplicationStore(db,workspace,ring,key,clock,true).submit({operationId:randomUUID(),fields});
 const oldAck=(await engine.query<{purpose:string;state:string}>('SELECT purpose,state FROM ls_service_interest.inquiry_email_outbox WHERE workspace_id=$1',[workspace])).rows;
 expect(oldAck).toEqual([{purpose:'academy_inquiry_acknowledgment_v1',state:'queued'}]);
 const crm=new AcademyCrmStore(db,ring,key,clock),preview=await crm.previewInquiry(owner,saved.item.id,1);
 const guardian=(await crm.execute(owner,{action:'from_inquiry',operationId:randomUUID(),expectedEpoch:1,
  sourceApplicationId:saved.item.id,sourceDigest:preview.sourceDigest,fields:{stage:'SYNTHETIC',nextAction:null,followUpDate:null,notes:''}})).personId;
 const familyId=randomUUID();await engine.query('INSERT INTO ls_cases.families VALUES($1,$2,$3,$4)',[familyId,workspace,seal('SYNTHETIC family',`family:${workspace}:${familyId}`,ring),at]);
 await engine.query("INSERT INTO ls_cases.family_members VALUES($1,$2,$3,'guardian')",[workspace,familyId,guardian]);
 const children=[];
 for(const c of fields.children){const nativeChildId=randomUUID();
  await engine.query("INSERT INTO ls_identity.people VALUES($1,$2,'minor',$3,$4)",[nativeChildId,workspace,seal(JSON.stringify({displayName:'SYNTHETIC minor'}),`person:${workspace}:${nativeChildId}`,ring),at]);
  await engine.query("INSERT INTO ls_cases.family_members VALUES($1,$2,$3,'child')",[workspace,familyId,nativeChildId]);children.push({applicationChildId:c.id,nativeChildId});
 }
 const proposals=new FishingBillingInquiryFamilyProposals(db,workspace,ring,key,clock),selection={reference:saved.item.id,familyId,children};
 const p=await proposals.preview(owner,{selection,expectedEpoch:1}),proposal=(await proposals.propose(owner,{operationId:randomUUID(),expectedEpoch:1,selection,
  expectedSourceDigest:p.sourceDigest,expectedNativeDigest:p.nativeDigest})).record;
 const family:AuthorityEvidenceFamily={proposalId:proposal.id,reference:saved.item.id,familyId,guardianPersonId:guardian,children,
  sourceDigest:p.sourceDigest,nativeDigest:p.nativeDigest};
 const snapshot=async()=>Promise.all(['ls_service_interest.public_applications','ls_service_interest.public_application_operations',
  'ls_service_interest.inquiry_email_outbox','ls_fishing_billing.inquiry_family_proposals','ls_identity.people','ls_cases.family_members',
  'ls_calendar.tasks','ls_contact_ops.outbound_projections'].map(async table=>(await engine.query(`SELECT to_jsonb(t) AS row FROM ${table} t WHERE workspace_id=$1 ORDER BY to_jsonb(t)::text`,[workspace])).rows));
 const before=await snapshot();
 fixtures.push({assertUnchanged:async()=>{expect(await snapshot()).toEqual(before);}});
 const reader=new FishingBillingAuthorityEvidenceStore(ring,key);
 const run=(input:AuthorityEvidenceBatch,original=false,readonly=false)=>db.transaction(async tx=>{
  if(readonly)await tx.query('SET TRANSACTION READ ONLY');
  const context={tx,workspaceId:workspace,now:new Date(at)};
  return original?reader.readOriginalBatch(context,input):reader.readReleasedBatch(context,input);
 });
 return {workspace,owner,parent,fields,proposal,family,reader,run};
}
type Fixture=Awaited<ReturnType<typeof fixture>>;
function record(f:Fixture,purpose:AuthorityEvidencePurpose,state:'prepared'|'released'='released'):AuthorityEvidenceRecord{
 const source=ref('SOURCE-'+purpose),release=state==='released'?ref('RELEASE-'+purpose):null;
 const common={version:AUTHORITY_EVIDENCE_VERSION,id:randomUUID(),workspaceId:f.workspace,programKey:'fishing_monthly_club',mode:'test',
  purpose,state,sourceReference:source,releaseEvidence:release,recordedBy:f.owner.id,recordedAt:at.toISOString(),
  releasedAt:state==='released'?at.toISOString():null,expiresAt:state==='released'?new Date(at.getTime()+86400000).toISOString():null};
 const body=purpose==='guardian_assurance'?{independentReviewEvidence:ref('PRIVATE-GUARDIAN-REVIEW')}:
  purpose==='email_recipient'?{email:f.fields.email,locale:'he',verificationEvidence:ref('INDEPENDENT-EMAIL-REVIEW')}:
  purpose==='reminder_policy_release'?{id:'SYNTHETIC-REMINDER',revision:1,source,timeZone:'America/New_York',offsetsMinutes:[0,1440]}:
  purpose==='service_admission'?{binding:{version:REMINDER_SERVICE_VERSION,mode:'test',serviceBindingId:'SYNTHETIC-SERVICE',outboxBindingId:'SYNTHETIC-OUTBOX'},reviewedTargetSchemaReceipt:ref('TARGET-SCHEMA-RECEIPT')}:
  {source,version:'SYNTHETIC-DOCUMENT-v1',locale:'he',textSha256:'d'.repeat(64),releaseEvidence:release};
 return authorityEvidenceRecordSchema.parse({...common,family:purpose==='guardian_assurance'||purpose==='email_recipient'?structuredClone(f.family):null,body});
}
const lookup=(r:AuthorityEvidenceRecord)=>({id:r.id,purpose:r.purpose,sourceReference:structuredClone(r.sourceReference),
 releaseEvidence:structuredClone(r.releaseEvidence),family:structuredClone(r.family)});
const input=(records:AuthorityEvidenceRecord[],lock:'shared'|'snapshot'='snapshot'):AuthorityEvidenceBatch=>({lock,lookups:records.map(lookup)});
// Synthetic fixture seeding only, deliberately NOT a production approval or
// revocation writer. No real source review is represented by these references.
async function seed(f:Fixture,r:AuthorityEvidenceRecord|Record<string,unknown>,index:Record<string,unknown>={}){
 const v=r as unknown as Record<string,unknown>,family=v.family as AuthorityEvidenceFamily|null;
 const source=v.sourceReference as ReturnType<typeof ref>,release=v.releaseEvidence as ReturnType<typeof ref>|null;
 const hash=privateDigest({domain:'fishing-billing-authority-evidence-record/v1',workspace:f.workspace,value:r},key);
 const data={workspace_id:f.workspace,id:v.id,program_key:v.programKey,mode:v.mode,purpose:v.purpose,state:v.state,
  source_reference_id:source.id,source_reference_sha256:source.sha256,release_evidence_id:release?.id??null,release_evidence_sha256:release?.sha256??null,
  recorded_by:v.recordedBy,created_at:v.recordedAt,released_at:v.releasedAt,expires_at:v.expiresAt,
  proposal_id:family?.proposalId??null,application_id:family?.reference??null,family_id:family?.familyId??null,guardian_person_id:family?.guardianPersonId??null,
  source_digest:family?.sourceDigest??null,native_digest:family?.nativeDigest??null,payload_digest:hash,
  payload_ciphertext:seal(JSON.stringify(r),`ls_fishing_billing/authority_evidence/v1/${f.workspace}/${v.id}`,ring),...index};
 const keys=Object.keys(data);await engine.query(`INSERT INTO ls_fishing_billing.authority_evidence(${keys.join(',')}) VALUES(${keys.map((_,i)=>'$'+(i+1)).join(',')})`,Object.values(data));
 return hash;
}
async function revoke(f:Fixture,r:AuthorityEvidenceRecord,direct?:SqlSession,corrupt=false){
 const id=randomUUID(),evidenceDigest=privateDigest({domain:'fishing-billing-authority-evidence-record/v1',workspace:f.workspace,value:r},key);
 const value={version:AUTHORITY_REVOCATION_VERSION,id,workspaceId:f.workspace,programKey:'fishing_monthly_club',mode:'test',evidenceId:r.id,evidenceDigest,
  recordedBy:f.owner.id,recordedAt:at.toISOString(),evidenceReference:ref('WITHDRAWN-REVIEW')};
 const values=[f.workspace,id,r.id,evidenceDigest,'fishing_monthly_club','test',f.owner.id,at,
  corrupt?'f'.repeat(64):privateDigest({domain:'fishing-billing-authority-evidence-revocation/v1',workspace:f.workspace,value},key),
  seal(JSON.stringify(value),`ls_fishing_billing/authority_evidence_revocation/v1/${f.workspace}/${id}`,ring)];
 const sql='INSERT INTO ls_fishing_billing.authority_evidence_revocations(workspace_id,id,evidence_id,evidence_digest,program_key,mode,recorded_by,created_at,payload_digest,payload_ciphertext) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)';
 if(direct)await direct.query(sql,values);else await engine.query(sql,values);return value;
}

it.each(['guardian_assurance','email_recipient','financial_terms_release','completion_privacy_release','reminder_policy_release','service_admission'] as const)(
 'reads exact %s recorded bytes without granting authority or changing source/proposal/old ACK',async purpose=>{
  const f=await fixture(),r=record(f,purpose);await seed(f,r);const result=await f.run(input([r]));
  expect(result).toEqual([{classification:'integrity_only_not_authority',consistency:'snapshot',record:r}]);
  expect(Object.isFrozen(result)).toBe(true);expect(Object.isFrozen(result[0]?.record)).toBe(true);expect(Object.isFrozen(result[0]?.record.body)).toBe(true);
  expect(result[0]).not.toHaveProperty('verified');expect(result[0]).not.toHaveProperty('permission');
  expect(f.proposal).toMatchObject({state:'proposed',guardianVerified:false,recipientVerified:false,financialAcceptance:false,outboundEligible:false});
 });

it('preserves source child UUID bytes and exact ordered complete mapping',async()=>{
 const f=await fixture(true),r=record(f,'guardian_assurance');await seed(f,r);
 const result=await f.run(input([r]));expect(result[0]?.record.family?.children).toEqual(f.proposal.command.selection.children);
 expect(Object.isFrozen(result[0]?.record.family?.children[0])).toBe(true);
});

it('returns requested order with explicit nulls and rejects authentic expectation mismatches',async()=>{
 const f=await fixture(),a=record(f,'guardian_assurance'),b=record(f,'financial_terms_release');await seed(f,a);await seed(f,b);
 const absent={...lookup(b),id:randomUUID()},wrongSource={...lookup(a),sourceReference:ref('OTHER')},wrongRelease={...lookup(b),releaseEvidence:ref('OTHER')};
 const wrongFamily={...lookup(a),family:{...f.family,familyId:randomUUID()}},wrongPurpose={...lookup(b),purpose:'completion_privacy_release' as const};
 const result=await f.run({lock:'snapshot',lookups:[lookup(b),absent,lookup(a)]});
 expect(result.map(r=>r?.record.id??null)).toEqual([b.id,null,a.id]);
 for(const l of [wrongSource,wrongRelease,wrongFamily,wrongPurpose])expect(await f.run({lock:'snapshot',lookups:[l]})).toEqual([null]);
});

it.each(['prepared','expired','future','revoked'] as const)('current %s evidence is closed while original data stays historical only',async kind=>{
 const f=await fixture(),r=record(f,'financial_terms_release',kind==='prepared'?'prepared':'released');
 if(kind==='expired'){r.releasedAt=new Date(at.getTime()-86400000).toISOString();r.expiresAt=at.toISOString();}
 if(kind==='future'){r.releasedAt=new Date(at.getTime()+86400000).toISOString();r.expiresAt=new Date(at.getTime()+172800000).toISOString();}
 await seed(f,r);const revocation=kind==='revoked'?await revoke(f,r):null;
 expect(await f.run(input([r]))).toEqual([null]);
 expect(await f.run(input([r]),true)).toEqual([{classification:'historical_data_only',consistency:'snapshot',record:r,revocation}]);
});

it('exact null release expectation is required for prepared original data and never upgrades a record',async()=>{
 const f=await fixture(),r=record(f,'guardian_assurance','prepared');await seed(f,r);
 expect(await f.run(input([r]),true)).toMatchObject([{classification:'historical_data_only',record:{state:'prepared',releaseEvidence:null}}]);
 expect(await f.run({lock:'snapshot',lookups:[{...lookup(r),releaseEvidence:ref('OTHER')}]},true)).toEqual([null]);
 expect(await f.run(input([r]))).toEqual([null]);
});

it('prepared metadata with release references still never becomes a current released record',async()=>{
 const f=await fixture(),r=record(f,'financial_terms_release');r.state='prepared';await seed(f,r);
 expect(await f.run(input([r]))).toEqual([null]);
 expect(await f.run(input([r]),true)).toMatchObject([{classification:'historical_data_only',record:{state:'prepared',releaseEvidence:r.releaseEvidence}}]);
});

it('preserves timestamp offset bytes against real UTC index metadata',async()=>{
 const f=await fixture(),r=record(f,'financial_terms_release');
 r.recordedAt='2035-01-06T10:00:00-05:00';r.releasedAt=r.recordedAt;await seed(f,r);
 expect(await f.run(input([r]))).toEqual([{classification:'integrity_only_not_authority',consistency:'snapshot',record:r}]);
});

it.each(['financial_terms_release','completion_privacy_release','reminder_policy_release'] as const)(
 'authenticates %s source-release bindings inside an otherwise correctly sealed record',async purpose=>{
  const f=await fixture(),valid=record(f,purpose),r=structuredClone(valid) as unknown as Record<string,unknown>,body=r.body as Record<string,unknown>;
  if(purpose==='completion_privacy_release')body.releaseEvidence=ref('DIFFERENT-RELEASE');else body.source=ref('DIFFERENT-SOURCE');
  await seed(f,r);await expect(f.run(input([valid]))).rejects.toThrow('UNAVAILABLE');
 });

it('recorded actor attribution never substitutes for current session access',async()=>{
 const f=await fixture(),r=record(f,'guardian_assurance');await seed(f,r);
 await engine.query('UPDATE ls_identity.sessions SET revoked_at=$2 WHERE token_digest=$1',[f.owner.sessionDigest,at]);
 expect(await f.run(input([r]))).toMatchObject([{classification:'integrity_only_not_authority'}]);
 await expect(new FishingBillingInquiryFamilyProposals(db,f.workspace,ring,key,clock).read(f.owner,{reference:f.family.reference,expectedEpoch:1})).rejects.toThrow('UNAUTHENTICATED');
});

it('rejects a recipient locale that disagrees with the actual authenticated proposal',async()=>{
 const f=await fixture(),r=record(f,'email_recipient');if(r.purpose!=='email_recipient')throw Error('SYNTHETIC_PURPOSE');
 expect(f.proposal.messageLanguage).toBe('he');r.body.locale='en';await seed(f,r);
 await expect(f.run(input([r]))).rejects.toThrow('UNAVAILABLE');
 await expect(f.run(input([r]),true)).rejects.toThrow('UNAVAILABLE');
});

it('future recorded metadata is not current even when releasedAt is already past, while original data remains readable',async()=>{
 const f=await fixture(),r=record(f,'financial_terms_release');r.recordedAt=new Date(at.getTime()+3600000).toISOString();
 r.releasedAt=new Date(at.getTime()-3600000).toISOString();await seed(f,r);
 expect(await f.run(input([r]))).toEqual([null]);
 expect(await f.run(input([r]),true)).toEqual([{classification:'historical_data_only',consistency:'snapshot',record:r,revocation:null}]);
});

it.each(['payload_digest','source_reference_sha256','release_evidence_sha256','purpose','recorded_by','created_at'] as const)(
 'detects corrupt indexed %s before an expectation mismatch can hide it',async column=>{
  const f=await fixture(),r=record(f,'financial_terms_release');
  const changed=column==='purpose'?'completion_privacy_release':column==='recorded_by'?f.parent.id:column==='created_at'?new Date(at.getTime()+1000):'f'.repeat(64);
  await seed(f,r,{[column]:changed});
  await expect(f.run({lock:'snapshot',lookups:[{...lookup(r),sourceReference:ref('WRONG')}] })).rejects.toThrow('UNAVAILABLE');
 });

it.each(['version','extra_authority','bad_locale','bad_email','missing_review','bad_service_mode','bad_policy','chronology'] as const)(
 'rejects correctly sealed/HMAC-bound unsupported %s payloads',async kind=>{
  const f=await fixture(),p=kind==='bad_email'||kind==='bad_locale'?'email_recipient':kind==='bad_service_mode'?'service_admission':kind==='bad_policy'?'reminder_policy_release':'guardian_assurance';
  const valid=record(f,p),r=structuredClone(valid) as unknown as Record<string,unknown>,body=r.body as Record<string,unknown>;
  if(kind==='version')r.version='UNSUPPORTED';if(kind==='extra_authority')r.verified=true;if(kind==='bad_locale')body.locale='fr';
  if(kind==='bad_email')body.email='UPPER@example.invalid';if(kind==='missing_review')delete body.independentReviewEvidence;
  if(kind==='bad_service_mode')(body.binding as Record<string,unknown>).mode='live';if(kind==='bad_policy')body.offsetsMinutes=[0,0];
  if(kind==='chronology'){r.expiresAt=new Date(at.getTime()-1000).toISOString();
   // Correct SQL chronology, poisoned sealed chronology is detected by parser.
   await seed(f,r,{expires_at:new Date(at.getTime()+86400000)});
  }else await seed(f,r);
  await expect(f.run(input([valid]))).rejects.toThrow('UNAVAILABLE');
 });

it('rejects invalid AEAD, unknown key and family mappings that disagree with the actual stored proposal',async()=>{
 const f=await fixture(),a=record(f,'guardian_assurance'),b=record(f,'guardian_assurance');
 await seed(f,a,{payload_ciphertext:seal(JSON.stringify(a),'SYNTHETIC-WRONG-AAD',ring)});
 await expect(f.run(input([a]))).rejects.toThrow('UNAVAILABLE');
 if(b.family)b.family.children=b.family.children.slice(0,1);await seed(f,b);
 await expect(f.run(input([b]))).rejects.toThrow('UNAVAILABLE');
 const c=record(f,'financial_terms_release');await seed(f,c);
 await expect(db.transaction(tx=>new FishingBillingAuthorityEvidenceStore({activeKeyId:'other',keys:{other:Buffer.alloc(32,9)}},key)
  .readReleasedBatch({tx,workspaceId:f.workspace,now:new Date(at)},input([c])))).rejects.toThrow('UNAVAILABLE');
});

it('authenticates revocation bytes before filtering an expired or mismatched record',async()=>{
 const f=await fixture(),r=record(f,'financial_terms_release');await seed(f,r);await revoke(f,r,undefined,true);
 await expect(f.run({lock:'snapshot',lookups:[{...lookup(r),releaseEvidence:ref('WRONG')}] })).rejects.toThrow('UNAVAILABLE');
});

it('pins parsed descriptors, bound actual transaction, workspace and primitive time before the first await',async()=>{
 const f=await fixture(),a=record(f,'guardian_assurance'),b=record(f,'financial_terms_release');await seed(f,a);await seed(f,b);
 const request=input([a,b]),now=new Date(at);let mutated=false;
 const result=await db.transaction(async direct=>{
  const context:AuthorityEvidenceContext={tx:{query:async<T extends object>(sql:string,values:readonly unknown[]=[])=>{
   const rows=await direct.query<T>(sql,values);
   if(!mutated){mutated=true;context.workspaceId=asId(randomUUID(),'workspace');now.setUTCFullYear(2040);
    request.lookups.reverse();request.lookups[0]!.sourceReference.sha256='f'.repeat(64);request.lookups[1]!.family!.children[0]!.nativeChildId=randomUUID();
    context.tx=undefined as unknown as SqlSession;
   }return rows;
  }},workspaceId:f.workspace,now};
  return f.reader.readReleasedBatch(context,request);
 });
 expect(mutated).toBe(true);expect(result.map(r=>r?.record.id)).toEqual([a.id,b.id]);
});

it('supports a genuine read-only snapshot and real shared locks are refused by that database mode',async()=>{
 const f=await fixture(),r=record(f,'financial_terms_release');await seed(f,r);
 expect(await f.run(input([r]),false,true)).toMatchObject([{consistency:'snapshot'}]);
 await expect(f.run(input([r],'shared'),false,true)).rejects.toThrow('read-only transaction');
});

it('uses actual shared parent locks and an installed conflicting parent lock trigger without claiming memory contention proof',async()=>{
 const f=await fixture(),r=record(f,'financial_terms_release');await seed(f,r);const statements:string[]=[];
 const result=await db.transaction(tx=>f.reader.readReleasedBatch({workspaceId:f.workspace,now:new Date(at),tx:{query:async<T extends object>(sql:string,values:readonly unknown[]=[])=>{
  const rows=await tx.query<T>(sql,values);statements.push(sql);return rows;
 }}},input([r],'shared')));
 expect(result).toMatchObject([{consistency:'shared'}]);expect(statements[0]).toContain('FOR SHARE OF e');
 const definition=(await engine.query<{definition:string}>("SELECT pg_get_functiondef('ls_fishing_billing.lock_authority_evidence_revocation_parent()'::regprocedure) AS definition")).rows[0]!.definition;
 expect(definition).toContain('FOR UPDATE');expect(definition).toContain('NEW.evidence_id');
 const trigger=(await engine.query<{enabled:string}>("SELECT tgenabled AS enabled FROM pg_trigger WHERE tgname='authority_evidence_revocation_parent_lock'")).rows;
 expect(trigger).toEqual([{enabled:'O'}]);
});

it('same-TX revocation and its parent lock roll back atomically on failure',async()=>{
 const f=await fixture(),r=record(f,'financial_terms_release');await seed(f,r);
 await expect(db.transaction(async tx=>{
  await f.reader.readReleasedBatch({tx,workspaceId:f.workspace,now:new Date(at)},input([r],'shared'));
  await revoke(f,r,tx);expect(await f.reader.readReleasedBatch({tx,workspaceId:f.workspace,now:new Date(at)},input([r],'shared'))).toEqual([null]);
  throw Error('SYNTHETIC-ROLLBACK');
 })).rejects.toThrow('SYNTHETIC-ROLLBACK');
 expect(await f.run(input([r]))).toMatchObject([{classification:'integrity_only_not_authority'}]);
 expect((await engine.query('SELECT id FROM ls_fishing_billing.authority_evidence_revocations WHERE workspace_id=$1',[f.workspace])).rows).toEqual([]);
});

it.each(['authority_evidence','authority_evidence_revocations'] as const)('keeps %s immutable under update, delete and truncate',async table=>{
 const f=await fixture(),r=record(f,'financial_terms_release');await seed(f,r);await revoke(f,r);
 for(const sql of [`UPDATE ls_fishing_billing.${table} SET created_at=created_at WHERE workspace_id=$1`,`DELETE FROM ls_fishing_billing.${table} WHERE workspace_id=$1`])
  await expect(engine.query(sql,[f.workspace])).rejects.toThrow('FISHING_AUTHORITY_EVIDENCE_IMMUTABLE');
 await expect(engine.exec(`TRUNCATE ls_fishing_billing.${table} CASCADE`)).rejects.toThrow('FISHING_AUTHORITY_EVIDENCE_IMMUTABLE');
 expect(await f.run(input([r]),true)).toMatchObject([{classification:'historical_data_only',revocation:{evidenceId:r.id}}]);
});

it('rejects empty, duplicate, over-limit or unknown descriptors before querying any store',async()=>{
 const f=await fixture(),r=record(f,'financial_terms_release');let reads=0;
 await db.transaction(async tx=>{
  const context={tx:{query:async<T extends object>(sql:string,values:readonly unknown[]=[])=>{reads++;return tx.query<T>(sql,values);}},workspaceId:f.workspace,now:new Date(at)};
  for(const value of [{lock:'snapshot',lookups:[]},input([r,r]),{lock:'snapshot',lookups:Array.from({length:51},()=>({...lookup(r),id:randomUUID()}))},
   {lock:'snapshot',lookups:[{...lookup(r),purpose:'ARBITRARY_JSON'}]},{...input([r]),unknown:true}])
   await expect(f.reader.readReleasedBatch(context,value as AuthorityEvidenceBatch)).rejects.toThrow('INVALID_REQUEST');
 });expect(reads).toBe(0);
});

it('missing schema is unavailable with no fallback or network',async()=>{
 const isolated=new PGlite();try{
  await expect(isolated.transaction(tx=>new FishingBillingAuthorityEvidenceStore(ring,key).readReleasedBatch({
   tx:{query:async<T extends object>(sql:string,values:readonly unknown[]=[])=> (await tx.query<T>(sql,[...values])).rows},
   workspaceId:asId(randomUUID(),'workspace'),now:new Date(at)},
   {lock:'snapshot',lookups:[{id:randomUUID(),purpose:'financial_terms_release',sourceReference:ref('SOURCE'),releaseEvidence:ref('RELEASE'),family:null}]}))).rejects.toThrow('UNAVAILABLE');
 }finally{await isolated.close();}
});
