import {createHash,randomBytes,randomUUID} from "node:crypto";
import pg from "pg";
import {afterEach,expect,test,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {asId} from "../../../src/lib/ids.ts";
import {seal} from "../../../src/features/identity/crypto.ts";
import type {Actor,AccountRole} from "../../../src/features/identity/types.ts";
import {NativeStripeReceiptBindings} from "../../../src/features/fishing/native-stripe-bindings.ts";
import {approvedOffer,digest,initialPayment,settled,type SettlementFact} from "../../../src/features/fishing-payments/domain.ts";
import type {ProviderOperation,Receipt} from "../../../src/features/fishing-payments/ports.ts";
import {offerFixture,merchant} from "../../unit/fishing-payments/fixture.ts";
import {poolStore,safeTestUrl} from "../calendar/fixture.ts";

const pools:pg.Pool[]=[];
afterEach(async()=>{await Promise.all(pools.splice(0).map(pool=>pool.end()));});
async function fixture(options:{wrongPayer?:boolean;wrongMerchantBinding?:boolean}={}){
 const raw=safeTestUrl(),url=new URL(raw);
 if(process.env.LS_RM_STRIPE_BINDING_NATIVE_ALLOW!=="MAIN_REGISTERED_ONLY"||url.hostname!=="127.0.0.1"||!/^\/ls_calendar_test_rm_guard_[a-f0-9]{32}_test$/.test(url.pathname)||!url.port||!url.username||!url.password||url.search||url.hash)throw Error("MAIN_REGISTERED_STRIPE_MAPPING_TARGET_REQUIRED");
 const pool=new pg.Pool({connectionString:raw,ssl:false,max:4});pools.push(pool);
 const target=(await pool.query("SELECT current_database() AS database,host(inet_server_addr()) AS host,inet_server_port() AS port,to_regclass('ls_fishing_payments.customer_bindings') AS customers,to_regclass('ls_fishing_payments.object_bindings') AS objects")).rows[0];
 if(target.database!==url.pathname.slice(1)||target.host!=="127.0.0.1"||target.port!==Number(url.port)||!target.customers||!target.objects)throw Error("PINNED_MAPPING_SCHEMA_AND_TARGET_REQUIRED");
 const workspaceId=asId(randomUUID(),"workspace"),ago=new Date(Date.now()-3600000),db=poolStore(pool),ring={activeKeyId:"synthetic",keys:{synthetic:randomBytes(32)}},tag=randomUUID().replaceAll("-","");
 await pool.query("INSERT INTO ls_identity.workspaces(id,created_at) VALUES($1,$2)",[workspaceId,ago]);
 // This mapping fixture uses explicit synthetic sessions, NOT ordinary-login or
 // merchant/provider proof. The separate HTTP-native test exercises real login.
 async function actor(role:AccountRole):Promise<Actor>{
  const id=asId(randomUUID(),"account"),personId=asId(randomUUID(),"person"),sessionDigest=createHash("sha256").update(randomBytes(32)).digest("hex"),expiresAt=Date.now()+3600000;
  await pool.query("INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,'adult',$3,$4)",[personId,workspaceId,seal('{"displayName":"Synthetic mapping account"}',`person:${workspaceId}:${personId}`,ring),ago]);
  await pool.query("INSERT INTO ls_identity.accounts(id,workspace_id,role,state,locale,email_blind,email_ciphertext,email_verified_at,password_hash,created_at,updated_at) VALUES($1,$2,$3,'active','en',$4,$5,$6,'synthetic-not-password-login',$6,$6)",[id,workspaceId,role,digest(id),seal(`${id}@example.invalid`,`email:${workspaceId}:${id}`,ring),ago]);
  await pool.query("INSERT INTO ls_identity.account_subjects(workspace_id,account_id,person_id) VALUES($1,$2,$3)",[workspaceId,id,personId]);
  await pool.query("INSERT INTO ls_identity.sessions(token_digest,workspace_id,account_id,created_at,expires_at) VALUES($1,$2,$3,$4,$5)",[sessionDigest,workspaceId,id,ago,new Date(expiresAt)]);
  return {id,workspaceId,personId,role,state:"active",locale:"en",sessionDigest,expiresAt};
 }
 const owner=await actor("practitioner"),payer=await actor("parent"),outsider=await actor("parent"),base=offerFixture("prepay");
 const offer=approvedOffer({...base,workspaceId,operatorAccountId:owner.id,payerAccountId:payer.id,terms:{...base.terms,acceptedBy:payer.id}}),line=offer.lines[0]!,due=line.dues[0]!,purchaseId=randomUUID(),operationId=randomUUID(),customerBindingId=randomUUID(),customerId="cus_"+tag,invoiceId="in_"+tag,piId="pi_"+tag,sessionId="cs_"+tag;
 let state=initialPayment(offer,line,purchaseId,merchant);
 const operation:ProviderOperation={id:operationId,kind:"hosted_invoice",workspaceId,purchaseId,dueId:due.id,refundPaymentId:null,providerAccountId:merchant.accountId,livemode:false,amountCents:due.amountCents,currency:"USD",idempotencyKey:"synthetic-"+tag,state:"confirmed",requestDigest:digest({operationId}),result:{kind:"hosted_invoice",providerObjectId:invoiceId,url:"https://invoice.stripe.com/i/synthetic",providerAccountId:merchant.accountId,livemode:false,currency:"USD",amountCents:due.amountCents,purchaseId,dueId:due.id,idempotencyKey:"synthetic-"+tag}};
 await pool.query("INSERT INTO ls_fishing_payments.offers(workspace_id,id,revision,digest,offer_json,state) VALUES($1,$2,$3,$4,$5::jsonb,'approved')",[workspaceId,offer.id,offer.revision,digest(offer),JSON.stringify(offer)]);
 await pool.query("INSERT INTO ls_fishing_payments.purchases(workspace_id,id,offer_id,line_id,revision,state_json) VALUES($1,$2,$3,$4,1,$5::jsonb)",[workspaceId,purchaseId,offer.id,line.id,JSON.stringify(state)]);
 async function putOperation(value:ProviderOperation){await pool.query("INSERT INTO ls_fishing_payments.operations(workspace_id,id,purchase_id,kind,due_id,request_digest,operation_json) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)",[workspaceId,value.id,purchaseId,value.kind,value.dueId,value.requestDigest,JSON.stringify(value)]);}
 await putOperation(operation);
 await pool.query("INSERT INTO ls_fishing_payments.customer_bindings(workspace_id,id,revision,payer_account_id,provider_account_id,livemode,customer_id,merchant_binding_id,api_version,provenance_reference,verified_at) VALUES($1,$2,1,$3,$4,false,$5,$6,$7,'synthetic-not-real-provider-proof',$8)",[workspaceId,customerBindingId,options.wrongPayer?outsider.id:payer.id,merchant.accountId,customerId,options.wrongMerchantBinding?"wrong-synthetic-binding":merchant.verifiedBindingId,merchant.apiVersion,ago]);
 async function object(kind:string,id:string,effectOperation=operationId){await pool.query("INSERT INTO ls_fishing_payments.object_bindings(workspace_id,id,revision,provider_account_id,livemode,customer_binding_id,purchase_id,hosted_operation_id,operation_id,invoice_id,object_kind,object_id,provenance_reference,verified_at) VALUES($1,$2,1,$3,false,$4,$5,$6,$7,$8,$9,$10,'synthetic-not-real-provider-proof',$11)",[workspaceId,randomUUID(),merchant.accountId,customerBindingId,purchaseId,operationId,effectOperation,invoiceId,kind,id,ago]);}
 await object("invoice",invoiceId);await object("payment_intent",piId);await object("checkout_session",sessionId);
 async function receipt(eventType="invoice.paid",objectId=invoiceId):Promise<Receipt>{
  const eventId="evt_"+randomUUID().replaceAll("-","");const value:Receipt={eventId,eventType,objectId,providerAccountId:merchant.accountId,livemode:false,apiVersion:merchant.apiVersion,digest:digest({eventId,eventType,objectId}),createdAt:ago.toISOString()};
  await pool.query("INSERT INTO ls_fishing_payments.inbox(provider_account_id,livemode,event_id,digest,receipt_json,received_at) VALUES($1,false,$2,$3,$4::jsonb,$5)",[merchant.accountId,eventId,value.digest,JSON.stringify(value),ago]);return value;
 }
 async function refund(){
  const fact:SettlementFact={canonicalTransactionId:piId,providerReceiptId:"evt_synthetic_payment",relatedProviderObjectId:invoiceId,operationId,purchaseId,purchaseLineId:line.id,dueId:due.id,providerAccountId:merchant.accountId,livemode:false,currency:"USD",kind:"payment",cents:due.amountCents,feeCents:100,originalPaymentId:null,occurredAt:ago.toISOString()};
  const hash=digest({transaction:piId,purchase:purchaseId,line:line.id,due:due.id,merchant:merchant.accountId,mode:false,kind:"payment",currency:"USD",cents:fact.cents,originalPayment:null});
  await pool.query("INSERT INTO ls_fishing_payments.settlements(provider_account_id,livemode,kind,transaction_id,workspace_id,purchase_id,digest,fact_json) VALUES($1,false,'payment',$2,$3,$4,$5,$6::jsonb)",[merchant.accountId,piId,workspaceId,purchaseId,hash,JSON.stringify(fact)]);
  state=settled(state,[fact],new Date().toISOString());await pool.query("UPDATE ls_fishing_payments.purchases SET revision=$3,state_json=$4::jsonb WHERE workspace_id=$1 AND id=$2",[workspaceId,purchaseId,state.revision,JSON.stringify(state)]);
  const id=randomUUID(),providerObjectId="re_"+tag,value:ProviderOperation={...operation,id,kind:"refund",refundPaymentId:piId,amountCents:10000,idempotencyKey:"synthetic-refund-"+tag,requestDigest:digest({id}),result:{kind:"refund",providerObjectId,providerAccountId:merchant.accountId,livemode:false,currency:"USD",amountCents:10000,purchaseId,idempotencyKey:"synthetic-refund-"+tag,status:"pending"}};
  await putOperation(value);await object("refund",providerObjectId,id);return {operation:value,receipt:await receipt("refund.created",providerObjectId)};
 }
 const resolver=new NativeStripeReceiptBindings(db,merchant),resolve=(value:Receipt,who=owner)=>resolver.resolve(who,value,new AbortController().signal);
 return {pool,workspaceId,owner,payer,outsider,offer,line,due,purchaseId,operation,customerBindingId,customerId,invoiceId,piId,sessionId,receipt,refund,resolver,resolve};
}

test("native exact invoice/PI/Checkout mappings resolve the same immutable payer/purchase/confirmed operation without money or new effects",async()=>{
 const f=await fixture();const before=(await f.pool.query("SELECT state_json AS state FROM ls_fishing_payments.purchases WHERE workspace_id=$1 AND id=$2",[f.workspaceId,f.purchaseId])).rows[0];
 for(const [event,id] of [["invoice.paid",f.invoiceId],["payment_intent.succeeded",f.piId],["checkout.session.completed",f.sessionId]]){
  const result=await f.resolve(await f.receipt(event,id));expect(result?.kind).toBe("payment");expect(result?.invoice).toMatchObject({payerAccountId:f.payer.id,customerBindingId:f.customerBindingId,customerId:f.customerId,invoiceId:f.invoiceId,purchaseLineId:f.line.id,paymentIntentId:f.piId,checkoutSessionId:f.sessionId,hostedOperation:f.operation});
 }
 expect((await f.pool.query("SELECT state_json AS state FROM ls_fishing_payments.purchases WHERE workspace_id=$1 AND id=$2",[f.workspaceId,f.purchaseId])).rows[0]).toEqual(before);
 expect((await f.pool.query("SELECT count(*)::integer AS n FROM ls_fishing_payments.settlements WHERE workspace_id=$1",[f.workspaceId])).rows[0].n).toBe(0);
});
test.each(["wrongPayer","wrongMerchantBinding"] as const)("native %s is not provider metadata authority",async key=>{
 const f=await fixture({[key]:true});await expect(f.resolve(await f.receipt())).rejects.toMatchObject({code:"UNAVAILABLE"});
});
test("receipt identity/digest/account/mode/API must match the durable inbox and expected server merchant",async()=>{
 const f=await fixture(),r=await f.receipt();
 for(const changed of [{digest:"a".repeat(64)},{objectId:"in_wrong"},{providerAccountId:"acct_wrong"},{livemode:true},{apiVersion:"wrong"}])await expect(f.resolve({...r,...changed})).rejects.toMatchObject({code:"UNAVAILABLE"});
 expect(await f.resolve({...r,eventId:"evt_missing"})).toBeNull();
});
test("only the actual native active verified operator can resolve a mapping",async()=>{
 const f=await fixture(),r=await f.receipt();await expect(f.resolve(r,{...f.payer,role:"practitioner"})).rejects.toMatchObject({code:"FORBIDDEN"});
 const otherWorkspace=asId(randomUUID(),"workspace");await f.pool.query("INSERT INTO ls_identity.workspaces(id,created_at) VALUES($1,clock_timestamp())",[otherWorkspace]);
 await expect(f.resolve(r,{...f.owner,workspaceId:otherWorkspace})).rejects.toMatchObject({code:"UNAUTHENTICATED"});
 await f.pool.query("UPDATE ls_identity.sessions SET revoked_at=clock_timestamp() WHERE workspace_id=$1 AND account_id=$2",[f.workspaceId,f.owner.id]);await expect(f.resolve(r)).rejects.toMatchObject({code:"UNAUTHENTICATED"});
});
test.each(["customer_bindings","object_bindings"] as const)("revoked %s stays unresolved and cannot be reactivated/reparented/deleted",async table=>{
 const f=await fixture(),r=await f.receipt();const sql=table==="customer_bindings"?"UPDATE ls_fishing_payments.customer_bindings SET revision=revision+1,revoked_at=clock_timestamp() WHERE workspace_id=$1":"UPDATE ls_fishing_payments.object_bindings SET revision=revision+1,revoked_at=clock_timestamp() WHERE workspace_id=$1";
 await f.pool.query(sql,[f.workspaceId]);await expect(f.resolve(r)).rejects.toMatchObject({code:"UNAVAILABLE"});
 const reactivate=table==="customer_bindings"?"UPDATE ls_fishing_payments.customer_bindings SET revision=revision+1,revoked_at=NULL WHERE workspace_id=$1":"UPDATE ls_fishing_payments.object_bindings SET revision=revision+1,revoked_at=NULL WHERE workspace_id=$1";
 await expect(f.pool.query(reactivate,[f.workspaceId])).rejects.toThrow("IMMUTABLE_STRIPE_BINDING");
 const remove=table==="customer_bindings"?"DELETE FROM ls_fishing_payments.customer_bindings WHERE workspace_id=$1":"DELETE FROM ls_fishing_payments.object_bindings WHERE workspace_id=$1";
 await expect(f.pool.query(remove,[f.workspaceId])).rejects.toThrow("IMMUTABLE_STRIPE_BINDING");
});
test("unknown operation/due corruption cannot be resolved by matching amount",async()=>{
 const f=await fixture(),r=await f.receipt();await f.pool.query("UPDATE ls_fishing_payments.operations SET operation_json=$3::jsonb WHERE workspace_id=$1 AND id=$2",[f.workspaceId,f.operation.id,JSON.stringify({...f.operation,state:"unknown"})]);await expect(f.resolve(r)).rejects.toMatchObject({code:"UNAVAILABLE"});
 await f.pool.query("UPDATE ls_fishing_payments.operations SET operation_json=$3::jsonb,due_id='wrong_due' WHERE workspace_id=$1 AND id=$2",[f.workspaceId,f.operation.id,JSON.stringify(f.operation)]);await expect(f.resolve(r)).rejects.toMatchObject({code:"UNAVAILABLE"});
});
test("a refund needs exact native original payment settlement and refund operation, not a refund status/amount",async()=>{
 const f=await fixture(),refund=await f.refund(),result=await f.resolve(refund.receipt);expect(result?.kind).toBe("refund");if(result?.kind!=="refund")throw Error("EXPECTED_SYNTHETIC_REFUND_MAPPING");
 expect(result.originalPaymentIntentId).toBe(f.piId);expect(result.refundOperation).toEqual(refund.operation);
 await f.pool.query("UPDATE ls_fishing_payments.settlements SET digest=$3 WHERE workspace_id=$1 AND purchase_id=$2",[f.workspaceId,f.purchaseId,"a".repeat(64)]);await expect(f.resolve(refund.receipt)).rejects.toMatchObject({code:"UNAVAILABLE"});
});
test("unmapped/unsupported aggregate events remain unresolved; inherited property names are not supported events",async()=>{
 const f=await fixture();expect(await f.resolve(await f.receipt("invoice.paid","in_unmapped"))).toBeNull();expect(await f.resolve(await f.receipt("charge.refunded","ch_aggregate"))).toBeNull();expect(await f.resolve(await f.receipt("constructor",f.invoiceId))).toBeNull();
 const abort=new AbortController();abort.abort();await expect(f.resolver.resolve(f.owner,await f.receipt(),abort.signal)).rejects.toMatchObject({code:"UNAVAILABLE"});
});
test("SQL rejects live mode, duplicate native customer identity and reparenting even before resolver execution",async()=>{
 const f=await fixture();await expect(f.pool.query("UPDATE ls_fishing_payments.customer_bindings SET payer_account_id=$2 WHERE workspace_id=$1",[f.workspaceId,f.outsider.id])).rejects.toThrow("IMMUTABLE_STRIPE_BINDING");
 await expect(f.pool.query("INSERT INTO ls_fishing_payments.customer_bindings SELECT workspace_id,$2,revision,payer_account_id,provider_account_id,livemode,customer_id,merchant_binding_id,api_version,provenance_reference,verified_at,revoked_at FROM ls_fishing_payments.customer_bindings WHERE workspace_id=$1",[f.workspaceId,randomUUID()])).rejects.toMatchObject({code:"23505"});
 await expect(f.pool.query("INSERT INTO ls_fishing_payments.customer_bindings SELECT workspace_id,$2,revision,payer_account_id,provider_account_id,true,'cus_different',merchant_binding_id,api_version,provenance_reference,verified_at,revoked_at FROM ls_fishing_payments.customer_bindings WHERE workspace_id=$1",[f.workspaceId,randomUUID()])).rejects.toMatchObject({code:"23514"});
});
