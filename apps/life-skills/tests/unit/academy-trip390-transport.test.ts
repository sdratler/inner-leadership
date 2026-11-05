import {currentTrip390Fields} from '../fixtures/trip390-current.ts';
import {randomUUID} from 'node:crypto';
import {describe,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {publicGroupApplicationHttp} from '../../src/features/group-application/http.ts';
import {TRIP390_MEDIA_TYPE,createTrip390Transport,trip390RouteMetadata} from '../../src/features/group-application/academy-trip390-transport.ts';
import {TRIP390_INTEREST_VERSION,TRIP390_NOTICE_VERSION,TRIP390_OFFER,trip390CommandSchema} from '../../src/features/group-application/academy-trip390-contract.ts';
import {verifyGroupApplicationChallenge} from '../../src/features/group-application/challenge.ts';
import {floridaGroupApplicationNotice} from '../../src/features/group-application/contract.ts';
import r2En from '../../src/features/group-application/academy-r2-en.json';
import r2He from '../../src/features/group-application/academy-r2-he.json';
import {trip390ReservationNotice} from '../../src/features/group-application/academy-trip390-reservation-notice.ts';
const origin='https://synthetic.example.invalid',host='synthetic.example.invalid',key='synthetic-trip390-unit-only-key-material';
const endpoint='/api/public/group-applications?program=sunday_fishing_academy';
const command=trip390CommandSchema.parse({operationId:randomUUID(),fields:currentTrip390Fields()});
const legacyFields={parentName:'Synthetic Parent',contact:'parent@example.invalid',language:'en',childAge:'10',cityArea:'Hollywood',neighborhood:'Example',programId:'sunday_fishing_academy',schedulePreference:['sunday'],scheduleNotes:'Synthetic',permission:{confirmed:true,version:floridaGroupApplicationNotice.version,language:'en'}};

function setup(offer:string=TRIP390_OFFER.version){
 let time=Date.now();const ref=randomUUID();
 const item={id:ref,source:'public_group_application',state:'owner_review',receivedAt:new Date(time).toISOString(),fields:command.fields};
 const submit=vi.fn().mockResolvedValue({saved:true,replayed:false,duplicate:false,item}),replaySaved=vi.fn(),afterCommit=vi.fn(),refreshFounder=vi.fn();
 const consume=vi.fn().mockResolvedValue({count:1,retryAfterMs:1000});
 const deps={trip390ReservationAdmitted:true,enabled:true,environment:{NODE_ENV:'production',LS_APP_ORIGIN:origin,LS_IDENTITY_ENABLED:'true',LS_ACADEMY_PUBLIC_OFFER:offer},challengeKey:key,now:()=>time,limits:{consume},store:{submit,replaySaved},afterCommit,refreshFounder};
 const load=vi.fn(async()=>deps);
 const get=(accept=TRIP390_MEDIA_TYPE,path=endpoint)=>publicGroupApplicationHttp(new Request(origin+path,{headers:{host,accept}}),load);
 const post=(body:unknown,cookie:string,accept=TRIP390_MEDIA_TYPE,extra:Record<string,string>={})=>publicGroupApplicationHttp(new Request(origin+endpoint,{method:'POST',headers:{host,origin,cookie,accept,'sec-fetch-site':'same-origin','content-type':'application/json',...extra},body:JSON.stringify(body)}),load);
 async function issue(accept=TRIP390_MEDIA_TYPE){const r=await get(accept);expect(r.status).toBe(200);const json=await r.json();return {challenge:json.data.challenge as string,cookie:r.headers.get('set-cookie')!.split(';')[0]!,notice:json.data.notice};}
 return {ref,get,post,issue,submit,replaySaved,afterCommit,refreshFounder,consume,load,advance:(ms:number)=>{time+=ms;},now:()=>time};
}

describe('Trip390 guest wire and recovery',()=>{
 it('binds the exact program, offer, acknowledgment and interest to the challenge and returns only the saved receipt',async()=>{
  const h=setup(),{challenge,cookie,notice}=await h.issue();
  expect(notice.he.interest).toBe(trip390ReservationNotice('he').acknowledgment);
  const body={...command,challenge,website:''};
  expect((await h.post(body,cookie)).status).toBe(403);
  h.advance(1600);
  expect(verifyGroupApplicationChallenge(challenge,key,h.now())).toMatchObject({v:6,programId:'sunday_fishing_academy',offerVersion:TRIP390_OFFER.version,version:TRIP390_INTEREST_VERSION,noticeVersion:TRIP390_NOTICE_VERSION});
  const saved=await h.post(body,cookie);expect(saved.status).toBe(201);
  expect((await saved.json()).data).toEqual({operationId:command.operationId,reference:h.ref,replayed:false,acknowledgment:'not_queued'});
  expect(h.submit).toHaveBeenCalledExactlyOnceWith(command);expect(h.consume).toHaveBeenCalledTimes(1);
  expect(h.afterCommit).not.toHaveBeenCalled();expect(h.refreshFounder).not.toHaveBeenCalled();
 });
 it('rejects both cross-version directions, cookie swaps, origin/CSRF tampering, honeypot, attribution and expiry before any save',async()=>{
  const h=setup(),a=await h.issue(),b=await h.issue(),legacy=await h.issue('application/json');h.advance(1600);
  const body={...command,challenge:a.challenge,website:''};
  for(const r of [
   await h.post(body,b.cookie),await h.post(body,''),await h.post({...body,challenge:legacy.challenge},legacy.cookie),
   await h.post(body,a.cookie,'application/json'),await h.post({...body,fields:legacyFields},a.cookie),await h.post(body,a.cookie,TRIP390_MEDIA_TYPE,{origin:'https://wrong.invalid'}),
   await h.post(body,a.cookie,TRIP390_MEDIA_TYPE,{'sec-fetch-site':'cross-site'}),await h.post({...body,website:'bot'},a.cookie),
   await h.post({...body,attribution:{}},a.cookie),await h.post({...body,fields:{...body.fields,offerVersion:'wrong'}},a.cookie),
  ])expect([400,403]).toContain(r.status);
  h.advance(30*60_000-1600);expect((await h.post(body,a.cookie)).status).toBe(403);
  expect(h.submit).not.toHaveBeenCalled();expect(h.replaySaved).not.toHaveBeenCalled();expect(h.consume).not.toHaveBeenCalled();
 });
 it('admits only the exact selector, Sunday program and existing one-key gateway route',async()=>{
  expect((await setup('').get()).status).toBe(404);expect((await setup('unknown').get()).status).toBe(503);
  const h=setup();
  expect((await h.get(TRIP390_MEDIA_TYPE,endpoint+'&version=other')).status).toBe(403);
  expect((await h.get(TRIP390_MEDIA_TYPE,endpoint.replace('sunday_fishing_academy','morning_torah_learning'))).status).toBe(403);
  expect((await h.get(TRIP390_MEDIA_TYPE+', application/json')).status).toBe(403);
 });
 it('uses exact receipt lookup for old Sunday submissions and suppresses every postcommit hook after cutover',async()=>{
  const h=setup(),{cookie,challenge}=await h.issue('application/json');h.advance(1600);
  const body={fields:legacyFields,operationId:randomUUID(),website:'',challenge};
  h.replaySaved.mockResolvedValueOnce(null).mockResolvedValueOnce({saved:true,replayed:true,duplicate:true,item:{id:h.ref},founder:{reference:h.ref}});
  expect((await h.post(body,cookie,'application/json')).status).toBe(400);
  expect((await h.post(body,cookie,'application/json')).status).toBe(200);
  expect(h.replaySaved).toHaveBeenCalledTimes(2);expect(h.submit).not.toHaveBeenCalled();expect(h.afterCommit).not.toHaveBeenCalled();expect(h.refreshFounder).not.toHaveBeenCalled();
 });
 it('runs the acknowledgment only after a fresh durable save and retains the lead when delivery fails',async()=>{
  const h=setup(),{challenge,cookie}=await h.issue();h.advance(1600);let durable=false;
  h.submit.mockImplementationOnce(async()=>{durable=true;return {saved:true,replayed:false,duplicate:false,item:{id:h.ref},acknowledgment:'queued'};});
  h.afterCommit.mockImplementationOnce(async()=>{expect(durable).toBe(true);throw Error('SYNTHETIC_DELIVERY_PROBLEM');});
  const response=await h.post({...command,challenge,website:''},cookie);expect(response.status).toBe(201);
  expect((await response.json()).data).toEqual({reference:h.ref,operationId:command.operationId,acknowledgment:'unknown',replayed:false});
  expect(h.afterCommit).toHaveBeenCalledExactlyOnceWith(h.ref);
 });
 it('does not send retroactively for duplicate/same-command receipt recovery or failed saving',async()=>{
  const h=setup(),{challenge,cookie}=await h.issue();h.advance(1600);const body={...command,challenge,website:''};
  h.replaySaved.mockResolvedValueOnce({saved:true,replayed:true,duplicate:true,item:{id:h.ref},acknowledgment:'queued'});
  expect((await h.post(body,cookie)).status).toBe(200);expect(h.afterCommit).not.toHaveBeenCalled();
  h.submit.mockResolvedValueOnce({saved:true,replayed:false,duplicate:true,item:{id:h.ref},acknowledgment:'queued'});
  expect((await h.post(body,cookie)).status).toBe(200);expect(h.afterCommit).not.toHaveBeenCalled();
  h.submit.mockRejectedValueOnce(Error('SYNTHETIC_SAVE_FAILURE'));expect((await h.post(body,cookie)).status).toBe(503);expect(h.afterCommit).not.toHaveBeenCalled();
 });
 it.each(['sent','queued','not_requested'] as const)('returns a recoverable saved receipt for callback outcome %s',async outcome=>{
  const h=setup(),{challenge,cookie}=await h.issue();h.advance(1600);
  h.submit.mockResolvedValueOnce({saved:true,replayed:false,duplicate:false,item:{id:h.ref},acknowledgment:'queued'});
  h.afterCommit.mockResolvedValueOnce(outcome);
  const response=await h.post({...command,challenge,website:''},cookie);expect(response.status).toBe(201);
  expect((await response.json()).data).toEqual({reference:h.ref,operationId:command.operationId,replayed:false,acknowledgment:outcome==='not_requested'?'not_queued':outcome});
  expect(h.afterCommit).toHaveBeenCalledExactlyOnceWith(h.ref);
 });
 it('keeps a lost write locked across failed GETs and definitive retry rejection; only a matching persisted receipt resolves it',async()=>{
  const h=setup(),posted:unknown[]=[];let cookie='',attempt=0,getCount=0;
  const fetcher:typeof fetch=async(url,init)=>{
   expect(url).toBe(endpoint);expect(init).toMatchObject({credentials:'same-origin',cache:'no-store',headers:{Accept:TRIP390_MEDIA_TYPE}});
   if(init?.method!=='POST'){
    if(++getCount===2)return new Response(null,{status:503});
    const r=await h.get();cookie=r.headers.get('set-cookie')!.split(';')[0]!;return r;
   }
   const body=JSON.parse(String(init.body));posted.push({operationId:body.operationId,fields:body.fields});attempt++;
   if(attempt===2)return Response.json({ok:false,error:{code:'INVALID_REQUEST'},requestId:randomUUID()},{status:400});
   const r=await h.post(body,cookie);
   if(attempt===1)throw new TypeError('synthetic committed reply lost');
   if(attempt===3)return Response.json({ok:true,data:{reference:h.ref,operationId:randomUUID(),acknowledgment:'not_queued',replayed:true},requestId:randomUUID()});
   return r;
  };
  const save=createTrip390Transport(fetcher,async ms=>{h.advance(ms);});
  expect(await save(command)).toEqual({state:'unknown'});
  expect(await save({...command,operationId:randomUUID()})).toEqual({state:'conflict'});
  for(let i=0;i<3;i++)expect(await save(command)).toEqual({state:'unknown'});
  expect(await save(command)).toEqual({state:'saved',reference:h.ref,operationId:command.operationId,email:'not_queued'});
  expect(posted).toEqual([command,command,command,command]);
 });
 it.each(['en','he'] as const)('derives current canonical, social and alternate URLs for %s on both existing route aliases',locale=>{
  for(const mode of ['bna','legacy'] as const)for(const path of ['','/apply'] as const){
   const meta=trip390RouteMetadata(locale,path,mode);
   expect(meta.alternates.canonical).toBe((mode==='legacy'?'https://life-skills.bneineviimacademy.org/'+locale+'/florida':'https://bneineviimacademy.org'+(locale==='he'?'/he':'')+'/fishing-academy')+path);
   expect(meta.openGraph.url).toBe(meta.alternates.canonical);expect(meta.description).toBe((locale==='he'?r2He:r2En).metaDescription);expect(meta.twitter.description).toBe((locale==='he'?r2He:r2En).metaDescription);
   expect(meta.openGraph.images[0]!.url).toContain('/groups/brand/jlfa-logo-locked-v1.png');expect(meta.robots).toEqual({index:false,follow:false});
  }
 });
});
