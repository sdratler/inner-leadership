import type { IdentityConfig } from '../identity/config.ts';
import { canonicalEmail, unseal } from '../identity/crypto.ts';
import { lockWorkspace } from '../identity/data.ts';
import { one, type IdentityStore } from '../identity/store.ts';
import type { IdentityClock, Locale, WorkspaceId } from '../identity/types.ts';
import { dispatchOneAuthMail } from '../../providers/email/dispatch.ts';
import { GmailAuthTransport, parseGmailAuthConfig } from '../../providers/email/gmail.ts';
import type { AuthEmailMessage, AuthEmailTransport } from '../../providers/email/transport.ts';
import { INDIVIDUAL_TRIP_REGISTRATION_VERSION } from './registration-service.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type RegistrationMailState = 'queued' | 'suppressed' | 'sent' | 'unknown' | 'failed' | 'canceled';
export interface RegistrationMailRuntime { store: IdentityStore; config: IdentityConfig; clock: IdentityClock; }
/** Server-owned release admission, never decoded from request data or inferred
 * from a configured sender. It admits this purpose and this exact original DB.
 * The caller is responsible for obtaining the explicit release authorization. */
export interface RegistrationMailAdmission {
  purpose: typeof INDIVIDUAL_TRIP_REGISTRATION_VERSION;
  workspaceId: WorkspaceId; origin: string; databaseUrl: string;
}
type Env = Readonly<Record<string, string | undefined>>;
type Schedule = (callback: () => Promise<void>) => void;
export type RegistrationTransportFactory = (beforeMessageSend: (message: AuthEmailMessage) => void) => AuthEmailTransport;
interface ReceiptRow {
  state: RegistrationMailState; outboxId: string | null; accountId: string | null;
  emailCiphertext: string | null; locale: Locale | null; outboxState: string | null;
}

function admitted(runtime: RegistrationMailRuntime, env: Env, admission: RegistrationMailAdmission | null): IdentityStore | null {
  if (!admission || admission.purpose !== INDIVIDUAL_TRIP_REGISTRATION_VERSION ||
      !runtime.config.enabled || admission.workspaceId !== runtime.config.workspaceId || admission.origin !== runtime.config.origin ||
      env.LS_INDIVIDUAL_TRIPS_ENABLED !== 'true' || env.LS_INDIVIDUAL_TRIPS_REGISTRATION_EMAIL_ENABLED !== 'true' ||
      env.LS_INDIVIDUAL_TRIPS_WORKSPACE_ID !== runtime.config.workspaceId ||
      env.LS_AUTH_EMAIL_ENABLED !== 'true' || env.LS_AUTH_EMAIL_PROVIDER !== 'gmail' ||
      !admission.databaseUrl || env.LS_DATABASE_URL !== admission.databaseUrl) return null;
  return runtime.store.bindDatabaseTarget?.(admission.databaseUrl) ?? null;
}

/** An accepted request can dispatch only its own new invite. No historical
 * inquiry/reset drain, recipient override, resend or fallback provider exists.
 * The receipt is conservatively terminal before network; a crash or unknown
 * provider result can never cause this adapter to send it again. */
export async function deliverRegistrationMail(runtime: RegistrationMailRuntime, requestId: string, env: Env,
  admission: RegistrationMailAdmission | null, createTransport?: RegistrationTransportFactory): Promise<RegistrationMailState> {
  if (!UUID.test(requestId)) return 'suppressed';
  const store = admitted(runtime, env, admission);
  if (!store) return 'suppressed';
  const receipt = await store.transaction(async tx => {
    await lockWorkspace(tx, runtime.config.workspaceId);
    const row = await one<ReceiptRow>(tx, `SELECT r.delivery_state AS state,r.outbox_id AS "outboxId",r.account_id AS "accountId",
      a.email_ciphertext AS "emailCiphertext",a.locale,m.state AS "outboxState"
      FROM ls_individual_trips.registration_receipts r
      LEFT JOIN ls_identity.accounts a ON a.workspace_id=r.workspace_id AND a.id=r.account_id
      LEFT JOIN ls_identity.auth_mail_outbox m ON m.workspace_id=r.workspace_id AND m.id=r.outbox_id AND m.account_id=r.account_id AND m.kind='invite'
      WHERE r.workspace_id=$1 AND r.request_id=$2 AND r.version=$3 FOR UPDATE OF r`,
    [runtime.config.workspaceId, requestId, INDIVIDUAL_TRIP_REGISTRATION_VERSION]);
    if (!row || row.state !== 'queued') return row;
    const state: RegistrationMailState = row.outboxState === 'sent' ? 'sent' : row.outboxState === 'canceled' ? 'canceled' :
      row.outboxState !== 'queued' || !row.emailCiphertext ? 'failed' : 'unknown';
    await tx.query(`UPDATE ls_individual_trips.registration_receipts SET delivery_state=$3,updated_at=$4
      WHERE workspace_id=$1 AND request_id=$2`, [runtime.config.workspaceId, requestId, state, runtime.clock.now()]);
    return { ...row, state, claimed: state === 'unknown' };
  });
  if (!receipt) return 'suppressed';
  if (!('claimed' in receipt) || !receipt.claimed || !receipt.outboxId || !receipt.accountId || !receipt.emailCiphertext || !receipt.locale) return receipt.state;
  let attempted = false;
  let state: RegistrationMailState = 'failed';
  try {
    const providerConfig = parseGmailAuthConfig(env), from = providerConfig.from;
    const recipient = canonicalEmail(unseal(receipt.emailCiphertext,
      `email:${runtime.config.workspaceId}:${receipt.accountId}`, runtime.config.keyring));
    const beforeMessageSend = (message: AuthEmailMessage) => {
      if (!admitted(runtime, env, admission) || message.idempotencyKey !== `ls-auth-${receipt.outboxId}` ||
          message.to !== recipient || message.from !== from) throw new Error('REGISTRATION_MAIL_SCOPE_DENIED');
      attempted = true;
    };
    const provider = createTransport ? createTransport(beforeMessageSend) :
      new GmailAuthTransport(providerConfig, fetch, 'JLFA Office', beforeMessageSend);
    // Force the existing durable, at-most-once auth dispatch path even if a
    // synthetic transport omits its nonIdempotent marker.
    const transport: AuthEmailTransport = { nonIdempotent: true, send: async message => {
      if (message.idempotencyKey !== `ls-auth-${receipt.outboxId}` || message.to !== recipient) throw new Error('REGISTRATION_MAIL_SCOPE_DENIED');
      const line = message.text.split('\n').find(value => value.startsWith(runtime.config.origin + '/auth/invite#token='));
      if (!line) throw new Error('REGISTRATION_INVITE_LINK_INVALID');
      const link = new URL(line);
      if (link.origin !== runtime.config.origin || link.pathname !== '/auth/invite' || link.search ||
          !/^#token=[A-Za-z0-9_-]{43}$/.test(link.hash)) throw new Error('REGISTRATION_INVITE_LINK_INVALID');
      link.pathname = `/${receipt.locale}/login`; link.search = new URLSearchParams({mode:'invite',next:`/${receipt.locale}/trips`}).toString();
      const he = receipt.locale === 'he';
      const content = {
        ...message,
        subject: he ? 'Fishing Academy — הפעלת חשבון הורה' : 'Fishing Academy — activate your parent account',
        text: he ? `ביקשת לפתוח חשבון הורה חינמי ב־Fishing Academy.\n\n${link.href}\n\nבחרו סיסמה, ולאחר מכן היכנסו לחשבון כדי להצטרף ולשמור פרטי משפחה ובקשות. הקישור תקף ל־24 שעות. אין להעביר הודעה זו. אם לא ביקשתם חשבון, התעלמו מההודעה.` :
          `You requested a free Fishing Academy parent account.\n\n${link.href}\n\nChoose a password, then sign in to join and save your household details and requests. This link expires in 24 hours. Do not forward this email. If you did not request an account, ignore it.`,
      };
      return provider.send(content);
    } };
    const result = await dispatchOneAuthMail(store, runtime.config, runtime.clock, transport, from, receipt.outboxId);
    state = result === 'sent' ? 'sent' : result === 'canceled' ? 'canceled' : attempted ? 'unknown' : 'failed';
  } catch { state = attempted ? 'unknown' : 'failed'; }
  try {
    await store.transaction(tx => tx.query(`UPDATE ls_individual_trips.registration_receipts SET delivery_state=$3,updated_at=$4
      WHERE workspace_id=$1 AND request_id=$2 AND delivery_state='unknown'`,
    [runtime.config.workspaceId, requestId, state, runtime.clock.now()]));
  } catch { return 'unknown'; }
  return state;
}

/** Call only after the public handler has accepted its CSRF/rate-limited POST.
 * Scheduling is opt-in and requires the separate server-owned admission. */
export async function scheduleRegistrationDelivery(request: Request, response: Response, runtime: RegistrationMailRuntime,
  env: Env, schedule: Schedule, admission: RegistrationMailAdmission | null): Promise<void> {
  if (!admitted(runtime, env, admission) || request.method !== 'POST' || response.status !== 202 ||
      new URL(request.url).origin !== runtime.config.origin || new URL(request.url).pathname !== '/api/individual-trips/register') return;
  let body: unknown;
  try { body = await response.clone().json(); } catch { return; }
  if (!body || typeof body !== 'object') return;
  const envelope = body as { ok?: unknown; data?: { accepted?: unknown }; requestId?: unknown };
  if (envelope.ok !== true || envelope.data?.accepted !== true || typeof envelope.requestId !== 'string' || !UUID.test(envelope.requestId)) return;
  const requestId = envelope.requestId;
  schedule(async () => {
    try { await deliverRegistrationMail(runtime, requestId, env, admission); }
    catch { console.error('FISHING_REGISTRATION_DELIVERY_UNCERTAIN'); }
  });
}
