export const FIRST_SESSION_AMOUNT_MINOR = 55_000;
export const FIRST_SESSION_CURRENCY = 'ILS' as const;

export type PaymentState = 'pending' | 'paid' | 'failed' | 'refunded' | 'unmatched' | 'duplicate';

export type ProviderStatus = 'pending' | 'succeeded' | 'failed' | 'refunded';

export interface FirstSessionOrder {
  orderId: string;
  caseId: string;
  childId: string;
  amountMinor: typeof FIRST_SESSION_AMOUNT_MINOR;
  currency: typeof FIRST_SESSION_CURRENCY;
  purpose: 'first_session';
}

export interface ProviderTransaction {
  transactionId: string;
  status: ProviderStatus;
  amountMinor: number;
  currency: string;
  orderId?: string;
}

export interface VerifiedPaymentEvent {
  provider: 'green_invoice';
  providerAccountId: string;
  providerEventId: string;
  status: ProviderStatus;
  transactions: readonly ProviderTransaction[];
  orderId?: string;
  rawDigest: string;
  eventKey: string;
}

export interface ProviderReceiptInput {
  rawBody: string;
  headers: Readonly<Record<string, string | undefined>>;
  receivedAt: string;
}

export interface ReceiptAllocation {
  transactionId: string;
  orderId: string;
  childId: string;
  amountMinor: number;
}

export interface ProviderReceiptResult {
  receiptId: string;
  eventKey: string;
  state: PaymentState;
  allocations: readonly ReceiptAllocation[];
  reason?: string;
}

export interface StaffReceiptInput {
  caseId: string;
  childId: string;
  orderId: string;
  amountMinor: number;
  currency: typeof FIRST_SESSION_CURRENCY;
  method: 'cash' | 'bank_transfer';
  receivedAt: string;
  privateReference: string;
}

export interface StoredReceipt {
  receiptId: string;
  event: VerifiedPaymentEvent;
  receivedAt: string;
  state: PaymentState;
  allocations: readonly ReceiptAllocation[];
}

export interface ReceiptStore {
  findByEventKey(eventKey: string): Promise<StoredReceipt | undefined>;
  save(receipt: StoredReceipt): Promise<void>;
  findOrder(orderId: string): Promise<FirstSessionOrder | undefined>;
  hasTransactionAllocation(transactionId: string): Promise<boolean>;
  saveAllocation(allocation: ReceiptAllocation): Promise<void>;
}

export type AuthenticationResult =
  | { ok: true; event: VerifiedPaymentEvent }
  | { ok: false; reason: 'unauthenticated' | 'invalid' };
