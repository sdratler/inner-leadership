/** OFFLINE native composition: real SDK signatures/read serialization, stubbed
 * fixed GET transport, synthetic approvals/merchant. No provider/network proof.
 * Fresh exact loopback four-SQL recipe must be separately admitted by Root. */
import {randomUUID} from "node:crypto";
import Stripe from "stripe";
import {afterEach,expect,test,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {approvedOffer,digest} from "../../../src/features/fishing-payments/domain.ts";
import type {ProviderOperation,Receipt} from "../../../src/features/fishing-payments/ports.ts";
import {FishingPaymentStore} from "../../../src/features/fishing-payments/store.ts";
import {FishingReceiptInbox} from "../../../src/features/fishing-payments/receipts.ts";
import {StripeReadbackNormalizer} from "../../../src/features/fishing-payments/stripe-readback.ts";
import {NativeStripeReceiptBindings} from "../../../src/features/fishing/native-stripe-bindings.ts";
import {StripeSdkTestReadClient} from "../../../src/features/fishing/stripe-sdk-test-read-client.ts";
import type {StripeInvoicePaymentQuery,StripeReadRequest,StripeTestReadClient} from "../../../src/features/fishing/stripe-read-ports.ts";
import {systemClock,type Actor} from "../../../src/features/identity/types.ts";
import {IdentityAuthService} from "../../../src/features/identity/auth-service.ts";
import {IdentitySessions} from "../../../src/features/identity/session-adapter.ts";
import type {IdentityStore,SqlSession} from "../../../src/features/identity/store.ts";
import {programFixture,type ProgramFixture} from "../fishing/native-program-fixture.ts";
type Wire=Record<string,unknown>;
const fixtures:ProgramFixture[]=[],clients:SdkFixtureClient[]=[],CANARY="PRIVATE_SYNTHETIC_SDK_NATIVE_CANARY";
afterEach(async()=>{vi.unstubAllGlobals();clients.length=0;await Promise.all(fixtures.splice(0).map(f=>f.close()));});
class SdkFixtureClient implements StripeTestReadClient {
 readonly objects=new Map<string,Wire>();readonly calls:string[]=[];invoicePage:Wire={};piPage:Wire={};
 beforeTransport:(()=>Promise<void>)|undefined;
 readonly sdk:StripeSdkTestReadClient;
 constructor(readonly binding:StripeTestReadClient["binding"]){
  this.sdk=new StripeSdkTestReadClient("sk_test_SYNTHETIC_NATIVE_TRANSPORT_ONLY",binding);clients.push(this);
  vi.stubGlobal("fetch",async(input:RequestInfo|URL,init?:RequestInit)=>{
   const url=new URL(String(input));expect(url.origin).toBe("https://api.stripe.com");expect(init?.method).toBe("GET");
   const objectId=decodeURIComponent(url.pathname.split("/").at(-1)??""),list=url.pathname==="/v1/invoice_payments";
   const q=url.searchParams.get("invoice")??url.searchParams.get("payment[payment_intent]");
   const owner=clients.find(c=>[...c.objects.values()].some(x=>x.id===(list?q:objectId)));if(!owner)throw Error("UNREGISTERED_SYNTHETIC_GET");
   owner.calls.push(url.pathname);const hook=owner.beforeTransport;owner.beforeTransport=undefined;if(hook)await hook();
   const value=list?(url.searchParams.has("invoice")?owner.invoicePage:owner.piPage):[...owner.objects.values()].find(x=>x.id===objectId);
   if(!value)throw Error("UNREGISTERED_SYNTHETIC_OBJECT");return new Response(JSON.stringify(value),{status:200,headers:{"content-type":"application/json"}});
  });
 }
 retrieve(r:StripeReadRequest,s:AbortSignal){return this.sdk.retrieve(r,s);}
 listInvoicePayments(q:StripeInvoicePaymentQuery,s:AbortSignal){return this.sdk.listInvoicePayments(q,s);}
}
type SeedOptions={omitObjects?:boolean;wrongMerchantReference?:boolean;wrongPayer?:boolean;wrongCustomer?:boolean;wrongPi?:boolean};
async function fixture(options:SeedOptions={}){
 const f=await programFixture();fixtures.push(f);const merchant={...f.merchant,apiVersion:"2026-09-30.endive"},store=new FishingPaymentStore({database:f.db,clock:systemClock,merchant,authority:f.paymentStore.deps.authority});
 const schema=(await f.pool.query("SELECT to_regclass('ls_fishing_payments.customer_bindings') AS customers,to_regclass('ls_fishing_payments.object_bindings') AS objects")).rows[0];
 if(!schema?.customers||!schema.objects)throw Error("MAIN_MUST_ADMIT_FOUR_SQL_COMPOSITION_RECIPE");
 await f.createPlan();const family=await f.family(),prepared=await f.prepare(family);
 const offerRow=(await f.pool.query("SELECT offer_json AS offer FROM ls_fishing_payments.offers WHERE workspace_id=$1 AND id=$2",[f.workspaceId,prepared.offer.id])).rows[0];
 const offer=approvedOffer(offerRow?.offer),line=offer.lines.find(value=>value.id===prepared.offer.lines[0]?.id);
 const state=await store.readPayment(f.owner,prepared.purchaseId),due=state?.dues[0];
 if(!line||!state||!due)throw Error("ACTUAL_NATIVE_APPROVED_PURCHASE_REQUIRED");
 const tag=randomUUID().replaceAll("-",""),ids={invoice:`in_${tag}`,pi:`pi_${tag}`,session:`cs_test_${tag}`,customer:`cus_${tag}`,charge:`ch_${tag}`,allocation:`inpay_${tag}`,balance:`txn_${tag}`};
 const operationId=randomUUID(),customerBindingId=randomUUID(),verifiedAt=new Date(Date.now()-60000);
 // Fixture-only synthetic confirmation; no provider create, permissive authority
 // callback, trusted binding-population claim or payment allocation is involved.
 const operation:ProviderOperation={id:operationId,kind:"hosted_invoice",workspaceId:f.workspaceId,purchaseId:prepared.purchaseId,dueId:due.id,refundPaymentId:null,providerAccountId:merchant.accountId,livemode:false,amountCents:due.amountCents,currency:"USD",idempotencyKey:`rm:${f.workspaceId}:${operationId}`,state:"confirmed",requestDigest:digest({synthetic:"composition-only",offer:offer.id,revision:offer.revision,line:line.id,due}),result:{kind:"hosted_invoice",providerObjectId:ids.invoice,url:`https://invoice.stripe.com/i/SYNTHETIC_${tag}`,providerAccountId:merchant.accountId,livemode:false,currency:"USD",amountCents:due.amountCents,purchaseId:prepared.purchaseId,dueId:due.id,idempotencyKey:`rm:${f.workspaceId}:${operationId}`}};
 await f.pool.query("INSERT INTO ls_fishing_payments.operations(workspace_id,id,purchase_id,kind,due_id,request_digest,operation_json) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)",[f.workspaceId,operation.id,prepared.purchaseId,operation.kind,due.id,operation.requestDigest,JSON.stringify(operation)]);
 const bindingPayer=options.wrongPayer?await f.account("parent"):family.parent;
 await f.pool.query("INSERT INTO ls_fishing_payments.customer_bindings(workspace_id,id,revision,payer_account_id,provider_account_id,livemode,customer_id,merchant_binding_id,api_version,provenance_reference,verified_at) VALUES($1,$2,1,$3,$4,false,$5,$6,$7,'SYNTHETIC_COMPOSITION_NOT_PROVIDER_PROOF',$8)",[f.workspaceId,customerBindingId,bindingPayer.id,merchant.accountId,options.wrongCustomer?`cus_other_${tag}`:ids.customer,options.wrongMerchantReference?"SYNTHETIC_WRONG_MERCHANT_REFERENCE":merchant.verifiedBindingId,merchant.apiVersion,verifiedAt]);
 if(!options.omitObjects){
  for(const [kind,objectId] of [["invoice",ids.invoice],["payment_intent",options.wrongPi?`pi_other_${tag}`:ids.pi],["checkout_session",ids.session]]){
   await f.pool.query("INSERT INTO ls_fishing_payments.object_bindings(workspace_id,id,revision,provider_account_id,livemode,customer_binding_id,purchase_id,hosted_operation_id,operation_id,invoice_id,object_kind,object_id,provenance_reference,verified_at) VALUES($1,$2,1,$3,false,$4,$5,$6,$6,$7,$8,$9,'SYNTHETIC_COMPOSITION_NOT_PROVIDER_PROOF',$10)",[f.workspaceId,randomUUID(),merchant.accountId,customerBindingId,prepared.purchaseId,operation.id,ids.invoice,kind,objectId,verifiedAt]);
  }
 }
 const binding={...merchant,livemode:false as const},client=new SdkFixtureClient(binding),time=Math.floor(Date.now()/1000)-10;
 const metadata={rm_operation_id:operation.id,rm_purchase_id:prepared.purchaseId,rm_due_id:due.id};
 const invoice:Wire={id:ids.invoice,object:"invoice",livemode:false,customer:ids.customer,currency:"usd",amount_due:due.amountCents,amount_paid:due.amountCents,amount_remaining:0,total:due.amountCents,status:"paid",metadata,customer_email:CANARY};
 const intent:Wire={id:ids.pi,object:"payment_intent",livemode:false,customer:ids.customer,currency:"usd",amount:due.amountCents,amount_received:due.amountCents,amount_capturable:0,status:"succeeded",latest_charge:ids.charge,last_payment_error:null,metadata,client_secret:CANARY};
 const charge:Wire={id:ids.charge,object:"charge",livemode:false,customer:ids.customer,payment_intent:ids.pi,currency:"usd",amount:due.amountCents,amount_captured:due.amountCents,amount_refunded:0,paid:true,captured:true,status:"succeeded",disputed:false,balance_transaction:ids.balance,created:time-2,metadata,billing_details:{email:CANARY}};
 const session:Wire={id:ids.session,object:"checkout.session",livemode:false,customer:ids.customer,invoice:ids.invoice,payment_intent:ids.pi,currency:"usd",mode:"payment",status:"complete",payment_status:"paid",metadata,client_reference_id:CANARY};
 const allocation:Wire={id:ids.allocation,object:"invoice_payment",invoice:ids.invoice,livemode:false,currency:"usd",amount_paid:due.amountCents,amount_requested:due.amountCents,status:"paid",payment:{type:"payment_intent",payment_intent:ids.pi},status_transitions:{paid_at:time-1}};
 const balance:Wire={id:ids.balance,object:"balance_transaction",source:ids.charge,currency:"usd",amount:due.amountCents,fee:100,net:due.amountCents-100};
 client.invoicePage={object:"list",url:"/v1/invoice_payments",has_more:false,data:[allocation]};client.piPage=structuredClone(client.invoicePage);
 for(const [kind,value] of [["invoice",invoice],["payment_intent",intent],["charge",charge],["checkout_session",session],["balance_transaction",balance]] as const)client.objects.set(`${kind}:${String(value.id)}`,value);
 const receipts:Receipt[]=[],native=new NativeStripeReceiptBindings(f.db,merchant,systemClock),endpoint={endpoint:"connected" as const,accountId:merchant.accountId,livemode:false as const,apiVersion:"2026-09-30.endive" as const},endpointSecret="whsec_SYNTHETIC_NATIVE_COMPOSITION_ONLY",inbox=new FishingReceiptInbox(store,{endpoint,endpointSecret,client,native});
 function reader(actor:Actor=f.owner){return new StripeReadbackNormalizer({client,clock:systemClock,resolveNativeBinding:(receipt,signal)=>native.resolve(actor,receipt,signal)});}
 async function receipt(eventType="invoice.paid",objectId=ids.invoice,object="invoice"){
  const eventId=`evt_${randomUUID().replaceAll("-","")}`,created=Math.floor(Date.now()/1000);
  const event:Wire={id:eventId,object:"event",type:eventType,account:merchant.accountId,livemode:false,api_version:merchant.apiVersion,created,data:{object:{id:objectId,object,private:CANARY}}};
  const body=Buffer.from(JSON.stringify(event)),signature=Stripe.webhooks.generateTestHeaderString({payload:body.toString(),secret:endpointSecret,timestamp:created});
  await inbox.acceptStripeTest(body,signature);
  const row=(await f.pool.query<{receipt:Receipt}>("SELECT receipt_json AS receipt FROM ls_fishing_payments.inbox WHERE provider_account_id=$1 AND livemode=false AND event_id=$2",[merchant.accountId,eventId])).rows[0];
  if(!row)throw Error("DURABLE_SYNTHETIC_RECEIPT_REQUIRED");client.objects.set(`event:${eventId}`,event);receipts.push(row.receipt);return row.receipt;
 }
 return {f,merchant,store,inbox,endpoint,endpointSecret,family,prepared,offer,line,state,due,ids,operation,customerBindingId,client,invoice,intent,charge,session,allocation,balance,time,receipts,native,reader,receipt};
}

type Fixture=Awaited<ReturnType<typeof fixture>>;
async function login(c:Fixture,actor:Actor){const auth=new IdentityAuthService(c.f.db,c.f.config,systemClock),pre=await auth.preauth(),result=await auth.login(actor.id+"@example.invalid","Ab12cd",pre.token,randomUUID());return new IdentitySessions(c.f.db,c.f.config,systemClock).actor(result.token);}
async function money(c:Fixture){const result:Record<string,string>={};for(const table of["purchases","settlements","commands","outbox"]){result[table]=digest((await c.f.pool.query("SELECT to_jsonb(t) AS row FROM ls_fishing_payments."+table+" t WHERE workspace_id=$1 ORDER BY to_jsonb(t)::text",[c.f.workspaceId])).rows);}result.inbox=digest((await c.f.pool.query("SELECT event_id,processed_at FROM ls_fishing_payments.inbox WHERE provider_account_id=$1 AND event_id=ANY($2::text[]) ORDER BY event_id",[c.merchant.accountId,c.receipts.map(x=>x.eventId)])).rows);return result;}
async function protectedEffects(c:Fixture){const result:Record<string,string>={};for(const table of["ls_fishing_stage.enrollments","ls_fishing_stage.seat_reservations","ls_education.account_grants","ls_calendar.appointments","ls_cases.cases","ls_payments.charges","ls_payments.credit_events","ls_fishing_payments.reminders","ls_identity.auth_mail_outbox"]){result[table]=digest((await c.f.pool.query("SELECT to_jsonb(t) AS row FROM "+table+" t WHERE workspace_id=$1 ORDER BY to_jsonb(t)::text",[c.f.workspaceId])).rows);}return result;}
async function count(c:Fixture){return Number((await c.f.pool.query("SELECT count(*) AS n FROM ls_fishing_payments.settlements WHERE workspace_id=$1",[c.f.workspaceId])).rows[0].n);}
test("SDK signature commits minimal intake, ordinary fresh operator settles once and fresh parent reads family-safe cash",async()=>{
 const c=await fixture(),before=await protectedEffects(c),r=await c.receipt(),pending=await money(c);
 const durable=(await c.f.pool.query("SELECT receipt_json FROM ls_fishing_payments.inbox WHERE provider_account_id=$1 AND event_id=$2",[c.merchant.accountId,r.eventId])).rows[0].receipt_json;
 expect(Object.keys(durable).sort()).toEqual(["eventId","eventType","objectId","providerAccountId","livemode","apiVersion","digest","createdAt"].sort());expect(JSON.stringify(durable)).not.toContain(CANARY);
 expect(c.client.calls).toHaveLength(0);expect(await count(c)).toBe(0);
 const actor=await login(c,c.f.owner);await expect(c.inbox.processStripeTest(actor,randomUUID(),r.eventId)).resolves.toEqual({state:"reconciled"});
 expect(await count(c)).toBe(1);const parent=await login(c,c.family.parent),view=await c.store.familyView(parent,c.prepared.purchaseId);
 expect(view).toMatchObject({paidCents:c.due.amountCents,refundedCents:0,state:"paid",enrollmentGranted:false});expect(view.dues[0]?.paidCents).toBe(c.due.amountCents);expect(JSON.stringify(view)).not.toContain(CANARY);expect(await money(c)).not.toEqual(pending);expect(await protectedEffects(c)).toEqual(before);expect(c.f.provider.calls).toBe(0);
 const foreign=await c.f.account("parent");await expect(c.store.familyView(foreign,c.prepared.purchaseId)).rejects.toThrow();
});
test("bad signature creates nothing and conflicting signed digest cannot replace durable event",async()=>{
 const c=await fixture(),r=await c.receipt(),event=c.client.objects.get("event:"+r.eventId)!,raw=Buffer.from(JSON.stringify({...event,data:{object:{id:c.ids.invoice,object:"invoice",changed:true}}})),stamp=Math.floor(Date.now()/1000),before=await money(c);
 await expect(c.inbox.acceptStripeTest(raw,"t="+stamp+",v1="+"0".repeat(64))).rejects.toThrow();expect(await money(c)).toEqual(before);
 const signed=Stripe.webhooks.generateTestHeaderString({payload:raw.toString(),secret:c.endpointSecret,timestamp:stamp});await expect(c.inbox.acceptStripeTest(raw,signed)).rejects.toThrow("EVENT_IDENTITY_CONFLICT");expect(await money(c)).toEqual(before);
});
test("Invoice PI Checkout delivery identities and lost-response command replay share one canonical cash effect",async()=>{
 const c=await fixture(),actor=await login(c,c.f.owner),command=randomUUID(),r=await c.receipt();
 const event=c.client.objects.get("event:"+r.eventId)!,raw=Buffer.from(JSON.stringify(event)),signature=Stripe.webhooks.generateTestHeaderString({payload:raw.toString(),secret:c.endpointSecret,timestamp:Math.floor(Date.now()/1000)});
 await c.inbox.acceptStripeTest(raw,signature);await c.inbox.processStripeTest(actor,command,r.eventId);const first=await money(c);await c.inbox.processStripeTest(actor,command,r.eventId);expect(await money(c)).toEqual(first);
 for(const[type,objectId,object]of[["payment_intent.succeeded",c.ids.pi,"payment_intent"],["checkout.session.completed",c.ids.session,"checkout.session"]]){const next=await c.receipt(type,objectId,object);await c.inbox.processStripeTest(actor,randomUUID(),next.eventId);}
 expect(await count(c)).toBe(1);expect((await c.store.readPayment(actor,c.prepared.purchaseId))?.paidCents).toBe(c.due.amountCents);
});
test.each(["session","role","customer","object","purchase","operation"] as const)("commit rechecks %s changed during actual SDK transport and preserves pending receipt",async kind=>{
 const c=await fixture(),r=await c.receipt(),actor=await login(c,c.f.owner),command=randomUUID();let afterMutation:Awaited<ReturnType<typeof money>>|undefined;
 c.client.beforeTransport=async()=>{
  if(kind==="session")await c.f.pool.query("UPDATE ls_identity.sessions SET revoked_at=clock_timestamp() WHERE workspace_id=$1 AND token_digest=$2",[c.f.workspaceId,actor.sessionDigest]);
  if(kind==="role")await c.f.pool.query("UPDATE ls_identity.accounts SET role='parent' WHERE workspace_id=$1 AND id=$2",[c.f.workspaceId,actor.id]);
  if(kind==="customer"||kind==="object")await c.f.pool.query("UPDATE ls_fishing_payments."+(kind==="customer"?"customer_bindings":"object_bindings")+" SET revision=revision+1,revoked_at=clock_timestamp() WHERE workspace_id=$1",[c.f.workspaceId]);
  if(kind==="purchase")await c.f.pool.query("UPDATE ls_fishing_payments.purchases SET revision=revision+1,state_json=jsonb_set(state_json,'{revision}',to_jsonb(revision+1)) WHERE workspace_id=$1 AND id=$2",[c.f.workspaceId,c.prepared.purchaseId]);
  if(kind==="operation"){const changed={...c.operation,requestDigest:digest("changed-confirmed-operation")};await c.f.pool.query("UPDATE ls_fishing_payments.operations SET request_digest=$3,operation_json=$4::jsonb WHERE workspace_id=$1 AND id=$2",[c.f.workspaceId,c.operation.id,changed.requestDigest,JSON.stringify(changed)]);}
  afterMutation=await money(c);
 };
 await expect(c.inbox.processStripeTest(actor,command,r.eventId)).rejects.toThrow();expect(afterMutation).toBeDefined();expect(await money(c)).toEqual(afterMutation);expect(await count(c)).toBe(0);
 if(kind==="purchase"){await c.inbox.processStripeTest(actor,command,r.eventId);expect(await count(c)).toBe(1);}
});
test("cached command replay still denies current session revocation",async()=>{const c=await fixture(),r=await c.receipt(),actor=await login(c,c.f.owner),command=randomUUID();await c.inbox.processStripeTest(actor,command,r.eventId);await c.f.pool.query("UPDATE ls_identity.sessions SET revoked_at=clock_timestamp() WHERE workspace_id=$1 AND token_digest=$2",[c.f.workspaceId,actor.sessionDigest]);const before=await money(c);await expect(c.inbox.processStripeTest(actor,command,r.eventId)).rejects.toThrow();expect(await money(c)).toEqual(before);});
test("readback failure cannot allocate and partial capture records actual cash",async()=>{
 const c=await fixture(),r=await c.receipt(),before=await money(c);c.invoice.customer="cus_wrong";await expect(c.inbox.processStripeTest(c.f.owner,randomUUID(),r.eventId)).rejects.toThrow();expect(await money(c)).toEqual(before);
 c.invoice.customer=c.ids.customer;const paid=c.due.amountCents-1000;c.invoice.amount_paid=paid;c.invoice.amount_remaining=1000;c.invoice.status="open";c.intent.amount_received=paid;c.charge.amount_captured=paid;c.charge.amount=paid;c.allocation.amount_paid=paid;c.balance.amount=paid;c.balance.net=paid-100;c.client.invoicePage={object:"list",url:"/v1/invoice_payments",has_more:false,data:[c.allocation]};c.client.piPage=structuredClone(c.client.invoicePage);
 await c.inbox.processStripeTest(c.f.owner,randomUUID(),r.eventId);expect((await c.store.readPayment(c.f.owner,c.prepared.purchaseId))?.paidCents).toBe(paid);expect((await c.store.familyView(c.family.parent,c.prepared.purchaseId)).state).not.toBe("paid");
});
test("late failure event reads current paid objects and cannot regress cash",async()=>{const c=await fixture(),r=await c.receipt();await c.inbox.processStripeTest(c.f.owner,randomUUID(),r.eventId);const late=await c.receipt("invoice.payment_failed");await c.inbox.processStripeTest(c.f.owner,randomUUID(),late.eventId);expect(await count(c)).toBe(1);expect((await c.store.readPayment(c.f.owner,c.prepared.purchaseId))?.paidCents).toBe(c.due.amountCents);});
test("atomic ledger failure rolls back settlement purchase outbox processed marker and command; same attempt can retry",async()=>{
 const c=await fixture(),r=await c.receipt(),before=await money(c),command=randomUUID();let fail=true;
 const database:IdentityStore={transaction:work=>c.f.db.transaction(tx=>{const wrapped:SqlSession={query:async<T extends object>(s:string,v?:readonly unknown[])=>{if(fail&&s.startsWith('UPDATE ls_fishing_payments.inbox SET processed_at'))throw Error("SYNTHETIC_COMMIT_FAILURE");return tx.query<T>(s,v);}};return work(wrapped);})};
 const store=new FishingPaymentStore({...c.store.deps,database}),inbox=new FishingReceiptInbox(store,{endpoint:c.endpoint,endpointSecret:c.endpointSecret,client:c.client,native:c.native});
 await expect(inbox.processStripeTest(c.f.owner,command,r.eventId)).rejects.toThrow("SYNTHETIC_COMMIT_FAILURE");expect(await money(c)).toEqual(before);fail=false;await inbox.processStripeTest(c.f.owner,command,r.eventId);expect(await count(c)).toBe(1);
});
test("provider read phase holds no native workspace lock",async()=>{const c=await fixture(),r=await c.receipt();let acquired=false;c.client.beforeTransport=async()=>{await c.f.db.transaction(async tx=>{await tx.query("SET LOCAL lock_timeout='500ms'");await tx.query("SELECT id FROM ls_identity.workspaces WHERE id=$1 FOR UPDATE",[c.f.workspaceId]);acquired=true;});};await c.inbox.processStripeTest(c.f.owner,randomUUID(),r.eventId);expect(acquired).toBe(true);expect(await count(c)).toBe(1);});
test("durable intake never acknowledges a transaction that rolls back",async()=>{
 const c=await fixture(),event={id:"evt_"+randomUUID().replaceAll("-",""),object:"event",type:"invoice.paid",account:c.merchant.accountId,livemode:false,api_version:c.merchant.apiVersion,created:Math.floor(Date.now()/1000),data:{object:{id:c.ids.invoice,object:"invoice"}}},raw=Buffer.from(JSON.stringify(event)),signature=Stripe.webhooks.generateTestHeaderString({payload:raw.toString(),secret:c.endpointSecret,timestamp:event.created});
 const database:IdentityStore={transaction:work=>c.f.db.transaction(async tx=>{await work(tx);throw Error("SYNTHETIC_INTAKE_COMMIT_FAILURE");})};
 const store=new FishingPaymentStore({...c.store.deps,database}),inbox=new FishingReceiptInbox(store,{endpoint:c.endpoint,endpointSecret:c.endpointSecret,client:c.client,native:c.native});
 await expect(inbox.acceptStripeTest(raw,signature)).rejects.toThrow("SYNTHETIC_INTAKE_COMMIT_FAILURE");expect((await c.f.pool.query("SELECT event_id FROM ls_fishing_payments.inbox WHERE provider_account_id=$1 AND event_id=$2",[c.merchant.accountId,event.id])).rows).toHaveLength(0);expect(await count(c)).toBe(0);await c.inbox.acceptStripeTest(raw,signature);
});
test("parallel independent receipt attempts cannot allocate the same payment twice",async()=>{
 const c=await fixture(),a=await c.receipt(),b=await c.receipt("payment_intent.succeeded",c.ids.pi,"payment_intent"),actor=await login(c,c.f.owner);
 const commands=[randomUUID(),randomUUID()],results=await Promise.allSettled([c.inbox.processStripeTest(actor,commands[0]!,a.eventId),c.inbox.processStripeTest(actor,commands[1]!,b.eventId)]);expect(results.some(x=>x.status==="fulfilled")).toBe(true);
 // A stale snapshot is allowed to fail; only a new bounded read may retry it.
 for(const[i,r]of[a,b].entries())if(results[i]?.status==="rejected")await c.inbox.processStripeTest(actor,commands[i]!,r.eventId);
 expect(await count(c)).toBe(1);expect((await c.store.readPayment(actor,c.prepared.purchaseId))?.paidCents).toBe(c.due.amountCents);
});
test("SDK refund readback requires an existing native refund operation and original canonical payment",async()=>{
 const c=await fixture(),paid=await c.receipt();await c.inbox.processStripeTest(c.f.owner,randomUUID(),paid.eventId);
 const refundId="re_"+randomUUID().replaceAll("-",""),balanceId="txn_"+randomUUID().replaceAll("-",""),operationId=randomUUID(),amount=1000,operation:ProviderOperation={...c.operation,id:operationId,kind:"refund",amountCents:amount,refundPaymentId:c.ids.pi,idempotencyKey:"synthetic-refund:"+operationId,requestDigest:digest({syntheticRefund:operationId}),result:{kind:"refund",providerObjectId:refundId,providerAccountId:c.merchant.accountId,livemode:false,currency:"USD",amountCents:amount,purchaseId:c.prepared.purchaseId,idempotencyKey:"synthetic-refund:"+operationId,status:"succeeded"}};
 await c.f.pool.query("INSERT INTO ls_fishing_payments.operations(workspace_id,id,purchase_id,kind,due_id,request_digest,operation_json) VALUES($1,$2,$3,'refund',$4,$5,$6::jsonb)",[c.f.workspaceId,operationId,c.prepared.purchaseId,c.due.id,operation.requestDigest,JSON.stringify(operation)]);
 await c.f.pool.query("INSERT INTO ls_fishing_payments.object_bindings(workspace_id,id,revision,provider_account_id,livemode,customer_binding_id,purchase_id,hosted_operation_id,operation_id,invoice_id,object_kind,object_id,provenance_reference,verified_at) VALUES($1,$2,1,$3,false,$4,$5,$6,$7,$8,'refund',$9,'SYNTHETIC_SDK_REFUND_NOT_PROVIDER_PROOF',$10)",[c.f.workspaceId,randomUUID(),c.merchant.accountId,c.customerBindingId,c.prepared.purchaseId,c.operation.id,operationId,c.ids.invoice,refundId,new Date(Date.now()-60000)]);
 c.charge.amount_refunded=amount;c.client.objects.set("refund:"+refundId,{id:refundId,object:"refund",charge:c.ids.charge,payment_intent:c.ids.pi,amount,currency:"usd",created:Math.floor(Date.now()/1000)-1,status:"succeeded",balance_transaction:balanceId,metadata:{rm_operation_id:operationId,rm_purchase_id:c.prepared.purchaseId,rm_due_id:c.due.id}});c.client.objects.set("balance_transaction:"+balanceId,{id:balanceId,object:"balance_transaction",source:refundId,currency:"usd",amount:-amount,fee:0,net:-amount});
 const r=await c.receipt("refund.updated",refundId,"refund");await c.inbox.processStripeTest(c.f.owner,randomUUID(),r.eventId);const view=await c.store.familyView(await login(c,c.family.parent),c.prepared.purchaseId);expect(view.paidCents).toBe(c.due.amountCents);expect(view.refundedCents).toBe(amount);expect(await count(c)).toBe(2);await c.inbox.processStripeTest(c.f.owner,randomUUID(),r.eventId);expect(await count(c)).toBe(2);
});
test("committing transaction retains the native customer row lock through processed marker",async()=>{
 const c=await fixture(),r=await c.receipt();let blocked=false;
 const database:IdentityStore={transaction:work=>c.f.db.transaction(tx=>{const wrapped:SqlSession={query:async<T extends object>(s:string,v?:readonly unknown[])=>{const result=await tx.query<T>(s,v);if(s.startsWith('UPDATE ls_fishing_payments.inbox SET processed_at')){
  const concurrent=await c.f.pool.connect();try{await concurrent.query("BEGIN");await concurrent.query("SET LOCAL lock_timeout='100ms'");await expect(concurrent.query("UPDATE ls_fishing_payments.customer_bindings SET revision=revision+1,revoked_at=clock_timestamp() WHERE workspace_id=$1 AND id=$2",[c.f.workspaceId,c.customerBindingId])).rejects.toMatchObject({code:"55P03"});blocked=true;}finally{await concurrent.query("ROLLBACK");concurrent.release();}
 }return result;}};return work(wrapped);})};
 const store=new FishingPaymentStore({...c.store.deps,database}),inbox=new FishingReceiptInbox(store,{endpoint:c.endpoint,endpointSecret:c.endpointSecret,client:c.client,native:c.native});await inbox.processStripeTest(c.f.owner,randomUUID(),r.eventId);expect(blocked).toBe(true);expect(await count(c)).toBe(1);
});
