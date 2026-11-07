import {LEDGER_HISTORY_VERSION,ledgerHistoryPageSchema} from './history-contracts.ts';
import {syntheticAccepted,syntheticReceipt} from './fixtures.ts';
/** Synthetic history only; no totals-derived or provider-delivery claims. */
export function syntheticLedgerHistory(){
 const q=syntheticAccepted(),original=syntheticReceipt('cash',10,20000,510),reversal={...syntheticReceipt('cash',10,10000,511),kind:'cash_reversal' as const,originalReceiptId:original.id,reason:'SYNTHETIC correction'};
 return ledgerHistoryPageSchema.parse({version:LEDGER_HISTORY_VERSION,quoteId:q.id,familyId:q.familyId,asOfVersion:5,items:[original,reversal],nextCursor:null});
}
