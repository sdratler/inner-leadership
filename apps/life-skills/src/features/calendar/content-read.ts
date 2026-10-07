import 'server-only';
import {AppError} from '../../lib/errors.ts';
import type {Actor} from '../identity/types.ts';
import type {MarketingSnapshot} from '../marketing-overview/contracts.ts';
import {loadContentRegistry} from '../marketing-overview/provider.ts';
import {calendarContent,calendarContentRange} from './content.ts';
export async function readCalendarContent(actor:Actor,from:string,to:string,confirmAccess:()=>Promise<void>,load:()=>Promise<MarketingSnapshot>=loadContentRegistry){
 if(actor.role!=='practitioner')throw new AppError('FORBIDDEN');
 calendarContentRange(from,to);await confirmAccess();
 let snapshot:MarketingSnapshot;try{snapshot=await load();}catch{throw new AppError('UNAVAILABLE');}
 // Recheck revocation after the bounded external read and before serialization.
 await confirmAccess();return calendarContent(snapshot,from,to);
}
