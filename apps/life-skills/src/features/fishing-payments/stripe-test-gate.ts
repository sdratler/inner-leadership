/** Exact, non-secret preparation gate. These flags do not verify a merchant,
 * admit a database/schema, install a signing secret or activate a provider. */
export function stripeTestWebhookEnabled(pathname:string,environment:Readonly<Record<string,string|undefined>>):boolean{
 try{
  if(pathname!=="/api/webhooks/stripe/test"||environment.LS_APP_MODE!=="isolated_preview"||environment.LS_STRIPE_TEST_WEBHOOK_ENABLED!=="true"||environment.LS_STRIPE_TEST_RUNTIME_ADMITTED!=="true")return false;
  const raw=environment.LS_STRIPE_TEST_WEBHOOK_ORIGIN;
  if(!raw||raw!==environment.LS_APP_ORIGIN)return false;
  const origin=new URL(raw);
  return origin.protocol==="https:"&&!origin.username&&!origin.password&&origin.pathname==="/"&&!origin.search&&!origin.hash&&origin.origin===raw;
 }catch{return false;}
}
