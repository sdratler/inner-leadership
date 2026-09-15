import { createHash } from 'node:crypto';
import type {
  AuthenticationResult,
  FirstSessionOrder,
  ProviderReceiptInput,
  ProviderReceiptResult,
  ProviderStatus,
  ProviderTransaction,
  ReceiptAllocation,
  ReceiptStore,
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
  if (!config.verify(input)) return { ok: false, reason: 'unauthenticated' };

  let payload: unknown;
  try { payload = JSON.parse(input.rawBody); } catch { return { ok: false, reason: 'invalid' }; }
  const p = payload as Record<string, unknown>;
  const providerEventId = typeof p.eventId === 'string' ? p.eventId : undefined;
  const status = normalizeStatus(p.status);
  const rawTransactions = Array.isArray(p.transactions) ? p.transactions : [];
  if (!providerEventId || !status || rawTransactions.length === 0) return { ok: false, reason: 'invalid' };
  const transactions = rawTransactions.map(normalizeTransaction);
  if (transactions.some((transaction): transaction is undefined => !transaction)) return { ok: false, reason: 'invalid' };
  const orderId = typeof p.orderId === 'string' ? p.orderId : undefined;
  const rawDigest = createHash('sha256').update(input.rawBody).digest('hex');
  const eventKey = `${config.accountId}:${providerEventId}`;
  return {
    ok: true,
    event: { provider: 'green_invoice', providerAccountId: config.accountId, providerEventId, status, transactions: transactions as ProviderTransaction[], orderId, rawDigest, eventKey },
  };
}

function normalizeStatus(value: unknown): ProviderStatus | undefined {
  return value === 'pending' || value === 'succeeded' || value === 'failed' || value === 'refunded' ? value : undefined;
}

function normalizeTransaction(value: unknown): ProviderTransaction | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const p = value as Record<string, unknown>;
  if (typeof p.transactionId !== 'string' || !Number.isInteger(p.amountMinor) || p.amountMinor <= 0 || typeof p.currency !== 'string') return undefined;
  const status = normalizeStatus(p.status);
  if (!status) return undefined;
  return { transactionId: p.transactionId, status, amountMinor: p.amountMinor, currency: p.currency, orderId: typeof p.orderId === 'string' ? p.orderId : undefined };
}

export async function ingestProviderReceipt(event: VerifiedPaymentEvent, receivedAt: string, store: ReceiptStore): Promise<ProviderReceiptResult> {
  const prior = await store.findByEventKey(event.eventKey);
  if (prior) return { receiptId: prior.receiptId, eventKey: event.eventKey, state: 'duplicate', allocations: prior.allocations, reason: 'replay' };

  const provisional = receiptFromEvent(event, receivedAt, 'pending');
  await store.save(provisional); // durable receipt before any allocation/ack
  if (event.status === 'pending') return result(provisional, 'pending', 'provider_not_final');
  if (event.status === 'failed') return result(provisional, 'failed', 'provider_failed');
  if (event.status === 'refunded') return result(provisional, 'refunded', 'provider_refunded');

  const allocations: ReceiptAllocation[] = [];
  const orderIds = new Set(event.transactions.map(t => t.orderId ?? event.orderId).filter(Boolean));
  if (orderIds.size !== 1 || event.transactions.length !== 1) return result(provisional, 'unmatched', 'stable_single_order_required');
  const order = await store.findOrder([...orderIds][0]!);
  const transaction = event.transactions[0]!;
  if (!order || transaction.currency !== FIRST_SESSION_CURRENCY || transaction.amountMinor !== FIRST_SESSION_AMOUNT_MINOR || transaction.status !== 'succeeded') return result(provisional, 'unmatched', 'exact_order_amount_currency_required');
  if (await store.hasTransactionAllocation(transaction.transactionId)) return result(provisional, 'duplicate', 'transaction_already_allocated');
  const allocation: ReceiptAllocation = { transactionId: transaction.transactionId, orderId: order.orderId, childId: order.childId, amountMinor: transaction.amountMinor };
  await store.saveAllocation(allocation);
  allocations.push(allocation);
  const paid = { ...provisional, state: 'paid' as const, allocations };
  await store.save(paid);
  return result(paid, 'paid', undefined, allocations);
}

function result(receipt: { receiptId: string; event: { eventKey: string }; allocations?: readonly ReceiptAllocation[] }, state: ProviderReceiptResult['state'], reason?: string, allocations?: readonly ReceiptAllocation[]): ProviderReceiptResult {
  return { receiptId: receipt.receiptId, eventKey: receipt.event.eventKey, state, allocations: allocations ?? receipt.allocations ?? [], reason };
}

export function recordStaffReceipt(input: StaffReceiptInput): { state: 'pending'; method: StaffReceiptInput['method']; dueUntilVerified: boolean } {
  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0 || input.currency !== FIRST_SESSION_CURRENCY) throw new Error('invalid staff receipt');
  return { state: 'pending', method: input.method, dueUntilVerified: true };
}
