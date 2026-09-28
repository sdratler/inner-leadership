import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../../src/lib/errors.ts';
import { SESSION_COOKIE } from '../../../src/lib/security/session.ts';
import { handleCalendar } from '../../../src/features/calendar/http.ts';
import { InternalTaskService } from '../../../src/features/calendar/tasks.ts';

const f=vi.hoisted(()=>({command:vi.fn(),read:vi.fn(),drain:vi.fn(),actor:vi.fn(),audit:vi.fn(),limit:vi.fn(),prospects:vi.fn()}));
vi.mock('../../../src/features/calendar/relay.ts',()=>({drainCalendarEventsIsolated:f.drain}));
vi.mock('../../../src/features/prospects/bridge.ts',()=>({listProspects:f.prospects}));
vi.mock('../../../src/features/calendar/runtime.ts',()=>({calendarRuntime:async()=>({
 identity:{config:{origin:'https://app.example.test',rateLimitKey:'r'.repeat(64),lookupKey:Buffer.alloc(32,9)},services:{
  sessions:{actor:f.actor,csrf:()=> 'c'.repeat(43)},limits:{consume:f.limit},audit:{write:f.audit},
 }},service:{recordAttendance:f.command,receiveNotice:f.command,db:{read:f.read}},
})}));
const id='70000000-0000-4000-8000-000000000099';
const result={id,version:2,attendance:{state:'present',attended:true,version:1}};
function request(extra:Record<string,string>={}){
 return new Request(`https://app.example.test/api/calendar/appointments/${id}/attendance`,{method:'POST',headers:{
  origin:'https://app.example.test','sec-fetch-site':'same-origin','content-type':'application/json',
  cookie:`${SESSION_COOKIE}=${'t'.repeat(43)}`,'x-csrf-token':'c'.repeat(43),'idempotency-key':'synthetic-command-20260913',...extra,
 },body:JSON.stringify({state:'present',arrivedAt:'2026-09-13T10:00:00Z',expectedVersion:0,correctionReason:null})});
}
beforeEach(()=>{
 vi.restoreAllMocks();
 vi.resetAllMocks();
 f.actor.mockResolvedValue({id:'70000000-0000-4000-8000-000000000002',workspaceId:'70000000-0000-4000-8000-000000000001',role:'practitioner',state:'active'});
 f.limit.mockResolvedValue({count:1,retryAfterMs:0});f.command.mockResolvedValue(result);
 f.read.mockImplementation(async(_actor,work)=>work({}));f.drain.mockResolvedValue({delivered:1,deferred:0});
 f.prospects.mockResolvedValue([]);
});

function syncRequest(extra:Record<string,string>={},body:unknown={}){
 return new Request('https://app.example.test/api/calendar/tasks/sync-followups',{method:'POST',headers:request(extra).headers,body:JSON.stringify(body)});
}
describe('privacy-safe task sync transport diagnostics',()=>{
 it('records only a constant source-read phase and normalized code, not provider failure contents',async()=>{
  const privateMessage='Synthetic private contact, token and SQL values must not be logged';
  const error=new Error(privateMessage,{cause:{secret:privateMessage}});f.prospects.mockRejectedValue(error);
  const log=vi.spyOn(console,'error').mockImplementation(()=>{});
  const sync=vi.spyOn(InternalTaskService.prototype,'syncCrmFollowups');
  const response=await handleCalendar(syncRequest(),['tasks','sync-followups']);
  const body=await response.json();expect(response.status).toBe(500);expect(body.error.code).toBe('INTERNAL');
  expect(sync).not.toHaveBeenCalled();expect(f.drain).not.toHaveBeenCalled();
  expect(log).toHaveBeenCalledOnce();expect(JSON.parse(log.mock.calls[0]![0])).toEqual({event:'calendar_task_sync_failed',requestId:body.requestId,phase:'crm-read',errorKind:'Error',code:'INTERNAL'});
  expect(JSON.stringify(log.mock.calls)).not.toContain(privateMessage);
 });
 it.each([[new TypeError('Synthetic confidential payload'),'TypeError','INTERNAL',500],[new ReferenceError('Synthetic confidential payload'),'ReferenceError','INTERNAL',500],[new AppError('UNAVAILABLE'),'AppError','UNAVAILABLE',503]] as const)('distinguishes actual internal sync failures without exposing their payload: %s',async(error,errorKind,code,status)=>{
  const sync=vi.spyOn(InternalTaskService.prototype,'syncCrmFollowups').mockRejectedValue(error),log=vi.spyOn(console,'error').mockImplementation(()=>{});
  const response=await handleCalendar(syncRequest(),['tasks','sync-followups']);const body=await response.json();
  expect(response.status).toBe(status);expect(body.error.code).toBe(code);expect(sync).toHaveBeenCalledWith(expect.objectContaining({role:'practitioner'}),[]);
  expect(JSON.parse(log.mock.calls[0]![0])).toEqual({event:'calendar_task_sync_failed',requestId:body.requestId,phase:'task-sync',errorKind,code});
  expect(JSON.stringify(log.mock.calls)).not.toContain('Synthetic confidential');expect(f.drain).not.toHaveBeenCalled();
 });
 it('cannot turn a failed log sink into a different command result',async()=>{
  f.prospects.mockRejectedValue(new AppError('UNAVAILABLE'));vi.spyOn(console,'error').mockImplementation(()=>{throw new Error('Synthetic unavailable log sink');});
  const response=await handleCalendar(syncRequest(),['tasks','sync-followups']);expect(response.status).toBe(503);expect((await response.json()).error.code).toBe('UNAVAILABLE');
 });
 it('keeps successful sync free of failure logs, provider delivery and payment effects',async()=>{
  const result={created:0,updated:0,resolved:0,unchanged:0},sync=vi.spyOn(InternalTaskService.prototype,'syncCrmFollowups').mockResolvedValue(result),log=vi.spyOn(console,'error').mockImplementation(()=>{});
  const response=await handleCalendar(syncRequest(),['tasks','sync-followups']);expect(response.status).toBe(200);expect((await response.json()).data).toEqual(result);
  expect(sync).toHaveBeenCalledOnce();expect(log).not.toHaveBeenCalled();expect(f.drain).not.toHaveBeenCalled();expect(f.command).not.toHaveBeenCalled();
 });
 it.each([{origin:'https://other.example.test'},{'x-csrf-token':'x'.repeat(43)},{cookie:''}])('preserves origin, CSRF and missing-session denial before source/task access: %s',async(headers)=>{
  const sync=vi.spyOn(InternalTaskService.prototype,'syncCrmFollowups');vi.spyOn(console,'error').mockImplementation(()=>{});
  const response=await handleCalendar(syncRequest(headers),['tasks','sync-followups']);expect([401,403]).toContain(response.status);expect(f.prospects).not.toHaveBeenCalled();expect(sync).not.toHaveBeenCalled();expect(f.drain).not.toHaveBeenCalled();
 });
 it('keeps parent roles out of practitioner source sync and diagnostic logs',async()=>{
  f.actor.mockResolvedValue({id:'70000000-0000-4000-8000-000000000003',workspaceId:'70000000-0000-4000-8000-000000000001',role:'parent',state:'active'});const sync=vi.spyOn(InternalTaskService.prototype,'syncCrmFollowups'),log=vi.spyOn(console,'error').mockImplementation(()=>{});
  const response=await handleCalendar(syncRequest(),['tasks','sync-followups']);expect(response.status).toBe(403);expect(f.prospects).not.toHaveBeenCalled();expect(sync).not.toHaveBeenCalled();expect(log).not.toHaveBeenCalled();
 });
 it('rejects browser-supplied source rows before reading or mutating any CRM/task data',async()=>{
  const sync=vi.spyOn(InternalTaskService.prototype,'syncCrmFollowups'),log=vi.spyOn(console,'error').mockImplementation(()=>{});
  const response=await handleCalendar(syncRequest({}, {rows:[{name:'Synthetic untrusted caller row'}]}),['tasks','sync-followups']);expect(response.status).toBe(400);
  expect(f.prospects).not.toHaveBeenCalled();expect(sync).not.toHaveBeenCalled();expect(JSON.parse(log.mock.calls[0]![0])).toMatchObject({phase:'body',code:'INVALID_REQUEST'});expect(JSON.stringify(log.mock.calls)).not.toContain('Synthetic untrusted');
 });
});
describe('calendar command acknowledgement and delivery boundary',()=>{
 it('acknowledges the committed command if the separate delivery transaction is unavailable',async()=>{
  f.read.mockRejectedValue(new Error('Synthetic private SQL failure text must not escape'));
  const response=await handleCalendar(request(),['appointments',id,'attendance']);
  expect(response.status).toBe(200);expect(await response.json()).toMatchObject({ok:true,data:result});
  expect(response.headers.get('X-Life-Skills-Credit-Delivery')).toBe('deferred');
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');expect(f.command).toHaveBeenCalledOnce();
 });
 it('keeps deferred delivery distinct from command failure without leaking event counts',async()=>{
  f.drain.mockResolvedValue({delivered:1,deferred:2});
  const response=await handleCalendar(request(),['appointments',id,'attendance']);
  expect(response.status).toBe(200);expect(response.headers.get('X-Life-Skills-Credit-Delivery')).toBe('deferred');
  const body=await response.json();expect(body.data).toEqual(result);expect(body).not.toHaveProperty('deferred');
 });
 it('retries only the appointment named by the successfully authorized command',async()=>{
  const response=await handleCalendar(request(),['appointments',id,'attendance']);
  expect(response.status).toBe(200);expect(response.headers.get('X-Life-Skills-Credit-Delivery')).toBe('attempted');
  expect(f.drain).toHaveBeenCalledWith({},'credit_effect',expect.any(Function),25,id);
  expect(f.command.mock.invocationCallOrder[0]).toBeLessThan(f.read.mock.invocationCallOrder[0]!);
 });
 it('does not expose workspace delivery state to a parent making an authorized notice',async()=>{
  f.actor.mockResolvedValue({id:'70000000-0000-4000-8000-000000000003',workspaceId:'70000000-0000-4000-8000-000000000001',role:'parent',state:'active'});
  f.drain.mockResolvedValue({delivered:0,deferred:1});
  const base=request();const notice=new Request(base.url,{method:'POST',headers:base.headers,body:JSON.stringify({kind:'cancel',proposedWindows:[]})});
  const response=await handleCalendar(notice,['appointments',id,'notice']);
  expect(response.status).toBe(200);expect(response.headers.has('X-Life-Skills-Credit-Delivery')).toBe(false);
  expect((await response.json()).data).toEqual(result);
 });
 it('does not drain or report success when the command actually failed',async()=>{
  f.command.mockRejectedValue(new AppError('CONFLICT'));
  const response=await handleCalendar(request(),['appointments',id,'attendance']);
  expect(response.status).toBe(409);expect((await response.json()).ok).toBe(false);expect(f.read).not.toHaveBeenCalled();
 });
 it.each([{origin:'https://other.example.test'},{'x-csrf-token':'x'.repeat(43)}])('retains real origin and CSRF denial gates: %s',async(headers)=>{
  const response=await handleCalendar(request(headers),['appointments',id,'attendance']);
  expect(response.status).toBe(403);expect(f.command).not.toHaveBeenCalled();expect(f.read).not.toHaveBeenCalled();
 });
});
