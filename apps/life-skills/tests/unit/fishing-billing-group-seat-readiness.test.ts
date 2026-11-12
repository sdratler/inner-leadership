import { describe, expect, it, vi } from 'vitest';
import { createGuestFamilyOffer } from '../../src/features/fishing-billing/guest-domain-v3.ts';
import { syntheticAccepted, syntheticDraft, syntheticId, syntheticNow, syntheticOwner } from '../../src/features/fishing-billing/fixtures.ts';
import {
  GROUP_SEAT_READINESS_VERSION, planGroupSeatReadiness, type GroupSeatFacts, type GroupSeatReviewRequest,
} from '../../src/features/fishing-billing/group-seat-readiness.ts';

vi.mock('server-only', () => ({}));

function fixture() {
  const draft = syntheticDraft();
  const groupId = syntheticId(0xa1);
  for (const [index, line] of draft.lines.entries()) {
    line.groupId = groupId;
    line.childId = syntheticId(0xab + index);
  }
  const base = {
    workspaceId: draft.workspaceId, programKey: draft.definition.programKey, groupId, groupRevision: 8,
    period: draft.lines[0]!.period,
  };
  const scheduleSource = { id: 'SYNTHETIC-SCHEDULE', sha256: 'b'.repeat(64) };
  const capacitySource = { id: 'SYNTHETIC-OCCUPANCY', sha256: 'c'.repeat(64) };
  const request = {
    ...structuredClone(base), version: GROUP_SEAT_READINESS_VERSION, familyId: draft.familyId, offerId: draft.id, offerRevision: draft.revision,
    definitionId: draft.definition.id, offerSource: structuredClone(draft.definition.source),
    selectedChildIds: draft.lines.map(line => line.childId), scheduleSource, capacitySource, capacityRevision: 17,
  } satisfies GroupSeatReviewRequest;
  const current = { observedAt: '2035-01-02T14:59:00Z', validUntil: '2035-01-02T15:20:00Z', revokedAt: null };
  const schedule = {
    ...structuredClone(base), ...current, source: structuredClone(scheduleSource), state: 'confirmed' as const,
    location: { id: 'SYNTHETIC-LOCATION', sha256: 'd'.repeat(64) },
    firstClassAt: '2035-01-03T01:30:00Z', firstClassLocalDate: '2035-01-02',
  };
  const capacity = {
    ...structuredClone(base), ...current, source: structuredClone(capacitySource), revision: 17,
    totalSeats: 8, occupiedSeats: 5, heldSeats: 1,
  };
  const facts = { version: GROUP_SEAT_READINESS_VERSION, schedule, capacity } satisfies GroupSeatFacts;
  return { draft, request, facts };
}

const ready = planGroupSeatReadiness;
const blocked = (reason: string) => ({ state: 'unavailable', reason, availableSeats: null });

describe('Fishing group and seat readiness for owner review', () => {
  it('fits both siblings as one proposal and keeps price, payment timing and authority outside the result', () => {
    const { draft, request, facts } = fixture();
    const before = structuredClone({ draft, request, facts });
    const plan = ready(draft, request, facts, syntheticNow);
    expect(plan).toMatchObject({
      version: GROUP_SEAT_READINESS_VERSION, state: 'ready_for_owner_review', availableSeats: 2, requestedSeats: 2,
      paymentClock: 'requires_successful_confirmed_group_announcement',
      binding: { offerId: draft.id, groupRevision: 8, capacityRevision: 17, childIds: request.selectedChildIds },
    });
    expect(plan.requiredBeforeDependentAction).toEqual([
      'authenticated_current_group_and_capacity', 'guardian_authority', 'recipient_authority', 'legal_authority', 'runtime_authorization',
    ]);
    expect({ draft, request, facts }).toEqual(before);
    for (const key of ['amountMinor', 'dueAt', 'seatHoldId', 'expiresAt', 'recipient', 'sendIntent']) {
      expect(plan).not.toHaveProperty(key);
    }
    if (plan.state !== 'ready_for_owner_review') throw new Error('expected owner review');
    facts.schedule.location.id = 'changed';
    request.period.startsAt = '2040-01-01T05:00:00Z';
    request.selectedChildIds.pop();
    expect(plan.binding.location.id).toBe('SYNTHETIC-LOCATION');
    expect(plan.binding.period.startsAt).toBe(before.request.period.startsAt);
    expect(plan.binding.childIds).toEqual(before.request.selectedChildIds);
    expect([plan, plan.binding, plan.binding.location, plan.binding.period, plan.binding.childIds].every(Object.isFrozen)).toBe(true);
  });

  it('also reads a newly constructed guest draft through the existing offer contract', () => {
    const { draft, request, facts } = fixture();
    const guest = createGuestFamilyOffer(draft.definition, {
      operationId: syntheticId(99), id: draft.id, familyId: draft.familyId, definitionId: draft.definition.id,
      children: draft.lines.map(({ id: lineId, childId, period, groupId, dueAt }) => ({ lineId, childId, period, groupId, dueAt })),
      override: null,
    }, { workspaceId: draft.workspaceId, actorId: syntheticOwner, now: syntheticNow });
    expect(ready(guest, request, facts, syntheticNow).state).toBe('ready_for_owner_review');
  });

  it('requires observed current data even if the caller supplies mailbox or safety assertions', () => {
    const { draft, request, facts } = fixture();
    for (const source of [null, {}, { ...facts, guardianVerified: true }, { ...facts, schedule: null }]) {
      expect(ready(draft, request, source, syntheticNow)).toMatchObject(blocked('group_source_unavailable'));
    }
    for (const source of [null, {}, { ...facts.capacity, safeCapacityApproved: true }]) {
      expect(ready(draft, request, { ...facts, capacity: source }, syntheticNow)).toMatchObject(blocked('capacity_unavailable'));
    }
  });

  it('rejects incompatible planner evidence and aliased offer lines', () => {
    const { draft, request, facts } = fixture();
    expect(ready(draft, { ...request, version: 'v0' }, facts, syntheticNow)).toMatchObject(blocked('invalid_request'));
    expect(ready(draft, request, { ...facts, version: 'v0' }, syntheticNow)).toMatchObject(blocked('group_source_unavailable'));
    draft.lines[0]!.id = syntheticId(0xa9);
    draft.lines[1]!.id = draft.lines[0]!.id.toUpperCase();
    expect(ready(draft, request, facts, syntheticNow)).toMatchObject(blocked('invalid_offer'));
  });

  it.each(['schedule', 'capacity'] as const)('binds the whole %s observation before exposing occupancy', kind => {
    const { draft, request, facts } = fixture();
    const fact = facts[kind];
    for (const change of [
      { workspaceId: syntheticId(456) }, { groupId: syntheticId(457) }, { groupRevision: 7 },
      { period: { ...fact.period, id: syntheticId(458) } },
      { period: { ...fact.period, endsAt: '2035-02-03T05:00:00Z' } },
      { source: { ...fact.source, sha256: 'e'.repeat(64) } }, { source: { ...fact.source, id: 'other' } },
    ]) {
      expect(ready(draft, request, { ...facts, [kind]: { ...fact, ...change } }, syntheticNow))
        .toMatchObject(blocked(kind + '_binding_mismatch'));
    }
    expect(ready(draft, request, { ...facts, [kind]: { ...fact, programKey: 'historical_program' } }, syntheticNow))
      .toMatchObject({ state: 'unavailable', availableSeats: null });
    for (const change of [
      { revokedAt: syntheticNow }, { observedAt: '2035-01-02T15:00:00.000001Z' },
      { validUntil: syntheticNow }, { validUntil: '2035-01-02T14:10:00Z' },
    ]) {
      expect(ready(draft, request, { ...facts, [kind]: { ...fact, ...change } }, syntheticNow))
        .toMatchObject(blocked(kind + '_not_current'));
    }
  });

  it('distinguishes full, insufficient for all siblings, and unknown, including stale full counts', () => {
    const { draft, request, facts } = fixture();
    const inspect = (patch: object) => ready(draft, request, { ...facts, capacity: { ...facts.capacity, ...patch } }, syntheticNow);
    expect(inspect({ occupiedSeats: 7 })).toMatchObject({ state: 'full', availableSeats: 0, requestedSeats: 2 });
    expect(inspect({ occupiedSeats: 6 })).toMatchObject({ state: 'insufficient_for_family', availableSeats: 1, requestedSeats: 2 });
    for (const field of ['totalSeats', 'occupiedSeats', 'heldSeats']) {
      expect(inspect({ [field]: null })).toMatchObject(blocked('capacity_unavailable'));
    }
    expect(inspect({ occupiedSeats: 7, validUntil: syntheticNow })).toMatchObject(blocked('capacity_not_current'));
    expect(inspect({ revision: 16 })).toMatchObject(blocked('capacity_binding_mismatch'));
  });

  it('rejects malformed and contradictory counts without overflow or manufactured free places', () => {
    const { draft, request, facts } = fixture();
    const inspect = (patch: object) => ready(draft, request, { ...facts, capacity: { ...facts.capacity, ...patch } }, syntheticNow);
    for (const value of [-1, 0.5, '2', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      for (const field of ['totalSeats', 'occupiedSeats', 'heldSeats']) {
        expect(inspect({ [field]: value })).toMatchObject(blocked('capacity_unavailable'));
      }
    }
    expect(inspect({ totalSeats: 2, occupiedSeats: 3, heldSeats: 0 })).toMatchObject(blocked('inconsistent_capacity'));
    expect(inspect({ totalSeats: Number.MAX_SAFE_INTEGER, occupiedSeats: Number.MAX_SAFE_INTEGER, heldSeats: 1 }))
      .toMatchObject(blocked('inconsistent_capacity'));
    expect(inspect({ totalSeats: Number.MAX_SAFE_INTEGER, occupiedSeats: Number.MAX_SAFE_INTEGER - 2, heldSeats: 0 }))
      .toMatchObject({ state: 'ready_for_owner_review', availableSeats: 2 });
  });

  it('rejects partial, extra, duplicate and differently cased duplicate child selections', () => {
    const { draft, request, facts } = fixture();
    const [one, two] = request.selectedChildIds as [string, string];
    for (const selectedChildIds of [[one], [one, one], [one, one.toUpperCase()], [one, two, syntheticId(432)]]) {
      expect(ready(draft, { ...request, selectedChildIds }, facts, syntheticNow)).toMatchObject(blocked('family_selection_mismatch'));
    }
    expect(ready(draft, { ...request, selectedChildIds: [two.toUpperCase(), one.toUpperCase()] }, facts, syntheticNow).state)
      .toBe('ready_for_owner_review');
    draft.lines[1]!.childId = one.toUpperCase();
    expect(ready(draft, request, facts, syntheticNow)).toMatchObject(blocked('family_selection_mismatch'));
  });

  it('prevents a draft for another family, workspace, definition, or revision from being attached', () => {
    const { draft, request, facts } = fixture();
    for (const change of [
      { workspaceId: syntheticId(51) }, { familyId: syntheticId(52) }, { offerId: syntheticId(53) },
      { offerRevision: 2 }, { definitionId: syntheticId(54) }, { offerSource: { ...request.offerSource, id: 'other' } },
    ]) {
      expect(ready(draft, { ...request, ...change }, facts, syntheticNow)).toMatchObject(blocked('offer_binding_mismatch'));
    }
    expect(ready(draft, { ...request, programKey: 'sunday_fishing_academy' }, facts, syntheticNow)).toMatchObject(blocked('invalid_request'));
    draft.lines[1]!.groupId = null;
    expect(ready(draft, request, facts, syntheticNow)).toMatchObject(blocked('offer_group_or_period_mismatch'));
    draft.lines[1]!.groupId = request.groupId;
    draft.lines[1]!.period = { ...request.period, id: syntheticId(433) };
    expect(ready(draft, request, facts, syntheticNow)).toMatchObject(blocked('offer_group_or_period_mismatch'));
  });

  it('requires the formed group, finalized location and actual first class inside the approved period', () => {
    const { draft, request, facts } = fixture();
    const inspect = (patch: object) => ready(draft, request, { ...facts, schedule: { ...facts.schedule, ...patch } }, syntheticNow);
    for (const state of ['planned', 'cancelled']) expect(inspect({ state })).toMatchObject(blocked('group_not_confirmed'));
    for (const field of ['location', 'firstClassAt', 'firstClassLocalDate']) {
      expect(inspect({ [field]: null })).toMatchObject(blocked('schedule_details_unavailable'));
    }
    expect(inspect({ firstClassLocalDate: '2035-01-03' })).toMatchObject(blocked('first_class_date_mismatch'));
    expect(inspect({ firstClassAt: request.period.endsAt, firstClassLocalDate: '2035-02-01' })).toMatchObject(blocked('first_class_date_mismatch'));
    expect(inspect({ firstClassAt: '2035-01-01T04:59:59Z', firstClassLocalDate: '2034-12-31' })).toMatchObject(blocked('first_class_date_mismatch'));
  });

  it('compares instants across New York offset changes and bounds review by the end of the service period', () => {
    const { draft, request, facts } = fixture();
    const period = { ...request.period, startsAt: '2035-03-01T00:00:00-05:00', endsAt: '2035-04-01T00:00:00-04:00' };
    draft.lines.forEach(line => { line.period = { ...period }; });
    request.period = period;
    for (const fact of [facts.schedule, facts.capacity]) {
      fact.period = { ...period, startsAt: '2035-03-01T05:00:00Z', endsAt: '2035-04-01T04:00:00Z' };
      fact.validUntil = '2035-04-10T00:00:00Z';
    }
    facts.schedule.firstClassAt = '2035-03-15T00:30:00Z';
    facts.schedule.firstClassLocalDate = '2035-03-14';
    expect(ready(draft, request, facts, syntheticNow)).toMatchObject({ state: 'ready_for_owner_review', binding: { factsValidUntil: period.endsAt } });
    expect(ready(draft, request, facts, '2035-04-01T04:00:00Z')).toMatchObject(blocked('period_ended'));
  });

  it('keeps issued and accepted history intact, and never converts a historical offer or paused draft', () => {
    const { draft, request, facts } = fixture();
    const accepted = syntheticAccepted();
    const history = structuredClone(accepted);
    expect(ready(accepted, request, facts, syntheticNow)).toMatchObject(blocked('offer_not_current_draft'));
    expect(accepted).toEqual(history);
    expect(ready({ ...draft, state: 'issued', issuedAt: syntheticNow }, request, facts, syntheticNow)).toMatchObject(blocked('offer_not_current_draft'));
    expect(ready({ ...draft, version: 'historical-trip390' }, request, facts, syntheticNow)).toMatchObject(blocked('invalid_offer'));
    expect(ready({ ...draft, paused: true }, request, facts, syntheticNow)).toMatchObject(blocked('offer_not_current_draft'));
    expect(ready(draft, request, facts, '2035-01-02T14:59:59Z')).toMatchObject(blocked('offer_not_current_draft'));
    expect(ready(draft, request, facts, 'unchecked')).toMatchObject(blocked('invalid_request'));
  });
});
