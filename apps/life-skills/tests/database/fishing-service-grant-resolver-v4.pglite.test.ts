import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {beforeAll,afterAll,afterEach,it,expect,vi} from 'vitest';
import {requirePgliteMemoryEnvironment} from '../fixtures/pglite-memory-environment.ts';
import {initializeProgramSchema,programRing} from '../fixtures/fishing-native-program-v3.ts';
import {serviceGuestFixtureV4} from '../fixtures/fishing-service-guest-v4.ts';
import {serviceGrantLifecycleV4Schema,type ResolvedServiceGuestGrantV4} from '../../src/features/fishing-billing/guest-service-grant-resolver-v4.ts';
import {BILLING_SERVICE_V4,serviceRecurringPresentationV4Schema,type ServiceAcceptCommandV4} from '../../src/features/fishing-billing/guest-service-contract-v4.ts';
import {serviceRecurringStatementSha256V4} from '../../src/features/fishing-billing/guest-service-material-v4.ts';
import {serviceGuestAadV4} from '../../src/features/fishing-billing/guest-service-aad-v4.ts';
import {seal} from '../../src/features/identity/crypto.ts';
import type {BillingLedgerContext} from '../../src/features/fishing-billing/native.ts';
import type {SqlSession} from '../../src/features/identity/store.ts';
vi.mock('server-only',()=>({}));
let engine:PGlite;const network=vi.fn(async()=>{throw Error('NO_NETWORK');});
beforeAll(async()=>{requirePgliteMemoryEnvironment(process.env);vi.stubGlobal('fetch',network);engine=new PGlite();await initializeProgramSchema(engine);
 for(const name of ['UNNUMBERED_ls_fishing_fulfillment_v1.sql','UNNUMBERED_ls_fishing_service_material_v4.sql','UNNUMBERED_ls_fishing_quote_service_v4.sql'])await engine.exec(await readFile('migrations/proposals/'+name,'utf8'));},20000);
afterEach(()=>{expect(network).not.toHaveBeenCalled();});afterAll(async()=>{try{await engine?.close();}finally{vi.unstubAllGlobals();}});
type Fixture=Awaited<ReturnType<typeof serviceGuestFixtureV4>>;
// Real native family/source/V4 owner issuer and SQL; grant RAW SEEDED only.
// Permission references remain SYNTHETIC. This is not actual guest issuance,
// legal/shared-capacity admission, atomic acceptance or PostgreSQL competition.
async function context<T>(f:Fixture,work:(c:BillingLedgerContext)=>Promise<T>){return f.db.transaction(async tx=>{
 let open=true;const bound:SqlSession={query:<R extends object>(sql:string,v:readonly unknown[]=[])=>{if(!open)throw Error('CLOSED_ACTUAL_TX');return tx.query<R>(sql,v);}};
 try{return await work(Object.freeze({workspaceId:f.workspace,tx:bound,now:f.clock.now()}));}finally{open=false;}
});}
async function writeLifecycle(f:Fixture,raw:unknown){
 const l=serviceGrantLifecycleV4Schema.parse(raw);
 await engine.query('UPDATE ls_fishing_billing.guest_grants SET state=$3,payload_ciphertext=$4,issued_at=$5,expires_at=$6 WHERE workspace_id=$1 AND id=$2',
  [f.workspace,f.grant.id,l.state,seal(JSON.stringify(l),serviceGuestAadV4('grant',f.workspace,f.grant.id),programRing),l.grant.issuedAt,l.grant.expiresAt]);
}
it('service-grant-v4 binds actual quote origin token complete financial command and parent-chosen HE display in one actor-free transaction with no writes',async()=>{
 const f=await serviceGuestFixtureV4(engine),resolver=f.resolver();
 await context(f,async c=>{
  const cap=await resolver.resolve(c,f.token,f.command),facts=await resolver.current(c,cap);
  expect(facts).toMatchObject({kind:'fresh',originalReceiptId:null,grant:{id:f.grant.id},display:{presentation:{locale:'he'}}});
  expect(facts.grant.offer.material.financial.lines.map(l=>l.amountMinor)).toEqual([65000,65000]);expect(facts.statementSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(Object.isFrozen(facts.command.parent)&&Object.isFrozen(facts.grant.offer.material.schedule.snapshot.children)).toBe(true);
  expect('actor' in c).toBe(false);expect(f.quote.messageLocaleAtIssue).toBe('en');
 });
 expect((await engine.query('SELECT state FROM ls_fishing_billing.guest_grants WHERE workspace_id=$1',[f.workspace])).rows).toEqual([{state:'active'}]);
 for(const table of ['guest_operations','guest_financial_acceptances','obligations'])expect((await engine.query('SELECT 1 FROM ls_fishing_billing.'+table+' WHERE workspace_id=$1',[f.workspace])).rows).toHaveLength(0);
});
it('service-grant-v4 denies target before private lookup and mismatched workspace before calling the target',async()=>{
 const f=await serviceGuestFixtureV4(engine),query=vi.fn(async()=>[]),c={workspaceId:f.workspace,tx:{query} as SqlSession,now:f.clock.now()};f.flags.denyTarget=true;
 await expect(f.resolver().resolve(c,f.token,f.command)).rejects.toThrow('UNAVAILABLE');expect(query).not.toHaveBeenCalled();
 const target=vi.fn(f.guestAuthority.target),resolver=f.resolver({...f.guestAuthority,target});
 await expect(resolver.resolve({...c,workspaceId:'00000000-0000-4000-8000-000000000000' as typeof f.workspace},f.token,f.command)).rejects.toThrow('UNAVAILABLE');
 expect(target).not.toHaveBeenCalled();expect(query).not.toHaveBeenCalled();
});
it('service-grant-v4 rejects metadata purpose and material-version mismatch before quote lookup with no V3 decoder fallback',async()=>{
 const f=await serviceGuestFixtureV4(engine);
 for(const changes of [{action:'accept_financial_offer',materialVersion:null},{materialVersion:null},{action:'submit_private_completion'},{materialVersion:'JLFA-FISHING-BILLING-GUEST-v3'}]){
  await context(f,async c=>{
   let quoteReads=0;const tx:SqlSession={query:async<R extends object>(sql:string,v:readonly unknown[]=[])=>{
    if(sql.includes('FROM ls_fishing_billing.quotes'))quoteReads++;
    const rows=await c.tx.query<R>(sql,v);return sql.includes('FROM ls_fishing_billing.guest_grants')?rows.map(r=>({...r,...changes,ciphertext:'NEVER-DECRYPT-WRONG-PURPOSE'})):rows;
   }};
   await expect(f.resolver().resolve(Object.freeze({...c,tx}),f.token,f.command)).rejects.toThrow('UNAVAILABLE');expect(quoteReads).toBe(0);
  });
 }
});
it('service-grant-v4 capability cannot be forged cloned transferred to another resolver/context or reused after real transaction closure',async()=>{
 const f=await serviceGuestFixtureV4(engine),resolver=f.resolver();let borrowed:BillingLedgerContext|undefined,cap:ResolvedServiceGuestGrantV4|undefined;
 await context(f,async c=>{
  borrowed=c;cap=await resolver.resolve(c,f.token,f.command);
  await expect(resolver.current(c,{} as ResolvedServiceGuestGrantV4)).rejects.toThrow('UNAVAILABLE');
  await expect(resolver.current({...c},cap)).rejects.toThrow('UNAVAILABLE');
  await expect(f.resolver().current(c,cap)).rejects.toThrow('UNAVAILABLE');
  expect((await resolver.current(c,cap)).kind).toBe('fresh');
 });
 if(!borrowed||!cap)throw Error('EXPECTED_CAPABILITY');await expect(resolver.current(borrowed,cap)).rejects.toThrow('UNAVAILABLE');
});
it('service-grant-v4 refuses changed command material display statement or invented recurring authorization',async()=>{
 const f=await serviceGuestFixtureV4(engine);
 const edits:((c:ServiceAcceptCommandV4)=>unknown)[]=[c=>({...c,version:'JLFA-FISHING-BILLING-GUEST-v3'}),c=>({...c,expectedQuoteRevision:3}),c=>({...c,offerSnapshotSha256:'f'.repeat(64)}),
  c=>({...c,displayBundleId:randomUUID()}),c=>({...c,displayChallenge:'B'.repeat(43)}),c=>({...c,parent:{...c.parent,financialTermsAffirmed:false}}),
  c=>({...c,recurring:{kind:'separate_affirmative_card_authorization',statementSha256:'a'.repeat(64),lines:[{lineId:randomUUID(),childId:f.quote.lines[0]!.childId,periodId:f.quote.lines[0]!.period.id,amountMinor:65000,currency:'USD',firstPeriodStartsAt:f.quote.lines[0]!.period.startsAt,nextRenewalAt:f.quote.lines[0]!.period.endsAt}],amountTimingCancellationAffirmed:true}})];
 for(const edit of edits)await expect(context(f,c=>f.resolver().resolve(c,f.token,edit(f.command)))).rejects.toThrow('UNAVAILABLE');
 f.flags.badDisplay=true;await expect(context(f,c=>f.resolver().resolve(c,f.token,f.command))).rejects.toThrow('UNAVAILABLE');
});
it('service-grant-v4 rechecks actual native family and current recipient terms/guardian admission including denial during display',async()=>{
 const f=await serviceGuestFixtureV4(engine);
 f.flags.badEvidence=true;await expect(context(f,c=>f.resolver().resolve(c,f.token,f.command))).rejects.toThrow('UNAVAILABLE');f.flags.badEvidence=false;
 f.flags.denyCurrent=true;await expect(context(f,c=>f.resolver().resolve(c,f.token,f.command))).rejects.toThrow('UNAVAILABLE');f.flags.denyCurrent=false;
 f.flags.denyDuringDisplay=true;await expect(context(f,c=>f.resolver().resolve(c,f.token,f.command))).rejects.toThrow('UNAVAILABLE');f.flags.denyDuringDisplay=false;f.flags.denyTarget=false;
 await engine.query('DELETE FROM ls_cases.family_members WHERE workspace_id=$1 AND family_id=$2 AND person_id=$3',[f.workspace,f.quote.familyId,f.quote.lines[0]!.childId]);
 await expect(context(f,c=>f.resolver().resolve(c,f.token,f.command))).rejects.toThrow('UNAVAILABLE');
});
it('service-grant-v4 fails closed on expiry revoked grant future clock and non-millisecond validity metadata',async()=>{
 const f=await serviceGuestFixtureV4(engine);
 for(const t of ['2035-01-02T15:00:59Z',f.grant.expiresAt]){f.flags.now=new Date(t);await expect(context(f,c=>f.resolver().resolve(c,f.token,f.command))).rejects.toThrow('UNAVAILABLE');}
 f.flags.now=new Date('2035-01-02T15:02:00Z');await writeLifecycle(f,{...f.lifecycle,grant:{...f.grant,issuedAt:'2035-01-02T15:01:00.000001Z'}});
 await expect(context(f,c=>f.resolver().resolve(c,f.token,f.command))).rejects.toThrow('UNAVAILABLE');
 await writeLifecycle(f,{...f.lifecycle,state:'revoked',revokedAt:'2035-01-02T15:01:30.000Z'});
 await expect(context(f,c=>f.resolver().resolve(c,f.token,f.command))).rejects.toThrow('UNAVAILABLE');
});
it('service-grant-v4 returns only an exact consumed-operation replay candidate without redisplaying or creating financial proof',async()=>{
 const f=await serviceGuestFixtureV4(engine),resolver=f.resolver();const first=await context(f,async c=>resolver.current(c,await resolver.resolve(c,f.token,f.command))),receiptId=randomUUID();
 await writeLifecycle(f,{...f.lifecycle,state:'consumed',use:{operationId:f.command.operationId,commandDigest:first.commandDigest,receiptId,usedAt:'2035-01-02T15:01:30.000Z'}});
 const before=f.flags.displayCalls,replay=await context(f,async c=>resolver.current(c,await resolver.resolve(c,f.token,f.command)));
 expect(replay).toMatchObject({kind:'replay',originalReceiptId:receiptId,display:null,statementSha256:null});expect(f.flags.displayCalls).toBe(before);
 await expect(context(f,c=>resolver.resolve(c,f.token,{...f.command,operationId:randomUUID()}))).rejects.toThrow('UNAVAILABLE');
 await expect(context(f,c=>resolver.resolve(c,f.token,{...f.command,parent:{...f.command.parent,submittedName:'CHANGED'}}))).rejects.toThrow('UNAVAILABLE');
 expect((await engine.query('SELECT 1 FROM ls_fishing_billing.guest_operations WHERE workspace_id=$1',[f.workspace])).rows).toHaveLength(0);
});
it('service-grant-v4 requires the actual immutable quote origin instead of accepting a valid encrypted grant and public hashes alone',async()=>{
 const f=await serviceGuestFixtureV4(engine);
 await context(f,async c=>{
  const tx:SqlSession={query:async<R extends object>(sql:string,v:readonly unknown[]=[])=>sql.includes("action='guest_service_issue_v4'")?[]:c.tx.query<R>(sql,v)};
  await expect(f.resolver().resolve(Object.freeze({...c,tx}),f.token,f.command)).rejects.toThrow('UNAVAILABLE');
 });
 expect(f.grant.materialVersion).toBe(BILLING_SERVICE_V4);
});
it('service-grant-v4 retains a separately displayed exact recurring choice for only the selected child without authorizing a provider',async()=>{
 const f=await serviceGuestFixtureV4(engine),line=f.quote.lines[0]!,p=serviceRecurringPresentationV4Schema.parse({version:BILLING_SERVICE_V4,purpose:'separate_recurring_card_authorization',
  grantId:f.grant.id,displayBundleId:f.bundle.id,displayBundleSha256:f.bundle.sha256,locale:'he',evidenceId:randomUUID(),textVersion:'SYNTHETIC-UNAPPROVED-RECURRING-TEXT',amountTimingCancellationText:'SYNTHETIC exact amount/timing/cancellation statement'});
 const lines=[{lineId:line.id,childId:line.childId,periodId:line.period.id,amountMinor:line.amountMinor,currency:'USD' as const,firstPeriodStartsAt:line.period.startsAt,nextRenewalAt:line.period.endsAt}];
 const command:ServiceAcceptCommandV4={...f.command,recurring:{kind:'separate_affirmative_card_authorization',statementSha256:serviceRecurringStatementSha256V4(f.grant.offer,f.bundle,lines,p),lines,amountTimingCancellationAffirmed:true}};
 const resolver=f.resolver({...f.guestAuthority,display:async(c,g,challenge)=>({...await f.guestAuthority.display(c,g,challenge),recurringPresentation:p})});
 const facts=await context(f,async c=>resolver.current(c,await resolver.resolve(c,f.token,command)));
 expect(facts.command.recurring).toEqual(command.recurring);expect(facts.grant.offer.material.financial.lines).toHaveLength(2);
 expect(facts.display!.recurringPresentation).toEqual(p);expect((await engine.query('SELECT 1 FROM ls_fishing_billing.guest_operations WHERE workspace_id=$1',[f.workspace])).rows).toHaveLength(0);
});
it('service-grant-v4 denies changed current display recipient evidence or expiry after capability resolution',async()=>{
 const f=await serviceGuestFixtureV4(engine),resolver=f.resolver();
 await context(f,async c=>{
  const cap=await resolver.resolve(c,f.token,f.command);
  f.flags.badDisplay=true;await expect(resolver.current(c,cap)).rejects.toThrow('UNAVAILABLE');f.flags.badDisplay=false;
  f.flags.badEvidence=true;await expect(resolver.current(c,cap)).rejects.toThrow('UNAVAILABLE');f.flags.badEvidence=false;
  f.flags.now=new Date(f.grant.expiresAt);await expect(resolver.current(c,cap)).rejects.toThrow('UNAVAILABLE');
 });
});
it('service-grant-v4 pins the actual transaction before any second private lookup if the caller context is replaced during grant load',async()=>{
 const f=await serviceGuestFixtureV4(engine);
 await context(f,async original=>{
  const foreignQuery=vi.fn(async()=>[]);const c={workspaceId:f.workspace,tx:original.tx,now:f.clock.now()};
  c.tx={query:async<R extends object>(sql:string,v:readonly unknown[]=[])=>{
   const rows=await original.tx.query<R>(sql,v);
   if(sql.includes('FROM ls_fishing_billing.guest_grants'))c.tx={query:foreignQuery} as SqlSession;
   return rows;
  }};
  await expect(f.resolver().resolve(c,f.token,f.command)).rejects.toThrow('UNAVAILABLE');expect(foreignQuery).not.toHaveBeenCalled();
 });
});
it('service-grant-v4 denies grant expiry reached during the awaited display evidence lookup',async()=>{
 const f=await serviceGuestFixtureV4(engine),resolver=f.resolver({...f.guestAuthority,display:async(c,g,challenge)=>{
  const display=await f.guestAuthority.display(c,g,challenge);f.flags.now=new Date(f.grant.expiresAt);return display;
 }});
 await expect(context(f,c=>resolver.resolve(c,f.token,f.command))).rejects.toThrow('UNAVAILABLE');
});
it.each(['resolve','current'] as const)('service-grant-v4 denies native grant revocation inside an awaited %s display hook before returning usable facts',async phase=>{
 const f=await serviceGuestFixtureV4(engine);let revoke=false;
 const resolver=f.resolver({...f.guestAuthority,display:async(c,g,challenge)=>{
  const display=await f.guestAuthority.display(c,g,challenge);
  if(revoke){const l={...f.lifecycle,state:'revoked',revokedAt:'2035-01-02T15:01:30.000Z'};
   await c.tx.query('UPDATE ls_fishing_billing.guest_grants SET state=$3,payload_ciphertext=$4 WHERE workspace_id=$1 AND id=$2',
    [f.workspace,g.id,'revoked',seal(JSON.stringify(l),serviceGuestAadV4('grant',f.workspace,g.id),programRing)]);}
  return display;
 }});
 await context(f,async c=>{
  if(phase==='resolve'){revoke=true;await expect(resolver.resolve(c,f.token,f.command)).rejects.toThrow('UNAVAILABLE');}
  else{const cap=await resolver.resolve(c,f.token,f.command);revoke=true;await expect(resolver.current(c,cap)).rejects.toThrow('UNAVAILABLE');}
 });
});
it.each(['resolve','current'] as const)('service-grant-v4 rechecks expiry after the final awaited %s immutable-origin read',async phase=>{
 const f=await serviceGuestFixtureV4(engine),resolver=f.resolver();
 await context(f,async original=>{
  let originReads=0,advance=false;const c=Object.freeze({...original,tx:{query:async<R extends object>(sql:string,v:readonly unknown[]=[])=>{
   const rows=await original.tx.query<R>(sql,v);
   if(sql.includes("action='guest_service_issue_v4'")){originReads++;if(advance&&originReads===2)f.flags.now=new Date(f.grant.expiresAt);}
   return rows;
  }} as SqlSession});
  const cap=phase==='current'?await resolver.resolve(c,f.token,f.command):null;originReads=0;advance=true;
  const attempt=cap?resolver.current(c,cap):resolver.resolve(c,f.token,f.command);
  await expect(attempt.then(()=>true)).rejects.toThrow('UNAVAILABLE');
 });
});
