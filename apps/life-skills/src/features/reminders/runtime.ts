import 'server-only';
import {identityRuntime} from '../identity/runtime.ts';
import {PracticeReminderService} from './service.ts';
import {ReminderHttp} from './http.ts';
/** Uses the existing private native store/auth only. No new provider or scheduler. */
export async function reminderRuntime(){
 const identity=await identityRuntime(),service=new PracticeReminderService(identity.store,identity.config.workspaceId,identity.clock);
 return{service,http:new ReminderHttp(identity.config,identity.clock,{sessions:identity.services.sessions,limits:identity.services.limits,audit:identity.services.audit,service})};
}
