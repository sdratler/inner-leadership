import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {beforeAll,afterAll,beforeEach,describe,it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {asId} from '../../src/lib/ids.ts';
import {AppError} from '../../src/lib/errors.ts';
import {seal,unseal} from '../../src/features/identity/crypto.ts';
import type {SqlSession} from '../../src/features/identity/store.ts';
import type {AccountFacts} from '../../src/features/identity/types.ts';
import {syntheticId,syntheticAccepted,syntheticWorkspace,syntheticGuardian} from '../../src/features/fishing-billing/fixtures.ts';
import {projectBalanceV2} from '../../src/features/fishing-billing/contracts-v2.ts';
import {planPaymentReminders} from '../../src/features/fishing-billing/reminders.ts';
import {REMINDER_SERVICE_VERSION,type ReminderOutboxPayload} from '../../src/features/fishing-billing/reminder-service.ts';
import {createFishingBillingReminderOutbox,BILLING_REMINDER_OUTBOX_PURPOSE,monthlyReminderProviderReceiptSchema,type BillingReminderOutboxAuthority,type BillingReminderApprovedMail} from '../../src/lib/fishing-billing-reminder-outbox.ts';

// Explicit memory-only SQL/AEAD adapter proof. Actual baseline outbox DDL plus
// the UNNUMBERED proposal; synthetic authority/inquiry/identity targets only.
// No URL, port, native migration runner, provider, transport, env or live data.
const db=new PGlite(),workspace=asId(syntheticWorkspace,'workspace'),reference=syntheticId(900),oldId=syntheticId(901),dispatch=syntheticId(902);
const at=new Date('2035-01-06T15:00:00Z'),ring={activeKeyId:'synthetic',keys:{synthetic:Buffer.alloc(32,7)}};
const binding={version:REMINDER_SERVICE_VERSION,mode:'test' as const,serviceBindingId:'SYNTHETIC_SERVICE',outboxBindingId:'SYNTHETIC_OUTBOX'};
const owner={id:asId(syntheticId(1),'account'),workspaceId:workspace,state:'active',role:'practitioner'} as AccountFacts;
const query=async<T extends object>(sql:string,values:readonly unknown[]=[])=> (await db.query<T>(sql,[...values])).rows;
async function transaction<T>(work:(c:{tx:SqlSession;workspaceId:typeof workspace;now:Date;actor:AccountFacts})=>Promise<T>){
 return db.transaction(tx=>work({tx:{query:async<T extends object>(sql:string,v:readonly unknown[]=[])=> (await tx.query<T>(sql,[...v])).rows},workspaceId:workspace,now:at,actor:owner}));
}
function setup(){
 const quote=syntheticAccepted(),balance=projectBalanceV2(quote,[]);
 const intent=planPaymentReminders({balance,policy:{id:'SYNTHETIC_POLICY',revision:1,source:quote.definition.terms,timeZone:'America/New_York',offsetsMinutes:[0]},audience:{guardianId:syntheticGuardian,channel:'email',audience:'individual',locale:'he',verified:true,consented:true,active:true},newId:()=>syntheticId(903)})[0]!;
 const payload:ReminderOutboxPayload={intent:{...intent,state:'unknown',dispatchId:dispatch},amount:{currency:'USD',quoteId:quote.id,familyId:quote.familyId,revision:quote.revision,remainingMinor:balance.remainingMinor,lines:balance.lines}};
 const mail:BillingReminderApprovedMail={reference,quoteId:quote.id,familyId:quote.familyId,guardianId:syntheticGuardian,locale:'he',from:'sender@example.invalid',to:'parent@example.invalid',template:quote.definition.terms,subject:'SYNTHETIC ONLY',text:'SYNTHETIC ONLY — not approved public copy',html:'<p>SYNTHETIC ONLY</p>'};
 const reservation=vi.fn<BillingReminderOutboxAuthority['reservation']>().mockImplementation(async()=>mail),service=vi.fn<BillingReminderOutboxAuthority['service']>().mockResolvedValue(),outcome=vi.fn<BillingReminderOutboxAuthority['outcome']>().mockResolvedValue();
 const outbox=createFishingBillingReminderOutbox({workspaceId:workspace,outboxBindingId:binding.outboxBindingId,keyring:ring,authority:{reservation,service,outcome}});
 const reserve=()=>transaction(c=>outbox.reserveService(c,binding,payload));
 const read=()=>transaction(c=>outbox.readServiceOutcome(c,binding,{intentId:payload.intent.id,dispatchId:dispatch}));
 return {quote,payload,mail,reservation,service,outcome,outbox,reserve,read};
}
beforeAll(async()=>{
 await db.exec('CREATE SCHEMA ls_identity;CREATE TABLE ls_identity.accounts(id uuid PRIMARY KEY);CREATE SCHEMA ls_service_interest;CREATE TABLE ls_service_interest.public_applications(workspace_id uuid,id uuid,PRIMARY KEY(workspace_id,id));CREATE TABLE synthetic_atomic_markers(id integer);');
 await db.exec(await readFile('migrations/0135_ls_inquiry_email_outbox.sql','utf8'));
 // Existing136 outbox delta only; no founder/campaign model or runtime imported.
 await db.exec("ALTER TABLE ls_service_interest.inquiry_email_outbox ADD COLUMN founder_id uuid,ADD COLUMN message_key text;ALTER TABLE ls_service_interest.inquiry_email_outbox DROP CONSTRAINT inquiry_email_outbox_workspace_id_application_id_key;CREATE UNIQUE INDEX inquiry_email_legacy_one ON ls_service_interest.inquiry_email_outbox(workspace_id,application_id) WHERE purpose='academy_inquiry_acknowledgment_v1';");
 await db.exec(await readFile('migrations/0137_ls_academy_owner_notifications.sql','utf8'));
 await db.exec(await readFile('migrations/proposals/UNNUMBERED_ls_monthly_reminder_outbox.sql','utf8'));
 await query('INSERT INTO ls_service_interest.public_applications VALUES($1,$2),($1,$3)',[workspace,reference,syntheticId(904)]);
},20000);
afterAll(async()=>{await db.close();});
beforeEach(async()=>{
 await db.exec('DELETE FROM ls_service_interest.inquiry_email_outbox;DELETE FROM synthetic_atomic_markers;');
 await query("INSERT INTO ls_service_interest.inquiry_email_outbox(workspace_id,id,application_id,purpose,payload_ciphertext,created_at) VALUES($1,$2,$3,'academy_inquiry_acknowledgment_v1','HISTORICAL_UNCHANGED',$4)",[workspace,oldId,reference,at]);
});
async function row(){return (await query<{ciphertext:string;state:string;purpose:string;providerId:string|null}>('SELECT payload_ciphertext AS ciphertext,state,purpose,provider_id AS "providerId" FROM ls_service_interest.inquiry_email_outbox WHERE id=$1',[dispatch]))[0]!;}
async function sent(f:ReturnType<typeof setup>,change:Record<string,unknown>={}){
 const saved=await row(),reservedAt=at.toISOString(),acceptedAt=at.toISOString();
 const receipt=monthlyReminderProviderReceiptSchema.parse({version:'JLFA-MONTHLY-REMINDER-SEND-v1',workspaceId:workspace,outboxBindingId:binding.outboxBindingId,intentId:f.payload.intent.id,dispatchId:dispatch,payloadSha256:createHash('sha256').update(saved.ciphertext).digest('hex'),providerId:'SYNTHETIC_PROVIDER_ID',reservedAt,acceptedAt,...change});
 const encrypted=seal(JSON.stringify(receipt),'ls_service_interest/monthly_payment_reminder/v1/'+workspace+'/'+dispatch+'/provider',ring);
 await query("UPDATE ls_service_interest.inquiry_email_outbox SET state='sent',reserved_at=$2,completed_at=$3,provider_id=$4,monthly_receipt_ciphertext=$5 WHERE id=$1",[dispatch,new Date(receipt.reservedAt),new Date(receipt.acceptedAt),'SYNTHETIC_PROVIDER_ID',encrypted]);
}
describe('existing outbox monthly reminder bridge, synthetic SQL only',()=>{
 it('stores one encrypted sibling message with the new purpose and preserves historical acknowledgment',async()=>{
  const f=setup();await f.reserve();const saved=await row();expect(saved.state).toBe('queued');expect(saved.purpose).toBe(BILLING_REMINDER_OUTBOX_PURPOSE);expect(saved.ciphertext).not.toContain(f.mail.to);
  const decoded=JSON.parse(unseal(saved.ciphertext,'ls_service_interest/monthly_payment_reminder/v1/'+workspace+'/'+dispatch,ring));expect(decoded.payload.amount.lines).toHaveLength(2);expect(decoded.mail.locale).toBe('he');
  expect((await query<{ciphertext:string}>('SELECT payload_ciphertext AS ciphertext FROM ls_service_interest.inquiry_email_outbox WHERE id=$1',[oldId]))[0]!.ciphertext).toBe('HISTORICAL_UNCHANGED');expect(f.reservation.mock.calls[0]![1].kind).toBe('service');
 });
 it('replays the exact reservation without resetting UNKNOWN or replacing ciphertext',async()=>{
  const f=setup();await f.reserve();await query("UPDATE ls_service_interest.inquiry_email_outbox SET state='unknown',reserved_at=$2 WHERE id=$1",[dispatch,at]);const before=await row();await transaction(c=>f.outbox.reserveService({...c,now:new Date(at.valueOf()+60000)},binding,f.payload));expect(await row()).toEqual(before);expect((await query('SELECT id FROM ls_service_interest.inquiry_email_outbox')).length).toBe(2);
 });
 it('rejects same dispatch with changed approved content without changing original row',async()=>{
  const f=setup();await f.reserve();const before=await row();f.mail.text='Different synthetic content';await expect(f.reserve()).rejects.toMatchObject({code:'UNAVAILABLE'});expect(await row()).toEqual(before);
 });
 it('shares rollback with the caller transaction when current authority fails',async()=>{
  const f=setup();f.reservation.mockRejectedValue(new AppError('UNAVAILABLE'));
  await expect(transaction(async c=>{await c.tx.query('INSERT INTO synthetic_atomic_markers VALUES(1)');await f.outbox.reserveService(c,binding,f.payload);})).rejects.toMatchObject({code:'UNAVAILABLE'});
  expect(await query('SELECT * FROM synthetic_atomic_markers')).toEqual([]);expect(await row()).toBeUndefined();
 });
 it('uses owner facts only in the owner reservation path and denies a parent role',async()=>{
  const f=setup();await transaction(c=>f.outbox.reserve(c,f.payload));expect(f.reservation.mock.calls[0]![1]).toMatchObject({kind:'owner',actor:{id:owner.id}});
  await expect(transaction(c=>f.outbox.reserve({...c,actor:{...owner,role:'parent'}},f.payload))).rejects.toMatchObject({code:'UNAVAILABLE'});
 });
 it('denies foreign workspace or mismatched outbox binding before resolving recipients',async()=>{
  const f=setup();await expect(transaction(c=>f.outbox.reserveService({...c,workspaceId:asId(syntheticId(999),'workspace')},binding,f.payload))).rejects.toMatchObject({code:'UNAVAILABLE'});
  await expect(transaction(c=>f.outbox.reserveService(c,{...binding,outboxBindingId:'OTHER'},f.payload))).rejects.toMatchObject({code:'UNAVAILABLE'});expect(f.reservation).not.toHaveBeenCalled();
 });
 it('does not turn WhatsApp into email or reserve a not-yet-reserved native intent',async()=>{
  const f=setup();f.payload.intent.channel='whatsapp';await expect(f.reserve()).rejects.toMatchObject({code:'UNAVAILABLE'});f.payload.intent.channel='email';f.payload.intent.state='queued';await expect(f.reserve()).rejects.toMatchObject({code:'UNAVAILABLE'});expect(f.reservation).not.toHaveBeenCalled();
 });
 it('rejects mismatched amount/scope or a foreign resolved recipient family',async()=>{
  const f=setup();f.payload.amount.remainingMinor--;await expect(f.reserve()).rejects.toMatchObject({code:'UNAVAILABLE'});f.payload.amount.remainingMinor++;f.mail.familyId=syntheticId(998);await expect(f.reserve()).rejects.toMatchObject({code:'UNAVAILABLE'});expect(await row()).toBeUndefined();
 });
 it('requires a real existing saved inquiry reference',async()=>{
  const f=setup();f.mail.reference=syntheticId(997);await expect(f.reserve()).rejects.toMatchObject({code:'UNAVAILABLE'});expect(await row()).toBeUndefined();
 });
 it('maps an authenticated late actual receipt to provider_accepted, never delivered',async()=>{
  const f=setup();await f.reserve();await sent(f);const result=await f.read();expect(result).toMatchObject({state:'provider_accepted',providerId:'SYNTHETIC_PROVIDER_ID',intentId:f.payload.intent.id,dispatchId:dispatch});expect(f.outcome).toHaveBeenCalledOnce();expect(f.reservation).toHaveBeenCalledOnce();
  // The read does not reuse current send eligibility or create a replacement.
  f.reservation.mockRejectedValue(new AppError('FORBIDDEN'));expect((await f.read())!.state).toBe('provider_accepted');expect(f.reservation).toHaveBeenCalledOnce();
 });
 it('cannot publish a sent state without an encrypted original receipt',async()=>{
  const f=setup();await f.reserve();await expect(query("UPDATE ls_service_interest.inquiry_email_outbox SET state='sent',reserved_at=$2,completed_at=$2,provider_id='FAKE' WHERE id=$1",[dispatch,at])).rejects.toThrow();expect(await f.read()).toBeNull();
 });
 it('rejects plaintext provider metadata tampering rather than claiming acceptance',async()=>{
  const f=setup();await f.reserve();await sent(f);await query("UPDATE ls_service_interest.inquiry_email_outbox SET provider_id='OTHER' WHERE id=$1",[dispatch]);await expect(f.read()).rejects.toMatchObject({code:'UNAVAILABLE'});
 });
 it('withholds a sealed acceptance whose reservation predates the original payload',async()=>{
  const f=setup();await f.reserve();await sent(f,{reservedAt:'2035-01-06T14:59:00.000Z',acceptedAt:'2035-01-06T14:59:01.000Z'});await expect(f.read()).rejects.toMatchObject({code:'UNAVAILABLE'});
 });
 it('authenticates created_at rather than trusting a changed plaintext chronology index',async()=>{
  const f=setup();await f.reserve();await sent(f);await query('UPDATE ls_service_interest.inquiry_email_outbox SET created_at=$2 WHERE id=$1',[dispatch,new Date(at.valueOf()-60000)]);await expect(f.read()).rejects.toMatchObject({code:'UNAVAILABLE'});
 });
 it('rejects a receipt for a foreign original payload or binding',async()=>{
  const f=setup();await f.reserve();await sent(f,{payloadSha256:'a'.repeat(64)});await expect(f.read()).rejects.toMatchObject({code:'UNAVAILABLE'});await sent(f,{outboxBindingId:'OTHER'});await expect(f.read()).rejects.toMatchObject({code:'UNAVAILABLE'});
 });
 it('queued, unknown and canceled states provide no fabricated send failure',async()=>{
  const f=setup();await f.reserve();expect(await f.read()).toBeNull();await query("UPDATE ls_service_interest.inquiry_email_outbox SET state='unknown',reserved_at=$2 WHERE id=$1",[dispatch,at]);expect(await f.read()).toBeNull();await query("UPDATE ls_service_interest.inquiry_email_outbox SET state='canceled',completed_at=$2 WHERE id=$1",[dispatch,at]);expect(await f.read()).toBeNull();
 });
 it('requires current service and actual family outcome authority for receipt reads',async()=>{
  const f=setup();await f.reserve();await sent(f);f.service.mockRejectedValue(new AppError('UNAVAILABLE'));await expect(f.read()).rejects.toMatchObject({code:'UNAVAILABLE'});expect(f.outcome).not.toHaveBeenCalled();
  f.service.mockResolvedValue();f.outcome.mockRejectedValue(new AppError('FORBIDDEN'));await expect(f.read()).rejects.toMatchObject({code:'UNAVAILABLE'});
 });
 it('detects replayed row reference and lookup-intent tampering',async()=>{
  const f=setup();await f.reserve();await query('UPDATE ls_service_interest.inquiry_email_outbox SET application_id=$2 WHERE id=$1',[dispatch,syntheticId(904)]);await expect(f.read()).rejects.toMatchObject({code:'UNAVAILABLE'});
  await query('UPDATE ls_service_interest.inquiry_email_outbox SET application_id=$2 WHERE id=$1',[dispatch,reference]);await expect(transaction(c=>f.outbox.readServiceOutcome(c,binding,{intentId:syntheticId(996),dispatchId:dispatch}))).rejects.toMatchObject({code:'UNAVAILABLE'});
 });
});
