/** Test-only weekday scheduling. Never imported by application code, never a
 * real calendar/venue/adult-safety approval. Financial time remains unchanged.
 */
import {randomUUID} from 'node:crypto';
import type {Pool} from 'pg';
import {safeTestUrl} from '../calendar/fixture.ts';
import {academyFloridaDay} from '../../../src/features/fishing/academy-operator-day.ts';

export function ordinaryFixtureInterval(startsAt:string,endsAt:string):{startsAt:string;endsAt:string}{
 const initial=Date.parse(startsAt),duration=Date.parse(endsAt)-initial;if(!Number.isFinite(initial)||!Number.isFinite(duration)||duration<=0||duration>24*3600000)throw Error('SYNTHETIC_ORDINARY_INTERVAL_INVALID');
 const direction=initial<Date.now()?-1:1;let start=initial;
 for(let n=0;n<3;n++){const day=new Date(academyFloridaDay(new Date(start).toISOString())+'T12:00:00Z').getUTCDay();if(day!==0&&day!==6)return {startsAt:new Date(start).toISOString(),endsAt:new Date(start+duration).toISOString()};start+=direction*86400000;}
 throw Error('SYNTHETIC_WEEKDAY_REQUIRED');
}
/** Several <=30-day open windows support weekly future lessons and distinct
 * past delivered lessons without weakening the existing SQL interval bound.
 */
export async function installOrdinaryFixtureCalendar(f:{pool:Pool;workspaceId:string;owner:{id:string};at:(hours:number)=>string}){
 const url=new URL(safeTestUrl());if(process.env.LS_RM_PROGRAM_NATIVE_ALLOW!=='MAIN_REGISTERED_ONLY'||url.hostname!=='127.0.0.1'||!/^\/ls_calendar_test_rm_guard_[a-f0-9]{32}_test$/.test(url.pathname))throw Error('SYNTHETIC_OWNED_PROGRAM_TARGET_REQUIRED');
 const actual=(await f.pool.query('SELECT current_database() AS database,host(inet_server_addr()) AS host,inet_server_port() AS port')).rows[0];if(actual?.database!==url.pathname.slice(1)||actual?.host!=='127.0.0.1'||actual?.port!==Number(url.port))throw Error('SYNTHETIC_OWNED_ACTUAL_TARGET_REQUIRED');
 for(let day=-90;day<120;day+=30)await f.pool.query("INSERT INTO ls_calendar.availability(id,workspace_id,practitioner_id,starts_at,ends_at,kind) VALUES($1,$2,$3,$4,$5,'open')",[randomUUID(),f.workspaceId,f.owner.id,f.at(day*24),f.at((day+30)*24)]);
}
