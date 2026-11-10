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
import {BILLING_DTO_VERSION,reminderIntentSchema} from '../../src/features/fishing-billing/contracts.ts';
import {cardAttemptSchema,CARD_VERSION} from '../../src/features/fishing-billing/card-contracts.ts';
import {canonical} from '../../src/features/contact-ops/core/validation.ts';
import {seal,unseal} from '../../src/features/identity/crypto.ts';
import {AppError} from '../../src/lib/errors.ts';
import type {IdentityStore,SqlSession} from '../../src/features/identity/store.ts';
vi.mock('server-only',()=>({}));
let engine:PGlite;const network=vi.fn(async()=>{throw Error('NO_NETWORK');});
beforeAll(async()=>{requirePgliteMemoryEnvironment(process.env);vi.stubGlobal('fetch',network);engine=new PGlite();await initializeProgramSchema(engine);
 for(const name of ['UNNUMBERED_ls_fishing_fulfillment_v1.sql','UNNUMBERED_ls_fishing_service_material_v4.sql','UNNUMBERED_ls_fishing_quote_service_v4.sql'])await engine.exec(await readFile('migrations/proposals/'+name,'utf8'));},20000);
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
 const claimedPaid={...a,state:'paid'};await engine.query("UPDATE ls_fishing_billing.card_attempts SET state='paid',payload_ciphertext=$3 WHERE workspace_id=$1 AND id=$2",[f.workspace,id,seal(JSON.stringify(claimedPaid),'ls_fishing_billing/card/v1/attempt/'+f.workspace+'/'+id,programRing)]);
 expect((await f.store().readSnapshot(f.owner,f.quote.id)).balance).toMatchObject({state:'review_required',paidMinor:0});
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
