import {academyPaymentRuntime} from '@/features/fishing/academy-payment-runtime.ts';
import {academyRefundPreparationHttp} from '@/features/fishing/academy-refund-preparation-http.ts';
export const dynamic='force-dynamic';
async function dependencies(){const d=await academyPaymentRuntime();return {runtime:d.runtime,store:d.refundPreparations};}
export const GET=(request:Request)=>academyRefundPreparationHttp(request,dependencies);
export const POST=(request:Request)=>academyRefundPreparationHttp(request,dependencies);
