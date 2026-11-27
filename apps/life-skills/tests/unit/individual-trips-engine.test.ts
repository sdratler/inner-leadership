import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/lib/errors.ts';
import { TRIP_VERSION, isInternalTripCommand, tripCommandSchema } from '../../src/features/individual-trips/contract.ts';
import type { TripActor, TripCommand, TripDepartureInput, TripState } from '../../src/features/individual-trips/contract.ts';
import { applyTripCommand, departureCapacity, householdCreditMinor, initialTripState, projectTripState, tripDemand } from '../../src/features/individual-trips/engine.ts';

const profile = () => ({ guardianName: 'Synthetic Parent', phone: '+13055550123', pickupAreas: ['boca'], contactConsent: true, marketingConsent: false });
function departureInput(patch: Partial<TripDepartureInput> = {}): TripDepartureInput {
  return { kind: 'local', title: 'Synthetic Sunday outing', desiredChildLimit: 10, activityChildLimit: 10, sonAttending: true, otherNonpayingChildren: [], transport: { verified: true, totalSeats: 15, driverAdults: 1, otherAdults: 1, vehicleId: 'synthetic-van' }, ownerResourceId: 'synthetic-owner', minimumPaid: 1, operationalReady: true, pickupHub: { id: 'boca', label: 'Synthetic Boca hub', permissionConfirmed: true }, departureAt: '2026-12-06T15:00:00Z', returnAt: '2026-12-06T19:00:00Z', fishingStartAt: '2026-12-06T15:30:00Z', fishingEndAt: '2026-12-06T18:30:00Z', mediaGroup: 'no', equipment: 'Loaner rod, tackle and bait', water: 'Water per actual offer', ...patch };
}
class Harness {
  state = initialTripState(); now = new Date('2026-11-27T15:00:00Z'); owner: TripActor = { accountId: randomUUID(), role: 'owner' };
  run(actor: TripActor, value: Record<string, unknown>) {
    const expectedRevision = actor.role === 'owner' ? this.state.revision : this.state.households.find(row => row.id === actor.householdId)?.revision ?? 0;
    const result = applyTripCommand(this.state, actor, { operationId: randomUUID(), expectedRevision, ...value } as TripCommand, { now: this.now, newId: randomUUID });
    this.state = result.state; return result.reply;
  }
  family(count = 1, mediaUse = false) {
    const parent: TripActor = { accountId: randomUUID(), role: 'parent' };
    parent.householdId = this.run(parent, { type: 'household.create', profile: profile() }).householdId!;
    const children: string[] = [];
    for (let index = 0; index < count; index++) children.push(this.run(parent, { type: 'child.save', child: { name: `Synthetic child ${index + 1}`, age: 10, mediaUse, fishingExperience: 'Beginner', ownsRod: false } }).id!);
    return { parent, children };
  }
  departure(patch: Partial<TripDepartureInput> = {}) { return this.run(this.owner, { type: 'departure.save', departure: departureInput(patch) }).id!; }
  offer(departureId: string, family: ReturnType<Harness['family']>, children = family.children) { return this.run(this.owner, { type: 'offer.prepare', departureId, householdId: family.parent.householdId, childIds: children, ownerNote: 'Private owner note' }).offerId!; }
  sent(offerId: string, shortNoticeDeadline?: string) { return this.run(this.owner, { type: 'delivery.record_sent', offerId, sentAt: this.now.toISOString(), ...(shortNoticeDeadline ? { shortNoticeDeadline } : {}) }); }
  accept(offerId: string, parent: TripActor) { const offer = this.state.offers.find(row => row.id === offerId)!; return this.run(parent, { type: 'offer.accept', offerId, quoteId: offer.quoteId, acceptedDate: offer.snapshot.date, pickupHubId: offer.snapshot.pickupHubId }); }
  cash(offerId: string, amountMinor: number, receiptReference: string = randomUUID()) { return this.run(this.owner, { type: 'cash.record_received', offerId, amountMinor, receiptReference }); }
  invoice(offerId: string) { const invoiceId = `in_${randomUUID()}`; const offer = this.state.offers.find(row => row.id === offerId)!; this.run(this.owner, { type: 'invoice.attach', offerId, invoiceId, url: 'https://invoice.stripe.com/i/synthetic',customerId:'cus_synthetic',customerEmailBlind:'a'.repeat(64),amountMinor: offer.children.reduce((a, b) => a + b.amountMinor, 0) }); return invoiceId; }
}
function denied(work: () => unknown, code: AppError['code'] = 'CONFLICT') { expect(work).toThrowError(expect.objectContaining({ code })); }
function allocatedLive(state: TripState) { return state.allocations.filter(row => !row.restoredAt).reduce((total, row) => total + row.amountMinor, 0); }

describe('free household and independent seasonal interest', () => {
  it('keeps an explicit waiting list separate from held and paid capacity',()=>{
    const h=new Harness(),family=h.family(),dep=h.departure();
    const cmd={type:'waitlist.save',departureId:dep,householdId:family.parent.householdId,childId:family.children[0],status:'waiting',note:'Waiting for a suitable place'};
    h.run(h.owner,cmd);h.run(h.owner,cmd);expect(h.state.waitlist).toHaveLength(1);
    expect(departureCapacity(h.state,dep).occupiedPayingChildren).toBe(0);expect(h.state.receipts).toHaveLength(0);
    denied(()=>h.run(family.parent,cmd),'FORBIDDEN');
    h.offer(dep,family);expect(h.state.waitlist[0]!.status).toBe('offered');expect(departureCapacity(h.state,dep).occupiedPayingChildren).toBe(1);
  });
  it('lets only the owner resolve actual unapplied money to credit once without reclaiming a cancelled seat',()=>{
    const h=new Harness(),family=h.family(),offerId=h.offer(h.departure(),family);h.sent(offerId);h.accept(offerId,family.parent);
    h.cash(offerId,16000);h.run(family.parent,{type:'booking.cancel',offerId,childIds:family.children,reason:'parent'});
    const receipt=h.state.receipts[0]!;
    denied(()=>h.run(family.parent,{type:'receipt.resolve_credit',receiptId:receipt.id,amountMinor:1000,note:'not allowed'}),'FORBIDDEN');
    denied(()=>h.run(h.owner,{type:'receipt.resolve_credit',receiptId:receipt.id,amountMinor:1001,note:'over the actual remainder'}));
    h.run(h.owner,{type:'receipt.resolve_credit',receiptId:receipt.id,amountMinor:1000,note:'Owner verified actual overpayment and grants household credit'});
    expect(householdCreditMinor(h.state,family.parent.householdId!)).toBe(16000);
    expect(h.state.receipts[0]!.unappliedMinor).toBe(0);expect(h.state.offers[0]!.children[0]!.status).toBe('cancelled');
    denied(()=>h.run(h.owner,{type:'receipt.resolve_credit',receiptId:receipt.id,amountMinor:1000,note:'duplicate'}));
    expect(allocatedLive(h.state)+householdCreditMinor(h.state,family.parent.householdId!)).toBe(16000);
  });
  it('keeps uncollectible invoices fenced until the payable route is actually void or fully paid',()=>{
    const h=new Harness(),family=h.family(),offerId=h.offer(h.departure(),family);h.sent(offerId);h.accept(offerId,family.parent);const invoiceId=h.invoice(offerId);
    h.run(family.parent,{type:'booking.cancel',offerId,childIds:family.children,reason:'parent'});
    h.run(h.owner,{type:'invoice.reconcile_closed',offerId,invoiceId,status:'uncollectible',allPaymentsReconciled:true});
    expect(h.state.offers[0]!.children[0]!.status).toBe('reconciliation_required');
    expect(departureCapacity(h.state,h.state.departures[0]!).occupiedPayingChildren).toBe(1);
    h.run(h.owner,{type:'invoice.reconcile_closed',offerId,invoiceId,status:'void',allPaymentsReconciled:true});
    expect(h.state.offers[0]!.children[0]!.status).toBe('cancelled');
  });
  it('restores timely paid cancellation when provider verification arrives after the parent cancellation',()=>{
    const h=new Harness(),family=h.family(),offerId=h.offer(h.departure(),family);h.sent(offerId);h.accept(offerId,family.parent);const invoiceId=h.invoice(offerId),receivedAt=h.now.toISOString();
    h.now=new Date(h.now.getTime()+3600000);h.run(family.parent,{type:'booking.cancel',offerId,childIds:family.children,reason:'parent'});
    expect(h.state.offers[0]!.children[0]!.status).toBe('reconciliation_required');
    h.run(h.owner,{type:'payment.record_verified',offerId,invoiceId,paymentKey:'stripe:paid-before-cancel',providerEventId:'lookup:paid-before-cancel',amountMinor:15000,receivedAt});
    expect(h.state.receipts[0]!.unappliedMinor).toBe(0);
    h.run(h.owner,{type:'invoice.reconcile_closed',offerId,invoiceId,status:'paid',allPaymentsReconciled:true});
    expect(householdCreditMinor(h.state,family.parent.householdId!)).toBe(15000);expect(h.state.offers[0]!.children[0]!.status).toBe('cancelled');
    h.run(h.owner,{type:'invoice.reconcile_closed',offerId,invoiceId,status:'paid',allPaymentsReconciled:true});expect(householdCreditMinor(h.state,family.parent.householdId!)).toBe(15000);
  });
  it('creates only a free household and rejects ownership substitution and stale revisions', () => {
    const h = new Harness(), family = h.family(), other = h.family();
    expect(h.state.version).toBe(TRIP_VERSION); expect(h.state.offers).toEqual([]); expect(h.state.receipts).toEqual([]); expect(h.state.creditLedger).toEqual([]);
    const snapshot = structuredClone(h.state);
    denied(() => h.run({ ...family.parent, householdId: other.parent.householdId! }, { type: 'household.update', profile: profile() }), 'NOT_FOUND');
    denied(() => h.run(family.parent, { type: 'household.update', profile: profile(), expectedRevision: 0 }));
    denied(() => h.run(family.parent, { type: 'household.create', profile: profile() }));
    expect(h.state).toEqual(snapshot);
  });
  it('stores Summer and during-Pesach interest without Sunday selections or payment state, by year', () => {
    const h = new Harness(), family = h.family();
    for (const [season, year] of [['summer', 2027], ['pesach', 2027], ['pesach', 2028]] as const) h.run(family.parent, { type: 'seasonal.save', season, year, childIds: family.children, periods: season === 'pesach' ? ['during'] : ['dates_unsure'], pickupAreas: ['boca'], note: 'Synthetic seasonal interest' });
    const stored = h.state.households[0]!;
    expect(stored.availability).toHaveLength(0); expect(stored.seasonal).toHaveLength(3); expect(stored.seasonal[1]!.periods).toEqual(['during']);
    h.run(family.parent, { type: 'seasonal.withdraw', season: 'pesach', year: 2027 });
    expect(h.state.households[0]!.seasonal.map(row => row.status)).toEqual(['interested', 'withdrawn', 'interested']);
    expect(h.state.departures).toHaveLength(0); expect(h.state.offers).toHaveLength(0); expect(householdCreditMinor(h.state, family.parent.householdId!)).toBe(0);
    denied(() => h.run(family.parent, { type: 'seasonal.save', season: 'summer', year: 2027, childIds: family.children, periods: ['dates_unsure'], possibleWeeks: ['2028-06-12'], pickupAreas: [], note: '' }), 'INVALID_REQUEST');
  });
  it('preserves all/any per child and counts any alternatives as one unique interested child', () => {
    const h = new Harness(), family = h.family(2), options = ['2026-12-06', '2026-12-13', '2026-12-20'].map(date => ({ date, kind: 'local', pickupAreas: ['boca'] }));
    h.run(family.parent, { type: 'availability.save', childId: family.children[0], selection: 'any', options, note: '' });
    h.run(family.parent, { type: 'availability.save', childId: family.children[1], selection: 'all', options, note: '' });
    expect(tripDemand(h.state)).toEqual({ uniqueChildren: 2, byDate: options.map(row => ({ date: row.date, kind: 'local', children: 2, allChildren: 1, anyChildren: 1 })) });
    expect(h.state.households[0]!.availability.map(row => row.selection)).toEqual(['any', 'all']);
    denied(() => h.run(family.parent, { type: 'availability.save', childId: family.children[0], selection: 'any', options: [options[0], options[0]], note: '' }), 'INVALID_REQUEST');
    denied(() => h.run(family.parent, { type: 'availability.save', childId: family.children[0], selection: 'any', options: [{ date: '2026-02-30', kind: 'local', pickupAreas: [] }], note: '' }), 'INVALID_REQUEST');
  });
  it('keeps children minors, media grouping private, and parent projection household-scoped', () => {
    const h = new Harness(), a = h.family(), b = h.family(), departureId = h.departure();
    const offerId = h.offer(departureId, a); h.offer(departureId, b);
    const view = projectTripState(h.state, a.parent);
    expect(view.households.map(row => row.id)).toEqual([a.parent.householdId]); expect(view.offers.map(row => row.id)).toEqual([offerId]);
    expect(view.offers[0]!.ownerNote).toBe(''); expect(view.departures[0]!.ownerResourceId).toBe(''); expect(view.departures[0]!.transport.vehicleId).toBe('');
    expect(view.revision).toBe(view.households[0]!.revision);
    expect(JSON.stringify(view)).not.toContain(b.parent.householdId); expect(JSON.stringify(view)).not.toContain(b.children[0]);
    denied(() => h.run(a.parent, { type: 'child.save', child: { name: 'Adult', age: 18, mediaUse: false, fishingExperience: '', ownsRod: false } }), 'INVALID_REQUEST');
    denied(() => h.run(a.parent, { type: 'offer.accept', offerId: h.state.offers[1]!.id, quoteId: h.state.offers[1]!.quoteId, acceptedDate: '2026-12-06', pickupHubId: 'boca' }), 'NOT_FOUND');
  });
});

describe('real capacities, resources, and immutable offers', () => {
  it('counts the son within the ten-child pier cap and validates minimum against maximum, not empty seats', () => {
    const h = new Harness(), family = h.family(9), departureId = h.departure({ minimumPaid: 9 });
    expect(departureCapacity(h.state, departureId)).toMatchObject({ maximumChildren: 10, maximumPayingChildren: 9, nonpayingChildren: 1 });
    const offerId = h.offer(departureId, family); expect(departureCapacity(h.state, departureId).availablePayingChildren).toBe(0);
    h.sent(offerId); h.accept(offerId, family.parent);
    denied(() => h.run(h.owner, { type: 'departure.confirm', departureId }));
    h.cash(offerId, 95000); h.run(h.owner, { type: 'departure.confirm', departureId });
    expect(departureCapacity(h.state, departureId).paidChildren).toBe(9); expect(h.state.departures[0]!.status).toBe('confirmed');
    const invalid = new Harness(); denied(() => invalid.departure({ minimumPaid: 10 }), 'INVALID_REQUEST');
    expect(h.state.receipts).toHaveLength(1); expect(h.state.offers[0]!.children).not.toContainEqual(expect.objectContaining({ childId: 'organizer-son' }));
    h.run(h.owner, { type: 'departure.attendance', departureId, childId: 'organizer-son', present: true }); expect(h.state.departures[0]!.attendance[0]!.present).toBe(true);
  });
  it('keeps fifteen desired Keys children separate from total transport seats and remains free while unverified', () => {
    const h = new Harness(), family = h.family();
    const departureId = h.departure({ kind: 'keys', desiredChildLimit: 15, activityChildLimit: 15, transport: { verified: false, totalSeats: 15, driverAdults: 1, otherAdults: 0, vehicleId: 'van' } });
    expect(departureCapacity(h.state, departureId)).toMatchObject({ desiredChildLimit: 15, maximumPayingChildren: 0 }); denied(() => h.offer(departureId, family));
    h.run(h.owner, { type: 'departure.save', departureId, departure: departureInput({ kind: 'keys', desiredChildLimit: 15, activityChildLimit: 15, transport: { verified: true, totalSeats: 15, driverAdults: 1, otherAdults: 0, vehicleId: 'van' } }) });
    expect(departureCapacity(h.state, departureId)).toMatchObject({ transportChildCapacity: 14, maximumChildren: 14, maximumPayingChildren: 13 });
    h.run(h.owner, { type: 'departure.save', departureId, departure: departureInput({ kind: 'keys', desiredChildLimit: 15, activityChildLimit: 15, transport: { verified: true, totalSeats: 16, driverAdults: 1, otherAdults: 0, vehicleId: 'van' } }) });
    expect(departureCapacity(h.state, departureId).maximumPayingChildren).toBe(14);
    const offerId = h.offer(departureId, family); expect(h.state.offers.find(row => row.id === offerId)!.children[0]!.amountMinor).toBe(30000);
  });
  it('rejects operationally unready offers, resource overlaps and overlong pier capacities atomically', () => {
    const h = new Harness(), family = h.family(), departureId = h.departure({ operationalReady: false });
    denied(() => h.offer(departureId, family));
    const snapshot = structuredClone(h.state);
    denied(() => h.departure({ transport: { verified: true, totalSeats: 15, driverAdults: 1, otherAdults: 1, vehicleId: 'different' } }));
    denied(() => h.departure({ activityChildLimit: 11 }), 'INVALID_REQUEST');
    expect(h.state).toEqual(snapshot);
    h.departure({ departureAt: '2026-12-06T19:00:00Z', returnAt: '2026-12-06T23:00:00Z', fishingStartAt: '2026-12-06T19:15:00Z', fishingEndAt: '2026-12-06T22:30:00Z' });
    expect(h.state.departures).toHaveLength(2);
  });
  it('uses the New York Sunday and full transport interval, not UTC weekday or fishing hours alone', () => {
    const h = new Harness();
    h.departure({ departureAt: '2026-12-07T00:30:00Z', returnAt: '2026-12-07T04:30:00Z', fishingStartAt: '2026-12-07T01:00:00Z', fishingEndAt: '2026-12-07T04:00:00Z' });
    const invalid = new Harness(); denied(() => invalid.departure({ departureAt: '2026-12-07T15:00:00Z', returnAt: '2026-12-07T19:00:00Z', fishingStartAt: '2026-12-07T15:30:00Z', fishingEndAt: '2026-12-07T18:30:00Z' }), 'INVALID_REQUEST');
    denied(() => invalid.departure({ fishingStartAt: '2026-12-06T14:00:00Z' }), 'INVALID_REQUEST');
  });
  it('serializes the last seat and prevents a child from holding overlapping departures', () => {
    const h = new Harness(), a = h.family(), b = h.family(), c = h.family();
    const first = h.departure({ desiredChildLimit: 2, activityChildLimit: 2, sonAttending: true }); h.offer(first, a);
    denied(() => h.offer(first, b)); expect(departureCapacity(h.state, first).occupiedPayingChildren).toBe(1);
    const second = h.departure({ desiredChildLimit: 2, activityChildLimit: 2, sonAttending: false, ownerResourceId: 'other-owner', transport: { verified: true, totalSeats: 8, driverAdults: 1, otherAdults: 1, vehicleId: 'other-van' } });
    denied(() => h.offer(second, a)); h.offer(second, c);
  });
  it('reserves before delivery, starts exactly 48 hours at actual send, and demands explicit quote/date/hub acceptance', () => {
    const h = new Harness(), family = h.family(2), departureId = h.departure(), offerId = h.offer(departureId, family);
    expect(h.state.offers[0]).toMatchObject({ deliveryState: 'pending_delivery', paymentDeadline: null, acceptedAt: null });
    expect(h.state.offers[0]!.children.map(row => row.amountMinor)).toEqual([15000, 10000]);
    h.now = new Date('2026-11-28T12:00:00Z'); h.sent(offerId);
    expect(h.state.offers[0]!.paymentDeadline).toBe('2026-11-30T12:00:00.000Z');
    const quote = structuredClone(h.state.offers[0]!.snapshot);
    denied(() => h.run(family.parent, { type: 'offer.accept', offerId, quoteId: h.state.offers[0]!.quoteId, acceptedDate: '2026-12-13', pickupHubId: 'miami' }), 'INVALID_REQUEST');
    h.accept(offerId, family.parent); h.run(h.owner, { type: 'prices.update', local: { firstMinor: 16000, siblingMinor: 11000 }, keys: { firstMinor: 31000, siblingMinor: 26000 } });
    expect(h.state.offers[0]!.snapshot).toEqual(quote); expect(h.state.offers[0]!.children.map(row => row.amountMinor)).toEqual([15000, 10000]);
    denied(() => h.run(h.owner, { type: 'departure.save', departureId, departure: departureInput() }));
  });
  it('requires a separately explicit future short-notice deadline and prevents browser-parent trusted commands', () => {
    const h = new Harness(), family = h.family(), offerId = h.offer(h.departure(), family); h.now = new Date('2026-12-06T12:00:00Z');
    denied(() => h.sent(offerId), 'INVALID_REQUEST'); h.sent(offerId, '2026-12-06T14:00:00Z');
    denied(() => h.run(family.parent, { type: 'payment.record_unknown', offerId }), 'FORBIDDEN');
    expect(isInternalTripCommand(tripCommandSchema.parse({ type: 'delivery.record_unknown', offerId, expectedRevision: 0, operationId: randomUUID() }))).toBe(true);
  });
  it('preserves edited original requests and prevents two acceptances for one any-of group', () => {
    const h = new Harness(), family = h.family(), options = ['2026-12-06', '2026-12-13'].map(date => ({ date, kind: 'local', pickupAreas: ['boca'] }));
    const requestId = h.run(family.parent, { type: 'availability.save', childId: family.children[0], selection: 'any', options, note: 'Original any preference' }).id!;
    const one = h.offer(h.departure(), family);
    const two = h.offer(h.departure({ departureAt: '2026-12-13T15:00:00Z', returnAt: '2026-12-13T19:00:00Z', fishingStartAt: '2026-12-13T15:30:00Z', fishingEndAt: '2026-12-13T18:30:00Z' }), family);
    h.sent(one); h.sent(two); h.accept(one, family.parent);
    h.run(family.parent, { type: 'availability.save', requestId, childId: family.children[0], selection: 'all', options, note: 'Later edit, not changed accepted quote' });
    expect(h.state.households[0]!.availability[0]!.history[0]).toMatchObject({ selection: 'any', note: 'Original any preference' });
    denied(() => h.accept(two, family.parent));
    expect(h.state.offers[1]!.acceptedAt).toBeNull();
    expect(h.state.households[0]!.availability[0]!.options).toEqual(options);
  });
});

describe('actual money, invoice closure, and conserved household credit', () => {
  it('retains partial-child allocation and restores only that child’s actual value once', () => {
    const h = new Harness(), family = h.family(2), offerId = h.offer(h.departure(), family); h.sent(offerId); h.accept(offerId, family.parent); h.cash(offerId, 20000);
    expect(h.state.allocations.map(row => row.amountMinor)).toEqual([15000, 5000]);
    h.run(family.parent, { type: 'booking.cancel', offerId, childIds: [family.children[1]], reason: 'parent' });
    expect(householdCreditMinor(h.state, family.parent.householdId!)).toBe(5000); expect(h.state.offers[0]!.children[0]).toMatchObject({ amountMinor: 15000, status: 'confirmed' });
    h.run(family.parent, { type: 'booking.cancel', offerId, childIds: [family.children[1]], reason: 'parent' });
    expect(h.state.creditLedger).toHaveLength(1); expect(allocatedLive(h.state) + householdCreditMinor(h.state, family.parent.householdId!)).toBe(20000);
  });
  it('preserves sibling quote after first-child cancellation, spends credit once and restores spent credit once', () => {
    const h = new Harness(), family = h.family(2), offerId = h.offer(h.departure(), family); h.sent(offerId); h.accept(offerId, family.parent); h.cash(offerId, 25000);
    h.run(family.parent, { type: 'booking.cancel', offerId, childIds: [family.children[0]], reason: 'parent' });
    expect(h.state.offers[0]!.children[1]!.amountMinor).toBe(10000);
    const nextDeparture = h.departure({ departureAt: '2026-12-13T15:00:00Z', returnAt: '2026-12-13T19:00:00Z', fishingStartAt: '2026-12-13T15:30:00Z', fishingEndAt: '2026-12-13T18:30:00Z' });
    const next = h.offer(nextDeparture, family, [family.children[0]!]); h.sent(next); h.accept(next, family.parent);
    h.run(family.parent, { type: 'offer.apply_credit', offerId: next, amountMinor: 15000 });
    expect(householdCreditMinor(h.state, family.parent.householdId!)).toBe(0); denied(() => h.run(family.parent, { type: 'offer.apply_credit', offerId: next, amountMinor: 1 }));
    h.run(family.parent, { type: 'booking.cancel', offerId: next, childIds: [family.children[0]], reason: 'parent' });
    h.run(family.parent, { type: 'booking.cancel', offerId, childIds: [family.children[1]], reason: 'parent' });
    expect(householdCreditMinor(h.state, family.parent.householdId!)).toBe(25000); expect(allocatedLive(h.state)).toBe(0);
    expect(h.state.receipts.reduce((a, b) => a + b.amountMinor, 0)).toBe(25000);
  });
  it('honors the exact 24-hour boundary and retains original receipt time while invoice closure happens later', () => {
    const h = new Harness(), family = h.family(), offerId = h.offer(h.departure(), family); h.sent(offerId); h.accept(offerId, family.parent);
    const invoiceId = h.invoice(offerId); h.cash(offerId, 15000);
    h.now = new Date('2026-12-05T15:00:00Z'); h.run(family.parent, { type: 'booking.cancel', offerId, childIds: family.children, reason: 'parent' });
    expect(householdCreditMinor(h.state, family.parent.householdId!)).toBe(0); expect(departureCapacity(h.state, h.state.departures[0]!).occupiedPayingChildren).toBe(1);
    h.now = new Date('2026-12-06T17:00:00Z'); h.run(h.owner, { type: 'invoice.reconcile_closed', offerId, invoiceId, status: 'paid', allPaymentsReconciled: true });
    expect(householdCreditMinor(h.state, family.parent.householdId!)).toBe(15000); expect(h.state.offers[0]!.children[0]!.cancellationReceivedAt).toBe('2026-12-05T15:00:00.000Z');
    const late = new Harness(), second = late.family(), o = late.offer(late.departure(), second); late.sent(o); late.accept(o, second.parent); late.cash(o, 15000);
    late.now = new Date('2026-12-05T15:00:00.001Z'); late.run(second.parent, { type: 'booking.cancel', offerId: o, childIds: second.children, reason: 'parent' });
    expect(householdCreditMinor(late.state, second.parent.householdId!)).toBe(0);
    late.run(late.owner, { type: 'booking.resolve_exception', offerId: o, childIds: second.children, grantCredit: true, note: 'Explicit discretionary owner credit' });
    expect(householdCreditMinor(late.state, second.parent.householdId!)).toBe(15000);
  });
  it('deduplicates provider payments and cash marked out of band without inventing a second receipt', () => {
    const h = new Harness(), family = h.family(), offerId = h.offer(h.departure(), family); h.sent(offerId); h.accept(offerId, family.parent); const invoiceId = h.invoice(offerId);
    const receipt = h.cash(offerId, 15000, 'cash-001'); h.cash(offerId, 15000, 'cash-001');
    const linked = { type: 'payment.link_cash_out_of_band', offerId, cashReceiptId: receipt.receiptId, providerEventId: 'evt_cash_001', invoiceId, amountMinor: 15000 };
    h.run(h.owner, linked); expect(h.run(h.owner, linked).replayed).toBe(true); expect(h.state.receipts).toHaveLength(1); expect(h.state.allocations).toHaveLength(1);
    denied(() => h.cash(offerId, 16000, 'cash-001')); expect(h.state.receipts[0]!.amountMinor).toBe(15000);
    const stripe = new Harness(), b = stripe.family(), o = stripe.offer(stripe.departure(), b); stripe.sent(o); stripe.accept(o, b.parent); const inv = stripe.invoice(o);
    const payment = { type: 'payment.record_verified', offerId: o, paymentKey: 'pi_001', providerEventId: 'evt_001', amountMinor: 15000, receivedAt: stripe.now.toISOString(), invoiceId: inv };
    stripe.run(stripe.owner, payment); expect(stripe.run(stripe.owner, payment).replayed).toBe(true); expect(stripe.state.receipts).toHaveLength(1);
  });
  it('does not release an expired invoice hold until closure, nor let late payment steal a reassigned seat', () => {
    const h = new Harness(), a = h.family(), b = h.family(), dep = h.departure({ desiredChildLimit: 2, activityChildLimit: 2 }), offerId = h.offer(dep, a); h.sent(offerId); h.accept(offerId, a.parent); const invoiceId = h.invoice(offerId);
    h.now = new Date('2026-11-30T15:00:00Z'); h.run(h.owner, { type: 'offer.expire', offerId });
    expect(h.state.offers[0]!.status).toBe('reconciliation_required'); denied(() => h.offer(dep, b));
    h.run(h.owner, { type: 'invoice.reconcile_closed', offerId, invoiceId, status: 'void', allPaymentsReconciled: true }); h.offer(dep, b);
    h.run(h.owner, { type: 'payment.record_verified', offerId, invoiceId, paymentKey: 'pi_late', providerEventId: 'evt_late', amountMinor: 15000, receivedAt: h.now.toISOString() });
    expect(h.state.receipts[0]).toMatchObject({ unappliedMinor: 15000, resolution: 'reconciliation_required' }); expect(h.state.offers[0]!.status).toBe('reconciliation_required');
    expect(h.state.offers[0]!.children[0]!.status).toBe('cancelled'); expect(departureCapacity(h.state, dep).occupiedPayingChildren).toBe(1); expect(h.state.creditLedger).toHaveLength(0);
  });
  it('treats payment unknown, overpayment and organizer cancellation as explicit reconciliation, never a refund fee', () => {
    const h = new Harness(), family = h.family(), offerId = h.offer(h.departure(), family); h.sent(offerId); h.accept(offerId, family.parent); h.cash(offerId, 16000);
    expect(h.state.receipts[0]!.unappliedMinor).toBe(1000); h.run(family.parent, { type: 'booking.cancel', offerId, childIds: family.children, reason: 'parent' });
    expect(h.state.offers[0]!.status).toBe('reconciliation_required'); expect(householdCreditMinor(h.state, family.parent.householdId!)).toBe(0);
    expect(tripCommandSchema.safeParse({ type: 'cash.refund', expectedRevision: 0, operationId: randomUUID(), amountMinor: 10000 }).success).toBe(false);
    const owner = new Harness(), f = owner.family(), o = owner.offer(owner.departure(), f); owner.sent(o); owner.accept(o, f.parent); owner.cash(o, 15000);
    owner.run(owner.owner, { type: 'booking.cancel', offerId: o, childIds: f.children, reason: 'owner' }); expect(householdCreditMinor(owner.state, f.parent.householdId!)).toBe(0);
    owner.run(owner.owner, { type: 'booking.resolve_exception', offerId: o, childIds: f.children, grantCredit: true, note: 'Owner explicitly grants credit for organizer cancellation' }); expect(householdCreditMinor(owner.state, f.parent.householdId!)).toBe(15000);
  });
  it('keeps failure atomic even when a multi-child command finds a later wrong child ID', () => {
    const h = new Harness(), family = h.family(2), offerId = h.offer(h.departure(), family); h.sent(offerId); h.accept(offerId, family.parent); h.cash(offerId, 25000);
    const snapshot = structuredClone(h.state); denied(() => h.run(family.parent, { type: 'booking.cancel', offerId, childIds: [family.children[0], randomUUID()], reason: 'parent' }), 'NOT_FOUND'); expect(h.state).toEqual(snapshot);
  });
  it('uses elapsed hours across the New York spring clock change, not a civil-day approximation', () => {
    const h = new Harness(); h.now = new Date('2027-03-10T14:00:00Z'); const family = h.family();
    const dep = h.departure({ departureAt: '2027-03-14T14:00:00Z', returnAt: '2027-03-14T18:00:00Z', fishingStartAt: '2027-03-14T14:30:00Z', fishingEndAt: '2027-03-14T17:30:00Z' });
    const offerId = h.offer(dep, family); h.sent(offerId); h.accept(offerId, family.parent); h.cash(offerId, 15000);
    h.now = new Date('2027-03-13T14:00:00Z'); h.run(family.parent, { type: 'booking.cancel', offerId, childIds: family.children, reason: 'parent' });
    expect(householdCreditMinor(h.state, family.parent.householdId!)).toBe(15000);
  });
  it('requires invoice acceptance first and retains ambiguous money without marking children funded', () => {
    const h = new Harness(), family = h.family(), offerId = h.offer(h.departure(), family); h.sent(offerId);
    denied(() => h.invoice(offerId)); h.accept(offerId, family.parent); const invoiceId = h.invoice(offerId);
    h.run(h.owner, { type: 'payment.record_unknown', offerId });
    h.run(h.owner, { type: 'payment.record_verified', offerId, invoiceId, paymentKey: 'pi_uncertain', providerEventId: 'evt_uncertain', amountMinor: 15000, receivedAt: h.now.toISOString() });
    expect(h.state.receipts[0]!.unappliedMinor).toBe(15000); expect(h.state.allocations).toHaveLength(0); expect(departureCapacity(h.state, h.state.departures[0]!).paidChildren).toBe(0);
    h.run(family.parent, { type: 'booking.cancel', offerId, childIds: family.children, reason: 'parent' });
    expect(householdCreditMinor(h.state, family.parent.householdId!)).toBe(0); expect(h.state.offers[0]!.status).toBe('reconciliation_required');
  });
});
