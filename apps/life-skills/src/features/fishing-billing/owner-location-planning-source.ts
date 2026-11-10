import { z } from 'zod';
import { programSourceCommandV3Schema } from './program-source-contract-v3.ts';
import { sourceReferenceSchema } from './contracts.ts';

export const OWNER_LOCATION_PLANNING_VERSION = 'JLFA-OWNER-LOCATION-PLANNING-v1' as const;
export const OWNER_LOCATION_PLANNING_PREFIX = 'owner-location-plan/v1/';
const group = programSourceCommandV3Schema.options[0].shape;
const statementSchema = z.object({
  version: z.literal(OWNER_LOCATION_PLANNING_VERSION), workspaceId: group.groupId, ownerAccountId: group.groupId,
  groupId: group.groupId, operationId: group.operationId, location: group.fields.shape.location,
}).strict();
export type OwnerLocationPlanningStatement = Omit<z.input<typeof statementSchema>, 'version'>;

/** Fingerprint of the owner's proposed location, durably carried by the native
 * record for this operation. This is NOT venue/transport/legal/skills approval
 * or a reference to an external source that nobody actually supplied. */
export async function ownerLocationPlanningSource(input: OwnerLocationPlanningStatement) {
  const statement = statementSchema.parse({ version: OWNER_LOCATION_PLANNING_VERSION, ...input });
  const bytes = new TextEncoder().encode(JSON.stringify(statement));
  const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  const sha256 = [...new Uint8Array(hash)].map(value => value.toString(16).padStart(2, '0')).join('');
  return sourceReferenceSchema.parse({ id: OWNER_LOCATION_PLANNING_PREFIX + statement.operationId, sha256 });
}
