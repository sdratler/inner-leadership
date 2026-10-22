/** Only explicit disposable loopback. Existing native setup and commands;
 * synthetic source/merchant fixtures are never application admission. */
import {randomUUID} from 'node:crypto';
import {groupTravelFixture} from '../../database/fishing/academy-group-calendar-travel-fixture.ts';
import {travelCreditFixture} from '../../database/fishing/academy-travel-credit-fixture.ts';
import {AcademyGroupPublicationService} from '../../../src/features/fishing/academy-group-calendar-publication-service.ts';
import {academyGroupPublicationVersion} from '../../../src/features/fishing/academy-group-calendar-publication-contract.ts';
import {NativeFishingProgram} from '../../../src/features/fishing/native-program.ts';

export async function travelCreditBrowserFixture(origin:string,locale:'en'|'he'){
 if(process.env.LS_ACADEMY_TRAVEL_BROWSER!=='SYNTHETIC_LOOPBACK_ONLY'||!/^https:\/\/localhost:310[78]$/.test(origin))throw Error('EXCLUSIVE_TRAVEL_BROWSER_REQUIRED');
 const f=await travelCreditFixture({origin,locale});
 try{
  // One actual purchased session supplies an independently retained weekly
  // draft context. The first original stays future and undelivered.
  let plan=await f.current();const deliveredOccurrenceId=plan.occurrences[1]!.id;
  await f.revise(deliveredOccurrenceId,f.at(-24),f.at(-22));plan=await f.current();let o=plan.occurrences.find(o=>o.id===deliveredOccurrenceId)!;
  await f.stage().execute(f.owner,f.ref,{action:'complete',operationId:randomUUID(),expectedRevision:plan.revision,occurrenceId:o.id,expectedOccurrenceRevision:o.revision,reason:'SYNTHETIC actual completed weekly context'});plan=await f.current();o=plan.occurrences.find(o=>o.id===deliveredOccurrenceId)!;
  await f.stage().execute(f.owner,f.ref,{action:'attendance',operationId:randomUUID(),expectedRevision:plan.revision,occurrenceId:o.id,expectedOccurrenceRevision:o.revision,enrollmentId:f.enrollmentId,state:'present',reason:'SYNTHETIC actual selected attendance'});
  const replacementSetup=await f.prepareReplacement();await f.changeSchedule();return {...f,deliveredOccurrenceId,replacementSetup};
 }catch(error){await f.close();throw error;}
}

/** Same owned transport; no production source or merchant admission. */
export async function sharedCalendarBrowserFixture(origin:string,locale:'en'|'he'){
 if(process.env.LS_ACADEMY_SHARED_CALENDAR_BROWSER!=='SYNTHETIC_LOOPBACK_ONLY'||!/^https:\/\/localhost:310[78]$/.test(origin))throw Error('EXCLUSIVE_SHARED_CALENDAR_BROWSER_REQUIRED');
 const f=await groupTravelFixture({origin,locale});let instant:Date|null=null;const clock={now:()=>instant??new Date()},sharedReadRuntime={...f.runtime,clock};
 return {...f,sharedReadRuntime,async completeTraveler(expectedPublicationRevision:number){
  // Only this owned test transport advances time. Mounted Next keeps its
  // ordinary clock and default merchant denial; no production seam is added.
  instant=new Date(Date.parse(f.trip.endsAt)+1000);await f.pool.query('UPDATE ls_identity.sessions SET expires_at=$2 WHERE workspace_id=$1',[f.workspaceId,new Date(instant.valueOf()+86400000)]);
  const service=new AcademyGroupPublicationService(f.db,f.config,f.merchant,clock);
  await service.execute(f.owner,{version:academyGroupPublicationVersion,action:'attendance',operationId:randomUUID(),eventId:f.eventId,expectedPublicationRevision,learnerId:f.second.learnerId,expectedAttendanceRevision:0,state:'present',reason:'SYNTHETIC browser actual traveler attendance'});
  await service.execute(f.owner,{version:academyGroupPublicationVersion,action:'complete',operationId:randomUUID(),eventId:f.eventId,expectedPublicationRevision,reason:'SYNTHETIC controlled future clock physical completion only'});
  return new NativeFishingProgram(f.db,f.ring,{childAccountsEnabled:false,merchant:f.merchant},clock).previewOwner03Refund(f.owner,{purchaseId:f.secondPurchase,reason:'voluntary'});
 }};
}
