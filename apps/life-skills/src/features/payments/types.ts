import type { CaseId, Id } from '../../lib/ids.ts';
export type ChargeId=Id<'payment_charge'>;
export type PaymentId=Id<'payment'>;
export type AllocationId=Id<'payment_allocation'>;
export type CreditBlockId=Id<'credit_block'>;
export type CreditEventId=Id<'credit_event'>;
export type RefundId=Id<'payment_refund'>;
export type PaymentMethod='cash'|'bank_transfer';
export type CreditEventKind='purchase'|'consume'|'restore'|'refund';
export interface ChargeView {id:ChargeId;caseId:CaseId;kind:'four_appointment_block';amountMinor:220000;allocatedMinor:number;outstandingMinor:number;currency:'ILS';status:'open'|'paid';dueOn:string;createdAt:string;}
export interface PaymentView {id:PaymentId;caseId:CaseId;amountMinor:number;allocatedMinor:number;unallocatedMinor:number;currency:'ILS';method:PaymentMethod;receivedAt:string;recordedAt:string;}
export interface AllocationView {id:AllocationId;paymentId:PaymentId;chargeId:ChargeId;amountMinor:number;allocatedAt:string;}
export interface CreditBlockView {id:CreditBlockId;chargeId:ChargeId;creditsPurchased:4;purchaseAmountMinor:220000;termsVersion:'Product2.3';purchasedAt:string;remainingCredits:number;}
export interface CreditEventView {id:CreditEventId;blockId:CreditBlockId;kind:CreditEventKind;deltaCredits:number;valueMinor:number;appointmentId:string|null;rescheduleRequestId:string|null;reasonCode:string;occurredAt:string;}
export interface RefundView {id:RefundId;blockId:CreditBlockId;credits:number;amountMinor:number;recordedAt:string;}
export interface PaymentsOverview {caseId:CaseId;currency:'ILS';appointmentRateMinor:55000;blockPriceMinor:220000;creditsPerBlock:4;remainingCredits:number;remainingValueMinor:number;asOf:string;charges:ChargeView[];payments:PaymentView[];allocations:AllocationView[];blocks:CreditBlockView[];events:CreditEventView[];refunds:RefundView[];}
export interface NewPayment {caseId:CaseId;amountMinor:number;method:PaymentMethod;receivedAt:string;privateReference:string;}
export interface NewAllocation {caseId:CaseId;paymentId:PaymentId;chargeId:ChargeId;amountMinor:number;}
export interface NewRefund {caseId:CaseId;blockId:CreditBlockId;credits:number;reason:string;}
