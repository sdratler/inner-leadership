import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {CONTACT_AUTHORITY_MIGRATION} from '../../../src/db/contact-ops-production-guard.ts';

export const legacyAuthorityMigration={name:CONTACT_AUTHORITY_MIGRATION.name,checksum:CONTACT_AUTHORITY_MIGRATION.sha256,
 sql:readFileSync(new URL('../../../migrations/0105_ls_contact_authority.sql',import.meta.url),'utf8')};

// The shared disposable database has the full current manifest. These named
// Academy dependencies must be removed before exercising absent legacy objects;
// never use CASCADE, which could hide a new dependency from the proof fixture.
export const academyAuthorityDependents=[
 'DROP TABLE ls_contact_ops.academy_crm_activity',
 'DROP TABLE ls_contact_ops.academy_crm_contacts',
 'DROP FUNCTION ls_contact_ops.guard_academy_crm_admission()',
] as const;

/** Test-only historical catalog, used exclusively inside BEGIN/ROLLBACK probes.
 * The legacy production operator deliberately does not admit migration 0138.
 * Replay the pinned 0105 schema instead of relaxing its checks or catalog hash.
 * Recreating these objects also handles Academy rows left by other test files
 * without rewriting their phases/history; rollback restores all current data.
 */
export function legacyAuthorityFixtureStatements():readonly string[]{
 if(createHash('sha256').update(legacyAuthorityMigration.sql.replace(/\r\n/g,'\n')).digest('hex')!==legacyAuthorityMigration.checksum)
  throw new Error('LEGACY_AUTHORITY_FIXTURE_SOURCE_MISMATCH');
 return [...academyAuthorityDependents,
  'DROP TABLE ls_contact_ops.cutover_history',
  'DROP TABLE ls_contact_ops.cutover',
  'DROP FUNCTION ls_contact_ops.deny_cutover_history_mutation()',
  legacyAuthorityMigration.sql];
}
