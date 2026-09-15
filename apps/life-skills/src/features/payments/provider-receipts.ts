import type {
  FirstSessionOrder,
  ReceiptAllocation,
  ReceiptStore,
  StoredReceipt,
  VerifiedPaymentEvent,
} from './provider-types.ts';

/** Minimal in-memory double for isolated tests; production storage is W0's migration-owned implementation. */
export class MemoryReceiptStore implements ReceiptStore {
  private readonly receipts = new Map<string, StoredReceipt>();
  private readonly orders = new Map<string, FirstSessionOrder>();
  private readonly transactions = new Set<string>();

  addOrder(order: FirstSessionOrder): void {
    this.orders.set(order.orderId, order);
  }

  async findByEventKey(eventKey: string): Promise<StoredReceipt | undefined> {
    return this.receipts.get(eventKey);
  }

  async save(receipt: StoredReceipt): Promise<void> {
    this.receipts.set(receipt.event.eventKey, receipt);
  }

  async findOrder(orderId: string): Promise<FirstSessionOrder | undefined> {
    return this.orders.get(orderId);
  }

  async hasTransactionAllocation(transactionId: string): Promise<boolean> {
    return this.transactions.has(transactionId);
  }

  async saveAllocation(allocation: ReceiptAllocation): Promise<void> {
    if (this.transactions.has(allocation.transactionId)) throw new Error('transaction already allocated');
    this.transactions.add(allocation.transactionId);
  }
}

export function receiptFromEvent(event: VerifiedPaymentEvent, receivedAt: string, state: StoredReceipt['state']): StoredReceipt {
  return { receiptId: `lsr_${event.eventKey}`, event, receivedAt, state, allocations: [] };
}
