import 'server-only';
import { AppError } from '../../lib/errors.ts';
import { identityRuntime } from '../identity/runtime.ts';
import { CalendarStore } from './store.ts';
import { CalendarService } from './service.ts';
/** Feature-local opt-in: absent/false means closed. No automatic provider, job or shared-nav activation. */
export async function calendarRuntime(){
 if(process.env.LS_CALENDAR_ENABLED!=='true')throw new AppError('UNAVAILABLE');
 const identity=await identityRuntime();
 return {identity,service:new CalendarService(new CalendarStore(identity.store,identity.config.keyring,identity.clock))};
}
