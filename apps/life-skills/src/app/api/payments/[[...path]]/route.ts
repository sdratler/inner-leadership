import { handlePayments } from '../../../../features/payments/http.ts';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const revalidate=0;
type Context={params:Promise<{path?:string[]}>};
async function route(request:Request,context:Context){const {path=[]}=await context.params;return handlePayments(request,path);}
export const GET=route;
export const POST=route;
