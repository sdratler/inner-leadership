/** Control915 / Change929: synthetic read-only composition, not provider proof.
 * MAIN must separately admit the fresh guarded database and FOUR pinned SQL
 * candidates (payments, Stage, native program, native Stripe bindings). This
 * file applies no DDL and does not execute/allocate a provider payment.
 */
import {createHmac,randomUUID} from "node:crypto";
import {afterEach,expect,test,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {approvedOffer,digest} from "../../../src/features/fishing-payments/domain.ts";
import type {ProviderOperation,Receipt,ReceiptReadback} from "../../../src/features/fishing-payments/ports.ts";
import {StripeReadbackNormalizer,type StripeReadReason} from "../../../src/features/fishing-payments/stripe-readback.ts";
import {NativeStripeReceiptBindings} from "../../../src/features/fishing/native-stripe-bindings.ts";
import type {StripeInvoicePaymentQuery,StripeReadRequest,StripeTestReadClient} from "../../../src/features/fishing/stripe-read-ports.ts";
import {systemClock,type Actor} from "../../../src/features/identity/types.ts";
import {programFixture,type ProgramFixture} from "../fishing/native-program-fixture.ts";

type Wire=Record<string,unknown>;
const fixtures:ProgramFixture[]=[],CANARY="PRIVATE_SYNTHETIC_COMPOSITION_CONTACT_CARD_CANARY";
afterEach(async()=>{await Promise.all(fixtures.splice(0).map(f=>f.close()));});

class SyntheticStripeReadClient implements StripeTestReadClient {
 readonly transport="SYNTHETIC_IN_MEMORY_NO_NETWORK";
 readonly objects=new Map<string,Wire>();
 readonly calls:(StripeReadRequest|StripeInvoicePaymentQuery)[]=[];
 invoicePage:Wire={};piPage:Wire={};
 constructor(readonly binding:StripeTestReadClient["binding"]){}
 async retrieve(request:StripeReadRequest,signal:AbortSignal):Promise<unknown>{
  if(signal.aborted)throw Error("SYNTHETIC_READ_ABORTED");
  this.calls.push(request);const value=this.objects.get(`${request.object}:${request.id}`);
  if(!value)throw Error("SYNTHETIC_OBJECT_NOT_REGISTERED");return structuredClone(value);
 }
 async listInvoicePayments(query:StripeInvoicePaymentQuery,signal:AbortSignal):Promise<unknown>{
  if(signal.aborted)throw Error("SYNTHETIC_READ_ABORTED");
  this.calls.push(query);return structuredClone("invoiceId" in query?this.invoicePage:this.piPage);
 }
}

type SeedOptions={omitObjects?:boolean;wrongMerchantReference?:boolean;wrongPayer?:boolean;wrongCustomer?:boolean;wrongPi?:boolean};
async function fixture(options:SeedOptions={}){
 const f=await programFixture();fixtures.push(f);
 const schema=(await f.pool.query("SELECT to_regclass('ls_fishing_payments.customer_bindings') AS customers,to_regclass('ls_fishing_payments.object_bindings') AS objects")).rows[0];
 if(!schema?.customers||!schema.objects)throw Error("MAIN_MUST_ADMIT_FOUR_SQL_COMPOSITION_RECIPE");
 await f.createPlan();const family=await f.family(),prepared=await f.prepare(family);
 const offerRow=(await f.pool.query("SELECT offer_json AS offer FROM ls_fishing_payments.offers WHERE workspace_id=$1 AND id=$2",[f.workspaceId,prepared.offer.id])).rows[0];
 const offer=approvedOffer(offerRow?.offer),line=offer.lines.find(value=>value.id===prepared.offer.lines[0]?.id);
 const state=await f.paymentStore.readPayment(f.owner,prepared.purchaseId),due=state?.dues[0];
 if(!line||!state||!due)throw Error("ACTUAL_NATIVE_APPROVED_PURCHASE_REQUIRED");
 const tag=randomUUID().replaceAll("-",""),ids={invoice:`in_${tag}`,pi:`pi_${tag}`,session:`cs_test_${tag}`,customer:`cus_${tag}`,charge:`ch_${tag}`,allocation:`inpay_${tag}`,balance:`txn_${tag}`};
 const operationId=randomUUID(),customerBindingId=randomUUID(),verifiedAt=new Date(Date.now()-60000);
 // Fixture-only synthetic confirmation; no provider create, permissive authority
 // callback, trusted binding-population claim or payment allocation is involved.
 const operation:ProviderOperation={id:operationId,kind:"hosted_invoice",workspaceId:f.workspaceId,purchaseId:prepared.purchaseId,dueId:due.id,refundPaymentId:null,providerAccountId:f.merchant.accountId,livemode:false,amountCents:due.amountCents,currency:"USD",idempotencyKey:`rm:${f.workspaceId}:${operationId}`,state:"confirmed",requestDigest:digest({synthetic:"composition-only",offer:offer.id,revision:offer.revision,line:line.id,due}),result:{kind:"hosted_invoice",providerObjectId:ids.invoice,url:`https://invoice.stripe.com/i/SYNTHETIC_${tag}`,providerAccountId:f.merchant.accountId,livemode:false,currency:"USD",amountCents:due.amountCents,purchaseId:prepared.purchaseId,dueId:due.id,idempotencyKey:`rm:${f.workspaceId}:${operationId}`}};
 await f.pool.query("INSERT INTO ls_fishing_payments.operations(workspace_id,id,purchase_id,kind,due_id,request_digest,operation_json) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)",[f.workspaceId,operation.id,prepared.purchaseId,operation.kind,due.id,operation.requestDigest,JSON.stringify(operation)]);
 const bindingPayer=options.wrongPayer?await f.account("parent"):family.parent;
 await f.pool.query("INSERT INTO ls_fishing_payments.customer_bindings(workspace_id,id,revision,payer_account_id,provider_account_id,livemode,customer_id,merchant_binding_id,api_version,provenance_reference,verified_at) VALUES($1,$2,1,$3,$4,false,$5,$6,$7,'SYNTHETIC_COMPOSITION_NOT_PROVIDER_PROOF',$8)",[f.workspaceId,customerBindingId,bindingPayer.id,f.merchant.accountId,options.wrongCustomer?`cus_other_${tag}`:ids.customer,options.wrongMerchantReference?"SYNTHETIC_WRONG_MERCHANT_REFERENCE":f.merchant.verifiedBindingId,f.merchant.apiVersion,verifiedAt]);
 if(!options.omitObjects){
  for(const [kind,objectId] of [["invoice",ids.invoice],["payment_intent",options.wrongPi?`pi_other_${tag}`:ids.pi],["checkout_session",ids.session]]){
   await f.pool.query("INSERT INTO ls_fishing_payments.object_bindings(workspace_id,id,revision,provider_account_id,livemode,customer_binding_id,purchase_id,hosted_operation_id,operation_id,invoice_id,object_kind,object_id,provenance_reference,verified_at) VALUES($1,$2,1,$3,false,$4,$5,$6,$6,$7,$8,$9,'SYNTHETIC_COMPOSITION_NOT_PROVIDER_PROOF',$10)",[f.workspaceId,randomUUID(),f.merchant.accountId,customerBindingId,prepared.purchaseId,operation.id,ids.invoice,kind,objectId,verifiedAt]);
  }
 }
 const binding={...f.merchant,livemode:false as const},client=new SyntheticStripeReadClient(binding),time=Math.floor(Date.now()/1000)-10;
 const metadata={rm_operation_id:operation.id,rm_purchase_id:prepared.purchaseId,rm_due_id:due.id};
 const invoice:Wire={id:ids.invoice,object:"invoice",livemode:false,customer:ids.customer,currency:"usd",amount_due:due.amountCents,amount_paid:due.amountCents,amount_remaining:0,total:due.amountCents,status:"paid",metadata,customer_email:CANARY};
 const intent:Wire={id:ids.pi,object:"payment_intent",livemode:false,customer:ids.customer,currency:"usd",amount:due.amountCents,amount_received:due.amountCents,amount_capturable:0,status:"succeeded",latest_charge:ids.charge,last_payment_error:null,metadata,client_secret:CANARY};
 const charge:Wire={id:ids.charge,object:"charge",livemode:false,customer:ids.customer,payment_intent:ids.pi,currency:"usd",amount:due.amountCents,amount_captured:due.amountCents,amount_refunded:0,paid:true,captured:true,status:"succeeded",disputed:false,balance_transaction:ids.balance,created:time-2,metadata,billing_details:{email:CANARY}};
 const session:Wire={id:ids.session,object:"checkout.session",livemode:false,customer:ids.customer,invoice:ids.invoice,payment_intent:ids.pi,currency:"usd",mode:"payment",status:"complete",payment_status:"paid",metadata,client_reference_id:CANARY};
 const allocation:Wire={id:ids.allocation,object:"invoice_payment",invoice:ids.invoice,livemode:false,currency:"usd",amount_paid:due.amountCents,amount_requested:due.amountCents,status:"paid",payment:{type:"payment_intent",payment_intent:ids.pi},status_transitions:{paid_at:time-1}};
 const balance:Wire={id:ids.balance,object:"balance_transaction",source:ids.charge,currency:"usd",amount:due.amountCents,fee:100,net:due.amountCents-100};
 client.invoicePage={object:"list",url:"/v1/invoice_payments",has_more:false,data:[allocation]};client.piPage=structuredClone(client.invoicePage);
 for(const [kind,value] of [["invoice",invoice],["payment_intent",intent],["charge",charge],["checkout_session",session],["balance_transaction",balance]] as const)client.objects.set(`${kind}:${String(value.id)}`,value);
 const receipts:Receipt[]=[],native=new NativeStripeReceiptBindings(f.db,f.merchant,systemClock);
 function reader(actor:Actor=f.owner){return new StripeReadbackNormalizer({client,clock:systemClock,resolveNativeBinding:(receipt,signal)=>native.resolve(actor,receipt,signal)});}
 async function receipt(eventType="invoice.paid",objectId=ids.invoice,object="invoice"){
  const eventId=`evt_${randomUUID().replaceAll("-","")}`,created=Math.floor(Date.now()/1000),secret="whsec_SYNTHETIC_NATIVE_COMPOSITION_ONLY";
  const event:Wire={id:eventId,object:"event",type:eventType,account:f.merchant.accountId,livemode:false,api_version:f.merchant.apiVersion,created,data:{object:{id:objectId,object,private:CANARY}}};
  const body=Buffer.from(JSON.stringify(event)),signature=`t=${created},v1=${createHmac("sha256",secret).update(`${created}.`).update(body).digest("hex")}`;
  await f.inbox.acceptSynthetic(body,signature,secret);
  const row=(await f.pool.query<{receipt:Receipt}>("SELECT receipt_json AS receipt FROM ls_fishing_payments.inbox WHERE provider_account_id=$1 AND livemode=false AND event_id=$2",[f.merchant.accountId,eventId])).rows[0];
  if(!row)throw Error("DURABLE_SYNTHETIC_RECEIPT_REQUIRED");client.objects.set(`event:${eventId}`,event);receipts.push(row.receipt);return row.receipt;
 }
 return {f,family,prepared,offer,line,state,due,ids,operation,customerBindingId,client,invoice,intent,charge,session,allocation,balance,time,receipts,native,reader,receipt};
}
type Fixture=Awaited<ReturnType<typeof fixture>>;

// Fixed, workspace-scoped snapshots hash rows so assertion failures cannot dump
// encrypted native records, session digests, raw provider payloads or contacts.
const effectTables=["ls_identity.accounts","ls_identity.account_subjects","ls_identity.sessions","ls_fishing_payments.offers","ls_fishing_payments.purchases","ls_fishing_payments.operations","ls_fishing_payments.settlements","ls_fishing_payments.commands","ls_fishing_payments.outbox","ls_fishing_payments.reminders","ls_fishing_payments.founder_households","ls_fishing_payments.customer_bindings","ls_fishing_payments.object_bindings","ls_fishing_stage.plans","ls_fishing_stage.occurrences","ls_fishing_stage.revisions","ls_fishing_stage.operations","ls_fishing_stage.command_receipts","ls_fishing_stage.offer_approvals","ls_fishing_stage.enrollments","ls_fishing_stage.seat_reservations","ls_fishing_stage.resource_reservations","ls_education.account_grants","ls_calendar.appointments","ls_cases.cases"] as const;
async function effects(c:Fixture){
 const values:Record<string,string>={};
 for(const table of effectTables){const rows=(await c.f.pool.query(`SELECT to_jsonb(t) AS row FROM ${table} t WHERE workspace_id=$1 ORDER BY to_jsonb(t)::text`,[c.f.workspaceId])).rows;values[table]=digest(rows);}
 const inbox=(await c.f.pool.query("SELECT to_jsonb(t) AS row FROM ls_fishing_payments.inbox t WHERE provider_account_id=$1 AND livemode=false AND event_id=ANY($2::text[]) ORDER BY event_id",[c.f.merchant.accountId,c.receipts.map(r=>r.eventId)])).rows;
 values["ls_fishing_payments.inbox"]=digest(inbox);return values;
}
async function readOnly<T>(c:Fixture,read:()=>Promise<T>):Promise<T>{
 const before=await effects(c);expect(c.f.provider.calls).toBe(0);expect(c.f.provider.results.size).toBe(0);expect(c.f.provider.readback).toBeNull();
 try{return await read();}finally{expect(await effects(c)).toEqual(before);expect(c.f.provider.calls).toBe(0);expect(c.f.provider.results.size).toBe(0);expect(c.f.provider.readback).toBeNull();}
}
async function denied(c:Fixture,r:Receipt,reason:StripeReadReason,options:{actor?:Actor;native?:"missing"|"UNAVAILABLE"|"UNAUTHENTICATED"|"FORBIDDEN";beforeRead?:boolean}={}){
 c.client.calls.length=0;
 await readOnly(c,async()=>{
  if(options.native){const result=c.native.resolve(options.actor??c.f.owner,r,new AbortController().signal);
   if(options.native==="missing")expect(await result).toBeNull();else await expect(result).rejects.toMatchObject({code:options.native});
  }
  await expect(c.reader(options.actor).reconcileReceipt(r)).rejects.toMatchObject({code:"STRIPE_RECONCILIATION_REQUIRED",reason,message:"Stripe reconciliation required"});
  if(options.beforeRead)expect(c.client.calls).toHaveLength(0);
 });
}
async function positive(c:Fixture,r:Receipt){
 const result=await readOnly(c,()=>c.reader().reconcileReceipt(r));
 expect(result).toMatchObject({receiptId:r.eventId,resolvedObjectId:r.objectId,providerAccountId:c.f.merchant.accountId,livemode:false,dues:[]});
 expect(Number.isFinite(Date.parse(result.readAt))).toBe(true);
 expect(result.facts).toEqual([{providerReceiptId:r.eventId,purchaseId:c.prepared.purchaseId,purchaseLineId:c.line.id,dueId:c.due.id,providerAccountId:c.f.merchant.accountId,livemode:false,currency:"USD",canonicalTransactionId:c.ids.pi,relatedProviderObjectId:c.ids.invoice,operationId:c.operation.id,kind:"payment",cents:c.due.amountCents,feeCents:100,originalPaymentId:null,occurredAt:new Date((c.time-1)*1000).toISOString()}]);
 expect(JSON.stringify(result)).not.toContain(CANARY);return result;
}

test("native invoice, PI and Checkout receipts produce the same canonical payment DTO without allocation",async()=>{
 const c=await fixture(),results:ReceiptReadback[]=[];
 expect(c.state.paidCents).toBe(0);expect(c.state.settlements).toEqual([]);
 for(const [type,id,object] of [["invoice.paid",c.ids.invoice,"invoice"],["payment_intent.succeeded",c.ids.pi,"payment_intent"],["checkout.session.completed",c.ids.session,"checkout.session"]]){
  const r=await c.receipt(type,id,object);c.client.calls.length=0;results.push(await positive(c,r));
  expect(c.client.calls.filter(call=>"invoiceId" in call)).toEqual([{invoiceId:c.ids.invoice,limit:100}]);
  expect(c.client.calls.filter(call=>"paymentIntentId" in call)).toEqual([{paymentIntentId:c.ids.pi,limit:100}]);
  expect(c.client.calls.length).toBeLessThanOrEqual(11);
 }
 expect(new Set(results.flatMap(r=>r.facts.map(f=>f.canonicalTransactionId)))).toEqual(new Set([c.ids.pi]));
 const replay=await positive(c,c.receipts[0]!);expect(replay.facts).toEqual(results[0]!.facts);
 expect(c.reader().execution).toBe("stripe_test_read_only");
},30000);

test("missing durable inbox or object mapping stops before synthetic Stripe reads",async()=>{
 const control=await fixture(),r=await control.receipt();await positive(control,r);
 await control.f.pool.query("DELETE FROM ls_fishing_payments.inbox WHERE provider_account_id=$1 AND livemode=false AND event_id=$2",[control.f.merchant.accountId,r.eventId]);
 await denied(control,r,"NATIVE_MAPPING_REQUIRED",{native:"missing",beforeRead:true});
 const missing=await fixture({omitObjects:true}),unmapped=await missing.receipt();
 await denied(missing,unmapped,"NATIVE_MAPPING_REQUIRED",{native:"missing",beforeRead:true});
},30000);

test("revoked customer or object binding stops before synthetic Stripe reads",async()=>{
 for(const table of ["customer_bindings","object_bindings"] as const){
  const c=await fixture(),r=await c.receipt();await positive(c,r);
  // Revocation is the only binding mutation allowed by the retained SQL trigger.
  await c.f.pool.query(`UPDATE ls_fishing_payments.${table} SET revision=revision+1,revoked_at=clock_timestamp() WHERE workspace_id=$1`,[c.f.workspaceId]);
  await denied(c,r,"DEPENDENCY_FAILURE",{native:"UNAVAILABLE",beforeRead:true});
 }
},30000);

test("current native session and role override cached operator claims",async()=>{
 for(const mode of ["revoked-session","changed-stored-role","forged-parent-role"] as const){
  const c=await fixture(),r=await c.receipt();await positive(c,r);let actor=c.f.owner;
  if(mode==="revoked-session")await c.f.pool.query("UPDATE ls_identity.sessions SET revoked_at=clock_timestamp() WHERE workspace_id=$1 AND account_id=$2 AND token_digest=$3",[c.f.workspaceId,c.f.owner.id,c.f.owner.sessionDigest]);
  if(mode==="changed-stored-role")await c.f.pool.query("UPDATE ls_identity.accounts SET role='parent' WHERE workspace_id=$1 AND id=$2",[c.f.workspaceId,c.f.owner.id]);
  if(mode==="forged-parent-role")actor={...c.family.parent,role:"practitioner"};
  await denied(c,r,"DEPENDENCY_FAILURE",{actor,native:mode==="revoked-session"?"UNAUTHENTICATED":"FORBIDDEN",beforeRead:true});
 }
},30000);

test("merchant, customer and payer bindings cannot select another native purchase",async()=>{
 const control=await fixture();await positive(control,await control.receipt());
 for(const options of [{wrongMerchantReference:true},{wrongPayer:true}]){
  const c=await fixture(options),r=await c.receipt();await denied(c,r,"DEPENDENCY_FAILURE",{native:"UNAVAILABLE",beforeRead:true});
 }
 for(const options of [{wrongCustomer:true},{wrongPi:true}]){
  const c=await fixture(options),r=await c.receipt();
  await readOnly(c,async()=>{expect((await c.native.resolve(c.f.owner,r,new AbortController().signal))?.kind).toBe("payment");});
  await denied(c,r,options.wrongCustomer?"MONEY_MISMATCH":"OBJECT_MISMATCH");
  expect(c.client.calls.length).toBeGreaterThan(0);
 }
},30000);

test("durable receipt identity must match before object traversal",async()=>{
 const c=await fixture(),r=await c.receipt();await positive(c,r);
 for(const changed of [{digest:"0".repeat(64)},{objectId:"in_SYNTHETIC_OTHER"},{providerAccountId:"acct_SYNTHETIC_OTHER"},{apiVersion:"SYNTHETIC_OTHER_API"}]){
  const current={...r,...changed},precheck="providerAccountId" in changed||"apiVersion" in changed;
  await denied(c,current,precheck?"CLIENT_BINDING_MISMATCH":"DEPENDENCY_FAILURE",{native:"UNAVAILABLE",beforeRead:true});
 }
},30000);

test("native mappings do not excuse a conflicting current event or payment chain",async()=>{
 const c=await fixture(),r=await c.receipt();await positive(c,r);
 const event=c.client.objects.get(`event:${r.eventId}`)!;
 const variants:{target:Wire;change:Wire;reason:StripeReadReason}[]=[
  {target:event,change:{data:{object:{id:c.ids.pi,object:"payment_intent"}}},reason:"EVENT_MISMATCH"},
  {target:c.invoice,change:{customer:"cus_SYNTHETIC_OTHER"},reason:"MONEY_MISMATCH"},
  {target:c.invoice,change:{amount_due:c.due.amountCents+1,total:c.due.amountCents+1,amount_remaining:1},reason:"MONEY_MISMATCH"},
  {target:c.invoice,change:{metadata:{rm_operation_id:c.operation.id,rm_purchase_id:c.prepared.purchaseId,rm_due_id:"SYNTHETIC_OTHER_DUE"}},reason:"METADATA_MISMATCH"},
  {target:c.charge,change:{payment_intent:"pi_SYNTHETIC_OTHER"},reason:"OBJECT_MISMATCH"},
  {target:c.charge,change:{captured:false},reason:"CAPTURE_NOT_VERIFIED"},
  {target:c.charge,change:{amount_captured:c.due.amountCents-1},reason:"MONEY_MISMATCH"},
  {target:c.client.piPage,change:{data:[{...c.allocation,amount_paid:c.due.amountCents-1}]},reason:"ALLOCATION_AMBIGUOUS"},
 ];
 for(const variant of variants){
  const before=structuredClone(variant.target);Object.assign(variant.target,variant.change);
  try{await denied(c,r,variant.reason);expect(c.client.calls.length).toBeGreaterThan(0);}finally{Object.assign(variant.target,before);}
 }
 await positive(c,r);
},30000);

test("mapped current action-required payment returns dues only",async()=>{
 const c=await fixture(),r=await c.receipt("invoice.payment_action_required");
 Object.assign(c.invoice,{status:"open",amount_paid:0,amount_remaining:c.due.amountCents});
 Object.assign(c.intent,{status:"requires_action",amount_received:0,latest_charge:null});
 Object.assign(c.allocation,{status:"open",amount_paid:null,status_transitions:{paid_at:null}});c.client.piPage=structuredClone(c.client.invoicePage);
 const result=await readOnly(c,()=>c.reader().reconcileReceipt(r));
 expect(result).toMatchObject({receiptId:r.eventId,resolvedObjectId:c.ids.invoice,providerAccountId:c.f.merchant.accountId,livemode:false,facts:[],dues:[{purchaseId:c.prepared.purchaseId,operationId:c.operation.id,dueId:c.due.id,state:"action_required"}]});
 expect(c.client.calls.some(call=>"object" in call&&call.object==="charge")).toBe(false);
 expect(JSON.stringify(result)).not.toContain(CANARY);
},30000);
