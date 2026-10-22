/** Test-only weekday scheduling. Never imported by application code, never a
 * real calendar/venue/adult-safety approval. Financial time remains unchanged.
 */
import {randomUUID} from 'node:crypto';
import {admitNativeCi} from '../native-ci-admission.ts';
import type {Pool} from 'pg';
import {safeTestUrl} from '../calendar/fixture.ts';
import {academyFloridaDay} from '../../../src/features/fishing/academy-operator-day.ts';

export function ordinaryFixtureInterval(startsAt:string,endsAt:string):{startsAt:string;endsAt:string}{
 const initial=Date.parse(startsAt),duration=Date.parse(endsAt)-initial;if(!Number.isFinite(initial)||!Number.isFinite(duration)||duration<=0||duration>24*3600000)throw Error('SYNTHETIC_ORDINARY_INTERVAL_INVALID');
 const direction=initial<Date.now()?-1:1;let start=initial;
 for(let n=0;n<3;n++){const day=new Date(academyFloridaDay(new Date(start).toISOString())+'T12:00:00Z').getUTCDay();if(day!==0&&day!==6)return {startsAt:new Date(start).toISOString(),endsAt:new Date(start+duration).toISOString()};start+=direction*86400000;}
 throw Error('SYNTHETIC_WEEKDAY_REQUIRED');
}
/** Move related physical intervals together; financial times never enter this API. */
export function ordinaryFixtureSeries(values:readonly {startsAt:string;endsAt:string}[]):Array<{startsAt:string;endsAt:string}>{
 if(!values.length)throw Error('SYNTHETIC_PHYSICAL_SERIES_REQUIRED');
 const intervals=values.map(v=>({start:Date.parse(v.startsAt),end:Date.parse(v.endsAt)})),now=Date.now();
 if(intervals.some(v=>!Number.isFinite(v.start)||!Number.isFinite(v.end)||v.end<=v.start||v.end-v.start>24*3600000))throw Error('SYNTHETIC_ORDINARY_INTERVAL_INVALID');
 const past=intervals.every(v=>v.end<now),future=intervals.every(v=>v.start>now);
 if(!past&&!future)throw Error('SYNTHETIC_PHYSICAL_SERIES_DIRECTION');
 const weekday=(at:number)=>{const day=new Date(academyFloridaDay(new Date(at).toISOString())+'T12:00:00Z').getUTCDay();return day!==0&&day!==6;};
 for(let days=0;days<7;days++){
  const shift=(past?-1:1)*days*86400000;
  if(intervals.every(v=>weekday(v.start+shift)&&weekday(v.end+shift)))return intervals.map(v=>({startsAt:new Date(v.start+shift).toISOString(),endsAt:new Date(v.end+shift).toISOString()}));
 }
 throw Error('SYNTHETIC_WEEKDAY_SERIES_UNAVAILABLE');
}
/** Several <=30-day open windows support weekly future lessons and distinct
 * past delivered lessons without weakening the existing SQL interval bound.
 */
export async function installOrdinaryFixtureCalendar(f:{pool:Pool;workspaceId:string;owner:{id:string};at:(hours:number)=>string}){
 const ci=await admitNativeCi(['program']),url=new URL(safeTestUrl());if(!ci&&(process.env.LS_RM_PROGRAM_NATIVE_ALLOW!=='MAIN_REGISTERED_ONLY'||url.hostname!=='127.0.0.1'||!/^\/ls_calendar_test_rm_guard_[a-f0-9]{32}_test$/.test(url.pathname)))throw Error('SYNTHETIC_OWNED_PROGRAM_TARGET_REQUIRED');
 const actual=(await f.pool.query('SELECT current_database() AS database,host(inet_server_addr()) AS host,inet_server_port() AS port')).rows[0];if(actual?.database!==url.pathname.slice(1)||actual?.host!==(ci?.serverAddress??'127.0.0.1')||actual?.port!==Number(url.port))throw Error('SYNTHETIC_OWNED_ACTUAL_TARGET_REQUIRED');
 for(let day=-90;day<120;day+=30)await f.pool.query("INSERT INTO ls_calendar.availability(id,workspace_id,practitioner_id,starts_at,ends_at,kind) VALUES($1,$2,$3,$4,$5,'open')",[randomUUID(),f.workspaceId,f.owner.id,f.at(day*24),f.at((day+30)*24)]);
}
