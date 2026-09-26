import { AppError } from '../../lib/errors.ts';
import { canonicalEmail } from '../identity/crypto.ts';

export interface DemoOperatorPlan {
  batch: string;
  ownerEmail: string;
  addresses: Readonly<{parent: string; child: string; adult: string}>;
}

/** The owner explicitly selected three separate Gmail plus-addressed identities.
 * This has no database, mail or provider side effects. */
export function demoOperatorPlan(input: {
  batch: string | undefined;
  ownerEmail: string | undefined;
  parentEmail: string | undefined;
  childEmail: string | undefined;
  adultEmail: string | undefined;
  setupRecipients: readonly string[] | undefined;
  childAccountsEnabled: boolean;
}): DemoOperatorPlan {
  if (!input.batch || !/^ls-owner-[0-9]{8}$/.test(input.batch) || !input.ownerEmail) throw new AppError('INVALID_REQUEST');
  const ownerEmail = canonicalEmail(input.ownerEmail);
  const match = /^([^+@]+)@gmail\.com$/.exec(ownerEmail);
  if (!match) throw new AppError('INVALID_REQUEST');
  const addresses = Object.freeze({
    parent: `${match[1]}+demo-parent@gmail.com`,
    child: `${match[1]}+demo-child@gmail.com`,
    adult: `${match[1]}+demo-adult@gmail.com`,
  });
  if (canonicalEmail(input.parentEmail ?? '') !== addresses.parent ||
      canonicalEmail(input.childEmail ?? '') !== addresses.child ||
      canonicalEmail(input.adultEmail ?? '') !== addresses.adult ||
      JSON.stringify([...(input.setupRecipients ?? [])].sort()) !== JSON.stringify(Object.values(addresses).sort()) ||
      !input.childAccountsEnabled) throw new AppError('FORBIDDEN');
  return Object.freeze({ batch: input.batch, ownerEmail, addresses });
}
