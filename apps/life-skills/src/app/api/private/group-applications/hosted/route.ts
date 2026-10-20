import {academyPaymentRuntime} from '@/features/fishing/academy-payment-runtime.ts';
import {academyHostedHttp} from '@/features/fishing/academy-hosted-http.ts';
export const dynamic='force-dynamic';
async function dependencies(){const d=await academyPaymentRuntime();return {runtime:d.runtime,store:d.hosted};}
export const POST=(request:Request)=>academyHostedHttp(request,dependencies);
