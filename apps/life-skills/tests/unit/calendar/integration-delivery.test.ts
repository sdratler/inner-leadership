import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../../src/lib/errors.ts';
import { SESSION_COOKIE } from '../../../src/lib/security/session.ts';
import { handleCalendar } from '../../../src/features/calendar/http.ts';

const f=vi.hoisted(()=>({command:vi.fn(),read:vi.fn(),drain:vi.fn(),actor:vi.fn(),audit:vi.fn(),limit:vi.fn()}));
vi.mock('../../../src/features/calendar/relay.ts',()=>({drainCalendarEventsIsolated:f.drain}));
vi.mock('../../../src/features/calendar/runtime.ts',()=>({calendarRuntime:async()=>({
 identity:{config:{origin:'https://app.example.test',rateLimitKey:'r'.repeat(64)},services:{
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
 vi.resetAllMocks();
 f.actor.mockResolvedValue({id:'70000000-0000-4000-8000-000000000002',workspaceId:'70000000-0000-4000-8000-000000000001',role:'practitioner',state:'active'});
 f.limit.mockResolvedValue({count:1,retryAfterMs:0});f.command.mockResolvedValue(result);
 f.read.mockImplementation(async(_actor,work)=>work({}));f.drain.mockResolvedValue({delivered:1,deferred:0});
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
