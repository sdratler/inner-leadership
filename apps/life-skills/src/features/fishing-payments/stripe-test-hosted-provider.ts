import 'server-only';
import Stripe from 'stripe';
import {z} from 'zod';
import {approvedOffer,digest} from './domain.ts';
import type {StripeTestHostedAction,StripeTestHostedBinding,StripeTestHostedContext,StripeTestHostedObservation,StripeTestHostedProvider} from './ports.ts';

export const stripeHostedSdkVersion='23.0.0' as const;
export const stripeHostedApiVersion='2026-09-30.endive' as const;
export const stripeHostedBounds=Object.freeze({requestMilliseconds:5000,objectBytes:131072,callsPerPhase:3});
const opaque=z.string().regex(/^[A-Za-z0-9_.:-]{1,160}$/),uuid=z.uuid(),money=z.number().int().min(0).max(100_000_000);
const instant=z.iso.datetime({offset:true}),providerId=(prefix:string)=>z.string().regex(new RegExp(`^${prefix}_[A-Za-z0-9_]{1,150}$`));
const bindingSchema=z.strictObject({accountId:providerId('acct'),livemode:z.literal(false),apiVersion:z.literal(stripeHostedApiVersion),verifiedBindingId:opaque});
const resultSchema=z.strictObject({kind:z.literal('hosted_invoice'),providerObjectId:providerId('in'),url:z.string().max(2048),providerAccountId:providerId('acct'),livemode:z.literal(false),currency:z.literal('USD'),amountCents:money.positive(),purchaseId:uuid,dueId:opaque,idempotencyKey:z.string().max(220)});
const operationSchema=z.strictObject({id:uuid,kind:z.literal('hosted_invoice'),workspaceId:uuid,purchaseId:uuid,dueId:opaque,refundPaymentId:z.null(),providerAccountId:providerId('acct'),livemode:z.literal(false),amountCents:money.positive(),currency:z.literal('USD'),idempotencyKey:z.string().max(220),state:z.enum(['reserved','unknown','confirmed']),requestDigest:z.string().regex(/^[a-f0-9]{64}$/),result:resultSchema.nullable()});
const contextSchema=z.strictObject({offer:z.unknown(),purchaseLineId:opaque,operation:operationSchema,
 customer:z.strictObject({bindingId:uuid,revision:z.number().int().positive(),payerAccountId:uuid,customerId:providerId('cus'),merchantBindingId:opaque,verifiedAt:instant}),
 authorizationVersion:z.string().regex(/^[a-f0-9]{64}$/),linkExpiresAt:instant,laterDuePolicy:z.strictObject({id:opaque,revision:z.number().int().positive(),sourceVersion:opaque}).nullable()});
const actionSchema=z.union([z.strictObject({phase:z.literal('create')}),z.strictObject({phase:z.enum(['read','add_line','finalize']),invoiceId:providerId('in')}),z.strictObject({phase:z.literal('close'),invoiceId:providerId('in'),closureDecisionId:opaque})]);
const metadataSchema=z.object({rm_operation_id:uuid,rm_purchase_id:uuid,rm_due_id:opaque});
const lineSchema=z.object({id:providerId('il'),object:z.literal('line_item'),amount:money.positive(),currency:z.literal('usd'),metadata:metadataSchema});
const invoiceSchema=z.object({id:providerId('in'),object:z.literal('invoice'),livemode:z.literal(false),customer:providerId('cus'),currency:z.literal('usd'),
 status:z.enum(['draft','open','paid','void']),collection_method:z.literal('send_invoice'),auto_advance:z.literal(false),billing_reason:z.literal('manual'),
 due_date:z.number().int().nonnegative(),total:money,amount_due:money,amount_paid:money,amount_remaining:money,
 starting_balance:z.literal(0),ending_balance:z.literal(0).nullable(),automatic_tax:z.object({enabled:z.literal(false)}),discounts:z.array(z.unknown()).max(0),
 metadata:metadataSchema,lines:z.object({object:z.literal('list'),has_more:z.literal(false),data:z.array(lineSchema).max(1)}),hosted_invoice_url:z.string().max(2048).nullable()});
const observationSchema=z.strictObject({contextDigest:z.string().regex(/^[a-f0-9]{64}$/),invoiceId:providerId('in'),customerId:providerId('cus'),status:z.enum(['draft','open','paid','void']),hasLine:z.boolean(),amountDueCents:money,paidCents:money,remainingCents:money,url:z.string().max(2048).nullable()});

/** Fixed error, no upstream message/cause/key/URL/body retained. */
export class StripeTestHostedError extends Error {
 readonly code='STRIPE_TEST_HOSTED_UNAVAILABLE';
 constructor(){super('Stripe test hosted invoice unavailable');this.name='StripeTestHostedError';}
}
const unavailable=()=>new StripeTestHostedError();
function requireHosted(value:unknown):asserts value{if(!value)throw unavailable();}
function parse<T>(schema:z.ZodType<T>,value:unknown):T{try{return schema.parse(value);}catch{throw unavailable();}}
function hostedUrl(value:string){try{const url=new URL(value);requireHosted(url.protocol==='https:'&&url.hostname==='invoice.stripe.com'&&!url.port&&!url.username&&!url.password&&!url.hash&&url.pathname.startsWith('/i/')&&!/[\r\n]/.test(value));return value;}catch{throw unavailable();}}
export function validateStripeTestHostedContext(raw:unknown,binding:StripeTestHostedBinding):StripeTestHostedContext{
 try{
  const b=parse(bindingSchema,binding),c=parse(contextSchema,raw),offer=approvedOffer(c.offer),op=c.operation;
  const line=offer.lines.find(item=>item.id===c.purchaseLineId),due=line?.dues.find(item=>item.id===op.dueId);
  requireHosted(line&&due&&offer.workspaceId===op.workspaceId&&offer.payerAccountId===c.customer.payerAccountId&&op.providerAccountId===b.accountId&&c.customer.merchantBindingId===b.verifiedBindingId);
  requireHosted(op.amountCents===due.amountCents&&op.idempotencyKey===`rm:${op.workspaceId}:${op.id}`&&op.requestDigest===digest([offer.id,offer.revision,line.id,due]));
  requireHosted(due.index===1?c.laterDuePolicy===null&&c.linkExpiresAt===offer.expiresAt:c.laterDuePolicy!==null&&line.mode==='installments');
  requireHosted(op.state==='confirmed'?op.result!==null:op.result===null);
  if(op.result){const r=op.result;requireHosted(r.providerAccountId===b.accountId&&r.purchaseId===op.purchaseId&&r.dueId===op.dueId&&r.amountCents===op.amountCents&&r.idempotencyKey===op.idempotencyKey);hostedUrl(r.url);}
  return {...c,offer};
 }catch{throw unavailable();}
}
export function validateStripeTestHostedObservation(raw:unknown,c:StripeTestHostedContext,invoiceId?:string):StripeTestHostedObservation{
 const o=parse(observationSchema,raw),expected=c.operation.amountCents;
 requireHosted(o.contextDigest===digest(c)&&o.customerId===c.customer.customerId&&(!invoiceId||o.invoiceId===invoiceId));
 if(c.operation.result)requireHosted(o.invoiceId===c.operation.result.providerObjectId);
 requireHosted(o.hasLine?o.amountDueCents===expected||o.status==='void'&&o.amountDueCents===0:o.status==='draft'&&o.amountDueCents===0);
 requireHosted(o.status==='void'?o.paidCents===0&&o.remainingCents===0:o.paidCents+o.remainingCents===o.amountDueCents);
 if(o.status==='paid')requireHosted(o.hasLine&&o.paidCents===expected&&o.remainingCents===0);
 if(o.status==='draft')requireHosted(o.paidCents===0&&o.url===null);
 if(o.url){hostedUrl(o.url);requireHosted(o.status==='open'&&o.hasLine&&o.paidCents===0&&o.remainingCents===expected);}
 return o;
}
function interruptible<T>(promise:PromiseLike<T>,signal:AbortSignal):Promise<T>{return new Promise((resolve,reject)=>{
 const aborted=()=>{signal.removeEventListener('abort',aborted);reject(unavailable());};
 if(signal.aborted){void Promise.resolve(promise).catch(()=>{});aborted();return;}
 signal.addEventListener('abort',aborted,{once:true});
 Promise.resolve(promise).then(value=>{signal.removeEventListener('abort',aborted);signal.aborted?reject(unavailable()):resolve(value);},()=>{signal.removeEventListener('abort',aborted);reject(unavailable());});
});}

/** UNMOUNTED. Constructor does not discover/verify a merchant or read env.
 * Root must first verify the actual intended direct test account and credential,
 * existing native customer binding, current offer/due and phase authorization.
 * One phase per call; ROOT persists observations before authorizing the next.
 * No customer creation/search, empty-search recovery, send/pay/refund/subscription,
 * webhook processing, DB access or auto retry. due_date never proves expiry.
 * SDK source references (inspected, not executed): stripe23 esm/resources/
 * Invoices.{js,d.ts}: create/add_lines/finalize/void; apiVersion.js endive. */
export class StripeTestHostedInvoiceProvider implements StripeTestHostedProvider {
 readonly execution='stripe_test_hosted_invoice' as const;
 readonly #binding:StripeTestHostedBinding;readonly #secret:string;readonly #clock:()=>Date;
 get binding(){return this.#binding;}
 constructor(secret:string,binding:StripeTestHostedBinding,clock:()=>Date=()=>new Date()){
  requireHosted(Stripe.PACKAGE_VERSION===stripeHostedSdkVersion&&Stripe.API_VERSION===stripeHostedApiVersion);
  this.#secret=parse(z.string().regex(/^(?:rk|sk)_test_[A-Za-z0-9_]{16,256}$/),secret);
  this.#binding=Object.freeze(parse(bindingSchema,binding));this.#clock=clock;
 }
 async perform(raw:StripeTestHostedContext,input:StripeTestHostedAction,signal:AbortSignal):Promise<StripeTestHostedObservation>{
  try{
   const c=validateStripeTestHostedContext(raw,this.binding),action=parse(actionSchema,input),now=this.#clock().valueOf();
   requireHosted(Number.isFinite(now)&&!signal.aborted&&Date.parse(c.customer.verifiedAt)<=now);
   if(action.phase!=='read'&&action.phase!=='close')requireHosted(now<Date.parse(c.linkExpiresAt)&&c.operation.state==='unknown');
   // A finalized invoice may be open while native publication remains UNKNOWN.
   // Root's separate financial-owner port proves its durable journal ID. The
   // exact customer/operation/invoice body is checked by GET before any void.
   if(action.phase==='close')requireHosted(['unknown','confirmed'].includes(c.operation.state));
   if('invoiceId'in action&&c.operation.result)requireHosted(c.operation.result.providerObjectId===action.invoiceId);
   const metadata={rm_operation_id:c.operation.id,rm_purchase_id:c.operation.purchaseId,rm_due_id:c.operation.dueId!};
   const due=c.offer.lines.find(l=>l.id===c.purchaseLineId)!.dues.find(d=>d.id===c.operation.dueId)!;
   let calls=0;
   const request=async(method:'GET'|'POST',path:string,phase:string,invoke:(sdk:Stripe,options:Stripe.RequestOptions)=>PromiseLike<unknown>)=>{
    requireHosted(++calls<=stripeHostedBounds.callsPerPhase&&!signal.aborted);
    if(method==='POST'&&action.phase!=='close')requireHosted(this.#clock().valueOf()<Date.parse(c.linkExpiresAt));
    return this.#request(method,path,`${c.operation.idempotencyKey}:${phase}`,signal,invoke,method==='POST'&&action.phase!=='close'?Date.parse(c.linkExpiresAt):undefined);
   };
   const observation=(rawInvoice:unknown)=>{
    const invoice=parse(invoiceSchema,rawInvoice),line=invoice.lines.data[0],amount=c.operation.amountCents;
    requireHosted(invoice.customer===c.customer.customerId&&invoice.due_date===Math.floor(Date.parse(due.dueAt)/1000)&&digest(parse(metadataSchema,invoice.metadata))===digest(metadata));
    if('invoiceId'in action)requireHosted(invoice.id===action.invoiceId);
    if(line)requireHosted(line.amount===amount&&digest(parse(metadataSchema,line.metadata))===digest(metadata)&&invoice.total===amount);
    else requireHosted(invoice.status==='draft'&&invoice.total===0&&invoice.amount_due===0);
    const url=invoice.status==='open'&&line&&invoice.amount_paid===0&&this.#clock().valueOf()<Date.parse(c.linkExpiresAt)?invoice.hosted_invoice_url:null;
    return validateStripeTestHostedObservation({contextDigest:digest(c),invoiceId:invoice.id,customerId:invoice.customer,status:invoice.status,hasLine:!!line,amountDueCents:invoice.amount_due,paidCents:invoice.amount_paid,remainingCents:invoice.amount_remaining,url},c,'invoiceId'in action?action.invoiceId:undefined);
   };
   if(action.phase==='create'){
    requireHosted(c.operation.result===null);
    const params:Stripe.InvoiceCreateParams={customer:c.customer.customerId,currency:'usd',collection_method:'send_invoice',auto_advance:false,pending_invoice_items_behavior:'exclude',automatic_tax:{enabled:false},default_tax_rates:[],discounts:[],due_date:Math.floor(Date.parse(due.dueAt)/1000),payment_settings:{payment_method_types:['card']},metadata};
    const result=observation(await request('POST','/v1/invoices','invoice',(sdk,options)=>sdk.invoices.create(params,options)));
    requireHosted(result.status==='draft'&&!result.hasLine&&result.paidCents===0);return result;
   }
   const path=`/v1/invoices/${action.invoiceId}`;
   const before=observation(await request('GET',path,'read',(sdk,options)=>sdk.invoices.retrieve(action.invoiceId,{},options)));
   if(action.phase==='read')return before;
   if(action.phase==='close'){
    if(before.status==='void'||before.status==='paid')return before;
    requireHosted(before.status==='open'&&before.hasLine&&before.paidCents===0);
    const closed=observation(await request('POST',path+'/void','void',(sdk,options)=>sdk.invoices.voidInvoice(action.invoiceId,{},options)));
    requireHosted(closed.status==='void'&&closed.paidCents===0&&closed.remainingCents===0);
    const terminal=observation(await request('GET',path,'closed-read',(sdk,options)=>sdk.invoices.retrieve(action.invoiceId,{},options)));
    requireHosted(terminal.status==='void'&&terminal.paidCents===0&&terminal.remainingCents===0);return terminal;
   }
   requireHosted(before.status==='draft'&&before.paidCents===0);
   if(action.phase==='add_line'){
    requireHosted(!before.hasLine);
    const params:Stripe.InvoiceAddLinesParams={lines:[{amount:c.operation.amountCents,quantity:1,discountable:false,discounts:[],tax_rates:[],metadata}]};
    const filled=observation(await request('POST',path+'/add_lines','line',(sdk,options)=>sdk.invoices.addLines(action.invoiceId,params,options)));
    requireHosted(filled.status==='draft'&&filled.hasLine&&filled.paidCents===0);return filled;
   }
   requireHosted(before.hasLine);
   const ready=observation(await request('POST',path+'/finalize','finalize',(sdk,options)=>sdk.invoices.finalizeInvoice(action.invoiceId,{auto_advance:false},options)));
   requireHosted(ready.status==='open'&&ready.hasLine&&ready.paidCents===0&&ready.url);return ready;
  }catch{throw unavailable();}
 }
 async #request(method:'GET'|'POST',path:string,key:string,signal:AbortSignal,invoke:(sdk:Stripe,options:Stripe.RequestOptions)=>PromiseLike<unknown>,expiresAt?:number):Promise<unknown>{
  const deadline=new AbortController(),timer=setTimeout(()=>deadline.abort(),stripeHostedBounds.requestMilliseconds),combined=AbortSignal.any([signal,deadline.signal]);
  let dispatched=false;
  const guarded:typeof fetch=async(input,init)=>{
   let reader:ReadableStreamDefaultReader<Uint8Array>|undefined,response:Response|undefined,complete=false;
   try{
    requireHosted(!combined.aborted&&!dispatched);dispatched=true;
    if(expiresAt!==undefined)requireHosted(this.#clock().valueOf()<expiresAt);
    requireHosted(typeof input==='string'||input instanceof URL);const url=new URL(String(input));
    requireHosted(url.origin==='https://api.stripe.com'&&url.pathname===path&&!url.search&&!url.hash&&!url.username&&!url.password&&(init?.method??'GET').toUpperCase()===method);
    const headers=new Headers(init?.headers);
    requireHosted(headers.get('stripe-version')===stripeHostedApiVersion&&headers.get('stripe-account')===this.binding.accountId&&(method==='GET'? !init?.body:headers.get('idempotency-key')===key));
    const transportSignal=AbortSignal.any([combined,...(init?.signal?[init.signal]:[])]);
    response=await interruptible(fetch(input,{...init,method,redirect:'error',credentials:'omit',cache:'no-store',signal:transportSignal}),transportSignal);
    requireHosted(response.status===200&&/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')??'')&&response.body);
    const length=response.headers.get('content-length');requireHosted(length===null||/^\d+$/.test(length)&&Number(length)<=stripeHostedBounds.objectBytes);
    reader=response.body.getReader();let size=0,reads=0;const chunks:Uint8Array[]=[];
    for(;;){requireHosted(++reads<=stripeHostedBounds.objectBytes+1);const part=await interruptible(reader.read(),transportSignal);if(part.done){complete=true;break;}size+=part.value.byteLength;requireHosted(size<=stripeHostedBounds.objectBytes);chunks.push(part.value);}
    requireHosted(!combined.aborted);return new Response(Buffer.concat(chunks,size),{status:200,headers:{'content-type':'application/json'}});
   }catch{deadline.abort();throw unavailable();}
   finally{if(reader){if(!complete)void reader.cancel().catch(()=>{});try{reader.releaseLock();}catch{/* Aborted pending read. */}}else if(response?.body&&!complete)void response.body.cancel().catch(()=>{});}
  };
  try{
   requireHosted(!combined.aborted);
   const sdk=new Stripe(this.#secret,{apiVersion:stripeHostedApiVersion,timeout:stripeHostedBounds.requestMilliseconds,maxNetworkRetries:0,telemetry:false,httpClient:Stripe.createFetchHttpClient(guarded)});
   return await interruptible(invoke(sdk,{apiVersion:stripeHostedApiVersion,stripeAccount:this.binding.accountId,timeout:stripeHostedBounds.requestMilliseconds,maxNetworkRetries:0,...(method==='POST'?{idempotencyKey:key}:{})}),combined);
  }catch{throw unavailable();}finally{clearTimeout(timer);}
 }
}
