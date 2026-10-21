/** Only explicit disposable loopback. Existing native setup and commands;
 * synthetic source/merchant fixtures are never application admission. */
import {randomUUID} from 'node:crypto';
import {travelCreditFixture} from '../../database/fishing/academy-travel-credit-fixture.ts';

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
