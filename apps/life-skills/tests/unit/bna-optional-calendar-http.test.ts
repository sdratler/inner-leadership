import {randomUUID} from 'node:crypto';
import {expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {privateBnaOptionalCalendarHttp} from '../../src/features/bna-communications/optional-calendar-http.ts';
import type {BnaOptionalCalendarStore} from '../../src/features/bna-communications/optional-calendar-store.ts';
import type {Actor} from '../../src/features/identity/types.ts';
const origin='https://life-skills.example.invalid',path='/api/private/bna-optional-calendar',session='b'.repeat(43),csrf='c'.repeat(43),id=randomUUID();
const actor={id:randomUUID(),workspaceId:randomUUID(),role:'practitioner'} as Actor,auth={cookie:`__Host-ls-session=${session}`,'x-csrf-token':csrf};
const request=(method:string,suffix='',body?:unknown,headers:Record<string,string>={})=>new Request(origin+path+suffix,{method,headers:{host:'life-skills.example.invalid',origin,'x-forwarded-proto':'https','content-type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{})});
function fixture(){const readOwner=vi.fn(async()=>({next:null,sendingEnabled:false,history:[]})),prepare=vi.fn(async()=>({messageId:id,replayed:false})),command=vi.fn(async()=>({state:'canceled',replayed:false}));
 const deps={enabled:true,origin,actor:async()=>actor,csrf:()=>csrf,limits:{consume:async()=>({count:1,retryAfterMs:0})},rateLimitKey:'synthetic-optional-calendar-rate-key-at-least-32',store:{readOwner,prepare,command} as unknown as Pick<BnaOptionalCalendarStore,'readOwner'|'prepare'|'command'>};return {deps,readOwner,prepare,command};}
it('requires a real private session, exact single inquiry query and owner store readback',async()=>{
 const f=fixture(),response=await privateBnaOptionalCalendarHttp(request('GET','?id='+id,undefined,auth),async()=>f.deps);
 expect(response.status).toBe(200);expect(f.readOwner).toHaveBeenCalledWith(actor,id);expect(f.prepare).not.toHaveBeenCalled();expect(f.command).not.toHaveBeenCalled();
 expect(response.headers.get('cache-control')).toContain('no-store');expect(response.headers.get('referrer-policy')).toBe('no-referrer');
 for(const suffix of ['?id='+id+'&id='+id,'?id='+id+'&workspaceId='+randomUUID(),'?id=invalid'])expect((await privateBnaOptionalCalendarHttp(request('GET',suffix,undefined,auth),async()=>f.deps)).status).toBe(400);
 expect((await privateBnaOptionalCalendarHttp(request('GET','?id='+id),async()=>f.deps)).status).toBe(401);
 expect((await privateBnaOptionalCalendarHttp(request('GET','?id='+id,undefined,{...auth,cookie:auth.cookie+'; '+auth.cookie}),async()=>f.deps)).status).toBe(401);
 expect((await privateBnaOptionalCalendarHttp(request('GET','?id='+id,undefined,auth),async()=>({...f.deps,enabled:false}))).status).toBe(404);
});
it('permits only bounded versioned preparation/cancellation with exact origin and CSRF',async()=>{
 const f=fixture(),body={action:'prepare',inquiryId:id,templateId:'EMAIL-B1',operationId:randomUUID(),expectedPreferenceVersion:0};
 expect((await privateBnaOptionalCalendarHttp(request('POST','',body,auth),async()=>f.deps)).status).toBe(200);expect(f.prepare).toHaveBeenCalledWith(actor,body);
 for(const headers of [{...auth,origin:'https://attacker.invalid'},{...auth,'x-csrf-token':'d'.repeat(43)}])expect((await privateBnaOptionalCalendarHttp(request('POST','',body,headers),async()=>f.deps)).status).toBe(403);
 for(const value of [{...body,recipient:'someone@example.invalid'},{...body,templateId:'EMAIL-D0'},{...body,workspaceId:randomUUID()},{...body,expectedPreferenceVersion:-1}])expect((await privateBnaOptionalCalendarHttp(request('POST','',value,auth),async()=>f.deps)).status).toBe(400);
 const cancel={action:'cancel',messageId:id,operationId:randomUUID(),expectedVersion:1};expect((await privateBnaOptionalCalendarHttp(request('POST','',cancel,auth),async()=>f.deps)).status).toBe(200);expect(f.command).toHaveBeenCalledWith(actor,cancel);
 expect((await privateBnaOptionalCalendarHttp(request('POST','',body,{...auth,'content-type':'text/plain'}),async()=>f.deps)).status).toBe(415);
 expect(f.prepare).toHaveBeenCalledTimes(1);
});
