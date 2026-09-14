/** Prepared regression packet. Execution uses the existing opt-in disposable PostgreSQL fixture only. */
import { randomUUID } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { fixture, poolStore, type Fixture } from './fixture.ts';
import { drainCalendarEventsIsolated } from '../../../src/features/calendar/relay.ts';
import type { AppointmentId, CalendarEvent } from '../../../src/features/calendar/types.ts';
import { systemClock } from '../../../src/features/identity/types.ts';
import { applyCalendarCreditEffect } from '../../../src/features/payments/calendar-consumer.ts';
import { BLOCK_PRICE_MINOR } from '../../../src/features/payments/policy.ts';
import { PaymentsService } from '../../../src/features/payments/service.ts';
import { PaymentsStore } from '../../../src/features/payments/store.ts';

async function usingFixture(work: (f: Fixture, payments: PaymentsService) => Promise<void>) {
  const f = await fixture({ termsVersion: 'Product2.3' });
  const payments = new PaymentsService(new PaymentsStore(poolStore(f.pool), f.keyring, systemClock));
  try { await work(f, payments); } finally { await f.pool.end(); }
}

async function purchase(f: Fixture, payments: PaymentsService, caseRecord = f.first) {
  const charge = await payments.createCharge(f.practitioner.actor, randomUUID(), {
    caseId: caseRecord.id, dueOn: f.at(0).slice(0, 10),
  });
  const payment = await payments.recordPayment(f.practitioner.actor, randomUUID(), {
    caseId: caseRecord.id, amountMinor: BLOCK_PRICE_MINOR, method: 'bank_transfer',
    receivedAt: f.at(-1), privateReference: 'Synthetic manual payment; no provider call',
  });
  const allocation = await payments.allocate(f.practitioner.actor, randomUUID(), {
    caseId: caseRecord.id, paymentId: payment.paymentId, chargeId: charge.chargeId, amountMinor: BLOCK_PRICE_MINOR,
  });
  if (!allocation.creditBlockId) throw new Error('Expected completed manual allocation to create a block');
  return { charge, payment, allocation, blockId: allocation.creditBlockId };
}

function drain(f: Fixture, retryAppointmentId: string | null = null) {
  return f.db.read(f.practitioner.actor, c =>
    drainCalendarEventsIsolated(c, 'credit_effect', applyCalendarCreditEffect, 25, retryAppointmentId));
}

async function attend(f: Fixture, hours: number, caseRecord = f.first) {
  const appointmentId = await f.seed(f.at(hours), caseRecord);
  const input = { state: 'present' as const, arrivedAt: f.at(hours), expectedVersion: 0, correctionReason: null };
  const commandKey = randomUUID();
  const appointment = await f.service.recordAttendance(f.practitioner.actor, appointmentId, commandKey, input);
  return { appointmentId, appointment, commandKey, input };
}

async function creditState(f: Fixture, appointmentId: AppointmentId) {
  const events = await f.pool.query<{ kind: string; delta: number; blockId: string }>(
    `SELECT kind,delta_credits AS delta,credit_block_id AS "blockId" FROM ls_payments.credit_events
     WHERE workspace_id=$1 AND appointment_id=$2 ORDER BY occurred_at,id`, [f.workspaceId, appointmentId]);
  const receipts = await f.pool.query<{ effect: string }>(
    `SELECT effect FROM ls_payments.calendar_receipts WHERE workspace_id=$1 AND appointment_id=$2
     ORDER BY calendar_sequence`, [f.workspaceId, appointmentId]);
  const pending = await f.pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM ls_calendar.events WHERE workspace_id=$1 AND appointment_id=$2
     AND topic='credit_effect' AND delivered_at IS NULL`, [f.workspaceId, appointmentId]);
  return { events: events.rows, effects: receipts.rows.map(row => row.effect), pending: pending.rows[0]!.n };
}

async function replayDelivered(f: Fixture, appointmentId: AppointmentId) {
  await f.db.read(f.practitioner.actor, async c => {
    const events = await c.tx.query<{ id: string; sequence: number; payload: CalendarEvent }>(
      `SELECT id,sequence,payload FROM ls_calendar.events WHERE workspace_id=$1 AND appointment_id=$2
       AND topic='credit_effect' AND delivered_at IS NOT NULL ORDER BY sequence`, [f.workspaceId, appointmentId]);
    for (const event of events) await applyCalendarCreditEffect(c.tx, event.payload, {
      id: event.id, sequence: event.sequence, workspaceId: f.workspaceId, appointmentId,
    });
  });
}

describe('LS-070 real calendar/manual-credit convergence', () => {
  test('manual charge, payment and allocation create four credits; refund and exact retry debit once', () => usingFixture(async (f, payments) => {
    const bought = await purchase(f, payments);
    const before = await payments.overview(f.practitioner.actor, f.first.id);
    expect(before.remainingCredits).toBe(4);
    expect(before.charges).toMatchObject([{ id: bought.charge.chargeId, status: 'paid', outstandingMinor: 0 }]);
    expect(before.payments).toMatchObject([{ id: bought.payment.paymentId, unallocatedMinor: 0 }]);
    expect(before.events).toMatchObject([{ kind: 'purchase', deltaCredits: 4, valueMinor: 220_000 }]);
    const input = { caseId: f.first.id, blockId: bought.blockId, credits: 2, reason: 'Synthetic unused-credit refund' };
    const commandKey = randomUUID();
    const refunded = await payments.refund(f.practitioner.actor, commandKey, input);
    expect(refunded).toMatchObject({ credits: 2, amountMinor: 110_000 });
    expect(await payments.refund(f.practitioner.actor, commandKey, input)).toEqual(refunded);
    await expect(payments.refund(f.practitioner.actor, commandKey, { ...input, credits: 1 })).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(payments.refund(f.practitioner.actor, randomUUID(), { ...input, credits: 3 })).rejects.toMatchObject({ code: 'CONFLICT' });
    const after = await payments.overview(f.practitioner.actor, f.first.id);
    expect(after.remainingCredits).toBe(2);
    expect(after.remainingValueMinor).toBe(110_000);
    expect(after.refunds).toHaveLength(1);
    expect(after.events.filter(event => event.kind === 'refund')).toMatchObject([{ deltaCredits: -2, valueMinor: -110_000 }]);
  }));

  test('unfunded attendance persists and stays pending without debt while an unrelated funded case consumes once', () => usingFixture(async (f, payments) => {
    const blocked = await attend(f, -4);
    await purchase(f, payments, f.second);
    const funded = await attend(f, -2, f.second);
    expect(await drain(f)).toEqual({ delivered: 1, deferred: 1 });
    expect((await f.service.get(f.practitioner.actor, blocked.appointmentId)).attendance).toMatchObject({ state: 'present', attended: true, version: 1 });
    expect(await f.service.recordAttendance(f.practitioner.actor, blocked.appointmentId, blocked.commandKey, blocked.input)).toEqual(blocked.appointment);
    expect(await creditState(f, blocked.appointmentId)).toEqual({ events: [], effects: [], pending: 1 });
    expect((await payments.overview(f.practitioner.actor, f.first.id)).remainingCredits).toBe(0);
    expect(await creditState(f, funded.appointmentId)).toMatchObject({ events: [{ kind: 'consume', delta: -1 }], effects: ['consume'], pending: 0 });
    expect((await payments.overview(f.practitioner.actor, f.second.id)).remainingCredits).toBe(3);
    const attempts = await f.pool.query<{ attempts: number; cooling: boolean; failureCode: string }>(
      `SELECT a.attempts,a.retry_after>a.last_attempted_at AS cooling,a.failure_code AS "failureCode"
       FROM ls_integration.calendar_delivery_attempts a JOIN ls_calendar.events e
       ON e.workspace_id=a.workspace_id AND e.id=a.event_id
       WHERE a.workspace_id=$1 AND e.appointment_id=$2`, [f.workspaceId, blocked.appointmentId]);
    expect(attempts.rows).toEqual([{ attempts: 1, cooling: true, failureCode: 'deferred' }]);
    await purchase(f, payments);
    expect(await drain(f, blocked.appointmentId)).toEqual({ delivered: 1, deferred: 0 });
    expect(await creditState(f, blocked.appointmentId)).toMatchObject({ events: [{ kind: 'consume', delta: -1 }], effects: ['consume'], pending: 0 });
    await replayDelivered(f, blocked.appointmentId);
    await replayDelivered(f, funded.appointmentId);
    expect(await drain(f)).toEqual({ delivered: 0, deferred: 0 });
    expect((await payments.overview(f.practitioner.actor, f.first.id)).remainingCredits).toBe(3);
    expect((await creditState(f, blocked.appointmentId)).events).toHaveLength(1);
    expect((await creditState(f, funded.appointmentId)).events).toHaveLength(1);
  }));

  test('more than one batch of blocked appointments cannot starve an unrelated funded appointment', () => usingFixture(async (f, payments) => {
    const blocked: AppointmentId[] = [];
    for (let index = 0; index < 26; index++) blocked.push((await attend(f, -4 - index * 2)).appointmentId);
    await purchase(f, payments, f.second);
    const funded = await attend(f, -70, f.second);
    expect(await drain(f)).toEqual({ delivered: 0, deferred: 25 });
    expect(await drain(f)).toEqual({ delivered: 1, deferred: 1 });
    expect(await creditState(f, funded.appointmentId)).toMatchObject({ events: [{ kind: 'consume', delta: -1 }], effects: ['consume'], pending: 0 });
    expect((await payments.overview(f.practitioner.actor, f.second.id)).remainingCredits).toBe(3);
    const pending = await f.pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM ls_calendar.events WHERE workspace_id=$1 AND appointment_id=ANY($2::uuid[])
       AND topic='credit_effect' AND delivered_at IS NULL`, [f.workspaceId, blocked]);
    expect(pending.rows[0]!.n).toBe(26);
    expect((await payments.overview(f.practitioner.actor, f.first.id)).events).toHaveLength(0);
  }), 30_000);

  test('an exception before funding acknowledges consume, preserve and restore without an artificial debit or credit', () => usingFixture(async (f, payments) => {
    const blocked = await attend(f, -4);
    expect(await drain(f)).toEqual({ delivered: 0, deferred: 1 });
    const input = { expectedVersion: blocked.appointment.version, reason: 'Synthetic documented practitioner exception' };
    const commandKey = randomUUID();
    const protectedAppointment = await f.service.grantException(f.practitioner.actor, blocked.appointmentId, commandKey, input);
    expect(await f.effects(blocked.appointmentId)).toEqual(['consume', 'preserve', 'restore']);
    expect(await drain(f, blocked.appointmentId)).toEqual({ delivered: 3, deferred: 0 });
    expect(await creditState(f, blocked.appointmentId)).toEqual({ events: [], effects: ['consume', 'preserve', 'restore'], pending: 0 });
    expect((await payments.overview(f.practitioner.actor, f.first.id)).remainingCredits).toBe(0);
    expect(await f.service.grantException(f.practitioner.actor, blocked.appointmentId, commandKey, input)).toEqual(protectedAppointment);
    await purchase(f, payments);
    await replayDelivered(f, blocked.appointmentId);
    expect(await drain(f, blocked.appointmentId)).toEqual({ delivered: 0, deferred: 0 });
    expect(await creditState(f, blocked.appointmentId)).toEqual({ events: [], effects: ['consume', 'preserve', 'restore'], pending: 0 });
    expect((await payments.overview(f.practitioner.actor, f.first.id)).remainingCredits).toBe(4);
  }));

  test('an exception after an actual debit restores that block exactly once', () => usingFixture(async (f, payments) => {
    const bought = await purchase(f, payments);
    const attended = await attend(f, -4);
    expect(await drain(f)).toEqual({ delivered: 1, deferred: 0 });
    expect((await payments.overview(f.practitioner.actor, f.first.id)).remainingCredits).toBe(3);
    await f.service.grantException(f.practitioner.actor, attended.appointmentId, randomUUID(), {
      expectedVersion: attended.appointment.version, reason: 'Synthetic exception after already applied debit',
    });
    expect(await drain(f, attended.appointmentId)).toEqual({ delivered: 2, deferred: 0 });
    await replayDelivered(f, attended.appointmentId);
    expect(await drain(f)).toEqual({ delivered: 0, deferred: 0 });
    const state = await creditState(f, attended.appointmentId);
    expect(state.effects).toEqual(['consume', 'preserve', 'restore']);
    expect(state.events).toHaveLength(2);
    expect(state.events).toEqual(expect.arrayContaining([
      { kind: 'consume', delta: -1, blockId: bought.blockId }, { kind: 'restore', delta: 1, blockId: bought.blockId },
    ]));
    expect((await payments.overview(f.practitioner.actor, f.first.id)).remainingCredits).toBe(4);
  }));
});
