import assert from 'node:assert/strict';
import test from 'node:test';
import { ingestProviderReceipt, verifyAndNormalizeGreenInvoice, recordStaffReceipt } from '../../src/features/payments/provider-adapter.ts';
import { MemoryReceiptStore } from '../../src/features/payments/provider-receipts.ts';

const config = { accountId: 'acct-test', verify: (value: { rawBody: string }) => value.rawBody !== 'unauthenticated' };
function input(body: object, authenticated = true) {
  const rawBody = JSON.stringify(body);
  return { rawBody: authenticated ? rawBody : 'unauthenticated', receivedAt: '2026-09-15T00:00:00.000Z', headers: {} };
}
const order = { orderId: 'o-1', caseId: 'c-1', childId: 'child-1', amountMinor: 55000 as const, currency: 'ILS' as const, purpose: 'first_session' as const };

test('requires authentication and explicit success semantics', async () => {
  const body = { eventId: 'e-1', status: 'succeeded', purpose: 'first_session', orderId: 'o-1', transactions: [{ transactionId: 't-1', status: 'succeeded', amountMinor: 55000, currency: 'ILS' }] };
  assert.equal(verifyAndNormalizeGreenInvoice(input(body, false), config).ok, false);
  const store = new MemoryReceiptStore(); store.addOrder(order);
  const verified = verifyAndNormalizeGreenInvoice(input(body), config); assert.equal(verified.ok, true);
  if (verified.ok) assert.equal((await ingestProviderReceipt(verified.event, 'now', store)).state, 'paid');
});

test('rejects amount-only, wrong currency, redirects and name matching', async () => {
  const store = new MemoryReceiptStore(); store.addOrder(order);
  for (const body of [
    { eventId: 'e-2', status: 'succeeded', transactions: [{ transactionId: 't-2', status: 'succeeded', amountMinor: 55000, currency: 'ILS' }] },
    { eventId: 'e-3', status: 'succeeded', orderId: 'o-1', transactions: [{ transactionId: 't-3', status: 'succeeded', amountMinor: 55000, currency: 'USD' }] },
    { eventId: 'e-4', status: 'succeeded', redirect: true, customerName: 'matching parent', transactions: [{ transactionId: 't-4', status: 'succeeded', amountMinor: 55000, currency: 'ILS' }] },
  ]) { const v = verifyAndNormalizeGreenInvoice(input(body), config); assert.equal(v.ok, true); if (v.ok) assert.equal((await ingestProviderReceipt(v.event, 'now', store)).state, body.eventId === 'e-2' ? 'unmatched' : 'unmatched'); }
});

test('dedupes replay, handles pending/failed/refunded and prevents sibling cross-allocation', async () => {
  const store = new MemoryReceiptStore(); store.addOrder(order); store.addOrder({ ...order, orderId: 'o-2', childId: 'child-2' });
  for (const status of ['pending', 'failed', 'refunded'] as const) { const v = verifyAndNormalizeGreenInvoice(input({ eventId: `e-${status}`, status, orderId: 'o-1', transactions: [{ transactionId: `t-${status}`, status, amountMinor: 55000, currency: 'ILS' }] }), config); assert.equal(v.ok, true); if (v.ok) assert.equal((await ingestProviderReceipt(v.event, 'now', store)).state, status); }
  const body = { eventId: 'e-paid', status: 'succeeded', purpose: 'first_session', transactions: [{ transactionId: 't-paid', status: 'succeeded', amountMinor: 55000, currency: 'ILS', orderId: 'o-1' }, { transactionId: 't-paid-2', status: 'succeeded', amountMinor: 55000, currency: 'ILS', orderId: 'o-2' }] };
  const v = verifyAndNormalizeGreenInvoice(input(body), config); assert.equal(v.ok, true); if (v.ok) assert.equal((await ingestProviderReceipt(v.event, 'now', store)).state, 'unmatched');
  const single = verifyAndNormalizeGreenInvoice(input({ ...body, eventId: 'e-paid-single', transactions: [body.transactions[0]] }), config); assert.equal(single.ok, true); if (single.ok) { assert.equal((await ingestProviderReceipt(single.event, 'now', store)).state, 'paid'); assert.equal((await ingestProviderReceipt(single.event, 'now', store)).state, 'duplicate'); }
});

test('cash and bank are staff receipts and remain due', () => { assert.deepEqual(recordStaffReceipt({ caseId: 'c', childId: 'ch', orderId: 'o', amountMinor: 55000, currency: 'ILS', method: 'cash', receivedAt: 'now', privateReference: 'synthetic' }), { state: 'pending', method: 'cash', dueUntilVerified: true }); });

test('fails closed for null/verifier outage/wrong account and serializes competing events', async () => {
  assert.equal(verifyAndNormalizeGreenInvoice(null as never, config).ok, false);
  assert.equal(verifyAndNormalizeGreenInvoice(input({ eventId: 'e-null', status: 'succeeded', purpose: 'first_session', orderId: 'o-1', transactions: [{ transactionId: 't-null', status: 'succeeded', amountMinor: 55000, currency: 'ILS' }] }), { accountId: 'acct-test', verify: () => { throw new Error('outage'); } }).ok, false);
  const wrong = verifyAndNormalizeGreenInvoice(input({ eventId: 'e-wrong', providerAccountId: 'other', status: 'succeeded', purpose: 'first_session', orderId: 'o-1', transactions: [{ transactionId: 't-wrong', status: 'succeeded', amountMinor: 55000, currency: 'ILS' }] }), config);
  assert.equal(wrong.ok, false);
  const store = new MemoryReceiptStore(); store.addOrder(order);
  const a = verifyAndNormalizeGreenInvoice(input({ eventId: 'e-a', status: 'succeeded', purpose: 'first_session', orderId: 'o-1', transactions: [{ transactionId: 't-same', status: 'succeeded', amountMinor: 55000, currency: 'ILS' }] }), config);
  const b = verifyAndNormalizeGreenInvoice(input({ eventId: 'e-b', status: 'succeeded', purpose: 'first_session', orderId: 'o-1', transactions: [{ transactionId: 't-same', status: 'succeeded', amountMinor: 55000, currency: 'ILS' }] }), config);
  assert.equal(a.ok && b.ok, true);
  if (a.ok && b.ok) { const outcomes = await Promise.all([ingestProviderReceipt(a.event, 'now', store), ingestProviderReceipt(b.event, 'now', store)]); assert.equal(outcomes.filter(value => value.state === 'paid').length, 1); }
});

test('retry after a persistence crash does not allocate twice', async () => {
  const store = new MemoryReceiptStore(); store.addOrder(order);
  const event = verifyAndNormalizeGreenInvoice(input({ eventId: 'e-crash', status: 'succeeded', purpose: 'first_session', orderId: 'o-1', transactions: [{ transactionId: 't-crash', status: 'succeeded', amountMinor: 55000, currency: 'ILS' }] }), config);
  assert.equal(event.ok, true); if (!event.ok) return;
  const originalSave = store.save.bind(store); let saveCount = 0;
  store.save = async receipt => { saveCount += 1; if (saveCount === 2) throw new Error('synthetic crash'); await originalSave(receipt); };
  await assert.rejects(() => ingestProviderReceipt(event.event, 'now', store));
  store.save = originalSave;
  const retry = await ingestProviderReceipt(event.event, 'now', store);
  assert.equal(retry.state, 'duplicate');
  assert.equal((await store.findOrderAllocation('o-1'))?.transactionId, 't-crash');
});
