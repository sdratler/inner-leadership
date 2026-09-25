import { describe, expect, it } from 'vitest';
import { demoSetupMailAllowed } from '../../src/features/demo/mail-policy.ts';
import { blindEmail, canonicalEmail } from '../../src/features/identity/crypto.ts';

describe('owner-controlled demo setup mail', () => {
  const account = 'owner+demo-parent@example.invalid';
  const allowed = [account];

  it('permits only an exact verified alias for invite or reset', () => {
    expect(demoSetupMailAllowed('invite', account, account, allowed)).toBe(true);
    expect(demoSetupMailAllowed('reset', account.toUpperCase(), account, allowed)).toBe(true);
    expect(demoSetupMailAllowed('invite', account, account, [])).toBe(false);
    expect(demoSetupMailAllowed('invite', 'owner@example.invalid', account, allowed)).toBe(false);
    expect(demoSetupMailAllowed('invite', account, 'owner+other@example.invalid', allowed)).toBe(false);
  });

  it('never sends routine notices or email changes from marked demo accounts', () => {
    for (const kind of ['case_notice', 'security_notice', 'email_change'] as const) {
      expect(demoSetupMailAllowed(kind, account, account, allowed)).toBe(false);
    }
  });

  it('keeps parent, child, and adult plus-addresses as distinct login identities', () => {
    const key=Buffer.alloc(32,7);
    const aliases=['owner+demo-parent@example.invalid','owner+demo-child@example.invalid','owner+demo-adult@example.invalid'];
    expect(aliases.map(canonicalEmail)).toEqual(aliases);
    expect(new Set(aliases.map(address=>blindEmail(address,key))).size).toBe(3);
    expect(blindEmail('owner@example.invalid',key)).not.toBe(blindEmail(aliases[0]!,key));
  });
});
