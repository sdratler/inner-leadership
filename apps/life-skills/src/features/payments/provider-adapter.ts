import { createHash } from 'node:crypto';
import type {
  AuthenticationResult,
  ProviderReceiptInput,
  ProviderReceiptResult,
  ProviderStatus,
  ProviderTransaction,
  ReceiptAllocation,
  ReceiptStore,
  StoredReceipt,
  StaffReceiptInput,
  VerifiedPaymentEvent,
} from './provider-types.ts';
import { FIRST_SESSION_AMOUNT_MINOR, FIRST_SESSION_CURRENCY } from './provider-types.ts';
import { receiptFromEvent } from './provider-receipts.ts';

export interface GreenInvoiceAuthConfig {
  accountId: string;
  /** The nominated receiver supplies provider-documented verification. */
  verify: (input: ProviderReceiptInput) => boolean;
}

/**
 * Provider authentication boundary. The receiver must implement the provider-
 * documented verification method; this adapter never invents a header, signature
 * algorithm, endpoint, or trusts a redirect/invoice amount.
 */
export function verifyAndNormalizeGreenInvoice(input: ProviderReceiptInput, config: GreenInvoiceAuthConfig): AuthenticationResult {
  if (!input || typeof input.rawBody !== 'string' || !input.rawBody || !config || typeof config.accountId !== 'string' || !config.accountId || typeof config.verify !== 'function') return { ok: false, reason: 'invalid' };
  try { if (config.verify(input) !== true) return { ok: false, reason: 'unauthenticated' }; } catch { return { ok: false, reason: 'unauthenticated' }; }

  let payload: unknown;
  try { payload = JSON.parse(input.rawBody); } catch { return { ok: false, reason: 'invalid' }; }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { ok: false, reason: 'invalid' };
  const p = payload as Record<string, unknown>;
  const providerEventId = typeof p.eventId === 'string' ? p.eventId : undefined;
  const providerAccountId = typeof p.providerAccountId === 'string' ? p.providerAccountId : config.accountId;
  const status = normalizeStatus(p.status);
  const rawTransactions = Array.isArray(p.transactions) ? p.transactions : [];
  if (!providerEventId || !status || rawTransactions.length === 0) return { ok: false, reason: 'invalid' };
  const transactions = rawTransactions.map(normalizeTransaction);
  if (transactions.some((transaction): transaction is undefined => !transaction)) return { ok: false, reason: 'invalid' };
  if (providerAccountId !== config.accountId) return { ok: false, reason: 'invalid' };
  const orderId = typeof p.orderId === 'string' ? p.orderId : undefined;
  const purpose = p.purpose === 'first_session' ? 'first_session' : undefined;
  if (p.purpose !== undefined && !purpose) return { ok: false, reason: 'invalid' };
  const rawDigest = createHash('sha256').update(input.rawBody).digest('hex');
  const eventKey = `${config.accountId}:${providerEventId}`;
  return {
    ok: true,
    event: { provider: 'green_invoice', providerAccountId, providerEventId, status, transactions: transactions as ProviderTransaction[], ...(orderId !== undefined ? { orderId } : {}), ...(purpose !== undefined ? { purpose } : {}), rawDigest, eventKey },
  };
}

function normalizeStatus(value: unknown): ProviderStatus | undefined {
  return value === 'pending' || value === 'succeeded' || value === 'failed' || value === 'refunded' ? value : undefined;
}

function normalizeTransaction(value: unknown): ProviderTransaction | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const p = value as Record<string, unknown>;
  if (typeof p.transactionId !== 'string' || !p.transactionId.trim() || typeof p.amountMinor !== 'number' || !Number.isInteger(p.amountMinor) || p.amountMinor <= 0 || typeof p.currency !== 'string') return undefined;
  const status = normalizeStatus(p.status);
  if (!status) return undefined;
  return { transactionId: p.transactionId, status, amountMinor: p.amountMinor, currency: p.currency, ...(typeof p.orderId === 'string' ? { orderId: p.orderId } : {}) };
}

export async function ingestProviderReceipt(event: VerifiedPaymentEvent, receivedAt: string, store: ReceiptStore): Promise<ProviderReceiptResult> {
  return store.withReceiptLock(event.eventKey, async () => {
    const prior = await store.findByEventKey(event.eventKey);
    if (prior && prior.event.rawDigest !== event.rawDigest) throw new Error('event_identity_conflict');
    if (prior && prior.state !== 'pending') return { receiptId: prior.receiptId, eventKey: event.eventKey, state: 'duplicate', allocations: prior.allocations, reason: 'replay' };

    const provisional = prior ?? receiptFromEvent(event, receivedAt, 'pending');
    await store.save(provisional); // durable receipt before any allocation/ack
    if (event.status === 'pending') return await finalize(store, provisional, 'pending', 'provider_not_final');
    if (event.status === 'failed') return await finalize(store, provisional, 'failed', 'provider_failed');
    if (event.status === 'refunded') {
      for (const transaction of event.transactions) await markRefund(store, transaction.transactionId);
      return await finalize(store, provisional, 'refunded', 'provider_refunded');
    }

    const orderRefs = event.transactions.map(t => t.orderId ?? event.orderId);
    const orderIds = new Set(orderRefs.filter(Boolean));
    if (event.purpose !== 'first_session' || orderIds.size !== 1 || orderRefs.some(ref => ref !== [...orderIds][0]) || event.transactions.some(t=>t.orderId && event.orderId && t.orderId!==event.orderId) || event.transactions.length !== 1) return await finalize(store, provisional, 'unmatched', 'stable_single_first_session_order_required');
    const order = await store.findOrder([...orderIds][0]!);
    const transaction = event.transactions[0]!;
    if (!order || order.purpose !== 'first_session' || order.amountMinor !== FIRST_SESSION_AMOUNT_MINOR || order.currency !== FIRST_SESSION_CURRENCY || transaction.currency !== FIRST_SESSION_CURRENCY || transaction.amountMinor !== FIRST_SESSION_AMOUNT_MINOR || transaction.status !== 'succeeded') return await finalize(store, provisional, 'unmatched', 'exact_order_amount_currency_purpose_required');
    if (await store.hasRefundedTransaction(transaction.transactionId)) return await finalize(store, provisional, 'refunded', 'refund_precedes_success');
    const existing = await store.findAllocation(transaction.transactionId);
    if (existing) return await finalize(store, provisional, 'duplicate', 'transaction_already_allocated', [existing]);
    if (await store.findOrderAllocation(order.orderId)) return await finalize(store, provisional, 'unmatched', 'order_already_allocated');
    const allocation: ReceiptAllocation = { transactionId: transaction.transactionId, orderId: order.orderId, childId: order.childId, amountMinor: transaction.amountMinor };
    // The store serializes the receipt/allocation transaction. Persistence failures
    // must roll back and trigger retry, never become a successful unmatched ACK.
    await store.saveAllocation(allocation);
    return await finalize(store, { ...provisional, allocations: [allocation] }, 'paid', undefined, [allocation]);
  });
}

async function markRefund(store: ReceiptStore, transactionId: string): Promise<void> {
  const existing = await store.findAllocation(transactionId);
  await store.recordRefund(transactionId);
  if (existing) return;
  // Production store records reversal/review-needed; the adapter never re-grants on a later success.
}

async function finalize(store: ReceiptStore, receipt: StoredReceipt, state: ProviderReceiptResult['state'], reason?: string, allocations: readonly ReceiptAllocation[] = receipt.allocations): Promise<ProviderReceiptResult> {
  const finalized = { ...receipt, state, allocations };
  await store.save(finalized);
  return result(finalized, state, reason, allocations);
}

function result(receipt: { receiptId: string; event: { eventKey: string }; allocations?: readonly ReceiptAllocation[] }, state: ProviderReceiptResult['state'], reason?: string, allocations?: readonly ReceiptAllocation[]): ProviderReceiptResult {
  return { receiptId: receipt.receiptId, eventKey: receipt.event.eventKey, state, allocations: allocations ?? receipt.allocations ?? [], ...(reason !== undefined ? { reason } : {}) };
}

export function recordStaffReceipt(input: StaffReceiptInput): { state: 'pending'; method: StaffReceiptInput['method']; dueUntilVerified: boolean } {
  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0 || input.currency !== FIRST_SESSION_CURRENCY) throw new Error('invalid staff receipt');
  return { state: 'pending', method: input.method, dueUntilVerified: true };
}
