/** Savepoint proof using a real PostgreSQL statement error; guarded disposable fixture only. */
import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { fixture } from './fixture.ts';
import { drainCalendarEventsIsolated } from '../../../src/features/calendar/relay.ts';
import type { AppointmentId } from '../../../src/features/calendar/types.ts';

test('isolated relay rolls back a partial write after a PostgreSQL error and commits an unrelated later event', async () => {
  const f = await fixture({ termsVersion: 'Product2.3' });
  try {
    for (const [index, caseRecord] of [f.first, f.second].entries()) {
      const startsAt = f.at(-4 + index * 2);
      const appointmentId = await f.seed(startsAt, caseRecord);
      await f.service.recordAttendance(f.practitioner.actor, appointmentId, randomUUID(), {
        state: 'present', arrivedAt: startsAt, expectedVersion: 0, correctionReason: null,
      });
    }
    // Resolve the same fresh-queue ordering as the production selector; UUID order is not assumed.
    const queued = await f.pool.query<{ eventId: string; appointmentId: AppointmentId; originalCiphertext: string }>(
      `SELECT e.id AS "eventId",e.appointment_id AS "appointmentId",a.location_ciphertext AS "originalCiphertext"
       FROM ls_calendar.events e JOIN ls_calendar.appointments a
       ON a.workspace_id=e.workspace_id AND a.id=e.appointment_id
       WHERE e.workspace_id=$1 AND e.topic='credit_effect' AND e.delivered_at IS NULL
       ORDER BY e.created_at,e.id`, [f.workspaceId]);
    expect(queued.rows).toHaveLength(2);
    const failed = queued.rows[0]!, sibling = queued.rows[1]!;
    const attempts: string[] = [];
    let partialWriteObserved = false;
    let sqlErrorCode: string | undefined;
    const siblingLocation = 'Synthetic unrelated callback committed after the savepoint rollback';

    const outcome = await f.db.read(f.practitioner.actor, async c => {
      const result = await drainCalendarEventsIsolated(c, 'credit_effect', async (tx, _event, meta) => {
        attempts.push(meta.id);
        const failedCallback = meta.id === failed.eventId;
        const location = failedCallback ? 'Synthetic partial write that must roll back' : siblingLocation;
        const ciphertext = f.db.encrypt(c, 'location', meta.appointmentId, location);
        const written = await tx.query<{ ciphertext: string }>(
          `UPDATE ls_calendar.appointments SET location_ciphertext=$3
           WHERE workspace_id=$1 AND id=$2 RETURNING location_ciphertext AS ciphertext`,
          [c.workspace, meta.appointmentId, ciphertext]);
        if (failedCallback) {
          partialWriteObserved = written.length === 1 && written[0]!.ciphertext === ciphertext;
          try {
            // PostgreSQL marks this transaction aborted until ROLLBACK TO SAVEPOINT.
            // This is deliberately not a JavaScript-only throw or mocked query failure.
            await tx.query('SELECT 1 / 0 AS synthetic_division_by_zero');
          } catch (error) {
            sqlErrorCode = error && typeof error === 'object' && 'code' in error ? String(error.code) : undefined;
            throw error;
          }
        }
      });
      // A query in this same outer transaction proves that the real SQL error was recovered.
      const usable = await c.tx.query<{ value: number }>('SELECT 42 AS value');
      expect(usable).toEqual([{ value: 42 }]);
      return result;
    });

    expect(partialWriteObserved).toBe(true);
    expect(sqlErrorCode).toBe('22012');
    expect(attempts).toEqual([failed.eventId, sibling.eventId]);
    expect(outcome).toEqual({ delivered: 1, deferred: 1 });
    // These reads run after the outer transaction committed, not inside the savepoint.
    const persisted = await f.pool.query<{ eventId: string; ciphertext: string; delivered: boolean }>(
      `SELECT e.id AS "eventId",a.location_ciphertext AS ciphertext,e.delivered_at IS NOT NULL AS delivered
       FROM ls_calendar.events e JOIN ls_calendar.appointments a
       ON a.workspace_id=e.workspace_id AND a.id=e.appointment_id
       WHERE e.workspace_id=$1 AND e.id=ANY($2::uuid[])`, [f.workspaceId, [failed.eventId, sibling.eventId]]);
    expect(persisted.rows.find(row => row.eventId === failed.eventId)).toEqual({
      eventId: failed.eventId, ciphertext: failed.originalCiphertext, delivered: false,
    });
    expect(persisted.rows.find(row => row.eventId === sibling.eventId)?.delivered).toBe(true);
    expect(persisted.rows.find(row => row.eventId === sibling.eventId)?.ciphertext).not.toBe(sibling.originalCiphertext);
    expect((await f.service.get(f.practitioner.actor, failed.appointmentId)).location).toBe('Synthetic agreed meeting place');
    expect((await f.service.get(f.practitioner.actor, sibling.appointmentId)).location).toBe(siblingLocation);
    const retryState = await f.pool.query<{ eventId: string; attempts: number; cooling: boolean; failureCode: string }>(
      `SELECT event_id AS "eventId",attempts,retry_after>last_attempted_at AND retry_after>clock_timestamp() AS cooling,
       failure_code AS "failureCode" FROM ls_integration.calendar_delivery_attempts
       WHERE workspace_id=$1 AND event_id=ANY($2::uuid[])`, [f.workspaceId, [failed.eventId, sibling.eventId]]);
    expect(retryState.rows).toEqual([{ eventId: failed.eventId, attempts: 1, cooling: true, failureCode: 'deferred' }]);
    const retryCallbacks: string[] = [];
    const duringCooldown = await f.db.read(f.practitioner.actor, c => drainCalendarEventsIsolated(c, 'credit_effect', async (_tx, _event, meta) => {
      retryCallbacks.push(meta.id);
    }));
    expect(duringCooldown).toEqual({ delivered: 0, deferred: 0 });
    expect(retryCallbacks).toEqual([]);
  } finally { await f.pool.end(); }
}, 30_000);
