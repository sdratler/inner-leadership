import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {SqlReceiptStore} from '../../../src/features/onboarding/receipt-store.ts';
import {receiveVerifiedPayment,manualSchedulingEligibility,administrativePatch} from '../../../src/features/onboarding/parents-first.ts';
import {allocateVerifiedReceipt} from '../../../src/features/onboarding/staff-allocation.ts';
import {verifyAndNormalizeGreenInvoice} from '../../../src/features/payments/provider-adapter.ts';
import type {IdentityStore, SqlSession} from '../../../src/features/identity/store.ts';
import type {ProviderReceiptResult} from '../../../src/features/payments/provider-types.ts';

// Synthetic local PostgreSQL WASM only. No provider requests, production DB,
// parent communications, accounting documents, or actual appointments.
const {PGlite}=await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const workspace=randomUUID(), otherWorkspace=randomUUID(), practitioner=randomUUID();
const account='synthetic-business';
const receivedAt='2026-09-15T19:00:00.000Z';
type PaymentTransaction={transactionId:string;status:'pending'|'succeeded'|'failed'|'refunded';amountMinor:number;currency:string;orderId?:string};
type PaymentPayload={eventId:string;providerAccountId?:string;status:'pending'|'succeeded'|'failed'|'refunded';purpose?:'first_session'|undefined;orderId?:string;transactions:PaymentTransaction[]};
type QueryResult<T extends object=Record<string,unknown>>={rows:T[]};
type DbSession={query<T extends object=Record<string,unknown>>(sql:string,params?:readonly unknown[]):Promise<QueryResult<T>>;exec(sql:string):Promise<unknown>};
type TestDb={exec(sql:string):Promise<unknown>;query<T extends object=Record<string,unknown>>(sql:string,params?:readonly unknown[]):Promise<QueryResult<T>>;transaction<T>(work:(tx:DbSession)=>Promise<T>):Promise<T>;close():Promise<void>};
let db:TestDb,store:SqlReceiptStore,database:IdentityStore,dir:string;
let sequence=0;
const sessions:string[]=[];
function bind(){
  database={transaction:<T>(work:(tx:SqlSession)=>Promise<T>)=>db.transaction(async tx=>work({query:async<R extends object>(sql:string,params:readonly unknown[]=[]):Promise<R[]>=>{sessions.push(sql); return (await tx.query<R>(sql,params)).rows;}}))};
  store=new SqlReceiptStore(database,workspace,account);
}
before(async()=>{
  dir=mkdtempSync(join(process.env.PGLITE_TEST_ROOT || process.cwd(),'synthetic-pg-'));
  db=new PGlite(dir); await db.exec('CREATE SCHEMA ls_control');
  for(const name of ['0001_ls_foundation.sql','0010_ls_identity_cases_20260906.sql','0090_ls_parents_first.sql']){
    await db.exec(readFileSync(new URL('../../../migrations/'+name,import.meta.url),'utf8'));
  }
  await db.query('INSERT INTO ls_identity.workspaces(id) VALUES($1),($2)',[workspace,otherWorkspace]);
  await db.query("INSERT INTO ls_identity.accounts(id,workspace_id,role,state,locale,email_blind,email_ciphertext,created_at,updated_at) VALUES($1,$2,'practitioner','invited','he',$3,'SYNTHETIC',now(),now())",[practitioner,workspace,'a'.repeat(64)]);
  bind();
});
after(async()=>{await db?.close();});
async function order(){
  const childId=randomUUID(),caseId=randomUUID(),clientId=randomUUID(),orderId='SYNTH-ORDER-'+(++sequence);
  await db.query("INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,'minor','SYNTHETIC',now())",[childId,workspace]);
  await db.query('INSERT INTO ls_cases.clients(id,workspace_id,person_id,created_at) VALUES($1,$2,$3,now())',[clientId,workspace,childId]);
  await db.query("INSERT INTO ls_cases.cases(id,workspace_id,client_id,practitioner_account_id,state,created_at,updated_at) VALUES($1,$2,$3,$4,'intake',now(),now())",[caseId,workspace,clientId,practitioner]);
  await db.query("INSERT INTO ls_onboarding.first_session_orders(workspace_id,order_id,case_id,child_id,amount_minor,currency,purpose) VALUES($1,$2,$3,$4,55000,'ILS','first_session')",[workspace,orderId,caseId,childId]);
  return {orderId,childId,caseId};
}
function body(orderId?:string,changes:Partial<PaymentPayload>={}){
  const id='SYNTH-'+(++sequence);
  return {eventId:id,providerAccountId:account,status:'succeeded' as const,purpose:'first_session' as const,...(orderId!==undefined?{orderId}:{}),transactions:[{transactionId:id,status:'succeeded' as const,amountMinor:55000,currency:'ILS'}],...changes};
}
function receive(payload:PaymentPayload,alternateStore=store){
  const input={rawBody:JSON.stringify(payload),receivedAt,headers:{}};
  return receiveVerifiedPayment(input,{accountId:account,store:alternateStore,verifier:{verify:async()=>{
    const normalized=verifyAndNormalizeGreenInvoice(input,{accountId:account,verify:()=>true});
    return normalized.ok?{source:'authenticated_provider_query',accountId:account,normalized:normalized.event}:undefined;
  }}});
}
async function resultState(payload:PaymentPayload){const result=await receive(payload); assert.equal(result.status,200); return (result as {status:200;result:ProviderReceiptResult}).result.state;}
const consent={affirmative:true,approvedPolicyVersion:'SYNTH-APPROVED-V1',signerReference:'SYNTH-PARENT',recordedAt:receivedAt};
const policy={approvedConsentVersions:['SYNTH-APPROVED-V1']};
function eligibility(orderId:string,changes:Record<string,unknown>={},currentStore=store){return manualSchedulingEligibility({orderId,consent,method:'card',...changes},currentStore,policy);}

test('migration checksum is exact; private tables deny public access',async()=>{
  const manifest=JSON.parse(readFileSync(new URL('../../../migrations/manifest.json',import.meta.url),'utf8'));
  const bytes=readFileSync(new URL('../../../migrations/0090_ls_parents_first.sql',import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),manifest.find((x:{name:string;sha256:string})=>x.name==='0090_ls_parents_first.sql')!.sha256);
  await db.exec('CREATE ROLE synthetic_parent');
  assert.equal((await db.query<{allowed:boolean}>("SELECT has_schema_privilege('synthetic_parent','ls_onboarding','USAGE') AS allowed")).rows[0]!.allowed,false);
  await assert.rejects(()=>db.transaction(async(tx)=>{await tx.exec('SET LOCAL ROLE synthetic_parent');await tx.query('SELECT * FROM ls_onboarding.provider_receipts');}),/permission denied/);
});
test('successful verified receipt atomically creates one allocation and is eligible only with consent',async()=>{
  const o=await order();const b=body(o.orderId);
  assert.equal(await resultState(b),'paid');
  const e=await eligibility(o.orderId);assert.equal(e.eligible,true);assert.equal(e.paymentState,'paid');assert.equal(e.scheduling,'manual');
  assert.ok(sessions.some(s=>s.includes('FOR UPDATE')));
  assert.equal((await eligibility(o.orderId,{consent:undefined})).eligible,false);
});
test('duplicates/concurrent events and different event IDs cannot double allocate',async()=>{
  const o=await order(), b=body(o.orderId);
  const events=await Promise.all([receive(b),receive(b),receive({...b,eventId:b.eventId+'-2'})]);
  assert.equal(events.filter((x)=>x.status===200 && x.result.state==='paid').length,1);
  assert.equal((await db.query<{n:number}>('SELECT count(*)::int AS n FROM ls_onboarding.payment_allocations WHERE order_id=$1',[o.orderId])).rows[0]!.n,1);
  assert.equal(await resultState(body(o.orderId)),'unmatched');
  assert.equal((await receive({...b,purpose:undefined})).status,503); // same event ID, changed evidence
});
test('failure, pending and out-of-order refund never grant a payment',async()=>{
  const o=await order();
  for(const state of ['failed','pending'] as const) assert.equal(await resultState(body(o.orderId,{status:state})),state);
  assert.equal((await eligibility(o.orderId)).eligible,false);
  const b=body(o.orderId);
  assert.equal(await resultState({...b,eventId:b.eventId+'-refund',status:'refunded'}),'refunded');
  assert.equal(await resultState(b),'refunded');
  assert.equal((await eligibility(o.orderId)).eligible,false);
  const paidOrder=await order(),p=body(paidOrder.orderId);
  assert.equal(await resultState(p),'paid');
  assert.equal(await resultState({...p,eventId:p.eventId+'-refund',status:'refunded'}),'refunded');
  assert.equal((await eligibility(paidOrder.orderId)).paymentState,'refunded');
});
test('wrong amount/currency/account and mismatched sibling/order are held',async()=>{
  const o=await order(),sibling=await order();
  for(const changes of [{amountMinor:54999},{currency:'USD'},{status:'failed'}]){
    const b=body(o.orderId);b.transactions[0]={...b.transactions[0]!,...changes} as PaymentTransaction;assert.equal(await resultState(b),'unmatched');
  }
  assert.equal((await receive(body(o.orderId,{providerAccountId:'other-business'}))).status,401);
  const conflicting=body(o.orderId);conflicting.transactions[0]!.orderId=sibling.orderId;
  assert.equal(await resultState(conflicting),'unmatched');
  const paid=body(o.orderId);assert.equal(await resultState(paid),'paid');
  assert.equal(await resultState({...paid,eventId:paid.eventId+'-sibling',orderId:sibling.orderId}),'duplicate');
  assert.equal((await eligibility(sibling.orderId)).eligible,false);
});
test('generic link stays unmatched; explicit authorized staff allocation is audited and single-use',async()=>{
  const o=await order(),sibling=await order(),b=body();assert.equal(await resultState(b),'unmatched');
  const input={eventKey:account+':'+b.eventId,orderId:o.orderId,auditRecordId:'SYNTH-AUDIT-'+sequence};
  await assert.rejects(()=>allocateVerifiedReceipt(input,{store}),/staff_authorization/);
  const authorization={store,authorize:async()=>({actorId:practitioner})};
  assert.equal((await allocateVerifiedReceipt(input,authorization)).state,'paid');
  await assert.rejects(()=>allocateVerifiedReceipt({...input,orderId:sibling.orderId},authorization),/verified_unmatched|conflict/);
  assert.equal((await db.query<{n:number}>('SELECT count(*)::int AS n FROM ls_onboarding.staff_allocation_audits WHERE audit_record_id=$1',[input.auditRecordId])).rows[0]!.n,1);
  assert.equal((await eligibility(o.orderId)).eligible,true);assert.equal((await eligibility(sibling.orderId)).eligible,false);
});
test('provider absence/outage and persistence errors return retryable failure, then safe replay',async()=>{
  const o=await order(),b=body(o.orderId),input={rawBody:JSON.stringify(b),receivedAt,headers:{}};
  assert.equal((await receiveVerifiedPayment(input,{accountId:account,store})).status,503);
  assert.equal((await receiveVerifiedPayment(input,{accountId:account,store,verifier:{verify:async()=>{throw Error('outage');}}})).status,503);
  const save=store.save.bind(store);let calls=0;
  store.save=async(receipt)=>{if(++calls===2)throw Error('synthetic commit-path crash');await save(receipt);};
  assert.equal((await receive(b)).status,503);store.save=save;
  assert.equal((await db.query<{n:number}>('SELECT count(*)::int AS n FROM ls_onboarding.provider_receipts WHERE event_key=$1',[account+':'+b.eventId])).rows[0]!.n,0);
  assert.equal((await db.query<{n:number}>('SELECT count(*)::int AS n FROM ls_onboarding.payment_allocations WHERE order_id=$1',[o.orderId])).rows[0]!.n,0);
  assert.equal(await resultState(b),'paid');
  const another=await order(),c=body(another.orderId),allocate=store.saveAllocation.bind(store);
  store.saveAllocation=async()=>{throw Error('database unavailable');};assert.equal((await receive(c)).status,503);store.saveAllocation=allocate;
  assert.equal(await resultState(c),'paid');
});
test('receipt/order/allocation/refund/audit evidence is immutable and workspace scoped',async()=>{
  const o=await order(),b=body(o.orderId);await receive(b);
  await assert.rejects(()=>db.query("UPDATE ls_onboarding.provider_receipts SET raw_digest=$1 WHERE event_key=$2",['b'.repeat(64),account+':'+b.eventId]),/immutable_provider_evidence/);
  await assert.rejects(()=>db.query('DELETE FROM ls_onboarding.provider_receipts WHERE event_key=$1',[account+':'+b.eventId]),/immutable_provider_evidence/);
  await assert.rejects(()=>db.query('DELETE FROM ls_onboarding.payment_allocations WHERE order_id=$1',[o.orderId]),/append_only/);
  await assert.rejects(()=>db.query('UPDATE ls_onboarding.first_session_orders SET child_id=$1 WHERE order_id=$2',[randomUUID(),o.orderId]),/append_only/);
  const other=new SqlReceiptStore(database,otherWorkspace,account);
  assert.equal(await other.withReceiptLock('isolation',()=>other.findOrder(o.orderId)),undefined);
  await assert.rejects(()=>store.findOrder(o.orderId),/receipt_transaction_required/);
});
test('draft/false/unsigned consent is denied; bank unverified and approved cash DUE stay distinct',async()=>{
  const o=await order();
  for(const c of [undefined,{...consent,affirmative:false},{...consent,signerReference:''},{...consent,approvedPolicyVersion:'DRAFT'},{...consent,recordedAt:'invalid'}]) assert.equal((await eligibility(o.orderId,{consent:c})).eligible,false);
  assert.deepEqual(await eligibility(o.orderId,{method:'bank_transfer'}),{eligible:false,paymentState:'reported',scheduling:'manual',reason:'receipt_not_verified'});
  const cash=await eligibility(o.orderId,{method:'cash',cashApproval:{orderId:o.orderId,approvedBy:practitioner,auditRecordId:'SYNTH-CASH'}});
  assert.equal(cash.eligible,true);assert.equal(cash.paymentState,'due');
  const bank=await eligibility(o.orderId,{method:'bank_transfer',staffReceipt:{orderId:o.orderId,method:'bank_transfer',amountMinor:55000,currency:'ILS',approvedBy:practitioner,auditRecordId:'SYNTH-BANK',receivedAt}});
  assert.equal(bank.eligible,true);assert.equal(bank.paymentState,'paid');
});
test('CRM projections are stable-ID/field-owned and cannot overwrite notes or grant access',()=>{
  assert.deepEqual(administrativePatch('LS-LEAD-SYNTH-1',{'Payment status':'DUE','Booking status':'Manual'}),{leadId:'LS-LEAD-SYNTH-1',fields:{'Payment status':'DUE','Booking status':'Manual'}});
  assert.throws(()=>administrativePatch('parent@example.invalid',{}),/stable_lead/);
  for(const key of ['Notes','Consent text','Account access']) assert.throws(()=>administrativePatch('LS-LEAD-SYNTH-1',{[key]:'overwrite'}),/unowned/);
});
test('committed payment survives actual local DB close/reopen',async()=>{
  const o=await order(),b=body(o.orderId);assert.equal(await resultState(b),'paid');
  await db.close();db=new PGlite(dir);bind();
  assert.equal(await resultState(b),'duplicate');assert.equal((await eligibility(o.orderId)).eligible,true);
});
