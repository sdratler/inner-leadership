import {randomUUID,createHmac} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {beforeAll,afterAll,afterEach,it,expect,vi} from 'vitest';
import {requirePgliteMemoryEnvironment} from '../fixtures/pglite-memory-environment.ts';
import {initializeProgramSchema,programRing,programKey} from '../fixtures/fishing-native-program-v3.ts';
import {serviceGuestFixtureV4} from '../fixtures/fishing-service-guest-v4.ts';
import {FishingServiceGuestNativeV4} from '../../src/features/fishing-billing/guest-service-native-v4.ts';
import {FishingServiceCurrentCardV4} from '../../src/features/fishing-billing/guest-service-current-card-v4.ts';
import type {ServiceCardReconciliationAuthorityV4,ServiceCurrentCardLedgerV4} from '../../src/features/fishing-billing/guest-service-current-card-contract-v4.ts';
import {FishingServiceBillingOwnerV4} from '../../src/features/fishing-billing/guest-service-owner-financial-v4.ts';
import {FishingProgramSourceNativeV3} from '../../src/features/fishing-billing/program-source-native-v3.ts';
import {FishingBillingInquiryFamilyProposals} from '../../src/lib/fishing-billing-inquiry-family-proposal.ts';
import {BILLING_SERVICE_V4} from '../../src/features/fishing-billing/guest-service-contract-v4.ts';
import {SERVICE_STATE_ACTION_V4} from '../../src/features/fishing-billing/guest-service-owner-state-contract-v4.ts';
import {serviceGuestAadV4} from '../../src/features/fishing-billing/guest-service-aad-v4.ts';
import {BILLING_DTO_VERSION,ledgerReceiptSchema,reminderIntentSchema,type LedgerReceipt} from '../../src/features/fishing-billing/contracts.ts';
import {cardAttemptSchema,CARD_VERSION} from '../../src/features/fishing-billing/card-contracts.ts';
import {canonical} from '../../src/features/contact-ops/core/validation.ts';
import {seal,unseal} from '../../src/features/identity/crypto.ts';
import {AppError} from '../../src/lib/errors.ts';
import type {IdentityStore} from '../../src/features/identity/store.ts';
vi.mock('server-only',()=>({}));
let engine:PGlite;const network=vi.fn(async()=>{throw Error('NO_NETWORK');});
beforeAll(async()=>{requirePgliteMemoryEnvironment(process.env);vi.stubGlobal('fetch',network);engine=new PGlite();await initializeProgramSchema(engine);
 for(const name of ['UNNUMBERED_ls_fishing_fulfillment_v1.sql','UNNUMBERED_ls_fishing_service_material_v4.sql','UNNUMBERED_ls_fishing_quote_service_v4.sql','UNNUMBERED_ls_fishing_service_money_v4.sql','UNNUMBERED_ls_fishing_service_state_v4.sql'])await engine.exec(await readFile('migrations/proposals/'+name,'utf8'));
 await engine.exec('CREATE SCHEMA synthetic_card4; CREATE TABLE synthetic_card4.admission(workspace_id uuid PRIMARY KEY,quote_id uuid NOT NULL,family_id uuid NOT NULL,account_id text NOT NULL,active boolean NOT NULL DEFAULT true)');
},20000);
afterEach(()=>expect(network).not.toHaveBeenCalled());afterAll(async()=>{try{await engine?.close();}finally{vi.unstubAllGlobals();}});
// Actual native source/family/issuer/acceptance/history, encrypted rows, money
// calculator and transactional SQL. Grant is RAW SEEDED; legal/resources and
// service/provider facts are expressly SYNTHETIC/UNAPPROVED. No signed event,
// official provider readback, runtime, real payment or PostgreSQL race proof.
async function ready(accept=true){
 const f=await serviceGuestFixtureV4(engine);if(accept)await new FishingServiceGuestNativeV4(f.db,f.workspace,programRing,programKey,f.commandKey,f.clock,f.resolver()).acceptFinancialOffer(f.token,f.command);
 const binding={accountId:'acct_SYNTHETIC',livemode:false as const,apiVersion:'2026-09-30.endive' as const,verifiedBindingId:'SYNTHETIC-NO-PROVIDER'},ledgerKey=Buffer.from(programKey);
 await engine.query('INSERT INTO synthetic_card4.admission(workspace_id,quote_id,family_id,account_id) VALUES($1,$2,$3,$4)',[f.workspace,f.quote.id,f.quote.familyId,binding.accountId]);
 const controls={denyTarget:false,denyCurrent:false,mutateDate:false,privateBeforeTarget:0,targets:0,authorizations:0};
 const authority:ServiceCardReconciliationAuthorityV4={target:async(c,b)=>{
  expect(c).not.toHaveProperty('actor');controls.targets++;if(controls.denyTarget)throw new AppError('FORBIDDEN');
  const p=await c.tx.query<{active:boolean;account_id:string}>('SELECT active,account_id FROM synthetic_card4.admission WHERE workspace_id=$1 FOR SHARE',[c.workspaceId]);
  if(c.workspaceId!==f.workspace||p.length!==1||!p[0]!.active||b.accountId!==p[0]!.account_id||canonical(b)!==canonical(binding))throw new AppError('FORBIDDEN');
 },authorize:async(c,b,s)=>{
  controls.authorizations++;expect(s.action).toBe('reconcile');expect(s.childIds).toEqual(f.quote.lines.map(l=>l.childId));expect(s.offerSha256).toBe(f.quote.offer.sha256);expect(s.acceptanceId).toEqual(expect.any(String));
  if(controls.denyCurrent||s.quoteId!==f.quote.id||s.familyId!==f.quote.familyId||b.accountId!==binding.accountId)throw new AppError('FORBIDDEN');
  if(controls.mutateDate)c.now.setTime(c.now.valueOf()+1);
 }};
 const db:IdentityStore={transaction:work=>f.db.transaction(tx=>work({query:async<R extends object>(sql:string,v:readonly unknown[]=[])=>{if(controls.denyTarget&&sql.includes('FROM ls_fishing_billing'))controls.privateBeforeTarget++;return tx.query<R>(sql,v);}}))};
 const families=new FishingBillingInquiryFamilyProposals(f.db,f.workspace,programRing,programKey,f.clock);
 const port=(database=db,permission=authority)=>new FishingServiceCurrentCardV4(database,f.workspace,families,programRing,programKey,f.commandKey,ledgerKey,f.clock,permission);
 const owner=()=>new FishingServiceBillingOwnerV4(f.workspace,new FishingProgramSourceNativeV3(f.db,f.workspace,programRing,programKey,f.owner.id,f.clock),families,programRing,programKey,f.commandKey,ledgerKey,f.clock,{target:async()=>{},authorize:async()=>{}});
 return {...f,port,billingOwner:owner,binding,controls,authority,ledgerKey};
}
type Fixture=Awaited<ReturnType<typeof ready>>;
const run=<T>(f:Fixture,work:(l:ServiceCurrentCardLedgerV4)=>Promise<T>)=>f.port().withCurrentCardServiceV4(f.binding,f.quote.id,work);
const read=(f:Fixture)=>run(f,async l=>l.frame);
function payment(f:Fixture,amount=130000):LedgerReceipt{return ledgerReceiptSchema.parse({id:randomUUID(),operationId:randomUUID(),quoteId:f.quote.id,familyId:f.quote.familyId,kind:'card',currency:'USD',amountMinor:amount,
 allocations:f.quote.lines.map(l=>({lineId:l.id,amountMinor:amount/2})),originalReceiptId:null,actorId:null,reason:null,receivedAt:f.clock.now().toISOString(),recordedAt:f.clock.now().toISOString(),provider:{accountId:f.binding.accountId,mode:'test',transactionId:'pi_SYNTHETIC'+randomUUID().replaceAll('-','')}});}
async function raw(f:Fixture){const result:Record<string,unknown>={};for(const table of ['quotes','receipts','reminders','card_attempts','guest_financial_acceptances'])result[table]=(await engine.query('SELECT * FROM ls_fishing_billing.'+table+' WHERE workspace_id=$1 ORDER BY 2',[f.workspace])).rows;return result;}
async function reminder(f:Fixture,state:'queued'|'unknown'){
 const i=reminderIntentSchema.parse({version:BILLING_DTO_VERSION,id:randomUUID(),key:'SYNTHETIC-'+randomUUID(),quoteId:f.quote.id,familyId:f.quote.familyId,guardianId:randomUUID(),channel:'email',audience:'individual',locale:'he',policyId:'SYNTHETIC',policyRevision:1,sequence:0,
  dueAt:f.quote.lines[0]!.dueAt,scheduledAt:f.clock.now().toISOString(),state,dispatchId:state==='unknown'?randomUUID():null,providerId:null,reason:null});
 const hash=(v:unknown)=>createHmac('sha256',f.ledgerKey).update(canonical(v)).digest('hex');
 await engine.query('INSERT INTO ls_fishing_billing.reminders VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[f.workspace,i.id,f.quote.id,hash({key:i.key}),state,seal(JSON.stringify(i),'ls_fishing_billing/v1/reminder/'+f.workspace+'/'+i.id,programRing),'SYNTHETIC-NOT-A-POLICY',i.scheduledAt,hash({quoteId:f.quote.id,guardianId:i.guardianId})]);return i;
}
it('card-current-v4 reads real V4 acceptance and per-child balances actor-free without changing original rows',async()=>{
 const f=await ready(),before=await raw(f),s=await read(f);expect(s.version).toBe(BILLING_SERVICE_V4);expect(s.quote.revision).toBe(3);expect(s.balance.lines.map(l=>l.remainingMinor)).toEqual([65000,65000]);expect(s.balance.collection).toBe('test_only');expect(await raw(f)).toEqual(before);
});
it('card-current-v4 denies target/account admission before any private billing lookup',async()=>{
 const f=await ready(),work=vi.fn();f.controls.denyTarget=true;await expect(run(f,work)).rejects.toThrow('FORBIDDEN');expect(work).not.toHaveBeenCalled();expect(f.controls.privateBeforeTarget).toBe(0);
 f.controls.denyTarget=false;await expect(f.port().withCurrentCardServiceV4({...f.binding,accountId:'acct_WRONG'},f.quote.id,work)).rejects.toThrow('FORBIDDEN');expect(work).not.toHaveBeenCalled();
});
it('card-current-v4 requires current scoped service authority and actual original acceptance',async()=>{
 const unsigned=await ready(false);await expect(read(unsigned)).rejects.toThrow();const f=await ready(),before=await raw(f);f.controls.denyCurrent=true;await expect(read(f)).rejects.toThrow('FORBIDDEN');expect(await raw(f)).toEqual(before);
});
it('card-current-v4 appends settlement to the same ledger, suppresses queued only and preserves UNKNOWN and historical consent bytes',async()=>{
 const f=await ready(),queued=await reminder(f,'queued'),unknown=await reminder(f,'unknown'),before=await raw(f),p=payment(f);
 const s=await run(f,l=>l.advance([p]));expect(s.quote.revision).toBe(4);expect(s.balance).toMatchObject({state:'paid',remainingMinor:0,paidMinor:130000});
 expect((await read(f)).balance.reminders).toEqual(expect.arrayContaining([{id:queued.id,state:'suppressed'},{id:unknown.id,state:'unknown'}]));
 const after=await raw(f);expect(after.guest_financial_acceptances).toEqual(before.guest_financial_acceptances);
 const r=(await engine.query<{payload_ciphertext:string}>('SELECT payload_ciphertext FROM ls_fishing_billing.receipts WHERE workspace_id=$1',[f.workspace])).rows[0]!;
 expect(JSON.parse(unseal(r.payload_ciphertext,'ls_fishing_billing/v1/receipt/'+f.workspace+'/'+p.id,programRing))).toEqual(p);
 const old=(before.reminders as {id:string}[]).find(i=>i.id===unknown.id);expect((after.reminders as {id:string}[]).find(i=>i.id===unknown.id)).toEqual(old);
});
it.each(['cash','account','family','future','beforeAcceptance','duplicate'] as const)('card-current-v4 rejects invalid %s additions atomically',async kind=>{
 const f=await ready(),before=await raw(f),p=payment(f);let additions:LedgerReceipt[]=[p];
 if(kind==='cash')Object.assign(p,{kind:'cash',actorId:f.owner.id,provider:null});
 if(kind==='account')p.provider!.accountId='acct_WRONG';if(kind==='family')p.familyId=randomUUID();
 if(kind==='future')p.receivedAt=new Date(f.clock.now().valueOf()+1000).toISOString();if(kind==='beforeAcceptance')p.receivedAt='2035-01-02T14:00:00.000Z';if(kind==='duplicate')additions=[p,p];
 await expect(run(f,l=>l.advance(additions))).rejects.toThrow();expect(await raw(f)).toEqual(before);
});
it('card-current-v4 enforces original refund allocation ceilings without changing the original receipt',async()=>{
 const f=await ready(),p=payment(f);await run(f,l=>l.advance([p]));const before=await raw(f);
 const refund=ledgerReceiptSchema.parse({...p,id:randomUUID(),operationId:randomUUID(),kind:'refund',amountMinor:20000,allocations:[{lineId:f.quote.lines[0]!.id,amountMinor:20000}],originalReceiptId:p.id,reason:'SYNTHETIC provider refund',provider:{...p.provider!,transactionId:'re_SYNTHETIC'}});
 const s=await run(f,l=>l.advance([refund]));expect(s.balance.lines.map(l=>l.remainingMinor)).toEqual([20000,0]);const after=await raw(f);expect((after.receipts as {id:string}[]).find(r=>r.id===p.id)).toEqual((before.receipts as {id:string}[])[0]);
 const invalid={...refund,id:randomUUID(),operationId:randomUUID(),amountMinor:50000,allocations:[{lineId:f.quote.lines[0]!.id,amountMinor:50000}],provider:{...refund.provider!,transactionId:'re_TOO_MUCH'}};
 await expect(run(f,l=>l.advance([invalid]))).rejects.toThrow();expect(await raw(f)).toEqual(after);
});
it.each(['paused','cancelled'] as const)('card-current-v4 records late settlement on %s history without resuming collection',async state=>{
 const f=await ready();await f.billingOwner().setState(f.owner,{version:BILLING_SERVICE_V4,action:SERVICE_STATE_ACTION_V4,operationId:randomUUID(),quoteId:f.quote.id,expectedQuoteRevision:3,...(state==='paused'?{paused:true}:{cancel:true})});
 const s=await run(f,l=>l.advance([payment(f)]));expect(s.quote.revision).toBe(5);expect(s.quote.state).toBe(state==='cancelled'?'cancelled':'accepted');expect(s.quote.paused).toBe(state==='paused');expect(s.balance.paidMinor).toBe(130000);
});
it('card-current-v4 poisons the transaction when a callback catches a second advance',async()=>{
 const f=await ready(),before=await raw(f);await expect(run(f,async l=>{await l.advance([payment(f)]);await l.advance().catch(()=>{});})).rejects.toThrow('CONFLICT');expect(await raw(f)).toEqual(before);
});
it('card-current-v4 rolls back a swallowed invalid advance and drains a detached advance before rollback',async()=>{
 const f=await ready(),before=await raw(f),bad=payment(f);bad.provider!.accountId='acct_WRONG';await expect(run(f,async l=>{await l.advance([bad]).catch(()=>{});})).rejects.toThrow('CONFLICT');expect(await raw(f)).toEqual(before);
 let pending:Promise<unknown>|undefined;await expect(run(f,async l=>{pending=l.advance([payment(f)]);void pending.catch(()=>{});})).rejects.toThrow('CONFLICT');await pending;expect(await raw(f)).toEqual(before);
});
it('card-current-v4 rolls back committed-looking receipt and quote writes on terminal service revocation',async()=>{
 const f=await ready(),before=await raw(f);await expect(run(f,async l=>{await l.advance([payment(f)]);await l.context.tx.query('UPDATE synthetic_card4.admission SET active=false WHERE workspace_id=$1',[f.workspace]);})).rejects.toThrow('FORBIDDEN');expect(await raw(f)).toEqual(before);
});
it('card-current-v4 rejects mutated authority clocks and revokes borrowed transaction and advance after callback',async()=>{
 const f=await ready(),before=await raw(f);f.controls.mutateDate=true;await expect(read(f)).rejects.toThrow('UNAVAILABLE');expect(await raw(f)).toEqual(before);f.controls.mutateDate=false;
 let borrowed:ServiceCurrentCardLedgerV4|undefined;await run(f,async l=>{borrowed=l;expect(Object.isFrozen(l.frame.quote)).toBe(true);});
 await expect(borrowed!.context.tx.query('SELECT 1')).rejects.toThrow('UNAVAILABLE');await expect(borrowed!.advance()).rejects.toThrow('CONFLICT');expect(await raw(f)).toEqual(before);
});
it('card-current-v4 rolls back on full quote CAS failure',async()=>{
 const f=await ready(),before=await raw(f);const db:IdentityStore={transaction:work=>f.db.transaction(tx=>work({query:async<R extends object>(sql:string,v:readonly unknown[]=[])=>sql.startsWith('UPDATE ls_fishing_billing.quotes')?[]:tx.query<R>(sql,v)}))};
 await expect(f.port(db).withCurrentCardServiceV4(f.binding,f.quote.id,l=>l.advance([payment(f)]))).rejects.toThrow('CONFLICT');expect(await raw(f)).toEqual(before);
});
it('card-current-v4 admits actual producer attempt updates on either side of advance, and does not turn UNKNOWN into a receipt',async()=>{
 const f=await ready(),id=randomUUID(),operationId=randomUUID(),allocations=f.quote.lines.map(l=>({lineId:l.id,amountMinor:65000}));
 const attempt=cardAttemptSchema.parse({version:CARD_VERSION,id,workspaceId:f.workspace,quoteId:f.quote.id,familyId:f.quote.familyId,actorId:f.owner.id,revision:1,balanceVersion:3,binding:f.binding,command:{operationId,quoteId:f.quote.id,expectedVersion:3,selection:allocations},requestDigest:'a'.repeat(64),preparation:{version:CARD_VERSION,operationId,quoteId:f.quote.id,entityVersion:3,replayed:false,result:{attemptId:id,amountMinor:130000,allocations}},createdAt:f.clock.now().toISOString(),state:'unknown',dispatchId:randomUUID(),sessionId:null,checkoutUrl:null,paymentIntentId:null});
 await engine.query('INSERT INTO ls_fishing_billing.card_attempts VALUES($1,$2,$3,$4,$5,$6)',[f.workspace,id,f.quote.id,1,'unknown',seal(JSON.stringify(attempt),'ls_fishing_billing/card/v1/attempt/'+f.workspace+'/'+id,programRing)]);
 expect((await read(f)).balance).toMatchObject({paidMinor:0,pendingAttemptIds:[id]});
 const p=payment(f);await run(f,async l=>{
  const paid={...attempt,state:'paid',revision:2,paymentIntentId:p.provider!.transactionId};
  await l.context.tx.query("UPDATE ls_fishing_billing.card_attempts SET state='paid',revision=2,payload_ciphertext=$3 WHERE workspace_id=$1 AND id=$2",[f.workspace,id,seal(JSON.stringify(paid),'ls_fishing_billing/card/v1/attempt/'+f.workspace+'/'+id,programRing)]);
  await l.advance([p]);
  const final={...paid,revision:3,balanceVersion:4};await l.context.tx.query('UPDATE ls_fishing_billing.card_attempts SET revision=3,payload_ciphertext=$3 WHERE workspace_id=$1 AND id=$2',[f.workspace,id,seal(JSON.stringify(final),'ls_fishing_billing/card/v1/attempt/'+f.workspace+'/'+id,programRing)]);
 });expect((await read(f)).balance).toMatchObject({state:'paid',pendingAttemptIds:[],paidMinor:130000});
});
it('card-current-v4 detects altered existing receipt bytes after advance and rolls back',async()=>{
 const f=await ready(),p=payment(f);await run(f,l=>l.advance([p]));const before=await raw(f);
 await expect(run(f,async l=>{await l.advance();await l.context.tx.query('UPDATE ls_fishing_billing.receipts SET payload_ciphertext=$3 WHERE workspace_id=$1 AND id=$2',[f.workspace,p.id,seal(JSON.stringify(p),'ls_fishing_billing/v1/receipt/'+f.workspace+'/'+p.id,programRing)]);})).rejects.toThrow('CONFLICT');expect(await raw(f)).toEqual(before);
});
it('card-current-v4 pins the physical quote bytes after its own CAS through terminal checks',async()=>{
 const f=await ready(),before=await raw(f);
 await expect(run(f,async l=>{const s=await l.advance([payment(f)]);await l.context.tx.query('UPDATE ls_fishing_billing.quotes SET payload_ciphertext=$3 WHERE workspace_id=$1 AND id=$2',[f.workspace,f.quote.id,seal(JSON.stringify(s.quote),serviceGuestAadV4('quote',f.workspace,f.quote.id),programRing)]);})).rejects.toThrow('CONFLICT');expect(await raw(f)).toEqual(before);
});
it('card-current-v4 drains detached callback SQL inside the transaction and rejects the entire advance',async()=>{
 const f=await ready(),before=await raw(f);let release=()=>{},entered=()=>{},detached:Promise<unknown>|undefined;
 const gate=new Promise<void>(resolve=>{release=resolve;}),started=new Promise<void>(resolve=>{entered=resolve;});
 const db:IdentityStore={transaction:work=>f.db.transaction(tx=>work({query:async<R extends object>(sql:string,v:readonly unknown[]=[])=>{if(sql==='SELECT 42 AS held'){entered();await gate;}return tx.query<R>(sql,v);}}))};
 const result=f.port(db).withCurrentCardServiceV4(f.binding,f.quote.id,async l=>{await l.advance([payment(f)]);detached=l.context.tx.query('SELECT 42 AS held');void detached.catch(()=>{});});
 const outcome=expect(result).rejects.toThrow('CONFLICT');await started;release();await outcome;await expect(detached).rejects.toThrow('UNAVAILABLE');expect(await raw(f)).toEqual(before);
});
it('card-current-v4 requires an independent service authority implementation with no allow-all fallback',async()=>{
 const f=await ready(),ports={...f.authority};Reflect.deleteProperty(ports,'target');expect(()=>f.port(undefined,ports)).toThrow('UNAVAILABLE');
});
it.each(['CONFLICT','FORBIDDEN'] as const)('card-current-v4 preserves durable settlement and classifies post-COMMIT typed %s as uncertain',async code=>{
 const f=await ready(),p=payment(f),calls=vi.fn();let once=true,observed:unknown;
 const db:IdentityStore={transaction:async work=>{const result=await f.db.transaction(work);if(once){once=false;throw new AppError(code);}return result;}};
 try{await f.port(db).withCurrentCardServiceV4(f.binding,f.quote.id,async l=>{calls();return l.advance([p]);});}catch(error){observed=error;}
 // Actual memory SQL COMMIT precedes the injected adapter error. The original
 // settlement survives; this is neither a known rollback nor a failed charge.
 expect(calls).toHaveBeenCalledTimes(1);const committed=await raw(f),current=await read(f);
 expect(current.quote.revision).toBe(4);expect(current.balance).toMatchObject({state:'paid',paidMinor:130000,remainingMinor:0});expect(current.balance.receipts).toEqual([p]);
 // This DATA port is not the event producer/idempotency resolver. An attempted
 // second append of the same provider fact is denied, preserving exact bytes.
 await expect(run(f,l=>l.advance([p]))).rejects.toThrow();expect(await raw(f)).toEqual(committed);
 expect(observed).toMatchObject({message:'UNAVAILABLE'});
});
