import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { tripDatabase } from '../fixtures/individual-trips-database.ts';
import { blindEmail, seal, unseal } from '../../src/features/identity/crypto.ts';
import type { Actor } from '../../src/features/identity/types.ts';
import type { IdentityStore } from '../../src/features/identity/store.ts';
import type { TripCommand, TripDepartureInput } from '../../src/features/individual-trips/contract.ts';
import type { AuthEmailMessage } from '../../src/providers/email/transport.ts';
import { IndividualTripStore } from '../../src/features/individual-trips/store.ts';
import { queueTripOperationalMail, deliverTripOperationalMail, TRIP_OPERATIONAL_MAIL_VERSION, type TripOperationalMailAdmission, type TripOperationalMailRuntime, type TripOperationalTransportFactory } from '../../src/features/individual-trips/operational-mail.ts';

let fx: Awaited<ReturnType<typeof tripDatabase>>;
const network = vi.fn(async () => { throw new Error('REAL_NETWORK_NOT_ADMITTED'); });
const target = 'postgresql://synthetic.invalid/never-connected';
let bound: IdentityStore;
const profile = { guardianName: 'Synthetic Parent', phone: '', pickupAreas: ['Synthetic Boca'], contactConsent: true, marketingConsent: false };
const inputChild = { name: 'Synthetic Child', age: 11, mediaUse: false, fishingExperience: '', ownsRod: false };
type CommandInput = { [K in TripCommand['type']]: Omit<Extract<TripCommand, { type: K }>, 'operationId' | 'expectedRevision'> }[TripCommand['type']];
const mailEnv = () => ({ LS_DATABASE_URL: target, LS_INDIVIDUAL_TRIPS_ENABLED: 'true', LS_INDIVIDUAL_TRIPS_WORKSPACE_ID: fx.workspace,
  LS_INDIVIDUAL_TRIPS_OWNER_ACCOUNT_ID: fx.owner.actor.id, LS_INDIVIDUAL_TRIPS_OPERATIONAL_EMAIL_ENABLED: 'true',
  LS_AUTH_EMAIL_ENABLED: 'true', LS_AUTH_EMAIL_PROVIDER: 'gmail', LS_AUTH_GOOGLE_CLIENT_ID: 'synthetic-client', LS_AUTH_GOOGLE_CLIENT_SECRET: 'synthetic-secret',
  LS_AUTH_GOOGLE_REFRESH_TOKEN: 'synthetic-refresh', LS_AUTH_EMAIL_FROM: 'office@bneineviimacademy.org' });
const admission = (): TripOperationalMailAdmission => ({ purpose: TRIP_OPERATIONAL_MAIL_VERSION, workspaceId: fx.workspace, origin: fx.origin, databaseUrl: target });
const runtime = (actor = fx.parent.actor): TripOperationalMailRuntime => ({ store: bound, identity: fx.config, tripConfig: fx.tripConfig, clock: fx.clock, trips: fx.trips, actor });
async function rows<T extends object = Record<string, unknown>>(sql: string, values: unknown[] = []) { return (await fx.db.query<T>(sql, values)).rows; }
async function jobs(operationId?: string) { return rows<{ id: string; state: string; kind: string; payload_ciphertext: string; delivery_record_state: string; send_started_at: Date | null }>(
  'SELECT * FROM ls_individual_trips.operational_mail' + (operationId ? ' WHERE operation_id=$1' : '') + ' ORDER BY id', operationId ? [operationId] : []); }
function payload(job: { id: string; payload_ciphertext: string }) { return JSON.parse(unseal(job.payload_ciphertext, `trip-mail:${fx.workspace}:${job.id}`, fx.config.keyring)); }
function transport(effect: (message: Parameters<ReturnType<TripOperationalTransportFactory>['send']>[0]) => Promise<{ providerId: string }>): TripOperationalTransportFactory {
  return beforeSend => ({ nonIdempotent: true, send: async message => { await beforeSend(message); return effect(message); } });
}
async function execute(actor: Actor, input: CommandInput, enrollment = false) {
  const state = input.type === 'household.create' ? null : await fx.trips.read(actor);
  const command = { ...input, operationId: randomUUID(), expectedRevision: state?.revision ?? 0 } as TripCommand;
  const reply = await fx.trips.execute(actor, command, enrollment);
  const current = await fx.trips.read(fx.owner.actor);
  // Compatible with root's integrated same-transaction hook: unique operation /
  // household scope makes this explicit callback retry preserve the first bytes.
  await fx.store.transaction(tx => queueTripOperationalMail(tx, { identity: fx.config, tripConfig: fx.tripConfig, clock: fx.clock }, current, command, reply, actor.id));
  return { command, reply, state: current };
}
async function household(actor = fx.parent.actor) {
  await execute(actor, { type: 'household.create', profile }, true);
  return execute(actor, { type: 'child.save', child: inputChild });
}
async function request(actor = fx.parent.actor) {
  const child = await household(actor);
  return execute(actor, { type: 'availability.save', childId: child.reply.id!, selection: 'any', options: [{ date: sundayDate(), kind: 'local', pickupAreas: ['Synthetic Boca'] }], note: '' });
}
function sundayDate() {
  const date = new Date(fx.clock.now().getTime() + 14 * 86400000); date.setUTCDate(date.getUTCDate() + (7 - date.getUTCDay()) % 7);
  return date.toISOString().slice(0, 10);
}
async function offer(count=1) {
  const saved = await request(), date = sundayDate();
  const departure: TripDepartureInput = { kind: 'local', title: 'Synthetic Sunday outing', desiredChildLimit: 10, activityChildLimit: 10, sonAttending: true, otherNonpayingChildren: [],
    transport: { verified: true, totalSeats: 12, driverAdults: 1, otherAdults: 0, vehicleId: 'synthetic-vehicle' }, ownerResourceId: 'synthetic-owner', minimumPaid: 1, operationalReady: true,
    pickupHub: { id: 'synthetic-hub', label: 'Synthetic exact pickup hub', permissionConfirmed: true }, departureAt: date + 'T15:00:00Z', returnAt: date + 'T20:00:00Z', fishingStartAt: date + 'T16:00:00Z', fishingEndAt: date + 'T19:00:00Z', mediaGroup: 'no', equipment: 'Synthetic supplied rod', water: 'Synthetic included water' };
  const plan = await execute(fx.owner.actor, { type: 'departure.save', departure });
  for(let i=1;i<count;i++)await execute(fx.parent.actor,{type:'child.save',child:{...inputChild,name:'Cancelled Sibling'}});
  const family=(await fx.trips.read(fx.owner.actor)).households[0]!;
  return execute(fx.owner.actor, { type: 'offer.prepare', departureId: plan.reply.id!, householdId: saved.state.households[0]!.id, childIds: family.children.map(child => child.id), ownerNote: 'Private owner note never mailed', requestBindings: [] });
}
beforeAll(async () => {
  vi.stubGlobal('fetch', network); fx = await tripDatabase();
  if (!(await rows<{ table: string | null }>("SELECT to_regclass('ls_individual_trips.operational_mail')::text AS table"))[0]?.table)
    await fx.db.exec(await readFile(new URL('../../src/features/individual-trips/mail-schema.sql', import.meta.url), 'utf8'));
  bound = { transaction: fx.store.transaction, bindDatabaseTarget: expected => expected === target ? bound : null };
}, 25000);
beforeEach(async () => {
  fx.time.now = new Date(Math.max(Date.now(), Date.parse('2026-11-27T16:00:00Z')));
  await fx.db.exec('TRUNCATE ls_individual_trips.state,ls_individual_trips.state_chunks,ls_individual_trips.memberships,ls_individual_trips.operations CASCADE');
  await fx.db.query("UPDATE ls_identity.accounts SET state='active',email_verified_at=$2,email_blind=$3,email_ciphertext=$4 WHERE id=$1", [fx.parent.actor.id, fx.clock.now(), blindEmail(fx.parent.email, fx.config.lookupKey), seal(fx.parent.email, `email:${fx.workspace}:${fx.parent.actor.id}`, fx.config.keyring)]);
  await fx.db.query('UPDATE ls_identity.sessions SET revoked_at=NULL,expires_at=$1', [new Date(fx.clock.now().getTime() + 90 * 86400000)]);
});
afterAll(async () => { try { expect(network).not.toHaveBeenCalled(); await fx?.db.close(); } finally { vi.unstubAllGlobals(); } });

describe('native operational mail queue', () => {
  it('the actual queueMail-enabled store commits one request/job together, then replays without another callback or job', async () => {
    const child = await household(), committed = vi.fn();
    const trips = new IndividualTripStore(fx.store, fx.config, fx.tripConfig, fx.clock, { queueMail: true, onCommitted: committed });
    const command: TripCommand = { type: 'availability.save', operationId: randomUUID(), expectedRevision: (await trips.read(fx.parent.actor)).revision,
      childId: child.reply.id!, selection: 'any', options: [{ date: sundayDate(), kind: 'local', pickupAreas: ['Synthetic Boca'] }], note: '' };
    const first = await trips.execute(fx.parent.actor, command);
    expect(await jobs(command.operationId)).toHaveLength(1);
    expect((await trips.read(fx.parent.actor)).households[0]!.availability[0]!.id).toBe(first.id);
    expect(committed).toHaveBeenCalledExactlyOnceWith(fx.parent.actor, command.operationId);
    const bytes = (await jobs(command.operationId))[0]!.payload_ciphertext;
    expect(await trips.execute(fx.parent.actor, command)).toEqual({ ...first, replayed: true });
    expect(committed).toHaveBeenCalledTimes(1); expect(await jobs(command.operationId)).toHaveLength(1);
    expect((await jobs(command.operationId))[0]!.payload_ciphertext).toBe(bytes);
  });

  it('the actual store rolls back request state and operation receipt when its mail table is unavailable', async () => {
    const child = await household(), committed = vi.fn();
    const trips = new IndividualTripStore(fx.store, fx.config, fx.tripConfig, fx.clock, { queueMail: true, onCommitted: committed });
    const before = await trips.read(fx.parent.actor), command: TripCommand = { type: 'availability.save', operationId: randomUUID(), expectedRevision: before.revision,
      childId: child.reply.id!, selection: 'any', options: [{ date: sundayDate(), kind: 'local', pickupAreas: [] }], note: '' };
    // Only this test's in-memory engine is altered; no connection/DSN exists.
    await fx.db.exec('ALTER TABLE ls_individual_trips.operational_mail RENAME TO operational_mail_unavailable');
    try { await expect(trips.execute(fx.parent.actor, command)).rejects.toThrow('operational_mail'); }
    finally { await fx.db.exec('ALTER TABLE ls_individual_trips.operational_mail_unavailable RENAME TO operational_mail'); }
    expect(await trips.read(fx.parent.actor)).toEqual(before); expect(committed).not.toHaveBeenCalled();
    expect(await jobs(command.operationId)).toHaveLength(0);
    expect(await rows('SELECT operation_id FROM ls_individual_trips.operations WHERE operation_id=$1', [command.operationId])).toHaveLength(0);
  });

  it('free date interest queues one private native recipient snapshot and creates no payment clock', async () => {
    const saved = await request(), [job] = await jobs(saved.command.operationId), body = payload(job!);
    expect(job).toMatchObject({ state: 'queued', kind: 'request_saved' });
    expect(body).toMatchObject({ recipient: fx.parent.email, version: TRIP_OPERATIONAL_MAIL_VERSION });
    expect(body.text).toContain('Any one'); expect(body.text).toContain('no booked place, charge or payment deadline');
    expect(body.text).toContain('\n\n');expect(body.text).not.toContain('\\n');
    expect(JSON.stringify(job)).not.toContain(fx.parent.email); expect(JSON.stringify(job)).not.toContain(inputChild.name);
    expect(saved.state.offers).toHaveLength(0); expect(saved.state.receipts).toHaveLength(0);
    const bytes = job!.payload_ciphertext;
    await fx.store.transaction(tx => queueTripOperationalMail(tx, { identity: fx.config, tripConfig: fx.tripConfig, clock: fx.clock }, saved.state, saved.command, saved.reply, fx.parent.actor.id));
    expect(await jobs(saved.command.operationId)).toHaveLength(1); expect((await jobs(saved.command.operationId))[0]!.payload_ciphertext).toBe(bytes);
  });

  it('queues seasonal save and withdrawal without Sunday selection, debt, place or timer', async () => {
    const child = await household(), saved = await execute(fx.parent.actor, { type: 'seasonal.save', season: 'pesach', year: 2027,
      childIds: [child.reply.id!], periods: ['during', 'dates_unsure'], possibleWeeks: [], pickupAreas: ['Synthetic Boca'], note: '' });
    expect(payload((await jobs(saved.command.operationId))[0]!).text).toContain('During');
    const withdrawn = await execute(fx.parent.actor, { type: 'seasonal.withdraw', season: 'pesach', year: 2027 });
    expect((await jobs(withdrawn.command.operationId))[0]!.kind).toBe('seasonal_withdrawn');
    expect(withdrawn.state.offers).toHaveLength(0); expect(withdrawn.state.creditLedger).toHaveLength(0);
  });

  it('requires the exact native operation and verified adult membership instead of guessed family/account data', async () => {
    const saved = await request(), stranger = await fx.account();
    const command = { ...saved.command, operationId: randomUUID() };
    await expect(fx.store.transaction(tx => queueTripOperationalMail(tx, { identity: fx.config, tripConfig: fx.tripConfig, clock: fx.clock }, saved.state, command, saved.reply, fx.parent.actor.id))).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await fx.db.query('DELETE FROM ls_individual_trips.operational_mail WHERE operation_id=$1', [saved.command.operationId]);
    const forged = structuredClone(saved.state); forged.households[0]!.ownerAccountId = stranger.actor.id;
    await fx.store.transaction(tx => queueTripOperationalMail(tx, { identity: fx.config, tripConfig: fx.tripConfig, clock: fx.clock }, forged, saved.command, { ...saved.reply, householdId: forged.households[0]!.id }, fx.parent.actor.id));
    expect(await jobs(saved.command.operationId)).toHaveLength(0);
  });

  it('rolls queue inserts back with the operation transaction and never accesses a provider', async () => {
    const saved = await request(), operationId = randomUUID(), command = { ...saved.command, operationId };
    await expect(fx.store.transaction(async tx => {
      await tx.query('INSERT INTO ls_individual_trips.operations SELECT workspace_id,$1,actor_account_id,request_digest,reply_ciphertext,created_at FROM ls_individual_trips.operations WHERE operation_id=$2', [operationId, saved.command.operationId]);
      await queueTripOperationalMail(tx, { identity: fx.config, tripConfig: fx.tripConfig, clock: fx.clock }, saved.state, command, saved.reply, fx.parent.actor.id);
      throw new Error('synthetic rollback');
    })).rejects.toThrow('synthetic rollback');
    expect(await jobs(operationId)).toHaveLength(0);
  });
});

describe('exact-operation delivery admission and evidence', () => {
  it('delivers only the supplied operation and never resends a terminal sent job', async () => {
    const saved = await request(), next = await execute(fx.parent.actor, { type: 'availability.withdraw', requestId: saved.reply.id! });
    const send = vi.fn(async (message: AuthEmailMessage) => { expect(message.to).toBe(fx.parent.email); return { providerId: 'synthetic-gmail-id' }; });
    expect(await deliverTripOperationalMail(runtime(), saved.command.operationId, mailEnv(), admission(), transport(send))).toEqual([expect.objectContaining({ state: 'sent' })]);
    expect(send).toHaveBeenCalledTimes(1); expect(send.mock.calls[0]?.[0]).toMatchObject({ to: fx.parent.email });
    expect((await jobs(next.command.operationId))[0]!.state).toBe('queued');
    await deliverTripOperationalMail(runtime(), saved.command.operationId, mailEnv(), admission(), transport(send)); expect(send).toHaveBeenCalledTimes(1);
  });

  it('requires purpose, workspace, origin, feature flags, exact original driver and captured operation actor', async () => {
    const saved = await request(), provider = vi.fn(transport(async () => ({ providerId: 'never' })));
    const cases = [
      { env: mailEnv(), grant: null, current: runtime() },
      { env: { ...mailEnv(), LS_INDIVIDUAL_TRIPS_OPERATIONAL_EMAIL_ENABLED: 'false' }, grant: admission(), current: runtime() },
      { env: { ...mailEnv(), LS_DATABASE_URL: target + '-other' }, grant: admission(), current: runtime() },
      { env: mailEnv(), grant: { ...admission(), workspaceId: randomUUID() }, current: runtime() },
      { env: mailEnv(), grant: { ...admission(), origin: 'https://wrong.example.invalid' }, current: runtime() },
      { env: mailEnv(), grant: admission(), current: { ...runtime(), store: fx.store } },
      { env: mailEnv(), grant: admission(), current: runtime(fx.owner.actor) },
    ];
    for (const item of cases) expect(await deliverTripOperationalMail(item.current, saved.command.operationId, item.env, item.grant, provider)).toEqual([]);
    expect(provider).not.toHaveBeenCalled(); expect((await jobs(saved.command.operationId))[0]!.state).toBe('queued');
  });

  it.each(['account', 'membership', 'email', 'session'] as const)('rechecks %s before sending a frozen recipient snapshot', async kind => {
    const saved = await request(), send = vi.fn(async () => ({ providerId: 'never' }));
    if (kind === 'account') await fx.db.query("UPDATE ls_identity.accounts SET state='revoked' WHERE id=$1", [fx.parent.actor.id]);
    if (kind === 'membership') await fx.db.query("UPDATE ls_individual_trips.memberships SET state='revoked',revoked_at=$2 WHERE account_id=$1", [fx.parent.actor.id, fx.clock.now()]);
    if (kind === 'email') await fx.db.query('UPDATE ls_identity.accounts SET email_blind=$2 WHERE id=$1', [fx.parent.actor.id, blindEmail('changed@example.invalid', fx.config.lookupKey)]);
    if (kind === 'session') await fx.db.query('UPDATE ls_identity.sessions SET revoked_at=$2 WHERE account_id=$1', [fx.parent.actor.id, fx.clock.now()]);
    expect(await deliverTripOperationalMail(runtime(), saved.command.operationId, mailEnv(), admission(), transport(send))).toEqual([expect.objectContaining({ state: 'canceled' })]); expect(send).not.toHaveBeenCalled();
  });

  it('records provider uncertainty once and never retries the unknown job', async () => {
    const saved = await request(), send = vi.fn(async () => { throw new Error('synthetic uncertain response'); });
    expect(await deliverTripOperationalMail(runtime(), saved.command.operationId, mailEnv(), admission(), transport(send))).toEqual([expect.objectContaining({ state: 'unknown' })]);
    expect((await jobs(saved.command.operationId))[0]!.send_started_at).not.toBeNull();
    await deliverTripOperationalMail(runtime(), saved.command.operationId, mailEnv(), admission(), transport(send)); expect(send).toHaveBeenCalledTimes(1);
  });

  it('retains a known pre-send failure as terminal failed, with no provider call or retry', async () => {
    const saved = await request(), factory = vi.fn(transport(async () => ({ providerId: 'never' })));
    expect(await deliverTripOperationalMail(runtime(), saved.command.operationId, { ...mailEnv(), LS_AUTH_GOOGLE_CLIENT_SECRET: undefined }, admission(), factory)).toEqual([expect.objectContaining({ state: 'failed' })]);
    await deliverTripOperationalMail(runtime(), saved.command.operationId, mailEnv(), admission(), factory); expect(factory).not.toHaveBeenCalled();
  });

  it('serializes PGlite competing dispatches to one send, not a PostgreSQL MVCC proof', async () => {
    const saved = await request(), send = vi.fn(async () => { await new Promise(resolve => setTimeout(resolve, 5)); return { providerId: 'synthetic-single-send' }; });
    await Promise.all([deliverTripOperationalMail(runtime(), saved.command.operationId, mailEnv(), admission(), transport(send)),
      deliverTripOperationalMail(runtime(), saved.command.operationId, mailEnv(), admission(), transport(send))]);
    expect(send).toHaveBeenCalledTimes(1); expect((await jobs(saved.command.operationId))[0]!.state).toBe('sent');
  });

  it('rechecks the captured recipient after OAuth and refuses a changed mailbox', async () => {
    const saved = await request(), send = vi.fn(async () => ({ providerId: 'never' }));
    const factory: TripOperationalTransportFactory = beforeSend => ({ send: async message => {
      await fx.db.query('UPDATE ls_identity.accounts SET email_blind=$2 WHERE id=$1', [fx.parent.actor.id, blindEmail('after-oauth@example.invalid', fx.config.lookupKey)]);
      await beforeSend(message); return send();
    } });
    expect(await deliverTripOperationalMail(runtime(), saved.command.operationId, mailEnv(), admission(), factory)).toEqual([expect.objectContaining({ state: 'failed' })]); expect(send).not.toHaveBeenCalled();
  });
});

describe('actual offer delivery and payment truth', () => {
  it('excludes a cancelled sibling from the actual departure confirmation',async()=>{
    const saved=await offer(2),current=saved.state.offers[0]!;
    await deliverTripOperationalMail(runtime(fx.owner.actor),saved.command.operationId,mailEnv(),admission(),transport(async()=>({providerId:'synthetic-offer'})));
    await execute(fx.parent.actor,{type:'offer.accept',offerId:current.id,quoteId:current.quoteId,acceptedDate:current.snapshot.date,pickupHubId:current.snapshot.pickupHubId});
    await execute(fx.owner.actor,{type:'cash.record_received',offerId:current.id,receiptReference:'synthetic-two-children',amountMinor:25000});
    await execute(fx.parent.actor,{type:'booking.cancel',offerId:current.id,childIds:[current.children[1]!.childId],reason:'parent'});
    const confirmed=await execute(fx.owner.actor,{type:'departure.confirm',departureId:current.departureId}),job=(await jobs(confirmed.command.operationId))[0]!;
    expect(payload(job).text).toContain('Synthetic Child: $150.00');expect(payload(job).text).not.toContain('Cancelled Sibling');
  });
  it('queues invoice-closure cancellation credit using persisted operation time with an advancing clock',async()=>{
    const saved=await offer(),current=saved.state.offers[0]!;
    await deliverTripOperationalMail(runtime(fx.owner.actor),saved.command.operationId,mailEnv(),admission(),transport(async()=>({providerId:'synthetic-offer'})));
    await execute(fx.parent.actor,{type:'offer.accept',offerId:current.id,quoteId:current.quoteId,acceptedDate:current.snapshot.date,pickupHubId:current.snapshot.pickupHubId});
    await execute(fx.owner.actor,{type:'invoice.attach',offerId:current.id,invoiceId:'in_advancing',url:'https://invoice.stripe.com/i/synthetic',amountMinor:15000,customerId:'cus_synthetic',customerEmailBlind:'a'.repeat(64)});
    await execute(fx.owner.actor,{type:'cash.record_received',offerId:current.id,receiptReference:'synthetic-closure-cash',amountMinor:15000});
    await execute(fx.parent.actor,{type:'booking.cancel',offerId:current.id,childIds:[current.children[0]!.childId],reason:'parent'});
    const advancing={now:()=>{fx.time.now=new Date(fx.clock.now().getTime()+17);return fx.clock.now();}},store=new IndividualTripStore(fx.store,fx.config,fx.tripConfig,advancing,{queueMail:true});
    const operationId=randomUUID();await store.executeInternal(fx.owner.actor,{type:'invoice.reconcile_closed',operationId,expectedRevision:(await store.read(fx.owner.actor)).revision,offerId:current.id,invoiceId:'in_advancing',status:'paid',allPaymentsReconciled:true});
    const job=(await jobs(operationId))[0]!;expect(job.kind).toBe('cancellation');expect(payload(job).text).toContain('credit restored: $150.00');
  });
  it('starts the native48h clock only after proven successful send, using the exact saved offer', async () => {
    const saved = await offer(), initial = saved.state.offers[0]!;
    expect(initial.sentAt).toBeNull(); expect(initial.paymentDeadline).toBeNull();
    const job = (await jobs(saved.command.operationId))[0]!, body = payload(job), messages: string[] = [];
    expect(body.text).toContain(initial.snapshot.pickupHubLabel); expect(body.text).toContain('$150.00'); expect(body.text).not.toContain('Private owner note');
    const actual = fx.clock.now().toISOString();
    const result = await deliverTripOperationalMail(runtime(fx.owner.actor), saved.command.operationId, mailEnv(), admission(), transport(async message => { messages.push(message.text); fx.time.now = new Date(fx.clock.now().getTime() + 5000); return { providerId: 'synthetic-offer-id' }; }));
    expect(result).toEqual([expect.objectContaining({ state: 'sent', deliveryRecordState: 'recorded' })]);
    const reloaded = (await fx.trips.read(fx.owner.actor)).offers[0]!;
    expect(reloaded.sentAt).toBe(actual); expect(reloaded.paymentDeadline).toBe(new Date(Date.parse(actual) + 48 * 3600_000).toISOString());
    expect(messages[0]).toContain('Payment deadline:');
  });

  it('holds a short-notice offer instead of inventing a deadline or starting its clock', async () => {
    const saved = await offer(); fx.time.now = new Date(Date.parse(saved.state.offers[0]!.snapshot.departureAt) - 24 * 3600_000);
    const send = vi.fn(async () => ({ providerId: 'never' }));
    expect(await deliverTripOperationalMail(runtime(fx.owner.actor), saved.command.operationId, mailEnv(), admission(), transport(send))).toEqual([expect.objectContaining({ state: 'held' })]);
    expect(send).not.toHaveBeenCalled(); expect((await fx.trips.read(fx.owner.actor)).offers[0]!.paymentDeadline).toBeNull();
  });

  it.each(['sent', 'unknown'] as const)('never sends an offer whose native delivery is already %s', async deliveryState => {
    const saved = await offer(), offerId = saved.state.offers[0]!.id, send = vi.fn(async () => ({ providerId: 'never' }));
    if (deliveryState === 'sent') await fx.trips.recordManualDelivery(fx.owner.actor, { type: 'delivery.record_sent', operationId: randomUUID(), expectedRevision: saved.state.revision, offerId, sentAt: fx.clock.now().toISOString() }, 'synthetic actual manual delivery');
    else await fx.trips.executeInternal(fx.owner.actor, { type: 'delivery.record_unknown', operationId: randomUUID(), expectedRevision: saved.state.revision, offerId });
    const deadline = (await fx.trips.read(fx.owner.actor)).offers[0]!.paymentDeadline;
    expect(await deliverTripOperationalMail(runtime(fx.owner.actor), saved.command.operationId, mailEnv(), admission(), transport(send))).toEqual([expect.objectContaining({ state: 'held' })]);
    expect((await fx.trips.read(fx.owner.actor)).offers[0]!.paymentDeadline).toBe(deadline); expect(send).not.toHaveBeenCalled();
  });

  it('keeps uncertain offer delivery clockless and visible as native unknown', async () => {
    const saved = await offer(), send = vi.fn(async () => { throw new Error('synthetic timeout'); });
    expect(await deliverTripOperationalMail(runtime(fx.owner.actor), saved.command.operationId, mailEnv(), admission(), transport(send))).toEqual([expect.objectContaining({ state: 'unknown' })]);
    const current = (await fx.trips.read(fx.owner.actor)).offers[0]!;
    expect(current.deliveryState).toBe('unknown'); expect(current.paymentDeadline).toBeNull();
    await deliverTripOperationalMail(runtime(fx.owner.actor), saved.command.operationId, mailEnv(), admission(), transport(send)); expect(send).toHaveBeenCalledTimes(1);
  });

  it('retains actual provider acceptance when the separate native offer-clock write fails, without resending', async () => {
    const saved = await offer(), send = vi.fn(async () => ({ providerId: 'synthetic-accepted' }));
    const current = { ...runtime(fx.owner.actor), trips: { read: fx.trips.read.bind(fx.trips), executeInternal: vi.fn(async () => { throw new Error('synthetic domain commit failure'); }) } };
    expect(await deliverTripOperationalMail(current, saved.command.operationId, mailEnv(), admission(), transport(send))).toEqual([expect.objectContaining({ state: 'sent', deliveryRecordState: 'unknown' })]);
    expect((await fx.trips.read(fx.owner.actor)).offers[0]!.paymentDeadline).toBeNull();
    await deliverTripOperationalMail(current, saved.command.operationId, mailEnv(), admission(), transport(send)); expect(send).toHaveBeenCalledTimes(1);
  });

  it('does not downgrade a committed sent receipt when later delivery-record metadata cannot commit', async () => {
    const saved = await offer(), send = vi.fn(async () => ({ providerId: 'synthetic-accepted' }));
    const failing: IdentityStore = { bindDatabaseTarget: expected => expected === target ? failing : null,
      transaction: work => fx.store.transaction(tx => work({ query: async <T extends object>(sql: string, values: readonly unknown[] = []) => {
        if (sql.includes('SET delivery_record_state=')) throw new Error('synthetic metadata failure');
        return tx.query<T>(sql, values);
      } })) };
    const current = { ...runtime(fx.owner.actor), store: failing };
    expect(await deliverTripOperationalMail(current, saved.command.operationId, mailEnv(), admission(), transport(send))).toEqual([expect.objectContaining({ state: 'sent', deliveryRecordState: 'unknown' })]);
    expect((await jobs(saved.command.operationId))[0]!.state).toBe('sent');
    expect((await fx.trips.read(fx.owner.actor)).offers[0]!.paymentDeadline).not.toBeNull();
    await deliverTripOperationalMail(current, saved.command.operationId, mailEnv(), admission(), transport(send)); expect(send).toHaveBeenCalledTimes(1);
  });

  it('queues actual cash receipt evidence but not an attached invoice as payment', async () => {
    const saved = await offer(), offerId = saved.state.offers[0]!.id;
    await deliverTripOperationalMail(runtime(fx.owner.actor), saved.command.operationId, mailEnv(), admission(), transport(async () => ({ providerId: 'synthetic-offer' })));
    const current = (await fx.trips.read(fx.parent.actor)).offers[0]!;
    await execute(fx.parent.actor, { type: 'offer.accept', offerId, quoteId: current.quoteId, acceptedDate: current.snapshot.date, pickupHubId: current.snapshot.pickupHubId });
    const attached = await execute(fx.owner.actor, { type: 'invoice.attach', offerId, invoiceId: 'in_synthetic', url: 'https://invoice.stripe.com/i/synthetic', amountMinor: 15000,customerId:'cus_synthetic',customerEmailBlind:'a'.repeat(64) });
    expect(await jobs(attached.command.operationId)).toHaveLength(0);
    const paid = await execute(fx.owner.actor, { type: 'cash.record_received', offerId, receiptReference: 'synthetic-cash-1', amountMinor: 15000 });
    const [job] = await jobs(paid.command.operationId); expect(job!.kind).toBe('payment'); expect(payload(job!).text).toContain('Actual payment received: $150.00');
    const duplicate = await execute(fx.owner.actor, { type: 'cash.record_received', offerId, receiptReference: 'synthetic-cash-1', amountMinor: 15000 });
    expect(await jobs(duplicate.command.operationId)).toHaveLength(0);
  });

  it('queues paid departure confirmation and actual cancellation credit without claiming a cash refund', async () => {
    const saved = await offer(), current = saved.state.offers[0]!;
    await deliverTripOperationalMail(runtime(fx.owner.actor), saved.command.operationId, mailEnv(), admission(), transport(async () => ({ providerId: 'synthetic-offer' })));
    await execute(fx.parent.actor, { type: 'offer.accept', offerId: current.id, quoteId: current.quoteId, acceptedDate: current.snapshot.date, pickupHubId: current.snapshot.pickupHubId });
    await execute(fx.owner.actor, { type: 'cash.record_received', offerId: current.id, receiptReference: 'synthetic-cash', amountMinor: 15000 });
    const confirmation = await execute(fx.owner.actor, { type: 'departure.confirm', departureId: current.departureId });
    expect((await jobs(confirmation.command.operationId))[0]!.kind).toBe('confirmation');
    const cancel = await execute(fx.parent.actor, { type: 'booking.cancel', offerId: current.id, childIds: current.children.map(child => child.childId), reason: 'parent' });
    const [job] = await jobs(cancel.command.operationId); expect(job!.kind).toBe('cancellation');
    expect(payload(job!).text).toContain('credit restored: $150.00'); expect(payload(job!).text).toContain('No voluntary cash refund');
  });
});
