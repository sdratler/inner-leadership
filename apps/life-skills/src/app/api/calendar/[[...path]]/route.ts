import { handleCalendar } from '../../../../features/calendar/http.ts';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const revalidate=0;
type Context={params:Promise<{path?:string[]}>};
async function route(request:Request,context:Context){const {path=[]}=await context.params;return handleCalendar(request,path);}
export const GET=route;
export const POST=route;
export const PATCH=route;
