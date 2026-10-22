import {academyPaymentRuntime} from '@/features/fishing/academy-payment-runtime.ts';
import {academyBillingHttp} from '@/features/fishing/academy-billing-http.ts';
export const dynamic='force-dynamic';
async function dependencies(){const d=await academyPaymentRuntime();return {runtime:d.runtime,store:d.billing};}
export const GET=(request:Request)=>academyBillingHttp(request,dependencies);
export const POST=(request:Request)=>academyBillingHttp(request,dependencies);
