import 'server-only';
import { AppError } from './errors.ts';
import { freshActor } from '../features/identity/data.ts';
import type { SqlSession } from '../features/identity/store.ts';
import type { Actor, IdentityClock } from '../features/identity/types.ts';

import type {FishingOwnerBinding} from './fishing-owner-binding.ts';
export {configuredFishingOwnerBinding} from './fishing-owner-binding.ts';
export type {FishingOwnerBinding,FishingOwnerEnvironment} from './fishing-owner-binding.ts';

export function boundFishingOwner(binding: FishingOwnerBinding, actor: Actor): Readonly<Actor> {
  const owner = Object.freeze({ ...actor });
  if (owner.workspaceId !== binding.workspaceId || owner.id !== binding.accountId || owner.role !== 'practitioner' || owner.state !== 'active')
    throw new AppError('FORBIDDEN');
  return owner;
}

/** Explicit lock mode keeps read-only native transactions genuinely read-only. */
export async function isCurrentNativeFishingOwner(tx: SqlSession, binding: FishingOwnerBinding, lock: 'none' | 'update'): Promise<boolean> {
  const rows = await tx.query<{ id: string }>(
    "SELECT a.id FROM ls_identity.accounts a WHERE a.workspace_id=$1 AND a.id=$2 AND a.state='active' AND a.role='practitioner' " +
    'AND NOT EXISTS (SELECT 1 FROM ls_demo.accounts d WHERE d.workspace_id=a.workspace_id AND d.account_id=a.id)' + (lock === 'update' ? ' FOR UPDATE OF a' : ''),
    [binding.workspaceId, binding.accountId]);
  return rows.length === 1 && rows[0]?.id === binding.accountId;
}

/** Run after all native/source postludes, inside the actual data transaction.
 * Writes pin owner state/demo exclusion, session and its subject until commit.
 * Reads retain the existing READ ONLY transaction and take fresh snapshots. */
export async function assertCurrentFishingOwner(
  tx: SqlSession, binding: FishingOwnerBinding, actor: Actor, intent: 'read' | 'write', clock: IdentityClock,
): Promise<void> {
  const owner = boundFishingOwner(binding, actor);
  if (!await isCurrentNativeFishingOwner(tx, binding, intent === 'write' ? 'update' : 'none')) throw new AppError('FORBIDDEN');
  if (intent === 'write') {
    const sessions = await tx.query<{ id: string }>(
      'SELECT s.account_id AS id FROM ls_identity.sessions s JOIN ls_identity.account_subjects subject ON subject.workspace_id=s.workspace_id AND subject.account_id=s.account_id ' +
      "JOIN ls_identity.people p ON p.workspace_id=subject.workspace_id AND p.id=subject.person_id AND p.kind='adult' " +
      'WHERE s.workspace_id=$1 AND s.account_id=$2 AND s.token_digest=$3 AND subject.person_id=$4 AND s.revoked_at IS NULL ' +
      'AND s.expires_at>GREATEST($5::timestamptz,clock_timestamp()) FOR SHARE OF s,subject,p',
      [owner.workspaceId, owner.id, owner.sessionDigest, owner.personId, clock.now()]);
    if (sessions.length !== 1) throw new AppError('UNAUTHENTICATED');
  }
  const current = await freshActor(tx, owner, clock.now());
  if (current.id !== owner.id || current.workspaceId !== owner.workspaceId || current.personId !== owner.personId || current.role !== 'practitioner' || current.state !== 'active')
    throw new AppError('FORBIDDEN');
  // A fresh statement after acquiring the account lock catches a demo-marker
  // insertion that committed while that lock was being acquired.
  if (!await isCurrentNativeFishingOwner(tx, binding, 'none')) throw new AppError('FORBIDDEN');
}
