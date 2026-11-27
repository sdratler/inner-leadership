import 'server-only';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '../../lib/errors.ts';
import type { IdentityConfig } from '../identity/config.ts';
import type { IdentityStore } from '../identity/store.ts';
import { parseGmailAuthConfig } from '../../providers/email/gmail.ts';
import type { TripRuntimeConfig } from './config.ts';
import { INDIVIDUAL_TRIP_REGISTRATION_VERSION } from './registration-service.ts';
import type { RegistrationMailAdmission } from './registration-mail.ts';
import { TRIP_OPERATIONAL_MAIL_VERSION, type TripOperationalMailAdmission } from './operational-mail.ts';
import { StripeTripInvoiceLookup, type TripInvoiceProvider } from './invoice-provider.ts';

export const TRIP_INVOICE_LOOKUP_PURPOSE = 'fishing-trip-invoice-lookup-v1';
export const TRIP_PROVIDER_ENV = Object.freeze({
  registration: { enabled: 'LS_INDIVIDUAL_TRIPS_REGISTRATION_EMAIL_ENABLED', admission: 'LS_INDIVIDUAL_TRIPS_REGISTRATION_EMAIL_ADMISSION_JSON' },
  operational: { enabled: 'LS_INDIVIDUAL_TRIPS_OPERATIONAL_EMAIL_ENABLED', admission: 'LS_INDIVIDUAL_TRIPS_OPERATIONAL_EMAIL_ADMISSION_JSON' },
  invoice: { enabled: 'LS_INDIVIDUAL_TRIPS_INVOICE_LOOKUP_ENABLED', admission: 'LS_INDIVIDUAL_TRIPS_INVOICE_LOOKUP_ADMISSION_JSON' },
});
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const common = {
  workspaceId: z.uuid(), ownerAccountId: z.uuid(), origin: z.url(), databaseEnv: z.literal('LS_DATABASE_URL'),
  databaseSha256: sha256, caEnv: z.literal('LS_DATABASE_CA'), databaseCaSha256: sha256, tlsMode: z.literal('verify-full'),
};
const mail = { ...common, provider: z.literal('gmail'), sender: z.literal('office@bneineviimacademy.org') };
export const tripRegistrationAdmissionSchema = z.strictObject({ ...mail, purpose: z.literal(INDIVIDUAL_TRIP_REGISTRATION_VERSION) });
export const tripOperationalAdmissionSchema = z.strictObject({ ...mail, purpose: z.literal(TRIP_OPERATIONAL_MAIL_VERSION) });
export const tripInvoiceAdmissionSchema = z.strictObject({ ...common, purpose: z.literal(TRIP_INVOICE_LOOKUP_PURPOSE), provider: z.literal('stripe'),
  accountId: z.string().regex(/^acct_[A-Za-z0-9]+$/), livemode: z.literal(true), restrictedKeyEnv: z.literal('LS_INDIVIDUAL_TRIPS_STRIPE_RESTRICTED_KEY') });
type Common = z.infer<z.ZodObject<typeof common>>;
type Env = Readonly<Record<string, string | undefined>>;
type Identity = { config: IdentityConfig; store: IdentityStore };
type Availability = 'disabled' | 'unavailable' | 'configured';
export interface TripProviderConfiguration {
  effectStore: IdentityStore | null;
  registrationAdmission: RegistrationMailAdmission | null;
  operationalAdmission: TripOperationalMailAdmission | null;
  invoiceProvider: TripInvoiceProvider | null;
  availability: { registration: Availability; operational: Availability; invoice: Availability };
}

/** Configuration evidence only: no SQL, provider lookup, sender activation,
 * credential values in JSON, historical queue scan or fallback key/provider. */
export function tripProviderConfiguration(identity: Identity, config: TripRuntimeConfig, env: Env,
  providerFetch: typeof fetch = fetch): TripProviderConfiguration {
  const result: TripProviderConfiguration = { effectStore: null, registrationAdmission: null, operationalAdmission: null, invoiceProvider: null,
    availability: { registration: 'disabled', operational: 'disabled', invoice: 'disabled' } };
  function bind(pin: Common): IdentityStore {
    const databaseUrl = env.LS_DATABASE_URL, ca = env.LS_DATABASE_CA;
    if (!identity.config.enabled || env.LS_INDIVIDUAL_TRIPS_ENABLED !== 'true' || env.LS_DATABASE_TLS !== 'verify-full' ||
        env.NODE_TLS_REJECT_UNAUTHORIZED === '0' || !databaseUrl || !ca?.trim() ||
        identity.config.workspaceId !== config.workspaceId || identity.config.origin !== config.origin ||
        env.LS_INDIVIDUAL_TRIPS_WORKSPACE_ID !== config.workspaceId || env.LS_INDIVIDUAL_TRIPS_OWNER_ACCOUNT_ID !== config.ownerAccountId ||
        pin.workspaceId !== config.workspaceId || pin.ownerAccountId !== config.ownerAccountId || pin.origin !== config.origin ||
        hash(databaseUrl) !== pin.databaseSha256 || hash(ca) !== pin.databaseCaSha256) throw new AppError('UNAVAILABLE');
    const origin = new URL(pin.origin);
    if (origin.protocol !== 'https:' || origin.origin !== pin.origin || origin.username || origin.password) throw new AppError('UNAVAILABLE');
    const native = identity.store.bindFishingDatabaseTarget?.(databaseUrl, pin.databaseCaSha256);
    if (!native) throw new AppError('UNAVAILABLE');
    // Existing delivery adapters consume the same normal store API; only this
    // wrapper converts the explicit release proof into its retained capability.
    const fixed: IdentityStore = Object.freeze({
      transaction: native.transaction.bind(native),
      bindDatabaseTarget(expected: string) {
        if (expected !== databaseUrl || env.LS_DATABASE_URL !== databaseUrl || env.LS_DATABASE_TLS !== 'verify-full' ||
            env.NODE_TLS_REJECT_UNAUTHORIZED === '0' || !env.LS_DATABASE_CA || hash(env.LS_DATABASE_CA) !== pin.databaseCaSha256 ||
            !identity.store.bindFishingDatabaseTarget?.(expected, pin.databaseCaSha256)) return null;
        return fixed;
      },
    });
    return fixed;
  }
  for (const name of ['registration', 'operational'] as const) {
    const keys = TRIP_PROVIDER_ENV[name];
    if (env[keys.enabled] !== 'true') continue;
    result.availability[name] = 'unavailable';
    try {
      const raw: unknown = JSON.parse(env[keys.admission] ?? '');
      const pin = name === 'registration' ? tripRegistrationAdmissionSchema.parse(raw) : tripOperationalAdmissionSchema.parse(raw);
      parseGmailAuthConfig(env); const store = bind(pin);
      const target = { workspaceId: identity.config.workspaceId, origin: config.origin, databaseUrl: env.LS_DATABASE_URL! };
      if (name === 'registration') result.registrationAdmission = { ...target, purpose: INDIVIDUAL_TRIP_REGISTRATION_VERSION };
      else result.operationalAdmission = { ...target, purpose: TRIP_OPERATIONAL_MAIL_VERSION };
      result.effectStore ??= store;
      result.availability[name] = 'configured';
    } catch { /* This purpose alone stays closed. Never expose parsed secrets. */ }
  }
  const keys = TRIP_PROVIDER_ENV.invoice;
  if (env[keys.enabled] === 'true') {
    result.availability.invoice = 'unavailable';
    try {
      const pin = tripInvoiceAdmissionSchema.parse(JSON.parse(env[keys.admission] ?? ''));
      const restrictedKey = env[pin.restrictedKeyEnv] ?? '';
      if (!/^rk_live_[A-Za-z0-9]+$/.test(restrictedKey)) throw new AppError('UNAVAILABLE');
      const store = bind(pin);
      const provider = new StripeTripInvoiceLookup({ accountId: pin.accountId, livemode: true, restrictedKey }, providerFetch);
      const rawAdmission = env[keys.admission];
      result.invoiceProvider = { async lookup(invoiceId) {
        if (env[keys.enabled] !== 'true' || env[keys.admission] !== rawAdmission || env[pin.restrictedKeyEnv] !== restrictedKey ||
            !store.bindDatabaseTarget?.(env.LS_DATABASE_URL ?? '')) throw new AppError('UNAVAILABLE');
        return provider.lookup(invoiceId);
      } };
      result.effectStore ??= store;
      result.availability.invoice = 'configured';
    } catch { /* No test/full-key fallback; mail remains independently usable. */ }
  }
  return result;
}
