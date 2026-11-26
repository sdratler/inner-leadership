import {expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {keysInterestHttp,keysInterestOwnerHttp,type KeysPublicDependencies,type KeysPrivateDependencies} from '../../src/features/keys-trip/http.ts';
import {keysFixture} from '../fixtures/keys-trip.ts';
import {KEYS_CONSENT,KEYS_TRIP} from '../../src/features/keys-trip/contract.ts';
import {SESSION_COOKIE} from '../../src/lib/security/session.ts';
const origin='https://fishing.example',now=()=>Date.parse('2026-11-26T20:00:00Z');
const headers={'host':'fishing.example','x-forwarded-host':'fishing.example','x-forwarded-proto':'https',origin, 'sec-fetch-site':'same-origin','content-type':'application/json'};
function dependencies(){const submit=vi.fn(async(input:ReturnType<typeof keysFixture>)=>({saved:true as const,replayed:false,duplicate:false,item:{id:'11111111-1111-4111-8111-111111111111',source:'public_group_application' as const,state:'owner_review' as const,receivedAt:new Date(now()).toISOString(),fields:input.fields}}));return {enabled:true,origin,challengeKey:'synthetic-keys-challenge-key-at-least32chars',now,limits:{consume:vi.fn(async()=>({count:1,retryAfterMs:0}))},store:{submit}} as unknown as KeysPublicDependencies;}
async function setup(d=dependencies()){const get=await keysInterestHttp(new Request(origin+'/api/public/keys-interest',{headers}),async()=>d);const body=await get.json();return {d,get,body,challenge:body.data.challenge as string,cookie:get.headers.get('set-cookie')!.split(';')[0]!};}
function post(input:unknown,cookieValue:string,changes:Record<string,string>={}){return new Request(origin+'/api/public/keys-interest',{method:'POST',headers:{...headers,cookie:cookieValue,...changes},body:JSON.stringify(input)});}
it('issues cookie-bound current consent, saves without private-field echo or dispatch',async()=>{
 const s=await setup(),input=keysFixture();expect(s.get.status).toBe(200);expect(s.body.data).toMatchObject({trip:KEYS_TRIP,consent:KEYS_CONSENT});
 const response=await keysInterestHttp(post({...input,challenge:s.challenge,website:''},s.cookie),async()=>s.d),body=await response.json();expect(response.status).toBe(201);expect(body.data).toMatchObject({saved:true,operationId:input.operationId});expect(JSON.stringify(body)).not.toContain(input.fields.email);expect(JSON.stringify(body)).not.toContain(input.fields.children[0]!.name);expect(s.d.store.submit).toHaveBeenCalledExactlyOnceWith(input);
 expect(response.headers.get('cache-control')).toBe('private, no-store');
});
it('refuses wrong or missing cookie, forged/expired challenge, cross-origin and cross-site requests before save',async()=>{
 const s=await setup(),input={...keysFixture(),challenge:s.challenge,website:''};
 for(const [cookieValue,changes] of [['',{}],['ls_keys_interest='+'a'.repeat(43),{}],[s.cookie,{origin:'https://other.example'}],[s.cookie,{'sec-fetch-site':'cross-site'}]] as const){const r=await keysInterestHttp(post(input,cookieValue,changes),async()=>s.d);expect(r.status).toBe(403);}
 const forged=await keysInterestHttp(post({...input,challenge:s.challenge.slice(0,-1)+(s.challenge.endsWith('a')?'b':'a')},s.cookie),async()=>s.d);expect(forged.status).toBe(403);
 const late={...s.d,now:()=>now()+31*60_000};expect((await keysInterestHttp(post(input,s.cookie),async()=>late)).status).toBe(403);expect(s.d.store.submit).not.toHaveBeenCalled();
});
it('rejects malformed requests and a closed collection path',async()=>{
 const s=await setup();expect((await keysInterestHttp(post({...keysFixture(),challenge:s.challenge,website:'spam'},s.cookie),async()=>s.d)).status).toBe(400);
 expect((await keysInterestHttp(new Request(origin+'/api/public/keys-interest',{headers}),async()=>({...s.d,enabled:false}))).status).toBe(404);expect(s.d.store.submit).not.toHaveBeenCalled();
});
it('private endpoints require session and CSRF; never deserialize a supplied actor',async()=>{
 const d={enabled:true,origin,actor:vi.fn(async()=>({id:'server-owner',workspaceId:'server-workspace'})),csrf:()=> 'b'.repeat(43),limits:{consume:vi.fn(async()=>({count:1,retryAfterMs:0}))},rateLimitKey:'synthetic-key',store:{listPage:vi.fn(async()=>({items:[],nextCursor:null})),read:vi.fn(),update:vi.fn(),summary:vi.fn()}} as unknown as KeysPrivateDependencies;
 expect((await keysInterestOwnerHttp(new Request(origin+'/api/private/keys-interest',{headers}),async()=>d)).status).toBe(401);
 const request=new Request(origin+'/api/private/keys-interest',{method:'POST',headers:{...headers,cookie:SESSION_COOKIE+'='+'a'.repeat(43)},body:'{}'});expect((await keysInterestOwnerHttp(request,async()=>d)).status).toBe(403);expect(d.store.update).not.toHaveBeenCalled();
 const get=new Request(origin+'/api/private/keys-interest?actor=someone',{headers:{...headers,cookie:SESSION_COOKIE+'='+'a'.repeat(43)}});expect((await keysInterestOwnerHttp(get,async()=>d)).status).toBe(400);
});
