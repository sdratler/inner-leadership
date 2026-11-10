import { z } from 'zod';
import { billingId, billingInstant, publishedOfferSchema, servicePeriodSchema, sourceReferenceSchema } from './contracts.ts';
import { calendarDateSchema, newYorkDate } from './contracts-v2.ts';

export const GROUP_PREPARATION_VERSION = 'JLFA-FISHING-GROUP-PREPARATION-v1' as const;
export const GROUP_PREPARATION_CLASS = 'preparation_only_not_authority' as const;
export const GROUP_PREPARATION_PROGRAM = publishedOfferSchema.shape.programKey.value;
const id = billingId.refine(value => value === value.toLowerCase(), 'CANONICAL_UUID_REQUIRED');
const reference = sourceReferenceSchema.refine(value => value.id.trim().length > 0);
const instant = billingInstant.refine(value => Number.isFinite(Date.parse(value)));
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const maxRevision = 2_147_483_647; // The proposed storage column is a PostgreSQL integer.
export const groupPreparationRevision = z.number().int().positive().max(maxRevision);
export const groupPreparationId = id;

function submillisecond(value: string) {
  return (/\.(\d+)/.exec(value)?.[1]?.slice(3) ?? '').replace(/0+$/, '');
}

function compareInstant(left: string, right: string) {
  const difference = Date.parse(left) - Date.parse(right);
  if (difference !== 0) return difference;
  const a = submillisecond(left), b = submillisecond(right);
  return a === b ? 0 : a < b ? -1 : 1;
}

/** An owner may know just the local date, or just the proposed label. Preserve each unknown. */
export const groupPreparationFields = z.object({
  label: z.string().min(1).max(160).refine(value => value.trim() === value && value.length > 0),
  timeZone: z.literal('America/New_York'),
  period: servicePeriodSchema.nullable(),
  firstClassAt: instant.nullable(),
  firstClassLocalDate: calendarDateSchema.nullable(),
  venueSource: reference.nullable(),
  proposedCapacity: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable(),
}).strict().superRefine((v, ctx) => {
  const issue = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
  if (v.firstClassAt && v.firstClassLocalDate && newYorkDate(v.firstClassAt) !== v.firstClassLocalDate) {
    issue('firstClassLocalDate', 'LOCAL_DATE_MISMATCH');
  }
  if (!v.period) return;
  if (v.firstClassAt && (compareInstant(v.firstClassAt, v.period.startsAt) < 0 || compareInstant(v.firstClassAt, v.period.endsAt) >= 0)) {
    issue('firstClassAt', 'OUTSIDE_SERVICE_PERIOD');
  }
  if (v.firstClassLocalDate) {
    // A date-only proposal can overlap any part of the half-open period. This does not set a class time.
    const end = Date.parse(v.period.endsAt) - (submillisecond(v.period.endsAt) ? 0 : 1);
    if (v.firstClassLocalDate < newYorkDate(v.period.startsAt) || v.firstClassLocalDate > newYorkDate(new Date(end).toISOString())) {
      issue('firstClassLocalDate', 'OUTSIDE_SERVICE_PERIOD');
    }
  }
});

const commandBase = { version: z.literal(GROUP_PREPARATION_VERSION), groupId: id, operationId: id };
const expected = groupPreparationRevision.max(maxRevision - 1);
const fields = groupPreparationFields.shape;
const newDraftFields = z.object({
  ...fields,
  period: fields.period.default(null), firstClassAt: fields.firstClassAt.default(null),
  firstClassLocalDate: fields.firstClassLocalDate.default(null), venueSource: fields.venueSource.default(null),
  proposedCapacity: fields.proposedCapacity.default(null),
}).strict().pipe(groupPreparationFields);
// On edit, omission preserves a value and an explicit null clears it. Validate the combined
// local date, time and period against the stored revision inside the transaction.
const editFields = z.object(fields).partial().strict()
  .refine(value => Object.keys(value).length > 0 && Object.values(value).every(item => item !== undefined));
export const groupPreparationCommand = z.discriminatedUnion('action', [
  z.object({ ...commandBase, action: z.literal('create'), expectedRevision: z.literal(0), fields: newDraftFields }).strict(),
  z.object({ ...commandBase, action: z.literal('edit'), expectedRevision: expected, fields: editFields }).strict(),
  z.object({ ...commandBase, action: z.literal('cancel'), expectedRevision: expected }).strict(),
]);

const recordedInstant = z.iso.datetime({ precision: 3 });
export const groupPreparationRecord = z.object({
  version: z.literal(GROUP_PREPARATION_VERSION),
  classification: z.literal(GROUP_PREPARATION_CLASS),
  programKey: publishedOfferSchema.shape.programKey,
  workspaceId: id, groupId: id, revision: groupPreparationRevision,
  state: z.enum(['draft', 'cancelled']),
  action: z.enum(['create', 'edit', 'cancel']),
  createdBy: id, createdAt: recordedInstant, recordedBy: id, recordedAt: recordedInstant,
  operationId: id, requestDigest: digest, previousDigest: digest.nullable(),
  fields: groupPreparationFields,
}).strict().superRefine((r, ctx) => {
  const initial = r.action === 'create';
  if ((r.revision === 1) !== initial || (r.previousDigest === null) !== initial ||
      (r.state === 'cancelled') !== (r.action === 'cancel') || r.recordedAt < r.createdAt ||
      (initial && (r.createdBy !== r.recordedBy || r.createdAt !== r.recordedAt))) {
    ctx.addIssue({ code: 'custom', message: 'INVALID_REVISION_HISTORY' });
  }
});

export type GroupPreparationFields = z.infer<typeof groupPreparationFields>;
export type GroupPreparationCommand = z.infer<typeof groupPreparationCommand>;
export type GroupPreparationRecord = z.infer<typeof groupPreparationRecord>;
