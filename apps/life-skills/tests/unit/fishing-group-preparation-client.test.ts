import {afterEach,describe,expect,it,vi} from 'vitest';
import {AppError} from '../../src/lib/errors.ts';
import {successResponse,failureResponse} from '../../src/lib/http/json.ts';
import {IdentityClientError,type sessionInfo} from '../../src/features/identity/client.ts';
import {
 GROUP_PREPARATION_CLASS,GROUP_PREPARATION_LIST_VERSION,GROUP_PREPARATION_PROGRAM,
 groupPreparationRecord,type GroupPreparationRecord,
} from '../../src/features/fishing-billing/group-preparation-contract.ts';
import {
 createGroupPreparationClient,createGroupDraft,editGroupDraft,groupDraftInputs,groupPreparationHref,groupSaveMatches,
 GROUP_PREPARATION_PAGE_SIZE,type PreparedGroupSave,
} from '../../src/features/fishing-billing/group-preparation-client.ts';

const id=(n:number)=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const owner=id(1),workspace=id(2),requestId=id(3),group=id(4),operation=id(5);
type Session=Awaited<ReturnType<typeof sessionInfo>>;
const session:Session={accountId:owner,role:'practitioner',locale:'en',expiresAt:'2026-11-10T23:00:00.000Z',csrfToken:'x'.repeat(43)};
const fresh=()=>createGroupDraft(group,operation,{label:'Synthetic fishing group',firstClassLocalDate:'',proposedCapacity:''});
function saved(pending:PreparedGroupSave,patch:Partial<GroupPreparationRecord>={}):GroupPreparationRecord{
 const c=pending.command,initial=c.action==='create';
 return groupPreparationRecord.parse({
  version:c.version,classification:GROUP_PREPARATION_CLASS,programKey:GROUP_PREPARATION_PROGRAM,
  workspaceId:workspace,groupId:c.groupId,revision:c.expectedRevision+1,state:c.action==='cancel'?'cancelled':'draft',action:c.action,
  createdBy:owner,createdAt:'2026-11-10T18:30:00.000Z',recordedBy:owner,recordedAt:initial?'2026-11-10T18:30:00.000Z':'2026-11-10T18:31:00.000Z',
  operationId:c.operationId,requestDigest:'a'.repeat(64),previousDigest:initial?null:'b'.repeat(64),
  fields:{label:'Synthetic fishing group',timeZone:'America/New_York',period:null,firstClassAt:null,firstClassLocalDate:null,venueSource:null,proposedCapacity:null,...(c.action==='cancel'?{}:c.fields)},
  ...patch,
 });
}
const ok=(data:unknown)=>successResponse(data,requestId);
const no=(code:ConstructorParameters<typeof AppError>[0])=>failureResponse(new AppError(code),requestId);
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});

describe('Fishing draft client real envelopes and operation recovery',()=>{
 it('accepts the actual shared success envelope including requestId and sends session CSRF with one immutable body',async()=>{
  const p=fresh(),record=saved(p),transport=vi.fn<typeof fetch>().mockResolvedValue(ok({kind:'saved',record,replayed:false}));
  const client=createGroupPreparationClient({fetch:transport,session:async()=>session});
  expect(await client.save(p)).toEqual({state:'saved',record,replayed:false,requestId});
  expect(transport).toHaveBeenCalledTimes(1);
  const [url,init]=transport.mock.calls[0]!;
  expect(url).toBe('/api/private/fishing-group-preparations');
  expect(init).toMatchObject({method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',body:p.serialized});
  expect(new Headers(init?.headers).get('x-csrf-token')).toBe(session.csrfToken);
  expect(p.command.action!=='cancel'&&Object.isFrozen(p.command.fields)).toBe(true);
 });
 it('retains the exact body for an explicit unknown-result retry and accepts the original historical revision',async()=>{
  const p=fresh(),record=saved(p),transport=vi.fn<typeof fetch>().mockResolvedValueOnce(no('UNAVAILABLE')).mockResolvedValueOnce(ok({kind:'saved',record,replayed:true}));
  const client=createGroupPreparationClient({fetch:transport,session:async()=>session});
  expect((await client.save(p)).state).toBe('unknown');expect(transport).toHaveBeenCalledTimes(1);
  expect(await client.save(p)).toEqual({state:'saved',record,replayed:true,requestId});
  expect(transport.mock.calls.map(c=>c[1]?.body)).toEqual([p.serialized,p.serialized]);
  expect(record.revision).toBe(1);
 });
 it.each(['operation','group','actor','fields','kind','malformed'] as const)('keeps a %s-mismatched success uncertain',async mismatch=>{
  const p=fresh(),record=saved(p);
  const changed=mismatch==='operation'?{...record,operationId:id(90)}:mismatch==='group'?{...record,groupId:id(91)}:
   mismatch==='actor'?{...record,createdBy:id(92),recordedBy:id(92)}:mismatch==='fields'?{...record,fields:{...record.fields,label:'Different save'}}:record;
  const response=mismatch==='malformed'?new Response('{broken',{headers:{'content-type':'application/json'}}):
   ok({kind:mismatch==='kind'?'record':'saved',record:changed,replayed:false});
  const transport=vi.fn<typeof fetch>().mockResolvedValue(response);
  expect((await createGroupPreparationClient({fetch:transport,session:async()=>session}).save(p)).state).toBe('unknown');
  expect(transport).toHaveBeenCalledTimes(1);
 });
 it.each(['FORBIDDEN','CONFLICT','INVALID_REQUEST','UNAUTHENTICATED','RATE_LIMITED'] as const)('reports an authoritative %s rejection distinctly',async code=>{
  const transport=vi.fn<typeof fetch>().mockResolvedValue(no(code));
  expect(await createGroupPreparationClient({fetch:transport,session:async()=>session}).save(fresh())).toEqual({state:'rejected',code,requestId});
 });
 it('does not treat an error code with the wrong HTTP status as authoritative',async()=>{
  const response=Response.json({ok:false,error:{code:'FORBIDDEN'},requestId},{status:503});
  expect((await createGroupPreparationClient({fetch:async()=>response,session:async()=>session}).save(fresh())).state).toBe('unknown');
 });
 it('does not POST after session expiry, a different role, or a late session response after timeout',async()=>{
  const transport=vi.fn<typeof fetch>();
  const expired=createGroupPreparationClient({fetch:transport,session:async()=>{throw new IdentityClientError('UNAUTHENTICATED');}});
  expect(await expired.save(fresh())).toMatchObject({state:'not_sent',code:'UNAUTHENTICATED'});
  const parent=createGroupPreparationClient({fetch:transport,session:async()=>({...session,role:'parent'})});
  expect(await parent.save(fresh())).toMatchObject({state:'not_sent',code:'FORBIDDEN'});
  vi.useFakeTimers();let resume:((value:Session)=>void)=()=>undefined;
  const stalled=new Promise<Session>(resolve=>{resume=resolve;});
  const late=createGroupPreparationClient({fetch:transport,session:()=>stalled,timeoutMs:50});
  const attempt=late.save(fresh());await vi.advanceTimersByTimeAsync(51);
  expect(await attempt).toMatchObject({state:'not_sent',code:'UNAVAILABLE'});
  resume(session);await vi.advanceTimersByTimeAsync(1);
  expect(transport).not.toHaveBeenCalled();
 });
 it('bounds a hanging POST without an automatic retry',async()=>{
  vi.useFakeTimers();const transport=vi.fn<typeof fetch>().mockImplementation(()=>new Promise(()=>undefined));
  const attempt=createGroupPreparationClient({fetch:transport,session:async()=>session,timeoutMs:50}).save(fresh());
  await vi.advanceTimersByTimeAsync(51);expect(await attempt).toMatchObject({state:'unknown',code:'UNAVAILABLE'});
  expect(transport).toHaveBeenCalledTimes(1);expect((transport.mock.calls[0]![1]?.signal as AbortSignal).aborted).toBe(true);
 });
 it('bounds and cancels an incomplete response body',async()=>{
  vi.useFakeTimers();const cancel=vi.fn(),stream=new ReadableStream<Uint8Array>({start(c){c.enqueue(new TextEncoder().encode('{"ok":'));},cancel});
  const transport=vi.fn<typeof fetch>().mockResolvedValue(new Response(stream,{headers:{'content-type':'application/json'}}));
  const attempt=createGroupPreparationClient({fetch:transport,session:async()=>session,timeoutMs:50}).save(fresh());
  await vi.advanceTimersByTimeAsync(51);expect((await attempt).state).toBe('unknown');expect(cancel).toHaveBeenCalledTimes(1);
 });
 it('rejects oversized and invalid UTF8 responses without a second request',async()=>{
  for(const bytes of [new Uint8Array(262_145).fill(32),new Uint8Array([0xc3,0x28])]){
   const transport=vi.fn<typeof fetch>().mockResolvedValue(new Response(bytes,{headers:{'content-type':'application/json'}}));
   expect((await createGroupPreparationClient({fetch:transport,session:async()=>session}).save(fresh())).state).toBe('unknown');
   expect(transport).toHaveBeenCalledTimes(1);
  }
 });
});

describe('Fishing draft list, selected revision and sparse edits',()=>{
 it('keeps cursor bytes and page size unchanged across pages',async()=>{
  const cursor='Opaque_-9.'+'a'.repeat(64);
  const records=Array.from({length:GROUP_PREPARATION_PAGE_SIZE},(_,index)=>saved(createGroupDraft(id(100+index),id(200+index),{label:'Synthetic '+index,firstClassLocalDate:'',proposedCapacity:''})));
  const transport=vi.fn<typeof fetch>().mockResolvedValueOnce(ok({kind:'list',page:{version:GROUP_PREPARATION_LIST_VERSION,items:records,nextCursor:cursor}}))
   .mockResolvedValueOnce(ok({kind:'list',page:{version:GROUP_PREPARATION_LIST_VERSION,items:[],nextCursor:null}}));
  const client=createGroupPreparationClient({fetch:transport});
  const first=await client.list();expect(first.state).toBe('ready');
  const last=await client.list(cursor);expect(last).toMatchObject({state:'ready',value:{items:[],nextCursor:null}});
  const urls=transport.mock.calls.map(c=>new URL(String(c[0]),'https://synthetic.invalid'));
  expect(urls.map(url=>url.searchParams.get('limit'))).toEqual(['25','25']);
  expect(urls[1]!.searchParams.get('cursor')).toBe(cursor);
 });
 it('does not turn access loss, a corrupt row or unsorted rows into an empty/partial page',async()=>{
  const record=saved(fresh()),other=saved(createGroupDraft(id(8),id(9),{label:'Other synthetic',firstClassLocalDate:'',proposedCapacity:''}));
  for(const response of [no('FORBIDDEN'),ok({kind:'list',page:{version:GROUP_PREPARATION_LIST_VERSION,items:[record,{...other,classification:'confirmed'}],nextCursor:null}}),
   ok({kind:'list',page:{version:GROUP_PREPARATION_LIST_VERSION,items:[other,record],nextCursor:null}})]){
   const result=await createGroupPreparationClient({fetch:async()=>response}).list();
   expect(result.state).toBe('failed');expect(result).not.toHaveProperty('value');
  }
 });
 it('binds a historical read to both selected group and revision; invalid query values make no fetch',async()=>{
  const record=saved(fresh()),transport=vi.fn<typeof fetch>().mockResolvedValue(ok({kind:'record',record}));
  const client=createGroupPreparationClient({fetch:transport});
  expect(await client.record(group,2)).toMatchObject({state:'failed',code:'UNAVAILABLE'});
  transport.mockClear();expect(await client.record(group,1.5)).toMatchObject({state:'failed',code:'INVALID_REQUEST'});
  expect(await client.record('not-an-id')).toMatchObject({state:'failed',code:'INVALID_REQUEST'});expect(transport).not.toHaveBeenCalled();
  expect(groupPreparationHref('he',group,2)).toBe('/he/app/fishing-groups?groupId='+group+'&revision=2');
  expect(()=>groupPreparationHref('en',undefined,2)).toThrow();
 });
 it('creates unset facts as null, preserves zero, and never invents a venue, period or exact time',()=>{
  expect(fresh().command).toMatchObject({expectedRevision:0,fields:{period:null,firstClassAt:null,firstClassLocalDate:null,venueSource:null,proposedCapacity:null}});
  expect(createGroupDraft(group,operation,{label:'Synthetic',firstClassLocalDate:'',proposedCapacity:'0'}).command).toMatchObject({fields:{proposedCapacity:0}});
  expect(()=>createGroupDraft(group,operation,{label:'Synthetic',firstClassLocalDate:'',proposedCapacity:'-1'})).toThrow();
 });
 it('emits only changed fields; blank explicitly clears while omitted venue/period/time stay preserved',()=>{
  const original=saved(fresh(),{fields:{...saved(fresh()).fields,firstClassLocalDate:'2026-11-20',proposedCapacity:10,venueSource:{id:'synthetic-venue-v1',sha256:'c'.repeat(64)}}});
  expect(editGroupDraft(original,id(10),groupDraftInputs(original))).toBeNull();
  const edit=editGroupDraft(original,id(11),{label:original.fields.label,firstClassLocalDate:'',proposedCapacity:''})!;
  expect(edit.command).toMatchObject({action:'edit',expectedRevision:1,fields:{firstClassLocalDate:null,proposedCapacity:null}});
  expect(edit.command.action==='edit'?Object.keys(edit.command.fields):[]).toEqual(['firstClassLocalDate','proposedCapacity']);
  expect(original.fields.proposedCapacity).toBe(10);
 });
 it('rejects a date inconsistent with preserved exact time and rejects edits to a cancelled draft',()=>{
  const original=saved(fresh(),{fields:{...saved(fresh()).fields,firstClassAt:'2026-11-20T18:00:00.000Z',firstClassLocalDate:'2026-11-20'}});
  expect(()=>editGroupDraft(original,id(11),{...groupDraftInputs(original),firstClassLocalDate:'2026-11-21'})).toThrow();
  const cancelled={...original,revision:2,state:'cancelled' as const,action:'cancel' as const,previousDigest:'b'.repeat(64)};
  expect(()=>editGroupDraft(cancelled,id(11),groupDraftInputs(cancelled))).toThrow();
  expect(groupSaveMatches(fresh(),{...original,operationId:id(99)})).toBe(false);
 });
});
