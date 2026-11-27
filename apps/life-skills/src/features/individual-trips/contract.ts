import { z } from 'zod';

export const TRIP_VERSION = 'JLFA-INDIVIDUAL-TRIPS-20261127-v1' as const;
export const TRIP_TIME_ZONE = 'America/New_York' as const;
export type TripKind = 'local' | 'keys';
export type TripActor = { accountId: string; role: 'owner' | 'parent'; householdId?: string };
export type TripChild = { id: string; name: string; age: number; mediaUse: boolean; fishingExperience: string; ownsRod: boolean };
export type TripProfile = { guardianName: string; phone: string; pickupAreas: string[]; contactConsent: boolean; marketingConsent: boolean };
export type TripOption = { date: string; kind: TripKind; pickupAreas: string[] };
export type TripAvailability = { id: string; childId: string; selection: 'all' | 'any'; options: TripOption[]; note: string; status: 'interested' | 'withdrawn'; createdAt: string; history: { selection: 'all' | 'any'; options: TripOption[]; note: string; status: 'interested' | 'withdrawn'; replacedAt: string }[] };
export type TripSeasonalInterest = { id: string; season: 'summer' | 'pesach'; year: number; childIds: string[]; periods: ('before' | 'during' | 'after' | 'dates_unsure')[]; possibleWeeks: string[]; pickupAreas: string[]; note: string; status: 'interested' | 'withdrawn' };
export type TripHousehold = { id: string; ownerAccountId: string; revision: number; profile: TripProfile; children: TripChild[]; availability: TripAvailability[]; seasonal: TripSeasonalInterest[]; createdAt: string };
export type TripPrice = { firstMinor: number; siblingMinor: number };
export type TripDepartureInput = {
  kind: TripKind; title: string; desiredChildLimit: number; activityChildLimit: number;
  sonAttending: boolean; otherNonpayingChildren: { id: string; name: string }[];
  transport: { verified: boolean; totalSeats: number; driverAdults: number; otherAdults: number; vehicleId: string };
  ownerResourceId: string; minimumPaid: number; operationalReady: boolean;
  pickupHub: { id: string; label: string; permissionConfirmed: boolean };
  departureAt: string; returnAt: string; fishingStartAt: string; fishingEndAt: string;
  mediaGroup: 'yes' | 'no'; equipment: string; water: string;
};
export type TripDeparture = TripDepartureInput & { id: string; revision: number; timeZone: typeof TRIP_TIME_ZONE; status: 'draft' | 'confirmed' | 'completed' | 'cancelled'; attendance: { childId: string; present: boolean; recordedAt: string }[] };
export type TripQuoteChild = { childId: string; childName: string; requestGroupIds: string[]; requestGroupSelections: { id: string; selection: 'all' | 'any' }[]; amountMinor: number; status: 'held' | 'confirmed' | 'cancelled' | 'reconciliation_required'; cancellationReceivedAt: string | null; cancellationReason: 'parent' | 'owner' | null; cancellationFinalizedAt: string | null; creditRestoredMinor: number };
export type TripOffer = {
  id: string; quoteId: string; householdId: string; departureId: string; priceVersion: number;
  snapshot: { kind: TripKind; date: string; pickupHubId: string; pickupHubLabel: string; departureAt: string; returnAt: string; fishingStartAt: string; fishingEndAt: string; equipment: string; water: string; mediaGroup: 'yes' | 'no'; termsVersion: typeof TRIP_VERSION };
  children: TripQuoteChild[]; deliveryState: 'pending_delivery' | 'sent' | 'unknown' | 'cancelled';
  preparedAt: string; sentAt: string | null; paymentDeadline: string | null; acceptedAt: string | null;
  status: 'pending_delivery' | 'offered' | 'accepted' | 'partially_paid' | 'confirmed' | 'reconciliation_required' | 'expired' | 'cancelled';
  invoice: { id: string; url: string; amountMinor: number; customerId:string;customerEmailBlind:string;status: 'open' | 'paid' | 'void' | 'uncollectible' | 'unknown'; allPaymentsReconciled: boolean } | null;
  paymentUnknown: boolean; expirationRequestedAt: string | null; ownerNote: string;
  exceptions: { at: string; actorAccountId: string; childIds: string[]; grantCredit: boolean; note: string }[];
};
export type TripReceipt = { id: string; householdId: string; offerId: string; source: 'cash' | 'stripe'; paymentKey: string; amountMinor: number; unappliedMinor: number; receivedAt: string; providerEvents: string[]; resolution: 'allocated' | 'reconciliation_required'; creditResolutions?:{id:string;amountMinor:number;ownerAccountId:string;note:string;at:string}[] };
export type TripAllocation = { id: string; householdId: string; offerId: string; childId: string; amountMinor: number; source: 'receipt' | 'credit'; sourceId: string; restoredAt: string | null };
export type TripCreditEntry = { id: string; householdId: string; amountMinor: number; kind: 'cancellation_credit' | 'credit_spent' | 'reconciliation_credit'; offerId: string; childId: string | null; allocationIds: string[]; receiptId?:string; at: string };
export type TripWaitlist={id:string;householdId:string;childId:string;departureId:string;status:'waiting'|'offered'|'withdrawn';note:string;createdAt:string;updatedAt:string};
export type TripState = { version: typeof TRIP_VERSION; revision: number; priceVersion: number; prices: Record<TripKind, TripPrice>; households: TripHousehold[]; departures: TripDeparture[]; offers: TripOffer[]; receipts: TripReceipt[]; allocations: TripAllocation[]; creditLedger: TripCreditEntry[];waitlist:TripWaitlist[] };
export type TripReply = { id?: string; householdId?: string; revision: number; status: string; receiptId?: string; offerId?: string; creditMinor?: number; replayed?: boolean };
export type TripCommandContext = { now: Date; newId(): string };

const id = z.string().uuid();
const label = z.string().trim().min(1).max(160);
const note = z.string().trim().max(2000).default('');
const money = z.number().int().min(1).max(100_000_000);
const key = z.string().trim().min(1).max(200).regex(/^[A-Za-z0-9_:./-]+$/);
const date = z.string().regex(/^20\d{2}-\d{2}-\d{2}$/);
const instant = z.string().datetime({ offset: true });
const areas = z.array(label).max(8).refine(values => new Set(values).size === values.length);
const childIds = z.array(id).min(1).max(15).refine(values => new Set(values).size === values.length);
const base = { operationId: id, expectedRevision: z.number().int().min(0) };
export const tripProfileSchema = z.object({ guardianName: label, phone: z.string().trim().max(40), pickupAreas: areas, contactConsent: z.boolean(), marketingConsent: z.boolean().default(false) }).strict();
export const tripChildSchema = z.object({ name: label, age: z.number().int().min(1).max(17), mediaUse: z.boolean(), fishingExperience: note, ownsRod: z.boolean() }).strict();
export const tripDepartureSchema = z.object({
  kind: z.enum(['local', 'keys']), title: label, desiredChildLimit: z.number().int().min(1).max(60), activityChildLimit: z.number().int().min(1).max(60),
  sonAttending: z.boolean().default(true), otherNonpayingChildren: z.array(z.object({ id, name: label }).strict()).max(15).default([]),
  transport: z.object({ verified: z.boolean(), totalSeats: z.number().int().min(0).max(80), driverAdults: z.number().int().min(0).max(8), otherAdults: z.number().int().min(0).max(15), vehicleId: label }).strict(),
  ownerResourceId: label, minimumPaid: z.number().int().min(1).max(60), operationalReady: z.boolean(),
  pickupHub: z.object({ id: label, label, permissionConfirmed: z.boolean() }).strict(),
  departureAt: instant, returnAt: instant, fishingStartAt: instant, fishingEndAt: instant,
  mediaGroup: z.enum(['yes', 'no']), equipment: z.string().trim().max(1000), water: z.string().trim().max(1000),
}).strict();
const option = z.object({ date, kind: z.enum(['local', 'keys']), pickupAreas: areas }).strict();
export const tripCommandSchema = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('household.create'), profile: tripProfileSchema }).strict(),
  z.object({ ...base, type: z.literal('household.update'), profile: tripProfileSchema }).strict(),
  z.object({ ...base, type: z.literal('child.save'), childId: id.optional(), child: tripChildSchema }).strict(),
  z.object({ ...base, type: z.literal('availability.save'), requestId: id.optional(), childId: id, selection: z.enum(['all', 'any']), options: z.array(option).min(1).max(30), note }).strict(),
  z.object({ ...base, type: z.literal('availability.withdraw'), requestId: id }).strict(),
  z.object({ ...base, type: z.literal('seasonal.save'), season: z.enum(['summer', 'pesach']), year: z.number().int().min(2026).max(2100), childIds, periods: z.array(z.enum(['before', 'during', 'after', 'dates_unsure'])).min(1).max(4), possibleWeeks: z.array(date).max(20).default([]), pickupAreas: areas, note }).strict(),
  z.object({ ...base, type: z.literal('seasonal.withdraw'), season: z.enum(['summer', 'pesach']), year: z.number().int().min(2026).max(2100) }).strict(),
  z.object({ ...base, type: z.literal('prices.update'), local: z.object({ firstMinor: money, siblingMinor: money }).strict(), keys: z.object({ firstMinor: money, siblingMinor: money }).strict() }).strict(),
  z.object({ ...base, type: z.literal('departure.save'), departureId: id.optional(), departure: tripDepartureSchema }).strict(),
  z.object({ ...base, type: z.literal('departure.confirm'), departureId: id }).strict(),
  z.object({...base,type:z.literal('waitlist.save'),departureId:id,householdId:id,childId:id,status:z.enum(['waiting','withdrawn']),note}).strict(),
  z.object({ ...base, type: z.literal('departure.attendance'), departureId: id, childId: z.union([id, z.literal('organizer-son')]), present: z.boolean() }).strict(),
  z.object({ ...base, type: z.literal('offer.prepare'), departureId: id, householdId: id, childIds, ownerNote: note, requestBindings: z.array(z.object({ childId: id, requestId: id }).strict()).max(15).default([]) }).strict(),
  z.object({ ...base, type: z.literal('delivery.record_sent'), offerId: id, sentAt: instant, shortNoticeDeadline: instant.optional() }).strict(),
  z.object({ ...base, type: z.literal('delivery.record_unknown'), offerId: id }).strict(),
  z.object({ ...base, type: z.literal('offer.accept'), offerId: id, quoteId: id, acceptedDate: date, pickupHubId: label }).strict(),
  z.object({ ...base, type: z.literal('offer.apply_credit'), offerId: id, amountMinor: money }).strict(),
  z.object({ ...base, type: z.literal('invoice.attach'), offerId: id, invoiceId: key, url: z.url(), amountMinor: money,customerId:z.string().regex(/^cus_[A-Za-z0-9]+$/),customerEmailBlind:z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  z.object({ ...base, type: z.literal('invoice.reconcile_closed'), offerId: id, invoiceId: key, status: z.enum(['paid', 'void', 'uncollectible']), allPaymentsReconciled: z.literal(true) }).strict(),
  z.object({ ...base, type: z.literal('payment.record_verified'), offerId: id, paymentKey: key, providerEventId: key, amountMinor: money, receivedAt: instant, invoiceId: key }).strict(),
  z.object({ ...base, type: z.literal('payment.link_cash_out_of_band'), offerId: id, cashReceiptId: id, providerEventId: key, invoiceId: key, amountMinor: money }).strict(),
  z.object({ ...base, type: z.literal('payment.record_unknown'), offerId: id }).strict(),
  z.object({ ...base, type: z.literal('payment.resolve_unknown'), offerId:id,note:z.string().trim().min(1).max(2000),noAdditionalPayment:z.literal(true) }).strict(),
  z.object({ ...base, type: z.literal('receipt.resolve_credit'), receiptId:id,amountMinor:money,note:z.string().trim().min(1).max(2000) }).strict(),
  z.object({ ...base, type: z.literal('cash.record_received'), offerId: id, receiptReference: key, amountMinor: money }).strict(),
  z.object({ ...base, type: z.literal('booking.cancel'), offerId: id, childIds, reason: z.enum(['parent', 'owner']).default('parent') }).strict(),
  z.object({ ...base, type: z.literal('booking.resolve_exception'), offerId: id, childIds, grantCredit: z.boolean(), note: z.string().trim().min(1).max(2000) }).strict(),
  z.object({ ...base, type: z.literal('offer.expire'), offerId: id }).strict(),
]);
export type TripCommand = z.infer<typeof tripCommandSchema>;
export const TripCommandSchema = tripCommandSchema;
export const internalTripCommandTypes = ['delivery.record_sent', 'delivery.record_unknown', 'invoice.reconcile_closed', 'payment.record_verified', 'payment.link_cash_out_of_band', 'payment.record_unknown'] as const;
export const parentTripCommandTypes = ['household.create', 'household.update', 'child.save', 'availability.save', 'availability.withdraw', 'seasonal.save', 'seasonal.withdraw', 'offer.accept', 'offer.apply_credit', 'booking.cancel'] as const;
export const ownerTripCommandTypes = ['prices.update', 'departure.save', 'departure.confirm', 'departure.attendance', 'offer.prepare', 'invoice.attach', 'cash.record_received', 'booking.cancel', 'booking.resolve_exception', 'offer.expire','receipt.resolve_credit','payment.resolve_unknown','waitlist.save'] as const;
export function isInternalTripCommand(command: TripCommand): boolean { return (internalTripCommandTypes as readonly string[]).includes(command.type); }
