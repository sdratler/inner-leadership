import {afterEach,describe,expect,it,vi} from 'vitest';
import {AppError} from '../../src/lib/errors.ts';
import {successResponse,failureResponse} from '../../src/lib/http/json.ts';
import {IdentityClientError,type sessionInfo} from '../../src/features/identity/client.ts';
import {PROGRAM_SOURCE_V3,programSourceRecordV3Schema,type ProgramSourceRecordV3} from '../../src/features/fishing-billing/program-source-contract-v3.ts';
import {programSourceGroupDataV3Schema} from '../../src/features/fishing-billing/program-source-owner-contract-v3.ts';
import {createProgramSourceClientV3,prepareProgramSourceSaveV3,programSourceSavedHeadV3,programSourceSaveMatchesV3,type PreparedProgramSourceSaveV3} from '../../src/features/fishing-billing/program-source-client-v3.ts';

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
