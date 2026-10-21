import {groupCalendarFixture} from '../../database/fishing/academy-group-calendar-fixture.ts';

/** Existing native fixture and scheduling commands, artificial source only. */
export async function groupCalendarBrowserFixture(origin:string){
 if(process.env.LS_ACADEMY_GROUP_CALENDAR_BROWSER!=='SYNTHETIC_LOOPBACK_ONLY'||!/^https:\/\/localhost:310[78]$/.test(origin))throw Error('EXCLUSIVE_GROUP_CALENDAR_BROWSER_REQUIRED');
 const f=await groupCalendarFixture();
 try{const refs=[];for(const [start,end]of [[8,11],[12,15],[16,18]]){const ref=await f.group();await f.schedule(ref,start!,end!);refs.push(ref);}await (await f.publication(refs[0]!)).execute();await (await f.publication(refs[1]!)).execute();
  const expectedIds=[];for(const ref of refs.slice(0,2))expectedIds.push((await f.read(ref))!.occurrences[0]!.id);
  return {...f,refs,expectedIds,unplacedOccurrenceId:(await f.read(refs[2]!))!.occurrences[0]!.id};
 }catch(error){await f.close();throw error;}
}


/** Same owner app shell/auth; only an explicit owned native transport can supply
 * this synthetic merchant/clock. Default Next runtime stays unadmitted. */
export async function groupPublicationBrowserFixture(origin:string,locale:'en'|'he'){
 if(process.env.LS_ACADEMY_GROUP_PUBLICATION_BROWSER!=='SYNTHETIC_LOOPBACK_ONLY'||!/^https:\/\/localhost:310[78]$/.test(origin))throw Error('EXCLUSIVE_PUBLICATION_BROWSER_REQUIRED');
 const {groupPublicationFixture}=await import('../../database/fishing/academy-group-calendar-publication-fixture.ts');
 const {IdentitySessions}=await import('../../../src/features/identity/session-adapter.ts'),{PostgresIdentityRateStore}=await import('../../../src/features/identity/rate-store.ts'),{durableAuditSink}=await import('../../../src/features/identity/history.ts'),{systemClock}=await import('../../../src/features/identity/types.ts');
 const f=await groupPublicationFixture(true);f.config.origin=origin;void locale;let instant:Date|null=null;const clock={now:()=>instant??new Date()},runtime={config:f.config,sessions:new IdentitySessions(f.db,f.config,systemClock),limits:new PostgresIdentityRateStore(f.db),audit:durableAuditSink(f.db),clock};
 return {...f,runtime,async advanceAfterTrip(){instant=new Date(Date.parse(f.review.trip.endsAt)+1000);await f.pool.query('UPDATE ls_identity.sessions SET expires_at=$2 WHERE workspace_id=$1',[f.workspaceId,new Date(instant.valueOf()+86400000)]);}};
}
