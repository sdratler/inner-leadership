import {expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {keysConnectionHttp} from '../../src/features/keys-trip/connection-http.ts';
const endpoint='https://example.invalid/api/private/keys-chat';
const request=(headers:Record<string,string>={},body='{}')=>new Request(endpoint,{method:'POST',headers:{'content-type':'application/json',...headers},body});
it('denies disabled, unsigned and wrong-path callers without invoking a store',async()=>{
 const executeSigned=vi.fn();expect((await keysConnectionHttp(request(),async()=>({enabled:false,store:null}))).status).toBe(404);
 expect((await keysConnectionHttp(request({cookie:'__Host-ls-session=ignored'}),async()=>({enabled:true,store:{executeSigned}}))).status).toBe(401);
 expect((await keysConnectionHttp(new Request(endpoint+'?extra=true',{method:'POST'}),async()=>({enabled:true,store:{executeSigned}}))).status).toBe(404);expect(executeSigned).not.toHaveBeenCalled();
});
it('bounds actual bytes and forwards only the exact body and signature',async()=>{
 const executeSigned=vi.fn(async()=>({items:[],nextCursor:null})),load=async()=>({enabled:true,store:{executeSigned}});
 expect((await keysConnectionHttp(request({'x-jlfa-signature':'0'.repeat(64)},'x'.repeat(17000)),load)).status).toBe(413);expect(executeSigned).not.toHaveBeenCalled();
 const body='{"synthetic":true}',response=await keysConnectionHttp(request({'x-jlfa-signature':'1'.repeat(64)},body),load);
 expect(executeSigned).toHaveBeenCalledWith(body,'1'.repeat(64));expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toContain('no-store');
});
