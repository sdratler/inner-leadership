import {academyPaymentRuntime} from '@/features/fishing/academy-payment-runtime.ts';
import {academyRefundHttp} from '@/features/fishing/academy-refund-http.ts';
export const dynamic='force-dynamic';
async function dependencies(){const d=await academyPaymentRuntime();return {runtime:d.runtime,store:d.refunds};}
export const GET=(request:Request)=>academyRefundHttp(request,dependencies);
export const POST=(request:Request)=>academyRefundHttp(request,dependencies);
