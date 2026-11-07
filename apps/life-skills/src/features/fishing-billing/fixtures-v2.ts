import {
 BILLING_DTO_V2,dateCashReceiptSchema,projectBalanceV2,operationReceiptV2Schema,ledgerHistoryV2Schema,
} from './contracts-v2.ts';
import {syntheticAccepted,syntheticReceipt,syntheticId,syntheticOwner} from './fixtures.ts';
/** SYNTHETIC ONLY. Dates, identity and policy references are not defaults. */
export function syntheticDateCashFixtures(){
 const quote={...syntheticAccepted(),revision:5};
 const exact=syntheticReceipt('card',10,65000,650);
 const date=dateCashReceiptSchema.parse({
  id:syntheticId(651),operationId:syntheticId(652),quoteId:quote.id,familyId:quote.familyId,kind:'cash',currency:'USD',
  amountMinor:20000,allocations:[{lineId:quote.lines[1]!.id,amountMinor:20000}],actorId:syntheticOwner,provider:null,reason:null,originalReceiptId:null,
  receivedPrecision:'date',receivedDate:'2035-01-05',timeZone:'America/New_York',recordedAt:'2035-01-06T15:00:00Z',
 });
 const balance=projectBalanceV2(quote,[exact,date]);
 return {version:BILLING_DTO_V2,syntheticOnly:true as const,quote,balance,
  operation:operationReceiptV2Schema.parse({version:BILLING_DTO_V2,sourceVersion:BILLING_DTO_V2,operationId:date.operationId,entityId:quote.id,entityVersion:quote.revision,replayed:false,result:{quote,balance,receiptId:date.id}}),
  history:ledgerHistoryV2Schema.parse({version:'JLFA-FISHING-LEDGER-HISTORY-v2',quoteId:quote.id,familyId:quote.familyId,asOfVersion:quote.revision,items:[exact,date],nextCursor:null}),
 };
}
