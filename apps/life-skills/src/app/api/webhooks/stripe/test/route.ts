import {handleStripeTestWebhook} from "../../../../../features/fishing-payments/stripe-test-runtime.ts";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function POST(request:Request):Promise<Response>{return handleStripeTestWebhook(request);}
