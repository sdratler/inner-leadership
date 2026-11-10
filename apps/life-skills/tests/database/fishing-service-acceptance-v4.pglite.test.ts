import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {beforeAll,afterAll,afterEach,it,expect,vi} from 'vitest';
import {requirePgliteMemoryEnvironment} from '../fixtures/pglite-memory-environment.ts';
import {initializeProgramSchema,programRing,programKey} from '../fixtures/fishing-native-program-v3.ts';
import {serviceGuestFixtureV4} from '../fixtures/fishing-service-guest-v4.ts';
import {FishingServiceGuestNativeV4,serviceGuestFinancialEvidenceV4Schema} from '../../src/features/fishing-billing/guest-service-native-v4.ts';
import {BILLING_SERVICE_V4,serviceAcceptanceOutcomeV4Schema,serviceRecurringPresentationV4Schema,type ServiceAcceptCommandV4} from '../../src/features/fishing-billing/guest-service-contract-v4.ts';
import {serviceRecurringStatementSha256V4} from '../../src/features/fishing-billing/guest-service-material-v4.ts';
import {serviceGuestAadV4} from '../../src/features/fishing-billing/guest-service-aad-v4.ts';
import {seal,unseal} from '../../src/features/identity/crypto.ts';
import {verifyServiceFamilyOfferV4} from '../../src/features/fishing-billing/guest-service-domain-v4.ts';
import type {IdentityStore} from '../../src/features/identity/store.ts';
import {AppError} from '../../src/lib/errors.ts';
vi.mock('server-only',()=>({}));
let engine:PGlite;const network=vi.fn(async()=>{throw Error('NO_NETWORK');});
beforeAll(async()=>{requirePgliteMemoryEnvironment(process.env);vi.stubGlobal('fetch',network);engine=new PGlite();await initializeProgramSchema(engine);
 for(const name of ['UNNUMBERED_ls_fishing_fulfillment_v1.sql','UNNUMBERED_ls_fishing_service_material_v4.sql','UNNUMBERED_ls_fishing_quote_service_v4.sql'])await engine.exec(await readFile('migrations/proposals/'+name,'utf8'));},20000);
afterEach(()=>{expect(network).not.toHaveBeenCalled();});afterAll(async()=>{try{await engine?.close();}finally{vi.unstubAllGlobals();}});
// Actual native family/schedule/owner issuer + real acceptance/resolver/SQL/
// crypto. Grant is RAW SEEDED and guardian/legal/global reservation references
// remain explicitly SYNTHETIC: no actual guest grant issuance/admission, live
// payment/reminder or PostgreSQL lock competition is established here.
async function ready(){
 const f=await serviceGuestFixtureV4(engine);
 const store=(db=f.db,resolver=f.resolver())=>new FishingServiceGuestNativeV4(db,f.workspace,programRing,programKey,f.clock,resolver);
 return {...f,store};
}
type Fixture=Awaited<ReturnType<typeof ready>>;
async function state(f:Fixture){
 const counts:Record<string,number>={};for(const table of ['guest_operations','guest_financial_acceptances','obligations','receipts','reminders'])counts[table]=(await engine.query<{n:number}>('SELECT count(*)::int AS n FROM ls_fishing_billing.'+table+' WHERE workspace_id=$1',[f.workspace])).rows[0]!.n;
 const q=(await engine.query<{revision:number}>('SELECT revision FROM ls_fishing_billing.quotes WHERE workspace_id=$1 AND id=$2',[f.workspace,f.quote.id])).rows[0]!;
 const g=(await engine.query<{state:string}>('SELECT state FROM ls_fishing_billing.guest_grants WHERE workspace_id=$1 AND id=$2',[f.workspace,f.grant.id])).rows[0]!;
 return {...counts,revision:q.revision,grant:g.state};
}
async function evidence(f:Fixture,id:string){
 const row=(await engine.query<{ciphertext:string}>('SELECT evidence_ciphertext AS ciphertext FROM ls_fishing_billing.guest_financial_acceptances WHERE workspace_id=$1 AND id=$2',[f.workspace,id])).rows[0]!;
 return {ciphertext:row.ciphertext,value:serviceGuestFinancialEvidenceV4Schema.parse(JSON.parse(unseal(row.ciphertext,serviceGuestAadV4('financial_acceptance',f.workspace,id),programRing)))};
}
const empty={guest_operations:0,guest_financial_acceptances:0,obligations:0,receipts:0,reminders:0,revision:2,grant:'active'};
const accepted={guest_operations:1,guest_financial_acceptances:1,obligations:2,receipts:0,reminders:0,revision:3,grant:'consumed'};
it('service-acceptance-v4 commits original consent journal and both independent child obligations in ONE actual transaction without money or reminders',async()=>{
 const f=await ready(),calls=vi.fn(),db:IdentityStore={transaction:work=>{calls();return f.db.transaction(work);}};
 const receipt=await f.store(db).acceptFinancialOffer(f.token,f.command);expect(calls).toHaveBeenCalledTimes(1);
 expect(receipt).toMatchObject({version:BILLING_SERVICE_V4,operationId:f.command.operationId,quoteId:f.quote.id,acceptedRevision:3,replayed:false,paymentStateAtAcceptance:'unpaid'});
 expect(serviceAcceptanceOutcomeV4Schema.safeParse({version:BILLING_SERVICE_V4,action:f.command.action,workspaceId:f.workspace,command:{...f.command,operationId:randomUUID()},state:'committed',receipt}).success).toBe(false);
 expect(await state(f)).toEqual(accepted);
 const privateEvidence=await evidence(f,receipt.acceptanceId);expect(privateEvidence.value.command).toEqual(f.command);
 expect(privateEvidence.value.acceptance.parent).toMatchObject({privateEvidenceId:receipt.acceptanceId,submittedName:'SYNTHETIC parent',serviceScheduleAffirmed:true});
 expect(privateEvidence.value.display.presentation.locale).toBe('he');expect(privateEvidence.value.acceptance.recurringPrivateEvidenceId).toBeNull();
 const rows=(await engine.query<{childId:string;startsAt:Date;endsAt:Date}>('SELECT child_id AS "childId",starts_at AS "startsAt",ends_at AS "endsAt" FROM ls_fishing_billing.obligations WHERE workspace_id=$1 ORDER BY starts_at',[f.workspace])).rows;
 expect(rows.map(r=>[r.childId,r.startsAt.toISOString(),r.endsAt.toISOString()])).toEqual(f.quote.lines.map(l=>[l.childId,l.period.startsAt,l.period.endsAt]));
});
it('service-acceptance-v4 replays ORIGINAL consent/receipt after new translations assurance and cancellation without rewriting history or duplicating obligations',async()=>{
 const f=await ready(),first=await f.store().acceptFinancialOffer(f.token,f.command),before=await evidence(f,first.acceptanceId),displayCalls=f.flags.displayCalls;
 f.presentation.affirmation.financialTermsText='SYNTHETIC replacement wording not the original display';const newAssurance=randomUUID();
 const resolver=f.resolver({...f.guestAuthority,current:async(c,g,mode)=>({...await f.guestAuthority.current(c,g,mode),assuranceEvidenceId:newAssurance})});
 const row=(await engine.query<{ciphertext:string}>('SELECT payload_ciphertext AS ciphertext FROM ls_fishing_billing.quotes WHERE workspace_id=$1 AND id=$2',[f.workspace,f.quote.id])).rows[0]!;
 const q=verifyServiceFamilyOfferV4(JSON.parse(unseal(row.ciphertext,serviceGuestAadV4('quote',f.workspace,f.quote.id),programRing)));
 const cancelled=verifyServiceFamilyOfferV4({...q,revision:q.revision+1,state:'cancelled',paused:true});
 await engine.query('UPDATE ls_fishing_billing.quotes SET revision=$3,payload_ciphertext=$4 WHERE workspace_id=$1 AND id=$2',[f.workspace,q.id,cancelled.revision,seal(JSON.stringify(cancelled),serviceGuestAadV4('quote',f.workspace,q.id),programRing)]);
 const replay=await f.store(f.db,resolver).acceptFinancialOffer(f.token,f.command);expect(replay).toEqual({...first,replayed:true});
 expect(await evidence(f,first.acceptanceId)).toEqual(before);expect(f.flags.displayCalls).toBe(displayCalls);expect(await state(f)).toEqual({...accepted,revision:4});
});
it.each(['journal','evidence','first child','second child','quote','grant'] as const)('service-acceptance-v4 rolls back the WHOLE family on a known %s failure and safely recovers the original operation',async point=>{
 const f=await ready();let children=0;
 const db:IdentityStore={transaction:work=>f.db.transaction(tx=>work({query:async<R extends object>(sql:string,v:readonly unknown[]=[])=>{
  const rows=await tx.query<R>(sql,v);if(sql.startsWith('INSERT INTO ls_fishing_billing.obligations'))children++;
  if(point==='journal'&&sql.startsWith('INSERT INTO ls_fishing_billing.guest_operations')||point==='evidence'&&sql.startsWith('INSERT INTO ls_fishing_billing.guest_financial_acceptances')||
   point==='first child'&&children===1&&sql.startsWith('INSERT INTO ls_fishing_billing.obligations')||point==='second child'&&children===2&&sql.startsWith('INSERT INTO ls_fishing_billing.obligations')||
   point==='quote'&&sql.startsWith('UPDATE ls_fishing_billing.quotes')||point==='grant'&&sql.startsWith('UPDATE ls_fishing_billing.guest_grants'))throw new AppError('CONFLICT');
  return rows;
 }}))};
 const failed=await f.store(db).acceptFinancialOfferOutcome(f.token,f.command);expect(failed).toMatchObject({state:'rejected_current_attempt',code:'CONFLICT',command:f.command});expect(await state(f)).toEqual(empty);
 expect((await f.store().acceptFinancialOffer(f.token,f.command)).replayed).toBe(false);expect(await state(f)).toEqual(accepted);
});
it('service-acceptance-v4 preserves UNKNOWN on a typed postCOMMIT driver failure despite a later rejected attempt and replays the one original receipt',async()=>{
 const f=await ready();let lost=true;
 const db:IdentityStore={transaction:async work=>{const result=await f.db.transaction(work);if(lost){lost=false;throw new AppError('CONFLICT');}return result;}};
 await expect(f.store(db).acceptFinancialOfferOutcome(f.token,f.command)).rejects.toThrow('UNAVAILABLE');expect(await state(f)).toEqual(accepted);
 const original=(await engine.query<{id:string}>('SELECT id FROM ls_fishing_billing.guest_financial_acceptances WHERE workspace_id=$1',[f.workspace])).rows[0]!.id;
 f.flags.denyTarget=true;const denial=serviceAcceptanceOutcomeV4Schema.parse(await f.store().acceptFinancialOfferOutcome(f.token,f.command));expect(denial).toMatchObject({state:'rejected_current_attempt',code:'UNAVAILABLE',command:f.command});
 // This denial reports only its own rollback, never resolution of the prior
 // committed UNKNOWN. Only this exact original receipt closes that operation.
 expect(await state(f)).toEqual(accepted);f.flags.denyTarget=false;
 const replay=await f.store().acceptFinancialOffer(f.token,f.command);expect(replay).toMatchObject({acceptanceId:original,replayed:true});expect(await state(f)).toEqual(accepted);
});
it('service-acceptance-v4 rejects a typed driver failure before callback without inventing rollback provenance',async()=>{
 const f=await ready(),db:IdentityStore={transaction:async()=>{throw new AppError('CONFLICT');}};
 await expect(f.store(db).acceptFinancialOfferOutcome(f.token,f.command)).rejects.toThrow('UNAVAILABLE');expect(await state(f)).toEqual(empty);
});
it('service-acceptance-v4 terminal actual native-family revocation rolls back evidence all siblings quote and grant use',async()=>{
 const f=await ready();
 const db:IdentityStore={transaction:work=>f.db.transaction(tx=>work({query:async<R extends object>(sql:string,v:readonly unknown[]=[])=>{
  const rows=await tx.query<R>(sql,v);if(sql.startsWith('UPDATE ls_fishing_billing.guest_grants'))await tx.query('DELETE FROM ls_cases.family_members WHERE workspace_id=$1 AND family_id=$2 AND person_id=$3',[f.workspace,f.quote.familyId,f.quote.lines[0]!.childId]);return rows;
 }}))};
 expect(await f.store(db).acceptFinancialOfferOutcome(f.token,f.command)).toMatchObject({state:'rejected_current_attempt',code:'UNAVAILABLE'});expect(await state(f)).toEqual(empty);
 expect((await f.store().acceptFinancialOffer(f.token,f.command)).replayed).toBe(false);
});
it('service-acceptance-v4 terminal permission denial and expiry after grant consumption cannot leave partial financial writes',async()=>{
 const f=await ready(),resolver=f.resolver({...f.guestAuthority,current:async(c,g,mode)=>{if(mode==='terminal')throw new AppError('FORBIDDEN');return f.guestAuthority.current(c,g,mode);}});
 expect(await f.store(f.db,resolver).acceptFinancialOfferOutcome(f.token,f.command)).toMatchObject({state:'rejected_current_attempt',code:'UNAVAILABLE'});expect(await state(f)).toEqual(empty);
 const db:IdentityStore={transaction:work=>f.db.transaction(tx=>work({query:async<R extends object>(sql:string,v:readonly unknown[]=[])=>{
  const rows=await tx.query<R>(sql,v);if(sql.startsWith('UPDATE ls_fishing_billing.guest_grants'))f.flags.now=new Date(f.grant.expiresAt);return rows;
 }}))};
 expect(await f.store(db).acceptFinancialOfferOutcome(f.token,f.command)).toMatchObject({state:'rejected_current_attempt',code:'UNAVAILABLE'});expect(await state(f)).toEqual(empty);
});
it('service-acceptance-v4 retains separate selected-child recurring evidence without starting a provider subscription or second obligation',async()=>{
 const f=await ready(),l=f.quote.lines[0]!,p=serviceRecurringPresentationV4Schema.parse({version:BILLING_SERVICE_V4,purpose:'separate_recurring_card_authorization',grantId:f.grant.id,displayBundleId:f.bundle.id,displayBundleSha256:f.bundle.sha256,
  locale:'he',evidenceId:randomUUID(),textVersion:'SYNTHETIC-UNAPPROVED-RECURRING',amountTimingCancellationText:'SYNTHETIC amount timing and cancellation'});
 const lines=[{lineId:l.id,childId:l.childId,periodId:l.period.id,amountMinor:l.amountMinor,currency:'USD' as const,firstPeriodStartsAt:l.period.startsAt,nextRenewalAt:l.period.endsAt}];
 const command:ServiceAcceptCommandV4={...f.command,recurring:{kind:'separate_affirmative_card_authorization',statementSha256:serviceRecurringStatementSha256V4(f.grant.offer,f.bundle,lines,p),lines,amountTimingCancellationAffirmed:true}};
 const resolver=f.resolver({...f.guestAuthority,display:async(c,g,challenge)=>({...await f.guestAuthority.display(c,g,challenge),recurringPresentation:p})});
 const receipt=await f.store(f.db,resolver).acceptFinancialOffer(f.token,command),e=await evidence(f,receipt.acceptanceId);
 expect(e.value.acceptance.recurring).toEqual(command.recurring);expect(e.value.acceptance.recurringPrivateEvidenceId).toBe(receipt.acceptanceId);expect(e.value.display.recurringPresentation).toEqual(p);expect(await state(f)).toEqual(accepted);
});
it.each(['version','receipt','child obligation','private name'] as const)('service-acceptance-v4 denies original receipt replay when %s evidence is inconsistent instead of treating a consumed token as acceptance proof',async field=>{
 const f=await ready(),first=await f.store().acceptFinancialOffer(f.token,f.command),e=await evidence(f,first.acceptanceId);
 const db:IdentityStore={transaction:work=>f.db.transaction(tx=>work({query:async<R extends object>(sql:string,v:readonly unknown[]=[])=>{
  const rows=await tx.query<R>(sql,v);
  if(field==='version'&&sql.includes('FROM ls_fishing_billing.guest_financial_acceptances'))return rows.map(r=>({...r,materialVersion:null}));
  if(field==='receipt'&&sql.includes('FROM ls_fishing_billing.guest_operations'))return rows.map(r=>({...r,receiptId:randomUUID()}));
  if(field==='child obligation'&&sql.includes('FROM ls_fishing_billing.obligations'))return rows.slice(1);
  if(field==='private name'&&sql.includes('FROM ls_fishing_billing.guest_financial_acceptances')){
   const changed={...e.value,acceptance:{...e.value.acceptance,parent:{...e.value.acceptance.parent,submittedName:'CHANGED'}}};
   return rows.map(r=>({...r,ciphertext:seal(JSON.stringify(changed),serviceGuestAadV4('financial_acceptance',f.workspace,first.acceptanceId),programRing)}));
  }
  return rows;
 }}))};
 await expect(f.store(db).acceptFinancialOffer(f.token,f.command)).rejects.toThrow('UNAVAILABLE');expect(await state(f)).toEqual(accepted);expect(await evidence(f,first.acceptanceId)).toEqual(e);
});
it.each(['issued_at','expires_at'] as const)('service-acceptance-v4 rejects a native grant whose SQL %s has hidden microseconds before issuing a capability',async field=>{
 const f=await ready(),resolver=f.resolver();
 await engine.query('UPDATE ls_fishing_billing.guest_grants SET '+field+'='+field+"+interval '1 microsecond' WHERE workspace_id=$1 AND id=$2",[f.workspace,f.grant.id]);
 await expect(f.db.transaction(tx=>resolver.resolve(Object.freeze({workspaceId:f.workspace,tx,now:f.clock.now()}),f.token,f.command)).then(()=>true)).rejects.toThrow('UNAVAILABLE');
 expect(await state(f)).toEqual(empty);
});
it.each(['operation','private evidence','child period'] as const)('service-acceptance-v4 rejects hidden SQL timestamp precision changes in original %s despite JavaScript rounding',async field=>{
 const f=await ready(),first=await f.store().acceptFinancialOffer(f.token,f.command);
 const db:IdentityStore={transaction:work=>f.db.transaction(tx=>work({query:async<R extends object>(sql:string,v:readonly unknown[]=[])=>{
  if(field==='operation'&&sql.includes('FROM ls_fishing_billing.guest_operations'))sql=sql.replaceAll('recorded_at',"(recorded_at+interval '1 microsecond')");
  if(field==='private evidence'&&sql.includes('FROM ls_fishing_billing.guest_financial_acceptances'))sql=sql.replaceAll('accepted_at',"(accepted_at+interval '1 microsecond')");
  if(field==='child period'&&sql.includes('FROM ls_fishing_billing.obligations'))sql=sql.replaceAll('starts_at',"(starts_at+interval '1 microsecond')");
  return tx.query<R>(sql,v);
 }}))};
 await expect(f.store(db).acceptFinancialOffer(f.token,f.command)).rejects.toThrow('UNAVAILABLE');
 expect((await f.store().acceptFinancialOffer(f.token,f.command)).acceptanceId).toBe(first.acceptanceId);expect(await state(f)).toEqual(accepted);
});
