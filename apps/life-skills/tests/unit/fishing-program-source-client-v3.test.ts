import {afterEach,describe,expect,it,vi} from 'vitest';
import {AppError} from '../../src/lib/errors.ts';
import {successResponse,failureResponse} from '../../src/lib/http/json.ts';
import {IdentityClientError,type sessionInfo} from '../../src/features/identity/client.ts';
import {PROGRAM_SOURCE_V3,programSourceRecordV3Schema,type ProgramSourceRecordV3} from '../../src/features/fishing-billing/program-source-contract-v3.ts';
import {programSourceGroupDataV3Schema} from '../../src/features/fishing-billing/program-source-owner-contract-v3.ts';
import {createProgramSourceClientV3,prepareProgramSourceSaveV3,programSourceSavedHeadV3,programSourceSaveMatchesV3,prepareProgramGroupSaveV3,
 prepareNativeFamilySaveV3,nativeFamilySaveMatchesV3,prepareProgramParticipantSaveV3,type PreparedProgramSourceSaveV3,type PreparedNativeFamilySaveV3} from '../../src/features/fishing-billing/program-source-client-v3.ts';
import {NATIVE_FAMILY_OWNER_SOURCE_VERSION,nativeFamilyOwnerSourceSchema,type NativeFamilyOwnerSource} from '../../src/features/fishing-billing/native-family-owner-source-contract.ts';
import {NATIVE_FAMILY_VERSION} from '../../src/features/fishing-billing/native-family-contract-v1.ts';
import {FISHING_INQUIRY_FAMILY_PROPOSAL_VERSION,fishingInquiryFamilyProposalSchema} from '../../src/features/fishing-billing/inquiry-family-contract-v1.ts';
import {OWNER_LOCATION_PLANNING_PREFIX,ownerLocationPlanningSource} from '../../src/features/fishing-billing/owner-location-planning-source.ts';
import {currentTrip390Fields} from '../fixtures/trip390-current.ts';

const id=(n:number)=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const owner=id(1),workspace=id(2),requestId=id(3),group=id(4),operation=id(5);
type Session=Awaited<ReturnType<typeof sessionInfo>>;
const session:Session={accountId:owner,role:'practitioner',locale:'en',expiresAt:'2030-01-01T00:00:00.000Z',csrfToken:'x'.repeat(43)};
const fresh=()=>prepareProgramSourceSaveV3({version:PROGRAM_SOURCE_V3,kind:'group',groupId:group,id:group,operationId:operation,expectedRevision:0,
 fields:{state:'forming',location:'Synthetic reviewed location',venueSource:{id:'synthetic-venue',sha256:'a'.repeat(64)}}},workspace);
function record(pending:PreparedProgramSourceSaveV3,patch:Partial<ProgramSourceRecordV3>={}){
 return programSourceRecordV3Schema.parse({version:PROGRAM_SOURCE_V3,workspaceId:workspace,revision:pending.command.expectedRevision+1,
  recordedBy:owner,recordedAt:'2026-11-10T18:30:00.000Z',previousDigest:pending.command.expectedRevision===0?null:'b'.repeat(64),command:pending.command,...patch});
}
function data(){return programSourceGroupDataV3Schema.parse({version:PROGRAM_SOURCE_V3,kind:'group_source',classification:'scheduling_facts_only',
 group:{record:record(fresh()),digest:'c'.repeat(64)},lessons:[],progressions:[]});}
const ok=(value:unknown)=>successResponse(value,requestId);
const no=(code:ConstructorParameters<typeof AppError>[0])=>failureResponse(new AppError(code),requestId);
const saved=(pending:PreparedProgramSourceSaveV3)=>({version:PROGRAM_SOURCE_V3,kind:'recorded_source',record:record(pending),digest:'c'.repeat(64),replayed:false});
function familySource():NativeFamilyOwnerSource{return nativeFamilyOwnerSourceSchema.parse({version:NATIVE_FAMILY_OWNER_SOURCE_VERSION,kind:'family_source',reference:id(40),expectedEpoch:1,sourceDigest:'a'.repeat(64),
 guardianName:'Synthetic Guardian',messageLanguage:'en',children:[{id:id(50),name:'Synthetic One',ageYears:11},{id:id(51),name:'Synthetic Two',ageYears:13}],contactAdmission:'admitted',association:null});}
function preparedFamily(){let n=100;return prepareNativeFamilySaveV3(familySource(),'Synthetic family',true,workspace,()=>id(n++));}
function familyRecord(p:PreparedNativeFamilySaveV3){
 const c=p.command,snapshot={version:'synthetic-unapproved',language:'en',textDigest:'b'.repeat(64)};
 return fishingInquiryFamilyProposalSchema.parse({version:FISHING_INQUIRY_FAMILY_PROPOSAL_VERSION,id:id(200),workspaceId:workspace,
  command:{operationId:c.operationId,expectedEpoch:c.expectedEpoch,selection:{reference:c.reference,familyId:c.familyId,children:c.children},expectedSourceDigest:c.expectedSourceDigest,expectedNativeDigest:'c'.repeat(64)},
  recordedBy:owner,recordedAt:'2026-11-10T18:30:00.000Z',guardianPersonId:id(201),messageLanguage:'en',sourceVersion:'synthetic-source',offerVersion:'synthetic-historical',
  acknowledgment:{version:'synthetic-ack',language:'en',reservationNotice:snapshot,studentConduct:snapshot,whatsapp:false},
  state:'proposed',guardianVerified:false,recipientVerified:false,financialAcceptance:false,outboundEligible:false});
}
function associatedFamily(){const source=familySource();source.association=familyRecord(preparedFamily());return nativeFamilyOwnerSourceSchema.parse(source);}
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});

describe('native program source browser contract',()=>{
 it('reads the complete actual envelope for exactly the selected group without a browser-chosen workspace',async()=>{
  const transport=vi.fn<typeof fetch>().mockResolvedValue(ok(data()));
  expect(await createProgramSourceClientV3({fetch:transport}).group(group)).toEqual({state:'ready',value:data(),requestId});
  expect(transport).toHaveBeenCalledTimes(1);
  expect(transport.mock.calls[0]).toMatchObject(['/api/private/fishing-program-sources?groupId='+group,{method:'GET',cache:'no-store',credentials:'same-origin',redirect:'error',referrerPolicy:'no-referrer'}]);
 });
 it('rejects invalid or noncanonical group IDs without a request',async()=>{
  const transport=vi.fn<typeof fetch>(),client=createProgramSourceClientV3({fetch:transport});
  for(const value of ['not-a-group','00000000-0000-4000-8000-00000000000A'])expect(await client.group(value)).toMatchObject({state:'failed',code:'INVALID_REQUEST'});
  expect(transport).not.toHaveBeenCalled();
 });
 it.each(['selected_group','workspace','wrong_kind','duplicate_lesson','corrupt_row'] as const)('rejects %s corruption without displaying a partial or empty schedule',async mismatch=>{
  const value=data(),lesson=prepareProgramSourceSaveV3({version:PROGRAM_SOURCE_V3,kind:'lesson',groupId:group,id:id(20),operationId:id(21),expectedRevision:0,
   fields:{state:'scheduled',sequence:1,startsAt:'2026-11-15T15:00:00.000Z',endsAt:'2026-11-15T16:00:00.000Z',timeZone:'America/New_York'}},workspace);
  const item={record:record(lesson),digest:'d'.repeat(64)};
  const corrupt=mismatch==='selected_group'?{...value,group:{...value.group,record:record(prepareProgramSourceSaveV3({...fresh().command,groupId:id(90),id:id(90)},workspace))}}:
   mismatch==='workspace'?{...value,lessons:[{...item,record:{...item.record,workspaceId:id(91)}}]}:
   mismatch==='wrong_kind'?{...value,lessons:[value.group]}:mismatch==='duplicate_lesson'?{...value,lessons:[item,item]}:
   {...value,lessons:[{...item,record:{...item.record,revision:99}}]};
  const result=await createProgramSourceClientV3({fetch:async()=>ok(corrupt)}).group(group);
  expect(result).toMatchObject({state:'failed',code:'UNAVAILABLE'});expect(result).not.toHaveProperty('value');
 });
 it('keeps NOT_FOUND distinct from unavailable and access denial',async()=>{
  for(const code of ['NOT_FOUND','UNAVAILABLE','FORBIDDEN','UNAUTHENTICATED'] as const){
   expect(await createProgramSourceClientV3({fetch:async()=>no(code)}).group(group)).toEqual({state:'failed',code,requestId});
  }
 });
 it('posts the exact B command once with session CSRF and deeply frozen input',async()=>{
  const p=fresh(),value=saved(p),transport=vi.fn<typeof fetch>().mockResolvedValue(ok(value));
  expect(await createProgramSourceClientV3({fetch:transport,session:async()=>session}).save(p)).toEqual({state:'saved',value,requestId});
  expect(transport.mock.calls).toHaveLength(1);
  expect(transport.mock.calls[0]).toMatchObject(['/api/private/fishing-program-sources',{method:'POST',body:p.serialized}]);
  expect(new Headers(transport.mock.calls[0]![1]?.headers).get('x-csrf-token')).toBe(session.csrfToken);
  expect(Object.isFrozen(p.command.fields)).toBe(true);expect(Object.isFrozen(p.command.kind==='group'&&p.command.fields.venueSource)).toBe(true);
 });
 it('retains exact operation/body after unknown and accepts the original immutable replay',async()=>{
  const p=fresh(),value={...saved(p),replayed:true},transport=vi.fn<typeof fetch>().mockResolvedValueOnce(no('UNAVAILABLE')).mockResolvedValueOnce(ok(value));
  const client=createProgramSourceClientV3({fetch:transport,session:async()=>session});
  expect((await client.save(p)).state).toBe('unknown');expect(transport.mock.calls).toHaveLength(1);
  expect(await client.save(p)).toEqual({state:'saved',value,requestId});
  expect(transport.mock.calls.map(call=>call[1]?.body)).toEqual([p.serialized,p.serialized]);
 });
 it('recognizes the strictly correlated native rollback receipt as rejection, then saves a corrected new operation',async()=>{
  const p=fresh(),rejection={version:PROGRAM_SOURCE_V3,kind:'rejected_source',workspaceId:workspace,actorId:owner,command:p.command,code:'CONFLICT'};
  if(p.command.kind!=='group')throw new Error('FIXTURE_KIND');
  const corrected=prepareProgramSourceSaveV3({...p.command,operationId:id(88),fields:{...p.command.fields,location:'Corrected synthetic location'}},workspace);
  const transport=vi.fn<typeof fetch>().mockResolvedValueOnce(ok(rejection)).mockResolvedValueOnce(ok(saved(corrected)));
  const client=createProgramSourceClientV3({fetch:transport,session:async()=>session});
  expect(await client.save(p)).toEqual({state:'rejected',code:'CONFLICT',requestId});
  expect(await client.save(corrected)).toMatchObject({state:'saved',value:{record:{command:{operationId:id(88)}}}});
  expect(transport.mock.calls.map(call=>call[1]?.body)).toEqual([p.serialized,corrected.serialized]);
 });
 it.each(['workspace','actor','command','code','missing'] as const)('retains uncertainty for a %s-forged native rejection correlation',async mismatch=>{
  const p=fresh(),value={version:PROGRAM_SOURCE_V3,kind:'rejected_source',workspaceId:workspace,actorId:owner,command:p.command,code:'CONFLICT'};
  const forged=mismatch==='workspace'?{...value,workspaceId:id(99)}:mismatch==='actor'?{...value,actorId:id(99)}:
   mismatch==='command'?{...value,command:{...p.command,operationId:id(99)}}:mismatch==='code'?{...value,code:'UNAVAILABLE'}:
   {version:value.version,kind:value.kind,command:value.command,code:value.code};
  const transport=vi.fn<typeof fetch>().mockResolvedValue(ok(forged));
  expect((await createProgramSourceClientV3({fetch:transport,session:async()=>session}).save(p)).state).toBe('unknown');
  expect(transport).toHaveBeenCalledTimes(1);
 });
 it.each(['command','actor','revision','version','kind','digest'] as const)('keeps a %s-mismatched POST success uncertain',async mismatch=>{
  const p=fresh(),value=saved(p),changed=mismatch==='command'?{...value,record:{...value.record,command:{...p.command,operationId:id(99)}}}:
   mismatch==='actor'?{...value,record:{...value.record,recordedBy:id(99)}}:mismatch==='revision'?{...value,record:{...value.record,revision:2}}:
   mismatch==='version'?{...value,version:'other'}:mismatch==='kind'?{...value,kind:'group_source'}:{...value,digest:'not-a-digest'};
  const transport=vi.fn<typeof fetch>().mockResolvedValue(ok(changed));
  expect((await createProgramSourceClientV3({fetch:transport,session:async()=>session}).save(p)).state).toBe('unknown');
  expect(transport).toHaveBeenCalledTimes(1);
 });
 it('confirms only an exact saved head; a later version never resolves an earlier unknown',()=>{
  const p=fresh(),value=data();expect(programSourceSavedHeadV3(p,value)?.record).toEqual(record(p));
  const later=prepareProgramSourceSaveV3({...p.command,expectedRevision:1,operationId:id(99)},workspace);
  value.group.record=record(later);
  expect(programSourceSaveMatchesV3(p,value.group.record)).toBe(false);expect(programSourceSavedHeadV3(p,value)).toBeNull();
 });
 it('distinguishes preflight rejection, known rejection and uncertain post-dispatch results',async()=>{
  const transport=vi.fn<typeof fetch>();
  expect(await createProgramSourceClientV3({fetch:transport,session:async()=>{throw new IdentityClientError('UNAUTHENTICATED');}}).save(fresh())).toMatchObject({state:'not_sent',code:'UNAUTHENTICATED'});
  expect(await createProgramSourceClientV3({fetch:transport,session:async()=>({...session,role:'parent'})}).save(fresh())).toMatchObject({state:'not_sent',code:'FORBIDDEN'});
  const tampered={...fresh(),serialized:'{}'};expect((await createProgramSourceClientV3({fetch:transport,session:async()=>session}).save(tampered)).state).toBe('not_sent');
  expect(transport).not.toHaveBeenCalled();
  for(const code of ['FORBIDDEN','CONFLICT','INVALID_REQUEST','RATE_LIMITED'] as const)
   expect(await createProgramSourceClientV3({fetch:async()=>no(code),session:async()=>session}).save(fresh())).toMatchObject({state:'rejected',code});
  expect((await createProgramSourceClientV3({fetch:async()=>Response.json({ok:false,error:{code:'FORBIDDEN'},requestId},{status:503}),session:async()=>session}).save(fresh())).state).toBe('unknown');
 });
 it('times out session preflight without ever sending a late POST',async()=>{
  vi.useFakeTimers();let release:(value:Session)=>void=()=>undefined;
  const late=new Promise<Session>(resolve=>{release=resolve;}),transport=vi.fn<typeof fetch>();
  const attempt=createProgramSourceClientV3({fetch:transport,session:()=>late,timeoutMs:50}).save(fresh());
  await vi.advanceTimersByTimeAsync(51);expect((await attempt).state).toBe('not_sent');release(session);await vi.advanceTimersByTimeAsync(1);
  expect(transport).not.toHaveBeenCalled();
 });
 it('bounds hanging POST and streamed-body reads without automatic retries',async()=>{
  vi.useFakeTimers();const transport=vi.fn<typeof fetch>().mockImplementation(()=>new Promise(()=>undefined));
  const attempt=createProgramSourceClientV3({fetch:transport,session:async()=>session,timeoutMs:50}).save(fresh());
  await vi.advanceTimersByTimeAsync(51);expect((await attempt).state).toBe('unknown');expect(transport).toHaveBeenCalledTimes(1);
  expect(transport.mock.calls[0]![1]?.signal?.aborted).toBe(true);
  const cancel=vi.fn(),stream=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new TextEncoder().encode('{"ok":'));},cancel});
  const read=createProgramSourceClientV3({fetch:async()=>new Response(stream,{headers:{'content-type':'application/json'}}),timeoutMs:50}).group(group);
  await vi.advanceTimersByTimeAsync(51);expect(await read).toMatchObject({state:'failed',code:'UNAVAILABLE'});expect(cancel).toHaveBeenCalledTimes(1);
 });
 it('refuses oversized, malformed UTF8, non-JSON and invalid envelopes',async()=>{
  const responses=[new Response(new Uint8Array(4_194_305).fill(32),{headers:{'content-type':'application/json'}}),
   new Response(new Uint8Array([0xc3,0x28]),{headers:{'content-type':'application/json'}}),new Response('<html>Sign in</html>'),
   Response.json({ok:true,data:data()}),Response.json({ok:true,data:data(),requestId},{status:201})];
  for(const response of responses)expect(await createProgramSourceClientV3({fetch:async()=>response}).group(group)).toMatchObject({state:'failed',code:'UNAVAILABLE'});
 });
 it('rejects an externally cancelled request before session lookup or dispatch',async()=>{
  const controller=new AbortController();controller.abort();const transport=vi.fn<typeof fetch>(),lookup=vi.fn(async()=>session);
  expect((await createProgramSourceClientV3({fetch:transport,session:lookup}).save(fresh(),controller.signal)).state).toBe('not_sent');
  expect(lookup).not.toHaveBeenCalled();expect(transport).not.toHaveBeenCalled();
 });
});

describe('owner location note and first native group preparation',()=>{
 it('uses the reviewed helper for an actual normalized owner statement and never invents external venue approval',async()=>{
  const prepared=await prepareProgramGroupSaveV3({groupId:group,workspaceId:workspace,operationId:operation,inputs:{location:'  Synthetic proposed park  ',state:'forming'}},owner);
  const note=await ownerLocationPlanningSource({workspaceId:workspace,ownerAccountId:owner,groupId:group,operationId:operation,location:'Synthetic proposed park'});
  expect(prepared?.command).toMatchObject({kind:'group',expectedRevision:0,fields:{state:'forming',location:'Synthetic proposed park',venueSource:note}});
  expect(note.id).toBe(OWNER_LOCATION_PLANNING_PREFIX+operation);expect(prepared?.workspaceId).toBe(workspace);
  expect(prepared?.serialized).not.toMatch(/approved|paid|guardianVerified/);
 });
 it('creates a fresh owner note for a new operation even with the same location; unchanged fields prepare no operation',async()=>{
  const first=await prepareProgramGroupSaveV3({groupId:group,workspaceId:workspace,operationId:operation,inputs:{location:'Synthetic park',state:'forming'}},owner);
  if(!first||first.command.kind!=='group')throw new Error('FIXTURE');const current=record(first);
  expect(await prepareProgramGroupSaveV3({groupId:group,workspaceId:workspace,operationId:id(90),current,inputs:{location:'Synthetic park',state:'forming'}},owner)).toBeNull();
  const next=await prepareProgramGroupSaveV3({groupId:group,workspaceId:workspace,operationId:id(91),current,inputs:{location:'Synthetic park',state:'cancelled'}},owner);
  expect(next?.command).toMatchObject({expectedRevision:1,fields:{venueSource:{id:OWNER_LOCATION_PLANNING_PREFIX+id(91)}}});
  expect(next?.serialized).not.toBe(first.serialized);
 });
 it('preserves an existing external source when only status changes, and binds a new owner note when location changes',async()=>{
  const current=record(fresh());
  const status=await prepareProgramGroupSaveV3({groupId:group,workspaceId:workspace,operationId:id(92),current,inputs:{location:'Synthetic reviewed location',state:'cancelled'}},owner);
  expect(status?.command).toMatchObject({fields:{venueSource:{id:'synthetic-venue',sha256:'a'.repeat(64)}}});
  const changed=await prepareProgramGroupSaveV3({groupId:group,workspaceId:workspace,operationId:id(93),current,inputs:{location:'Different proposed place',state:'forming'}},owner);
  expect(changed?.command).toMatchObject({fields:{venueSource:{id:OWNER_LOCATION_PLANNING_PREFIX+id(93)}}});
 });
 it('bounds authenticated planning preparation and never dispatches a POST from a late session response',async()=>{
  const transport=vi.fn<typeof fetch>(),input={groupId:group,workspaceId:workspace,operationId:operation,inputs:{location:'Synthetic park',state:'forming' as const}};
  expect((await createProgramSourceClientV3({fetch:transport,session:async()=>session}).prepareGroup(input)).state).toBe('prepared');
  expect(transport).not.toHaveBeenCalled();
  vi.useFakeTimers();let release:(value:Session)=>void=()=>undefined;const late=new Promise<Session>(resolve=>{release=resolve;});
  const attempt=createProgramSourceClientV3({fetch:transport,session:()=>late,timeoutMs:50}).prepareGroup(input);
  await vi.advanceTimersByTimeAsync(51);expect(await attempt).toMatchObject({state:'failed',code:'UNAVAILABLE'});release(session);await vi.advanceTimersByTimeAsync(1);expect(transport).not.toHaveBeenCalled();
 });
});

describe('saved inquiry selection and narrowly scoped native family recovery',()=>{
 it('reuses the existing strict review decoder, preserving opaque cursors and typed saved city without inferred location',async()=>{
  const fields=currentTrip390Fields(),cursor='Opaque_'+'a'.repeat(64),transport=vi.fn<typeof fetch>().mockResolvedValue(Response.json({ok:true,data:{items:[{id:id(40),source:'public_group_application',state:'owner_review',receivedAt:'2026-11-10T18:30:00.000Z',fields}],nextCursor:null}}));
  const result=await createProgramSourceClientV3({fetch:transport}).inquiries('Synthetic Guardian',cursor);
  expect(result).toMatchObject({state:'ready',value:{items:[{fields:{city:'My Local Neighborhood',postalCode:'01234-5678'}}]}});
  const url=new URL(String(transport.mock.calls[0]![0]),'https://synthetic.invalid');expect(url.searchParams.get('cursor')).toBe(cursor);expect(url.searchParams.get('search')).toBe('Synthetic Guardian');
  expect(url.searchParams.has('workspaceId')).toBe(false);expect(url.searchParams.has('expectedEpoch')).toBe(false);
 });
 it('rejects a corrupt or mixed inquiry page rather than showing a partial successful list',async()=>{
  const good={id:id(40),source:'public_group_application',state:'owner_review',receivedAt:'2026-11-10T18:30:00.000Z',fields:currentTrip390Fields()};
  for(const items of [[good,{...good,id:id(41),source:'retired_sheet'}],[good,good]]){
   const result=await createProgramSourceClientV3({fetch:async()=>Response.json({ok:true,data:{items,nextCursor:null}})}).inquiries('');
   expect(result).toMatchObject({state:'failed',code:'UNAVAILABLE'});expect(result).not.toHaveProperty('value');
  }
 });
 it('loads family source by selected saved reference only and refuses a changed reference or partial child data',async()=>{
  const source=familySource(),transport=vi.fn<typeof fetch>().mockResolvedValue(ok(source));
  expect(await createProgramSourceClientV3({fetch:transport}).family(source.reference)).toEqual({state:'ready',value:source,requestId});
  expect(transport.mock.calls[0]![0]).toBe('/api/private/fishing-inquiry-family-proposals?kind=source&reference='+source.reference);
  for(const value of [{...source,reference:id(99)},{...source,children:[source.children[0],source.children[0]]}])
   expect(await createProgramSourceClientV3({fetch:async()=>ok(value)}).family(source.reference)).toMatchObject({state:'failed',code:'UNAVAILABLE'});
 });
 it('requires explicit review and contact admission, generates fresh child IDs and never creates accounts or financial authority',()=>{
  expect(()=>prepareNativeFamilySaveV3(familySource(),'Synthetic',false,workspace)).toThrow();
  expect(()=>prepareNativeFamilySaveV3({...familySource(),contactAdmission:'required'},'Synthetic',true,workspace)).toThrow();
  expect(()=>prepareNativeFamilySaveV3(associatedFamily(),'Synthetic',true,workspace)).toThrow();
  const p=preparedFamily();expect(p.command.children).toEqual([{applicationChildId:id(50),nativeChildId:id(102)},{applicationChildId:id(51),nativeChildId:id(103)}]);
  expect(Object.isFrozen(p.command.children[0])).toBe(true);expect(p.serialized).not.toMatch(/password|activation|subscription|outboundEligible/);
 });
 it('retries the same native family creation after unknown with the exact original body and immutable original receipt',async()=>{
  const p=preparedFamily(),value={version:NATIVE_FAMILY_VERSION,kind:'native_family_created',resultKind:'original_creation_receipt',record:familyRecord(p),replayed:true};
  const transport=vi.fn<typeof fetch>().mockResolvedValueOnce(no('UNAVAILABLE')).mockResolvedValueOnce(ok(value)),client=createProgramSourceClientV3({fetch:transport,session:async()=>session});
  expect((await client.saveFamily(p)).state).toBe('unknown');expect(transport).toHaveBeenCalledTimes(1);
  expect(await client.saveFamily(p)).toMatchObject({state:'saved',record:{guardianVerified:false,recipientVerified:false,financialAcceptance:false,outboundEligible:false},replayed:true});
  expect(transport.mock.calls.map(call=>call[1]?.body)).toEqual([p.serialized,p.serialized]);
  expect(nativeFamilySaveMatchesV3(p,familyRecord(p))).toBe(true);
 });
 it('accepts only a fully correlated native family rejection as known rejection',async()=>{
  const p=preparedFamily(),value={version:NATIVE_FAMILY_VERSION,kind:'native_family_rejected',workspaceId:workspace,actorId:owner,command:p.command,code:'CONFLICT'};
  expect(await createProgramSourceClientV3({fetch:async()=>ok(value),session:async()=>session}).saveFamily(p)).toEqual({state:'rejected',code:'CONFLICT',requestId});
  for(const forged of [{...value,workspaceId:id(90)},{...value,actorId:id(91)},{...value,command:{...p.command,operationId:id(92)}},{...value,code:'UNAVAILABLE'}])
   expect((await createProgramSourceClientV3({fetch:async()=>ok(forged),session:async()=>session}).saveFamily(p)).state).toBe('unknown');
 });
 it('keeps wrong native-family success identity, actor, workspace or promoted authority uncertain',async()=>{
  const p=preparedFamily(),r=familyRecord(p),value={version:NATIVE_FAMILY_VERSION,kind:'native_family_created',resultKind:'original_creation_receipt',record:r,replayed:false};
  for(const changed of [{...r,recordedBy:id(90)},{...r,workspaceId:id(91)},{...r,guardianVerified:true},{...r,command:{...r.command,selection:{...r.command.selection,familyId:id(92)}}}])
   expect((await createProgramSourceClientV3({fetch:async()=>ok({...value,record:changed}),session:async()=>session}).saveFamily(p)).state).toBe('unknown');
 });
});

describe('participant starts use actual native family mapping and saved lesson facts',()=>{
 function foundationData(){const value=data();for(const sequence of [1,2]){
  const c=prepareProgramSourceSaveV3({version:PROGRAM_SOURCE_V3,kind:'lesson',groupId:group,id:id(70+sequence),operationId:id(80+sequence),expectedRevision:0,
   fields:{state:'scheduled',sequence,startsAt:sequence===1?'2026-11-15T15:00:00.000Z':'2026-11-22T15:00:00.000Z',endsAt:sequence===1?'2026-11-15T16:00:00.000Z':'2026-11-22T16:00:00.000Z',timeZone:'America/New_York'}},workspace);
  value.lessons.push({record:record(c),digest:'d'.repeat(64)});
 }return value;}
 it('plans each sibling separately against its real saved native child and the actual first foundation lesson',()=>{
  const value=foundationData(),source=associatedFamily();
  for(const [i,child] of source.children.entries()){
   const p=prepareProgramParticipantSaveV3({data:value,source,applicationChildId:child.id,lessonId:id(71),state:'planned',operationId:id(300+i)});
   expect(p?.command).toMatchObject({kind:'progression',id:id(102+i),expectedRevision:0,fields:{familyId:id(101),proposalId:id(200),reference:id(40),expectedEpoch:1,
    eligibleFrom:'2026-11-15T15:00:00.000Z',readiness:'needs_foundation',evidence:null}});
  }
 });
 it('does not infer catch-up, change family mapping or permit a cancelled schedule',()=>{
  const value=foundationData(),source=associatedFamily(),input={data:value,source,applicationChildId:id(50),lessonId:id(72),state:'planned' as const,operationId:id(300)};
  expect(()=>prepareProgramParticipantSaveV3(input)).toThrow('ELIGIBLE_SAVED_LESSON_REQUIRED');
  expect(()=>prepareProgramParticipantSaveV3({...input,lessonId:id(71),applicationChildId:id(99)})).toThrow('SELECTED_CHILD_NOT_ASSOCIATED');
  expect(()=>prepareProgramParticipantSaveV3({...input,source:{...source,association:null}})).toThrow('CURRENT_NATIVE_FAMILY_REQUIRED');
  const c=value.group.record.command;if(c.kind!=='group')throw new Error('FIXTURE');c.fields.state='cancelled';
  expect(()=>prepareProgramParticipantSaveV3({...input,lessonId:id(71)})).toThrow('GROUP_NOT_FORMING');
 });
 it('preserves advanced saved evidence and exact eligible instant when withdrawing, even without a remaining scheduled lesson',()=>{
  const value=foundationData(),source=associatedFamily(),p=prepareProgramParticipantSaveV3({data:value,source,applicationChildId:id(50),lessonId:id(71),state:'planned',operationId:id(300)});
  if(!p||p.command.kind!=='progression')throw new Error('FIXTURE');
  const current=record(prepareProgramSourceSaveV3({...p.command,fields:{...p.command.fields,readiness:'verified_catchup',evidence:{id:'synthetic-existing-skill-evidence',sha256:'e'.repeat(64)},eligibleFrom:'2026-11-15T10:00:00.123-05:00'}},workspace));
  value.progressions.push({record:current,digest:'f'.repeat(64)});value.lessons=[];
  const next=prepareProgramParticipantSaveV3({data:value,source,applicationChildId:id(50),state:'withdrawn',operationId:id(301)});
  expect(next?.command).toMatchObject({expectedRevision:1,fields:{state:'withdrawn',readiness:'verified_catchup',eligibleFrom:'2026-11-15T10:00:00.123-05:00',evidence:{id:'synthetic-existing-skill-evidence',sha256:'e'.repeat(64)}}});
 });
});
