import { z } from "zod";
import { validDate, validIso, validTimezone } from "./policy.ts";

const uuid = z.string().uuid().transform(value => value.toLowerCase());
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const identifier = z.string().min(1).max(128);
const date = z.string().refine(validDate);
const iso = z.string().refine(validIso);
const zone = z.string().refine(validTimezone);
const clock = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const unique = (ids: readonly string[]) => new Set(ids).size === ids.length;
const accounts = z.array(uuid).min(1).max(8).refine(unique);
const focus = z.enum(["responsibility", "communication", "regulation", "values", "planning", "relationships", "problem_solving"]);

export const recapPracticeSelectionSchema = z.strictObject({
  versionId: uuid, expectedSourceDigest: digest,
  // A reviewed short instruction, not silent truncation of the native source.
  instructions: z.string().trim().min(1).max(500),
});
export type RecapPracticeSelection = z.infer<typeof recapPracticeSelectionSchema>;
export const recapDraftSchema = z.strictObject({
  locale: z.enum(["en", "he"]), focus: z.array(focus).max(3).refine(unique),
  nextStep: z.string().max(300), expectedVersion: z.number().int().min(0),
  practiceSelections: z.array(recapPracticeSelectionSchema).max(20).refine(rows => unique(rows.map(row => row.versionId))).optional(),
});
export type RecapDraftInput = z.infer<typeof recapDraftSchema>;
export const recapShareInputSchema=z.strictObject({expectedVersion:z.number().int().positive(),expectedDigest:digest,recipientAccountIds:accounts});

const sharedPractice = z.strictObject({
  assignmentId: identifier, version: z.number().int().positive(), responsibilityId: identifier,
  audienceAccountIds: z.array(identifier).min(1).max(8).refine(unique),
  participant: z.enum(["client", "parent"]), instructions: z.string().min(1).max(500),
  localTime: clock, timezone: zone, startsOn: date, endsOn: date,
}).refine(value => value.startsOn <= value.endsOn);
/** Strict public whitelist. Never accept a private record spread into a recap. */
export const routineRecapSchema = z.strictObject({
  schemaVersion: z.literal(1), sessionId: identifier, caseId: identifier,
  version: z.number().int().positive(), locale: z.enum(["en", "he"]),
  attendance: z.strictObject({ appointmentId: identifier,
    state: z.enum(["present", "late", "no_show", "canceled", "unrecorded"]),
    source: z.literal("appointment_record"), revision: z.number().int().min(0), startsAt: iso, arrivedAt: iso.nullable() }),
  focus: z.array(focus).max(3).refine(unique),
  practices: z.array(sharedPractice).max(20).refine(rows => unique(rows.map(row => row.responsibilityId))),
  nextStep: z.string().max(300), nextAppointment: z.strictObject({ id: identifier, startsAt: iso, endsAt: iso,
    timezone: zone, source: z.literal("calendar") }).refine(row => Date.parse(row.startsAt) < Date.parse(row.endsAt)).nullable(),
});
export const recapVersionViewSchema = z.strictObject({ recap: routineRecapSchema, digest });
export type RecapVersionView = z.infer<typeof recapVersionViewSchema>;
export const recapSharePreviewSchema = z.strictObject({ recap: routineRecapSchema, digest,
  recipients: z.array(z.strictObject({ accountId: uuid, name: z.string().min(1).max(500) })).min(1).max(8)
    .refine(rows => unique(rows.map(row => row.accountId))),
});
export type RecapSharePreview = z.infer<typeof recapSharePreviewSchema>;
export const recapPublicationSchema = z.strictObject({ publicationId: uuid, sessionId: uuid, caseId: uuid,
  sharedAt: iso, contentDigest: digest, recipientAccountIds: accounts, recap: routineRecapSchema }).refine(row=>row.sessionId===row.recap.sessionId&&row.caseId===row.recap.caseId);
export type RecapPublication = z.infer<typeof recapPublicationSchema>;
export const sharedRecapViewSchema = z.strictObject({ publicationId: uuid, sessionId: uuid, sharedAt: iso, recap: routineRecapSchema });
export const sharedRecapListSchema = z.array(sharedRecapViewSchema).max(100);

export const recapPracticeChoiceSchema = z.strictObject({
  assignmentId: uuid, versionId: uuid, version: z.number().int().positive(), sourceDigest: digest,
  audienceAccountIds: accounts, participant: z.enum(["client", "parent"]), instructions: z.string().min(1).max(2000),
  localTime: clock, timezone: zone, startsOn: date, endsOn: date,
  weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7).refine(rows => new Set(rows).size === rows.length),
  completionMode: z.enum(["any_assignee", "each_assignee"]),
}).refine(row => row.startsOn <= row.endsOn);
export const recapPracticeChoicesSchema = z.strictObject({ items: z.array(recapPracticeChoiceSchema).max(20), hasMore: z.boolean() });
export type RecapPracticeChoice = z.infer<typeof recapPracticeChoiceSchema>;
export type RecapPracticeChoices = z.infer<typeof recapPracticeChoicesSchema>;
