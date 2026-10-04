import {reminderRuntime} from '../../../../features/reminders/runtime.ts';
import {failureResponse} from '../../../../lib/http/json.ts';
import {newRequestId} from '../../../../lib/ids.ts';
import {secureReminderResponse} from '../../../../features/reminders/http.ts';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const revalidate=0;
type Context={params:Promise<{path?:string[]}>};
async function route(request:Request,context:Context){try{const {path=[]}=await context.params;return(await reminderRuntime()).http.handle(request,path);}catch(error){return secureReminderResponse(failureResponse(error,newRequestId()));}}
export const GET=route;
export const PATCH=route;
