import { z } from 'zod';
import { PROGRAM_SOURCE_V3, programSourceRecordV3Schema } from './program-source-contract-v3.ts';

export const PROGRAM_SOURCE_OWNER_PATH = '/api/private/fishing-program-sources';
const stored = z.object({ record: programSourceRecordV3Schema, digest: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const programSourceGroupDataV3Schema = z.object({
  version: z.literal(PROGRAM_SOURCE_V3), kind: z.literal('group_source'), classification: z.literal('scheduling_facts_only'),
  group: stored, lessons: z.array(stored).max(1000), progressions: z.array(stored).max(1000),
}).strict().superRefine((value, context) => {
  const group = value.group.record, groupId = group.command.groupId;
  if (group.command.kind !== 'group' || group.command.id !== groupId) context.addIssue({ code: 'custom', message: 'GROUP_SOURCE_MISMATCH' });
  for (const [records, kind] of [[value.lessons, 'lesson'], [value.progressions, 'progression']] as const) {
    if (new Set(records.map(item => item.record.command.id)).size !== records.length) context.addIssue({ code: 'custom', message: 'DUPLICATE_SOURCE' });
    for (const item of records) if (item.record.workspaceId !== group.workspaceId || item.record.command.groupId !== groupId || item.record.command.kind !== kind)
      context.addIssue({ code: 'custom', message: 'SOURCE_SCOPE_MISMATCH' });
  }
});
export const programSourceRecordedDataV3Schema = stored.extend({
  version: z.literal(PROGRAM_SOURCE_V3), kind: z.literal('recorded_source'), replayed: z.boolean(),
}).strict();
export type ProgramSourceGroupDataV3 = z.infer<typeof programSourceGroupDataV3Schema>;
export type ProgramSourceRecordedDataV3 = z.infer<typeof programSourceRecordedDataV3Schema>;
