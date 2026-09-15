import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { ingestProviderReceipt, verifyAndNormalizeGreenInvoice, recordStaffReceipt } from '../../src/features/payments/provider-adapter.ts';
import { MemoryReceiptStore } from '../../src/features/payments/provider-receipts.ts';

const config = { accountId: 'acct-test', secret: 'synthetic-secret' };
function input(body: object, signature = true) {
  const rawBody = JSON.stringify(body);
  return { rawBody, receivedAt: '2026-09-15T00:00:00.000Z', headers: { 'x-green-invoice-signature': signature ? createHash('sha256').update(`${config.secret}.${rawBody}`).digest('hex') : 'bad' } };
}
const order = { orderId: 'o-1', caseId: 'c-1', childId: 'child-1', amountMinor: 55000 as const, currency: 'ILS' as const, purpose: 'first_session' as const };

test('requires authentication and explicit success semantics', async () => {
  const body = { eventId: 'e-1', status: 'succeeded', orderId: 'o-1', transactions: [{ transactionId: 't-1', status: 'succeeded', amountMinor: 55000, currency: 'ILS' }] };
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
  const body = { eventId: 'e-paid', status: 'succeeded', transactions: [{ transactionId: 't-paid', status: 'succeeded', amountMinor: 55000, currency: 'ILS', orderId: 'o-1' }, { transactionId: 't-paid-2', status: 'succeeded', amountMinor: 55000, currency: 'ILS', orderId: 'o-2' }] };
  const v = verifyAndNormalizeGreenInvoice(input(body), config); assert.equal(v.ok, true); if (v.ok) assert.equal((await ingestProviderReceipt(v.event, 'now', store)).state, 'unmatched');
  const single = verifyAndNormalizeGreenInvoice(input({ ...body, eventId: 'e-paid-single', transactions: [body.transactions[0]] }), config); assert.equal(single.ok, true); if (single.ok) { assert.equal((await ingestProviderReceipt(single.event, 'now', store)).state, 'paid'); assert.equal((await ingestProviderReceipt(single.event, 'now', store)).state, 'duplicate'); }
});

test('cash and bank are staff receipts and remain due', () => { assert.deepEqual(recordStaffReceipt({ caseId: 'c', childId: 'ch', orderId: 'o', amountMinor: 55000, currency: 'ILS', method: 'cash', receivedAt: 'now', privateReference: 'synthetic' }), { state: 'pending', method: 'cash', dueUntilVerified: true }); });
