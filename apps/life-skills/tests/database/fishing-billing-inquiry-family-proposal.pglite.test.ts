import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {beforeAll,afterAll,afterEach,it,expect,vi} from 'vitest';
import {requirePgliteMemoryEnvironment} from '../fixtures/pglite-memory-environment.ts';
import {currentTrip390Fields} from '../fixtures/trip390-current.ts';
import {asId} from '../../src/lib/ids.ts';
import {seal,tokenDigest} from '../../src/features/identity/crypto.ts';
import type {Actor} from '../../src/features/identity/types.ts';
import type {IdentityStore,SqlSession} from '../../src/features/identity/store.ts';
import {IdentitySessions} from '../../src/features/identity/session-adapter.ts';
import {ContactCutoverStore} from '../../src/features/contact-ops/server/cutover-store.ts';
import {AcademyCrmStore} from '../../src/features/contact-ops/server/academy-crm-store.ts';
import {PublicGroupApplicationStore} from '../../src/features/group-application/store.ts';
import {groupApplicationRequestDigest} from '../../src/features/group-application/group-application-record.ts';
import {TRIP390_V1_INTEREST_VERSION,TRIP390_V1_NOTICE_VERSION,TRIP390_V1_OFFER,type Trip390V1Interest} from '../../src/features/group-application/academy-trip390-v1.ts';
import {decodeFishingInquiryFamilyProposalRecord,readFishingInquiryNativeFingerprint,FishingBillingInquiryFamilyProposals,type FishingFamilyProposalCommand,type FishingInquiryFamilyProposalRow,type FishingInquiryNativeFingerprintInput} from '../../src/lib/fishing-billing-inquiry-family-proposal.ts';
vi.mock('server-only',()=>({}));

// New no-URL memory DB, real committed DDL/stores/crypto and synthetic data.
// No actual schema installation, family provisioning, guardian/recipient
// verification, legal approval, owner browser, transport or provider proof.
let engine:PGlite;
const now=new Date('2035-01-06T15:00:00Z'),clock={now:()=>new Date(now)};
const ring={activeKeyId:'synthetic',keys:{synthetic:Buffer.alloc(32,7)}};
const key='SYNTHETIC-INQUIRY-FAMILY-PROPOSAL-INTEGRITY-ONLY';
const db:IdentityStore={transaction:work=>engine.transaction(tx=>work({query:async<T extends object>(sql:string,values:readonly unknown[]=[])=>
 (await tx.query<T>(sql,[...values])).rows} as SqlSession))};
const network=vi.fn<typeof fetch>(async()=>{throw new Error('NO_NETWORK_IN_MEMORY_BINDING_TEST');});
beforeAll(async()=>{
 requirePgliteMemoryEnvironment(process.env);vi.stubGlobal('fetch',network);engine=new PGlite();
 await engine.exec('CREATE SCHEMA ls_control');
 const manifest=JSON.parse(await readFile('migrations/manifest.json','utf8')) as {name:string;sha256:string}[];
 for(const name of ['0001_ls_foundation.sql','0010_ls_identity_cases_20260906.sql','0030_ls_calendar_attendance_20260907.sql',
  '0097_ls_demo_provenance.sql','0101_ls_contact_operations.sql','0105_ls_contact_authority.sql','0110_ls_contact_outbound_projection.sql',
  '0116_ls_acquisition_candidates.sql','0124_ls_group_interest.sql','0131_ls_public_group_applications.sql',
  '0133_ls_fishing_lead_memberships.sql','0135_ls_inquiry_email_outbox.sql','0138_ls_academy_crm.sql']){
  const sql=await readFile('migrations/'+name,'utf8');
  expect(createHash('sha256').update(sql.replaceAll('\r\n','\n')).digest('hex')).toBe(manifest.find(m=>m.name===name)?.sha256);
  await engine.exec(sql);
 }
 await engine.exec('CREATE SCHEMA ls_fishing_billing');
 await engine.exec(await readFile('migrations/proposals/UNNUMBERED_ls_fishing_inquiry_family_proposals.sql','utf8'));
},20000);
afterEach(()=>{expect(globalThis.fetch).toBe(network);expect(network).not.toHaveBeenCalled();});
afterAll(async()=>{try{await engine?.close();}finally{vi.unstubAllGlobals();}});

async function fixture(admit=true){
 const workspace=asId(randomUUID(),'workspace');await engine.query('INSERT INTO ls_identity.workspaces VALUES($1,$2)',[workspace,now]);
 async function actor(role:'practitioner'|'parent'){
  const id=asId(randomUUID(),'account'),personId=asId(randomUUID(),'person'),token=Buffer.alloc(32,role==='parent'?2:1).toString('base64url');
  await engine.query("INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,'adult',$3,$4)",[personId,workspace,seal(JSON.stringify({displayName:'SYNTHETIC '+role}),`person:${workspace}:${personId}`,ring),now]);
  await engine.query("INSERT INTO ls_identity.accounts(id,workspace_id,role,state,locale,email_blind,email_ciphertext,email_verified_at,password_hash,created_at,updated_at) VALUES($1,$2,$3,'active','en',$4,'SYNTHETIC',$5,'SYNTHETIC',$5,$5)",[id,workspace,role,createHash('sha256').update(id).digest('hex'),now]);
  await engine.query('INSERT INTO ls_identity.account_subjects VALUES($1,$2,$3)',[workspace,id,personId]);
  const digest=createHash('sha256').update(workspace+token).digest('hex');
  await engine.query('INSERT INTO ls_identity.sessions(token_digest,workspace_id,account_id,created_at,expires_at) VALUES($1,$2,$3,$4,$5)',[digest,workspace,id,now,new Date('2036-01-01T00:00:00Z')]);
  return {id,workspaceId:workspace,personId,role,state:'active',locale:'en',sessionDigest:digest,expiresAt:Date.parse('2036-01-01T00:00:00Z')} as Actor;
 }
 const owner=await actor('practitioner'),parent=await actor('parent'),cutover=new ContactCutoverStore(db,ring,key,clock);
 await cutover.initializeAcademy(owner,{operationId:randomUUID(),expectedEpoch:0,observedNativeWritesSinceSwitch:0,
  decisionId:'ACADEMY-ONLY-CRM-20261028-01',evidence:{retiredSourcesFence:'a'.repeat(64),retiredSchedulesFence:'b'.repeat(64),retainedAcademyRecords:'c'.repeat(64),queueReconciliation:'d'.repeat(64),restorePlan:'e'.repeat(64)}});
 const fields={...currentTrip390Fields(),guardianName:'SYNTHETIC Current Guardian',email:'synthetic-'+randomUUID()+'@example.invalid',
  children:[{id:randomUUID(),name:'SYNTHETIC Brother One',ageYears:11,experience:'new' as const},{id:randomUUID(),name:'SYNTHETIC Brother Two',ageYears:13,experience:'some' as const}]};
 const saved=await new PublicGroupApplicationStore(db,workspace,ring,key,clock).submit({operationId:randomUUID(),fields});
 const crm=new AcademyCrmStore(db,ring,key,clock),preview=await crm.previewInquiry(owner,saved.item.id,1);
 let guardianId:string|null=null;
 if(admit)guardianId=(await crm.execute(owner,{action:'from_inquiry',operationId:randomUUID(),expectedEpoch:1,sourceApplicationId:saved.item.id,
  sourceDigest:preview.sourceDigest,fields:{stage:'SYNTHETIC inquiry',nextAction:null,followUpDate:null,notes:''}})).personId;
 const familyId=randomUUID();await engine.query('INSERT INTO ls_cases.families VALUES($1,$2,$3,$4)',[familyId,workspace,seal('SYNTHETIC Family',`family:${workspace}:${familyId}`,ring),now]);
 if(guardianId)await engine.query("INSERT INTO ls_cases.family_members VALUES($1,$2,$3,'guardian')",[workspace,familyId,guardianId]);
 const children=[];
 for(const child of fields.children){const nativeChildId=randomUUID();
  await engine.query("INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,'minor',$3,$4)",[nativeChildId,workspace,seal(JSON.stringify({displayName:'SYNTHETIC native child'}),`person:${workspace}:${nativeChildId}`,ring),now]);
  await engine.query("INSERT INTO ls_cases.family_members VALUES($1,$2,$3,'child')",[workspace,familyId,nativeChildId]);
  children.push({applicationChildId:child.id,nativeChildId});
 }
 const selection={reference:saved.item.id,familyId,children};
 const store=(binder=db)=>new FishingBillingInquiryFamilyProposals(binder,workspace,ring,key,clock);
 const prepare=async()=>{const p=await store().preview(owner,{selection,expectedEpoch:1});return {operationId:randomUUID(),selection,expectedEpoch:1,expectedSourceDigest:p.sourceDigest,expectedNativeDigest:p.nativeDigest} satisfies FishingFamilyProposalCommand;};
 const source=async()=>(await engine.query<{payload_ciphertext:string}>('SELECT * FROM ls_service_interest.public_applications WHERE workspace_id=$1 AND id=$2',[workspace,saved.item.id])).rows[0]!;
 const count=async()=>(await engine.query<{n:number}>('SELECT count(*)::int AS n FROM ls_fishing_billing.inquiry_family_proposals WHERE workspace_id=$1',[workspace])).rows[0]!.n;
 const counts=async()=>(await engine.query('SELECT (SELECT count(*) FROM ls_identity.people WHERE workspace_id=$1) AS people,(SELECT count(*) FROM ls_identity.accounts WHERE workspace_id=$1) AS accounts,(SELECT count(*) FROM ls_cases.families WHERE workspace_id=$1) AS families,(SELECT count(*) FROM ls_cases.cases WHERE workspace_id=$1) AS cases,(SELECT count(*) FROM ls_service_interest.inquiry_email_outbox WHERE workspace_id=$1) AS mail,(SELECT count(*) FROM ls_contact_ops.outbound_projections WHERE workspace_id=$1) AS outbound',[workspace])).rows[0]!;
 return {workspace,owner,parent,cutover,fields,saved,crm,guardianId:guardianId!,selection,store,prepare,source,count,counts};
}
async function reloadActor(f:Awaited<ReturnType<typeof fixture>>){
 const token=randomBytes(32).toString('base64url');
 await engine.query('INSERT INTO ls_identity.sessions(token_digest,workspace_id,account_id,created_at,expires_at) VALUES($1,$2,$3,$4,$5)',[tokenDigest(token),f.workspace,f.owner.id,now,new Date('2036-01-01T00:00:00Z')]);
 const sessions=new IdentitySessions(db,{enabled:true,workspaceId:f.workspace,origin:'https://synthetic.example.invalid',keyring:ring,csrfKey:Buffer.alloc(32,8),lookupKey:Buffer.alloc(32,9),rateLimitKey:key,sessionSeconds:3600},clock);
 return sessions.actor(token);
}

async function storedProposal(f:Awaited<ReturnType<typeof fixture>>){
 return (await engine.query<FishingInquiryFamilyProposalRow>('SELECT id,application_id AS reference,family_id AS "familyId",guardian_person_id AS "guardianId",operation_id AS "operationId",recorded_by AS "recordedBy",source_digest AS "sourceDigest",native_digest AS "nativeDigest",request_digest AS "requestDigest",payload_ciphertext AS ciphertext,created_at AS "createdAt" FROM ls_fishing_billing.inquiry_family_proposals WHERE workspace_id=$1',[f.workspace])).rows[0]!;
}
function nativeInput(f:Awaited<ReturnType<typeof fixture>>,lock:'shared'|'snapshot'='snapshot'):FishingInquiryNativeFingerprintInput{
 return {workspaceId:f.workspace,selection:f.selection,guardianPersonId:f.guardianId,currentFields:f.fields,lock};
}
it('native data fingerprint reads actual current rows and detects drift without upgrading the original proposal',async()=>{
 const f=await fixture(),command=await f.prepare(),saved=await f.store().propose(f.owner,command),original=await storedProposal(f),source=await f.source(),counts=await f.counts();
 const first=await db.transaction(tx=>readFishingInquiryNativeFingerprint(tx,nativeInput(f),key));
 expect(first).toBe(command.expectedNativeDigest);
 const child=f.selection.children[0]!.nativeChildId;
 await engine.query('UPDATE ls_identity.people SET profile_ciphertext=$3 WHERE workspace_id=$1 AND id=$2',[f.workspace,child,seal('SYNTHETIC changed native profile',`person:${f.workspace}:${child}`,ring)]);
 const changed=await db.transaction(tx=>readFishingInquiryNativeFingerprint(tx,nativeInput(f),key));
 expect(changed).not.toBe(first);expect(await storedProposal(f)).toEqual(original);expect(await f.source()).toEqual(source);expect(await f.counts()).toEqual(counts);
 expect(saved.record).toMatchObject({guardianVerified:false,recipientVerified:false,financialAcceptance:false,outboundEligible:false});
 await expect(f.store().read(f.owner,{reference:f.saved.item.id,expectedEpoch:1})).rejects.toThrow('CONFLICT');
});
it('native data fingerprint pins parsed scope, mappings, fields, lock and bound TX before awaited SQL',async()=>{
 const f=await fixture(),expected=(await f.prepare()).expectedNativeDigest,input=nativeInput(f,'shared'),source=await f.source();
 let changed=false;const queries:string[]=[];
 const result=await db.transaction(async real=>{
  const mutable:SqlSession={query:async<T extends object>(sql:string,values:readonly unknown[]=[])=>{
   const rows=await real.query<T>(sql,values);queries.push(sql);
   if(sql.startsWith('SELECT f.id')){
    changed=true;input.workspaceId=asId(randomUUID(),'workspace');input.selection.familyId=randomUUID();input.guardianPersonId=f.parent.personId;
    input.selection.children[0]!.nativeChildId=randomUUID();input.currentFields.children[0]!.id=randomUUID();input.lock='snapshot';
    mutable.query=async()=>{throw new Error('MUTATED_TX_MUST_NOT_BE_USED');};
   }
   return rows;
  }};
  return readFishingInquiryNativeFingerprint(mutable,input,key);
 });
 expect(changed).toBe(true);expect(result).toBe(expected);expect(queries).toHaveLength(2);expect(queries.every(sql=>sql.includes('FOR SHARE'))).toBe(true);expect(await f.source()).toEqual(source);
});
it.each(['workspace','family','guardian'] as const)('native data fingerprint refuses unrelated %s without fabricating membership',async wrong=>{
 const f=await fixture(),input=nativeInput(f),counts=await f.counts();
 if(wrong==='workspace')input.workspaceId=asId(randomUUID(),'workspace');
 if(wrong==='family')input.selection={...input.selection,familyId:randomUUID()};
 if(wrong==='guardian')input.guardianPersonId=f.parent.personId;
 await expect(db.transaction(tx=>readFishingInquiryNativeFingerprint(tx,input,key))).rejects.toThrow('UNAVAILABLE');expect(await f.counts()).toEqual(counts);
});
it('native data fingerprint requires every current source child in the explicit native mapping',async()=>{
 const f=await fixture(),input=nativeInput(f);input.selection={...input.selection,children:input.selection.children.slice(0,1)};
 await expect(db.transaction(tx=>readFishingInquiryNativeFingerprint(tx,input,key))).rejects.toThrow('CONFLICT');
});
it('native data fingerprint rejects a historical source tuple instead of using it as current input',async()=>{
 const f=await fixture(),input=nativeInput(f);
 const historical={...input,currentFields:{...input.currentFields,version:TRIP390_V1_INTEREST_VERSION}} as unknown as FishingInquiryNativeFingerprintInput;
 await expect(db.transaction(tx=>readFishingInquiryNativeFingerprint(tx,historical,key))).rejects.toThrow('INVALID_REQUEST');
});
it('native data snapshot runs in actual READ ONLY while shared row locking is denied there',async()=>{
 const f=await fixture(),expected=(await f.prepare()).expectedNativeDigest,counts=await f.counts();
 expect(await db.transaction(async tx=>{await tx.query('SET TRANSACTION READ ONLY');return readFishingInquiryNativeFingerprint(tx,nativeInput(f),key);})).toBe(expected);
 await expect(db.transaction(async tx=>{await tx.query('SET TRANSACTION READ ONLY');return readFishingInquiryNativeFingerprint(tx,nativeInput(f,'shared'),key);})).rejects.toMatchObject({code:'25006'});
 expect(await f.counts()).toEqual(counts);
});
it('pure integrity decoder authenticates the actual stored proposal without granting authority or changing records',async()=>{
 const f=await fixture(),saved=await f.store().propose(f.owner,await f.prepare()),row=await storedProposal(f),source=await f.source(),counts=await f.counts();
 const context={workspaceId:f.workspace,keyring:ring,integrityKey:key},decoded=decodeFishingInquiryFamilyProposalRecord(row,context);
 expect(decoded).toEqual(saved.record);expect(decoded).toMatchObject({state:'proposed',guardianVerified:false,recipientVerified:false,financialAcceptance:false,outboundEligible:false});
 // Integrity decoding remains possible after session revocation; the actual
 // current-authority reader still denies that same owner. These are different.
 await engine.query('UPDATE ls_identity.sessions SET revoked_at=$2 WHERE token_digest=$1',[f.owner.sessionDigest,now]);
 expect(decodeFishingInquiryFamilyProposalRecord(row,context)).toEqual(saved.record);
 await expect(f.store().read(f.owner,{reference:f.saved.item.id,expectedEpoch:1})).rejects.toThrow('UNAUTHENTICATED');
 expect(await storedProposal(f)).toEqual(row);expect(await f.source()).toEqual(source);expect(await f.counts()).toEqual(counts);
});
it.each(['workspace','keyring','integrityKey'] as const)('pure integrity decoder rejects wrong %s binding',async binding=>{
 const f=await fixture();await f.store().propose(f.owner,await f.prepare());const row=await storedProposal(f);
 const context={workspaceId:binding==='workspace'?asId(randomUUID(),'workspace'):f.workspace,
  keyring:binding==='keyring'?{activeKeyId:'synthetic',keys:{synthetic:Buffer.alloc(32,9)}}:ring,
  integrityKey:binding==='integrityKey'?'SYNTHETIC-WRONG-INTEGRITY-KEY':key};
 expect(()=>decodeFishingInquiryFamilyProposalRecord(row,context)).toThrow('UNAVAILABLE');
});
it.each(['recordedBy','requestDigest','createdAt'] as const)('pure integrity decoder rejects changed %s metadata',async field=>{
 const f=await fixture();await f.store().propose(f.owner,await f.prepare());const row=await storedProposal(f);
 const corrupt={...row,...(field==='recordedBy'?{recordedBy:f.parent.id}:field==='requestDigest'?{requestDigest:'f'.repeat(64)}:{createdAt:new Date(now.getTime()+1)})};
 expect(()=>decodeFishingInquiryFamilyProposalRecord(corrupt,{workspaceId:f.workspace,keyring:ring,integrityKey:key})).toThrow('UNAVAILABLE');
});
it.each(['version','guardianVerified','recipientVerified','financialAcceptance','outboundEligible'] as const)('pure integrity decoder rejects authenticated but unsupported %s payload',async field=>{
 const f=await fixture(),saved=await f.store().propose(f.owner,await f.prepare()),row=await storedProposal(f);
 // Fixture-only keys can create a valid envelope; neither that envelope nor
 // recorded metadata may turn proposed association into independently approved data.
 const payload={...saved.record,[field]:field==='version'?'SYNTHETIC-UNSUPPORTED-VERSION':true};
 const corrupt={...row,ciphertext:seal(JSON.stringify(payload),`ls_fishing_billing/inquiry_family_proposal/v1/${f.workspace}/${row.id}`,ring)};
 expect(()=>decodeFishingInquiryFamilyProposalRecord(corrupt,{workspaceId:f.workspace,keyring:ring,integrityKey:key})).toThrow('UNAVAILABLE');
});

it('stores and new-session reloads a real source/native association while keeping every approval false',async()=>{
 const f=await fixture(),source=await f.source(),counts=await f.counts(),command=await f.prepare();
 const saved=await f.store().propose(f.owner,command),actor=await reloadActor(f),loaded=await f.store().read(actor,{reference:f.saved.item.id,expectedEpoch:1});
 expect(loaded).toEqual(saved.record);expect(loaded).toMatchObject({state:'proposed',guardianVerified:false,recipientVerified:false,financialAcceptance:false,outboundEligible:false,
  guardianPersonId:f.guardianId,messageLanguage:'he',command:{selection:f.selection},acknowledgment:{language:'en',whatsapp:false,reservationNotice:{textDigest:f.fields.acknowledgment.reservationNotice.textDigest},studentConduct:{textDigest:f.fields.acknowledgment.studentConduct.textDigest}}});
 expect(loaded.command.selection.children).toHaveLength(2);expect(await f.source()).toEqual(source);expect(await f.counts()).toEqual(counts);expect(await f.count()).toBe(1);
 const row=(await engine.query<{payload_ciphertext:string}>('SELECT payload_ciphertext FROM ls_fishing_billing.inquiry_family_proposals WHERE workspace_id=$1',[f.workspace])).rows[0]!;
 expect(row.payload_ciphertext).not.toContain(f.guardianId);expect(JSON.stringify(loaded)).not.toContain(f.fields.email);expect(source.payload_ciphertext).not.toContain('01234');
});
it('replays only the original operation and never duplicates or silently rebinds a source',async()=>{
 const f=await fixture(),command=await f.prepare(),first=await f.store().propose(f.owner,command);
 const before=(await engine.query('SELECT * FROM ls_fishing_billing.inquiry_family_proposals WHERE workspace_id=$1',[f.workspace])).rows;
 expect(await f.store().propose(f.owner,command)).toEqual({record:first.record,replayed:true});
 await expect(f.store().propose(f.owner,{...command,operationId:randomUUID()})).rejects.toThrow('CONFLICT');
 await expect(f.store().propose(f.owner,{...command,selection:{...command.selection,children:[...command.selection.children].reverse()}})).rejects.toThrow('CONFLICT');
 expect((await engine.query('SELECT * FROM ls_fishing_billing.inquiry_family_proposals WHERE workspace_id=$1',[f.workspace])).rows).toEqual(before);expect(await f.count()).toBe(1);
});
it('keeps the original authenticated author when the caller actor changes during awaited native reads',async()=>{
 const f=await fixture(),command=await f.prepare(),caller={...f.owner};let changed=0;
 const barrier:IdentityStore={transaction:work=>db.transaction(tx=>work({query:async<T extends object>(sql:string,values:readonly unknown[]=[])=>{
  const rows=await tx.query<T>(sql,values);
  if(sql.startsWith('SELECT f.id,f.label_ciphertext')){changed++;caller.id=f.parent.id;}
  return rows;
 }}))};
 const saved=await f.store(barrier).propose(caller,command);expect(changed).toBe(1);
 expect.soft(saved.record.recordedBy).toBe(f.owner.id);
 const actor=await reloadActor(f);
 await expect(f.store().read(actor,{reference:f.saved.item.id,expectedEpoch:1})).resolves.toMatchObject({id:saved.record.id,recordedBy:f.owner.id});
});
it.each(['source','native'] as const)('rejects a stale %s preview without an association write',async which=>{
 const f=await fixture(),command=await f.prepare();
 await expect(f.store().propose(f.owner,{...command,...(which==='source'?{expectedSourceDigest:'f'.repeat(64)}:{expectedNativeDigest:'f'.repeat(64)})})).rejects.toThrow('CONFLICT');expect(await f.count()).toBe(0);
});
it('requires an actual inquiry-origin Academy contact before reading native family data',async()=>{
 const f=await fixture(false);
 await expect(f.store().preview(f.owner,{selection:f.selection,expectedEpoch:1})).rejects.toThrow();expect(await f.count()).toBe(0);
});
it('does not convert a readable historical offer into a current monthly family proposal',async()=>{
 const f=await fixture(),reference=randomUUID(),fields:Trip390V1Interest={version:TRIP390_V1_INTEREST_VERSION,offerVersion:TRIP390_V1_OFFER.version,
  guardianName:'SYNTHETIC Historical Parent',email:'old-'+randomUUID()+'@example.invalid',city:'SYNTHETIC city',postalCode:'01234',
  messageLanguage:'he' as const,children:f.fields.children,
  acknowledgment:{version:TRIP390_V1_NOTICE_VERSION,language:'en' as const,conductExplained:true as const,interestPrivacySafety:true as const,whatsapp:false}};
 await engine.query('INSERT INTO ls_service_interest.public_applications(workspace_id,id,contact_digest,request_digest,payload_ciphertext,notice_version,notice_language,received_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
  [f.workspace,reference,'a'.repeat(64),groupApplicationRequestDigest(f.workspace,fields,key),seal(JSON.stringify(fields),`ls_service_interest/public_application/v1/${f.workspace}/${reference}`,ring),TRIP390_V1_NOTICE_VERSION,'en',now]);
 const p=await f.crm.previewInquiry(f.owner,reference,1);await f.crm.execute(f.owner,{action:'from_inquiry',operationId:randomUUID(),expectedEpoch:1,sourceApplicationId:reference,sourceDigest:p.sourceDigest,fields:{stage:'SYNTHETIC historical inquiry',notes:'',nextAction:null,followUpDate:null}});
 const before=(await engine.query('SELECT * FROM ls_service_interest.public_applications WHERE workspace_id=$1 AND id=$2',[f.workspace,reference])).rows;
 await expect(f.store().preview(f.owner,{expectedEpoch:1,selection:{...f.selection,reference}})).rejects.toThrow('NOT_FOUND');
 expect(await f.count()).toBe(0);expect((await engine.query('SELECT * FROM ls_service_interest.public_applications WHERE workspace_id=$1 AND id=$2',[f.workspace,reference])).rows).toEqual(before);
});
it.each(['partial','duplicate','case_alias','unrelated'] as const)('rejects %s child mappings without guessing from public names',async change=>{
 const f=await fixture(),command=await f.prepare(),children=change==='partial'?f.selection.children.slice(0,1):change==='duplicate'?[f.selection.children[0]!,f.selection.children[0]!]:change==='case_alias'?f.selection.children.map(c=>({...c,nativeChildId:f.selection.children[0]!.nativeChildId.toUpperCase()})):f.selection.children.map((c,i)=>i===0?{...c,nativeChildId:randomUUID()}:c);
 await expect(f.store().propose(f.owner,{...command,selection:{...f.selection,children}})).rejects.toThrow();expect(await f.count()).toBe(0);
});
it('requires the selected admitted adult and mapped minors to remain current native family members',async()=>{
 const f=await fixture(),command=await f.prepare();
 await engine.query('DELETE FROM ls_cases.family_members WHERE workspace_id=$1 AND family_id=$2 AND person_id=$3',[f.workspace,f.selection.familyId,f.guardianId]);
 await expect(f.store().propose(f.owner,command)).rejects.toThrow('UNAVAILABLE');expect(await f.count()).toBe(0);
});
it('detects native profile drift and withdrawn child membership on later readback',async()=>{
 const f=await fixture(),command=await f.prepare();await f.store().propose(f.owner,command);
 await engine.query('UPDATE ls_identity.people SET profile_ciphertext=$3 WHERE workspace_id=$1 AND id=$2',[f.workspace,f.selection.children[0]!.nativeChildId,'SYNTHETIC CHANGED NATIVE PROFILE']);
 await expect(f.store().read(f.owner,{reference:f.saved.item.id,expectedEpoch:1})).rejects.toThrow('CONFLICT');
 await engine.query('DELETE FROM ls_cases.family_members WHERE workspace_id=$1 AND family_id=$2 AND person_id=$3',[f.workspace,f.selection.familyId,f.selection.children[1]!.nativeChildId]);
 await expect(f.store().read(f.owner,{reference:f.saved.item.id,expectedEpoch:1})).rejects.toThrow('UNAVAILABLE');expect(await f.count()).toBe(1);
});
it('denies parent, wrong workspace, stale epoch and revoked owner; an independent current session still reads',async()=>{
 const f=await fixture(),command=await f.prepare();await f.store().propose(f.owner,command);const read={reference:f.saved.item.id,expectedEpoch:1};
 await expect(f.store().read(f.parent,read)).rejects.toThrow('FORBIDDEN');
 await expect(f.store().read({...f.owner,workspaceId:asId(randomUUID(),'workspace')},read)).rejects.toThrow('FORBIDDEN');
 await expect(f.store().read(f.owner,{...read,expectedEpoch:2})).rejects.toThrow('CONFLICT');
 const current=await reloadActor(f);await engine.query('UPDATE ls_identity.sessions SET revoked_at=$2 WHERE token_digest=$1',[f.owner.sessionDigest,now]);
 await expect(f.store().read(f.owner,read)).rejects.toThrow('UNAUTHENTICATED');expect((await f.store().read(current,read)).id).toBeDefined();
});
it('rolls back the proposal when current owner authority is lost after its actual insertion',async()=>{
 const f=await fixture(),command=await f.prepare();let inserted=0;
 const barrier:IdentityStore={transaction:work=>db.transaction(tx=>work({query:async<T extends object>(sql:string,values:readonly unknown[]=[])=>{
  const rows=await tx.query<T>(sql,values);if(sql.startsWith('INSERT INTO ls_fishing_billing.inquiry_family_proposals')){inserted++;await tx.query('UPDATE ls_identity.sessions SET revoked_at=$2 WHERE token_digest=$1',[f.owner.sessionDigest,now]);}return rows;
 }}))};
 const before=await f.cutover.read(f.owner);
 await expect(f.store(barrier).propose(f.owner,command)).rejects.toThrow('UNAUTHENTICATED');expect(inserted).toBe(1);expect(await f.count()).toBe(0);expect(await f.cutover.read(f.owner)).toEqual(before);
});
it.each(['familyId','sourceDigest','ciphertext'] as const)('authenticates stored %s metadata against the sealed proposal',async key=>{
 const f=await fixture(),command=await f.prepare();await f.store().propose(f.owner,command);
 const corrupt:IdentityStore={transaction:work=>db.transaction(tx=>work({query:async<T extends object>(sql:string,values:readonly unknown[]=[])=>{
  const rows=await tx.query<T>(sql,values);return sql.includes('payload_ciphertext AS ciphertext')&&sql.includes('FROM ls_fishing_billing.inquiry_family_proposals')?rows.map(r=>({...r,[key]:key==='familyId'?randomUUID():key==='sourceDigest'?'f'.repeat(64):'SYNTHETIC CORRUPTION'})):rows;
 }}))};
 await expect(f.store(corrupt).read(f.owner,{reference:f.saved.item.id,expectedEpoch:1})).rejects.toThrow('UNAVAILABLE');expect(await f.count()).toBe(1);
});
it('keeps the proposal and original source append-only with no update, delete or truncate path',async()=>{
 const f=await fixture(),command=await f.prepare();await f.store().propose(f.owner,command);
 await expect(engine.query('UPDATE ls_fishing_billing.inquiry_family_proposals SET source_digest=$2 WHERE workspace_id=$1',[f.workspace,'f'.repeat(64)])).rejects.toThrow('FISHING_INQUIRY_FAMILY_PROPOSAL_IMMUTABLE');
 await expect(engine.query('DELETE FROM ls_fishing_billing.inquiry_family_proposals WHERE workspace_id=$1',[f.workspace])).rejects.toThrow('FISHING_INQUIRY_FAMILY_PROPOSAL_IMMUTABLE');
 await expect(engine.exec('TRUNCATE ls_fishing_billing.inquiry_family_proposals')).rejects.toThrow('FISHING_INQUIRY_FAMILY_PROPOSAL_IMMUTABLE');
 await expect(engine.query("UPDATE ls_service_interest.public_applications SET notice_language='he' WHERE workspace_id=$1",[f.workspace])).rejects.toThrow('public_group_application_append_only');expect(await f.count()).toBe(1);
});
