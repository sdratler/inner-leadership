import {z} from 'zod';
import {billingId,ledgerReceiptSchema} from './contracts.ts';
export const LEDGER_HISTORY_VERSION='JLFA-FISHING-LEDGER-HISTORY-v1' as const;
export const ledgerHistoryQuerySchema=z.object({quoteId:billingId,cursor:z.string().min(1).max(3000).nullable(),limit:z.number().int().min(1).max(100)}).strict();
export const ledgerHistoryPageSchema=z.object({
 version:z.literal(LEDGER_HISTORY_VERSION),quoteId:billingId,familyId:billingId,
 asOfVersion:z.number().int().positive(),items:z.array(ledgerReceiptSchema).max(100),nextCursor:z.string().min(1).max(3000).nullable(),
}).strict();
export type LedgerHistoryPage=z.infer<typeof ledgerHistoryPageSchema>;
