import {randomUUID,createHash,createHmac} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {beforeAll,afterAll,afterEach,it,expect,vi} from 'vitest';
import {requirePgliteMemoryEnvironment} from '../fixtures/pglite-memory-environment.ts';
import {initializeProgramSchema,programRing,programKey} from '../fixtures/fishing-native-program-v3.ts';
import {serviceGuestFixtureV4} from '../fixtures/fishing-service-guest-v4.ts';
import {FishingServiceGuestNativeV4} from '../../src/features/fishing-billing/guest-service-native-v4.ts';
import {FishingServiceBillingOwnerV4,type ServiceOwnerFinancialAuthorityV4} from '../../src/features/fishing-billing/guest-service-owner-financial-v4.ts';
import {FishingProgramSourceNativeV3} from '../../src/features/fishing-billing/program-source-native-v3.ts';
import {FishingBillingInquiryFamilyProposals} from '../../src/lib/fishing-billing-inquiry-family-proposal.ts';
import {FishingServiceCurrentCardV4} from '../../src/features/fishing-billing/guest-service-current-card-v4.ts';
import {FishingServiceBillingCardsV4} from '../../src/features/fishing-billing/guest-service-cards-v4.ts';
import type {ServiceCurrentCardLedgerV4} from '../../src/features/fishing-billing/guest-service-current-card-contract-v4.ts';
import type {BillingStripeTestProvider} from '../../src/features/fishing-billing/cards.ts';
import {FishingBillingStripeInbox,verifyBillingStripeTestEvent,type BillingStripeInboxAuthority} from '../../src/features/fishing-billing/stripe-test.ts';
import {BILLING_SERVICE_V4} from '../../src/features/fishing-billing/guest-service-contract-v4.ts';
import {SERVICE_STATE_ACTION_V4} from '../../src/features/fishing-billing/guest-service-owner-state-contract-v4.ts';
import {canonical} from '../../src/features/contact-ops/core/validation.ts';
import {seal,unseal} from '../../src/features/identity/crypto.ts';
import {ledgerReceiptSchema} from '../../src/features/fishing-billing/contracts.ts';
import {AppError} from '../../src/lib/errors.ts';
import type {IdentityStore} from '../../src/features/identity/store.ts';
import type {PrepareCardCommand,ProviderPaymentSnapshot} from '../../src/features/fishing-billing/card-contracts.ts';
import type {CheckoutRequest} from '../../src/features/fishing-billing/card-checkout-request.ts';
import type {ServiceCheckoutEffectAuthorityV4} from '../../src/features/fishing-billing/guest-service-checkout-effect-v4.ts';
import type {ServiceCardReservationAuthorityV4} from '../../src/features/fishing-billing/guest-service-card-reservation-v4.ts';
import {serviceGuestAadV4} from '../../src/features/fishing-billing/guest-service-aad-v4.ts';
vi.mock('server-only',()=>({}));
let engine:PGlite;const network=vi.fn(async()=>{throw Error('NO_NETWORK');});
beforeAll(async()=>{requirePgliteMemoryEnvironment(process.env);vi.stubGlobal('fetch',network);engine=new PGlite();await initializeProgramSchema(engine);
 for(const name of ['UNNUMBERED_ls_fishing_fulfillment_v1.sql','UNNUMBERED_ls_fishing_service_material_v4.sql','UNNUMBERED_ls_fishing_quote_service_v4.sql','UNNUMBERED_ls_fishing_service_money_v4.sql','UNNUMBERED_ls_fishing_service_state_v4.sql'])await engine.exec(await readFile('migrations/proposals/'+name,'utf8'));
 await engine.exec('CREATE SCHEMA synthetic_owner_card4; CREATE TABLE synthetic_owner_card4.service(workspace_id uuid PRIMARY KEY,active boolean NOT NULL DEFAULT true,create_allowed boolean NOT NULL DEFAULT true)');
},20000);
afterEach(()=>expect(network).not.toHaveBeenCalled());afterAll(async()=>{try{await engine?.close();}finally{vi.unstubAllGlobals();}});
// Actual configured-owner/session/native family/source/issuer/V4 acceptance,
// owner prepare/read/UNKNOWN reservation, original request, shared event/money
// machinery and SQL/crypto. Grant is RAW SEEDED. Guardian/legal/resources and
// financial/service/provider/verifier permission remain SYNTHETIC/UNAPPROVED.
// No raw-seeded card attempt in these journeys; no SDK creation, network,
// runtime, real payment or PostgreSQL multi-connection competition proof.
async function ready(accept=true){
 const f=await serviceGuestFixtureV4(engine);if(accept)await new FishingServiceGuestNativeV4(f.db,f.workspace,programRing,programKey,f.commandKey,f.clock,f.resolver()).acceptFinancialOffer(f.token,f.command);
 await engine.query('INSERT INTO synthetic_owner_card4.service(workspace_id) VALUES($1)',[f.workspace]);
 const controls={denyTarget:false,denyCard:false,denyService:false,clock:false,failRequest:false,failCAS:false,postCommit:false,retry:false,retryGate:false,privateBeforeTarget:0,holdQuery:null as Promise<void>|null,queryEntered:()=>{},revokeAtOwnerTarget:false,revokeAtOwnerTerminal:false,afterReserveOwnerChecks:0,terminalDone:false,terminalAuthorizations:0,reservationClock:false,nativeDepth:0,effectAuthorizations:0,effectClock:false,modeledPosts:0,createError:null as Error|null,beforeCreate:null as ((request:CheckoutRequest)=>Promise<void>)|null,afterCreate:null as ((request:CheckoutRequest)=>Promise<void>)|null,resultFails:false,resultPostCommit:false,sessionPatch:{} as {accountId?:string;amountMinor?:number;url?:string;paymentStatus?:'paid'|'unpaid'|'no_payment_required'}};
 const originalError=new AppError('CONFLICT'),ledgerKey=Buffer.from(programKey);
 const tracked:IdentityStore={transaction:async work=>{controls.nativeDepth++;try{return await f.db.transaction(work);}finally{controls.nativeDepth--;}}};
 const db:IdentityStore={transaction:async work=>{controls.terminalDone=false;let writes=false;const once=()=>tracked.transaction(tx=>work({query:async<R extends object>(sql:string,v:readonly unknown[]=[])=>{
  if(controls.terminalDone&&(sql.includes('ls_fishing_billing')||sql.includes('synthetic_owner_card4')))throw Error('NATIVE_FINANCIAL_IO_AFTER_TERMINAL_SERVICE');
  if(controls.denyTarget&&sql.includes('FROM ls_fishing_billing'))controls.privateBeforeTarget++;
  if(sql==='SELECT 42 AS owner_held'){controls.queryEntered();await controls.holdQuery;}
  if(controls.failRequest&&sql.startsWith('INSERT INTO ls_fishing_billing.card_attempt_requests'))throw new AppError('UNAVAILABLE');
  if(sql.startsWith('UPDATE ls_fishing_billing.quotes')){writes=true;if(controls.failCAS)return [];}
  return tx.query<R>(sql,v);
 }}));
 if(controls.retry){controls.retry=false;await expect(once()).rejects.toBe(originalError);await once();throw originalError;}
 const result=await once();if(writes&&controls.postCommit){controls.postCommit=false;throw new AppError('FORBIDDEN');}return result;
 }};
 const authority:ServiceOwnerFinancialAuthorityV4={target:async c=>{if(controls.denyTarget)throw new AppError('FORBIDDEN');if(controls.revokeAtOwnerTarget){controls.revokeAtOwnerTarget=false;await c.tx.query('UPDATE synthetic_owner_card4.service SET active=false WHERE workspace_id=$1',[f.workspace]);}},authorize:async(c,s)=>{
  expect(c.actor.id).toBe(f.owner.id);if(s.familyId!==f.quote.familyId||s.quoteId!==f.quote.id||s.offerSha256!==f.quote.offer.sha256||s.action==='card'&&controls.denyCard)throw new AppError('FORBIDDEN');if(controls.clock)c.now.setTime(c.now.valueOf()+1);
  if(controls.retryGate&&s.action==='card'){const rows=await c.tx.query<{revision:number}>('SELECT revision FROM ls_fishing_billing.quotes WHERE workspace_id=$1 AND id=$2',[f.workspace,f.quote.id]);if(rows[0]!.revision>=4){controls.retryGate=false;throw originalError;}}
  if(controls.revokeAtOwnerTerminal&&s.action==='card'){const rows=await c.tx.query<{revision:number}>('SELECT revision FROM ls_fishing_billing.quotes WHERE workspace_id=$1 AND id=$2',[f.workspace,f.quote.id]);if(rows[0]!.revision>=5&&++controls.afterReserveOwnerChecks===3){controls.revokeAtOwnerTerminal=false;await c.tx.query('UPDATE synthetic_owner_card4.service SET active=false WHERE workspace_id=$1',[f.workspace]);}}
 }};
 const families=new FishingBillingInquiryFamilyProposals(f.db,f.workspace,programRing,programKey,f.clock),owner=new FishingServiceBillingOwnerV4(f.workspace,new FishingProgramSourceNativeV3(db,f.workspace,programRing,programKey,f.owner.id,f.clock),families,programRing,programKey,f.commandKey,ledgerKey,f.clock,authority);
 const binding={accountId:'acct_SYNTHETIC',livemode:false as const,apiVersion:'2026-09-30.endive' as const,verifiedBindingId:'SYNTHETIC-OWNER4-NO-SDK'},config={binding,cardOnlyConfigurationId:'pmc_SYNTHETIC',approvedProductLabel:'SYNTHETIC ONLY'};
 const currentDb:IdentityStore={transaction:async work=>{let writes=false;const result=await tracked.transaction(tx=>work({query:async<R extends object>(sql:string,v:readonly unknown[]=[])=>{if(sql.startsWith('UPDATE ls_fishing_billing.quotes'))writes=true;if(controls.resultFails&&sql.startsWith('UPDATE ls_fishing_billing.card_attempts'))throw new AppError('CONFLICT');return tx.query<R>(sql,v);}}));if(writes&&controls.resultPostCommit){controls.resultPostCommit=false;throw new AppError('FORBIDDEN');}return result;}};
 const current=new FishingServiceCurrentCardV4(currentDb,f.workspace,families,programRing,programKey,f.commandKey,ledgerKey,f.clock,{target:async(c,b)=>{expect(c).not.toHaveProperty('actor');const rows=await c.tx.query<{active:boolean}>('SELECT active FROM synthetic_owner_card4.service WHERE workspace_id=$1 FOR SHARE',[f.workspace]);if(controls.denyService||canonical(b)!==canonical(binding)||rows.length!==1||!rows[0]!.active)throw new AppError('FORBIDDEN');},authorize:async(_c,_b,s)=>{if(s.familyId!==f.quote.familyId)throw new AppError('FORBIDDEN');}});
 const snapshots=new Map<string,ProviderPaymentSnapshot>(),created=vi.fn(async(request:CheckoutRequest)=>{
  expect(controls.nativeDepth).toBe(0);expect(Object.isFrozen(request)).toBe(true);expect(Object.isFrozen(request.params.metadata)).toBe(true);if(controls.beforeCreate)await controls.beforeCreate(request);if(controls.createError)throw controls.createError;controls.modeledPosts++;
  if(controls.afterCreate)await controls.afterCreate(request);
  return {accountId:binding.accountId,livemode:false as const,apiVersion:binding.apiVersion,quoteId:request.quoteId,attemptId:request.operationId,id:'cs_'+request.operationId.replaceAll('-',''),amountMinor:request.amountMinor,currency:'USD' as const,url:'https://checkout.stripe.com/c/pay/SYNTHETIC',paymentStatus:'unpaid' as const,...controls.sessionPatch};
 }),provider:BillingStripeTestProvider={createCheckout:created,readPayment:async r=>{expect(controls.nativeDepth).toBe(0);const s=snapshots.get(r.eventId);if(!s)throw new AppError('UNAVAILABLE');return structuredClone(s);}};
 const inbox:BillingStripeInboxAuthority={authorize:async(_tx,ws,b)=>{if(ws!==f.workspace||canonical(b)!==canonical(binding)||controls.denyService)throw new AppError('FORBIDDEN');}};
 const reservation:ServiceCardReservationAuthorityV4={target:async(c,b)=>{
  expect(c).not.toHaveProperty('actor');expect(b).toEqual(binding);const rows=await c.tx.query<{active:boolean}>('SELECT active FROM synthetic_owner_card4.service WHERE workspace_id=$1 FOR SHARE',[f.workspace]);if(c.workspaceId!==f.workspace||controls.denyService||rows.length!==1||!rows[0]!.active)throw new AppError('FORBIDDEN');
 },authorize:async(c,b,r)=>{
  expect(c).not.toHaveProperty('actor');expect(b).toEqual(binding);expect(r.version).toBe(BILLING_SERVICE_V4);expect(r.purpose).toBe('reserve_checkout');expect(Object.isFrozen(r.request)).toBe(true);
  const q=r.snapshot.quote,a=r.attempt;
  // Actual SAME-TX native join sees the uncommitted UNKNOWN/current revision.
  // This table is synthetic service admission, not real provider permission.
  const rows=await c.tx.query<{quoteCipher:string;attemptCipher:string;requestCipher:string}>('SELECT q.payload_ciphertext AS "quoteCipher",a.payload_ciphertext AS "attemptCipher",r.payload_ciphertext AS "requestCipher" FROM synthetic_owner_card4.service s JOIN ls_fishing_billing.quotes q ON q.workspace_id=s.workspace_id JOIN ls_fishing_billing.card_attempts a ON a.workspace_id=q.workspace_id AND a.quote_id=q.id JOIN ls_fishing_billing.card_attempt_requests r ON r.workspace_id=a.workspace_id AND r.attempt_id=a.id AND r.quote_id=q.id WHERE s.workspace_id=$1 AND s.active AND q.id=$2 AND q.family_id=$3 AND q.revision=$4 AND a.id=$5 AND a.state=$6 AND a.revision=$7 FOR SHARE OF s,q,a,r',[f.workspace,q.id,q.familyId,q.revision,a.id,a.state,a.revision]);
  if(rows.length!==1)throw new AppError('FORBIDDEN');const actual=rows[0]!;
  expect(JSON.parse(unseal(actual.quoteCipher,serviceGuestAadV4('quote',f.workspace,q.id),programRing))).toEqual(q);expect(JSON.parse(unseal(actual.attemptCipher,'ls_fishing_billing/card/v1/attempt/'+f.workspace+'/'+a.id,programRing))).toEqual(a);expect(JSON.parse(unseal(actual.requestCipher,'ls_fishing_billing/card/v1/checkout_request/'+f.workspace+'/'+a.id,programRing)).request).toEqual(r.request);
  const children=await c.tx.query<{id:string}>("SELECT person_id AS id FROM ls_cases.family_members WHERE workspace_id=$1 AND family_id=$2 AND role='child' FOR SHARE",[f.workspace,q.familyId]);expect(q.lines.every(l=>children.some(ch=>ch.id===l.childId))).toBe(true);
  if(r.phase==='terminal'){expect(a.state).toBe('unknown');expect(a.dispatchId).toEqual(expect.any(String));expect(a.balanceVersion).toBe(q.revision);controls.terminalAuthorizations++;controls.terminalDone=true;}
  else expect(a.state).toBe('prepared');if(controls.reservationClock)c.now.setTime(c.now.valueOf()+1);
 }};
 const checkout:ServiceCheckoutEffectAuthorityV4={target:async(c,b)=>{expect(c).not.toHaveProperty('actor');expect(b).toEqual(binding);const rows=await c.tx.query<{active:boolean;create_allowed:boolean}>('SELECT active,create_allowed FROM synthetic_owner_card4.service WHERE workspace_id=$1 FOR SHARE',[f.workspace]);if(rows.length!==1||!rows[0]!.active||!rows[0]!.create_allowed)throw new AppError('FORBIDDEN');},authorize:async(c,b,d)=>{
  expect(c).not.toHaveProperty('actor');expect(b).toEqual(binding);expect(d.version).toBe(BILLING_SERVICE_V4);expect(d.purpose).toBe('create_checkout');expect(Object.isFrozen(d.request)).toBe(true);controls.effectAuthorizations++;
  const rows=await c.tx.query<{state:string;revision:number;ciphertext:string}>("SELECT a.state,q.revision,r.payload_ciphertext AS ciphertext FROM synthetic_owner_card4.service s JOIN ls_fishing_billing.quotes q ON q.workspace_id=s.workspace_id JOIN ls_fishing_billing.card_attempts a ON a.workspace_id=q.workspace_id AND a.quote_id=q.id JOIN ls_fishing_billing.card_attempt_requests r ON r.workspace_id=a.workspace_id AND r.attempt_id=a.id WHERE s.workspace_id=$1 AND s.active AND s.create_allowed AND q.id=$2 AND a.id=$3 FOR SHARE OF s,q,a,r",[f.workspace,d.effect.quoteId,d.effect.operationId]);
  if(rows.length!==1||rows[0]!.state!=='unknown'||rows[0]!.revision!==d.snapshot.quote.revision)throw new AppError('FORBIDDEN');expect(JSON.parse(unseal(rows[0]!.ciphertext,'ls_fishing_billing/card/v1/checkout_request/'+f.workspace+'/'+d.attempt.id,programRing)).request).toEqual(d.request);expect(d.request.amountMinor).toBe(d.effect.amountMinor);expect(d.request.params.payment_method_configuration).toBe(d.effect.configurationId);if(controls.effectClock)c.now.setTime(c.now.valueOf()+1);
 }};
 const cards=(transport:BillingStripeTestProvider|null=provider,permission:ServiceCardReservationAuthorityV4|null=reservation,effect:ServiceCheckoutEffectAuthorityV4|null=checkout)=>new FishingServiceBillingCardsV4(tracked,f.workspace,current,owner,programRing,ledgerKey,config,inbox,transport,null,permission,effect);
 const command:PrepareCardCommand={operationId:randomUUID(),quoteId:f.quote.id,expectedVersion:3,selection:f.quote.lines.map(l=>({lineId:l.id,amountMinor:65000}))};
 return {...f,billingOwner:owner,controls,current,cards,command,binding,created,snapshots,inbox,reservation,provider,checkout};
}
type Fixture=Awaited<ReturnType<typeof ready>>;
async function rows(f:Fixture){const result:Record<string,unknown>={};for(const table of ['quotes','receipts','card_attempts','card_attempt_requests','guest_financial_acceptances'])result[table]=(await engine.query('SELECT * FROM ls_fishing_billing.'+table+' WHERE workspace_id=$1 ORDER BY 2',[f.workspace])).rows;return result;}
const view=(f:Fixture)=>f.billingOwner.readSnapshot(f.owner,f.quote.id);
const sdkEffect=(r:CheckoutRequest)=>({effect:'create_checkout' as const,binding:r.binding,operationId:r.operationId,quoteId:r.quoteId,amountMinor:r.amountMinor,configurationId:r.params.payment_method_configuration});
async function request(f:Fixture,id=f.command.operationId){const r=(await engine.query<{payload_ciphertext:string}>('SELECT payload_ciphertext FROM ls_fishing_billing.card_attempt_requests WHERE workspace_id=$1 AND attempt_id=$2',[f.workspace,id])).rows[0]!;return JSON.parse(unseal(r.payload_ciphertext,'ls_fishing_billing/card/v1/checkout_request/'+f.workspace+'/'+id,programRing));}
it('owner-card-v4 actually prepares once under configured owner and preserves exact frozen request, consent and original-command recovery',async()=>{
 const f=await ready(),before=await rows(f),first=await f.cards().prepare(f.owner,f.command),saved=await rows(f);expect(first.entityVersion).toBe(4);expect(first.result.amountMinor).toBe(130000);expect((await view(f)).balance.pendingAttemptIds).toEqual([f.command.operationId]);
 expect(saved.guest_financial_acceptances).toEqual(before.guest_financial_acceptances);const r=await request(f);expect(r.request.params.integration_identifier).toMatch(/^jlfa_monthly_[a-z]{8}$/);expect(r.request.idempotencyKey).toBe(f.command.operationId);expect(r.request.allocations).toEqual(f.command.selection);
 expect(await f.cards().prepare(f.owner,f.command)).toEqual({...first,replayed:true});expect(await f.cards().readPreparationReceipt(f.owner,f.command)).toEqual({...first,replayed:true});expect(await rows(f)).toEqual(saved);expect(f.created).not.toHaveBeenCalled();
});
it('owner-card-v4 lookup does not create an absent operation and rejects a changed original command',async()=>{
 const f=await ready(),before=await rows(f);expect(await f.cards().readPreparationReceipt(f.owner,f.command)).toBeNull();expect(await rows(f)).toEqual(before);await f.cards().prepare(f.owner,f.command);const saved=await rows(f);
 await expect(f.cards().readPreparationReceipt(f.owner,{...f.command,selection:[{lineId:f.command.selection[0]!.lineId,amountMinor:1}]})).rejects.toThrow('CONFLICT');expect(await rows(f)).toEqual(saved);
});
it.each(['target','card','clock','session','workspace','unsigned'] as const)('owner-card-v4 denies %s before it can prepare a payment',async gate=>{
 const f=await ready(gate!=='unsigned'),before=await rows(f);f.controls.denyTarget=gate==='target';f.controls.denyCard=gate==='card';f.controls.clock=gate==='clock';
 const actor={...f.owner,...(gate==='session'?{sessionDigest:'0'.repeat(64)}:{}),...(gate==='workspace'?{workspaceId:randomUUID() as typeof f.workspace}:{})};
 await expect(f.cards().prepare(actor,f.command)).rejects.toThrow();expect(await rows(f)).toEqual(before);if(gate==='target')expect(f.controls.privateBeforeTarget).toBe(0);expect(f.created).not.toHaveBeenCalled();
});
it.each(['request','cas'] as const)('owner-card-v4 rolls back attempt, immutable request and quote together on %s failure',async point=>{
 const f=await ready(),before=await rows(f);f.controls.failRequest=point==='request';f.controls.failCAS=point==='cas';await expect(f.cards().prepare(f.owner,f.command)).rejects.toThrow();expect(await rows(f)).toEqual(before);
});
it('owner-card-v4 reserves UNKNOWN once with the frozen original key and never invokes SDK creation',async()=>{
 const f=await ready();await f.cards().prepare(f.owner,f.command);const frozen=await request(f),reserved=await f.cards().reserveCheckout(f.owner,f.quote.id,f.command.operationId);expect(reserved.dispatch).toBe(true);expect(reserved.attempt.state).toBe('unknown');expect(reserved.attempt.dispatchId).toEqual(expect.any(String));
 const saved=await rows(f);expect(await f.cards().reserveCheckout(f.owner,f.quote.id,f.command.operationId)).toEqual({dispatch:false,attempt:reserved.attempt});expect(await rows(f)).toEqual(saved);expect(await request(f)).toEqual(frozen);expect((await view(f)).balance.paidMinor).toBe(0);expect(f.created).not.toHaveBeenCalled();
});
it('owner-card-v4 missing provider or revoked independent service cannot reserve UNKNOWN',async()=>{
 const f=await ready();await f.cards().prepare(f.owner,f.command);const before=await rows(f);await expect(f.cards(null).reserveCheckout(f.owner,f.quote.id,f.command.operationId)).rejects.toThrow('UNAVAILABLE');await expect(f.cards(f.provider,null).reserveCheckout(f.owner,f.quote.id,f.command.operationId)).rejects.toThrow('UNAVAILABLE');f.controls.denyService=true;await expect(f.cards().reserveCheckout(f.owner,f.quote.id,f.command.operationId)).rejects.toThrow('FORBIDDEN');expect(await rows(f)).toEqual(before);
});
it('owner-card-v4 retains original preparation after real cash and marks its old amount stale instead of dispatching it',async()=>{
 const f=await ready(),original=await f.cards().prepare(f.owner,f.command);await f.billingOwner.recordCashDate(f.owner,{version:BILLING_SERVICE_V4,operationId:randomUUID(),quoteId:f.quote.id,expectedVersion:4,amountMinor:30000,currency:'USD',receivedPrecision:'date',receivedDate:'2035-01-02',timeZone:'America/New_York',allocations:[{lineId:f.quote.lines[0]!.id,amountMinor:30000}]});
 expect(await f.cards().readPreparationReceipt(f.owner,f.command)).toEqual({...original,replayed:true});const r=await f.cards().reserveCheckout(f.owner,f.quote.id,f.command.operationId);expect(r).toMatchObject({dispatch:false,attempt:{state:'stale'}});expect((await view(f)).balance).toMatchObject({paidMinor:30000,remainingMinor:100000});expect(f.created).not.toHaveBeenCalled();
});
it.each(['paused','cancelled'] as const)('owner-card-v4 fences a prepared request after actual owner %s state',async state=>{
 const f=await ready();await f.cards().prepare(f.owner,f.command);await f.billingOwner.setState(f.owner,{version:BILLING_SERVICE_V4,action:SERVICE_STATE_ACTION_V4,operationId:randomUUID(),quoteId:f.quote.id,expectedQuoteRevision:4,...(state==='paused'?{paused:true}:{cancel:true})});
 expect(await f.cards().reserveCheckout(f.owner,f.quote.id,f.command.operationId)).toMatchObject({dispatch:false,attempt:{state:'stale'}});expect((await view(f)).quote.state).toBe(state==='cancelled'?'cancelled':'accepted');
});
it('owner-card-v4 preserves commit uncertainty and recovers exact original preparation without creating another attempt',async()=>{
 const f=await ready();f.controls.postCommit=true;await expect(f.cards().prepare(f.owner,f.command)).rejects.toThrow('UNAVAILABLE');const saved=await rows(f),original=await f.cards().readPreparationReceipt(f.owner,f.command);expect(original).toMatchObject({entityVersion:4,replayed:true,result:{attemptId:f.command.operationId,amountMinor:130000}});expect(await f.cards().prepare(f.owner,f.command)).toEqual(original);expect(await rows(f)).toEqual(saved);expect(f.created).not.toHaveBeenCalled();
});
it('owner-card-v4 discards rollback1 callback error after retry2 COMMIT and recovers its original frozen request',async()=>{
 const f=await ready();f.controls.retry=true;f.controls.retryGate=true;await expect(f.cards().prepare(f.owner,f.command)).rejects.toThrow('UNAVAILABLE');const saved=await rows(f);expect((await view(f)).quote.revision).toBe(4);expect(await f.cards().readPreparationReceipt(f.owner,f.command)).toMatchObject({entityVersion:4,replayed:true});expect(await rows(f)).toEqual(saved);expect(f.created).not.toHaveBeenCalled();
});
it('owner-card-v4 poisons caught double advance, drains detached advance and revokes its borrowed context',async()=>{
 const f=await ready(),before=await rows(f);await expect(f.billingOwner.withCurrentCardActorV4(f.owner,f.quote.id,async l=>{await l.advance();await l.advance().catch(()=>{});})).rejects.toThrow('CONFLICT');expect(await rows(f)).toEqual(before);
 let pending:Promise<unknown>|undefined;await expect(f.billingOwner.withCurrentCardActorV4(f.owner,f.quote.id,async l=>{pending=l.advance();void pending.catch(()=>{});})).rejects.toThrow('CONFLICT');await pending;expect(await rows(f)).toEqual(before);
 let borrowed:ServiceCurrentCardLedgerV4|undefined;await f.billingOwner.withCurrentCardActorV4(f.owner,f.quote.id,async l=>{borrowed=l;expect(Object.isFrozen(l.frame.quote)).toBe(true);});await expect(borrowed!.context.tx.query('SELECT 1')).rejects.toThrow();await expect(borrowed!.advance()).rejects.toThrow('CONFLICT');expect(await rows(f)).toEqual(before);
});
it('owner-card-v4 runs actual two-child partial cash, preparation, UNKNOWN reservation and MOCK event reconciliation through one ledger',async()=>{
 const f=await ready();await f.billingOwner.recordCashDate(f.owner,{version:BILLING_SERVICE_V4,operationId:randomUUID(),quoteId:f.quote.id,expectedVersion:3,amountMinor:30000,currency:'USD',receivedPrecision:'date',receivedDate:'2035-01-02',timeZone:'America/New_York',allocations:[{lineId:f.quote.lines[0]!.id,amountMinor:20000},{lineId:f.quote.lines[1]!.id,amountMinor:10000}]});
 const cmd={...f.command,expectedVersion:4,selection:[{lineId:f.quote.lines[0]!.id,amountMinor:45000},{lineId:f.quote.lines[1]!.id,amountMinor:55000}]};const original=await f.cards().prepare(f.owner,cmd),reserved=await f.cards().reserveCheckout(f.owner,f.quote.id,cmd.operationId);expect(reserved.dispatch).toBe(true);
 const eventId='evt_'+randomUUID().replaceAll('-',''),bytes=Buffer.from('SYNTHETIC-OWNER4-'+eventId),snapshot:ProviderPaymentSnapshot={accountId:f.binding.accountId,livemode:false,apiVersion:f.binding.apiVersion,quoteId:f.quote.id,attemptId:cmd.operationId,sessionId:'cs_'+cmd.operationId.replaceAll('-',''),paymentIntentId:'pi_'+cmd.operationId.replaceAll('-',''),currency:'USD',amountMinor:100000,receivedMinor:100000,status:'paid',method:'card',paidAt:f.clock.now().toISOString(),observedAt:f.clock.now().toISOString(),refunds:[],dispute:'none'};
 const receipt={eventId,eventType:'payment_intent.succeeded' as const,objectId:snapshot.paymentIntentId,providerAccountId:f.binding.accountId,livemode:false as const,apiVersion:f.binding.apiVersion,digest:createHash('sha256').update(bytes).digest('hex'),createdAt:f.clock.now().toISOString()};
 const cap=verifyBillingStripeTestEvent({rawBody:bytes,signatureHeader:'MOCK-NOT-STRIPE',binding:f.binding,now:f.clock.now(),sdk:{verify:()=>({kind:'stripe_test_signature_only',receipt})}});await new FishingBillingStripeInbox(f.db,f.workspace,programRing,f.clock,f.inbox).ingest(cap);f.snapshots.set(eventId,snapshot);await f.cards().processEvent(eventId);
 const current=await view(f);expect(current.balance).toMatchObject({state:'paid',remainingMinor:0,paidMinor:130000,pendingAttemptIds:[]});expect(current.balance.receipts).toHaveLength(2);expect(current.balance.lines.map(l=>l.paidMinor)).toEqual([65000,65000]);expect(await f.cards().readPreparationReceipt(f.owner,cmd)).toEqual({...original,replayed:true});expect(f.created).not.toHaveBeenCalled();
});
it('owner-card-v4 denies a changed frozen request before reserving UNKNOWN',async()=>{
 const f=await ready();await f.cards().prepare(f.owner,f.command);const frozen=await request(f);frozen.request.idempotencyKey=randomUUID();await engine.query('UPDATE ls_fishing_billing.card_attempt_requests SET payload_ciphertext=$3 WHERE workspace_id=$1 AND attempt_id=$2',[f.workspace,f.command.operationId,seal(JSON.stringify(frozen),'ls_fishing_billing/card/v1/checkout_request/'+f.workspace+'/'+f.command.operationId,programRing)]);
 const tampered=await rows(f);await expect(f.cards().reserveCheckout(f.owner,f.quote.id,f.command.operationId)).rejects.toThrow();expect(await rows(f)).toEqual(tampered);expect((await f.cards().readAttempt(f.owner,f.quote.id,f.command.operationId)).state).toBe('prepared');expect(f.created).not.toHaveBeenCalled();
});
it('owner-card-v4 actual terminal session revocation rolls back the advance instead of accepting a cached Actor',async()=>{
 const f=await ready(),before=await rows(f);await expect(f.billingOwner.withCurrentCardActorV4(f.owner,f.quote.id,async l=>{await l.advance();await l.context.tx.query('UPDATE ls_identity.sessions SET revoked_at=$2 WHERE token_digest=$1',[f.owner.sessionDigest,f.clock.now()]);})).rejects.toThrow();expect(await rows(f)).toEqual(before);expect((await view(f)).quote.revision).toBe(3);
});
it('owner-card-v4 cannot use the owner revision port to append a provider money receipt',async()=>{
 const f=await ready(),before=await rows(f),r=ledgerReceiptSchema.parse({id:randomUUID(),operationId:randomUUID(),quoteId:f.quote.id,familyId:f.quote.familyId,kind:'card',currency:'USD',amountMinor:1,allocations:[{lineId:f.quote.lines[0]!.id,amountMinor:1}],originalReceiptId:null,actorId:null,reason:null,receivedAt:f.clock.now().toISOString(),recordedAt:f.clock.now().toISOString(),provider:{accountId:f.binding.accountId,mode:'test',transactionId:'pi_NOT_AUTHORITY'}});
 await expect(f.billingOwner.withCurrentCardActorV4(f.owner,f.quote.id,async l=>{await l.advance([r]).catch(()=>{});})).rejects.toThrow('CONFLICT');expect(await rows(f)).toEqual(before);
});
it('owner-card-v4 drains detached callback SQL before native rollback and preserves the original quote',async()=>{
 const f=await ready(),before=await rows(f);let release=()=>{},entered=()=>{},detached:Promise<unknown>|undefined;f.controls.holdQuery=new Promise<void>(r=>{release=r;});const started=new Promise<void>(r=>{entered=r;});f.controls.queryEntered=entered;
 const operation=f.billingOwner.withCurrentCardActorV4(f.owner,f.quote.id,async l=>{await l.advance();detached=l.context.tx.query('SELECT 42 AS owner_held');void detached.catch(()=>{});});const outcome=expect(operation).rejects.toThrow('CONFLICT');await started;release();await outcome;await expect(detached).rejects.toThrow();expect(await rows(f)).toEqual(before);
});
it('owner-card-v4 two competing prepare commands produce one native attempt and one frozen request',async()=>{
 const f=await ready(),other={...f.command,operationId:randomUUID()},results=await Promise.allSettled([f.cards().prepare(f.owner,f.command),f.cards().prepare(f.owner,other)]);expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(results.filter(r=>r.status==='rejected')).toHaveLength(1);const stored=await rows(f);expect(stored.card_attempts).toHaveLength(1);expect(stored.card_attempt_requests).toHaveLength(1);expect((await view(f)).quote.revision).toBe(4);expect(f.created).not.toHaveBeenCalled();
 // PGlite serializes these transactions; not native PostgreSQL race evidence.
});
it.each(['target','terminal'] as const)('owner-card-v4 rolls back UNKNOWN when service is revoked at the late owner %s hook',async point=>{
 const f=await ready();await f.cards().prepare(f.owner,f.command);const before=await rows(f);f.controls.revokeAtOwnerTarget=point==='target';f.controls.revokeAtOwnerTerminal=point==='terminal';let returned:Awaited<ReturnType<ReturnType<Fixture['cards']>['reserveCheckout']>>|undefined;
 try{returned=await f.cards().reserveCheckout(f.owner,f.quote.id,f.command.operationId);}catch{/* Expected native rollback, never a dispatch result. */}
 const after=await rows(f);expect(f.created).not.toHaveBeenCalled();expect((after.card_attempts as {state:string;revision:number}[]).map(a=>({state:a.state,revision:a.revision}))).toEqual((before.card_attempts as {state:string;revision:number}[]).map(a=>({state:a.state,revision:a.revision})));
 expect(createHash('sha256').update(JSON.stringify(after)).digest('hex')).toBe(createHash('sha256').update(JSON.stringify(before)).digest('hex'));expect(returned?.dispatch).not.toBe(true);
});
it('owner-card-v4 authorizes actual uncommitted UNKNOWN in the owner TX after all mutable owner hooks',async()=>{
 const f=await ready();await f.cards().prepare(f.owner,f.command);const result=await f.cards().reserveCheckout(f.owner,f.quote.id,f.command.operationId);expect(result.dispatch).toBe(true);expect(f.controls.terminalAuthorizations).toBe(1);expect(f.controls.terminalDone).toBe(true);expect(f.created).not.toHaveBeenCalled();
 // The fixture rejects financial IO after the final decision, while allowing
 // Source3's actual pure locked owner/session postlude. This passed that guard.
});
it('owner-card-v4 rejects a mutated independent authority clock without creating UNKNOWN',async()=>{
 const f=await ready();await f.cards().prepare(f.owner,f.command);const before=await rows(f);f.controls.reservationClock=true;await expect(f.cards().reserveCheckout(f.owner,f.quote.id,f.command.operationId)).rejects.toThrow('UNAVAILABLE');expect(await rows(f)).toEqual(before);
});
it('owner-card-v4 drains detached terminal service SQL inside rollback and never returns dispatch',async()=>{
 const f=await ready();await f.cards().prepare(f.owner,f.command);const before=await rows(f);let release=()=>{},entered=()=>{},detached:Promise<unknown>|undefined;f.controls.holdQuery=new Promise<void>(r=>{release=r;});const started=new Promise<void>(r=>{entered=r;});f.controls.queryEntered=entered;
 const authority:ServiceCardReservationAuthorityV4={target:f.reservation.target,authorize:async(c,b,r)=>{await f.reservation.authorize(c,b,r);if(r.phase==='terminal'){detached=c.tx.query('SELECT 42 AS owner_held');void detached.catch(()=>{});}}};
 const operation=f.cards(f.provider,authority).reserveCheckout(f.owner,f.quote.id,f.command.operationId),outcome=expect(operation).rejects.toThrow('UNAVAILABLE');await started;release();await outcome;await expect(detached).rejects.toThrow();expect(await rows(f)).toEqual(before);expect(f.created).not.toHaveBeenCalled();
});
it('owner-card-v4 preserves committed UNKNOWN after a terminal-admitted reservation error without returning another dispatch',async()=>{
 const f=await ready();await f.cards().prepare(f.owner,f.command);f.controls.postCommit=true;
 await expect(f.cards().reserveCheckout(f.owner,f.quote.id,f.command.operationId)).rejects.toThrow('UNAVAILABLE');const stored=await rows(f),attempt=await f.cards().readAttempt(f.owner,f.quote.id,f.command.operationId);expect(attempt.state).toBe('unknown');expect(attempt.dispatchId).toEqual(expect.any(String));expect(f.controls.terminalAuthorizations).toBe(1);
 expect(await f.cards().reserveCheckout(f.owner,f.quote.id,f.command.operationId)).toEqual({dispatch:false,attempt});expect(await rows(f)).toEqual(stored);expect(f.controls.terminalAuthorizations).toBe(1);expect(f.created).not.toHaveBeenCalled();
});
it('provider-boundary-v4 pairs fresh native admission at both MOCK SDK points and stores a session without crediting funds',async()=>{
 const f=await ready();await f.cards().prepare(f.owner,f.command);const frozen=await request(f),cards=f.cards();f.controls.beforeCreate=async r=>{await cards.checkoutAdmission().authorize(sdkEffect(r));await cards.checkoutAdmission().authorize(sdkEffect(r));};
 const result=await cards.createCheckout(f.owner,f.quote.id,f.command.operationId);expect(result.state).toBe('open');expect(result.sessionId).toBe('cs_'+f.command.operationId.replaceAll('-',''));expect(f.created).toHaveBeenCalledTimes(1);expect(f.controls.modeledPosts).toBe(1);expect(f.controls.effectAuthorizations).toBe(3);expect((await view(f)).balance).toMatchObject({paidMinor:0,pendingAttemptIds:[f.command.operationId]});expect(await request(f)).toEqual(frozen);
 await expect(cards.checkoutAdmission().authorize(sdkEffect(f.created.mock.calls[0]![0]))).rejects.toThrow('UNAVAILABLE');expect((await f.cards().createCheckout(f.owner,f.quote.id,f.command.operationId)).state).toBe('open');expect(f.created).toHaveBeenCalledTimes(1);
});
it('provider-boundary-v4 holds UNKNOWN after a MOCK POST timeout and never resends across a new coordinator instance',async()=>{
 const f=await ready();await f.cards().prepare(f.owner,f.command);f.controls.afterCreate=async()=>{throw new AppError('CONFLICT');};const result=await f.cards().createCheckout(f.owner,f.quote.id,f.command.operationId);expect(result.state).toBe('unknown');expect(f.controls.modeledPosts).toBe(1);const stored=await rows(f);
 expect(await f.cards().createCheckout(f.owner,f.quote.id,f.command.operationId)).toEqual(result);expect(await rows(f)).toEqual(stored);expect(f.created).toHaveBeenCalledTimes(1);expect((await view(f)).balance.paidMinor).toBe(0);
});
it('provider-boundary-v4 missing SDK or effect authority denies before reserving UNKNOWN',async()=>{
 const f=await ready();await f.cards().prepare(f.owner,f.command);const before=await rows(f);await expect(f.cards(null).createCheckout(f.owner,f.quote.id,f.command.operationId)).rejects.toThrow('UNAVAILABLE');await expect(f.cards(f.provider,f.reservation,null).createCheckout(f.owner,f.quote.id,f.command.operationId)).rejects.toThrow('UNAVAILABLE');expect(await rows(f)).toEqual(before);expect(f.created).not.toHaveBeenCalled();
});
it('provider-boundary-v4 reservation permission cannot substitute for independent creation admission',async()=>{
 const f=await ready();await f.cards().prepare(f.owner,f.command);await engine.query('UPDATE synthetic_owner_card4.service SET create_allowed=false WHERE workspace_id=$1',[f.workspace]);const result=await f.cards().createCheckout(f.owner,f.quote.id,f.command.operationId);expect(result.state).toBe('unknown');expect(f.controls.terminalAuthorizations).toBe(1);expect(f.created).not.toHaveBeenCalled();expect(f.controls.modeledPosts).toBe(0);
});
it('provider-boundary-v4 rechecks native admission at the modeled pre-POST point instead of caching the earlier decision',async()=>{
 const f=await ready();await f.cards().prepare(f.owner,f.command);const cards=f.cards();f.controls.beforeCreate=async r=>{await cards.checkoutAdmission().authorize(sdkEffect(r));await engine.query('UPDATE synthetic_owner_card4.service SET create_allowed=false WHERE workspace_id=$1',[f.workspace]);await cards.checkoutAdmission().authorize(sdkEffect(r));};
 expect((await cards.createCheckout(f.owner,f.quote.id,f.command.operationId)).state).toBe('unknown');expect(f.created).toHaveBeenCalledTimes(1);expect(f.controls.modeledPosts).toBe(0);expect((await view(f)).balance.receipts).toHaveLength(0);
});
it.each(['account','amount','url','no_payment_required'] as const)('provider-boundary-v4 retains UNKNOWN on a mismatched %s result without claiming a rejected charge',async field=>{
 const f=await ready();await f.cards().prepare(f.owner,f.command);if(field==='account')f.controls.sessionPatch.accountId='acct_WRONG';if(field==='amount')f.controls.sessionPatch.amountMinor=1;if(field==='url')f.controls.sessionPatch.url='https://example.invalid/not-checkout';if(field==='no_payment_required')f.controls.sessionPatch.paymentStatus='no_payment_required';
 const result=await f.cards().createCheckout(f.owner,f.quote.id,f.command.operationId);expect(result.state).toBe('unknown');expect(result.sessionId).toBeNull();expect((await view(f)).balance.paidMinor).toBe(0);expect(f.created).toHaveBeenCalledTimes(1);
});
it('provider-boundary-v4 a paid session response alone is still unpaid in the native ledger',async()=>{
 const f=await ready();await f.cards().prepare(f.owner,f.command);f.controls.sessionPatch.paymentStatus='paid';expect((await f.cards().createCheckout(f.owner,f.quote.id,f.command.operationId)).state).toBe('open');expect((await view(f)).balance).toMatchObject({paidMinor:0,state:'unpaid'});
});
it.each(['before_commit','after_commit'] as const)('provider-boundary-v4 %s result-write failure remains uncertain and readback never creates another session',async point=>{
 const f=await ready();await f.cards().prepare(f.owner,f.command);f.controls.resultFails=point==='before_commit';f.controls.resultPostCommit=point==='after_commit';await expect(f.cards().createCheckout(f.owner,f.quote.id,f.command.operationId)).rejects.toThrow('UNAVAILABLE');f.controls.resultFails=false;
 const saved=await rows(f),attempt=await f.cards().readAttempt(f.owner,f.quote.id,f.command.operationId);expect(attempt.state).toBe(point==='after_commit'?'open':'unknown');expect(await f.cards().createCheckout(f.owner,f.quote.id,f.command.operationId)).toEqual(attempt);expect(await rows(f)).toEqual(saved);expect(f.created).toHaveBeenCalledTimes(1);expect((await view(f)).balance.paidMinor).toBe(0);
});
it.each(['cash','cancel'] as const)('provider-boundary-v4 late %s after modeled creation retains the remote session under review and blocks another payment attempt',async change=>{
 const f=await ready();await f.cards().prepare(f.owner,f.command);f.controls.afterCreate=async()=>{if(change==='cash')await f.billingOwner.recordCashDate(f.owner,{version:BILLING_SERVICE_V4,operationId:randomUUID(),quoteId:f.quote.id,expectedVersion:5,amountMinor:30000,currency:'USD',receivedPrecision:'date',receivedDate:'2035-01-02',timeZone:'America/New_York',allocations:[{lineId:f.quote.lines[0]!.id,amountMinor:30000}]});else await f.billingOwner.setState(f.owner,{version:BILLING_SERVICE_V4,action:SERVICE_STATE_ACTION_V4,operationId:randomUUID(),quoteId:f.quote.id,expectedQuoteRevision:5,cancel:true});};
 const result=await f.cards().createCheckout(f.owner,f.quote.id,f.command.operationId);expect(result.state).toBe('review_required');expect(result.sessionId).toEqual(expect.any(String));const current=await view(f);expect(current.balance.state).toBe('review_required');expect(current.balance.paidMinor).toBe(change==='cash'?30000:0);expect(current.quote.state).toBe(change==='cancel'?'cancelled':'accepted');
 await expect(f.cards().prepare(f.owner,{...f.command,operationId:randomUUID(),expectedVersion:current.quote.revision})).rejects.toThrow('UNAVAILABLE');expect(f.created).toHaveBeenCalledTimes(1);
});
it('provider-boundary-v4 an authenticated-capability MOCK event before the session response is never downgraded by result storage',async()=>{
 const f=await ready();await f.cards().prepare(f.owner,f.command);f.controls.afterCreate=async r=>{
  const eventId='evt_'+randomUUID().replaceAll('-',''),bytes=Buffer.from('SYNTHETIC-EARLY-EVENT-'+eventId),snapshot:ProviderPaymentSnapshot={accountId:f.binding.accountId,livemode:false,apiVersion:f.binding.apiVersion,quoteId:r.quoteId,attemptId:r.operationId,sessionId:'cs_'+r.operationId.replaceAll('-',''),paymentIntentId:'pi_'+r.operationId.replaceAll('-',''),currency:'USD',amountMinor:r.amountMinor,receivedMinor:r.amountMinor,status:'paid',method:'card',paidAt:f.clock.now().toISOString(),observedAt:f.clock.now().toISOString(),refunds:[],dispute:'none'};
  const receipt={eventId,eventType:'payment_intent.succeeded' as const,objectId:snapshot.paymentIntentId,providerAccountId:f.binding.accountId,livemode:false as const,apiVersion:f.binding.apiVersion,digest:createHash('sha256').update(bytes).digest('hex'),createdAt:f.clock.now().toISOString()};const cap=verifyBillingStripeTestEvent({rawBody:bytes,signatureHeader:'MOCK-NOT-STRIPE',binding:f.binding,now:f.clock.now(),sdk:{verify:()=>({kind:'stripe_test_signature_only',receipt})}});await new FishingBillingStripeInbox(f.db,f.workspace,programRing,f.clock,f.inbox).ingest(cap);f.snapshots.set(eventId,snapshot);await f.cards().processEvent(eventId);
 };
 expect((await f.cards().createCheckout(f.owner,f.quote.id,f.command.operationId)).state).toBe('paid');const current=await view(f);expect(current.balance).toMatchObject({state:'paid',paidMinor:130000,pendingAttemptIds:[]});expect(current.balance.receipts).toHaveLength(1);expect(f.created).toHaveBeenCalledTimes(1);
});
it('provider-boundary-v4 an existing UNKNOWN and raw effect data cannot mint an active SDK dispatch',async()=>{
 const f=await ready();await f.cards().prepare(f.owner,f.command);const reserved=await f.cards().reserveCheckout(f.owner,f.quote.id,f.command.operationId);if(!reserved.dispatch)throw Error('EXPECTED_RESERVATION');const before=await rows(f);await expect(f.cards().checkoutAdmission().authorize(sdkEffect(reserved.request))).rejects.toThrow('UNAVAILABLE');expect((await f.cards().createCheckout(f.owner,f.quote.id,f.command.operationId)).state).toBe('unknown');expect(await rows(f)).toEqual(before);expect(f.created).not.toHaveBeenCalled();
});
it('provider-boundary-v4 rejects a mutated effect authority clock before invoking the provider port',async()=>{
 const f=await ready();await f.cards().prepare(f.owner,f.command);f.controls.effectClock=true;expect((await f.cards().createCheckout(f.owner,f.quote.id,f.command.operationId)).state).toBe('unknown');expect(f.created).not.toHaveBeenCalled();expect((await view(f)).balance.paidMinor).toBe(0);
});
it('provider-boundary-v4 rejects a cryptographically re-signed changed request while the original dispatch is active',async()=>{
 const f=await ready();await f.cards().prepare(f.owner,f.command);const cards=f.cards();f.controls.beforeCreate=async r=>{const changed=await request(f);changed.request.params.integration_identifier='jlfa_monthly_zzzzzzzz';changed.digest=createHmac('sha256',Buffer.from(programKey)).update(canonical(changed.request)).digest('hex');await engine.query('UPDATE ls_fishing_billing.card_attempt_requests SET payload_ciphertext=$3 WHERE workspace_id=$1 AND attempt_id=$2',[f.workspace,r.operationId,seal(JSON.stringify(changed),'ls_fishing_billing/card/v1/checkout_request/'+f.workspace+'/'+r.operationId,programRing)]);await cards.checkoutAdmission().authorize(sdkEffect(r));};
 expect((await cards.createCheckout(f.owner,f.quote.id,f.command.operationId)).state).toBe('unknown');expect(f.controls.modeledPosts).toBe(0);expect((await view(f)).balance.receipts).toHaveLength(0);
});
it('provider-boundary-v4 overlapping calls reuse the committed UNKNOWN while only its original in-flight call proceeds',async()=>{
 const f=await ready();await f.cards().prepare(f.owner,f.command);let release=()=>{},entered=()=>{};const gate=new Promise<void>(r=>{release=r;}),started=new Promise<void>(r=>{entered=r;});f.controls.afterCreate=async()=>{entered();await gate;};const cards=f.cards(),first=cards.createCheckout(f.owner,f.quote.id,f.command.operationId);await started;
 const second=await cards.createCheckout(f.owner,f.quote.id,f.command.operationId);expect(second.state).toBe('unknown');expect(f.created).toHaveBeenCalledTimes(1);release();expect((await first).state).toBe('open');expect(f.created).toHaveBeenCalledTimes(1);expect(f.controls.modeledPosts).toBe(1);
 // Queued memory transactions and a controlled MOCK response: not real PG
 // multi-connection or provider concurrency evidence.
});
it('provider-boundary-v4 SDK admission paired with a different instance cannot reuse the active dispatch capability',async()=>{
 const f=await ready();await f.cards().prepare(f.owner,f.command);const wrong=f.cards();f.controls.beforeCreate=async r=>wrong.checkoutAdmission().authorize(sdkEffect(r));expect((await f.cards().createCheckout(f.owner,f.quote.id,f.command.operationId)).state).toBe('unknown');expect(f.controls.modeledPosts).toBe(0);expect((await view(f)).balance.paidMinor).toBe(0);
});
