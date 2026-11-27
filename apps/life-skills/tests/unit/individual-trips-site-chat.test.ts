import { createHmac,randomUUID } from 'node:crypto';
import { afterAll,beforeAll,beforeEach,describe,expect,it,vi } from 'vitest';
vi.mock('server-only',()=>({}));
import { tripDatabase } from '../fixtures/individual-trips-database.ts';
import { IndividualTripOwnerChat } from '../../src/features/individual-trips/owner-chat.ts';
import { IndividualTripSiteChat,canonicalTripSite,tripSiteSignature,tripSiteConfig,type SignedTripSiteInput } from '../../src/features/individual-trips/site-chat.ts';
import { TRIP_SITE_ID,TRIP_SITE_COMMAND_TYPES,tripSiteCallerFromHash,tripSiteOwnerLoginHref,tripSiteOwnerReturn } from '../../src/features/individual-trips/site-chat-contract.ts';
import { IdentitySessions } from '../../src/features/identity/session-adapter.ts';
import { IdentityAuthService } from '../../src/features/identity/auth-service.ts';
import { PostgresIdentityRateStore } from '../../src/features/identity/rate-store.ts';
import { IndividualTripsHttp } from '../../src/features/individual-trips/http.ts';
import { IndividualTripRegistrationService } from '../../src/features/individual-trips/registration-service.ts';
import type { TripDepartureInput } from '../../src/features/individual-trips/contract.ts';
import { loginReturnDestination } from '../../src/features/identity/login-return.ts';

let fx:Awaited<ReturnType<typeof tripDatabase>>,chat:IndividualTripOwnerChat,site:IndividualTripSiteChat,http:IndividualTripsHttp,sessions:IdentitySessions;
const signingKey='S'.repeat(43),callerId='site_'+'a'.repeat(43),network=vi.fn(async()=>{throw new Error('REAL_NETWORK_NOT_ADMITTED');});
const body=(extra:Partial<SignedTripSiteInput>={}):SignedTripSiteInput=>({siteId:TRIP_SITE_ID,callerId,nonce:randomUUID(),timestamp:fx.clock.now().getTime(),action:'read',...extra});
const invoke=(input:SignedTripSiteInput)=>site.execute(input,tripSiteSignature(signingKey,input));
async function pair(minutes=10){return chat.connectSite(fx.owner.actor,{callerId,minutes});}
function departure():TripDepartureInput {
 const date=new Date(fx.clock.now().getTime()+14*86400000);date.setUTCDate(date.getUTCDate()+(7-date.getUTCDay())%7);const day=date.toISOString().slice(0,10);
 return{kind:'local',title:'Synthetic Site outing',desiredChildLimit:10,activityChildLimit:10,sonAttending:true,otherNonpayingChildren:[{id:randomUUID(),name:'Private Nonpaying Child'}],
  transport:{verified:false,totalSeats:0,driverAdults:1,otherAdults:0,vehicleId:'synthetic-vehicle'},ownerResourceId:'synthetic-owner',minimumPaid:1,operationalReady:false,
  pickupHub:{id:'synthetic-hub',label:'Synthetic hub',permissionConfirmed:false},departureAt:day+'T15:00:00Z',returnAt:day+'T20:00:00Z',fishingStartAt:day+'T16:00:00Z',fishingEndAt:day+'T19:00:00Z',mediaGroup:'no',equipment:'Supplied rod',water:'Included water'};
}
async function nativeDeparture(){const plan=departure(),state=await fx.trips.read(fx.owner.actor),reply=await fx.trips.execute(fx.owner.actor,{type:'departure.save',operationId:randomUUID(),expectedRevision:state.revision,departure:plan});return{id:reply.id!,plan};}
async function grantRequest(payload:unknown,actor=fx.owner){return http.handle(new Request(fx.origin+'/api/individual-trips/chat-grants',{method:'POST',headers:{Origin:fx.origin,Cookie:'__Host-ls-session='+actor.token,'X-CSRF-Token':sessions.csrf(actor.token),'Content-Type':'application/json'},body:JSON.stringify(payload)}));}
beforeAll(async()=>{
 vi.stubGlobal('fetch',network);fx=await tripDatabase();chat=new IndividualTripOwnerChat(fx.trips);const limits=new PostgresIdentityRateStore(fx.store);
 site=new IndividualTripSiteChat(fx.trips,chat,{siteId:TRIP_SITE_ID,signingKey},limits);sessions=new IdentitySessions(fx.store,fx.config,fx.clock);
 http=new IndividualTripsHttp({config:fx.config,trips:fx.trips,registration:new IndividualTripRegistrationService(fx.store,fx.config,fx.clock),sessions,auth:new IdentityAuthService(fx.store,fx.config,fx.clock),limits,
  capabilities:{stripeLookup:false,mailAdmission:false,ownerChat:true,siteChat:true},ownerAction:async()=>{throw new Error('UNRELATED_ACTION_NOT_ADMITTED');},chat,siteChat:site});
},25000);
beforeEach(async()=>{
 fx.time.now=new Date(Math.max(Date.now(),Date.parse('2026-11-27T16:00:00Z')));
 await fx.db.exec('TRUNCATE ls_individual_trips.state,ls_individual_trips.state_chunks,ls_individual_trips.memberships,ls_individual_trips.operations,ls_individual_trips.chat_grants,ls_identity.rate_counters CASCADE');
 await fx.db.query("UPDATE ls_identity.accounts SET state='active',email_verified_at=$1",[fx.clock.now()]);
 await fx.db.query("UPDATE ls_identity.accounts SET role='practitioner' WHERE id=$1",[fx.owner.actor.id]);
 await fx.db.query('UPDATE ls_identity.sessions SET revoked_at=NULL,expires_at=$1',[new Date(fx.clock.now().getTime()+86400000)]);
});
afterAll(async()=>{try{expect(network).not.toHaveBeenCalled();await fx?.db.close();}finally{vi.unstubAllGlobals();}});

describe('explicit native owner pairing',()=>{
 it('requires native owner session and CSRF, returns no grant reference/secret, rereads and revokes the same connection',async()=>{
  const withoutCsrf=new Request(fx.origin+'/api/individual-trips/chat-grants',{method:'POST',headers:{Origin:fx.origin,Cookie:'__Host-ls-session='+fx.owner.token,'Content-Type':'application/json'},body:JSON.stringify({action:'connect_site',callerId,minutes:10})});
  expect((await http.handle(withoutCsrf)).status).toBe(403);
  expect((await grantRequest({action:'connect_site',callerId,minutes:10},fx.parent)).status).toBe(404);
  const response=await grantRequest({action:'connect_site',callerId,minutes:10}),paired=(await response.json()).data;
  expect(response.status).toBe(200);expect(paired).toMatchObject({connected:true,siteId:TRIP_SITE_ID,callerId,allowedCommands:TRIP_SITE_COMMAND_TYPES});
  expect(Object.keys(paired).sort()).toEqual(['allowedCommands','callerId','connected','expiresAt','siteId']);
  const listing=await http.handle(new Request(fx.origin+'/api/individual-trips/chat-grants',{headers:{Cookie:'__Host-ls-session='+fx.owner.token}}));
  expect((await listing.json()).data.connections).toEqual([expect.objectContaining({callerId,active:true})]);
  expect(await invoke(body())).toMatchObject({connected:true,view:'status'});
  expect((await grantRequest({action:'revoke_site',callerId})).status).toBe(200);
  await expect(invoke(body())).rejects.toMatchObject({code:'UNAUTHENTICATED'});
 });
 it('requires explicit bounded connection duration and observed caller shape',async()=>{
  for(const input of [{callerId,minutes:31},{callerId,minutes:0},{callerId:'site_unverified',minutes:10},{callerId,minutes:10,ownerAccountId:fx.owner.actor.id}])
   await expect(chat.connectSite(fx.owner.actor,input)).rejects.toMatchObject({code:'INVALID_REQUEST'});
  await pair();await pair();expect((await chat.siteConnections(fx.owner.actor)).connections).toHaveLength(1);
  expect(await invoke(body())).toMatchObject({connected:true});
 });
 it('does not use an ordinary direct caller grant as Site pairing and leaves the direct path independent',async()=>{
  await chat.grant(fx.owner.actor,{callerId,minutes:10,write:true});
  await expect(invoke(body())).rejects.toMatchObject({code:'UNAUTHENTICATED'});
  await pair();expect(await invoke(body())).toMatchObject({connected:true});await chat.revokeSite(fx.owner.actor,callerId);
  const rows=await fx.db.query<{revoked_at:Date|null;scopes:string[]}>('SELECT revoked_at,scopes FROM ls_individual_trips.chat_grants WHERE caller_id=$1',[callerId]);
  expect(rows.rows.find(row=>!row.scopes.some(scope=>scope.startsWith('site:')))?.revoked_at).toBeNull();
 });
});

describe('signed Site request and native planning scope',()=>{
 it('signs raw canonical JSON with ASCII key, preserving arrays and fields before command defaults',()=>{
  const input=body({action:'command',command:{type:'departure.save',operationId:randomUUID(),expectedRevision:0,departure:departure()}});
  const sort=(value:unknown):unknown=>Array.isArray(value)?value.map(sort):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,item])=>[key,sort(item)])):value;
  expect(tripSiteSignature(signingKey,input)).toBe(createHmac('sha256',signingKey).update('fishing-trip-site-v1\n'+JSON.stringify(sort(input))).digest('base64url'));
  expect(canonicalTripSite({z:[2,1],a:{b:'שלום',a:1}})).toBe('{"a":{"a":1,"b":"שלום"},"z":[2,1]}');
 });
 it('returns pairingRequired without records for an unpaired/wrong caller, invalid signature or stale timestamp',async()=>{
  await pair();
  for(const input of [body({callerId:'site_'+'b'.repeat(43)}),body({timestamp:fx.clock.now().getTime()-61000})])await expect(invoke(input)).rejects.toMatchObject({code:'UNAUTHENTICATED'});
  const input=body();await expect(site.execute(input,'X'.repeat(43))).rejects.toMatchObject({code:'UNAUTHENTICATED'});
  const wrong=body({callerId:'site_'+'b'.repeat(43)}),response=await site.handle(new Request(fx.origin+'/api/individual-trips/site-chat',{method:'POST',headers:{'Content-Type':'application/json','x-fishing-site-signature':tripSiteSignature(signingKey,wrong)},body:JSON.stringify(wrong)}));
  expect(response.status).toBe(401);const rejected=await response.json();expect(rejected.pairingRequired).toBe(true);expect(rejected.data).toBeUndefined();
 });
 it('changes and rereads the same departure as the UI, rejects signature tampering, stale revision and nonce replay',async()=>{
  await pair();const input=body({action:'command',command:{type:'departure.save',operationId:randomUUID(),expectedRevision:0,departure:departure()}});
  const signed=tripSiteSignature(signingKey,input),tampered=structuredClone(input);(tampered.command as {departure:{title:string}}).departure.title='Tampered title';
  await expect(site.execute(tampered,signed)).rejects.toMatchObject({code:'UNAUTHENTICATED'});
  const result=await invoke(input),id=(result as {result:{id:string}}).result.id;
  expect((await fx.trips.read(fx.owner.actor)).departures[0]!.id).toBe(id);
  await expect(invoke(input)).rejects.toMatchObject({code:'CONFLICT'});
  await expect(invoke({...input,nonce:randomUUID(),command:{...(input.command as object),operationId:randomUUID()}})).rejects.toMatchObject({code:'CONFLICT'});
  const current=await fx.trips.read(fx.owner.actor),plan=current.departures[0]!;
  await fx.trips.execute(fx.owner.actor,{type:'departure.save',operationId:randomUUID(),expectedRevision:current.revision,departureId:id,departure:{...departure(),otherNonpayingChildren:plan.otherNonpayingChildren,title:'Edited in native UI'}});
  expect(await invoke(body({view:{type:'departure',departureId:id}}))).toMatchObject({view:'departure',departure:{id,title:'Edited in native UI'}});
 });
 it('admits only the three planning commands and no caller-supplied native principal or grant ID',async()=>{
  await pair();const input=body({action:'command',command:{type:'prices.update',operationId:randomUUID(),expectedRevision:0,local:{firstMinor:15000,siblingMinor:10000},keys:{firstMinor:30000,siblingMinor:25000}}});
  await expect(invoke(input)).rejects.toMatchObject({code:'FORBIDDEN'});
  const extra={...body(),grantId:randomUUID(),ownerAccountId:fx.owner.actor.id};await expect(site.execute(extra,tripSiteSignature(signingKey,extra))).rejects.toMatchObject({code:'INVALID_REQUEST'});
  expect((await fx.trips.read(fx.owner.actor)).revision).toBe(0);
 });
 it('status/demand omit every household, child name, contact, note, account and monetary record; explicit departure scope controls names',async()=>{
  await fx.trips.execute(fx.parent.actor,{type:'household.create',operationId:randomUUID(),expectedRevision:0,profile:{guardianName:'Private Guardian',phone:'PRIVATE_PHONE',pickupAreas:[],contactConsent:true,marketingConsent:false}},true);
  let view=await fx.trips.read(fx.parent.actor);const child=await fx.trips.execute(fx.parent.actor,{type:'child.save',operationId:randomUUID(),expectedRevision:view.revision,child:{name:'Private Child',age:11,mediaUse:false,fishingExperience:'PRIVATE_NOTE',ownsRod:false}});
  const target=await nativeDeparture();view=await fx.trips.read(fx.parent.actor);
  await fx.trips.execute(fx.parent.actor,{type:'availability.save',operationId:randomUUID(),expectedRevision:view.revision,childId:child.id!,selection:'any',options:[{date:target.plan.departureAt.slice(0,10),kind:'local',pickupAreas:[]}],note:'PRIVATE_NOTE'});
  await pair();
  for(const input of [body(),body({view:{type:'demand'}}),body({view:{type:'departures'}}),body({view:{type:'departure',departureId:target.id}})]){
   const response=JSON.stringify(await invoke(input));
   for(const secret of ['Private Guardian','Private Child','Private Nonpaying Child','PRIVATE_PHONE','PRIVATE_NOTE',fx.parent.email,'creditLedger','receipts','prices','ownerAccountId','sessionDigest'])expect(response).not.toContain(secret);
  }
  const detail=await invoke(body({view:{type:'departure',departureId:target.id,includeWaitlist:true,includeRoster:true}}));
  expect(detail).toMatchObject({waitlist:{candidates:[{childId:child.id,name:'Private Child'}]},roster:{nonpayingChildren:expect.arrayContaining([expect.objectContaining({name:'Private Nonpaying Child'})])}});
  await expect(invoke(body({view:{type:'departure',departureId:randomUUID()}}))).rejects.toMatchObject({code:'NOT_FOUND'});
 });
 it.each(['expiry','revoke','session','account','role'] as const)('denies a previously paired Site after %s changes',async reason=>{
  await pair();
  if(reason==='expiry')fx.time.now=new Date(fx.clock.now().getTime()+11*60000);
  if(reason==='revoke')await chat.revokeSite(fx.owner.actor,callerId);
  if(reason==='session')await fx.db.query('UPDATE ls_identity.sessions SET revoked_at=$2 WHERE account_id=$1',[fx.owner.actor.id,fx.clock.now()]);
  if(reason==='account')await fx.db.query("UPDATE ls_identity.accounts SET state='revoked' WHERE id=$1",[fx.owner.actor.id]);
  if(reason==='role')await fx.db.query("UPDATE ls_identity.accounts SET role='adult_client' WHERE id=$1",[fx.owner.actor.id]);
  await expect(invoke(body())).rejects.toMatchObject({code:'UNAUTHENTICATED'});
 });
 it('rechecks Site grant revocation inside the same native command transaction',async()=>{
  await pair();const original=fx.trips.executeGuarded.bind(fx.trips);
  const spy=vi.spyOn(fx.trips,'executeGuarded').mockImplementationOnce(async(actor,command,guard)=>{await chat.revokeSite(actor,callerId);return original(actor,command,guard);});
  try{await expect(invoke(body({action:'command',command:{type:'departure.save',operationId:randomUUID(),expectedRevision:0,departure:departure()}}))).rejects.toMatchObject({code:'UNAUTHENTICATED'});expect((await fx.trips.read(fx.owner.actor)).revision).toBe(0);}finally{spy.mockRestore();}
 });
 it('Site availability is independently closed until exact native owner/workspace and raw signing key are configured',()=>{
  const env={LS_INDIVIDUAL_TRIPS_ENABLED:'true',LS_INDIVIDUAL_TRIPS_WORKSPACE_ID:fx.workspace,LS_INDIVIDUAL_TRIPS_OWNER_ACCOUNT_ID:fx.owner.actor.id,LS_INDIVIDUAL_TRIPS_SITE_CHAT_ENABLED:'true',LS_INDIVIDUAL_TRIPS_SITE_SIGNING_KEY:signingKey};
  expect(tripSiteConfig(env,fx.trips)).toEqual({siteId:TRIP_SITE_ID,signingKey});
  for(const extra of [{LS_INDIVIDUAL_TRIPS_SITE_CHAT_ENABLED:'false'},{LS_INDIVIDUAL_TRIPS_SITE_SIGNING_KEY:'short'},{LS_INDIVIDUAL_TRIPS_OWNER_ACCOUNT_ID:randomUUID()}])expect(tripSiteConfig({...env,...extra},fx.trips)).toBeNull();
 });
});
it.each(['en','he'] as const)('retains only validated nonsecret %s caller prefill through exact native owner-role login',locale=>{
 const link=new URL(tripSiteOwnerLoginHref(locale,callerId),'https://native.invalid');expect(link.searchParams.get('next')).toBe(`/${locale}/trips/owner`);expect(link.searchParams.get('chatCaller')).toBe(callerId);
 expect(tripSiteOwnerReturn(locale,'practitioner',loginReturnDestination(locale,'practitioner',link.searchParams.get('next')),link.searchParams.get('chatCaller'))).toBe(`/${locale}/trips/owner#chatCaller=${callerId}`);
 expect(tripSiteOwnerReturn(locale,'parent',`/${locale}/trips/owner`,callerId)).toBe(`/${locale}/trips/owner`);
 expect(tripSiteOwnerReturn(locale,'practitioner',`/${locale}/app/calendar`,callerId)).toBe(`/${locale}/app/calendar`);
 expect(tripSiteOwnerReturn(locale,'practitioner',`/${locale}/trips/owner`,'site_invalid')).toBe(`/${locale}/trips/owner`);
 expect(tripSiteOwnerLoginHref(locale,'https://wrong.invalid')).not.toContain('chatCaller');
 expect(tripSiteCallerFromHash('#chatCaller='+callerId)).toBe(callerId);
 for(const hash of ['#chatCaller=invalid','#chatCaller='+callerId+'&token=secret','#chatCaller='+callerId+'&chatCaller='+callerId])expect(tripSiteCallerFromHash(hash)).toBeNull();
});
