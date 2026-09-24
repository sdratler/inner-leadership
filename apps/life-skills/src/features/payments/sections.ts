export type PaymentSection = 'overview' | 'awaiting' | 'paid' | 'credits' | 'refunds' | 'full';

export function paymentSection(value: string | undefined, embedded: boolean): PaymentSection {
  if (!embedded) return 'full';
  return value === 'awaiting' || value === 'paid' || value === 'credits' || value === 'refunds'
    ? value
    : 'overview';
}

export function paymentVisiblePanels(section: PaymentSection) {
  return {
    balance: section === 'full' || section === 'overview' || section === 'credits',
    charges: section === 'full' || section === 'overview' || section === 'awaiting',
    received: section === 'full' || section === 'overview' || section === 'paid',
    history: section === 'full' || section === 'overview' || section === 'credits' || section === 'refunds',
    newCharge: section === 'full' || section === 'awaiting',
    recordPayment: section === 'full' || section === 'paid',
    allocatePayment: section === 'full' || section === 'awaiting',
    refundCredit: section === 'full' || section === 'refunds',
  } as const;
}
