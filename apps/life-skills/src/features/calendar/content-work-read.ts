import 'server-only';
import {AppError} from '../../lib/errors.ts';
import type {Actor} from '../identity/types.ts';
import type {MarketingSnapshot} from '../marketing-overview/contracts.ts';
import {loadContentRegistry} from '../marketing-overview/provider.ts';
import {contentWorkSources} from './content-work-tasks.ts';
import type {AdministrativeWorkSource} from './source-work-tasks.ts';
/** Fresh ordinary access checks surround the existing bounded registry read.
 * No Meta metrics request, scheduler, approval, provider mutation or cache proof. */
export async function syncContentWork<T>(actor:Actor,confirmAccess:()=>Promise<void>,save:(sources:readonly AdministrativeWorkSource[])=>Promise<T>,load:()=>Promise<MarketingSnapshot>=loadContentRegistry):Promise<T>{
 if(actor.role!=='practitioner')throw new AppError('FORBIDDEN');
 await confirmAccess();let snapshot:MarketingSnapshot;
 try{snapshot=await load();}catch{throw new AppError('UNAVAILABLE');}
 const sources=contentWorkSources(snapshot);await confirmAccess();return save(sources);
}
