import {randomUUID,createHmac} from 'node:crypto';
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
import {readServiceAcceptanceDataV4} from '../../src/features/fishing-billing/guest-service-acceptance-data-v4.ts';
import {serviceGuestAadV4} from '../../src/features/fishing-billing/guest-service-aad-v4.ts';
import {dateCashReceiptSchema} from '../../src/features/fishing-billing/contracts-v2.ts';
import {BILLING_SERVICE_V4} from '../../src/features/fishing-billing/guest-service-contract-v4.ts';
import {SERVICE_STATE_ACTION_V4,serviceStateOutcomeV4Schema} from '../../src/features/fishing-billing/guest-service-owner-state-contract-v4.ts';
import {readServicePreAcceptanceStateV4} from '../../src/features/fishing-billing/guest-service-state-data-v4.ts';
import {BILLING_DTO_VERSION,reminderIntentSchema} from '../../src/features/fishing-billing/contracts.ts';
import {cardAttemptSchema,CARD_VERSION} from '../../src/features/fishing-billing/card-contracts.ts';
import {canonical} from '../../src/features/contact-ops/core/validation.ts';
import {seal,unseal} from '../../src/features/identity/crypto.ts';
import {AppError} from '../../src/lib/errors.ts';
import type {IdentityStore,SqlSession} from '../../src/features/identity/store.ts';
vi.mock('server-only',()=>({}));
let engine:PGlite;const network=vi.fn(async()=>{throw Error('NO_NETWORK');});
beforeAll(async()=>{requirePgliteMemoryEnvironment(process.env);vi.stubGlobal('fetch',network);engine=new PGlite();await initializeProgramSchema(engine);
 for(const name of ['UNNUMBERED_ls_fishing_fulfillment_v1.sql','UNNUMBERED_ls_fishing_service_material_v4.sql','UNNUMBERED_ls_fishing_quote_service_v4.sql','UNNUMBERED_ls_fishing_service_money_v4.sql','UNNUMBERED_ls_fishing_service_state_v4.sql'])await engine.exec(await readFile('migrations/proposals/'+name,'utf8'));},20000);
afterEach(()=>{expect(network).not.toHaveBeenCalled();});afterAll(async()=>{try{await engine?.close();}finally{vi.unstubAllGlobals();}});
// Genuine configured-owner/session/native family/source/issuer/consumer/SQL and
// crypto. Grants and money/attempt/intent examples are RAW SEEDED synthetic
// records; legal/global-capacity permission ports explicitly unapproved.
// No real cash/provider/send/guest issuance or ordinary PostgreSQL competition.
async function ready(accept=true){
 const f=await serviceGuestFixtureV4(engine),guest=()=>new FishingServiceGuestNativeV4(f.db,f.workspace,programRing,programKey,f.commandKey,f.clock,f.resolver());
 const receipt=accept?await guest().acceptFinancialOffer(f.token,f.command):null;
 const flags={denyTarget:false,denyRead:false,changeClock:false,terminalRevoke:false,reads:0},ledgerKey=Buffer.from(programKey);
 const authority:ServiceOwnerFinancialAuthorityV4={target:async()=>{if(flags.denyTarget)throw new AppError('FORBIDDEN');},authorize:async(c,scope)=>{
  flags.reads++;if(flags.denyRead)throw new AppError('FORBIDDEN');if(scope.familyId!==f.quote.familyId)throw new AppError('FORBIDDEN');
  if(flags.changeClock)c.now.setTime(c.now.valueOf()+86_400_000);
  if(flags.terminalRevoke&&flags.reads>=2)await c.tx.query('UPDATE ls_identity.sessions SET revoked_at=$2 WHERE token_digest=$1',[f.owner.sessionDigest,f.clock.now()]);
 }};
 const store=(db=f.db,commandKey=f.commandKey,permission=authority)=>new FishingServiceBillingOwnerV4(f.workspace,new FishingProgramSourceNativeV3(db,f.workspace,programRing,programKey,f.owner.id,f.clock),
  new FishingBillingInquiryFamilyProposals(db,f.workspace,programRing,programKey,f.clock),programRing,programKey,commandKey,ledgerKey,f.clock,permission);
 return {...f,guest,receipt,ownerFlags:flags,store,ledgerKey,authority};
}
type Fixture=Awaited<ReturnType<typeof ready>>;
async function rawCash(f:Fixture,amount=30000){
 const r=dateCashReceiptSchema.parse({id:randomUUID(),operationId:randomUUID(),quoteId:f.quote.id,familyId:f.quote.familyId,currency:'USD',kind:'cash',amountMinor:amount,
  allocations:[{lineId:f.quote.lines[0]!.id,amountMinor:20000},{lineId:f.quote.lines[1]!.id,amountMinor:10000}],originalReceiptId:null,actorId:f.owner.id,receivedPrecision:'date',receivedDate:'2035-01-02',timeZone:'America/New_York',recordedAt:f.clock.now().toISOString(),reason:null,provider:null});
 await engine.query('INSERT INTO ls_fishing_billing.receipts(workspace_id,id,quote_id,operation_id,original_receipt_id,payload_ciphertext,recorded_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
  [f.workspace,r.id,r.quoteId,r.operationId,null,seal(JSON.stringify(r),'ls_fishing_billing/v1/receipt/'+f.workspace+'/'+r.id,programRing),r.recordedAt]);return r;
}
it('service-owner-v4 reads an original acceptance after guest expiry/revocation using actual owner session and retains original consent bytes',async()=>{
 const f=await ready();if(!f.receipt)throw Error('EXPECTED_ACCEPTANCE');
 const before=(await engine.query('SELECT evidence_ciphertext FROM ls_fishing_billing.guest_financial_acceptances WHERE workspace_id=$1',[f.workspace])).rows;
 f.flags.now=new Date('2035-04-01T17:00:00Z');
 const programme=new FishingProgramSourceNativeV3(f.db,f.workspace,programRing,programKey,f.owner.id,f.clock),withdrawn=f.progression(0,'2035-01-31T00:00:00Z','needs_foundation',1),group=f.group();
 await programme.record(f.owner,{...withdrawn,fields:{...withdrawn.fields as object,state:'withdrawn'}});
 await programme.record(f.owner,{...group,expectedRevision:1,fields:{...group.fields as object,state:'cancelled'}});
 const gr=(await engine.query<{ciphertext:string}>('SELECT payload_ciphertext AS ciphertext FROM ls_fishing_billing.guest_grants WHERE workspace_id=$1',[f.workspace])).rows[0]!;
 const l=JSON.parse(unseal(gr.ciphertext,serviceGuestAadV4('grant',f.workspace,f.grant.id),programRing));l.state='revoked';l.revokedAt='2035-01-02T16:30:00.000Z';
 await engine.query("UPDATE ls_fishing_billing.guest_grants SET state='revoked',payload_ciphertext=$2 WHERE workspace_id=$1",[f.workspace,seal(JSON.stringify(l),serviceGuestAadV4('grant',f.workspace,f.grant.id),programRing)]);
 await expect(f.guest().acceptFinancialOffer(f.token,f.command)).rejects.toThrow('UNAVAILABLE');
 expect(await f.store().readOriginalAcceptance(f.owner,f.quote.id,f.command.operationId)).toEqual(f.receipt);
 expect((await f.store().readSnapshot(f.owner,f.quote.id)).balance).toMatchObject({state:'unpaid',dueMinor:130000,remainingMinor:130000});
 expect((await engine.query('SELECT evidence_ciphertext FROM ls_fishing_billing.guest_financial_acceptances WHERE workspace_id=$1',[f.workspace])).rows).toEqual(before);
 expect((await engine.query('SELECT state FROM ls_fishing_billing.guest_grants WHERE workspace_id=$1',[f.workspace])).rows).toEqual([{state:'revoked'}]);
});
it('service-owner-v4 uses the existing money calculator with explicit child periods and date-only receipt precision',async()=>{
 const f=await ready();await rawCash(f);const result=await f.store().readSnapshot(f.owner,f.quote.id);
 expect(result.version).toBe(BILLING_SERVICE_V4);expect(result.balance).toMatchObject({state:'partial',dueMinor:130000,paidMinor:30000,remainingMinor:100000});
 expect(result.balance.lines.map(l=>[l.childId,l.period.startsAt,l.period.endsAt,l.paidMinor])).toEqual(f.quote.lines.map((l,i)=>[l.childId,l.period.startsAt,l.period.endsAt,i===0?20000:10000]));
 expect(result.balance.receipts[0]).toMatchObject({receivedPrecision:'date',receivedDate:'2035-01-02'});expect('receivedAt' in result.balance.receipts[0]!).toBe(false);
});
it('service-owner-v4 preserves unaccepted no-debt and refuses orphan obligations instead of inventing a financial acceptance',async()=>{
 const f=await ready(false),before=await f.store().readSnapshot(f.owner,f.quote.id);expect(before.balance).toMatchObject({state:'no_debt',dueMinor:0,quotedMinor:130000});
 const l=f.quote.lines[0]!;await engine.query('INSERT INTO ls_fishing_billing.obligations VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[f.workspace,f.quote.id,l.id,f.quote.familyId,l.childId,l.period.id,l.period.startsAt,l.period.endsAt]);
 await expect(f.store().readSnapshot(f.owner,f.quote.id)).rejects.toThrow('UNAVAILABLE');
});
it('service-owner-v4 denies parent foreign demo inactive and invalid-session reads through the existing actual owner guard',async()=>{
 const f=await ready(),other=await ready();
 await expect(f.store().readSnapshot(f.parent,f.quote.id)).rejects.toThrow('FORBIDDEN');
 await expect(f.store().readSnapshot(other.owner,f.quote.id)).rejects.toThrow('FORBIDDEN');
 await expect(f.store().readSnapshot({...f.owner,sessionDigest:'f'.repeat(64)},f.quote.id)).rejects.toThrow();
 await engine.query('INSERT INTO ls_demo.batches(workspace_id,batch_id,created_by) VALUES($1,$2,$3)',[f.workspace,'ls-owner-20350102',f.owner.id]);
 await engine.query('INSERT INTO ls_demo.accounts(workspace_id,account_id,batch_id,source_key) VALUES($1,$2,$3,$4)',[f.workspace,f.owner.id,'ls-owner-20350102','SYNTHETIC-owner-history']);
 await expect(f.store().readSnapshot(f.owner,f.quote.id)).rejects.toThrow('FORBIDDEN');
 await engine.query("UPDATE ls_identity.accounts SET state='revoked' WHERE workspace_id=$1 AND id=$2",[other.workspace,other.owner.id]);
 await expect(other.store().readSnapshot(other.owner,other.quote.id)).rejects.toThrow();
});
it('service-owner-v4 checks target before private data and rechecks terminal session and actual current native family membership',async()=>{
 const f=await ready();let privateReads=0;
 const db:IdentityStore={transaction:work=>f.db.transaction(tx=>work({query:async<R extends object>(sql:string,v:readonly unknown[]=[])=>{
  if(sql.includes('FROM ls_fishing_billing.quotes'))privateReads++;return tx.query<R>(sql,v);
 }}))};
 f.ownerFlags.denyTarget=true;await expect(f.store(db).readSnapshot(f.owner,f.quote.id)).rejects.toThrow('FORBIDDEN');expect(privateReads).toBe(0);f.ownerFlags.denyTarget=false;
 f.ownerFlags.terminalRevoke=true;await expect(f.store().readSnapshot(f.owner,f.quote.id)).rejects.toThrow();f.ownerFlags.terminalRevoke=false;f.ownerFlags.reads=0;
 await engine.query('DELETE FROM ls_cases.family_members WHERE workspace_id=$1 AND family_id=$2 AND person_id=$3',[f.workspace,f.quote.familyId,f.quote.lines[0]!.childId]);
 await expect(f.store().readSnapshot(f.owner,f.quote.id)).rejects.toThrow();
});
it('service-owner-v4 fails closed on altered command HMAC or original-operation mismatch without resolving a different UNKNOWN',async()=>{
 const f=await ready();await expect(f.store(f.db,Buffer.alloc(32,99)).readSnapshot(f.owner,f.quote.id)).rejects.toThrow('UNAVAILABLE');
 await expect(f.store().readOriginalAcceptance(f.owner,f.quote.id,randomUUID())).rejects.toThrow('UNAVAILABLE');
 expect((await f.store().readOriginalAcceptance(f.owner,f.quote.id,f.command.operationId)).operationId).toBe(f.command.operationId);
});
it('service-owner-v4 keeps actual unresolved card and unknown reminder rows visible without inferring payment or retrying delivery',async()=>{
 const f=await ready(),id=randomUUID(),op=randomUUID(),allocations=[{lineId:f.quote.lines[0]!.id,amountMinor:65000}];
 const a=cardAttemptSchema.parse({version:CARD_VERSION,id,workspaceId:f.workspace,quoteId:f.quote.id,familyId:f.quote.familyId,actorId:f.owner.id,revision:1,balanceVersion:3,
  binding:{accountId:'acct_SYNTHETIC',livemode:false,apiVersion:'2026-09-30.endive',verifiedBindingId:'SYNTHETIC-NO-PROVIDER'},command:{operationId:op,quoteId:f.quote.id,expectedVersion:3,selection:allocations},requestDigest:'a'.repeat(64),
  preparation:{version:CARD_VERSION,operationId:op,quoteId:f.quote.id,entityVersion:3,replayed:false,result:{attemptId:id,amountMinor:65000,allocations}},createdAt:f.clock.now().toISOString(),state:'unknown',dispatchId:randomUUID(),sessionId:null,checkoutUrl:null,paymentIntentId:null});
 await engine.query('INSERT INTO ls_fishing_billing.card_attempts VALUES($1,$2,$3,$4,$5,$6)',[f.workspace,id,f.quote.id,1,'unknown',seal(JSON.stringify(a),'ls_fishing_billing/card/v1/attempt/'+f.workspace+'/'+id,programRing)]);
 const i=reminderIntentSchema.parse({version:BILLING_DTO_VERSION,id:randomUUID(),key:'SYNTHETIC-UNKNOWN-INTENT',quoteId:f.quote.id,familyId:f.quote.familyId,guardianId:randomUUID(),channel:'email',audience:'individual',locale:'he',policyId:'SYNTHETIC',policyRevision:1,sequence:0,
  dueAt:f.quote.lines[0]!.dueAt,scheduledAt:f.clock.now().toISOString(),state:'unknown',dispatchId:randomUUID(),providerId:null,reason:null});
 const hash=(v:unknown)=>createHmac('sha256',f.ledgerKey).update(canonical(v)).digest('hex');
 await engine.query('INSERT INTO ls_fishing_billing.reminders VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[f.workspace,i.id,f.quote.id,hash({key:i.key}),'unknown',seal(JSON.stringify(i),'ls_fishing_billing/v1/reminder/'+f.workspace+'/'+i.id,programRing),'SYNTHETIC-NOT-A-POLICY',i.scheduledAt,hash({quoteId:f.quote.id,guardianId:i.guardianId})]);
 const view=await f.store().readSnapshot(f.owner,f.quote.id);expect(view.balance.pendingAttemptIds).toEqual([id]);expect(view.balance.reminders).toEqual([{id:i.id,state:'unknown'}]);expect(view.balance.paidMinor).toBe(0);
 const originalCard=(await engine.query('SELECT * FROM ls_fishing_billing.card_attempts WHERE workspace_id=$1',[f.workspace])).rows;
 expect((await f.store().recordCashDate(f.owner,cash(f))).state).toBe('committed');
 const afterCash=await f.store().readSnapshot(f.owner,f.quote.id);expect(afterCash.balance.pendingAttemptIds).toEqual([id]);expect(afterCash.balance.reminders).toEqual([{id:i.id,state:'unknown'}]);expect(afterCash.balance.paidMinor).toBe(30000);
 expect((await engine.query('SELECT * FROM ls_fishing_billing.card_attempts WHERE workspace_id=$1',[f.workspace])).rows).toEqual(originalCard);
 const claimedPaid={...a,state:'paid'};await engine.query("UPDATE ls_fishing_billing.card_attempts SET state='paid',payload_ciphertext=$3 WHERE workspace_id=$1 AND id=$2",[f.workspace,id,seal(JSON.stringify(claimedPaid),'ls_fishing_billing/card/v1/attempt/'+f.workspace+'/'+id,programRing)]);
 expect((await f.store().readSnapshot(f.owner,f.quote.id)).balance).toMatchObject({state:'review_required',paidMinor:30000});
});
it('service-owner-v4 authenticates failed/nonselected rows and rejects truncated data instead of silently dropping uncertainty',async()=>{
 const f=await ready();await rawCash(f);
 const db:IdentityStore={transaction:work=>f.db.transaction(tx=>work({query:async<R extends object>(sql:string,v:readonly unknown[]=[])=>{
  const rows=await tx.query<R>(sql,v);return sql.includes('FROM ls_fishing_billing.receipts')?Array.from({length:1001},()=>rows[0]!):rows;
 }}))};
 await expect(f.store(db).readSnapshot(f.owner,f.quote.id)).rejects.toThrow('UNAVAILABLE');
 const bad:IdentityStore={transaction:work=>f.db.transaction(tx=>work({query:async<R extends object>(sql:string,v:readonly unknown[]=[])=>{
  const rows=await tx.query<R>(sql,v);return sql.includes('FROM ls_fishing_billing.receipts')?rows.map(r=>({...r,ciphertext:'CORRUPT'})):rows;
 }}))};
 await expect(f.store(bad).readSnapshot(f.owner,f.quote.id)).rejects.toThrow('UNAVAILABLE');
});
it('service-owner-v4 rejects authority clock mutation without returning a view',async()=>{
 const f=await ready();f.ownerFlags.changeClock=true;await expect(f.store().readSnapshot(f.owner,f.quote.id)).rejects.toThrow('UNAVAILABLE');
});
it.each(['query','clock','workspace'] as const)('service-owner-v4 shared original data pins %s across awaited SQL without exposing an alternative context',async change=>{
 const f=await ready();let foreignCalls=0;
 await f.db.transaction(async tx=>{
  const c={workspaceId:f.workspace,now:f.clock.now(),tx:{query:tx.query.bind(tx)} as SqlSession};const initial=c.tx.query;
  c.tx.query=async<R extends object>(sql:string,v:readonly unknown[]=[])=>{
   const rows=await initial<R>(sql,v);
   if(change==='query')c.tx.query=async()=>{foreignCalls++;return [];};else if(change==='clock')c.now.setTime(c.now.valueOf()+86_400_000);else c.workspaceId='00000000-0000-4000-8000-000000000000' as typeof f.workspace;
   return rows;
  };
  await expect(readServiceAcceptanceDataV4(c,f.workspace,f.quote.id,programRing,programKey,f.commandKey)).rejects.toThrow('UNAVAILABLE');expect(foreignCalls).toBe(0);
 });
});

function cash(f:Fixture,amount=30000,expectedVersion=3){return {version:BILLING_SERVICE_V4,operationId:randomUUID(),quoteId:f.quote.id,expectedVersion,currency:'USD' as const,amountMinor:amount,receivedPrecision:'date' as const,receivedDate:'2035-01-02',timeZone:'America/New_York' as const,allocations:[{lineId:f.quote.lines[0]!.id,amountMinor:amount}]};}
async function facts(f:Fixture){return {
 receipts:(await engine.query('SELECT * FROM ls_fishing_billing.receipts WHERE workspace_id=$1 ORDER BY id',[f.workspace])).rows,
 quote:(await engine.query('SELECT * FROM ls_fishing_billing.quotes WHERE workspace_id=$1',[f.workspace])).rows,
 commands:(await engine.query('SELECT * FROM ls_fishing_billing.commands WHERE workspace_id=$1 ORDER BY operation_id',[f.workspace])).rows,
 acceptance:(await engine.query('SELECT * FROM ls_fishing_billing.guest_financial_acceptances WHERE workspace_id=$1',[f.workspace])).rows,
 grants:(await engine.query('SELECT * FROM ls_fishing_billing.guest_grants WHERE workspace_id=$1',[f.workspace])).rows,
};}
it('service-owner-v4 records actual command date cash in the same immutable ledger without changing original grant or acceptance',async()=>{
 const f=await ready(),before=await facts(f),command=cash(f),outcome=await f.store().recordCashDate(f.owner,command);
 expect(outcome.state).toBe('committed');if(outcome.state!=='committed')throw Error('EXPECTED_COMMIT');
 expect(outcome.result).toMatchObject({operationId:command.operationId,entityVersion:4,replayed:false,actorId:f.owner.id,result:{kind:'operation_snapshot',balance:{paidMinor:30000,remainingMinor:100000},receipt:{receivedPrecision:'date',receivedDate:'2035-01-02',provider:null}}});
 expect('receivedAt' in outcome.result.result.receipt).toBe(false);
 const view=await f.store().readSnapshot(f.owner,f.quote.id);expect(view.balance.lines.map(l=>l.paidMinor)).toEqual([30000,0]);expect(view.balance.receipts).toHaveLength(1);
 const after=await facts(f);expect(after.acceptance).toEqual(before.acceptance);expect(after.grants).toEqual(before.grants);expect(after.commands).toHaveLength(before.commands.length+1);
});
it('service-owner-v4 replays exact original cash after a correction and later money without relabelling its original balance as current',async()=>{
 const f=await ready(),command=cash(f),first=await f.store().recordCashDate(f.owner,command);if(first.state!=='committed')throw Error('EXPECTED_COMMIT');
 const receipt=first.result.result.receipt,correction={version:BILLING_SERVICE_V4,operationId:randomUUID(),quoteId:f.quote.id,expectedVersion:4,originalReceiptId:receipt.id,amountMinor:10000,allocations:[{lineId:f.quote.lines[0]!.id,amountMinor:10000}],reason:'Synthetic duplicate cash entry correction'};
 const corrected=await f.store().reverseCash(f.owner,correction);expect(corrected.state).toBe('committed');if(corrected.state!=='committed')throw Error('EXPECTED_COMMIT');
 expect(corrected.result.result).toMatchObject({balance:{paidMinor:20000},originalCashReceipt:receipt,receipt:{kind:'cash_reversal',originalReceiptId:receipt.id,provider:null}});
 await f.store().recordCashDate(f.owner,cash(f,5000,5));
 const count=(await facts(f)).receipts.length,replay=await f.store().recordCashDate(f.owner,command);expect(replay).toEqual({...first,result:{...first.result,replayed:true}});
 expect(await f.store().readMoneyOperation(f.owner,{action:'cash_date',command})).toEqual({...first.result,replayed:true});
 expect((await f.store().readSnapshot(f.owner,f.quote.id)).balance.paidMinor).toBe(25000);expect((await facts(f)).receipts.length).toBe(count);
 expect(await f.store().readMoneyOperation(f.owner,{action:'cash_date',command:{...command,operationId:randomUUID()}})).toBeNull();
});
it('service-owner-v4 refuses changed exact-operation input and collisions with the immutable issuer without another receipt',async()=>{
 const f=await ready(),command=cash(f);await f.store().recordCashDate(f.owner,command);const before=await facts(f);
 expect(await f.store().recordCashDate(f.owner,{...command,amountMinor:40000})).toMatchObject({state:'rejected_current_attempt',code:'CONFLICT'});
 const original=(await engine.query<{id:string}>("SELECT operation_id AS id FROM ls_fishing_billing.commands WHERE workspace_id=$1 AND action='guest_service_issue_v4'",[f.workspace])).rows[0]!;
 expect(await f.store().recordCashDate(f.owner,{...command,operationId:original.id})).toMatchObject({state:'rejected_current_attempt',code:'CONFLICT'});
 await expect(f.store().readMoneyOperation(f.owner,{action:'cash_date',command:{...command,receivedDate:'2035-01-01'}})).rejects.toThrow('CONFLICT');
 expect(await facts(f)).toEqual(before);
});
it('service-owner-v4 refuses stale unaccepted future pre-acceptance and sibling-overallocated cash without writing',async()=>{
 const f=await ready(),before=await facts(f),command=cash(f);
 for(const [change,code] of [[{expectedVersion:2},'CONFLICT'],[{receivedDate:'2035-01-03'},'INVALID_REQUEST'],[{receivedDate:'2035-01-01'},'INVALID_REQUEST'],[{amountMinor:65001,allocations:[{lineId:f.quote.lines[0]!.id,amountMinor:65001}]},'INVALID_REQUEST']] as const){
  expect(await f.store().recordCashDate(f.owner,{...command,...change})).toMatchObject({state:'rejected_current_attempt',code});expect(await facts(f)).toEqual(before);
 }
 const unaccepted=await ready(false),original=await facts(unaccepted);expect(await unaccepted.store().recordCashDate(unaccepted.owner,cash(unaccepted,100,2))).toMatchObject({state:'rejected_current_attempt',code:'CONFLICT'});expect(await facts(unaccepted)).toEqual(original);
});
it('service-owner-v4 preserves explicit unallocated excess and enforces original cash correction ceilings with the one calculator',async()=>{
 const f=await ready(),command={...cash(f,35000),allocations:[{lineId:f.quote.lines[0]!.id,amountMinor:30000}]},out=await f.store().recordCashDate(f.owner,command);if(out.state!=='committed')throw Error('EXPECTED_COMMIT');
 expect(out.result.result.balance).toMatchObject({paidMinor:30000,unallocatedMinor:5000,excessMinor:5000});
 const reversal={version:BILLING_SERVICE_V4,operationId:randomUUID(),quoteId:f.quote.id,expectedVersion:4,originalReceiptId:out.result.result.receipt.id,amountMinor:6000,allocations:[],reason:'Synthetic correction'},before=await facts(f);
 expect(await f.store().reverseCash(f.owner,reversal)).toMatchObject({state:'rejected_current_attempt',code:'INVALID_REQUEST'});expect(await facts(f)).toEqual(before);
 const corrected=await f.store().reverseCash(f.owner,{...reversal,amountMinor:5000});expect(corrected.state).toBe('committed');
 const after=await facts(f);expect(await f.store().reverseCash(f.owner,{...reversal,operationId:randomUUID(),expectedVersion:5,amountMinor:1})).toMatchObject({state:'rejected_current_attempt',code:'INVALID_REQUEST'});expect(await facts(f)).toEqual(after);
});
it('service-owner-v4 requires separate actual cash authority and real current owner rather than read permission or guest acceptance',async()=>{
 const f=await ready(),command=cash(f),before=await facts(f),permission:ServiceOwnerFinancialAuthorityV4={...f.authority,authorize:async(c,scope)=>{await f.authority.authorize(c,scope);if(scope.action!=='read')throw new AppError('FORBIDDEN');}};
 expect((await f.store(f.db,f.commandKey,permission).readSnapshot(f.owner,f.quote.id)).balance.state).toBe('unpaid');
 expect(await f.store(f.db,f.commandKey,permission).recordCashDate(f.owner,command)).toMatchObject({state:'rejected_current_attempt',code:'FORBIDDEN'});
 expect(await f.store().recordCashDate(f.parent,command)).toMatchObject({state:'rejected_current_attempt',code:'FORBIDDEN'});
 expect(await facts(f)).toEqual(before);
});
it('service-owner-v4 rolls back receipt quote and journal together on a genuine callback failure after all writes',async()=>{
 const f=await ready(),before=await facts(f),command=cash(f);let reached=false;
 const db:IdentityStore={transaction:work=>f.db.transaction(tx=>work({query:async<R extends object>(sql:string,v:readonly unknown[]=[])=>{
  const rows=await tx.query<R>(sql,v);if(sql.startsWith('INSERT INTO ls_fishing_billing.commands')){reached=true;throw new AppError('FORBIDDEN');}return rows;
 }}))};
 expect(await f.store(db).recordCashDate(f.owner,command)).toMatchObject({state:'rejected_current_attempt',code:'FORBIDDEN'});expect(reached).toBe(true);expect(await facts(f)).toEqual(before);
});
it('service-owner-v4 keeps a post-COMMIT typed driver error UNKNOWN and recovers only the committed exact operation',async()=>{
 const f=await ready(),command=cash(f);let once=true;
 const db:IdentityStore={transaction:async work=>{const result=await f.db.transaction(work);if(once){once=false;throw new AppError('CONFLICT');}return result;}};
 await expect(f.store(db).recordCashDate(f.owner,command)).rejects.toThrow('UNAVAILABLE');expect((await facts(f)).receipts).toHaveLength(1);
 const recovered=await f.store().readMoneyOperation(f.owner,{action:'cash_date',command});expect(recovered).toMatchObject({operationId:command.operationId,replayed:true});
 f.ownerFlags.denyRead=true;expect(await f.store().recordCashDate(f.owner,command)).toMatchObject({state:'rejected_current_attempt',code:'FORBIDDEN'});f.ownerFlags.denyRead=false;
 expect(await f.store().readMoneyOperation(f.owner,{action:'cash_date',command})).toEqual(recovered);expect((await facts(f)).receipts).toHaveLength(1);
});
it('service-owner-v4 rolls back on terminal owner session revocation and terminal authority Date mutation',async()=>{
 const f=await ready(),command=cash(f),before=await facts(f);f.ownerFlags.terminalRevoke=true;
 expect(await f.store().recordCashDate(f.owner,command)).toMatchObject({state:'rejected_current_attempt',code:'UNAUTHENTICATED'});expect(await facts(f)).toEqual(before);
 f.ownerFlags.terminalRevoke=false;f.ownerFlags.reads=0;let calls=0;
 const permission:ServiceOwnerFinancialAuthorityV4={...f.authority,authorize:async c=>{if(++calls===2)c.now.setTime(c.now.valueOf()+1);}};
 await expect(f.store(f.db,f.commandKey,permission).recordCashDate(f.owner,command)).rejects.toThrow('UNAVAILABLE');expect(await facts(f)).toEqual(before);
});
it('service-owner-v4 guards new money journals against UPDATE DELETE and TRUNCATE',async()=>{
 const f=await ready(),command=cash(f);await f.store().recordCashDate(f.owner,command);const before=await facts(f);
 await expect(engine.query('UPDATE ls_fishing_billing.commands SET request_digest=$3 WHERE workspace_id=$1 AND operation_id=$2',[f.workspace,command.operationId,'f'.repeat(64)])).rejects.toThrow('FISHING_SERVICE_MONEY_IMMUTABLE');
 await expect(engine.query('DELETE FROM ls_fishing_billing.commands WHERE workspace_id=$1 AND operation_id=$2',[f.workspace,command.operationId])).rejects.toThrow('FISHING_SERVICE_MONEY_IMMUTABLE');
 await expect(engine.exec('TRUNCATE ls_fishing_billing.commands')).rejects.toThrow('IMMUTABLE');expect(await facts(f)).toEqual(before);
});
it('service-owner-v4 authenticates immutable operation results independently of valid AEAD and rejects hidden index time precision',async()=>{
 const f=await ready(),command=cash(f);await f.store().recordCashDate(f.owner,command);
 for(const kind of ['result','precision','actor'] as const){
  const db:IdentityStore={transaction:work=>f.db.transaction(tx=>work({query:async<R extends object>(sql:string,v:readonly unknown[]=[])=>{
   const rows=await tx.query<R>(sql,v);if(!sql.includes('request_digest AS digest')||v[1]!==command.operationId)return rows;
   return rows.map(r=>{const row=r as R&{ciphertext:string};
    if(kind==='precision')return {...row,exactTime:false};if(kind==='actor')return {...row,actorId:randomUUID()};
    const j=JSON.parse(unseal(row.ciphertext,serviceGuestAadV4('owner_money',f.workspace,command.operationId),programRing));j.receipt.result.balance.paidMinor++;
    return {...row,ciphertext:seal(JSON.stringify(j),serviceGuestAadV4('owner_money',f.workspace,command.operationId),programRing)};
   });
  }}))};
  await expect(f.store(db).readMoneyOperation(f.owner,{action:'cash_date',command})).rejects.toThrow(kind==='actor'?'CONFLICT':'UNAVAILABLE');
 }
});
it('service-owner-v4 suppresses queued reminders on actual full cash only, preserves UNKNOWN delivery and never requeues a correction',async()=>{
 const f=await ready(),unknownBefore:unknown[]=[];
 for(const state of ['queued','unknown'] as const){
  const i=reminderIntentSchema.parse({version:BILLING_DTO_VERSION,id:randomUUID(),key:'SYNTHETIC-MONEY-'+state,quoteId:f.quote.id,familyId:f.quote.familyId,guardianId:randomUUID(),channel:'email',audience:'individual',locale:'en',policyId:'SYNTHETIC',policyRevision:1,sequence:0,dueAt:f.quote.lines[0]!.dueAt,scheduledAt:f.clock.now().toISOString(),state,dispatchId:state==='unknown'?randomUUID():null,providerId:null,reason:null});
  const hash=(v:unknown)=>createHmac('sha256',f.ledgerKey).update(canonical(v)).digest('hex');
  await engine.query('INSERT INTO ls_fishing_billing.reminders VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[f.workspace,i.id,f.quote.id,hash({key:i.key}),state,seal(JSON.stringify(i),'ls_fishing_billing/v1/reminder/'+f.workspace+'/'+i.id,programRing),'SYNTHETIC',i.scheduledAt,hash({quoteId:f.quote.id,guardianId:i.guardianId})]);
  if(state==='unknown')unknownBefore.push(...(await engine.query('SELECT * FROM ls_fishing_billing.reminders WHERE workspace_id=$1 AND id=$2',[f.workspace,i.id])).rows);
 }
 const command={...cash(f,130000),allocations:f.quote.lines.map(l=>({lineId:l.id,amountMinor:65000}))},out=await f.store().recordCashDate(f.owner,command);if(out.state!=='committed')throw Error('EXPECTED_COMMIT');
 expect(out.result.result.balance).toMatchObject({paidMinor:130000,remainingMinor:0,reminderCounts:{queued:0,unknown:1,suppressed:1}});
 expect((await engine.query("SELECT * FROM ls_fishing_billing.reminders WHERE workspace_id=$1 AND state='unknown'",[f.workspace])).rows).toEqual(unknownBefore);
 const correction={version:BILLING_SERVICE_V4,operationId:randomUUID(),quoteId:f.quote.id,expectedVersion:4,originalReceiptId:out.result.result.receipt.id,amountMinor:1000,allocations:[{lineId:f.quote.lines[0]!.id,amountMinor:1000}],reason:'Synthetic manual correction'};
 const reversed=await f.store().reverseCash(f.owner,correction);expect(reversed.state).toBe('committed');
 const view=await f.store().readSnapshot(f.owner,f.quote.id);expect(view.balance).toMatchObject({remainingMinor:1000});expect(view.balance.reminders.map(i=>i.state).sort()).toEqual(['suppressed','unknown']);
});
it('service-owner-v4 corrects historical cash on a cancelled accepted agreement without resuming or changing its consent',async()=>{
 const f=await ready(),out=await f.store().recordCashDate(f.owner,cash(f));if(out.state!=='committed')throw Error('EXPECTED_COMMIT');
 const current=(await f.store().readSnapshot(f.owner,f.quote.id)).quote;
 expect((await f.store().setState(f.owner,stateCommand(f,4,{cancel:true}))).state).toBe('committed');
 const before=await facts(f);expect(await f.store().recordCashDate(f.owner,cash(f,1000,5))).toMatchObject({state:'rejected_current_attempt',code:'CONFLICT'});expect(await facts(f)).toEqual(before);
 const result=await f.store().reverseCash(f.owner,{version:BILLING_SERVICE_V4,operationId:randomUUID(),quoteId:f.quote.id,expectedVersion:5,originalReceiptId:out.result.result.receipt.id,amountMinor:30000,allocations:cash(f).allocations,reason:'Synthetic duplicate cash record correction'});
 expect(result.state).toBe('committed');expect((await f.store().readSnapshot(f.owner,f.quote.id)).quote).toMatchObject({state:'cancelled',revision:6,acceptance:current.acceptance});
 expect((await facts(f)).acceptance).toEqual(before.acceptance);
});
it('service-owner-v4 revokes borrowed financial transaction context after successful cash commit',async()=>{
 const f=await ready();let retained:Readonly<Parameters<ServiceOwnerFinancialAuthorityV4['target']>[0]>|undefined;
 const permission:ServiceOwnerFinancialAuthorityV4={...f.authority,target:async c=>{retained=c;}};
 expect((await f.store(f.db,f.commandKey,permission).recordCashDate(f.owner,cash(f))).state).toBe('committed');expect(retained).toBeDefined();
 await expect(retained!.tx.query('SELECT 1')).rejects.toThrow('UNAVAILABLE');
});
function stateCommand(f:Fixture,expectedQuoteRevision:number,change:{paused?:boolean;cancel?:true}){return {version:BILLING_SERVICE_V4,action:SERVICE_STATE_ACTION_V4,operationId:randomUUID(),quoteId:f.quote.id,expectedQuoteRevision,...change};}
it('service-owner-state-v4 pauses and resumes the original unsigned offer then accepts the exact observed revision without changing material or grant',async()=>{
 const f=await ready(false),original=await facts(f),pause=stateCommand(f,2,{paused:true}),paused=await f.store().setState(f.owner,pause);expect(serviceStateOutcomeV4Schema.parse(paused).state).toBe('committed');
 expect((await f.store().readSnapshot(f.owner,f.quote.id)).balance).toMatchObject({state:'no_debt',revision:3,paused:true});
 await expect(f.guest().acceptFinancialOffer(f.token,f.command)).rejects.toThrow('UNAVAILABLE');
 const unpause=stateCommand(f,3,{paused:false});expect((await f.store().setState(f.owner,unpause)).state).toBe('committed');
 expect((await facts(f)).grants).toEqual(original.grants);await expect(f.guest().acceptFinancialOffer(f.token,f.command)).rejects.toThrow('UNAVAILABLE');
 const command={...f.command,expectedQuoteRevision:4},receipt=await f.guest().acceptFinancialOffer(f.token,command);expect(receipt.acceptedRevision).toBe(5);
 expect(await f.guest().acceptFinancialOffer(f.token,command)).toEqual({...receipt,replayed:true});
 expect(await f.store().readOriginalAcceptance(f.owner,f.quote.id,command.operationId)).toEqual(receipt);
 const evidence=(await engine.query<{ciphertext:string;issuedRevision:number}>('SELECT evidence_ciphertext AS ciphertext,issued_revision AS "issuedRevision" FROM ls_fishing_billing.guest_financial_acceptances WHERE workspace_id=$1',[f.workspace])).rows[0]!;
 expect(evidence.issuedRevision).toBe(2);expect(JSON.parse(unseal(evidence.ciphertext,serviceGuestAadV4('financial_acceptance',f.workspace,receipt.acceptanceId),programRing)).command).toEqual(command);
 expect((await f.store().readSnapshot(f.owner,f.quote.id)).quote.offer).toEqual(f.quote.offer);
 expect(await f.store().readStateOperation(f.owner,pause)).toEqual(paused.state==='committed'?{...paused.result,replayed:true}:null);
 expect((await f.store().recordCashDate(f.owner,cash(f,30000,5))).state).toBe('committed');
 expect((await f.store().readSnapshot(f.owner,f.quote.id)).balance).toMatchObject({revision:6,paidMinor:30000});
});
it('service-owner-state-v4 cancels unsigned offers without debt or grant reuse and never resumes a cancelled agreement',async()=>{
 const f=await ready(false),command=stateCommand(f,2,{cancel:true}),out=await f.store().setState(f.owner,command);if(out.state!=='committed')throw Error('EXPECTED_COMMIT');const before=await facts(f);
 expect((await f.store().readSnapshot(f.owner,f.quote.id)).balance).toMatchObject({state:'no_debt',cancelled:true,dueMinor:0});
 await expect(f.guest().acceptFinancialOffer(f.token,{...f.command,expectedQuoteRevision:3})).rejects.toThrow('UNAVAILABLE');
 expect(await f.store().setState(f.owner,stateCommand(f,3,{paused:false}))).toMatchObject({state:'rejected_current_attempt',code:'CONFLICT'});
 expect(await f.store().setState(f.owner,command)).toEqual({...out,result:{...out.result,replayed:true}});expect(await facts(f)).toEqual(before);
});
it('service-owner-state-v4 preserves debt receipts and original consent through actual pause resume cancel and historical correction',async()=>{
 const f=await ready(),money=await f.store().recordCashDate(f.owner,cash(f));if(money.state!=='committed')throw Error('EXPECTED_COMMIT');const original=await facts(f);
 for(const command of [stateCommand(f,4,{paused:true}),stateCommand(f,5,{paused:false}),stateCommand(f,6,{cancel:true})])expect((await f.store().setState(f.owner,command)).state).toBe('committed');
 const view=await f.store().readSnapshot(f.owner,f.quote.id);expect(view.balance).toMatchObject({dueMinor:130000,paidMinor:30000,cancelled:true});expect(view.balance.receipts).toEqual([money.result.result.receipt]);
 expect((await facts(f)).acceptance).toEqual(original.acceptance);expect((await facts(f)).grants).toEqual(original.grants);
 const correction={version:BILLING_SERVICE_V4,operationId:randomUUID(),quoteId:f.quote.id,expectedVersion:7,originalReceiptId:money.result.result.receipt.id,amountMinor:30000,allocations:cash(f).allocations,reason:'Synthetic original cash entry correction'};
 expect((await f.store().reverseCash(f.owner,correction)).state).toBe('committed');expect((await f.store().readSnapshot(f.owner,f.quote.id)).balance).toMatchObject({dueMinor:130000,paidMinor:0,cancelled:true});
});
it('service-owner-state-v4 refuses stale or changed operations, money-operation collisions and missing state changes',async()=>{
 const f=await ready(),command=stateCommand(f,3,{paused:true});await f.store().setState(f.owner,command);const before=await facts(f);
 expect(await f.store().setState(f.owner,{...command,paused:false})).toMatchObject({state:'rejected_current_attempt',code:'CONFLICT'});
 expect(await f.store().setState(f.owner,stateCommand(f,3,{cancel:true}))).toMatchObject({state:'rejected_current_attempt',code:'CONFLICT'});
 await expect(f.store().setState(f.owner,stateCommand(f,4,{}))).rejects.toThrow('INVALID_REQUEST');await expect(f.store().setState(f.owner,stateCommand(f,4,{cancel:true,paused:false}))).rejects.toThrow('INVALID_REQUEST');
 expect(await f.store().readStateOperation(f.owner,{...command,operationId:randomUUID()})).toBeNull();expect(await facts(f)).toEqual(before);
 const cashCommand=cash(f,30000,4);await f.store().recordCashDate(f.owner,cashCommand);
 expect(await f.store().setState(f.owner,{...stateCommand(f,5,{cancel:true}),operationId:cashCommand.operationId})).toMatchObject({state:'rejected_current_attempt',code:'CONFLICT'});
});
it('service-owner-state-v4 needs actual current owner and separate state authority and rolls back terminal revocation',async()=>{
 const f=await ready(),command=stateCommand(f,3,{paused:true}),before=await facts(f),permission:ServiceOwnerFinancialAuthorityV4={...f.authority,authorize:async(c,scope)=>{await f.authority.authorize(c,scope);if(scope.action==='state')throw new AppError('FORBIDDEN');}};
 expect(await f.store(f.db,f.commandKey,permission).setState(f.owner,command)).toMatchObject({state:'rejected_current_attempt',code:'FORBIDDEN'});
 expect(await f.store().setState(f.parent,command)).toMatchObject({state:'rejected_current_attempt',code:'FORBIDDEN'});
 f.ownerFlags.reads=0;f.ownerFlags.terminalRevoke=true;expect(await f.store().setState(f.owner,command)).toMatchObject({state:'rejected_current_attempt',code:'UNAUTHENTICATED'});expect(await facts(f)).toEqual(before);
});
it('service-owner-state-v4 rolls back the actual new state journal and quote together on genuine callback rejection',async()=>{
 const f=await ready(false),command=stateCommand(f,2,{paused:true}),before=await facts(f);let reached=false;
 const db:IdentityStore={transaction:work=>f.db.transaction(tx=>work({query:async<R extends object>(sql:string,v:readonly unknown[]=[])=>{
  const rows=await tx.query<R>(sql,v);if(sql.startsWith('INSERT INTO ls_fishing_billing.commands')&&v[3]==='service_state_v4'){reached=true;throw new AppError('FORBIDDEN');}return rows;
 }}))};
 expect(await f.store(db).setState(f.owner,command)).toMatchObject({state:'rejected_current_attempt',code:'FORBIDDEN'});expect(reached).toBe(true);expect(await facts(f)).toEqual(before);
});
it('service-owner-state-v4 retains post-COMMIT UNKNOWN and recovers the exact original state independently of current state',async()=>{
 const f=await ready(false),command=stateCommand(f,2,{paused:true});let once=true;
 const db:IdentityStore={transaction:async work=>{const value=await f.db.transaction(work);if(once){once=false;throw new AppError('CONFLICT');}return value;}};
 await expect(f.store(db).setState(f.owner,command)).rejects.toThrow('UNAVAILABLE');const original=await f.store().readStateOperation(f.owner,command);expect(original).toMatchObject({after:{revision:3,paused:true},replayed:true});
 await f.store().setState(f.owner,stateCommand(f,3,{paused:false}));expect(await f.store().readStateOperation(f.owner,command)).toEqual(original);
 f.ownerFlags.denyRead=true;expect(await f.store().setState(f.owner,command)).toMatchObject({state:'rejected_current_attempt',code:'FORBIDDEN'});f.ownerFlags.denyRead=false;
 expect(await f.store().readStateOperation(f.owner,command)).toEqual(original);expect((await f.store().readSnapshot(f.owner,f.quote.id)).quote).toMatchObject({revision:4,paused:false});
});
it.each(['missing','duplicate','precision','result','actor'] as const)('service-owner-state-v4 rejects %s transition evidence before accepting a later revision of the same offer',async change=>{
 const f=await ready(false);await f.store().setState(f.owner,stateCommand(f,2,{paused:true}));await f.store().setState(f.owner,stateCommand(f,3,{paused:false}));
 const before=await facts(f),command={...f.command,expectedQuoteRevision:4};
 const db:IdentityStore={transaction:work=>f.db.transaction(tx=>work({query:async<R extends object>(sql:string,v:readonly unknown[]=[])=>{
  const rows=await tx.query<R>(sql,v);if(!sql.includes("action='service_state_v4'")||!sql.includes('LIMIT 1001'))return rows;
  if(change==='missing')return [];if(change==='duplicate')return [...rows,rows[0]!];
  return rows.map(r=>{const row=r as R&{operationId:string;ciphertext:string};if(change==='precision')return {...row,exactTime:false};if(change==='actor')return {...row,actorId:randomUUID()};
   const record=JSON.parse(unseal(row.ciphertext,serviceGuestAadV4('owner_state',f.workspace,row.operationId),programRing));record.receipt.after.paused=!record.receipt.after.paused;
   return {...row,ciphertext:seal(JSON.stringify(record),serviceGuestAadV4('owner_state',f.workspace,row.operationId),programRing)};
  });
 }}))};
 const guest=new FishingServiceGuestNativeV4(db,f.workspace,programRing,programKey,f.commandKey,f.clock,f.resolver());await expect(guest.acceptFinancialOffer(f.token,command)).rejects.toThrow('UNAVAILABLE');expect(await facts(f)).toEqual(before);
});
it('service-owner-state-v4 cannot infer missing transitions from a resealed quote or invented future command revision',async()=>{
 const f=await ready(false),raw={...f.quote,revision:4};await engine.query('UPDATE ls_fishing_billing.quotes SET revision=4,payload_ciphertext=$3 WHERE workspace_id=$1 AND id=$2',[f.workspace,f.quote.id,seal(JSON.stringify(raw),serviceGuestAadV4('quote',f.workspace,f.quote.id),programRing)]);
 await expect(f.guest().acceptFinancialOffer(f.token,{...f.command,expectedQuoteRevision:4})).rejects.toThrow('UNAVAILABLE');await expect(f.store().readSnapshot(f.owner,f.quote.id)).rejects.toThrow('UNAVAILABLE');
});
it('service-owner-state-v4 unpause never refreshes an expired guest grant',async()=>{
 const f=await ready(false);await f.store().setState(f.owner,stateCommand(f,2,{paused:true}));await f.store().setState(f.owner,stateCommand(f,3,{paused:false}));const before=await facts(f);f.flags.now=new Date('2035-04-01T17:00:00Z');
 await expect(f.guest().acceptFinancialOffer(f.token,{...f.command,expectedQuoteRevision:4})).rejects.toThrow('UNAVAILABLE');expect(await facts(f)).toEqual(before);
 expect((await f.store().readSnapshot(f.owner,f.quote.id)).balance.state).toBe('no_debt');
});
it('service-owner-state-v4 protects actual new state commands against rewriting and deletion',async()=>{
 const f=await ready(false),command=stateCommand(f,2,{paused:true});await f.store().setState(f.owner,command);const before=await facts(f);
 await expect(engine.query("UPDATE ls_fishing_billing.commands SET action='other' WHERE workspace_id=$1 AND operation_id=$2",[f.workspace,command.operationId])).rejects.toThrow('FISHING_SERVICE_STATE_IMMUTABLE');
 await expect(engine.query('DELETE FROM ls_fishing_billing.commands WHERE workspace_id=$1 AND operation_id=$2',[f.workspace,command.operationId])).rejects.toThrow('FISHING_SERVICE_STATE_IMMUTABLE');expect(await facts(f)).toEqual(before);
});
it.each(['query','clock','workspace'] as const)('service-owner-state-v4 pins %s during authenticated history SQL',async change=>{
 const f=await ready(false);await f.db.transaction(async tx=>{
  const c={workspaceId:f.workspace,now:f.clock.now(),tx:{query:tx.query.bind(tx)} as SqlSession},original=c.tx.query;let redirected=0;
  c.tx.query=async<R extends object>(sql:string,v:readonly unknown[]=[])=>{const rows=await original<R>(sql,v);if(change==='query')c.tx.query=async()=>{redirected++;return [];};else if(change==='clock')c.now.setTime(c.now.valueOf()+1);else c.workspaceId=randomUUID() as typeof f.workspace;return rows;};
  await expect(readServicePreAcceptanceStateV4(c,f.workspace,f.quote,2,{state:'issued',paused:false},programRing,programKey)).rejects.toThrow('UNAVAILABLE');expect(redirected).toBe(0);
 });
});
it('service-owner-state-v4 pauses only queued delivery and does not reactivate suppressed or unknown intents on resume',async()=>{
 const f=await ready(),unknownBefore:unknown[]=[];
 for(const state of ['queued','unknown'] as const){
  const i=reminderIntentSchema.parse({version:BILLING_DTO_VERSION,id:randomUUID(),key:'SYNTHETIC-STATE-'+state,quoteId:f.quote.id,familyId:f.quote.familyId,guardianId:randomUUID(),channel:'email',audience:'individual',locale:'en',policyId:'SYNTHETIC',policyRevision:1,sequence:0,dueAt:f.quote.lines[0]!.dueAt,scheduledAt:f.clock.now().toISOString(),state,dispatchId:state==='unknown'?randomUUID():null,providerId:null,reason:null});
  const hash=(v:unknown)=>createHmac('sha256',f.ledgerKey).update(canonical(v)).digest('hex');
  await engine.query('INSERT INTO ls_fishing_billing.reminders VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[f.workspace,i.id,f.quote.id,hash({key:i.key}),state,seal(JSON.stringify(i),'ls_fishing_billing/v1/reminder/'+f.workspace+'/'+i.id,programRing),'SYNTHETIC',i.scheduledAt,hash({quoteId:f.quote.id,guardianId:i.guardianId})]);
  if(state==='unknown')unknownBefore.push(...(await engine.query('SELECT * FROM ls_fishing_billing.reminders WHERE workspace_id=$1 AND id=$2',[f.workspace,i.id])).rows);
 }
 expect((await f.store().setState(f.owner,stateCommand(f,3,{paused:true}))).state).toBe('committed');
 expect((await engine.query("SELECT * FROM ls_fishing_billing.reminders WHERE workspace_id=$1 AND state='unknown'",[f.workspace])).rows).toEqual(unknownBefore);
 expect((await f.store().setState(f.owner,stateCommand(f,4,{paused:false}))).state).toBe('committed');
 const view=await f.store().readSnapshot(f.owner,f.quote.id);expect(view.balance.reminders.map(r=>r.state).sort()).toEqual(['suppressed','unknown']);expect(view.balance).toMatchObject({dueMinor:130000,paidMinor:0,paused:false});
});
it('service-owner-state-v4 requires pre-acceptance transitions to precede the original acceptance even on later historical read',async()=>{
 const f=await ready(false),originalAt=f.clock.now().toISOString();f.flags.now=new Date(f.clock.now().valueOf()+60000);await f.store().setState(f.owner,stateCommand(f,2,{paused:true}));await f.store().setState(f.owner,stateCommand(f,3,{paused:false}));
 await f.guest().acceptFinancialOffer(f.token,{...f.command,expectedQuoteRevision:4});const current=(await f.store().readSnapshot(f.owner,f.quote.id)).quote;if(!current.acceptance)throw Error('EXPECTED_ACCEPTANCE');
 await f.db.transaction(tx=>expect(readServicePreAcceptanceStateV4({workspaceId:f.workspace,now:f.clock.now(),tx},f.workspace,{...current,acceptance:{...current.acceptance!,acceptedAt:originalAt}},4,{state:'issued',paused:false},programRing,programKey)).rejects.toThrow('UNAVAILABLE'));
});
it.each(['pause','cancellation'] as const)('service-owner-state-v4 rejects a coherently resealed current quote that bypasses authenticated %s history',async kind=>{
 const f=await ready();await f.store().setState(f.owner,stateCommand(f,3,kind==='pause'?{paused:true}:{cancel:true}));
 const current=(await f.store().readSnapshot(f.owner,f.quote.id)).quote,forged={...current,state:'accepted',paused:false};
 await engine.query('UPDATE ls_fishing_billing.quotes SET payload_ciphertext=$3 WHERE workspace_id=$1 AND id=$2',[f.workspace,current.id,seal(JSON.stringify(forged),serviceGuestAadV4('quote',f.workspace,current.id),programRing)]);
 await expect(f.store().readSnapshot(f.owner,f.quote.id)).rejects.toThrow('UNAVAILABLE');
});
