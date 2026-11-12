import { z } from 'zod';
import { guestFamilyOfferSchema } from '../../lib/fishing-billing-guest-contract-v3.ts';
import {
  billingId, billingInstant, familyOfferSchema, publishedOfferSchema,
  servicePeriodSchema, sourceReferenceSchema, type FamilyOffer,
} from './contracts.ts';
import { calendarDateSchema, newYorkDate } from './contracts-v2.ts';

export const GROUP_SEAT_READINESS_VERSION = 'JLFA-FISHING-GROUP-SEAT-READINESS-v1' as const;

const uuid = billingId.transform(value => value.toLowerCase());
const instant = billingInstant.refine(value => Number.isFinite(Date.parse(value)));
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const revision = count.positive();
const reference = sourceReferenceSchema.refine(value => value.id.trim().length > 0);
const group = z.object({
  workspaceId: uuid,
  programKey: publishedOfferSchema.shape.programKey,
  groupId: uuid,
  groupRevision: revision,
  period: servicePeriodSchema,
}).strict();

const requestSchema = group.extend({
  version: z.literal(GROUP_SEAT_READINESS_VERSION),
  familyId: uuid,
  offerId: uuid,
  offerRevision: revision,
  definitionId: uuid,
  offerSource: reference,
  selectedChildIds: z.array(uuid).min(1).max(10),
  scheduleSource: reference,
  capacitySource: reference,
  capacityRevision: revision,
}).strict();

/** The native reader supplies the validity interval and revocation state for each observation. */
const observedGroup = group.extend({
  source: reference,
  observedAt: instant,
  validUntil: instant,
  revokedAt: instant.nullable(),
}).strict();
const scheduleSchema = observedGroup.extend({
  state: z.enum(['planned', 'confirmed', 'cancelled']),
  location: reference.nullable(),
  firstClassAt: instant.nullable(),
  firstClassLocalDate: calendarDateSchema.nullable(),
}).strict();
const capacitySchema = observedGroup.extend({
  revision,
  // Count all occupants, including no-fee children. Held places are additional to occupied places.
  totalSeats: count.nullable(),
  occupiedSeats: count.nullable(),
  heldSeats: count.nullable(),
}).strict();
const factsEnvelope = z.object({
  version: z.literal(GROUP_SEAT_READINESS_VERSION), schedule: z.unknown(), capacity: z.unknown(),
}).strict();
const offerSchema = z.union([familyOfferSchema, guestFamilyOfferSchema]);

export type GroupSeatReviewRequest = z.input<typeof requestSchema>;
export type GroupSeatFacts = {
  readonly version: typeof GROUP_SEAT_READINESS_VERSION;
  readonly schedule: z.input<typeof scheduleSchema> | null;
  readonly capacity: z.input<typeof capacitySchema> | null;
};
type GroupKey = z.output<typeof group>;
type Observation = z.output<typeof observedGroup>;
type Source = FamilyOffer['definition']['source'];
type Period = FamilyOffer['lines'][number]['period'];

const boundary = Object.freeze({
  version: GROUP_SEAT_READINESS_VERSION,
  requiredBeforeDependentAction: Object.freeze([
    'authenticated_current_group_and_capacity', 'guardian_authority', 'recipient_authority',
    'legal_authority', 'runtime_authorization',
  ] as const),
  paymentClock: 'requires_successful_confirmed_group_announcement' as const,
});

type UnavailableReason =
  | 'invalid_request' | 'invalid_offer' | 'offer_not_current_draft' | 'offer_binding_mismatch'
  | 'family_selection_mismatch' | 'offer_group_or_period_mismatch' | 'period_ended'
  | 'group_source_unavailable' | 'schedule_binding_mismatch' | 'schedule_not_current'
  | 'group_not_confirmed' | 'schedule_details_unavailable' | 'first_class_date_mismatch'
  | 'capacity_unavailable' | 'capacity_binding_mismatch' | 'capacity_not_current'
  | 'inconsistent_capacity';

function unavailable(reason: UnavailableReason) {
  return Object.freeze({ ...boundary, state: 'unavailable' as const, reason, availableSeats: null });
}

function sameSource(a: Source, b: Source) {
  return a.id === b.id && a.sha256 === b.sha256;
}

// Postgres timestamps can include microseconds. Date.parse alone would equate
// a just-expired observation with another in the same millisecond.
function compareInstants(a: string, b: string): number {
  const difference = Date.parse(a) - Date.parse(b);
  if (difference !== 0) return difference;
  const remainder = (value: string) => (/\.([0-9]+)/.exec(value)?.[1]?.slice(3) ?? '').replace(/0+$/, '');
  const left = remainder(a), right = remainder(b);
  return left === right ? 0 : left < right ? -1 : 1;
}

function samePeriod(a: Period, b: Period) {
  return a.id.toLowerCase() === b.id.toLowerCase() && a.timeZone === b.timeZone &&
    compareInstants(a.startsAt, b.startsAt) === 0 && compareInstants(a.endsAt, b.endsAt) === 0;
}

function sameGroup(expected: GroupKey, actual: GroupKey) {
  return expected.workspaceId === actual.workspaceId && expected.programKey === actual.programKey &&
    expected.groupId === actual.groupId && expected.groupRevision === actual.groupRevision &&
    samePeriod(expected.period, actual.period);
}

function current(fact: Observation, now: string) {
  return fact.revokedAt === null && compareInstants(fact.observedAt, now) <= 0 && compareInstants(now, fact.validUntil) < 0;
}

/** Pure pre-issue review of one draft's entire family selection for one group and period.
 * The expected bindings and observations must be read independently by the caller.
 * Neither a parsed observation nor this detached result authenticates a producer or reserves seats. */
export function planGroupSeatReadiness(offer: unknown, request: unknown, facts: unknown, asOf: string) {
  const expected = requestSchema.safeParse(request);
  const clock = instant.safeParse(asOf);
  if (!expected.success || !clock.success) return unavailable('invalid_request');

  const parsed = offerSchema.safeParse(offer);
  if (!parsed.success) return unavailable('invalid_offer');
  const draft = parsed.data;
  const wanted = expected.data;
  const now = clock.data;
  if (draft.state !== 'draft' || draft.paused || !Number.isFinite(Date.parse(draft.createdAt)) ||
      compareInstants(draft.createdAt, now) > 0) {
    return unavailable('offer_not_current_draft');
  }
  if (draft.workspaceId.toLowerCase() !== wanted.workspaceId || draft.familyId.toLowerCase() !== wanted.familyId ||
      draft.id.toLowerCase() !== wanted.offerId || draft.revision !== wanted.offerRevision ||
      draft.definition.programKey !== wanted.programKey || draft.definition.id.toLowerCase() !== wanted.definitionId ||
      !sameSource(draft.definition.source, wanted.offerSource)) {
    return unavailable('offer_binding_mismatch');
  }

  const selected = new Set(wanted.selectedChildIds);
  const children = draft.lines.map(line => line.childId.toLowerCase());
  if (new Set(draft.lines.map(line => line.id.toLowerCase())).size !== draft.lines.length) {
    return unavailable('invalid_offer');
  }
  if (selected.size !== wanted.selectedChildIds.length || new Set(children).size !== children.length ||
      selected.size !== children.length || children.some(id => !selected.has(id))) {
    return unavailable('family_selection_mismatch');
  }
  if (draft.lines.some(line => line.groupId?.toLowerCase() !== wanted.groupId || !samePeriod(line.period, wanted.period))) {
    return unavailable('offer_group_or_period_mismatch');
  }
  if (compareInstants(now, wanted.period.endsAt) >= 0) return unavailable('period_ended');

  const envelope = factsEnvelope.safeParse(facts);
  if (!envelope.success) return unavailable('group_source_unavailable');
  const schedule = scheduleSchema.safeParse(envelope.data.schedule);
  if (!schedule.success) return unavailable('group_source_unavailable');
  const session = schedule.data;
  if (!sameGroup(wanted, session) || !sameSource(wanted.scheduleSource, session.source)) {
    return unavailable('schedule_binding_mismatch');
  }
  if (!current(session, now)) return unavailable('schedule_not_current');
  if (session.state !== 'confirmed') return unavailable('group_not_confirmed');
  if (!session.location || !session.firstClassAt || !session.firstClassLocalDate) {
    return unavailable('schedule_details_unavailable');
  }
  if (compareInstants(session.firstClassAt, wanted.period.startsAt) < 0 ||
      compareInstants(session.firstClassAt, wanted.period.endsAt) >= 0 ||
      newYorkDate(session.firstClassAt) !== session.firstClassLocalDate) {
    return unavailable('first_class_date_mismatch');
  }

  const capacity = capacitySchema.safeParse(envelope.data.capacity);
  if (!capacity.success) return unavailable('capacity_unavailable');
  const occupancy = capacity.data;
  if (!sameGroup(wanted, occupancy) || !sameSource(wanted.capacitySource, occupancy.source) ||
      occupancy.revision !== wanted.capacityRevision) {
    return unavailable('capacity_binding_mismatch');
  }
  if (!current(occupancy, now)) return unavailable('capacity_not_current');
  const { totalSeats, occupiedSeats, heldSeats } = occupancy;
  if (totalSeats === null || occupiedSeats === null || heldSeats === null) return unavailable('capacity_unavailable');
  // Subtract within the validated integer range. Overcommitted or inconsistent counts are unknown.
  if (occupiedSeats > totalSeats || heldSeats > totalSeats - occupiedSeats) return unavailable('inconsistent_capacity');
  const availableSeats = totalSeats - occupiedSeats - heldSeats;
  const requestedSeats = children.length;
  if (availableSeats < requestedSeats) {
    return Object.freeze({
      ...boundary, state: availableSeats === 0 ? 'full' as const : 'insufficient_for_family' as const,
      availableSeats, requestedSeats,
    });
  }

  return Object.freeze({
    ...boundary, state: 'ready_for_owner_review' as const, availableSeats, requestedSeats,
    binding: Object.freeze({
      workspaceId: wanted.workspaceId, programKey: wanted.programKey, familyId: wanted.familyId,
      offerId: wanted.offerId, offerRevision: wanted.offerRevision, definitionId: wanted.definitionId,
      offerSource: Object.freeze(wanted.offerSource), childIds: Object.freeze(children),
      groupId: wanted.groupId, groupRevision: wanted.groupRevision, period: Object.freeze(wanted.period),
      scheduleSource: Object.freeze(session.source), location: Object.freeze(session.location),
      firstClassAt: session.firstClassAt, firstClassLocalDate: session.firstClassLocalDate,
      capacitySource: Object.freeze(occupancy.source), capacityRevision: occupancy.revision,
      checkedAt: now,
      factsValidUntil: [session.validUntil, occupancy.validUntil, wanted.period.endsAt]
        .reduce((earlier, next) => compareInstants(earlier, next) <= 0 ? earlier : next),
    }),
  });
}

export type GroupSeatReadinessPlan = ReturnType<typeof planGroupSeatReadiness>;
