import "server-only";
import {z} from "zod";
import {AppError} from "../../lib/errors.ts";
import {asId} from "../../lib/ids.ts";
import {freshActor,lockWorkspace} from "../identity/data.ts";
import {one,type IdentityStore,type SqlSession} from "../identity/store.ts";
import {systemClock,type Actor,type IdentityClock} from "../identity/types.ts";
import {approvedOffer,digest,type MerchantBinding} from "../fishing-payments/domain.ts";
import type {ProviderOperation,Receipt} from "../fishing-payments/ports.ts";
import type {NativeStripeReceiptBinding} from "./stripe-read-ports.ts";

const uuid=z.uuid(),opaque=z.string().regex(/^[A-Za-z0-9_.:-]{1,160}$/),money=z.number().int().positive().max(100_000_000);
const providerId=(prefix:string)=>z.string().regex(new RegExp(`^${prefix}_[A-Za-z0-9_]{1,150}$`));
const merchantSchema=z.strictObject({accountId:providerId("acct"),livemode:z.literal(false),apiVersion:z.string().min(1).max(80),verifiedBindingId:opaque});
const resultBase={providerObjectId:opaque,providerAccountId:providerId("acct"),livemode:z.literal(false),currency:z.literal("USD"),amountCents:money,purchaseId:uuid,idempotencyKey:z.string().min(1).max(255)};
const operationSchema=z.strictObject({id:uuid,kind:z.enum(["hosted_invoice","refund"]),workspaceId:uuid,purchaseId:uuid,dueId:opaque,refundPaymentId:providerId("pi").nullable(),providerAccountId:providerId("acct"),livemode:z.literal(false),amountCents:money,currency:z.literal("USD"),idempotencyKey:z.string().min(1).max(255),state:z.literal("confirmed"),requestDigest:z.string().regex(/^[a-f0-9]{64}$/),result:z.discriminatedUnion("kind",[
 z.strictObject({...resultBase,kind:z.literal("hosted_invoice"),url:z.url().max(2048),dueId:opaque}),
 z.strictObject({...resultBase,kind:z.literal("refund"),status:z.enum(["pending","succeeded","failed"])})])});
const mapping=z.object({id:uuid,revision:z.number().int().positive(),customerBindingId:uuid,purchaseId:uuid,hostedOperationId:uuid,operationId:uuid,invoiceId:providerId("in"),objectId:opaque,objectKind:z.enum(["invoice","payment_intent","checkout_session","charge","refund"]),verifiedAt:z.date(),revokedAt:z.date().nullable(),provenance:opaque});
type Mapping=z.infer<typeof mapping>;
const customerSchema=z.object({id:uuid,revision:z.number().int().positive(),payerAccountId:uuid,customerId:providerId("cus"),merchantBindingId:opaque,apiVersion:z.string().min(1).max(80),verifiedAt:z.date(),revokedAt:z.date().nullable(),provenance:opaque});
const receiptSchema=z.strictObject({eventId:providerId("evt"),eventType:z.string().min(1).max(100),objectId:opaque,providerAccountId:providerId("acct"),livemode:z.literal(false),apiVersion:z.string().min(1).max(80),digest:z.string().regex(/^[a-f0-9]{64}$/),createdAt:z.iso.datetime({offset:true})});
const mapColumns=`id,revision,customer_binding_id AS "customerBindingId",purchase_id AS "purchaseId",hosted_operation_id AS "hostedOperationId",operation_id AS "operationId",invoice_id AS "invoiceId",object_id AS "objectId",object_kind AS "objectKind",verified_at AS "verifiedAt",revoked_at AS "revokedAt",provenance_reference AS provenance`;
const eventKinds:Readonly<Record<string,Mapping["objectKind"]>>=Object.freeze({
 "invoice.paid":"invoice","invoice.payment_failed":"invoice","invoice.payment_action_required":"invoice",
 "payment_intent.succeeded":"payment_intent","payment_intent.payment_failed":"payment_intent","payment_intent.processing":"payment_intent",
 "checkout.session.completed":"checkout_session","checkout.session.async_payment_succeeded":"checkout_session","checkout.session.async_payment_failed":"checkout_session",
 "refund.created":"refund","refund.updated":"refund",
});
function requireBinding(value:unknown):asserts value{if(!value)throw new AppError("UNAVAILABLE");}

/** Unmounted, native read-only resolver. The server must independently verify
 * merchant/client and populate provenance through a separately admitted path.
 * Database references, flags and injected MerchantBinding are NOT that proof.
 * No binding writer, SDK, env lookup, provider read, family DTO or access grant.
 */
export class NativeStripeReceiptBindings {
 readonly #merchant:Readonly<MerchantBinding&{livemode:false}>;
 constructor(private readonly db:IdentityStore,merchant:MerchantBinding,private readonly clock:IdentityClock=systemClock){
  try{this.#merchant=Object.freeze(merchantSchema.parse(merchant));}catch{throw new AppError("UNAVAILABLE");}
 }
 async resolve(actor:Actor,receipt:Receipt,signal:AbortSignal):Promise<NativeStripeReceiptBinding|null>{
  try{
   const r=receiptSchema.parse(receipt),b=this.#merchant,now=this.clock.now();
   requireBinding(!signal.aborted&&Number.isFinite(now.valueOf()));
   requireBinding(r.providerAccountId===b.accountId&&r.livemode===false&&r.apiVersion===b.apiVersion);
   return await this.db.transaction(async tx=>{
    await lockWorkspace(tx,actor.workspaceId);
    const locked=await one(tx,`SELECT s.account_id FROM ls_identity.sessions s JOIN ls_identity.accounts a ON a.workspace_id=s.workspace_id AND a.id=s.account_id
     JOIN ls_identity.account_subjects p ON p.workspace_id=a.workspace_id AND p.account_id=a.id
     WHERE s.workspace_id=$1 AND s.account_id=$2 AND s.token_digest=$3 AND s.revoked_at IS NULL
     AND s.expires_at>GREATEST($4::timestamptz,clock_timestamp()) AND a.state='active' FOR SHARE OF s,a,p`,[actor.workspaceId,actor.id,actor.sessionDigest,now]);
    if(!locked)throw new AppError("UNAUTHENTICATED");
    const current=await freshActor(tx,actor,now);
    if(current.role!=="practitioner"||!current.emailVerifiedAt||current.emailVerifiedAt>now)throw new AppError("FORBIDDEN");
    const kind=Object.hasOwn(eventKinds,r.eventType)?eventKinds[r.eventType]:undefined;if(!kind)return null;
    const saved=await one<{receipt:unknown;digest:string}>(tx,`SELECT receipt_json AS receipt,digest FROM ls_fishing_payments.inbox
     WHERE provider_account_id=$1 AND livemode=false AND event_id=$2 AND octet_length(receipt_json::text)<=131072 FOR SHARE`,[b.accountId,r.eventId]);
    if(!saved)return null;requireBinding(saved.digest===r.digest&&digest(receiptSchema.parse(saved.receipt))===digest(r));
    const row=await one(tx,`SELECT ${mapColumns} FROM ls_fishing_payments.object_bindings
     WHERE workspace_id=$1 AND provider_account_id=$2 AND livemode=false AND object_kind=$3 AND object_id=$4 FOR SHARE`,[current.workspaceId,b.accountId,kind,r.objectId]);
    if(!row)return null;const m=mapping.parse(row);this.validMapping(m,now);
    const cRow=await one(tx,`SELECT id,revision,payer_account_id AS "payerAccountId",customer_id AS "customerId",merchant_binding_id AS "merchantBindingId",api_version AS "apiVersion",verified_at AS "verifiedAt",revoked_at AS "revokedAt",provenance_reference AS provenance
     FROM ls_fishing_payments.customer_bindings WHERE workspace_id=$1 AND id=$2 AND provider_account_id=$3 AND livemode=false FOR SHARE`,[current.workspaceId,m.customerBindingId,b.accountId]);
    if(!cRow)return null;const customer=customerSchema.parse(cRow);
    requireBinding(!customer.revokedAt&&customer.verifiedAt<=now&&customer.merchantBindingId===b.verifiedBindingId&&customer.apiVersion===b.apiVersion);
    const purchase=await one<{offerId:string;lineId:string;revision:number;state:unknown}>(tx,`SELECT offer_id AS "offerId",line_id AS "lineId",revision,state_json AS state FROM ls_fishing_payments.purchases
     WHERE workspace_id=$1 AND id=$2 AND octet_length(state_json::text)<=131072 FOR SHARE`,[current.workspaceId,m.purchaseId]);
    if(!purchase)return null;
    const offerRow=await one<{offer:unknown;digest:string;revision:number}>(tx,`SELECT offer_json AS offer,digest,revision FROM ls_fishing_payments.offers WHERE workspace_id=$1 AND id=$2 AND octet_length(offer_json::text)<=131072 FOR SHARE`,[current.workspaceId,purchase.offerId]);
    if(!offerRow)return null;const offer=approvedOffer(offerRow.offer),line=offer.lines.find(item=>item.id===purchase.lineId);
    requireBinding(digest(offer)===offerRow.digest&&offer.revision===offerRow.revision&&offer.id===purchase.offerId&&offer.workspaceId===current.workspaceId&&offer.operatorAccountId===current.id&&offer.payerAccountId===customer.payerAccountId&&line);
    const state=z.object({purchaseId:uuid,workspaceId:uuid,offerId:opaque,revision:z.number().int().positive(),providerAccountId:providerId("acct"),livemode:z.literal(false),currency:z.literal("USD"),originalTotalCents:money,dues:z.array(z.object({id:opaque,index:z.number().int(),amountCents:money})).min(1).max(3),settlements:z.array(z.object({canonicalTransactionId:opaque,purchaseLineId:opaque,kind:z.enum(["payment","refund","dispute"])})).max(1000)}).parse(purchase.state);
    requireBinding(state.purchaseId===m.purchaseId&&state.workspaceId===current.workspaceId&&state.offerId===offer.id&&state.revision===purchase.revision&&state.providerAccountId===b.accountId&&state.originalTotalCents===line.totalCents);
    requireBinding(state.dues.length===line.dues.length&&state.dues.every((due,i)=>due.id===line.dues[i]?.id&&due.index===line.dues[i]?.index&&due.amountCents===line.dues[i]?.amountCents));
    const hosted=await this.operation(tx,current.workspaceId,m.hostedOperationId),due=line.dues.find(item=>item.id===hosted.dueId);
    requireBinding(hosted.kind==="hosted_invoice"&&hosted.refundPaymentId===null&&hosted.workspaceId===current.workspaceId&&hosted.purchaseId===m.purchaseId&&due&&hosted.amountCents===due.amountCents&&hosted.result.kind==="hosted_invoice"&&hosted.result.providerObjectId===m.invoiceId&&hosted.result.dueId===due.id);
    const rows=await tx.query(`SELECT ${mapColumns} FROM ls_fishing_payments.object_bindings WHERE workspace_id=$1 AND provider_account_id=$2 AND livemode=false
     AND hosted_operation_id=$3 AND object_kind IN('invoice','payment_intent','checkout_session') ORDER BY object_kind LIMIT 4 FOR SHARE`,[current.workspaceId,b.accountId,m.hostedOperationId]);
    requireBinding(rows.length>=1&&rows.length<=3);const objects=rows.map(value=>mapping.parse(value));
    for(const object of objects){this.validMapping(object,now);requireBinding(object.customerBindingId===customer.id&&object.purchaseId===m.purchaseId&&object.invoiceId===m.invoiceId&&object.operationId===hosted.id);}
    requireBinding(objects.filter(object=>object.objectKind==="invoice"&&object.objectId===m.invoiceId).length===1&&new Set(objects.map(object=>object.objectKind)).size===objects.length);
    const invoice={nativeRevision:digest({mapping:m,customer,objects,purchaseRevision:state.revision,offerRevision:offer.revision,receiptDigest:r.digest}),customerBindingId:customer.id,payerAccountId:asId(customer.payerAccountId,"account"),customerId:customer.customerId,invoiceId:m.invoiceId,purchaseLineId:line.id,paymentIntentId:objects.find(object=>object.objectKind==="payment_intent")?.objectId??null,checkoutSessionId:objects.find(object=>object.objectKind==="checkout_session")?.objectId??null,hostedOperation:hosted};
    requireBinding(!signal.aborted);if(kind!=="refund"){requireBinding(m.operationId===hosted.id);return {kind:"payment",invoice};}
    const refund=await this.operation(tx,current.workspaceId,m.operationId);
    requireBinding(refund.kind==="refund"&&refund.purchaseId===m.purchaseId&&refund.dueId===due.id&&refund.refundPaymentId&&refund.result.kind==="refund"&&refund.result.providerObjectId===m.objectId&&refund.amountCents<=hosted.amountCents);
    const paid=await one<{fact:unknown;digest:string}>(tx,`SELECT fact_json AS fact,digest FROM ls_fishing_payments.settlements WHERE provider_account_id=$1 AND livemode=false AND kind='payment'
     AND transaction_id=$2 AND workspace_id=$3 AND purchase_id=$4 AND octet_length(fact_json::text)<=131072 FOR SHARE`,[b.accountId,refund.refundPaymentId,current.workspaceId,m.purchaseId]);
    if(!paid)return null;
    const fact=z.object({canonicalTransactionId:providerId("pi"),purchaseId:uuid,purchaseLineId:opaque,dueId:opaque,operationId:uuid,relatedProviderObjectId:providerId("in"),providerAccountId:providerId("acct"),livemode:z.literal(false),kind:z.literal("payment"),currency:z.literal("USD"),cents:money,originalPaymentId:z.null()}).parse(paid.fact);
    requireBinding(fact.canonicalTransactionId===refund.refundPaymentId&&fact.purchaseId===m.purchaseId&&fact.purchaseLineId===line.id&&fact.dueId===due.id&&fact.operationId===hosted.id&&fact.relatedProviderObjectId===m.invoiceId&&fact.providerAccountId===b.accountId&&(!invoice.paymentIntentId||invoice.paymentIntentId===fact.canonicalTransactionId));
    requireBinding(paid.digest===digest({transaction:fact.canonicalTransactionId,purchase:fact.purchaseId,line:fact.purchaseLineId,due:fact.dueId,merchant:fact.providerAccountId,mode:false,kind:"payment",currency:"USD",cents:fact.cents,originalPayment:null})&&state.settlements.some(item=>item.kind==="payment"&&item.canonicalTransactionId===fact.canonicalTransactionId&&item.purchaseLineId===line.id));
    requireBinding(!signal.aborted);return {kind:"refund",invoice,refundOperation:refund,originalPaymentIntentId:fact.canonicalTransactionId};
   });
  }catch(error){if(error instanceof AppError)throw error;throw new AppError("UNAVAILABLE");}
 }
 private validMapping(value:Mapping,now:Date){requireBinding(!value.revokedAt&&value.verifiedAt<=now);}
 private async operation(tx:SqlSession,workspaceId:string,operationId:string):Promise<ProviderOperation&{result:NonNullable<ProviderOperation["result"]>}> {
  const row=await one<{operation:unknown;purchaseId:string;kind:string;dueId:string|null;requestDigest:string}>(tx,`SELECT operation_json AS operation,purchase_id AS "purchaseId",kind,due_id AS "dueId",request_digest AS "requestDigest" FROM ls_fishing_payments.operations
   WHERE workspace_id=$1 AND id=$2 AND octet_length(operation_json::text)<=131072 FOR SHARE`,[workspaceId,operationId]);
  requireBinding(row);const operation=operationSchema.parse(row.operation),b=this.#merchant,result=operation.result;
  requireBinding(operation.id===operationId&&operation.workspaceId===workspaceId&&operation.purchaseId===row.purchaseId&&operation.kind===row.kind&&operation.dueId===row.dueId&&operation.requestDigest===row.requestDigest&&operation.providerAccountId===b.accountId);
  requireBinding(result.kind===operation.kind&&result.providerAccountId===b.accountId&&result.purchaseId===operation.purchaseId&&result.amountCents===operation.amountCents&&result.idempotencyKey===operation.idempotencyKey);
  return operation;
 }
}
