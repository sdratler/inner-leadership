import { createHmac, randomUUID } from 'node:crypto';
import { AppError } from '../../lib/errors.ts';
import type { IdentityConfig } from '../identity/config.ts';
import { canonicalEmail, seal, unseal } from '../identity/crypto.ts';
import { freshActor, lockWorkspace } from '../identity/data.ts';
import { one, type IdentityStore, type SqlSession } from '../identity/store.ts';
import type { Actor, IdentityClock, Locale } from '../identity/types.ts';
import { GmailAuthTransport, parseGmailAuthConfig } from '../../providers/email/gmail.ts';
import type { AuthEmailMessage, AuthEmailTransport } from '../../providers/email/transport.ts';
import { TRIP_TIME_ZONE, TRIP_VERSION, type TripCommand, type TripHousehold, type TripOffer, type TripReply, type TripState } from './contract.ts';
import type { TripRuntimeConfig } from './config.ts';
import { applyTripCommand, householdCreditMinor } from './engine.ts';
import type { IndividualTripStore } from './store.ts';

export const TRIP_OPERATIONAL_MAIL_VERSION = 'fishing-trip-operational-mail-v1';
type Kind = 'request_saved' | 'request_withdrawn' | 'seasonal_saved' | 'seasonal_withdrawn' | 'offer' | 'payment' | 'confirmation' | 'cancellation' | 'credit';
export type TripOperationalMailState = 'queued' | 'unknown' | 'sent' | 'failed' | 'canceled' | 'held';
interface QueueRuntime { identity: IdentityConfig; tripConfig: TripRuntimeConfig; clock: IdentityClock; }
export interface TripOperationalMailRuntime extends QueueRuntime {
  store: IdentityStore; actor: Actor;
  trips: Pick<IndividualTripStore, 'read' | 'executeInternal'>;
}
export interface TripOperationalMailAdmission {
  purpose: typeof TRIP_OPERATIONAL_MAIL_VERSION; workspaceId: string; origin: string; databaseUrl: string;
}
export type TripOperationalTransportFactory = (beforeMessageSend: (message: AuthEmailMessage) => Promise<void>) => AuthEmailTransport;
export interface TripOperationalMailResult { id: string; kind: Kind; state: TripOperationalMailState; deliveryRecordState: string; }
type Env = Readonly<Record<string, string | undefined>>;
interface Recipient { emailCiphertext: string; emailBlind: string; locale: Locale; }
interface Payload { version: typeof TRIP_OPERATIONAL_MAIL_VERSION; recipient: string; emailBlind: string; locale: Locale; subject: string; text: string; quoteDigest: string | null; }
interface Job {
  id: string; actorId: string; householdId: string; recipientId: string; kind: Kind; offerId: string | null;
  ciphertext: string; state: TripOperationalMailState; deliveryOperationId: string; deliveryRecordState: string;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const selectJobs = `SELECT id,actor_account_id AS "actorId",household_id AS "householdId",recipient_account_id AS "recipientId",kind,offer_id AS "offerId",
 payload_ciphertext AS ciphertext,state,delivery_operation_id AS "deliveryOperationId",delivery_record_state AS "deliveryRecordState"
 FROM ls_individual_trips.operational_mail`;
const recipientSql = `SELECT a.email_ciphertext AS "emailCiphertext",a.email_blind AS "emailBlind",a.locale
 FROM ls_identity.accounts a JOIN ls_identity.account_subjects s ON s.workspace_id=a.workspace_id AND s.account_id=a.id
 JOIN ls_identity.people p ON p.workspace_id=s.workspace_id AND p.id=s.person_id AND p.kind='adult'
 JOIN ls_individual_trips.memberships m ON m.workspace_id=a.workspace_id AND m.account_id=a.id
 WHERE a.workspace_id=$1 AND a.id=$2 AND a.role='parent' AND a.state='active' AND a.email_verified_at IS NOT NULL
 AND m.household_id=$3 AND m.state='active'`;
function scope(runtime: QueueRuntime) {
  if (!runtime.identity.enabled || runtime.identity.workspaceId !== runtime.tripConfig.workspaceId || runtime.identity.origin !== runtime.tripConfig.origin) throw new AppError('UNAVAILABLE');
}
function digest(offer: TripOffer, identity: IdentityConfig) {
  return createHmac('sha256', identity.lookupKey).update(JSON.stringify({ quoteId: offer.quoteId, householdId: offer.householdId,
    snapshot: offer.snapshot, children: offer.children.map(child => ({ id: child.childId, name: child.childName, amountMinor: child.amountMinor })) })).digest('hex');
}
function displayTime(value: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale === 'he' ? 'he-IL' : 'en-US', { timeZone: TRIP_TIME_ZONE, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}
function amount(minor: number, locale: Locale) { return new Intl.NumberFormat(locale === 'he' ? 'he-IL' : 'en-US', { style: 'currency', currency: 'USD' }).format(minor / 100); }
function content(kind: Kind, state: TripState, household: TripHousehold, offer: TripOffer | undefined, command: TripCommand,
  reply: TripReply, locale: Locale, runtime: QueueRuntime): { subject: string; text: string } {
  const t = (en: string, he: string) => locale === 'he' ? he : en;
  const titles: Record<Kind, string> = {
    request_saved: t('Date interest saved', 'ההתעניינות בתאריכים נשמרה'), request_withdrawn: t('Date interest withdrawn', 'ההתעניינות בתאריכים נמשכה'),
    seasonal_saved: t('Seasonal interest saved', 'ההתעניינות העונתית נשמרה'), seasonal_withdrawn: t('Seasonal interest withdrawn', 'ההתעניינות העונתית נמשכה'),
    offer: t('Your individual trip offer', 'הצעה לטיול דיג אישי'), payment: t('Payment update recorded', 'עדכון תשלום תועד'),
    confirmation: t('Trip confirmation recorded', 'אישור טיול תועד'), cancellation: t('Cancellation update recorded', 'עדכון ביטול תועד'), credit: t('Household credit update recorded', 'עדכון זיכוי משפחתי תועד'),
  };
  const lines = [titles[kind], '', t('Recorded update', 'עדכון שתועד') + ': ' + displayTime(runtime.clock.now().toISOString(), locale) + ' (America/New_York)'];
  if (kind.startsWith('request_')) {
    const input = command as Extract<TripCommand, { type: 'availability.save' | 'availability.withdraw' }>;
    const request = household.availability.find(row => row.id === ('requestId' in input ? input.requestId : reply.id));
    if (request) lines.push(household.children.find(child => child.id === request.childId)?.name ?? '',
      request.selection === 'all' ? t('Interest in every selected date', 'התעניינות בכל תאריך שנבחר') : t('Any one of these alternatives for this child', 'אחת מהחלופות האלה עבור הילד'),
      ...request.options.map(option => `${option.date} · ${option.kind === 'keys' ? t('Florida Keys', 'פלורידה קיז') : t('Local fishing', 'דיג מקומי')} · ${option.pickupAreas.join(', ').slice(0, 250)}`));
  }
  if (kind.startsWith('seasonal_')) {
    const input = command as Extract<TripCommand, { type: 'seasonal.save' | 'seasonal.withdraw' }>;
    const interest = household.seasonal.find(row => row.season === input.season && row.year === input.year);
    if (interest) lines.push(`${interest.season === 'summer' ? t('Summer', 'קיץ') : t('Pesach', 'פסח')} ${interest.year}`,
      interest.childIds.map(id => household.children.find(child => child.id === id)?.name).filter(Boolean).join(', '),
      interest.periods.map(period => ({ before: t('Before', 'לפני'), during: t('During', 'במהלך'), after: t('After', 'אחרי'), dates_unsure: t('Dates undecided', 'התאריכים טרם נקבעו') })[period]).join(', '),
      interest.possibleWeeks.join(', '), interest.pickupAreas.join(', '));
  }
  if (kind.startsWith('request_') || kind.startsWith('seasonal_')) lines.push('', t('Free interest creates no booked place, charge or payment deadline.', 'התעניינות חינמית אינה יוצרת מקום מוזמן, חיוב או מועד לתשלום.'));
  if (offer) {
    lines.push('', offer.snapshot.kind === 'keys' ? t('Florida Keys outing', 'טיול לפלורידה קיז') : t('Local fishing outing', 'טיול דיג מקומי'),
      t('Pickup', 'איסוף') + ': ' + offer.snapshot.pickupHubLabel,
      t('Departure', 'יציאה') + ': ' + displayTime(offer.snapshot.departureAt, locale),
      t('Return', 'חזרה') + ': ' + displayTime(offer.snapshot.returnAt, locale),
      t('Fishing', 'דיג') + ': ' + displayTime(offer.snapshot.fishingStartAt, locale) + ' — ' + displayTime(offer.snapshot.fishingEndAt, locale),
      t('Equipment', 'ציוד') + ': ' + offer.snapshot.equipment, t('Water', 'מים') + ': ' + offer.snapshot.water,
      t('Media group', 'קבוצת מדיה') + ': ' + (offer.snapshot.mediaGroup === 'yes' ? t('Uses media', 'משתמשים במדיה') : t('No video-capable devices, including filtered or offline. Non-video gaming requires instructor permission.', 'ללא מכשירים המאפשרים וידאו, גם מסוננים או ללא אינטרנט. משחקים ללא וידאו מחייבים אישור מדריך.')),
      ...offer.children.filter(child=>kind!=='confirmation'||child.status==='confirmed').map(child => `${child.childName}: ${amount(child.amountMinor, locale)}`));
    if (kind === 'confirmation') {
      const others = state.offers.filter(row => row.id !== offer.id && row.householdId === household.id && row.departureId === offer.departureId && row.status === 'confirmed');
      for (const other of others) lines.push(...other.children.filter(child => child.status === 'confirmed').map(child => `${child.childName}: ${amount(child.amountMinor, locale)}`));
    }
    if (kind === 'offer') lines.push('', t('Accept the exact date, pickup hub, children and fares in your private dashboard. Acceptance alone is not payment. A successful delivery starts the normal 48-hour payment window.', 'קבלו בסביבה הפרטית את התאריך, נקודת האיסוף, הילדים והמחירים המדויקים. קבלת ההצעה אינה תשלום. מסירה מוצלחת מתחילה את חלון התשלום הרגיל של 48 שעות.'));
    if (kind === 'payment') {
      const receipt = state.receipts.find(row => row.id === reply.receiptId && row.offerId === offer.id);
      if (receipt) lines.push(t('Actual payment received', 'תשלום שהתקבל בפועל') + ': ' + amount(receipt.amountMinor, locale),
        t('Not yet allocated', 'טרם שויך') + ': ' + amount(receipt.unappliedMinor, locale));
      lines.push(t('A payment record alone does not confirm every child; check each child’s saved status in your dashboard.', 'תיעוד תשלום לבדו אינו מאשר כל ילד; בדקו את המצב השמור של כל ילד בסביבה הפרטית.'));
    }
    if (kind === 'cancellation' || kind === 'credit') lines.push(...offer.children.filter(child => child.cancellationReceivedAt).map(child =>
      `${child.childName}: ${t('cancellation received', 'בקשת ביטול התקבלה')} ${displayTime(child.cancellationReceivedAt!, locale)} · ${t('credit restored', 'זיכוי שהוחזר')}: ${amount(child.creditRestoredMinor, locale)}`));
    lines.push('', t('At least 24 hours before departure, eligible parent cancellation restores the value allocated to the child as household dollar credit. No voluntary cash refund; other cases require review.', 'בביטול הורה מזכה לפחות 24 שעות לפני היציאה, הסכום ששויך לילד מוחזר כזיכוי דולרי למשק הבית. אין החזר כספי מרצון; מקרים אחרים מחייבים בדיקה.'));
  }
  if (kind === 'credit' || kind === 'cancellation' || kind === 'payment') lines.push(t('Saved household dollar credit balance', 'יתרת זיכוי דולרית שנשמרה למשק הבית') + ': ' + amount(householdCreditMinor(state, household.id), locale));
  lines.push('', `${runtime.identity.origin}/${locale}/trips`, '', t('Sign in to review the latest private record. Do not forward this message. Operational update only.', 'היכנסו כדי לבדוק את הרשומה הפרטית העדכנית. אין להעביר הודעה זו. זהו עדכון תפעולי בלבד.'));
  const text = lines.filter((line, index, all) => line !== '' || all[index - 1] !== '').join('\n');
  return { subject: 'Fishing Academy — ' + titles[kind], text };
}

/** Called only after the native operation receipt insert, inside that same SQL
 * transaction. Never performs network access or changes offer clocks. */
export async function queueTripOperationalMail(tx: SqlSession, runtime: QueueRuntime, state: TripState, command: TripCommand,
  reply: TripReply, actorId: string): Promise<void> {
  scope(runtime);
  if (state.version !== TRIP_VERSION || reply.replayed) return;
  const operation=await one<{operationAt:Date}>(tx, 'SELECT created_at AS "operationAt" FROM ls_individual_trips.operations WHERE workspace_id=$1 AND operation_id=$2 AND actor_account_id=$3', [runtime.identity.workspaceId, command.operationId, actorId]);
  if (!operation) throw new AppError('FORBIDDEN');
  const targets: { household: TripHousehold; kind: Kind; offer?: TripOffer }[] = [];
  const type: string = command.type;
  const offerId = 'offerId' in command ? command.offerId : reply.offerId;
  const offer = offerId ? state.offers.find(row => row.id === offerId) : undefined;
  const householdId = 'householdId' in command ? command.householdId : offer?.householdId ?? reply.householdId ?? state.households.find(row => row.ownerAccountId === actorId)?.id;
  const household = state.households.find(row => row.id === householdId);
  const requestKinds: Record<string, Kind> = { 'availability.save': 'request_saved', 'availability.withdraw': 'request_withdrawn', 'seasonal.save': 'seasonal_saved', 'seasonal.withdraw': 'seasonal_withdrawn' };
  if (household && requestKinds[type]) targets.push({ household, kind: requestKinds[type]! });
  else if (household && offer && type === 'offer.prepare') targets.push({ household, kind: 'offer', offer });
  else if (household && offer && ['cash.record_received', 'payment.record_verified'].includes(type) && state.receipts.some(row => row.id === reply.receiptId && row.offerId === offer.id)) targets.push({ household, kind: 'payment', offer });
  else if (household && offer && type === 'offer.apply_credit') targets.push({ household, kind: 'credit', offer });
  else if (household && offer && ['booking.cancel', 'booking.resolve_exception', 'offer.expire'].includes(type)) targets.push({ household, kind: 'cancellation', offer });
  else if (household && offer && type === 'invoice.reconcile_closed' && offer.children.some(child => child.cancellationFinalizedAt === new Date(operation.operationAt).toISOString())) targets.push({ household, kind: 'cancellation', offer });
  else if (type === 'departure.confirm' && 'departureId' in command) {
    for (const row of state.offers.filter(item => item.departureId === command.departureId && item.status === 'confirmed')) {
      const family = state.households.find(item => item.id === row.householdId);
      if (family && !targets.some(item => item.household.id === family.id)) targets.push({ household: family, kind: 'confirmation', offer: row });
    }
  } else if (type === 'receipt.resolve_credit') {
    const reference = (command as unknown as { receiptId?: string }).receiptId ?? reply.receiptId;
    const receipt = state.receipts.find(row => row.id === reference), family = state.households.find(row => row.id === receipt?.householdId);
    if (family) targets.push({ household: family, kind: 'credit', ...(state.offers.find(row => row.id === receipt!.offerId) ? { offer: state.offers.find(row => row.id === receipt!.offerId)! } : {}) });
  }
  for (const target of targets) {
    if (!target.household.profile.contactConsent) continue;
    const accountId = target.household.ownerAccountId;
    const recipient = await one<Recipient>(tx, recipientSql, [runtime.identity.workspaceId, accountId, target.household.id]);
    if (!recipient) continue;
    const id = randomUUID(), payload: Payload = { version: TRIP_OPERATIONAL_MAIL_VERSION, recipient: canonicalEmail(unseal(recipient.emailCiphertext,
      `email:${runtime.identity.workspaceId}:${accountId}`, runtime.identity.keyring)), emailBlind: recipient.emailBlind, locale: recipient.locale,
      ...content(target.kind, state, target.household, target.offer, command, reply, recipient.locale, runtime), quoteDigest: target.offer ? digest(target.offer, runtime.identity) : null };
    await tx.query(`INSERT INTO ls_individual_trips.operational_mail
      (id,workspace_id,operation_id,actor_account_id,household_id,recipient_account_id,kind,version,offer_id,payload_ciphertext,state,delivery_operation_id,delivery_record_state,created_at,reason,event_key)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
      ON CONFLICT DO NOTHING`, [id, runtime.identity.workspaceId, command.operationId, actorId, target.household.id,
      accountId, target.kind, TRIP_OPERATIONAL_MAIL_VERSION, target.offer?.id ?? null, seal(JSON.stringify(payload), `trip-mail:${runtime.identity.workspaceId}:${id}`, runtime.identity.keyring),
      payload.text.length > 4700 ? 'held' : 'queued', randomUUID(), target.kind === 'offer' ? 'pending' : 'not_applicable', runtime.clock.now(), payload.text.length > 4700 ? 'message_size_requires_review' : null,
      target.kind + ':' + (target.kind === 'payment' ? reply.receiptId! : target.kind === 'confirmation' ? target.offer!.departureId : command.operationId)]);
  }
}

function admitted(runtime: TripOperationalMailRuntime, env: Env, admission: TripOperationalMailAdmission | null) {
  if (!admission || admission.purpose !== TRIP_OPERATIONAL_MAIL_VERSION || !runtime.identity.enabled ||
      runtime.identity.workspaceId !== runtime.tripConfig.workspaceId || runtime.identity.origin !== runtime.tripConfig.origin ||
      admission.workspaceId !== runtime.identity.workspaceId || admission.origin !== runtime.identity.origin ||
      runtime.actor.workspaceId !== runtime.identity.workspaceId ||
      env.LS_INDIVIDUAL_TRIPS_ENABLED !== 'true' || env.LS_INDIVIDUAL_TRIPS_OPERATIONAL_EMAIL_ENABLED !== 'true' ||
      env.LS_INDIVIDUAL_TRIPS_WORKSPACE_ID !== runtime.tripConfig.workspaceId || env.LS_INDIVIDUAL_TRIPS_OWNER_ACCOUNT_ID !== runtime.tripConfig.ownerAccountId ||
      env.LS_AUTH_EMAIL_ENABLED !== 'true' || env.LS_AUTH_EMAIL_PROVIDER !== 'gmail' || !admission.databaseUrl || env.LS_DATABASE_URL !== admission.databaseUrl) return null;
  return runtime.store.bindDatabaseTarget?.(admission.databaseUrl) ?? null;
}
async function eligibility(tx: SqlSession, runtime: TripOperationalMailRuntime, job: Job, payload: Payload) {
  if (runtime.actor.id !== job.actorId) throw new AppError('FORBIDDEN');
  const actor = await freshActor(tx, runtime.actor, runtime.clock.now());
  if (!actor.emailVerifiedAt || actor.role !== 'parent' && !(actor.role === 'practitioner' && actor.id === runtime.tripConfig.ownerAccountId)) throw new AppError('FORBIDDEN');
  if (actor.role === 'parent' && actor.id !== job.recipientId) throw new AppError('FORBIDDEN');
  const recipient = await one<Recipient>(tx, recipientSql, [runtime.identity.workspaceId, job.recipientId, job.householdId]);
  if (!recipient || recipient.emailBlind !== payload.emailBlind || canonicalEmail(unseal(recipient.emailCiphertext,
    `email:${runtime.identity.workspaceId}:${job.recipientId}`, runtime.identity.keyring)) !== payload.recipient) throw new AppError('FORBIDDEN');
}
async function preflightOffer(runtime: TripOperationalMailRuntime, job: Job, payload: Payload, sentAt: string) {
  const state = await runtime.trips.read(runtime.actor), household = state.households.find(row => row.id === job.householdId && row.ownerAccountId === job.recipientId);
  if (!household?.profile.contactConsent) throw new AppError('FORBIDDEN');
  if (job.kind !== 'offer') return;
  if (runtime.actor.id !== runtime.tripConfig.ownerAccountId) throw new AppError('FORBIDDEN');
  const offer = state.offers.find(row => row.id === job.offerId);
  if (!offer || digest(offer, runtime.identity) !== payload.quoteDigest || offer.deliveryState !== 'pending_delivery') throw new AppError('CONFLICT');
  // This calls the real pure rules: default48h must fit before departure and
  // cancelled/expired offers cannot send. No fabricated short-notice deadline.
  applyTripCommand(state, { accountId: runtime.actor.id, role: 'owner' }, { type: 'delivery.record_sent', operationId: job.deliveryOperationId,
    expectedRevision: state.revision, offerId: offer.id, sentAt }, { now: new Date(sentAt), newId: randomUUID });
}

/** Dispatch only jobs belonging to the supplied newly accepted native operation.
 * It is intentionally not a queue worker or historical resend endpoint. */
export async function deliverTripOperationalMail(runtime: TripOperationalMailRuntime, operationId: string, env: Env,
  admission: TripOperationalMailAdmission | null, createTransport?: TripOperationalTransportFactory): Promise<TripOperationalMailResult[]> {
  const store = UUID.test(operationId) ? admitted(runtime, env, admission) : null;
  if (!store) return [];
  const jobs = await store.transaction(tx => tx.query<Job>(selectJobs + ' WHERE workspace_id=$1 AND operation_id=$2 AND version=$3 AND actor_account_id=$4 ORDER BY id', [runtime.identity.workspaceId, operationId, TRIP_OPERATIONAL_MAIL_VERSION, runtime.actor.id]));
  const results: TripOperationalMailResult[] = [];
  for (const job of jobs) {
    const result = () => ({ id: job.id, kind: job.kind, state: job.state, deliveryRecordState: job.deliveryRecordState });
    if (job.state !== 'queued') { results.push(result()); continue; }
    let payload: Payload;
    try {
      payload = JSON.parse(unseal(job.ciphertext, `trip-mail:${runtime.identity.workspaceId}:${job.id}`, runtime.identity.keyring)) as Payload;
      if (payload.version !== TRIP_OPERATIONAL_MAIL_VERSION || !['en', 'he'].includes(payload.locale) || typeof payload.recipient !== 'string' ||
          typeof payload.subject !== 'string' || typeof payload.text !== 'string' || !payload.subject.startsWith('Fishing Academy — ') || payload.text.length > 4700) throw new Error('INVALID_PAYLOAD');
      await store.transaction(async tx => { await lockWorkspace(tx, runtime.identity.workspaceId); await eligibility(tx, runtime, job, payload); });
    } catch {
      await store.transaction(tx => tx.query("UPDATE ls_individual_trips.operational_mail SET state='canceled',reason='recipient_or_actor_ineligible',completed_at=$3 WHERE workspace_id=$1 AND id=$2 AND state='queued'", [runtime.identity.workspaceId, job.id, runtime.clock.now()]));
      job.state = 'canceled'; results.push(result()); continue;
    }
    try { await preflightOffer(runtime, job, payload, runtime.clock.now().toISOString()); }
    catch {
      await store.transaction(tx => tx.query("UPDATE ls_individual_trips.operational_mail SET state='held',reason='offer_requires_review_or_short_notice',completed_at=$3 WHERE workspace_id=$1 AND id=$2 AND state='queued'", [runtime.identity.workspaceId, job.id, runtime.clock.now()]));
      job.state = 'held'; results.push(result()); continue;
    }
    const claimed = await store.transaction(async tx => {
      await lockWorkspace(tx, runtime.identity.workspaceId);
      const rows = await tx.query("UPDATE ls_individual_trips.operational_mail SET state='unknown',attempts=1,reason='send_reserved' WHERE workspace_id=$1 AND id=$2 AND state='queued' AND attempts=0 RETURNING id", [runtime.identity.workspaceId, job.id]);
      return rows.length === 1;
    });
    if (!claimed) {
      const latest = await store.transaction(tx => one<Job>(tx, selectJobs + ' WHERE workspace_id=$1 AND id=$2', [runtime.identity.workspaceId, job.id]));
      if (latest) Object.assign(job, latest); results.push(result()); continue;
    }
    job.state = 'unknown'; let attempted = false, sentAt: string | null = null;
    try {
      const providerConfig = parseGmailAuthConfig(env);
      const beforeMessageSend = async (message: AuthEmailMessage) => {
        if (attempted || !admitted(runtime, env, admission) || message.idempotencyKey !== `ls-auth-${job.id}` || message.to !== payload.recipient || message.from !== providerConfig.from) throw new AppError('FORBIDDEN');
        const actual = runtime.clock.now().toISOString();
        await preflightOffer(runtime, job, payload, actual);
        if (job.kind === 'offer') message.text = payload.text + '\n\n' + (payload.locale === 'he' ? 'מועד אחרון לתשלום: ' : 'Payment deadline: ') + displayTime(new Date(Date.parse(actual) + 48 * 3600_000).toISOString(), payload.locale) + ' (America/New_York)';
        await store.transaction(async tx => {
          await lockWorkspace(tx, runtime.identity.workspaceId); await eligibility(tx, runtime, job, payload);
          const reserved = await tx.query(`UPDATE ls_individual_trips.operational_mail SET attempted_payload_ciphertext=$3,send_started_at=$4
            WHERE workspace_id=$1 AND id=$2 AND state='unknown' AND attempts=1 RETURNING id`, [runtime.identity.workspaceId, job.id,
            seal(JSON.stringify({ ...payload, text: message.text }), `trip-mail-attempt:${runtime.identity.workspaceId}:${job.id}`, runtime.identity.keyring), actual]);
          if (reserved.length !== 1) throw new AppError('CONFLICT');
        });
        sentAt = actual; attempted = true;
      };
      const provider = createTransport ? createTransport(beforeMessageSend) : new GmailAuthTransport(providerConfig, fetch, 'JLFA Office', beforeMessageSend);
      const sent = await provider.send({ from: providerConfig.from, to: payload.recipient, subject: payload.subject, text: payload.text, idempotencyKey: `ls-auth-${job.id}` });
      if (!attempted || !sentAt || !/^[A-Za-z0-9_-]{1,256}$/.test(sent.providerId)) throw new Error('SEND_EVIDENCE_MISSING');
      // Provider acceptance is retained even if the separate native clock write
      // cannot commit. Such a case needs reconciliation, never another email.
      await store.transaction(tx => tx.query("UPDATE ls_individual_trips.operational_mail SET state='sent',sent_at=$3,provider_id=$4,reason=NULL,completed_at=$5 WHERE workspace_id=$1 AND id=$2 AND state='unknown'", [runtime.identity.workspaceId, job.id, sentAt, sent.providerId, runtime.clock.now()]));
      job.state = 'sent';
      if (job.kind === 'offer') {
        try {
          const current = await runtime.trips.read(runtime.actor), offer = current.offers.find(row => row.id === job.offerId);
          if (!offer || digest(offer, runtime.identity) !== payload.quoteDigest) throw new AppError('CONFLICT');
          if (offer.deliveryState === 'sent') job.deliveryRecordState = 'already_recorded';
          else {
            await runtime.trips.executeInternal(runtime.actor, { type: 'delivery.record_sent', operationId: job.deliveryOperationId,
              expectedRevision: current.revision, offerId: job.offerId!, sentAt });
            job.deliveryRecordState = 'recorded';
          }
        } catch { job.deliveryRecordState = 'unknown'; }
        await store.transaction(tx => tx.query('UPDATE ls_individual_trips.operational_mail SET delivery_record_state=$3 WHERE workspace_id=$1 AND id=$2', [runtime.identity.workspaceId, job.id, job.deliveryRecordState]));
      }
    } catch {
      if (job.state === 'sent') {
        // Provider acceptance and its committed receipt are already certain.
        // A later metadata write cannot turn that message into an unknown send.
        if (job.kind === 'offer') job.deliveryRecordState = 'unknown';
        results.push(result()); continue;
      }
      job.state = attempted ? 'unknown' : 'failed';
      // A lost sent-receipt commit remains UNKNOWN. Never downgrade or replay.
      try { await store.transaction(tx => tx.query("UPDATE ls_individual_trips.operational_mail SET state=$3,reason=$4,completed_at=$5 WHERE workspace_id=$1 AND id=$2 AND state='unknown'", [runtime.identity.workspaceId, job.id, job.state, attempted ? 'provider_outcome_unknown' : 'not_sent', runtime.clock.now()])); } catch { job.state = 'unknown'; }
      if (attempted && job.kind === 'offer') {
        try {
          const current = await runtime.trips.read(runtime.actor), offer = current.offers.find(row => row.id === job.offerId);
          if (offer && offer.deliveryState !== 'sent') await runtime.trips.executeInternal(runtime.actor, { type: 'delivery.record_unknown',
            operationId: randomUUID(), expectedRevision: current.revision, offerId: offer.id });
        } catch { /* Native reconciliation remains required; never replay mail. */ }
      }
    }
    results.push(result());
  }
  return results;
}
