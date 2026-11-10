import {randomUUID,createHash,createHmac} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {beforeAll,afterAll,afterEach,it,expect,vi} from 'vitest';
import {requirePgliteMemoryEnvironment} from '../fixtures/pglite-memory-environment.ts';
import {initializeProgramSchema,programRing,programKey} from '../fixtures/fishing-native-program-v3.ts';
import {serviceGuestFixtureV4} from '../fixtures/fishing-service-guest-v4.ts';
import {FishingServiceGuestNativeV4} from '../../src/features/fishing-billing/guest-service-native-v4.ts';
import {FishingServiceBillingOwnerV4} from '../../src/features/fishing-billing/guest-service-owner-financial-v4.ts';
import {FishingProgramSourceNativeV3} from '../../src/features/fishing-billing/program-source-native-v3.ts';
import {FishingBillingInquiryFamilyProposals} from '../../src/lib/fishing-billing-inquiry-family-proposal.ts';
import {FishingServiceCashRemindersV4} from '../../src/features/fishing-billing/guest-service-cash-reminder-v4.ts';
import {serviceCashReminderPlanV4Schema,serviceCashReminderKeyV4,type ServiceCashReminderAuthorityV4} from '../../src/features/fishing-billing/guest-service-cash-reminder-contract-v4.ts';
import {cardAttemptSchema,CARD_VERSION} from '../../src/features/fishing-billing/card-contracts.ts';
import {BILLING_SERVICE_V4} from '../../src/features/fishing-billing/guest-service-contract-v4.ts';
import {SERVICE_STATE_ACTION_V4} from '../../src/features/fishing-billing/guest-service-owner-state-contract-v4.ts';
import {serviceGuestAadV4} from '../../src/features/fishing-billing/guest-service-aad-v4.ts';
import {reminderIntentSchema} from '../../src/features/fishing-billing/contracts.ts';
import {REMINDER_SERVICE_VERSION,type BillingReminderServiceOutbox} from '../../src/features/fishing-billing/reminder-service.ts';
import {createFishingBillingReminderOutbox,monthlyReminderProviderReceiptSchema,type BillingReminderOutboxAuthority} from '../../src/lib/fishing-billing-reminder-outbox.ts';
import {canonical} from '../../src/features/contact-ops/core/validation.ts';
import {seal,unseal} from '../../src/features/identity/crypto.ts';
import {AppError} from '../../src/lib/errors.ts';
import type {IdentityStore} from '../../src/features/identity/store.ts';
import type {BillingLedgerContext} from '../../src/features/fishing-billing/native.ts';
vi.mock('server-only',()=>({}));
let engine:PGlite;const network=vi.fn(async()=>{throw Error('NO_NETWORK');});
beforeAll(async()=>{requirePgliteMemoryEnvironment(process.env);vi.stubGlobal('fetch',network);engine=new PGlite();await initializeProgramSchema(engine);
 for(const name of ['0136_ls_academy_founder.sql','0137_ls_academy_owner_notifications.sql'])await engine.exec(await readFile('migrations/'+name,'utf8'));
 for(const name of ['UNNUMBERED_ls_fishing_fulfillment_v1.sql','UNNUMBERED_ls_fishing_service_material_v4.sql','UNNUMBERED_ls_fishing_quote_service_v4.sql','UNNUMBERED_ls_fishing_service_money_v4.sql','UNNUMBERED_ls_fishing_service_state_v4.sql','UNNUMBERED_ls_monthly_reminder_outbox.sql'])await engine.exec(await readFile('migrations/proposals/'+name,'utf8'));
 await engine.exec('CREATE SCHEMA synthetic_cash4; CREATE TABLE synthetic_cash4.admission(workspace_id uuid PRIMARY KEY,quote_id uuid NOT NULL,family_id uuid NOT NULL,guardian_id uuid NOT NULL,reference uuid NOT NULL,active boolean NOT NULL DEFAULT true,cash boolean NOT NULL DEFAULT true,verified boolean NOT NULL DEFAULT true,consented boolean NOT NULL DEFAULT true,window_open boolean NOT NULL DEFAULT true,enabled boolean NOT NULL DEFAULT true,full_group boolean NOT NULL DEFAULT false,policy jsonb NOT NULL,channels jsonb NOT NULL)');
},20000);
afterEach(()=>expect(network).not.toHaveBeenCalled());afterAll(async()=>{try{await engine?.close();}finally{vi.unstubAllGlobals();}});
// Actual native family/source/issuer/acceptance/current owner/money/state,
// encrypted existing outbox and SQL run. Grant is RAW SEEDED. Admission, cash
// choice/guardian/quiet-window/template/provider receipts below are expressly
// SYNTHETIC/UNAPPROVED. Not real service/sender authority or PG competition.
async function ready(accepted=true){
 const f=await serviceGuestFixtureV4(engine);if(accepted)await new FishingServiceGuestNativeV4(f.db,f.workspace,programRing,programKey,f.commandKey,f.clock,f.resolver()).acceptFinancialOffer(f.token,f.command);
 const ledgerKey=Buffer.from(programKey),guardianId=randomUUID(),binding={version:REMINDER_SERVICE_VERSION,mode:'test' as const,serviceBindingId:'SYNTHETIC-CASH4',outboxBindingId:'SYNTHETIC-EXISTING-OUTBOX'};
 const families=new FishingBillingInquiryFamilyProposals(f.db,f.workspace,programRing,programKey,f.clock);
 const policy={version:BILLING_SERVICE_V4,purpose:'cash_due' as const,policy:{id:'SYNTHETIC-CASH4-POLICY',revision:1,source:{id:'SYNTHETIC-NOT-APPROVED',sha256:'a'.repeat(64)},timeZone:'America/New_York' as const,offsetsMinutes:[1440,4320]}};
 await engine.query('INSERT INTO synthetic_cash4.admission(workspace_id,quote_id,family_id,guardian_id,reference,policy,channels) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)',[f.workspace,f.quote.id,f.quote.familyId,guardianId,f.family.command.selection.reference,JSON.stringify(policy),'["email"]']);
 type Profile={quote_id:string;family_id:string;guardian_id:string;reference:string;active:boolean;cash:boolean;verified:boolean;consented:boolean;window_open:boolean;enabled:boolean;full_group:boolean;policy:typeof policy;channels:('email'|'whatsapp')[]};
 const flags={terminalCalls:0,terminalDone:false,privateBeforeTarget:0,denyGlobal:false,denyTerminal:false,outboxFails:false,alterAfterReserve:false,mutateClock:false,terminalLength:false,wrongAmount:false,lateOtherUnknown:false};
 async function profile(c:Readonly<BillingLedgerContext>){expect(c).not.toHaveProperty('actor');if(c.workspaceId!==f.workspace)throw new AppError('FORBIDDEN');const rows=await c.tx.query<Profile>('SELECT * FROM synthetic_cash4.admission WHERE workspace_id=$1 FOR SHARE',[f.workspace]);if(rows.length!==1||!rows[0]!.active)throw new AppError('UNAVAILABLE');return rows[0]!;}
 const permission=(p:Profile,channel:'email'|'whatsapp',current=true)=>({audience:{guardianId:p.guardian_id,channel,audience:'individual' as const,locale:'he' as const,verified:p.verified,consented:p.consented,active:p.active&&!p.full_group},sendWindowOpen:p.window_open,ownerEnabled:p.enabled&&p.cash,policyCurrent:current});
 const authority:ServiceCashReminderAuthorityV4={
  authorize:async(c,b,op,s,a)=>{if(flags.denyGlobal)throw new AppError('UNAVAILABLE');expect(b).toEqual(binding);const p=await profile(c);if(s&&(s.quoteId!==p.quote_id||s.familyId!==p.family_id||s.offerSha256!==f.quote.offer.sha256)||a&&(a.guardianId!==p.guardian_id||a.familyId!==p.family_id||a.quoteId!==p.quote_id))throw new AppError('FORBIDDEN');if(flags.mutateClock)c.now.setTime(c.now.valueOf()+1);if(op==='reserve'&&!p.cash)throw new AppError('FORBIDDEN');},
  plan:async c=>{const p=await profile(c);return p.cash?serviceCashReminderPlanV4Schema.parse({version:BILLING_SERVICE_V4,purpose:'cash_due',guardianId:p.guardian_id,channels:p.channels,policy:p.policy}):null;},
  permission:async(c,_b,_s,selected,a)=>{const p=await profile(c);return permission(p,a.channel,canonical(selected)===canonical(p.policy));},
  terminalReservationPermissions:async(c,b,reservations)=>{
   expect(c).not.toHaveProperty('actor');expect(b).toEqual(binding);flags.terminalCalls++;if(flags.denyTerminal)throw new AppError('FORBIDDEN');
   // ONE actual joint native SQL decision; fixture admission stays synthetic.
   const input=reservations.map((r,n)=>({ordinal:n,quote_id:r.intent.quoteId,family_id:r.intent.familyId,intent_id:r.intent.id,dispatch_id:r.dispatchId,guardian_id:r.intent.guardianId,revision:r.snapshot.quote.revision,child_ids:r.snapshot.quote.lines.map(l=>l.childId)}));
   const rows=await c.tx.query<{ordinal:number;quoteCipher:string;intentCipher:string;outboxCipher:string;active:boolean;cash:boolean;verified:boolean;consented:boolean;window_open:boolean;enabled:boolean;full_group:boolean;guardian_id:string;policy:typeof policy}>(`SELECT d.ordinal,q.payload_ciphertext AS "quoteCipher",i.payload_ciphertext AS "intentCipher",o.payload_ciphertext AS "outboxCipher",a.active,a.cash,a.verified,a.consented,a.window_open,a.enabled,a.full_group,a.guardian_id,a.policy
    FROM jsonb_to_recordset($1::jsonb) d(ordinal integer,quote_id uuid,family_id uuid,intent_id uuid,dispatch_id uuid,guardian_id uuid,revision integer,child_ids jsonb)
    JOIN synthetic_cash4.admission a ON a.workspace_id=$2 AND a.quote_id=d.quote_id AND a.family_id=d.family_id AND a.guardian_id=d.guardian_id
    JOIN ls_fishing_billing.quotes q ON q.workspace_id=$2 AND q.id=d.quote_id AND q.family_id=d.family_id AND q.revision=d.revision
    JOIN ls_fishing_billing.reminders i ON i.workspace_id=$2 AND i.id=d.intent_id AND i.quote_id=d.quote_id AND i.state='unknown'
    JOIN ls_service_interest.inquiry_email_outbox o ON o.workspace_id=$2 AND o.id=d.dispatch_id AND o.purpose='academy_monthly_payment_reminder_v1'
    WHERE a.active AND a.cash AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(d.child_ids) ch WHERE NOT EXISTS(SELECT 1 FROM ls_cases.family_members m WHERE m.workspace_id=$2 AND m.family_id=d.family_id AND m.person_id=ch::uuid AND m.role='child' FOR SHARE OF m))
    ORDER BY d.ordinal FOR SHARE OF a,q,i,o`,[JSON.stringify(input),f.workspace]);
   if(rows.length!==reservations.length)throw new AppError('FORBIDDEN');
   const result=rows.map((row,n)=>{const r=reservations[n]!;expect(row.ordinal).toBe(n);expect(JSON.parse(unseal(row.quoteCipher,serviceGuestAadV4('quote',f.workspace,r.intent.quoteId),programRing))).toEqual(r.snapshot.quote);
    expect(reminderIntentSchema.parse(JSON.parse(unseal(row.intentCipher,'ls_fishing_billing/v1/reminder/'+f.workspace+'/'+r.intent.id,programRing)))).toEqual({...r.intent,state:'unknown',dispatchId:r.dispatchId,reason:'dispatch_reserved'});
    const envelope=JSON.parse(unseal(row.outboxCipher,'ls_service_interest/monthly_payment_reminder/v1/'+f.workspace+'/'+r.dispatchId,programRing));expect(envelope.payload.intent.dispatchId).toBe(r.dispatchId);expect(envelope.payload.intent.id).toBe(r.intent.id);
    const lines=r.snapshot.balance.lines.filter(l=>l.remainingMinor>0&&l.dueAt!==null&&Date.parse(l.dueAt)===Date.parse(r.intent.dueAt));
    expect(envelope.payload.amount).toEqual({currency:'USD',quoteId:r.intent.quoteId,familyId:r.intent.familyId,revision:r.snapshot.quote.revision,remainingMinor:lines.reduce((s,l)=>s+l.remainingMinor,0),lines});
    return permission({...row,quote_id:r.intent.quoteId,family_id:r.intent.familyId,reference:f.family.command.selection.reference,channels:['email']},r.intent.channel,canonical(row.policy)===canonical(r.policy));
   });flags.terminalDone=true;return flags.terminalLength?[...result,...result]:result;
  },
 };
 const mailAuthority:BillingReminderOutboxAuthority={service:async c=>{await profile(c);},reservation:async(c,principal,payload)=>{
  expect(principal.kind).toBe('service');const p=await profile(c);if(!p.cash||!p.consented||!p.verified||!p.window_open||p.full_group)throw new AppError('FORBIDDEN');
  return {reference:p.reference,quoteId:p.quote_id,familyId:p.family_id,guardianId:p.guardian_id,locale:payload.intent.locale,from:'synthetic@example.invalid',to:'synthetic-recipient@example.invalid',template:{id:'SYNTHETIC-UNAPPROVED-MAIL',sha256:'c'.repeat(64)},subject:'SYNTHETIC ONLY',text:'SYNTHETIC ONLY '+payload.amount.remainingMinor,html:'<p>SYNTHETIC ONLY</p>'};
 },outcome:async(c,_b,mail)=>{const p=await profile(c);if(mail.guardianId!==p.guardian_id||mail.reference!==p.reference)throw new AppError('FORBIDDEN');}};
 const actual=createFishingBillingReminderOutbox({workspaceId:f.workspace,outboxBindingId:binding.outboxBindingId,keyring:programRing,authority:mailAuthority});
 const outbox:BillingReminderServiceOutbox={reserveService:async(c,b,p)=>{if(flags.wrongAmount){p.amount.remainingMinor--;p.amount.lines[0]!.remainingMinor--;}await actual.reserveService(c,b,p);if(flags.outboxFails)throw new AppError('UNAVAILABLE');if(flags.alterAfterReserve)await c.tx.query('UPDATE synthetic_cash4.admission SET consented=false WHERE workspace_id=$1',[f.workspace]);
  if(flags.lateOtherUnknown){
   // Same actual TX fault injection: an unresolved historical-recipient row
   // appears AFTER fresh eligibility. It is not a real customer/provider fact.
   const other={...p.intent,id:randomUUID(),guardianId:randomUUID(),dispatchId:randomUUID()};other.key=serviceCashReminderKeyV4(other);
   const hash=(v:unknown)=>createHmac('sha256',ledgerKey).update(canonical(v)).digest('hex');
   await c.tx.query('INSERT INTO ls_fishing_billing.reminders(workspace_id,id,quote_id,intent_key,state,payload_ciphertext,policy_ciphertext,scheduled_at,audience_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[f.workspace,other.id,other.quoteId,hash({key:other.key}),'unknown',seal(JSON.stringify(other),'ls_fishing_billing/v1/reminder/'+f.workspace+'/'+other.id,programRing),seal(JSON.stringify(policy),'ls_fishing_billing/v1/reminder_policy/'+f.workspace+'/'+other.id,programRing),other.scheduledAt,hash({quoteId:other.quoteId,guardianId:other.guardianId})]);
  }
 },readServiceOutcome:actual.readServiceOutcome};
 const db:IdentityStore={transaction:work=>{flags.terminalDone=false;return f.db.transaction(tx=>work({query:async<R extends object>(sql:string,v:readonly unknown[]=[])=>{if(flags.terminalDone)throw Error('NATIVE_IO_AFTER_JOINT_TERMINAL');if(flags.denyGlobal&&sql.includes('FROM ls_fishing_billing'))flags.privateBeforeTarget++;return tx.query<R>(sql,v);}}));}};
 const service=(database=db,ports=authority,delivery=outbox)=>new FishingServiceCashRemindersV4(database,f.workspace,families,programRing,programKey,f.commandKey,ledgerKey,f.clock,binding,ports,delivery);
 const owner=()=>new FishingServiceBillingOwnerV4(f.workspace,new FishingProgramSourceNativeV3(f.db,f.workspace,programRing,programKey,f.owner.id,f.clock),families,programRing,programKey,f.commandKey,ledgerKey,f.clock,{target:async()=>{},authorize:async()=>{}});
 return {...f,service,billingOwner:owner,authority,controls:flags,binding,ledgerKey,guardianId,outbox,policy,db};
}
type Fixture=Awaited<ReturnType<typeof ready>>;
const plan=(f:Fixture)=>f.service().plan({version:BILLING_SERVICE_V4,quoteId:f.quote.id});
function due(f:Fixture,days=1){f.flags.now=new Date(Date.parse(f.quote.lines[0]!.dueAt!)+days*86400000+60000);}
type StoredRow={id:string;state:string;payload_ciphertext:string;[key:string]:unknown};
async function rows(f:Fixture){return {intents:(await engine.query<StoredRow>('SELECT * FROM ls_fishing_billing.reminders WHERE workspace_id=$1 ORDER BY id',[f.workspace])).rows,outbox:(await engine.query<StoredRow>('SELECT * FROM ls_service_interest.inquiry_email_outbox WHERE workspace_id=$1 AND purpose=\'academy_monthly_payment_reminder_v1\' ORDER BY id',[f.workspace])).rows};}
async function sent(f:Fixture,dispatchId:string,bad=false){
 const row=(await engine.query<{payload_ciphertext:string;created_at:Date}>('SELECT payload_ciphertext,created_at FROM ls_service_interest.inquiry_email_outbox WHERE workspace_id=$1 AND id=$2',[f.workspace,dispatchId])).rows[0]!;
 const body=JSON.parse(unseal(row.payload_ciphertext,'ls_service_interest/monthly_payment_reminder/v1/'+f.workspace+'/'+dispatchId,programRing)),reservedAt=row.created_at.toISOString();f.flags.now=new Date(f.clock.now().valueOf()+60000);const acceptedAt=f.clock.now().toISOString();
 const receipt=monthlyReminderProviderReceiptSchema.parse({version:'JLFA-MONTHLY-REMINDER-SEND-v1',workspaceId:f.workspace,outboxBindingId:f.binding.outboxBindingId,intentId:body.intentId,dispatchId,payloadSha256:bad?'f'.repeat(64):createHash('sha256').update(row.payload_ciphertext).digest('hex'),providerId:'SYNTHETIC_PROVIDER',reservedAt,acceptedAt});
 await engine.query("UPDATE ls_service_interest.inquiry_email_outbox SET state='sent',reserved_at=$3,completed_at=$4,provider_id=$5,monthly_receipt_ciphertext=$6 WHERE workspace_id=$1 AND id=$2",[f.workspace,dispatchId,reservedAt,acceptedAt,receipt.providerId,seal(JSON.stringify(receipt),'ls_service_interest/monthly_payment_reminder/v1/'+f.workspace+'/'+dispatchId+'/provider',programRing)]);
}
async function reserved(f:Fixture){await plan(f);due(f);const batch=await f.service().reserveBatch({limit:5}),r=batch.results.find(r=>r.state==='reserved');if(!r||r.state!=='reserved')throw Error('EXPECTED_RESERVATION');return r;}
it('cash-reminder-v4 plans stable exact V4 cash-due keys and reuses the same encrypted reminder rows without an owner Actor or transport',async()=>{
 const f=await ready(),first=await plan(f);expect(first.state).toBe('queued');expect(first.intents).toHaveLength(2);const before=await rows(f);expect((await plan(f)).intents).toEqual(first.intents);expect(await rows(f)).toEqual(before);expect(before.outbox).toHaveLength(0);expect(first.intents[0]!.key).toContain(BILLING_SERVICE_V4+'|cash_due|');
});
it('cash-reminder-v4 reserves the actual remaining child balance in the existing encrypted outbox with one last joint SQL decision',async()=>{
 const f=await ready();await f.billingOwner().recordCashDate(f.owner,{version:BILLING_SERVICE_V4,operationId:randomUUID(),quoteId:f.quote.id,expectedVersion:3,amountMinor:30000,currency:'USD',receivedPrecision:'date',receivedDate:'2035-01-02',timeZone:'America/New_York',allocations:[{lineId:f.quote.lines[0]!.id,amountMinor:30000}]});
 const r=await reserved(f);expect(r.remainingMinor).toBe(100000);expect(f.controls.terminalCalls).toBe(1);const stored=await rows(f);expect(stored.outbox).toHaveLength(1);expect(stored.outbox[0]!.state).toBe('queued');expect(stored.intents.filter(i=>i.state==='unknown')).toHaveLength(1);
 const envelope=JSON.parse(unseal(stored.outbox[0]!.payload_ciphertext as string,'ls_service_interest/monthly_payment_reminder/v1/'+f.workspace+'/'+r.dispatchId,programRing));expect(envelope.payload.amount.lines.map((l:{remainingMinor:number})=>l.remainingMinor)).toEqual([35000,65000]);
});
it.each(['active','cash','consented','verified','window_open','enabled','full_group'] as const)('cash-reminder-v4 suppresses or denies current %s gate without a durable outbox effect',async gate=>{
 const f=await ready();await engine.query('UPDATE synthetic_cash4.admission SET '+gate+'=$2 WHERE workspace_id=$1',[f.workspace,gate==='full_group']);
 if(gate==='active'||gate==='cash')await expect(plan(f)).rejects.toThrow('UNAVAILABLE');else expect((await plan(f)).state).toBe(gate==='window_open'?'deferred':'suppressed');expect((await rows(f)).outbox).toHaveLength(0);
});
it('cash-reminder-v4 creates no debt chase for unsigned, paid, paused or cancelled offers',async()=>{
 const unsigned=await ready(false);expect(await plan(unsigned)).toMatchObject({state:'suppressed',reason:'no_obligation'});
 const paid=await ready();await paid.billingOwner().recordCashDate(paid.owner,{version:BILLING_SERVICE_V4,operationId:randomUUID(),quoteId:paid.quote.id,expectedVersion:3,amountMinor:130000,currency:'USD',receivedPrecision:'date',receivedDate:'2035-01-02',timeZone:'America/New_York',allocations:paid.quote.lines.map(l=>({lineId:l.id,amountMinor:65000}))});expect(await plan(paid)).toMatchObject({state:'suppressed',reason:'paid'});expect((await rows(paid)).outbox).toHaveLength(0);
 const f=await ready();await f.billingOwner().setState(f.owner,{version:BILLING_SERVICE_V4,action:SERVICE_STATE_ACTION_V4,operationId:randomUUID(),quoteId:f.quote.id,expectedQuoteRevision:3,paused:true});expect(await plan(f)).toMatchObject({state:'suppressed',reason:'owner_paused'});
 await f.billingOwner().setState(f.owner,{version:BILLING_SERVICE_V4,action:SERVICE_STATE_ACTION_V4,operationId:randomUUID(),quoteId:f.quote.id,expectedQuoteRevision:4,cancel:true});expect(await plan(f)).toMatchObject({state:'suppressed',reason:'cancelled'});expect((await rows(f)).outbox).toHaveLength(0);
});
it.each(['outbox','terminal','length','changedConsent','wrongAmount'] as const)('cash-reminder-v4 rolls back UNKNOWN and actual encrypted outbox together on %s failure',async point=>{
 const f=await ready();await plan(f);due(f);const before=await rows(f);f.controls.outboxFails=point==='outbox';f.controls.denyTerminal=point==='terminal';f.controls.terminalLength=point==='length';f.controls.alterAfterReserve=point==='changedConsent';f.controls.wrongAmount=point==='wrongAmount';
 await expect(f.service().reserveBatch({limit:1})).rejects.toThrow('UNAVAILABLE');expect(await rows(f)).toEqual(before);
});
it('cash-reminder-v4 retains unknown reservation/outbox bytes through restart and requires the original dispatch fact',async()=>{
 const f=await ready(),r=await reserved(f),before=await rows(f);expect((await f.service().reserveBatch({limit:5})).results).toHaveLength(0);expect(await rows(f)).toEqual(before);
 expect(await f.service().recoverOutcome({intentId:r.intentId,dispatchId:r.dispatchId})).toMatchObject({state:'unresolved'});expect(await rows(f)).toEqual(before);
 await expect(f.service().recoverOutcome({intentId:r.intentId,dispatchId:randomUUID()})).rejects.toThrow('UNAVAILABLE');expect(await rows(f)).toEqual(before);
});
it('cash-reminder-v4 records actual adapter-verified provider acceptance as acceptance, not delivery, even after optout and cancellation',async()=>{
 const f=await ready(),r=await reserved(f);await f.billingOwner().setState(f.owner,{version:BILLING_SERVICE_V4,action:SERVICE_STATE_ACTION_V4,operationId:randomUUID(),quoteId:f.quote.id,expectedQuoteRevision:3,cancel:true});await engine.query('UPDATE synthetic_cash4.admission SET consented=false,window_open=false,cash=false WHERE workspace_id=$1',[f.workspace]);await sent(f,r.dispatchId);
 const result=await f.service().recoverOutcome({intentId:r.intentId,dispatchId:r.dispatchId});expect(result).toMatchObject({state:'recorded',intent:{state:'provider_accepted',providerId:'SYNTHETIC_PROVIDER'}});const before=await rows(f);expect(await f.service().recoverOutcome({intentId:r.intentId,dispatchId:r.dispatchId})).toEqual(result);expect(await rows(f)).toEqual(before);
});
it('cash-reminder-v4 denies a mismatched authenticated provider payload instead of falsely resolving UNKNOWN',async()=>{
 const f=await ready(),r=await reserved(f);await sent(f,r.dispatchId,true);const before=await rows(f);await expect(f.service().recoverOutcome({intentId:r.intentId,dispatchId:r.dispatchId})).rejects.toThrow('UNAVAILABLE');expect(await rows(f)).toEqual(before);
});
it('cash-reminder-v4 does not reset the bounded chase on policy revision or restart',async()=>{
 const f=await ready();await plan(f);await engine.query('UPDATE synthetic_cash4.admission SET policy=$2::jsonb WHERE workspace_id=$1',[f.workspace,JSON.stringify({...f.policy,policy:{...f.policy.policy,id:'SYNTHETIC-REVISED',revision:2}})]);expect(await plan(f)).toMatchObject({state:'owner_attention',reason:'reminder_budget_exhausted'});expect((await rows(f)).intents).toHaveLength(2);
});
it('cash-reminder-v4 checks service admission before private billing data and denies authority Date mutation',async()=>{
 const f=await ready();f.controls.denyGlobal=true;await expect(plan(f)).rejects.toThrow('UNAVAILABLE');expect(f.controls.privateBeforeTarget).toBe(0);f.controls.denyGlobal=false;f.controls.mutateClock=true;await expect(plan(f)).rejects.toThrow('UNAVAILABLE');expect((await rows(f)).intents).toHaveLength(0);
});
it('cash-reminder-v4 keeps unsupported WhatsApp separate and never invents an email fallback or personal sender',async()=>{
 const f=await ready();await engine.query('UPDATE synthetic_cash4.admission SET channels=$2::jsonb WHERE workspace_id=$1',[f.workspace,'["whatsapp","email"]']);await plan(f);due(f);
 // Force a known due WA intent first; the actual existing email-only adapter
 // rejects it, rolling back its UNKNOWN. This is NOT a working WA sender.
 const i=(await rows(f)).intents.find(i=>{const intent=reminderIntentSchema.parse(JSON.parse(unseal(i.payload_ciphertext,'ls_fishing_billing/v1/reminder/'+f.workspace+'/'+i.id,programRing)));return intent.channel==='whatsapp'&&Date.parse(intent.scheduledAt)<=f.clock.now().valueOf();})!;
 const db:IdentityStore={transaction:work=>f.db.transaction(tx=>work({query:async<R extends object>(sql:string,v:readonly unknown[]=[])=>sql.startsWith('SELECT due.id')?[{id:i.id,quoteId:f.quote.id}] as R[]:tx.query<R>(sql,v)}))};
 const before=await rows(f);await expect(f.service(db).reserveBatch({limit:1})).rejects.toThrow('UNAVAILABLE');expect(await rows(f)).toEqual(before);
});
it('cash-reminder-v4 blocks both planning and reservation on authenticated unresolved card state without changing it',async()=>{
 const f=await ready();await plan(f);const id=randomUUID(),operationId=randomUUID(),allocations=[{lineId:f.quote.lines[0]!.id,amountMinor:65000}];
 const attempt=cardAttemptSchema.parse({version:CARD_VERSION,id,workspaceId:f.workspace,quoteId:f.quote.id,familyId:f.quote.familyId,actorId:f.owner.id,revision:1,balanceVersion:3,binding:{accountId:'acct_SYNTHETIC',livemode:false,apiVersion:'2026-09-30.endive',verifiedBindingId:'SYNTHETIC-NO-PROVIDER'},command:{operationId,quoteId:f.quote.id,expectedVersion:3,selection:allocations},requestDigest:'a'.repeat(64),preparation:{version:CARD_VERSION,operationId,quoteId:f.quote.id,entityVersion:3,replayed:false,result:{attemptId:id,amountMinor:65000,allocations}},createdAt:f.clock.now().toISOString(),state:'unknown',dispatchId:randomUUID(),sessionId:null,checkoutUrl:null,paymentIntentId:null});
 await engine.query('INSERT INTO ls_fishing_billing.card_attempts VALUES($1,$2,$3,$4,$5,$6)',[f.workspace,id,f.quote.id,1,'unknown',seal(JSON.stringify(attempt),'ls_fishing_billing/card/v1/attempt/'+f.workspace+'/'+id,programRing)]);
 const before=await rows(f),card=(await engine.query('SELECT * FROM ls_fishing_billing.card_attempts WHERE workspace_id=$1',[f.workspace])).rows;expect(await plan(f)).toMatchObject({state:'blocked_unknown'});due(f);expect((await f.service().reserveBatch({limit:5})).results.every(r=>r.state==='blocked_unknown')).toBe(true);expect(await rows(f)).toEqual(before);expect((await engine.query('SELECT * FROM ls_fishing_billing.card_attempts WHERE workspace_id=$1',[f.workspace])).rows).toEqual(card);
});
it('cash-reminder-v4 keeps a typed post-COMMIT error uncertain and recovers the original reserved dispatch without another outbox row',async()=>{
 const f=await ready();await plan(f);due(f);let once=true;const db:IdentityStore={transaction:async work=>{const value=await f.db.transaction(work);if(once){once=false;throw new AppError('CONFLICT');}return value;}};
 await expect(f.service(db).reserveBatch({limit:1})).rejects.toThrow('UNAVAILABLE');const stored=await rows(f);expect(stored.outbox).toHaveLength(1);const row=stored.intents.find(i=>i.state==='unknown')!,intent=reminderIntentSchema.parse(JSON.parse(unseal(row.payload_ciphertext,'ls_fishing_billing/v1/reminder/'+f.workspace+'/'+row.id,programRing)));
 expect((await f.service().reserveBatch({limit:5})).results).toHaveLength(0);expect(await f.service().recoverOutcome({intentId:intent.id,dispatchId:intent.dispatchId})).toMatchObject({state:'unresolved'});expect(await rows(f)).toEqual(stored);
});
it('cash-reminder-v4 denies a missing terminal resolver instead of selecting a legacy owner or allow-all fallback',async()=>{
 const f=await ready(),ports={...f.authority};Reflect.deleteProperty(ports,'terminalReservationPermissions');expect(()=>f.service(f.db,ports)).toThrow('UNAVAILABLE');expect((await rows(f)).outbox).toHaveLength(0);
});
it('cash-reminder-v4 blocks a late UNKNOWN for another recipient before committing a new reservation',async()=>{
 const f=await ready();await plan(f);due(f);const before=await rows(f);f.controls.lateOtherUnknown=true;
 await expect(f.service().reserveBatch({limit:1})).rejects.toThrow('UNAVAILABLE');expect(await rows(f)).toEqual(before);
});
