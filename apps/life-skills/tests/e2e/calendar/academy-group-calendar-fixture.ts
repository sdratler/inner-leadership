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
