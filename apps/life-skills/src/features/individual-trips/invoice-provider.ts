import 'server-only';
import { z } from 'zod';
import { AppError } from '../../lib/errors.ts';
import type { TripOffer } from './contract.ts';

const amount=z.number().int().min(0).max(100_000_000);
const invoiceSchema=z.object({id:z.string().regex(/^in_[A-Za-z0-9]+$/),object:z.literal('invoice'),livemode:z.boolean(),currency:z.literal('usd'),
 customer:z.string().regex(/^cus_[A-Za-z0-9]+$/),customer_email:z.email(),
 status:z.enum(['draft','open','paid','void','uncollectible']),collection_method:z.literal('send_invoice'),
 amount_due:amount,amount_paid:amount,amount_remaining:amount,amount_paid_off_stripe:amount,
 total:amount,starting_balance:z.literal(0),hosted_invoice_url:z.string().nullable(),
 metadata:z.record(z.string(),z.string())});
const paymentSchema=z.object({id:z.string().regex(/^inpay_[A-Za-z0-9]+$/),object:z.literal('invoice_payment'),invoice:z.string(),
 status:z.enum(['open','paid','canceled']),amount_paid:amount.nullable(),currency:z.literal('usd'),livemode:z.boolean(),
 payment:z.object({type:z.string(),payment_intent:z.string().optional()}),status_transitions:z.object({paid_at:z.number().int().positive().nullable()})});
export type VerifiedTripInvoice=z.infer<typeof invoiceSchema>&{payments:z.infer<typeof paymentSchema>[]};
export interface TripInvoiceProvider {lookup(invoiceId:string):Promise<VerifiedTripInvoice>;}
export interface InvoiceAdmission {accountId:string;livemode:boolean;restrictedKey:string;}
/** Read-only port. It cannot create/send/pay/void invoices or charge a card.
 * Dedicated account/mode admission is explicit and independent of env presence. */
export class StripeTripInvoiceLookup implements TripInvoiceProvider {
 constructor(private readonly admission:InvoiceAdmission,private readonly request:typeof fetch=fetch){
  if(!/^acct_[A-Za-z0-9]+$/.test(admission.accountId)||!new RegExp('^rk_'+(admission.livemode?'live':'test')+'_[A-Za-z0-9]+$').test(admission.restrictedKey))throw new AppError('UNAVAILABLE');
 }
 private async get(path:string):Promise<unknown>{
  const response=await this.request('https://api.stripe.com/v1/'+path,{method:'GET',redirect:'error',cache:'no-store',
   headers:{Authorization:'Bearer '+this.admission.restrictedKey,'Stripe-Version':'2026-11-18.endive'},signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw new AppError('UNAVAILABLE');
  const text=await response.text();if(text.length>1_000_000)throw new AppError('UNAVAILABLE');
  try{return JSON.parse(text);}catch{throw new AppError('UNAVAILABLE');}
 }
 async lookup(invoiceId:string):Promise<VerifiedTripInvoice>{
  if(!/^in_[A-Za-z0-9]+$/.test(invoiceId))throw new AppError('INVALID_REQUEST');
  const account=z.object({id:z.string(),object:z.literal('account')}).safeParse(await this.get('account'));
  if(!account.success||account.data.id!==this.admission.accountId)throw new AppError('UNAVAILABLE');
  const parseInvoice=async()=>{
   const parsed=invoiceSchema.safeParse(await this.get('invoices/'+invoiceId+'?expand%5B%5D=amount_paid_off_stripe'));
   if(!parsed.success||parsed.data.id!==invoiceId||parsed.data.livemode!==this.admission.livemode)throw new AppError('UNAVAILABLE');return parsed.data;
  };
  const invoice=await parseInvoice(),payments:VerifiedTripInvoice['payments']=[];
  let cursor='';
  for(let page=0;page<10;page++){
   const list=z.object({object:z.literal('list'),has_more:z.boolean(),data:z.array(paymentSchema).max(100)}).safeParse(await this.get('invoice_payments?invoice='+invoiceId+'&limit=100'+(cursor?'&starting_after='+cursor:'')));
   if(!list.success)throw new AppError('UNAVAILABLE');
   for(const payment of list.data.data){if(payment.invoice!==invoiceId||payment.livemode!==this.admission.livemode||payments.some(p=>p.id===payment.id))throw new AppError('UNAVAILABLE');payments.push(payment);}
   if(!list.data.has_more){const after=await parseInvoice();if(JSON.stringify(after)!==JSON.stringify(invoice))throw new AppError('CONFLICT');return{...invoice,payments};}
   cursor=list.data.data.at(-1)?.id??'';if(!cursor)throw new AppError('UNAVAILABLE');
  }
  throw new AppError('UNAVAILABLE');
 }
}
export function verifyInvoiceBinding(invoice:VerifiedTripInvoice,offer:TripOffer,workspaceId:string):void{
 if(invoice.metadata.fishing_workspace_id!==workspaceId||invoice.metadata.fishing_household_id!==offer.householdId||invoice.metadata.fishing_offer_id!==offer.id||invoice.metadata.fishing_quote_id!==offer.quoteId)throw new AppError('FORBIDDEN');
 if(invoice.total!==invoice.amount_due||invoice.amount_paid+invoice.amount_remaining!==invoice.amount_due)throw new AppError('CONFLICT');
}
