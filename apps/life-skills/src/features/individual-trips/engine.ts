import { AppError } from '../../lib/errors.ts';
import { TRIP_TIME_ZONE, TRIP_VERSION, tripCommandSchema, parentTripCommandTypes, ownerTripCommandTypes, internalTripCommandTypes } from './contract.ts';
import type { TripActor, TripAllocation, TripCommand, TripCommandContext, TripDeparture, TripHousehold, TripOffer, TripQuoteChild, TripReply, TripState } from './contract.ts';
export type { TripState, TripActor, TripCommand } from './contract.ts';

export function initialTripState(): TripState {
  return { version: TRIP_VERSION, revision: 0, priceVersion: 1, prices: { local: { firstMinor: 15000, siblingMinor: 10000 }, keys: { firstMinor: 30000, siblingMinor: 25000 } }, households: [], departures: [], offers: [], receipts: [], allocations: [], creditLedger: [],waitlist:[] };
}
const fail = (code: 'INVALID_REQUEST' | 'NOT_FOUND' | 'CONFLICT' | 'FORBIDDEN' = 'CONFLICT'): never => { throw new AppError(code); };
const ensure = (condition: unknown, code: 'INVALID_REQUEST' | 'NOT_FOUND' | 'CONFLICT' | 'FORBIDDEN' = 'CONFLICT'): void => { if (!condition) fail(code); };
const ms = (value: string) => new Date(value).getTime();
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const activeChild = (child: TripQuoteChild) => child.status !== 'cancelled';
const overlaps = (a: { departureAt: string; returnAt: string }, b: { departureAt: string; returnAt: string }) => ms(a.departureAt) < ms(b.returnAt) && ms(b.departureAt) < ms(a.returnAt);
function nyDate(value: string | Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TRIP_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value));
  return ['year', 'month', 'day'].map(kind => parts.find(part => part.type === kind)!.value).join('-');
}
function validDate(date: string): boolean { const parsed = new Date(`${date}T12:00:00Z`); return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date; }
function sunday(date: string): boolean { return validDate(date) && new Date(`${date}T12:00:00Z`).getUTCDay() === 0; }
function household(state: TripState, id: string): TripHousehold { return state.households.find(row => row.id === id) ?? fail('NOT_FOUND'); }
function departure(state: TripState, id: string): TripDeparture { return state.departures.find(row => row.id === id) ?? fail('NOT_FOUND'); }
function ownHousehold(state: TripState, actor: TripActor): TripHousehold {
  const row = state.households.find(item => item.id === actor.householdId && item.ownerAccountId === actor.accountId);
  return row ?? fail('NOT_FOUND');
}
function offerFor(state: TripState, actor: TripActor, id: string): TripOffer {
  const offer = state.offers.find(row => row.id === id);
  if (!offer || actor.role === 'parent' && offer.householdId !== ownHousehold(state, actor).id) fail('NOT_FOUND');
  return offer!;
}
function offerAllocations(state: TripState, offer: TripOffer, child?: TripQuoteChild): TripAllocation[] { return state.allocations.filter(row => row.offerId === offer.id && (!child || row.childId === child.childId)); }
function paidMinor(state: TripState, offer: TripOffer, child?: TripQuoteChild): number { return sum(offerAllocations(state, offer, child).map(row => row.amountMinor)); }
function dueMinor(state: TripState, offer: TripOffer): number { return sum(offer.children.filter(activeChild).map(child => Math.max(0, child.amountMinor - paidMinor(state, offer, child)))); }
export function householdCreditMinor(state: TripState, householdId: string): number { return sum(state.creditLedger.filter(row => row.householdId === householdId).map(row => row.amountMinor)); }
function nonpayingIds(item: TripDeparture): string[] { return [...(item.sonAttending ? ['organizer-son'] : []), ...item.otherNonpayingChildren.map(row => row.id)]; }

export function departureCapacity(state: TripState, itemOrId: TripDeparture | string) {
  const item = typeof itemOrId === 'string' ? departure(state, itemOrId) : itemOrId;
  const nonpayingChildren = nonpayingIds(item).length;
  const transportChildCapacity = item.transport.verified ? Math.max(0, item.transport.totalSeats - item.transport.driverAdults - item.transport.otherAdults) : 0;
  const maximumChildren = Math.max(0, Math.min(item.desiredChildLimit, item.activityChildLimit, transportChildCapacity));
  const maximumPayingChildren = Math.max(0, maximumChildren - nonpayingChildren);
  const relevant = state.offers.filter(row => row.departureId === item.id);
  const occupiedPayingChildren = sum(relevant.map(row => row.children.filter(activeChild).length));
  const paidChildren = sum(relevant.map(row => row.children.filter(child => child.status === 'confirmed' && paidMinor(state, row, child) >= child.amountMinor && row.acceptedAt !== null).length));
  return { desiredChildLimit: item.desiredChildLimit, activityChildLimit: item.activityChildLimit, nonpayingChildren, transportChildCapacity, maximumChildren, maximumPayingChildren, occupiedPayingChildren, heldPayingChildren: occupiedPayingChildren - paidChildren, paidChildren, availablePayingChildren: Math.max(0, maximumPayingChildren - occupiedPayingChildren), minimumPaid: item.minimumPaid, minimumFeasible: item.minimumPaid <= maximumPayingChildren };
}

/** Demand counts unique child identities; an any-of group never becomes N boys. */
export function tripDemand(state: TripState) {
  const unique = new Set<string>(), byOption = new Map<string, { date: string; kind: 'local' | 'keys'; childIds: Set<string>; allChildIds: Set<string>; anyChildIds: Set<string> }>();
  for (const family of state.households) for (const request of family.availability.filter(row => row.status === 'interested')) {
    const accepted = state.offers.filter(offer => offer.householdId === family.id && offer.acceptedAt && offer.children.some(child => child.childId === request.childId && activeChild(child) && child.requestGroupIds.includes(request.id)));
    if (request.selection === 'any' && accepted.length) continue;
    const options = request.options.filter(option => !accepted.some(offer => offer.snapshot.date === option.date && offer.snapshot.kind === option.kind));
    if (options.length) unique.add(request.childId);
    for (const option of options) {
      const key = `${option.date}:${option.kind}`, row = byOption.get(key) ?? { date: option.date, kind: option.kind, childIds: new Set<string>(), allChildIds: new Set<string>(), anyChildIds: new Set<string>() };
      row.childIds.add(request.childId); (request.selection === 'all' ? row.allChildIds : row.anyChildIds).add(request.childId); byOption.set(key, row);
    }
  }
  return { uniqueChildren: unique.size, byDate: [...byOption.values()].map(row => ({ date: row.date, kind: row.kind, children: row.childIds.size, allChildren: row.allChildIds.size, anyChildren: row.anyChildIds.size })).sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind)) };
}

/** A projection is not authorization; native store rechecks live membership first. */
export function projectTripState(state: TripState, actor: TripActor): TripState {
  const result = structuredClone(state);
  if (actor.role === 'owner') return result;
  const family = ownHousehold(result, actor), childIds = new Set(family.children.map(row => row.id));
  result.revision = family.revision;
  result.households = [family]; result.offers = result.offers.filter(row => row.householdId === family.id).map(row => ({ ...row, ownerNote: '', exceptions: [] }));
  const departures = new Set(result.offers.map(row => row.departureId));
  result.departures = result.departures.filter(row => departures.has(row.id)).map(row => ({ ...row, attendance: row.attendance.filter(item => childIds.has(item.childId)), ownerResourceId: '', transport: { ...row.transport, vehicleId: '' }, otherNonpayingChildren: [] }));
  result.receipts = result.receipts.filter(row => row.householdId === family.id).map(row=>({...row,...(row.creditResolutions?{creditResolutions:row.creditResolutions.map(resolution=>({...resolution,note:'',ownerAccountId:''}))}:{})})); result.allocations = result.allocations.filter(row => row.householdId === family.id); result.creditLedger = result.creditLedger.filter(row => row.householdId === family.id);
  result.waitlist=result.waitlist.filter(row=>row.householdId===family.id).map(row=>({...row,note:''}));
  return result;
}

function checkDeparture(state: TripState, item: TripDeparture, oldId?: string): void {
  const start = ms(item.departureAt), end = ms(item.returnAt), fishingStart = ms(item.fishingStartAt), fishingEnd = ms(item.fishingEndAt);
  ensure([start, end, fishingStart, fishingEnd].every(Number.isFinite) && start <= fishingStart && fishingStart < fishingEnd && fishingEnd <= end, 'INVALID_REQUEST');
  ensure(sunday(nyDate(item.departureAt)), 'INVALID_REQUEST');
  ensure(item.kind !== 'local' || item.activityChildLimit <= 10 && item.desiredChildLimit <= 10, 'INVALID_REQUEST');
  ensure(item.kind !== 'keys' || item.desiredChildLimit <= 15, 'INVALID_REQUEST');
  ensure(new Set(item.otherNonpayingChildren.map(row => row.id)).size === item.otherNonpayingChildren.length, 'INVALID_REQUEST');
  const plannedPayable = Math.min(item.desiredChildLimit, item.activityChildLimit) - nonpayingIds(item).length;
  ensure(item.minimumPaid <= plannedPayable, 'INVALID_REQUEST');
  if (item.transport.verified) {
    ensure(item.transport.driverAdults >= 1 && item.transport.totalSeats > item.transport.driverAdults + item.transport.otherAdults, 'INVALID_REQUEST');
    ensure(departureCapacity(state, item).minimumFeasible, 'INVALID_REQUEST');
  }
  for (const other of state.departures.filter(row => row.id !== oldId && row.status !== 'cancelled')) if (overlaps(item, other)) {
    ensure(item.ownerResourceId !== other.ownerResourceId && item.transport.vehicleId !== other.transport.vehicleId);
    ensure(!nonpayingIds(item).some(id => nonpayingIds(other).includes(id)));
  }
}
function offerable(state: TripState, item: TripDeparture, now: Date): void {
  ensure(item.status === 'draft' || item.status === 'confirmed');
  ensure(ms(item.departureAt) > now.getTime() && item.operationalReady && item.pickupHub.permissionConfirmed && item.transport.verified && item.transport.driverAdults >= 1);
  ensure(departureCapacity(state, item).minimumFeasible);
}
function blockedPaymentRoute(offer: TripOffer): boolean { return offer.paymentUnknown || offer.invoice !== null && (!['paid', 'void'].includes(offer.invoice.status) || !offer.invoice.allPaymentsReconciled); }
function refreshOffer(state: TripState, offer: TripOffer): void {
  for (const child of offer.children) {
    if (child.status === 'cancelled' || child.cancellationReceivedAt || child.status === 'reconciliation_required') continue;
    child.status = offer.acceptedAt && paidMinor(state, offer, child) >= child.amountMinor ? 'confirmed' : 'held';
  }
  if (offer.paymentUnknown || state.receipts.some(row => row.offerId === offer.id && row.unappliedMinor > 0)) offer.status = 'reconciliation_required';
  else if (offer.children.every(row => row.status === 'cancelled')) offer.status = offer.expirationRequestedAt ? 'expired' : 'cancelled';
  else if (offer.children.some(row => row.status === 'reconciliation_required')) offer.status = 'reconciliation_required';
  else if (offer.children.filter(activeChild).every(row => row.status === 'confirmed')) offer.status = 'confirmed';
  else if (paidMinor(state, offer) > 0) offer.status = 'partially_paid';
  else if (offer.acceptedAt) offer.status = 'accepted';
  else offer.status = offer.deliveryState === 'sent' ? 'offered' : offer.deliveryState === 'unknown' ? 'reconciliation_required' : 'pending_delivery';
}
function restoreCredit(state: TripState, offer: TripOffer, child: TripQuoteChild, context: TripCommandContext): number {
  const allocations = offerAllocations(state, offer, child).filter(row => !row.restoredAt);
  const amount = sum(allocations.map(row => row.amountMinor));
  if (amount === 0) return 0;
  const at = context.now.toISOString();
  for (const allocation of allocations) allocation.restoredAt = at;
  state.creditLedger.push({ id: context.newId(), householdId: offer.householdId, amountMinor: amount, kind: 'cancellation_credit', offerId: offer.id, childId: child.childId, allocationIds: allocations.map(row => row.id), at });
  child.creditRestoredMinor += amount;
  return amount;
}
function finalizeCancellation(state: TripState, offer: TripOffer, child: TripQuoteChild, context: TripCommandContext, discretionaryCredit?: boolean): void {
  if (child.cancellationFinalizedAt && discretionaryCredit === undefined) return;
  ensure(!blockedPaymentRoute(offer));
  ensure(!state.receipts.some(row => row.offerId === offer.id && row.unappliedMinor > 0));
  const received = child.cancellationReceivedAt ?? context.now.toISOString();
  const timely = child.cancellationReason === 'parent' && ms(offer.snapshot.departureAt) - ms(received) >= 24 * 3600_000;
  if (discretionaryCredit === true || discretionaryCredit === undefined && timely) restoreCredit(state, offer, child, context);
  child.status = 'cancelled'; child.cancellationFinalizedAt ??= context.now.toISOString();
}
function finalizePending(state: TripState, offer: TripOffer, context: TripCommandContext): void {
  if (blockedPaymentRoute(offer) || state.receipts.some(row => row.offerId === offer.id && row.unappliedMinor > 0)) return;
  for (const child of offer.children.filter(row => row.cancellationReceivedAt && !row.cancellationFinalizedAt)) {
    if (child.cancellationReason === 'parent') finalizeCancellation(state, offer, child, context);
  }
  if (offer.expirationRequestedAt) for (const child of offer.children.filter(activeChild)) {
    if (child.status === 'confirmed') continue;
    if (paidMinor(state, offer, child) > 0) { child.status = 'reconciliation_required'; continue; }
    child.status = 'cancelled'; child.cancellationFinalizedAt = context.now.toISOString();
  }
  refreshOffer(state, offer);
}
function addAllocation(state: TripState, offer: TripOffer, amount: number, source: 'receipt' | 'credit', sourceId: string, context: TripCommandContext, receivedAt?:string): number {
  let remainder = amount;
  for (const child of offer.children) {
    if (!activeChild(child) || child.cancellationReceivedAt && (!receivedAt || child.cancellationFinalizedAt || ms(receivedAt)>ms(child.cancellationReceivedAt))) continue;
    const allocated = Math.min(remainder, Math.max(0, child.amountMinor - paidMinor(state, offer, child)));
    if (allocated > 0) state.allocations.push({ id: context.newId(), householdId: offer.householdId, offerId: offer.id, childId: child.childId, amountMinor: allocated, source, sourceId, restoredAt: null });
    remainder -= allocated;
  }
  return remainder;
}
function recordReceipt(state: TripState, offer: TripOffer, input: { source: 'cash' | 'stripe'; paymentKey: string; providerEventId?: string; amountMinor: number; receivedAt: string }, context: TripCommandContext): { receiptId: string; replayed: boolean } {
  const existing = state.receipts.find(row => row.paymentKey === input.paymentKey || input.providerEventId && row.providerEvents.includes(input.providerEventId));
  if (existing) {
    ensure(existing.paymentKey === input.paymentKey && existing.offerId === offer.id && existing.amountMinor === input.amountMinor);
    return { receiptId: existing.id, replayed: true };
  }
  ensure(ms(input.receivedAt) <= context.now.getTime(), 'INVALID_REQUEST');
  // Stripe paid_at is second precision. A payment on an invoice attached only
  // after acceptance cannot predate delivery merely because its timestamp was
  // rounded down within that same second. Deadlines/cancellation stay exact.
  const sentLowerBound=offer.sentAt?(input.source==='stripe'?Math.floor(ms(offer.sentAt)/1000)*1000:ms(offer.sentAt)):Infinity;
  const late = !offer.sentAt || !offer.paymentDeadline || ms(input.receivedAt) < sentLowerBound || ms(input.receivedAt) > ms(offer.paymentDeadline) || offer.expirationRequestedAt && ms(input.receivedAt)>ms(offer.expirationRequestedAt) || offer.children.every(row => !activeChild(row));
  const id = context.newId(), remainder = late || offer.paymentUnknown ? input.amountMinor : addAllocation(state, offer, input.amountMinor, 'receipt', id, context,input.receivedAt);
  state.receipts.push({ id, householdId: offer.householdId, offerId: offer.id, source: input.source, paymentKey: input.paymentKey, amountMinor: input.amountMinor, unappliedMinor: remainder, receivedAt: input.receivedAt, providerEvents: input.providerEventId ? [input.providerEventId] : [], resolution: remainder > 0 ? 'reconciliation_required' : 'allocated' });
  if (remainder > 0) offer.status = 'reconciliation_required';
  refreshOffer(state, offer);
  return { receiptId: id, replayed: false };
}

/** Native caller locks/rechecks workspace, actor/session/membership and operation
 * replay first. This pure reducer adds domain revisions and atomic failure. */
export function applyTripCommand(initial: TripState, actor: TripActor, input: TripCommand, context: TripCommandContext): { state: TripState; reply: TripReply } {
  const parsed = tripCommandSchema.safeParse(input);
  if (!parsed.success) throw new AppError('INVALID_REQUEST');
  if (initial.version !== TRIP_VERSION || !uuid.test(actor.accountId) || !['parent', 'owner'].includes(actor.role) || !Number.isFinite(context.now.getTime())) fail('INVALID_REQUEST');
  const command = parsed.data, state = structuredClone(initial), now = context.now.toISOString();
  const parent = actor.role === 'parent' && command.type !== 'household.create' ? ownHousehold(state, actor) : undefined;
  if (actor.role === 'parent' && !(parentTripCommandTypes as readonly string[]).includes(command.type)) fail('FORBIDDEN');
  if (actor.role === 'owner' && !([...ownerTripCommandTypes, ...internalTripCommandTypes] as readonly string[]).includes(command.type)) fail('FORBIDDEN');
  ensure(command.expectedRevision === (actor.role === 'owner' ? state.revision : parent?.revision ?? 0));
  const touched = new Set<string>();
  let reply: Omit<TripReply, 'revision'> = { status: 'saved' };
  const nextId = () => { const id = context.newId(); ensure(uuid.test(id), 'INVALID_REQUEST'); return id; };
  const ctx = { ...context, newId: nextId };
  const targetOffer = () => { const row = offerFor(state, actor, 'offerId' in command ? command.offerId : ''); touched.add(row.householdId); return row; };
  if (command.type === 'household.create') {
    ensure(actor.role === 'parent', 'FORBIDDEN'); ensure(!state.households.some(row => row.ownerAccountId === actor.accountId)); ensure(command.profile.contactConsent, 'INVALID_REQUEST');
    ensure(actor.householdId === undefined); const id = nextId(); ensure(!state.households.some(row => row.id === id));
    state.households.push({ id, ownerAccountId: actor.accountId, revision: 0, profile: command.profile, children: [], availability: [], seasonal: [], createdAt: now }); touched.add(id); reply = { id, householdId: id, status: 'saved' };
  } else if (command.type === 'household.update') { parent!.profile = command.profile; touched.add(parent!.id); reply.householdId = parent!.id;
  } else if (command.type === 'child.save') {
    const family = parent ?? fail('FORBIDDEN');
    const existing = command.childId ? family.children.find(row => row.id === command.childId) ?? fail('NOT_FOUND') : undefined;
    ensure(existing || family.children.length < 15);
    if (existing) {
      const oldMedia = existing.mediaUse; Object.assign(existing, command.child);
      if (oldMedia !== existing.mediaUse) ensure(!state.offers.some(row => row.householdId === family.id && row.children.some(child => child.childId === existing.id && activeChild(child))));
    } else family.children.push({ id: nextId(), ...command.child });
    touched.add(family.id); reply.id = existing?.id ?? family.children.at(-1)!.id;
  } else if (command.type === 'availability.save') {
    const family = parent ?? fail('FORBIDDEN'); ensure(family.children.some(row => row.id === command.childId), 'NOT_FOUND');
    ensure(command.options.every(row => sunday(row.date)), 'INVALID_REQUEST');
    ensure(new Set(command.options.map(row => `${row.date}:${row.kind}`)).size === command.options.length, 'INVALID_REQUEST');
    const existing = command.requestId ? family.availability.find(row => row.id === command.requestId) ?? fail('NOT_FOUND') : undefined;
    if (existing) ensure(existing.childId === command.childId, 'INVALID_REQUEST');
    const history = existing?.history ?? [];
    if (existing) history.push({ selection: existing.selection, options: existing.options, note: existing.note, status: existing.status, replacedAt: now });
    const value = { id: existing?.id ?? nextId(), childId: command.childId, selection: command.selection, options: command.options, note: command.note, status: 'interested' as const, createdAt: existing?.createdAt ?? now, history };
    if (existing) Object.assign(existing, value); else family.availability.push(value);
    touched.add(family.id); reply.id = value.id;
  } else if (command.type === 'availability.withdraw') {
    const family = parent ?? fail('FORBIDDEN'), request = family.availability.find(row => row.id === command.requestId) ?? fail('NOT_FOUND');
    if (request.status !== 'withdrawn') request.history.push({ selection: request.selection, options: request.options, note: request.note, status: request.status, replacedAt: now });
    request.status = 'withdrawn'; touched.add(family.id); reply.id = request.id;
  } else if (command.type === 'seasonal.save') {
    const family = parent ?? fail('FORBIDDEN'); ensure(command.childIds.every(id => family.children.some(row => row.id === id)), 'NOT_FOUND');
    ensure(new Set(command.periods).size === command.periods.length && command.possibleWeeks.every(value => validDate(value) && Number(value.slice(0, 4)) === command.year), 'INVALID_REQUEST');
    const existing = family.seasonal.find(row => row.season === command.season && row.year === command.year);
    const value = { id: existing?.id ?? nextId(), season: command.season, year: command.year, childIds: command.childIds, periods: command.periods, possibleWeeks: command.possibleWeeks, pickupAreas: command.pickupAreas, note: command.note, status: 'interested' as const };
    if (existing) Object.assign(existing, value); else family.seasonal.push(value);
    touched.add(family.id); reply.id = value.id;
  } else if (command.type === 'seasonal.withdraw') {
    const family = parent ?? fail('FORBIDDEN'), interest = family.seasonal.find(row => row.season === command.season && row.year === command.year) ?? fail('NOT_FOUND'); interest.status = 'withdrawn'; touched.add(family.id); reply.id = interest.id;
  } else if (command.type === 'prices.update') {
    ensure(command.local.siblingMinor <= command.local.firstMinor && command.keys.siblingMinor <= command.keys.firstMinor, 'INVALID_REQUEST');
    state.prices = { local: command.local, keys: command.keys }; state.priceVersion++;
  } else if (command.type === 'departure.save') {
    const old = command.departureId ? departure(state, command.departureId) : undefined;
    if (old) ensure(old.status === 'draft' && !state.offers.some(row => row.departureId === old.id && row.children.some(activeChild)));
    const value: TripDeparture = { ...command.departure, id: old?.id ?? nextId(), timeZone: TRIP_TIME_ZONE, status: 'draft', revision: (old?.revision ?? 0) + 1, attendance: old?.attendance ?? [] };
    checkDeparture(state, value, old?.id);
    if (old) Object.assign(old, value); else state.departures.push(value); reply.id = value.id;
  } else if (command.type === 'departure.confirm') {
    const item = departure(state, command.departureId); offerable(state, item, context.now); const capacity = departureCapacity(state, item);
    ensure(capacity.paidChildren >= item.minimumPaid && capacity.occupiedPayingChildren <= capacity.maximumPayingChildren); item.status = 'confirmed'; item.revision++; reply.id = item.id;
  } else if (command.type === 'departure.attendance') {
    const item = departure(state, command.departureId);
    ensure(nonpayingIds(item).includes(command.childId) || state.offers.some(row => row.departureId === item.id && row.children.some(child => child.childId === command.childId && child.status === 'confirmed')), 'NOT_FOUND');
    const old = item.attendance.find(row => row.childId === command.childId); const value = { childId: command.childId, present: command.present, recordedAt: now };
    if (old) Object.assign(old, value); else item.attendance.push(value); item.revision++; reply.id = item.id;
  } else if (command.type === 'offer.prepare') {
    const item = departure(state, command.departureId), family = household(state, command.householdId); offerable(state, item, context.now);
    const children = command.childIds.map(id => family.children.find(row => row.id === id) ?? fail('NOT_FOUND'));
    ensure(children.every(child => !nonpayingIds(item).includes(child.id)));
    ensure(new Set(command.requestBindings.map(row => row.childId)).size === command.requestBindings.length && command.requestBindings.every(binding => children.some(child => child.id === binding.childId)), 'INVALID_REQUEST');
    const requestGroups = new Map(children.map(child => {
      const binding = command.requestBindings.find(row => row.childId === child.id);
      const requests = family.availability.filter(row => row.childId === child.id && row.status === 'interested' && (binding ? row.id === binding.requestId : row.options.some(option => option.date === nyDate(item.departureAt) && option.kind === item.kind)));
      if (binding) ensure(requests.length === 1, 'NOT_FOUND');
      return [child.id, requests.map(row => row.id)];
    }));
    ensure(children.every(child => child.mediaUse === (item.mediaGroup === 'yes')));
    ensure(departureCapacity(state, item).availablePayingChildren >= children.length);
    for (const child of children) for (const previous of state.offers) if (previous.children.some(row => row.childId === child.id && activeChild(row))) ensure(!overlaps(item, previous.snapshot));
    const existingSiblings = sum(state.offers.filter(row => row.departureId === item.id && row.householdId === family.id).map(row => row.children.filter(activeChild).length));
    const price = state.prices[item.kind], id = nextId();
    const offer: TripOffer = {
      id, quoteId: nextId(), householdId: family.id, departureId: item.id, priceVersion: state.priceVersion,
      snapshot: { kind: item.kind, date: nyDate(item.departureAt), pickupHubId: item.pickupHub.id, pickupHubLabel: item.pickupHub.label, departureAt: item.departureAt, returnAt: item.returnAt, fishingStartAt: item.fishingStartAt, fishingEndAt: item.fishingEndAt, equipment: item.equipment, water: item.water, mediaGroup: item.mediaGroup, termsVersion: TRIP_VERSION },
      children: children.map((child, index) => ({ childId: child.id, childName: child.name, requestGroupIds: requestGroups.get(child.id)!, requestGroupSelections: requestGroups.get(child.id)!.map(id => ({ id, selection: family.availability.find(row => row.id === id)!.selection })), amountMinor: existingSiblings + index === 0 ? price.firstMinor : price.siblingMinor, status: 'held', cancellationReceivedAt: null, cancellationReason: null, cancellationFinalizedAt: null, creditRestoredMinor: 0 })),
      deliveryState: 'pending_delivery', preparedAt: now, sentAt: null, paymentDeadline: null, acceptedAt: null, status: 'pending_delivery', invoice: null, paymentUnknown: false, expirationRequestedAt: null, ownerNote: command.ownerNote, exceptions: [],
    };
    state.offers.push(offer); touched.add(family.id); reply = { id, offerId: id, status: offer.status };
  } else if (command.type === 'delivery.record_sent') {
    const offer = targetOffer(); ensure(offer.deliveryState === 'pending_delivery' || offer.deliveryState === 'unknown');
    ensure(offer.children.some(activeChild) && !offer.children.some(row => row.cancellationReceivedAt));
    const sentAt = ms(command.sentAt), departureAt = ms(offer.snapshot.departureAt);
    ensure(sentAt >= ms(offer.preparedAt) && sentAt <= context.now.getTime() && sentAt < departureAt, 'INVALID_REQUEST');
    const deadline = command.shortNoticeDeadline ? ms(command.shortNoticeDeadline) : sentAt + 48 * 3600_000;
    ensure(deadline > context.now.getTime() && deadline > sentAt && deadline <= departureAt && deadline <= sentAt + 48 * 3600_000, 'INVALID_REQUEST');
    offer.deliveryState = 'sent'; offer.sentAt = new Date(sentAt).toISOString(); offer.paymentDeadline = new Date(deadline).toISOString(); refreshOffer(state, offer); reply = { offerId: offer.id, status: offer.status };
  } else if (command.type === 'delivery.record_unknown') { const offer = targetOffer(); ensure(offer.deliveryState !== 'sent'); offer.deliveryState = 'unknown'; offer.status = 'reconciliation_required'; reply = { offerId: offer.id, status: offer.status };
  } else if (command.type === 'offer.accept') {
    const offer = targetOffer(); ensure(actor.role === 'parent', 'FORBIDDEN');
    ensure(offer.deliveryState === 'sent' && offer.paymentDeadline && context.now.getTime() <= ms(offer.paymentDeadline) && !offer.expirationRequestedAt && !offer.children.some(row => row.cancellationReceivedAt));
    ensure(command.quoteId === offer.quoteId && command.acceptedDate === offer.snapshot.date && command.pickupHubId === offer.snapshot.pickupHubId, 'INVALID_REQUEST');
    for (const child of offer.children) for (const requestId of child.requestGroupIds) {
      ensure(!state.offers.some(other => other.id !== offer.id && other.householdId === offer.householdId && other.acceptedAt && other.children.some(item => item.childId === child.childId && activeChild(item) && item.requestGroupIds.includes(requestId) && (child.requestGroupSelections.some(row => row.id === requestId && row.selection === 'any') || item.requestGroupSelections.some(row => row.id === requestId && row.selection === 'any') || other.snapshot.date === offer.snapshot.date && other.snapshot.kind === offer.snapshot.kind))));
    }
    offer.acceptedAt ??= now; refreshOffer(state, offer); reply = { offerId: offer.id, status: offer.status };
  } else if (command.type === 'offer.apply_credit') {
    const offer = targetOffer(); ensure(offer.acceptedAt && !blockedPaymentRoute(offer) && offer.paymentDeadline && context.now.getTime() <= ms(offer.paymentDeadline) && !offer.expirationRequestedAt);
    ensure(command.amountMinor <= householdCreditMinor(state, offer.householdId) && command.amountMinor <= dueMinor(state, offer));
    const ledgerId = nextId(), before = state.allocations.length; ensure(addAllocation(state, offer, command.amountMinor, 'credit', ledgerId, ctx) === 0);
    state.creditLedger.push({ id: ledgerId, householdId: offer.householdId, amountMinor: -command.amountMinor, kind: 'credit_spent', offerId: offer.id, childId: null, allocationIds: state.allocations.slice(before).map(row => row.id), at: now }); refreshOffer(state, offer); reply = { offerId: offer.id, status: offer.status, creditMinor: householdCreditMinor(state, offer.householdId) };
  } else if (command.type === 'invoice.attach') {
    const offer = targetOffer(); ensure(!offer.invoice && offer.acceptedAt && offer.deliveryState === 'sent' && offer.paymentDeadline && context.now.getTime() <= ms(offer.paymentDeadline) && !offer.expirationRequestedAt);
    const url = new URL(command.url); ensure(url.protocol === 'https:' && url.hostname === 'invoice.stripe.com' && !url.username && !url.password && !url.hash && !url.port, 'INVALID_REQUEST');
    ensure(command.amountMinor === dueMinor(state, offer) && !state.offers.some(row => row.invoice?.id === command.invoiceId));
    offer.invoice = { id: command.invoiceId, url: command.url, amountMinor: command.amountMinor, customerId:command.customerId,customerEmailBlind:command.customerEmailBlind,status: 'open', allPaymentsReconciled: false }; reply = { offerId: offer.id, status: offer.status };
  } else if (command.type === 'invoice.reconcile_closed') {
    const offer = targetOffer(); ensure(offer.invoice?.id === command.invoiceId, 'NOT_FOUND');
    if (command.status === 'paid') ensure(sum(state.receipts.filter(row => row.offerId === offer.id).map(row => row.amountMinor)) >= offer.invoice!.amountMinor);
    offer.invoice!.status = command.status; offer.invoice!.allPaymentsReconciled = true; offer.paymentUnknown = false; finalizePending(state, offer, ctx); refreshOffer(state, offer); reply = { offerId: offer.id, status: offer.status };
  } else if (command.type === 'payment.record_verified') {
    const offer = targetOffer(); ensure(offer.invoice?.id === command.invoiceId, 'NOT_FOUND');
    const result = recordReceipt(state, offer, { source: 'stripe', paymentKey: `stripe:${command.paymentKey}`, providerEventId: command.providerEventId, amountMinor: command.amountMinor, receivedAt: command.receivedAt }, ctx); reply = { ...result, offerId: offer.id, status: offer.status };
  } else if (command.type === 'cash.record_received') {
    const offer = targetOffer(); const result = recordReceipt(state, offer, { source: 'cash', paymentKey: `cash:${command.receiptReference}`, amountMinor: command.amountMinor, receivedAt: now }, ctx); reply = { ...result, offerId: offer.id, status: offer.status };
  } else if (command.type === 'payment.link_cash_out_of_band') {
    const offer = targetOffer(); ensure(offer.invoice?.id === command.invoiceId, 'NOT_FOUND');
    const receipt = state.receipts.find(row => row.id === command.cashReceiptId && row.offerId === offer.id && row.source === 'cash') ?? fail('NOT_FOUND');
    ensure(receipt.amountMinor === command.amountMinor);
    const duplicate = state.receipts.find(row => row.providerEvents.includes(command.providerEventId)); ensure(!duplicate || duplicate.id === receipt.id);
    const replayed = receipt.providerEvents.includes(command.providerEventId); if (!replayed) receipt.providerEvents.push(command.providerEventId);
    reply = { offerId: offer.id, receiptId: receipt.id, replayed, status: offer.status };
  } else if (command.type === 'payment.record_unknown') { const offer = targetOffer(); offer.paymentUnknown = true; if (offer.invoice) offer.invoice.status = 'unknown'; offer.status = 'reconciliation_required'; reply = { offerId: offer.id, status: offer.status };
  } else if(command.type==='waitlist.save'){
    departure(state,command.departureId);const family=household(state,command.householdId);ensure(family.children.some(child=>child.id===command.childId),'NOT_FOUND');
    ensure(!state.offers.some(offer=>offer.departureId===command.departureId&&offer.householdId===family.id&&offer.children.some(child=>child.childId===command.childId&&activeChild(child))));
    const existing=state.waitlist.find(row=>row.departureId===command.departureId&&row.householdId===family.id&&row.childId===command.childId);
    if(existing){existing.status=command.status;existing.note=command.note;existing.updatedAt=now;reply={id:existing.id,status:existing.status};}
    else{const id=nextId();state.waitlist.push({id,householdId:family.id,childId:command.childId,departureId:command.departureId,status:command.status,note:command.note,createdAt:now,updatedAt:now});reply={id,status:command.status};}
    touched.add(family.id);
  } else if(command.type==='payment.resolve_unknown'){
    const offer=targetOffer();ensure(!offer.invoice);offer.paymentUnknown=false;
    offer.exceptions.push({at:now,actorAccountId:actor.accountId,childIds:[],grantCredit:false,note:command.note});
    finalizePending(state,offer,ctx);refreshOffer(state,offer);reply={offerId:offer.id,status:offer.status};
  } else if(command.type==='receipt.resolve_credit'){
    const receipt=state.receipts.find(row=>row.id===command.receiptId)??fail('NOT_FOUND'),offer=offerFor(state,actor,receipt.offerId);
    ensure(!blockedPaymentRoute(offer)&&command.amountMinor<=receipt.unappliedMinor);
    const id=nextId();receipt.unappliedMinor-=command.amountMinor;receipt.resolution=receipt.unappliedMinor?'reconciliation_required':'allocated';
    (receipt.creditResolutions??=[]).push({id,amountMinor:command.amountMinor,ownerAccountId:actor.accountId,note:command.note,at:now});
    state.creditLedger.push({id,householdId:receipt.householdId,kind:'reconciliation_credit',amountMinor:command.amountMinor,offerId:offer.id,childId:null,allocationIds:[],receiptId:receipt.id,at:now});
    touched.add(receipt.householdId);finalizePending(state,offer,ctx);refreshOffer(state,offer);reply={offerId:offer.id,status:offer.status,creditMinor:householdCreditMinor(state,receipt.householdId)};
  } else if (command.type === 'booking.cancel') {
    const offer = targetOffer(); ensure(actor.role !== 'parent' || command.reason === 'parent', 'FORBIDDEN');
    for (const id of command.childIds) {
      const child = offer.children.find(row => row.childId === id) ?? fail('NOT_FOUND');
      if (child.status === 'cancelled') continue;
      child.cancellationReceivedAt ??= now; child.cancellationReason ??= command.reason;
      if (blockedPaymentRoute(offer) || state.receipts.some(row => row.offerId === offer.id && row.unappliedMinor > 0) || command.reason === 'owner') child.status = 'reconciliation_required';
      else finalizeCancellation(state, offer, child, ctx);
    }
    refreshOffer(state, offer); reply = { offerId: offer.id, status: offer.status, creditMinor: householdCreditMinor(state, offer.householdId) };
  } else if (command.type === 'booking.resolve_exception') {
    const offer = targetOffer();
    for (const id of command.childIds) { const child = offer.children.find(row => row.childId === id) ?? fail('NOT_FOUND'); ensure(child.cancellationReceivedAt || offer.expirationRequestedAt); finalizeCancellation(state, offer, child, ctx, command.grantCredit); }
    offer.exceptions.push({ at: now, actorAccountId: actor.accountId, childIds: command.childIds, grantCredit: command.grantCredit, note: command.note }); refreshOffer(state, offer); reply = { offerId: offer.id, status: offer.status, creditMinor: householdCreditMinor(state, offer.householdId) };
  } else if (command.type === 'offer.expire') {
    const offer = targetOffer(); ensure(offer.paymentDeadline && context.now.getTime() > ms(offer.paymentDeadline)); offer.expirationRequestedAt ??= now;
    if (blockedPaymentRoute(offer)) for (const child of offer.children.filter(row => row.status !== 'confirmed' && activeChild(row))) child.status = 'reconciliation_required';
    finalizePending(state, offer, ctx); refreshOffer(state, offer); reply = { offerId: offer.id, status: offer.status };
  } else fail('INVALID_REQUEST');
  if(command.type==='offer.prepare')for(const row of state.waitlist)if(row.departureId===command.departureId&&row.householdId===command.householdId&&command.childIds.includes(row.childId)&&row.status==='waiting'){row.status='offered';row.updatedAt=now;}
  for (const id of touched) household(state, id).revision++;
  state.revision++;
  const relevant = actor.role === 'parent' ? (parent ?? state.households.find(row => row.ownerAccountId === actor.accountId)) : undefined;
  ensure(state.creditLedger.every(row => Number.isSafeInteger(row.amountMinor)) && state.households.every(row => householdCreditMinor(state, row.id) >= 0));
  return { state, reply: { ...reply, revision: relevant?.revision ?? state.revision } };
}
