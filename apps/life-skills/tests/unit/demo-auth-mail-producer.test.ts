import { describe, expect, test } from 'vitest';
import { queueAuthMail } from '../../src/features/identity/auth-mail.ts';
import { opaqueToken, seal, type Keyring } from '../../src/features/identity/crypto.ts';
import type { AccountRow } from '../../src/features/identity/data.ts';
import type { IdentityConfig } from '../../src/features/identity/config.ts';
import type { SqlSession } from '../../src/features/identity/store.ts';

const workspaceId = '8bf3cad7-9a39-4204-9c8a-7ad45f709403';
const accountId = '0fdbe39d-c33e-45a6-8e8a-a60799ac6c4d';
const keyring: Keyring = { activeKeyId: 'test', keys: { test: Buffer.alloc(32, 1) } };
const account = {
  id: accountId,
  workspaceId,
  emailCiphertext: seal('owner+demo@example.invalid', `email:${workspaceId}:${accountId}`, keyring),
  locale: 'en',
} as AccountRow;
const context = { now: new Date('2026-09-25T12:00:00Z'), requestId: 'test-request' } as never;

function fixture(allowlist: readonly string[]) {
  const inserts: string[] = [];
  const tx: SqlSession = {
    query: async <T extends object>(sql: string): Promise<T[]> => {
      if (sql.includes('FROM ls_demo.accounts')) return [{ batchId: 'ls-owner-20260925' }] as T[];
      if (sql.includes('INSERT INTO ls_identity.auth_mail_outbox')) { inserts.push(sql); return []; }
      throw new Error('unexpected query');
    },
  };
  const config = { workspaceId, keyring, demoSetupRecipients: allowlist } as IdentityConfig;
  return { tx, config, inserts };
}

describe('demo auth-mail producer boundary', () => {
  test('does not queue normal case or security notices', async () => {
    const f = fixture(['owner+demo@example.invalid']);
    await queueAuthMail(f.tx, f.config, account, context, 'case_notice', null);
    await queueAuthMail(f.tx, f.config, account, context, 'security_notice', null);
    expect(f.inserts).toHaveLength(0);
  });

  test('does not queue setup mail to an unlisted account or alternate recipient', async () => {
    const f = fixture([]);
    await queueAuthMail(f.tx, f.config, account, context, 'invite', opaqueToken());
    expect(f.inserts).toHaveLength(0);
    const allowed = fixture(['owner+demo@example.invalid']);
    await queueAuthMail(allowed.tx, allowed.config, account, context, 'invite', opaqueToken(), 'other@example.invalid');
    expect(allowed.inserts).toHaveLength(0);
  });

  test('queues only exact allowlisted owner setup mail', async () => {
    const f = fixture(['owner+demo@example.invalid']);
    await queueAuthMail(f.tx, f.config, account, context, 'invite', opaqueToken());
    expect(f.inserts).toHaveLength(1);
  });
});
