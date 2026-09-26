import { canonicalEmail } from '../identity/crypto.ts';
import type { AuthMailKind } from '../identity/auth-mail.ts';

/** Exact owner-verified recipient and account binding; plus aliases are not collapsed. */
export function demoSetupMailAllowed(
  kind: AuthMailKind,
  recipient: string,
  accountEmail: string,
  allowedRecipients: readonly string[] = [],
): boolean {
  if (kind !== 'invite' && kind !== 'reset') return false;
  const to = canonicalEmail(recipient);
  return to === canonicalEmail(accountEmail) && allowedRecipients.includes(to);
}
