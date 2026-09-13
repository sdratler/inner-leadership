/** Real service-to-service retry contract; opt-in disposable PostgreSQL only. */
import { randomBytes, randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { fixture, poolStore } from './fixture.ts';
import type { IdentityConfig } from '../../../src/features/identity/config.ts';
import { unseal } from '../../../src/features/identity/crypto.ts';
import { systemClock } from '../../../src/features/identity/types.ts';
import { HomePracticeService } from '../../../src/features/home-practice/service.ts';
import { UpdateService } from '../../../src/features/updates/service.ts';

test('UpdateService validates durable adaptation request bytes on retry and leaves the published version immutable', async () => {
  const f = await fixture({ termsVersion: 'Product2.3' });
  try {
    const config: IdentityConfig = {
      enabled: true, origin: 'https://synthetic.example.invalid', workspaceId: f.workspaceId,
      csrfKey: randomBytes(32), lookupKey: randomBytes(32), rateLimitKey: randomBytes(32).toString('hex'),
      keyring: f.keyring, sessionSeconds: 28_800,
    };
    const store = poolStore(f.pool);
    const practice = new HomePracticeService(store, config, systemClock);
    const updates = new UpdateService(store, config, systemClock, practice, practice);
    const draft = await practice.createDraft(f.practitioner.actor, {
      caseId: f.first.id, audienceId: f.first.audienceId, templateKey: 'W01', templateVersion: 'Program2.1',
      instructions: 'Synthetic original practice instructions.', startsOn: f.at(0).slice(0, 10),
      endsOn: f.at(24 * 7).slice(0, 10),
    }, randomUUID());
    const published = await practice.publish(f.practitioner.actor, draft.assignmentId, draft.versionId, randomUUID());
    const original = await f.pool.query(
      'SELECT * FROM ls_practice.practice_assignment_versions WHERE workspace_id=$1 AND id=$2',
      [f.workspaceId, draft.versionId]);
    const report = await updates.submitParentReport(f.parent.actor, {
      caseId: f.first.id, audienceId: f.first.audienceId, practiceVersionId: published.versionId,
      body: 'Synthetic parent context used only by this local test.', idempotencyKey: randomUUID(),
    }, randomUUID());
    await updates.review(f.practitioner.actor, report.id, randomUUID());
    const input = { reportId: report.id, adaptedInstructions: 'Synthetic revised practice: pause before naming the feeling.', idempotencyKey: randomUUID() };
    const adapted = await updates.adapt(f.practitioner.actor, input, randomUUID());
    expect(adapted).toMatchObject({ reportId: report.id, assignmentId: draft.assignmentId, previousVersionId: draft.versionId, state: 'draft' });
    expect(adapted.newVersionId).not.toBe(draft.versionId);
    expect(await updates.adapt(f.practitioner.actor, input, randomUUID())).toEqual(adapted);
    await expect(updates.adapt(f.practitioner.actor, { ...input, adaptedInstructions: 'Different synthetic instruction bytes.' }, randomUUID()))
      .rejects.toMatchObject({ code: 'CONFLICT' });

    const versions = await f.pool.query<{ id: string; state: string; instructions: string; startsOn: string; endsOn: string; previousVersion: string | null }>(
      `SELECT id,state,instructions_ciphertext AS instructions,starts_on::text AS "startsOn",ends_on::text AS "endsOn",
       supersedes_version_id AS "previousVersion" FROM ls_practice.practice_assignment_versions
       WHERE workspace_id=$1 AND assignment_id=$2 ORDER BY version`, [f.workspaceId, draft.assignmentId]);
    expect(versions.rows).toHaveLength(2);
    expect(versions.rows[0]).toMatchObject({ id: draft.versionId, state: 'published', previousVersion: null });
    expect(versions.rows[1]).toMatchObject({ id: adapted.newVersionId, state: 'draft', previousVersion: draft.versionId,
      startsOn: versions.rows[0]!.startsOn, endsOn: versions.rows[0]!.endsOn });
    expect(versions.rows[1]!.instructions).not.toContain(input.adaptedInstructions);
    expect(unseal(versions.rows[1]!.instructions, `practice-version:${f.workspaceId}:${adapted.newVersionId}`, f.keyring)).toBe(input.adaptedInstructions);
    expect((await f.pool.query(
      'SELECT * FROM ls_practice.practice_assignment_versions WHERE workspace_id=$1 AND id=$2',
      [f.workspaceId, draft.versionId])).rows).toEqual(original.rows);
    const counts = await f.pool.query<{ integration: number; updates: number; activeVersion: string }>(
      `SELECT (SELECT count(*)::int FROM ls_integration.practice_adaptation_receipts WHERE workspace_id=$1 AND source_report_id=$2) AS integration,
       (SELECT count(*)::int FROM ls_updates.adaptation_receipts WHERE workspace_id=$1 AND report_id=$2) AS updates,
       (SELECT active_version_id FROM ls_practice.practice_assignments WHERE workspace_id=$1 AND id=$3) AS "activeVersion"`,
      [f.workspaceId, report.id, draft.assignmentId]);
    expect(counts.rows).toEqual([{ integration: 1, updates: 1, activeVersion: draft.versionId }]);
    await expect(updates.adapt(f.parent.actor, input, randomUUID())).rejects.toMatchObject({ code: 'NOT_FOUND' });
  } finally { await f.pool.end(); }
}, 30_000);
