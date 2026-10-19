import "server-only";
import {verifyStripeTestWebhookReceipt,type StripeTestWebhookEndpoint} from "./stripe-test-webhook-receipt.ts";

export type StripeTestSql=Readonly<{query<T extends Record<string,unknown>>(text:string,values?:readonly unknown[]):Promise<T[]>}>;
export type StripeTestDatabase=Readonly<{transaction<T>(work:(tx:StripeTestSql)=>Promise<T>):Promise<T>}>;

/** Minimal capability extracted from FishingReceiptInbox.persistMinimalReceipt.
 * Same native table, key, digest and DTO; no parallel event store or allocation.
 * The server supplies an independently verified endpoint/secret and a narrowly
 * restricted DB connection. It cannot select an Actor, family or purchase.
 */
export class StripeTestInbox {
 constructor(private readonly database:StripeTestDatabase,private readonly endpoint:StripeTestWebhookEndpoint,
  private readonly secret:string,private readonly clock:Readonly<{now():Date}>={now:()=>new Date()}){}
 async acceptStripeTest(rawBody:Uint8Array,signatureHeader:string){
  const {receipt}=verifyStripeTestWebhookReceipt({rawBody,signatureHeader,endpointSecret:this.secret,binding:this.endpoint,clock:this.clock});
  await this.database.transaction(async tx=>{
   await tx.query('INSERT INTO ls_fishing_payments.inbox(provider_account_id,livemode,event_id,digest,receipt_json,received_at) VALUES($1,$2,$3,$4,$5::jsonb,$6) ON CONFLICT DO NOTHING',
    [receipt.providerAccountId,receipt.livemode,receipt.eventId,receipt.digest,JSON.stringify(receipt),this.clock.now()]);
   const rows=await tx.query<{digest:string}>('SELECT digest FROM ls_fishing_payments.inbox WHERE provider_account_id=$1 AND livemode=$2 AND event_id=$3',
    [receipt.providerAccountId,receipt.livemode,receipt.eventId]);
   if(rows.length!==1||rows[0]!.digest!==receipt.digest)throw new Error('STRIPE_TEST_INBOX_UNAVAILABLE');
  });
  return {status:200 as const,eventId:receipt.eventId,state:'durably_received' as const};
 }
}
