import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {beforeAll,afterAll,afterEach,it,expect,vi} from 'vitest';
import {requirePgliteMemoryEnvironment} from '../fixtures/pglite-memory-environment.ts';
import {currentTrip390Fields} from '../fixtures/trip390-current.ts';
import {asId} from '../../src/lib/ids.ts';
import {seal,unseal,tokenDigest} from '../../src/features/identity/crypto.ts';
import {NATIVE_FAMILY_VERSION,type NativeFamilyCreateCommand} from '../../src/features/fishing-billing/native-family-contract-v1.ts';
import type {Actor} from '../../src/features/identity/types.ts';
import type {IdentityStore,SqlSession} from '../../src/features/identity/store.ts';
import {lockWorkspace} from '../../src/features/identity/data.ts';
import {IdentitySessions} from '../../src/features/identity/session-adapter.ts';
import {PostgresIdentityRateStore} from '../../src/features/identity/rate-store.ts';
import {SESSION_COOKIE} from '../../src/lib/security/session.ts';
import {AppError} from '../../src/lib/errors.ts';
import {ContactCutoverStore} from '../../src/features/contact-ops/server/cutover-store.ts';
import {AcademyCrmStore} from '../../src/features/contact-ops/server/academy-crm-store.ts';
import {PublicGroupApplicationStore} from '../../src/features/group-application/store.ts';
import {groupApplicationRequestDigest} from '../../src/features/group-application/group-application-record.ts';
import {TRIP390_V1_INTEREST_VERSION,TRIP390_V1_NOTICE_VERSION,TRIP390_V1_OFFER,type Trip390V1Interest} from '../../src/features/group-application/academy-trip390-v1.ts';
import {decodeFishingInquiryFamilyProposalRecord,readFishingInquiryNativeFingerprint,FishingBillingInquiryFamilyProposals,fishingInquiryFamilyProposalSchema,fishingInquiryFamilyProposalPreviewSchema,type FishingFamilyProposalCommand,type FishingInquiryFamilyProposalRow,type FishingInquiryNativeFingerprintInput,type FishingCurrentFamilyDataInput} from '../../src/lib/fishing-billing-inquiry-family-proposal.ts';
import {fishingInquiryFamilyProposalOwnerHttp,FISHING_INQUIRY_FAMILY_PROPOSAL_OWNER_PATH} from '../../src/lib/fishing-billing-inquiry-family-proposal-owner-http.ts';
import {composeFishingInquiryFamilyProposalOwnerRuntime} from '../../src/lib/fishing-billing-inquiry-family-proposal-runtime.ts';
vi.mock('server-only',()=>({}));

// New no-URL memory DB, real committed DDL/stores/crypto and synthetic data.
// No production schema installation, family provisioning, guardian/recipient
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
 await engine.exec(await readFile('tests/fixtures/fishing-billing.sql','utf8'));
 await engine.exec(await readFile('migrations/proposals/UNNUMBERED_ls_fishing_inquiry_family_proposals.sql','utf8'));
},20000);
afterEach(()=>{expect(globalThis.fetch).toBe(network);expect(network).not.toHaveBeenCalled();});
afterAll(async()=>{try{await engine?.close();}finally{vi.unstubAllGlobals();}});

async function fixture(admit=true,integrityKey=key){
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
 const owner=await actor('practitioner'),parent=await actor('parent'),cutover=new ContactCutoverStore(db,ring,integrityKey,clock);
 await cutover.initializeAcademy(owner,{operationId:randomUUID(),expectedEpoch:0,observedNativeWritesSinceSwitch:0,
  decisionId:'ACADEMY-ONLY-CRM-20261028-01',evidence:{retiredSourcesFence:'a'.repeat(64),retiredSchedulesFence:'b'.repeat(64),retainedAcademyRecords:'c'.repeat(64),queueReconciliation:'d'.repeat(64),restorePlan:'e'.repeat(64)}});
 const fields={...currentTrip390Fields(),guardianName:'SYNTHETIC Current Guardian',email:'synthetic-'+randomUUID()+'@example.invalid',
  children:[{id:randomUUID(),name:'SYNTHETIC Brother One',ageYears:11,experience:'new' as const},{id:randomUUID(),name:'SYNTHETIC Brother Two',ageYears:13,experience:'some' as const}]};
 const saved=await new PublicGroupApplicationStore(db,workspace,ring,integrityKey,clock).submit({operationId:randomUUID(),fields});
 const crm=new AcademyCrmStore(db,ring,integrityKey,clock),preview=await crm.previewInquiry(owner,saved.item.id,1);
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
 const store=(binder=db)=>new FishingBillingInquiryFamilyProposals(binder,workspace,ring,integrityKey,clock);
 const prepare=async()=>{const p=await store().preview(owner,{selection,expectedEpoch:1});return {operationId:randomUUID(),selection,expectedEpoch:1,expectedSourceDigest:p.sourceDigest,expectedNativeDigest:p.nativeDigest} satisfies FishingFamilyProposalCommand;};
 const source=async()=>(await engine.query<{payload_ciphertext:string}>('SELECT * FROM ls_service_interest.public_applications WHERE workspace_id=$1 AND id=$2',[workspace,saved.item.id])).rows[0]!;
 const count=async()=>(await engine.query<{n:number}>('SELECT count(*)::int AS n FROM ls_fishing_billing.inquiry_family_proposals WHERE workspace_id=$1',[workspace])).rows[0]!.n;
 const counts=async()=>(await engine.query<Record<'people'|'accounts'|'families'|'cases'|'mail'|'outbound',string|number>>('SELECT (SELECT count(*) FROM ls_identity.people WHERE workspace_id=$1) AS people,(SELECT count(*) FROM ls_identity.accounts WHERE workspace_id=$1) AS accounts,(SELECT count(*) FROM ls_cases.families WHERE workspace_id=$1) AS families,(SELECT count(*) FROM ls_cases.cases WHERE workspace_id=$1) AS cases,(SELECT count(*) FROM ls_service_interest.inquiry_email_outbox WHERE workspace_id=$1) AS mail,(SELECT count(*) FROM ls_contact_ops.outbound_projections WHERE workspace_id=$1) AS outbound',[workspace])).rows[0]!;
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
function familyDataInput(f:Awaited<ReturnType<typeof fixture>>,proposalId:string,lock:'shared'|'snapshot'='snapshot'):FishingCurrentFamilyDataInput{
 return {proposalId,reference:f.saved.item.id,expectedEpoch:1,lock};
}
const ownerHttpOrigin='https://synthetic.example.invalid';
async function ownerHttpHarness(f:Awaited<ReturnType<typeof fixture>>,actor=f.owner,sessionStore=db,store=f.store()){
 const token=randomBytes(32).toString('base64url');
 await engine.query('INSERT INTO ls_identity.sessions(token_digest,workspace_id,account_id,created_at,expires_at) VALUES($1,$2,$3,$4,$5)',[tokenDigest(token),f.workspace,actor.id,now,new Date('2036-01-01T00:00:00Z')]);
 const sessions=new IdentitySessions(sessionStore,{enabled:true,workspaceId:f.workspace,origin:ownerHttpOrigin,keyring:ring,csrfKey:Buffer.alloc(32,8),lookupKey:Buffer.alloc(32,9),rateLimitKey:key,sessionSeconds:3600},clock);
 const limits=new PostgresIdentityRateStore(db);
 const call=(body:unknown,options:{method?:string;query?:string;path?:string;headers?:Record<string,string>;bodyText?:string}={})=>{
  const host=new URL(ownerHttpOrigin).host;
  const method=options.method??'POST',headers={host,'x-forwarded-host':host,'x-forwarded-proto':'https',cookie:`${SESSION_COOKIE}=${token}`,origin:ownerHttpOrigin,'sec-fetch-site':'same-origin','x-csrf-token':sessions.csrf(token),'content-type':'application/json',...options.headers};
  const request=new Request(ownerHttpOrigin+(options.path??FISHING_INQUIRY_FAMILY_PROPOSAL_OWNER_PATH)+(options.query??''),{method,headers,
   ...(['GET','HEAD'].includes(method)?{}:{body:options.bodyText??JSON.stringify(body)})});
  return fishingInquiryFamilyProposalOwnerHttp(request,async()=>({origin:ownerHttpOrigin,sessions,limits,rateLimitKey:key,store}));
 };
 return {token,sessions,call};
}
async function ownerHttpCommand(f:Awaited<ReturnType<typeof fixture>>,http:Awaited<ReturnType<typeof ownerHttpHarness>>){
 const response=await http.call({action:'preview',expectedEpoch:1,selection:f.selection});expect(response.status).toBe(200);
 const body=await response.json();expect(body.ok).toBe(true);expect(body.data.kind).toBe('preview');
 const p=fishingInquiryFamilyProposalPreviewSchema.parse(body.data.preview);
 expect(p).toMatchObject({selection:f.selection,guardianPersonId:f.guardianId,messageLanguage:'he',state:'proposed',guardianVerified:false,recipientVerified:false,financialAcceptance:false,outboundEligible:false});
 return {operationId:randomUUID(),expectedEpoch:1,selection:p.selection,expectedSourceDigest:p.sourceDigest,expectedNativeDigest:p.nativeDigest} satisfies FishingFamilyProposalCommand;
}
it('owner proposal HTTP saves after real-session preview and reloads through a new real session without changing source or authority',async()=>{
 const f=await fixture(),http=await ownerHttpHarness(f),source=await f.source(),counts=await f.counts();
 const missing=await http.call(null,{method:'GET',query:`?reference=${f.saved.item.id}&expectedEpoch=1`});expect(missing.status).toBe(404);
 const command=await ownerHttpCommand(f,http),response=await http.call({action:'propose',command});expect(response.status).toBe(200);
 const saved=await response.json(),record=fishingInquiryFamilyProposalSchema.parse(saved.data.record);
 expect(saved).toMatchObject({ok:true,data:{kind:'proposed',replayed:false}});expect(record.command).toEqual(command);expect(record.recordedBy).toBe(f.owner.id);
 const reloaded=await ownerHttpHarness(f),get=await reloaded.call(null,{method:'GET',query:`?reference=${f.saved.item.id}&expectedEpoch=1`});expect(get.status).toBe(200);
 expect((await get.json()).data).toMatchObject({kind:'proposal',record});
 expect(record.command.selection.children).toHaveLength(2);expect(record).toMatchObject({messageLanguage:'he',acknowledgment:{language:'en',whatsapp:false},guardianVerified:false,recipientVerified:false,financialAcceptance:false,outboundEligible:false});
 for(const r of [response,get]){expect(r.headers.get('Cache-Control')).toBe('private, no-store');expect(r.headers.get('Vary')).toBe('Cookie');expect(r.headers.get('Referrer-Policy')).toBe('no-referrer');expect(r.headers.get('Content-Security-Policy')).toContain("default-src 'none'");}
 expect(await f.source()).toEqual(source);expect(await f.counts()).toEqual(counts);expect(await f.count()).toBe(1);
});
it('owner proposal HTTP exact retries retain the original proposal and conflicting retries do not duplicate or change the counter',async()=>{
 const f=await fixture(),http=await ownerHttpHarness(f),command=await ownerHttpCommand(f,http);
 const first=await http.call({action:'propose',command});expect(first.status).toBe(200);const saved=await first.json(),row=await storedProposal(f),state=await f.cutover.read(f.owner);
 const replay=await http.call({action:'propose',command});expect(replay.status).toBe(200);expect((await replay.json()).data).toMatchObject({replayed:true,record:saved.data.record});
 // The proposal replay preserves its row; the existing write-intent wrapper
 // still advances its native counter. Conflicts must roll back their own TX.
 const replayState=await f.cutover.read(f.owner);expect(replayState.nativeWritesSinceSwitch).toBe(state.nativeWritesSinceSwitch+1);
 const conflict=await http.call({action:'propose',command:{...command,operationId:randomUUID()}});expect(conflict.status).toBe(503);expect((await conflict.json()).error.code).toBe('UNAVAILABLE');
 expect(await storedProposal(f)).toEqual(row);expect(await f.count()).toBe(1);expect(await f.cutover.read(f.owner)).toEqual(replayState);
});
it.each(['CONFLICT','INVALID_REQUEST','FORBIDDEN','UNAUTHENTICATED'] as const)('owner proposal HTTP post-COMMIT %s remains uncertain with durable fresh-session recovery',async code=>{
 const f=await fixture(),preview=await ownerHttpHarness(f),command=await ownerHttpCommand(f,preview),source=await f.source();let committed=0;
 const afterCommit:IdentityStore={transaction:async work=>{await db.transaction(work);committed++;throw new AppError(code);}};
 const http=await ownerHttpHarness(f,f.owner,db,f.store(afterCommit)),response=await http.call({action:'propose',command});
 // Establish the actual committed row, independent new-session readback and
 // duplicate-safe original-command replay BEFORE asserting error classification.
 expect(committed).toBe(1);expect(await f.count()).toBe(1);const original=await storedProposal(f),fresh=await ownerHttpHarness(f);
 const read=await fresh.call(null,{method:'GET',query:`?reference=${f.saved.item.id}&expectedEpoch=1`});expect(read.status).toBe(200);
 const saved=fishingInquiryFamilyProposalSchema.parse((await read.json()).data.record);expect(saved.id).toBe(original.id);expect(saved.command).toEqual(command);
 const replay=await fresh.call({action:'propose',command});expect(replay.status).toBe(200);expect((await replay.json()).data).toMatchObject({replayed:true,record:saved});
 expect(await f.count()).toBe(1);expect(await storedProposal(f)).toEqual(original);expect(await f.source()).toEqual(source);
 expect(response.status).toBe(503);expect((await response.json()).error.code).toBe('UNAVAILABLE');
});
it.each(['missing','malformed','duplicate'] as const)('owner proposal HTTP rejects %s session cookies without a proposal',async kind=>{
 const f=await fixture(),http=await ownerHttpHarness(f),state=await f.cutover.read(f.owner);
 const cookie=kind==='missing'?'':kind==='malformed'?`${SESSION_COOKIE}=invalid`:`${SESSION_COOKIE}=${http.token}; ${SESSION_COOKIE}=${http.token}`;
 const response=await http.call({action:'preview',expectedEpoch:1,selection:f.selection},{headers:{cookie}});
 expect(response.status).toBe(401);expect(await f.count()).toBe(0);expect(await f.cutover.read(f.owner)).toEqual(state);
});
it('owner proposal HTTP rejects an actual parent session without assuming guardian authority',async()=>{
 const f=await fixture(),http=await ownerHttpHarness(f,f.parent),response=await http.call({action:'preview',expectedEpoch:1,selection:f.selection});
 expect(response.status).toBe(403);expect(await f.count()).toBe(0);expect(JSON.stringify(await response.json())).not.toContain(f.fields.email);
});
it('owner proposal HTTP reports store-stage session loss as uncertain after actual actor loading',async()=>{
 const f=await fixture(),command=await f.prepare(),state=await f.cutover.read(f.owner);let digest='',revoked=false;
 const sessionStore:IdentityStore={transaction:work=>db.transaction(real=>work({query:async<T extends object>(sql:string,values:readonly unknown[]=[])=>{
  const rows=await real.query<T>(sql,values);
  if(!revoked&&sql.includes('FROM ls_identity.accounts a')&&digest){revoked=true;await real.query('UPDATE ls_identity.sessions SET revoked_at=$2 WHERE token_digest=$1',[digest,now]);}
  return rows;
 }}))};
 const http=await ownerHttpHarness(f,f.owner,sessionStore);digest=tokenDigest(http.token);
 const response=await http.call({action:'propose',command});expect(revoked).toBe(true);expect(response.status).toBe(503);expect((await response.json()).error.code).toBe('UNAVAILABLE');expect(await f.count()).toBe(0);expect(await f.cutover.read(f.owner)).toEqual(state);
});
it('owner proposal HTTP definitively denies a real revoked session before proposal invocation',async()=>{
 const f=await fixture(),http=await ownerHttpHarness(f),command=await f.prepare(),state=await f.cutover.read(f.owner);
 await engine.query('UPDATE ls_identity.sessions SET revoked_at=$2 WHERE token_digest=$1',[tokenDigest(http.token),now]);
 const response=await http.call({action:'propose',command});expect(response.status).toBe(401);expect((await response.json()).error.code).toBe('UNAUTHENTICATED');
 expect(await f.count()).toBe(0);expect(await f.cutover.read(f.owner)).toEqual(state);
});
it.each(['foreign_origin','bad_csrf','cross_site'] as const)('owner proposal HTTP blocks %s mutation requests',async bad=>{
 const f=await fixture(),http=await ownerHttpHarness(f),command=await f.prepare(),state=await f.cutover.read(f.owner);
 const headers:Record<string,string>=bad==='foreign_origin'?{origin:'https://other.example.invalid'}:bad==='bad_csrf'?{'x-csrf-token':Buffer.alloc(32,4).toString('base64url')}:{'sec-fetch-site':'cross-site'};
 const response=await http.call({action:'propose',command},{headers});expect(response.status).toBe(403);expect(await f.count()).toBe(0);expect(await f.cutover.read(f.owner)).toEqual(state);
});
it.each(['body_actor','actor_free_action','post_query','duplicate_get','wrong_path','wrong_media','oversized'] as const)('owner proposal HTTP rejects %s without a business write',async bad=>{
 const f=await fixture(),http=await ownerHttpHarness(f),state=await f.cutover.read(f.owner),body={action:'preview',expectedEpoch:1,selection:f.selection};
 const response=bad==='body_actor'?await http.call({...body,actor:f.owner}):bad==='actor_free_action'?await http.call({action:'readCurrentDataInTransaction',proposalId:randomUUID()}):
  bad==='post_query'?await http.call(body,{query:'?unused=1'}):bad==='duplicate_get'?await http.call(null,{method:'GET',query:`?reference=${f.saved.item.id}&reference=${f.saved.item.id}&expectedEpoch=1`}):
  bad==='wrong_path'?await http.call(body,{path:'/api/private/other-proposals'}):bad==='wrong_media'?await http.call(body,{headers:{'content-type':'text/plain'}}):await http.call(body,{bodyText:JSON.stringify({padding:'x'.repeat(20000)})});
 expect(response.status).toBe(bad==='wrong_path'?404:bad==='wrong_media'?415:bad==='oversized'?413:400);expect(await f.count()).toBe(0);expect(await f.cutover.read(f.owner)).toEqual(state);
});
it('owner proposal HTTP fails closed for an actual different-workspace store',async()=>{
 const f=await fixture(),other=await fixture(),http=await ownerHttpHarness(f,f.owner,db,other.store()),response=await http.call({action:'preview',expectedEpoch:1,selection:f.selection});
 expect(response.status).toBe(403);expect(await f.count()).toBe(0);expect(await other.count()).toBe(0);
});
it.each(['missing_protocol','spoofed_host','multiple_hosts'] as const)('owner proposal HTTP rejects untrusted forwarded %s headers',async bad=>{
 const f=await fixture(),http=await ownerHttpHarness(f),state=await f.cutover.read(f.owner);
 const headers:Record<string,string>=bad==='missing_protocol'?{'x-forwarded-proto':''}:bad==='spoofed_host'?{'x-forwarded-host':'other.example.invalid'}:{'x-forwarded-host':'synthetic.example.invalid, other.example.invalid'};
 const response=await http.call({action:'preview',expectedEpoch:1,selection:f.selection},{headers});
 expect(response.status).toBe(503);expect((await response.json()).error.code).toBe('UNAVAILABLE');expect(await f.count()).toBe(0);expect(await f.cutover.read(f.owner)).toEqual(state);
});
it('owner proposal HTTP enforces its actual atomic SQL rate counter before further source access',async()=>{
 const f=await fixture(),http=await ownerHttpHarness(f),body={action:'preview',expectedEpoch:1,selection:f.selection},state=await f.cutover.read(f.owner);
 for(let i=0;i<20;i++)expect((await http.call(body)).status).toBe(200);
 const denied=await http.call(body);expect(denied.status).toBe(429);expect(await f.count()).toBe(0);expect(await f.cutover.read(f.owner)).toEqual(state);
 const rows=(await engine.query<{count:number}>('SELECT count FROM ls_identity.rate_counters')).rows;expect(rows.some(r=>r.count===21)).toBe(true);
});
it('current family bridge joins actual inquiry, admitted contact, proposal and native data in one supplied TX without new authority',async()=>{
 const f=await fixture(),saved=await f.store().propose(f.owner,await f.prepare()),source=await f.source(),row=await storedProposal(f),counts=await f.counts(),state=await f.cutover.read(f.owner);
 let opened=0;const observed:IdentityStore={transaction:work=>{opened++;return db.transaction(work);}};
 const current=await db.transaction(async tx=>{await lockWorkspace(tx,f.workspace);return f.store(observed).readCurrentDataInTransaction(tx,familyDataInput(f,saved.record.id,'shared'));});
 expect(opened).toBe(0);expect(current).toMatchObject({classification:'current_family_data_only_not_authority',consistency:'shared',proposal:saved.record,
  nativeDigest:saved.record.command.expectedNativeDigest,inquiry:{classification:'current_scope_data_only_not_authority',authorityEpoch:1,
   sourceDigest:saved.record.command.expectedSourceDigest,contact:{personId:f.guardianId,outboundEligible:false},record:{fields:{messageLanguage:'he',acknowledgment:{language:'en',whatsapp:false}}}}});
 expect(Object.isFrozen(current)).toBe(true);expect(Object.isFrozen(current.proposal.command.selection.children)).toBe(true);expect(Object.isFrozen(current.inquiry.record.fields)).toBe(true);
 expect(Reflect.set(current.proposal,'guardianVerified',true)).toBe(false);expect(current.proposal).toMatchObject({guardianVerified:false,recipientVerified:false,financialAcceptance:false,outboundEligible:false});
 expect(await f.source()).toEqual(source);expect(await storedProposal(f)).toEqual(row);expect(await f.counts()).toEqual(counts);expect(await f.cutover.read(f.owner)).toEqual(state);
});
it.each(['proposalId','reference'] as const)('current family bridge refuses an actual other-workspace %s selector',async field=>{
 const f=await fixture(),saved=await f.store().propose(f.owner,await f.prepare()),other=await fixture(),otherSaved=await other.store().propose(other.owner,await other.prepare());
 const input=familyDataInput(f,saved.record.id);input[field]=field==='proposalId'?otherSaved.record.id:other.saved.item.id;
 await expect(db.transaction(tx=>f.store().readCurrentDataInTransaction(tx,input))).rejects.toThrow('NOT_FOUND');
});
it('current family bridge refuses old proposal bytes when actual native ciphertext changes',async()=>{
 const f=await fixture(),saved=await f.store().propose(f.owner,await f.prepare()),original=await storedProposal(f),source=await f.source(),child=f.selection.children[0]!.nativeChildId;
 await engine.query('UPDATE ls_identity.people SET profile_ciphertext=$3 WHERE workspace_id=$1 AND id=$2',[f.workspace,child,seal('SYNTHETIC changed native child',`person:${f.workspace}:${child}`,ring)]);
 await expect(db.transaction(tx=>f.store().readCurrentDataInTransaction(tx,familyDataInput(f,saved.record.id)))).rejects.toThrow('CONFLICT');
 expect(await storedProposal(f)).toEqual(original);expect(await f.source()).toEqual(source);
});
it('current family bridge authenticates the current source instead of trusting an intact proposal',async()=>{
 const f=await fixture(),saved=await f.store().propose(f.owner,await f.prepare());let nativeQueries=0;
 await expect(db.transaction(real=>f.store().readCurrentDataInTransaction({query:async<T extends object>(sql:string,values:readonly unknown[]=[])=>{
  const rows=await real.query<T>(sql,values);if(sql.startsWith('SELECT f.id'))nativeQueries++;
  return sql.includes('request_digest AS "requestDigest"')&&sql.includes('FROM ls_service_interest.public_applications')?rows.map(r=>({...r,requestDigest:'f'.repeat(64)})):rows;
 }},familyDataInput(f,saved.record.id)))).rejects.toThrow('UNAVAILABLE');
 expect(nativeQueries).toBe(0);
});
it.each(['parent_language','consent'] as const)('current family bridge rejects an authentic proposal whose %s metadata disagrees with the actual source',async change=>{
 const f=await fixture(),saved=await f.store().propose(f.owner,await f.prepare()),row=await storedProposal(f),payload=structuredClone(saved.record);
 if(change==='parent_language')payload.messageLanguage='en';else payload.acknowledgment.whatsapp=true;
 const ciphertext=seal(JSON.stringify(payload),`ls_fishing_billing/inquiry_family_proposal/v1/${f.workspace}/${row.id}`,ring);
 // This is a valid fixture-key envelope and original command HMAC. The new
 // current-source comparison must reject it, rather than a malformed fixture.
 expect(decodeFishingInquiryFamilyProposalRecord({...row,ciphertext},{workspaceId:f.workspace,keyring:ring,integrityKey:key})).toEqual(payload);
 await expect(db.transaction(real=>f.store().readCurrentDataInTransaction({query:async<T extends object>(sql:string,values:readonly unknown[]=[])=>{
  const rows=await real.query<T>(sql,values);return sql.includes('payload_ciphertext AS ciphertext')&&sql.includes('FROM ls_fishing_billing.inquiry_family_proposals')?rows.map(r=>({...r,ciphertext})):rows;
 }},familyDataInput(f,saved.record.id)))).rejects.toThrow('CONFLICT');
 expect(await storedProposal(f)).toEqual(row);
});
it('current family bridge pins selectors and bound TX through the actual current-source awaits',async()=>{
 const f=await fixture(),saved=await f.store().propose(f.owner,await f.prepare()),input=familyDataInput(f,saved.record.id,'shared');let changed=false;
 const current=await db.transaction(async real=>{
  await lockWorkspace(real,f.workspace);
  const mutable:SqlSession={query:async<T extends object>(sql:string,values:readonly unknown[]=[])=>{
   const rows=await real.query<T>(sql,values);
   if(sql.includes('pg_try_advisory_xact_lock')){
    changed=true;input.proposalId=randomUUID();input.reference=randomUUID();input.expectedEpoch=999;input.lock='snapshot';
    mutable.query=async()=>{throw new Error('CHANGED_TX_MUST_NOT_BE_USED');};
   }
   return rows;
  }};
  return f.store().readCurrentDataInTransaction(mutable,input);
 });
 expect(changed).toBe(true);expect(current.proposal).toEqual(saved.record);expect(current.consistency).toBe('shared');expect(current.inquiry.consistency).toBe('shared');
});
it('current family bridge supports genuine READ ONLY snapshots and does not turn shared locking into a read-only bypass',async()=>{
 const f=await fixture(),saved=await f.store().propose(f.owner,await f.prepare()),counts=await f.counts();
 const current=await db.transaction(async tx=>{await tx.query('SET TRANSACTION READ ONLY');return f.store().readCurrentDataInTransaction(tx,familyDataInput(f,saved.record.id));});
 expect(current.proposal).toEqual(saved.record);expect(current.consistency).toBe('snapshot');
 await expect(db.transaction(async tx=>{await tx.query('SET TRANSACTION READ ONLY');return f.store().readCurrentDataInTransaction(tx,familyDataInput(f,saved.record.id,'shared'));})).rejects.toMatchObject({code:'25006'});
 expect(await f.counts()).toEqual(counts);
});
it('current family bridge data remains separate from current owner session authority',async()=>{
 const f=await fixture(),saved=await f.store().propose(f.owner,await f.prepare());
 await engine.query('UPDATE ls_identity.sessions SET revoked_at=$2 WHERE token_digest=$1',[f.owner.sessionDigest,now]);
 const current=await db.transaction(tx=>f.store().readCurrentDataInTransaction(tx,familyDataInput(f,saved.record.id)));
 expect(current.classification).toBe('current_family_data_only_not_authority');expect(current.proposal).toMatchObject({guardianVerified:false,recipientVerified:false,financialAcceptance:false,outboundEligible:false});
 await expect(f.store().read(f.owner,{reference:f.saved.item.id,expectedEpoch:1})).rejects.toThrow('UNAUTHENTICATED');
});
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
 await expect(db.transaction(tx=>f.store().readCurrentDataInTransaction(tx,{proposalId:randomUUID(),reference,expectedEpoch:1,lock:'snapshot'}))).rejects.toThrow('NOT_FOUND');
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

async function nativeFamilyCommand(f:Awaited<ReturnType<typeof fixture>>):Promise<NativeFamilyCreateCommand>{
 const source=await f.crm.previewInquiry(f.owner,f.saved.item.id,1);
 return {version:NATIVE_FAMILY_VERSION,operationId:randomUUID(),reference:f.saved.item.id,expectedEpoch:1,
  expectedSourceDigest:source.sourceDigest,ownerReviewedMapping:true,familyId:randomUUID(),familyLabel:'SYNTHETIC Explicit New Family',
  children:f.fields.children.map(child=>({applicationChildId:child.id,nativeChildId:randomUUID()}))};
}
async function createdNativeRows(f:Awaited<ReturnType<typeof fixture>>,command:NativeFamilyCreateCommand){
 return {family:(await engine.query('SELECT id FROM ls_cases.families WHERE workspace_id=$1 AND id=$2',[f.workspace,command.familyId])).rows,
  children:(await engine.query('SELECT id FROM ls_identity.people WHERE workspace_id=$1 AND id=ANY($2::uuid[])',[f.workspace,command.children.map(c=>c.nativeChildId)])).rows,
  journal:(await engine.query('SELECT operation_id FROM ls_fishing_billing.commands WHERE workspace_id=$1 AND operation_id=$2',[f.workspace,command.operationId])).rows};
}
it('native-family-create atomically records exact siblings and original proposed association without accounts/cases/sends',async()=>{
 const f=await fixture(),command=await nativeFamilyCommand(f),before=await f.counts(),source=await f.source();command.children.reverse();
 const result=await f.store().createNativeFamily(f.owner,command),record=result.record;
 expect(result).toMatchObject({version:NATIVE_FAMILY_VERSION,resultKind:'original_creation_receipt',replayed:false});
 expect(record).toMatchObject({state:'proposed',guardianPersonId:f.guardianId,guardianVerified:false,recipientVerified:false,financialAcceptance:false,outboundEligible:false});
 expect(record.command.selection).toEqual({reference:command.reference,familyId:command.familyId,children:command.children});
 expect(record.acknowledgment.whatsapp).toBe(f.fields.acknowledgment.whatsapp);
 expect(await f.source()).toEqual(source);
 const rows=await createdNativeRows(f,command);expect(rows.family).toHaveLength(1);expect(rows.children).toHaveLength(2);expect(rows.journal).toHaveLength(1);
 for(const child of command.children){
  const raw=(await engine.query<{profile:string}>("SELECT profile_ciphertext AS profile FROM ls_identity.people WHERE workspace_id=$1 AND id=$2 AND kind='minor'",[f.workspace,child.nativeChildId])).rows[0]!;
  expect(raw.profile).not.toContain('SYNTHETIC Brother');
  expect(JSON.parse(unseal(raw.profile,`person:${f.workspace}:${child.nativeChildId}`,ring))).toEqual({displayName:f.fields.children.find(c=>c.id===child.applicationChildId)!.name});
 }
 const after=await f.counts();expect(Number(after.people)).toBe(Number(before.people)+2);expect(Number(after.families)).toBe(Number(before.families)+1);
 for(const field of ['accounts','cases','mail','outbound'] as const)expect(after[field]).toBe(before[field]);
 const loaded=await f.store().read(f.owner,{reference:command.reference,expectedEpoch:1});expect(loaded).toEqual(record);
 const data=await db.transaction(tx=>f.store().readCurrentDataInTransaction(tx,{proposalId:record.id,reference:command.reference,expectedEpoch:1,lock:'shared'}));
 expect(data.classification).toBe('current_family_data_only_not_authority');expect(data.proposal).toEqual(record);
});
it('native-family-create replays its original journal and rejects changed request or duplicate inquiry',async()=>{
 const f=await fixture(),command=await nativeFamilyCommand(f),created=await f.store().createNativeFamily(f.owner,command),before=await f.counts();
 expect(await f.store().createNativeFamily(f.owner,structuredClone(command))).toEqual({...created,replayed:true});expect(await f.counts()).toEqual(before);
 await expect(f.store().createNativeFamily(f.owner,{...command,familyLabel:'SYNTHETIC changed'})).rejects.toThrow('CONFLICT');
 const duplicate=await nativeFamilyCommand(f);await expect(f.store().createNativeFamily(f.owner,duplicate)).rejects.toThrow('CONFLICT');
 expect((await createdNativeRows(f,duplicate)).family).toHaveLength(0);expect(await f.counts()).toEqual(before);expect(await f.count()).toBe(1);
});
it('native-family-create requires affirmative explicit mapping and complete distinct native siblings',async()=>{
 const f=await fixture(),command=await nativeFamilyCommand(f),before=await f.counts();
 for(const invalid of [{...command,ownerReviewedMapping:false},{...command,eligible:true},
  {...command,children:[command.children[0],command.children[0]]},
  {...command,children:command.children.map(c=>({...c,nativeChildId:c.applicationChildId}))}])
  await expect(f.store().createNativeFamily(f.owner,invalid)).rejects.toThrow();
 await expect(f.store().createNativeFamily(f.owner,{...command,children:command.children.slice(0,1)})).rejects.toThrow('CONFLICT');
 expect(await f.counts()).toEqual(before);expect(await f.count()).toBe(0);
});
it('native-family-create never adopts an existing family or minor from matching names or supplied IDs',async()=>{
 const f=await fixture(),command=await nativeFamilyCommand(f),before=await f.counts();
 await expect(f.store().createNativeFamily(f.owner,{...command,familyId:f.selection.familyId})).rejects.toThrow('CONFLICT');
 const children=structuredClone(command.children);children[0]!.nativeChildId=f.selection.children[0]!.nativeChildId;
 await expect(f.store().createNativeFamily(f.owner,{...command,children})).rejects.toThrow('CONFLICT');
 expect(await f.counts()).toEqual(before);expect(await f.count()).toBe(0);
});
it('native-family-create denies parent, wrong workspace, stale source and stale cutover epoch',async()=>{
 const f=await fixture(),command=await nativeFamilyCommand(f),before=await f.counts();
 await expect(f.store().createNativeFamily(f.parent,command)).rejects.toThrow('FORBIDDEN');
 await expect(f.store().createNativeFamily({...f.owner,workspaceId:asId(randomUUID(),'workspace')},command)).rejects.toThrow('FORBIDDEN');
 await expect(f.store().createNativeFamily(f.owner,{...command,expectedEpoch:2})).rejects.toThrow('CONFLICT');
 await expect(f.store().createNativeFamily(f.owner,{...command,expectedSourceDigest:'f'.repeat(64)})).rejects.toThrow('CONFLICT');
 expect(await f.counts()).toEqual(before);expect(await f.count()).toBe(0);
});
it('native-family-create requires a current admitted inquiry contact and never initializes native mode',async()=>{
 const f=await fixture(false),command=await nativeFamilyCommand(f),before=await f.counts();
 await expect(f.store().createNativeFamily(f.owner,command)).rejects.toThrow('NOT_FOUND');
 expect(await f.counts()).toEqual(before);expect(await f.count()).toBe(0);
});
it('native-family-create rolls back every primitive when the second minor or final journal fails',async()=>{
 const f=await fixture(),command=await nativeFamilyCommand(f),before=await f.counts();
 for(const stage of ['second-child','journal']){
  let minors=0;
  const broken:IdentityStore={transaction:work=>db.transaction(tx=>work({query:async<T extends object>(sql:string,values:readonly unknown[]=[])=>{
   if(stage==='journal'&&sql.startsWith('INSERT INTO ls_fishing_billing.commands')||stage==='second-child'&&sql.startsWith('INSERT INTO ls_identity.people')&&++minors===2)throw Error('SYNTHETIC_FAILURE');
   return tx.query<T>(sql,values);
  }}))};
  await expect(f.store(broken).createNativeFamily(f.owner,command)).rejects.toThrow('UNAVAILABLE');
  expect(await createdNativeRows(f,command)).toEqual({family:[],children:[],journal:[]});expect(await f.count()).toBe(0);expect(await f.counts()).toEqual(before);
 }
});
it('native-family-create rolls back new family and both minors after terminal owner revocation',async()=>{
 const f=await fixture(),command=await nativeFamilyCommand(f),before=await f.counts();
 const barrier:IdentityStore={transaction:work=>db.transaction(tx=>work({query:async<T extends object>(sql:string,values:readonly unknown[]=[])=>{
  const rows=await tx.query<T>(sql,values);if(sql.startsWith('INSERT INTO ls_fishing_billing.commands'))await tx.query('UPDATE ls_identity.sessions SET revoked_at=$2 WHERE token_digest=$1',[f.owner.sessionDigest,now]);return rows;
 }}))};
 await expect(f.store(barrier).createNativeFamily(f.owner,command)).rejects.toThrow('UNAUTHENTICATED');
 expect(await createdNativeRows(f,command)).toEqual({family:[],children:[],journal:[]});expect(await f.counts()).toEqual(before);expect(await f.count()).toBe(0);
});
it('native-family-create detects a changed child fingerprint after journal insertion and rolls back all',async()=>{
 const f=await fixture(),command=await nativeFamilyCommand(f),before=await f.counts();
 const barrier:IdentityStore={transaction:work=>db.transaction(tx=>work({query:async<T extends object>(sql:string,values:readonly unknown[]=[])=>{
  const rows=await tx.query<T>(sql,values);if(sql.startsWith('INSERT INTO ls_fishing_billing.commands'))await tx.query('UPDATE ls_identity.people SET profile_ciphertext=$2 WHERE id=$1',[command.children[0]!.nativeChildId,'SYNTHETIC-CORRUPTION']);return rows;
 }}))};
 await expect(f.store(barrier).createNativeFamily(f.owner,command)).rejects.toThrow('CONFLICT');
 expect(await createdNativeRows(f,command)).toEqual({family:[],children:[],journal:[]});expect(await f.counts()).toEqual(before);expect(await f.count()).toBe(0);
});
it('native-family-create preserves uncertain committed outcome and recovers the same original operation',async()=>{
 const f=await fixture(),command=await nativeFamilyCommand(f);let lost=true;
 const uncertain:IdentityStore={transaction:async work=>{const result=await db.transaction(work);if(lost){lost=false;throw new AppError('CONFLICT');}return result;}};
 await expect(f.store(uncertain).createNativeFamily(f.owner,command)).rejects.toThrow('UNAVAILABLE');
 const before=await f.counts(),replay=await f.store().createNativeFamily(f.owner,command);
 expect(replay.replayed).toBe(true);expect(await f.counts()).toEqual(before);expect(await f.count()).toBe(1);
 expect(await createdNativeRows(f,command)).toMatchObject({family:[{id:command.familyId}],children:expect.any(Array),journal:[{operation_id:command.operationId}]});
});
it('native-family-create authenticates original journal metadata and keeps replay distinct from current mapping data',async()=>{
 const f=await fixture(),command=await nativeFamilyCommand(f),created=await f.store().createNativeFamily(f.owner,command);
 await engine.query('UPDATE ls_identity.people SET profile_ciphertext=$2 WHERE id=$1',[command.children[0]!.nativeChildId,'SYNTHETIC changed profile']);
 expect(await f.store().createNativeFamily(f.owner,command)).toEqual({...created,replayed:true});
 await expect(f.store().read(f.owner,{reference:command.reference,expectedEpoch:1})).rejects.toThrow('CONFLICT');
 await engine.query('UPDATE ls_fishing_billing.commands SET result_ciphertext=$2 WHERE workspace_id=$1 AND operation_id=$3',[f.workspace,'SYNTHETIC CORRUPTION',command.operationId]);
 await expect(f.store().createNativeFamily(f.owner,command)).rejects.toThrow('UNAVAILABLE');
});

it('owner-http-native-family: saves exact siblings and reloads through a new real owner session',async()=>{
 const f=await fixture(),command=await nativeFamilyCommand(f),source=await f.source(),before=await f.counts();
 const http=await ownerHttpHarness(f),created=await http.call({action:'create_native_family',command});
 expect(created.status).toBe(200);const body=await created.json();
 expect(body).toMatchObject({ok:true,data:{version:NATIVE_FAMILY_VERSION,kind:'native_family_created',resultKind:'original_creation_receipt',replayed:false}});
 const original=fishingInquiryFamilyProposalSchema.parse(body.data.record);
 expect(original.command.selection).toEqual({reference:command.reference,familyId:command.familyId,children:command.children});
 expect(original).toMatchObject({guardianVerified:false,recipientVerified:false,financialAcceptance:false,outboundEligible:false});
 const saved=await createdNativeRows(f,command);expect(saved.family).toHaveLength(1);expect(saved.children).toHaveLength(2);expect(saved.journal).toHaveLength(1);
 const fresh=await ownerHttpHarness(f),loaded=await fresh.call(null,{method:'GET',query:'?'+new URLSearchParams({reference:command.reference,expectedEpoch:'1'})});
 expect(loaded.status).toBe(200);expect((await loaded.json()).data.record).toEqual(original);
 expect((await (await fresh.call({action:'create_native_family',command})).json()).data).toMatchObject({replayed:true,record:original});
 expect(await createdNativeRows(f,command)).toEqual(saved);expect(await f.source()).toEqual(source);
 const after=await f.counts();for(const field of ['accounts','cases','mail','outbound']as const)expect(after[field]).toBe(before[field]);
});

it('owner-http-native-family: a real parent session cannot create native siblings despite valid session CSRF',async()=>{
 const f=await fixture(),command=await nativeFamilyCommand(f),before=await f.counts(),parent=await ownerHttpHarness(f,f.parent);
 const response=await parent.call({action:'create_native_family',command});
 expect(response.status).toBe(403);expect(await response.json()).toMatchObject({ok:false,error:{code:'FORBIDDEN'}});
 expect(await createdNativeRows(f,command)).toEqual({family:[],children:[],journal:[]});expect(await f.counts()).toEqual(before);
});

it('owner-http-native-family: a lost committed result recovers only the original operation without duplicate records',async()=>{
 const f=await fixture(),command=await nativeFamilyCommand(f);let lost=true;
 const uncertain:IdentityStore={transaction:async work=>{const result=await db.transaction(work);if(lost){lost=false;throw new AppError('CONFLICT');}return result;}};
 const first=await ownerHttpHarness(f,f.owner,db,f.store(uncertain)),response=await first.call({action:'create_native_family',command});
 expect(response.status).toBe(503);expect(await response.json()).toMatchObject({ok:false,error:{code:'UNAVAILABLE'}});
 const committed=await createdNativeRows(f,command),before=await f.counts();
 expect(committed.family).toHaveLength(1);expect(committed.children).toHaveLength(2);expect(committed.journal).toHaveLength(1);
 const fresh=await ownerHttpHarness(f),retry=await fresh.call({action:'create_native_family',command});
 expect(retry.status).toBe(200);expect((await retry.json()).data).toMatchObject({resultKind:'original_creation_receipt',replayed:true});
 expect(await createdNativeRows(f,command)).toEqual(committed);expect(await f.counts()).toEqual(before);
});

// Exercise the actual mounted compositor, real sessions/CSRF/rate store and
// committed native schema. No actor or native family store is stubbed.
const runtimeLookupKey=Buffer.alloc(32,9);
async function composedOwnerHarness(f:Awaited<ReturnType<typeof fixture>>,env:Readonly<Record<string,string|undefined>>,binder=db){
 const token=randomBytes(32).toString('base64url');
 await engine.query('INSERT INTO ls_identity.sessions(token_digest,workspace_id,account_id,created_at,expires_at) VALUES($1,$2,$3,$4,$5)',[tokenDigest(token),f.workspace,f.owner.id,now,new Date('2036-01-01T00:00:00Z')]);
 const config={enabled:true,workspaceId:f.workspace,origin:ownerHttpOrigin,keyring:ring,csrfKey:Buffer.alloc(32,8),lookupKey:runtimeLookupKey,rateLimitKey:key,sessionSeconds:3600};
 const sessions=new IdentitySessions(db,config,clock),limits=new PostgresIdentityRateStore(db);
 const runtime={config,services:{sessions,limits},store:binder,clock};
 const call=(body:unknown,query?:string)=>{
  const host=new URL(ownerHttpOrigin).host;
  const request=new Request(ownerHttpOrigin+FISHING_INQUIRY_FAMILY_PROPOSAL_OWNER_PATH+(query??''),{method:query?'GET':'POST',
   headers:{host,'x-forwarded-host':host,'x-forwarded-proto':'https',cookie:`${SESSION_COOKIE}=${token}`,origin:ownerHttpOrigin,'sec-fetch-site':'same-origin','x-csrf-token':sessions.csrf(token),'content-type':'application/json'},
   ...(query?{}:{body:JSON.stringify(body)})});
  return fishingInquiryFamilyProposalOwnerHttp(request,async()=>composeFishingInquiryFamilyProposalOwnerRuntime(runtime,env));
 };
 return {token,call,runtime};
}
async function markDemo(tx:SqlSession,f:Awaited<ReturnType<typeof fixture>>){
 await tx.query('INSERT INTO ls_demo.batches(workspace_id,batch_id,created_by) VALUES($1,$2,$3)',[f.workspace,'ls-owner-20350106',f.owner.id]);
 await tx.query('INSERT INTO ls_demo.accounts(workspace_id,account_id,batch_id,source_key) VALUES($1,$2,$3,$4)',[f.workspace,f.owner.id,'ls-owner-20350106','SYNTHETIC-owner-denial']);
}
it.each(['missing','other-owner','demo'] as const)('mounted-owner-boundary: %s binding cannot read PII or create native children',async kind=>{
 const f=await fixture(true,runtimeLookupKey.toString('hex')),command=await nativeFamilyCommand(f),before=await f.counts();
 const env=kind==='missing'?{}:{LS_PROVIDER_INDEX_OWNER_ACCOUNT_ID:kind==='other-owner'?randomUUID():f.owner.id};
 if(kind==='demo')await db.transaction(tx=>markDemo(tx,f));
 const http=await composedOwnerHarness(f,env);
 const preview=await http.call({action:'preview',expectedEpoch:1,selection:f.selection});
 const create=await http.call({action:'create_native_family',command});
 expect(preview.status).toBe(kind==='missing'?503:403);expect(create.status).toBe(kind==='missing'?503:403);
 for(const response of [preview,create])expect(JSON.stringify(await response.json())).not.toContain(f.fields.email);
 expect(await createdNativeRows(f,command)).toEqual({family:[],children:[],journal:[]});expect(await f.counts()).toEqual(before);
});
it('mounted-owner-boundary: configured native owner preserves read-only preview, exact siblings, new-session read and retry',async()=>{
 const f=await fixture(true,runtimeLookupKey.toString('hex')),command=await nativeFamilyCommand(f),before=await f.counts(),env={LS_PROVIDER_INDEX_OWNER_ACCOUNT_ID:f.owner.id};
 const http=await composedOwnerHarness(f,env),preview=await http.call({action:'preview',expectedEpoch:1,selection:f.selection});expect(preview.status).toBe(200);
 const created=await http.call({action:'create_native_family',command});expect(created.status).toBe(200);const record=(await created.json()).data.record;
 const fresh=await composedOwnerHarness(f,env),read=await fresh.call(null,'?'+new URLSearchParams({reference:command.reference,expectedEpoch:'1'}));
 expect(read.status).toBe(200);expect((await read.json()).data.record).toEqual(record);
 const retry=await fresh.call({action:'create_native_family',command});expect(retry.status).toBe(200);expect((await retry.json()).data).toMatchObject({replayed:true,record});
 const after=await f.counts();expect(Number(after.people)).toBe(Number(before.people)+2);expect(Number(after.families)).toBe(Number(before.families)+1);
 for(const field of ['accounts','cases','mail','outbound']as const)expect(after[field]).toBe(before[field]);
 expect(await f.count()).toBe(1);
});
it('mounted-owner-boundary: terminal demo admission rolls back journal, minors, family and native write counter',async()=>{
 const f=await fixture(true,runtimeLookupKey.toString('hex')),command=await nativeFamilyCommand(f),before=await f.counts(),state=await f.cutover.read(f.owner);let marked=false;
 const barrier:IdentityStore={transaction:work=>db.transaction(tx=>work({query:async<T extends object>(sql:string,values:readonly unknown[]=[])=>{
  const rows=await tx.query<T>(sql,values);if(sql.startsWith('INSERT INTO ls_fishing_billing.commands')){marked=true;await markDemo(tx,f);}return rows;
 }}))};
 const http=await composedOwnerHarness(f,{LS_PROVIDER_INDEX_OWNER_ACCOUNT_ID:f.owner.id},barrier),response=await http.call({action:'create_native_family',command});
 expect(marked).toBe(true);expect(response.status).toBe(503);expect((await response.json()).error.code).toBe('UNAVAILABLE');
 expect(await createdNativeRows(f,command)).toEqual({family:[],children:[],journal:[]});expect(await f.counts()).toEqual(before);expect(await f.cutover.read(f.owner)).toEqual(state);
 expect((await engine.query('SELECT 1 FROM ls_demo.accounts WHERE workspace_id=$1',[f.workspace])).rows).toEqual([]);
});

it('native-family-source: actual owner bootstrap supplies saved siblings and epoch without caller authority, then reloads explicit creation',async()=>{
 const f=await fixture(true,runtimeLookupKey.toString('hex')),env={LS_PROVIDER_INDEX_OWNER_ACCOUNT_ID:f.owner.id},h=await composedOwnerHarness(f,env);
 const query='?'+new URLSearchParams({kind:'source',reference:f.saved.item.id});
 const initial=await h.call(null,query);expect(initial.status).toBe(200);const source=(await initial.json()).data;
 expect(source).toMatchObject({kind:'family_source',reference:f.saved.item.id,expectedEpoch:1,guardianName:f.fields.guardianName,messageLanguage:f.fields.messageLanguage,contactAdmission:'admitted',association:null});
 expect(source.children).toEqual(f.fields.children.map(({id,name,ageYears})=>({id,name,ageYears})));expect(JSON.stringify(source)).not.toContain(f.fields.email);
 const command={version:NATIVE_FAMILY_VERSION,operationId:randomUUID(),reference:source.reference,expectedEpoch:source.expectedEpoch,expectedSourceDigest:source.sourceDigest,
  ownerReviewedMapping:true,familyId:randomUUID(),familyLabel:'SYNTHETIC explicitly reviewed family',children:source.children.map((child:{id:string})=>({applicationChildId:child.id,nativeChildId:randomUUID()}))};
 expect((await h.call({action:'create_native_family',command})).status).toBe(200);
 const fresh=await composedOwnerHarness(f,env),loaded=await fresh.call(null,query);expect(loaded.status).toBe(200);const after=(await loaded.json()).data;
 expect(after.association.command.selection).toEqual({reference:command.reference,familyId:command.familyId,children:command.children});
 expect(after.association).toMatchObject({guardianVerified:false,recipientVerified:false,financialAcceptance:false,outboundEligible:false});expect(after.children).toEqual(source.children);expect(await f.count()).toBe(1);
 expect((await fresh.call(null,query+'&expectedEpoch=999')).status).toBe(400);
});
it('native-family-source: an unadmitted current inquiry is explicit and the display read creates no native authority',async()=>{
 const f=await fixture(false,runtimeLookupKey.toString('hex')),before=await f.counts(),h=await composedOwnerHarness(f,{LS_PROVIDER_INDEX_OWNER_ACCOUNT_ID:f.owner.id});
 const response=await h.call(null,'?'+new URLSearchParams({kind:'source',reference:f.saved.item.id}));expect(response.status).toBe(200);
 expect((await response.json()).data).toMatchObject({contactAdmission:'required',association:null,children:expect.any(Array)});
 expect(await f.count()).toBe(0);expect(await f.counts()).toEqual(before);
});
it('native-family-source: a native association read failure is unavailable rather than an empty family',async()=>{
 const f=await fixture(true,runtimeLookupKey.toString('hex'));
 const unavailable:IdentityStore={transaction:work=>db.transaction(tx=>work({query:async<T extends object>(sql:string,values:readonly unknown[]=[])=>{
  if(sql.includes('FROM ls_fishing_billing.inquiry_family_proposals'))throw new AppError('UNAVAILABLE');return tx.query<T>(sql,values);
 }}))};
 const h=await composedOwnerHarness(f,{LS_PROVIDER_INDEX_OWNER_ACCOUNT_ID:f.owner.id},unavailable),response=await h.call(null,'?'+new URLSearchParams({kind:'source',reference:f.saved.item.id}));
 expect(response.status).toBe(503);expect(await response.json()).toMatchObject({ok:false,error:{code:'UNAVAILABLE'}});expect(await f.count()).toBe(0);
});
it.each(['demo','revoked']as const)('native-family-source-terminal: %s after optional absence cannot return earlier private data',async kind=>{
 const f=await fixture(true,runtimeLookupKey.toString('hex'));let changed=false,digest='';
 const barrier:IdentityStore={transaction:async work=>{
  let associationRead=false;
  try{return await db.transaction(tx=>work({query:async<T extends object>(sql:string,values:readonly unknown[]=[])=>{
   if(sql.includes('FROM ls_fishing_billing.inquiry_family_proposals'))associationRead=true;return tx.query<T>(sql,values);
  }}));}catch(error){
   // Change actual committed state AFTER the optional read rolled back. No
   // write is injected into its genuine READ ONLY transaction.
   if(!changed&&associationRead&&error instanceof AppError&&error.code==='NOT_FOUND'){
    changed=true;
    if(kind==='demo')await db.transaction(tx=>markDemo(tx,f));
    if(kind==='revoked')await engine.query('UPDATE ls_identity.sessions SET revoked_at=$2 WHERE token_digest=$1',[digest,now]);
   }
   throw error;
  }
 }};
 const h=await composedOwnerHarness(f,{LS_PROVIDER_INDEX_OWNER_ACCOUNT_ID:f.owner.id},barrier);digest=tokenDigest(h.token);
 const response=await h.call(null,'?'+new URLSearchParams({kind:'source',reference:f.saved.item.id}));expect(changed).toBe(true);
 expect(response.status).toBe(kind==='demo'?403:401);
 if(kind==='demo')expect((await engine.query('SELECT account_id FROM ls_demo.accounts WHERE workspace_id=$1',[f.workspace])).rows).toEqual([{account_id:f.owner.id}]);
 if(kind==='revoked')expect((await engine.query<{revoked_at:Date|null}>('SELECT revoked_at FROM ls_identity.sessions WHERE token_digest=$1',[digest])).rows[0]!.revoked_at).not.toBeNull();
 const body=JSON.stringify(await response.json());expect(body).not.toContain(f.fields.guardianName);expect(body).not.toContain(f.fields.children[0]!.name);expect(await f.count()).toBe(0);
});
it('native-family-outcome: actual known rollback permits a corrected explicit family creation without duplicates',async()=>{
 const f=await fixture(true,runtimeLookupKey.toString('hex')),h=await composedOwnerHarness(f,{LS_PROVIDER_INDEX_OWNER_ACCOUNT_ID:f.owner.id}),before=await f.counts();
 const command={...await nativeFamilyCommand(f),familyId:f.selection.familyId};
 const rejected=await h.call({action:'create_native_family',command});expect(rejected.status).toBe(200);
 expect((await rejected.json()).data).toMatchObject({kind:'native_family_rejected',workspaceId:f.workspace,actorId:f.owner.id,command,code:'CONFLICT'});
 expect(await f.count()).toBe(0);expect(await f.counts()).toEqual(before);
 const corrected={...command,operationId:randomUUID(),familyId:randomUUID()},saved=await h.call({action:'create_native_family',command:corrected});
 expect(saved.status).toBe(200);expect((await saved.json()).data).toMatchObject({kind:'native_family_created',replayed:false,record:{command:{operationId:corrected.operationId}}});expect(await f.count()).toBe(1);
});
it('native-family-outcome: typed post-COMMIT failure stays unknown and exact operation recovers through a new real session',async()=>{
 const f=await fixture(true,runtimeLookupKey.toString('hex')),command=await nativeFamilyCommand(f);let lost=true;
 const uncertain:IdentityStore={transaction:async work=>{let wrote=false;const result=await db.transaction(tx=>work({query:async<T extends object>(sql:string,values:readonly unknown[]=[])=>{
  const rows=await tx.query<T>(sql,values);if(sql.startsWith('INSERT INTO ls_fishing_billing.commands'))wrote=true;return rows;
 }}));if(wrote&&lost){lost=false;throw new AppError('FORBIDDEN');}return result;}};
 const first=await composedOwnerHarness(f,{LS_PROVIDER_INDEX_OWNER_ACCOUNT_ID:f.owner.id},uncertain),response=await first.call({action:'create_native_family',command});
 expect(response.status).toBe(503);expect((await response.json()).error.code).toBe('UNAVAILABLE');const rows=await createdNativeRows(f,command);expect(rows.family).toHaveLength(1);expect(rows.children).toHaveLength(2);expect(rows.journal).toHaveLength(1);
 const fresh=await composedOwnerHarness(f,{LS_PROVIDER_INDEX_OWNER_ACCOUNT_ID:f.owner.id}),replay=await fresh.call({action:'create_native_family',command});
 expect(replay.status).toBe(200);expect((await replay.json()).data).toMatchObject({kind:'native_family_created',replayed:true,record:{command:{operationId:command.operationId}}});expect(await createdNativeRows(f,command)).toEqual(rows);expect(await f.count()).toBe(1);
});
it('native-family-outcome: a borrowed actor rejection cannot become a definitive result',async()=>{
 const f=await fixture(true,runtimeLookupKey.toString('hex')),h=await composedOwnerHarness(f,{LS_PROVIDER_INDEX_OWNER_ACCOUNT_ID:f.owner.id}),command=await nativeFamilyCommand(f);
 const deps=composeFishingInquiryFamilyProposalOwnerRuntime(h.runtime,{LS_PROVIDER_INDEX_OWNER_ACCOUNT_ID:f.owner.id});
 deps.nativeFamilyOutcome=async()=>({version:NATIVE_FAMILY_VERSION,workspaceId:f.workspace,actorId:f.parent.id,command,state:'rejected',code:'CONFLICT'});
 const host=new URL(ownerHttpOrigin).host,request=new Request(ownerHttpOrigin+FISHING_INQUIRY_FAMILY_PROPOSAL_OWNER_PATH,{method:'POST',headers:{host,'x-forwarded-host':host,'x-forwarded-proto':'https',cookie:`${SESSION_COOKIE}=${h.token}`,origin:ownerHttpOrigin,'sec-fetch-site':'same-origin','x-csrf-token':h.runtime.services.sessions.csrf(h.token),'content-type':'application/json'},body:JSON.stringify({action:'create_native_family',command})});
 const response=await fishingInquiryFamilyProposalOwnerHttp(request,async()=>deps);expect(response.status).toBe(503);expect((await response.json()).error.code).toBe('UNAVAILABLE');expect(await f.count()).toBe(0);
});
