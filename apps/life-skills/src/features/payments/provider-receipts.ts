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
  private readonly allocations = new Map<string, ReceiptAllocation>();
  private readonly refundedTransactions = new Set<string>();
  private readonly locks = new Map<string, Promise<unknown>>();

  addOrder(order: FirstSessionOrder): void {
    this.orders.set(order.orderId, order);
  }

  async findByEventKey(eventKey: string): Promise<StoredReceipt | undefined> {
    return this.receipts.get(eventKey);
  }

  async withReceiptLock<T>(eventKey: string, work: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(eventKey) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>(resolve => { release = resolve; });
    this.locks.set(eventKey, previous.then(() => current));
    await previous;
    try { return await work(); } finally { release(); if (this.locks.get(eventKey) === current) this.locks.delete(eventKey); }
  }

  async save(receipt: StoredReceipt): Promise<void> {
    this.receipts.set(receipt.event.eventKey, receipt);
  }

  async findOrder(orderId: string): Promise<FirstSessionOrder | undefined> {
    return this.orders.get(orderId);
  }

  async findAllocation(transactionId: string): Promise<ReceiptAllocation | undefined> {
    return this.allocations.get(transactionId);
  }

  async findOrderAllocation(orderId: string): Promise<ReceiptAllocation | undefined> {
    return [...this.allocations.values()].find(allocation => allocation.orderId === orderId);
  }

  async saveAllocation(allocation: ReceiptAllocation): Promise<void> {
    if (this.transactions.has(allocation.transactionId)) throw new Error('transaction already allocated');
    this.transactions.add(allocation.transactionId);
    this.allocations.set(allocation.transactionId, allocation);
  }

  async hasRefundedTransaction(transactionId: string): Promise<boolean> {
    return this.refundedTransactions.has(transactionId);
  }

  async recordRefund(transactionId: string): Promise<void> {
    this.refundedTransactions.add(transactionId);
  }
}

export function receiptFromEvent(event: VerifiedPaymentEvent, receivedAt: string, state: StoredReceipt['state']): StoredReceipt {
  return { receiptId: `lsr_${event.eventKey}`, event, receivedAt, state, allocations: [] };
}
