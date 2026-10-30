import {randomUUID} from 'node:crypto';
import {expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {privateBnaReplyHttp} from '../../src/features/bna-communications/reply-http.ts';
import {AppError} from '../../src/lib/errors.ts';
import type {Actor} from '../../src/features/identity/types.ts';
const origin='https://life-skills.example.invalid',path='/api/private/bna-mailbox-replies',session='a'.repeat(43),csrf='b'.repeat(43),id=randomUUID();
function fixture(){
 const actor={id:randomUUID(),workspaceId:randomUUID(),role:'practitioner',state:'active'} as Actor;
 const readOwner=vi.fn(async()=>({inquiryId:id,items:[],nextCursor:null})),markReviewed=vi.fn(async()=>({state:'reviewed' as const,version:2,replayed:false}));
 const deps={enabled:true,origin,actor:vi.fn(async()=>actor),csrf:()=>csrf,limits:{consume:async()=>({count:1,retryAfterMs:0})},rateLimitKey:'synthetic-bna-reply-rate-key-at-least-32',store:{readOwner,markReviewed},monitor:{status:vi.fn(async()=>({state:'unconnected' as const,lastCheckedAt:null,coverageFrom:null}))}};
 const load=vi.fn(async()=>deps);
 const request=(query='',method='GET',body?:unknown,headers:Record<string,string>={})=>new Request(origin+path+query,{method,
  headers:{host:'life-skills.example.invalid','x-forwarded-proto':'https',origin,'content-type':'application/json',cookie:`__Host-ls-session=${session}`,'x-csrf-token':csrf,...headers},...(body?{body:JSON.stringify(body)}:{})});
 return {actor,readOwner,markReviewed,deps,load,request};
}
it('requires one owner session and a mounted feature; reads never trigger a mailbox scan or a mutation',async()=>{
 const f=fixture();for(const cookie of ['',`__Host-ls-session=${session}; __Host-ls-session=${session}`,'__Host-ls-session=invalid'])expect((await privateBnaReplyHttp(f.request('?id='+id,'GET',undefined,{cookie}),f.load)).status).toBe(401);
 expect(f.load).not.toHaveBeenCalled();const result=await privateBnaReplyHttp(f.request('?id='+id),f.load);expect(result.status).toBe(200);
 expect(f.readOwner).toHaveBeenCalledWith(f.actor,id,undefined);expect(f.markReviewed).not.toHaveBeenCalled();
 expect(result.headers.get('cache-control')).toContain('no-store');expect(result.headers.get('referrer-policy')).toBe('no-referrer');expect(result.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
 f.deps.enabled=false;expect((await privateBnaReplyHttp(f.request('?id='+id),f.load)).status).toBe(404);
 f.deps.enabled=true;f.actor.role='parent';expect((await privateBnaReplyHttp(f.request('?id='+id),f.load)).status).toBe(403);expect(f.readOwner).toHaveBeenCalledTimes(1);
});
it('permits only one inquiry and a bounded cursor, not provider, program, mailbox or source selection',async()=>{
 const f=fixture();for(const query of ['', '?id=bad',`?id=${id}&id=${id}`,`?id=${id}&before=`, `?id=${id}&mailbox=other`,`?id=${id}&program=bna_learning_coop`,`?id=${id}&source=service`,`?id=${id}&before=${'x'.repeat(2049)}`])
  expect((await privateBnaReplyHttp(f.request(query),f.load)).status).toBe(400);
 expect(f.readOwner).not.toHaveBeenCalled();const cursor='c'.repeat(100);expect((await privateBnaReplyHttp(f.request(`?before=${cursor}&id=${id}`),f.load)).status).toBe(200);expect(f.readOwner).toHaveBeenCalledWith(f.actor,id,cursor);
});
it('review requires same-origin CSRF and passes the exact immutable operation/version to the native owner store',async()=>{
 const f=fixture(),command={action:'mark_reviewed',receiptId:randomUUID(),operationId:randomUUID(),expectedVersion:1};
 for(const headers of [{'x-csrf-token':'wrong'},{origin:'https://other.invalid'}])expect((await privateBnaReplyHttp(f.request('','POST',command,headers),f.load)).status).toBe(403);
 expect(f.markReviewed).not.toHaveBeenCalled();expect((await privateBnaReplyHttp(f.request('','POST',command),f.load)).status).toBe(200);expect(f.markReviewed).toHaveBeenCalledWith(f.actor,command);
 f.markReviewed.mockResolvedValueOnce({state:'reviewed',version:2,replayed:true});expect((await (await privateBnaReplyHttp(f.request('','POST',command),f.load)).json()).data).toMatchObject({replayed:true});
});
it('refuses browser-created receipts, send/scan commands, scope overrides, and oversized bodies',async()=>{
 const f=fixture(),command={action:'mark_reviewed',receiptId:randomUUID(),operationId:randomUUID(),expectedVersion:1};
 for(const input of [{...command,mailbox:'other@example.invalid'},{...command,providerMessageId:'forged'},{...command,workspaceId:randomUUID()},{...command,program:'bna_support_interest'},
  {...command,action:'scan'},{...command,action:'ingest'},{...command,action:'send'}])expect((await privateBnaReplyHttp(f.request('','POST',input),f.load)).status).toBe(400);
 expect((await privateBnaReplyHttp(f.request('?id='+id,'POST',command),f.load)).status).toBe(400);
 expect((await privateBnaReplyHttp(f.request('','POST',command,{'content-type':'text/plain'}),f.load)).status).toBe(415);
 expect((await privateBnaReplyHttp(f.request('','POST',{...command,raw:'x'.repeat(40000)}),f.load)).status).toBe(413);expect(f.markReviewed).not.toHaveBeenCalled();
});
it('preserves native access/version failures and sanitizes unexpected provider or storage errors',async()=>{
 const f=fixture();f.readOwner.mockRejectedValueOnce(new AppError('NOT_FOUND'));expect((await privateBnaReplyHttp(f.request('?id='+id),f.load)).status).toBe(404);
 f.readOwner.mockRejectedValueOnce(Error('PRIVATE_PROVIDER_TOKEN_DO_NOT_LOG'));const response=await privateBnaReplyHttp(f.request('?id='+id),f.load);expect(response.status).toBe(503);expect(await response.text()).not.toContain('PRIVATE_PROVIDER_TOKEN');
});
