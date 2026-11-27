import { randomBytes,randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { afterAll,beforeAll,expect,it,vi } from 'vitest';
vi.mock('server-only',()=>({}));
import { fixture,poolStore,type Fixture } from './calendar/fixture.ts';
import type { IdentityConfig } from '../../src/features/identity/config.ts';
import { IndividualTripStore } from '../../src/features/individual-trips/store.ts';
import { IndividualTripOwnerChat } from '../../src/features/individual-trips/owner-chat.ts';
import { departureCapacity } from '../../src/features/individual-trips/engine.ts';
import { upcomingSundayDates } from '../../src/features/individual-trips/config.ts';
import { systemClock,type Actor } from '../../src/features/identity/types.ts';
import { historicalPracticeDatabase } from './home-practice/legacy-practice-fixture.ts';
import { migrate } from '../../src/db/migration-runner.ts';
let f:Fixture,trips:IndividualTripStore,isolated:Awaited<ReturnType<typeof historicalPracticeDatabase>>;
beforeAll(async()=>{
 // Existing fixture rejects every target except explicit disposable loopback
 // or the frozen secret-free PostgreSQL17 CI database. No provider is called.
 isolated=await historicalPracticeDatabase('0118_ls_contact_delta_history.sql');
 const client=await isolated.pool.connect();try{await migrate({query:async(sql,values)=>client.query(sql,values?[...values]:undefined)},isolated.inventory,false);}finally{client.release();}
 vi.stubEnv('TEST_DATABASE_URL',isolated.url);vi.stubEnv('LS_CALENDAR_TEST_ALLOW','true');f=await fixture();
 for(const file of ['schema.sql','registration-schema.sql','mail-schema.sql'])await f.pool.query(await readFile(new URL('../../src/features/individual-trips/'+file,import.meta.url),'utf8'));
 const identity:IdentityConfig={enabled:true,workspaceId:f.workspaceId,origin:'https://synthetic.invalid',keyring:f.keyring,csrfKey:randomBytes(32),lookupKey:randomBytes(32),rateLimitKey:randomBytes(32).toString('hex'),sessionSeconds:28800};
 trips=new IndividualTripStore(poolStore(f.pool),identity,{workspaceId:f.workspaceId,ownerAccountId:f.practitioner.actor.id,origin:identity.origin},systemClock);
},60000);
afterAll(async()=>{await f?.pool.end();await isolated?.close();vi.unstubAllEnvs();});
it('serializes two independent PostgreSQL connections racing for the last paid child place',async()=>{
 const families: {actor:Actor;householdId:string;childId:string}[]=[];
 for(const parent of [f.parent,f.parentTwo]){
  const created=await trips.execute(parent.actor,{type:'household.create',operationId:randomUUID(),expectedRevision:0,profile:{guardianName:'Synthetic Parent',phone:'',pickupAreas:[],contactConsent:true,marketingConsent:false}},true);
  const child=await trips.execute(parent.actor,{type:'child.save',operationId:randomUUID(),expectedRevision:created.revision,child:{name:'Synthetic Boy',age:10,mediaUse:false,fishingExperience:'',ownsRod:false}});
  families.push({actor:parent.actor,householdId:created.householdId!,childId:child.id!});
 }
 const date=upcomingSundayDates(new Date(Date.now()+14*86400000),1)[0]!,owner=f.practitioner.actor;
 const departure=await trips.execute(owner,{type:'departure.save',operationId:randomUUID(),expectedRevision:(await trips.read(owner)).revision,departure:{kind:'local',title:'Synthetic last place',desiredChildLimit:2,activityChildLimit:2,sonAttending:true,otherNonpayingChildren:[],transport:{verified:true,totalSeats:3,driverAdults:1,otherAdults:0,vehicleId:'synthetic-van'},ownerResourceId:'synthetic-guide',minimumPaid:1,operationalReady:true,pickupHub:{id:'synthetic-hub',label:'Synthetic approved hub',permissionConfirmed:true},departureAt:date+'T15:00:00Z',returnAt:date+'T19:00:00Z',fishingStartAt:date+'T15:30:00Z',fishingEndAt:date+'T18:30:00Z',mediaGroup:'no',equipment:'Loaner rod, tackle and bait',water:'Water supplied'}});
 const revision=(await trips.read(owner)).revision;
 const outcomes=await Promise.allSettled(families.map(family=>trips.execute(owner,{type:'offer.prepare',operationId:randomUUID(),expectedRevision:revision,departureId:departure.id,householdId:family.householdId,childIds:[family.childId],ownerNote:''})));
 expect(outcomes.filter(result=>result.status==='fulfilled')).toHaveLength(1);
 expect(outcomes.filter(result=>result.status==='rejected')).toHaveLength(1);
 const state=await trips.read(owner),capacity=departureCapacity(state,departure.id!);expect(capacity.maximumPayingChildren).toBe(1);expect(capacity.occupiedPayingChildren).toBe(1);expect(state.offers).toHaveLength(1);
 const loser=families.find(family=>family.householdId!==state.offers[0]!.householdId)!;
 await expect(trips.execute(owner,{type:'offer.prepare',operationId:randomUUID(),expectedRevision:state.revision,departureId:departure.id,householdId:loser.householdId,childIds:[loser.childId],ownerNote:''})).rejects.toMatchObject({code:'CONFLICT'});
 expect((await trips.read(loser.actor)).offers).toHaveLength(0);
});
it('uses the real strict SQL binder for signed grant scopes and encrypted multi-chunk state',async()=>{
 const owner=f.practitioner.actor,chat=new IndividualTripOwnerChat(trips),grant=await chat.grant(owner,{callerId:'synthetic:native-chat',minutes:5,write:true});
 const row=(await f.pool.query('SELECT scopes,secret_ciphertext FROM ls_individual_trips.chat_grants WHERE workspace_id=$1 AND id=$2',[f.workspaceId,grant.id])).rows[0]!;
 expect(row.scopes).toEqual(['read','command']);expect(row.secret_ciphertext).not.toContain(grant.secret);
 const projected=await trips.read(f.parent.actor),child=projected.households[0]!.children[0]!;
 for(let index=0;index<24;index++)await trips.execute(f.parent.actor,{type:'availability.save',operationId:randomUUID(),expectedRevision:(await trips.read(f.parent.actor)).revision,childId:child.id,selection:'any',options:[{date:upcomingSundayDates(new Date(Date.now()+14*86400000),1)[0],kind:'local',pickupAreas:[]}],note:'שלום 🐟'.repeat(220)});
 const chunks=(await f.pool.query('SELECT count(*)::int AS count FROM ls_individual_trips.state_chunks WHERE workspace_id=$1',[f.workspaceId])).rows[0]!.count;
 expect(chunks).toBeGreaterThan(1);expect((await trips.read(f.parent.actor)).households[0]!.availability).toHaveLength(24);
});
