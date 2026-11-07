import {it,expect} from 'vitest';
import {cashCommandSchema,ledgerReceiptSchema} from '../../../src/features/fishing-billing/contracts.ts';
import {BILLING_DTO_V2,calendarDateSchema,dateCashReceiptSchema,cashDateCommandSchema,projectBalanceV2,newYorkDate} from '../../../src/features/fishing-billing/contracts-v2.ts';
import {syntheticAccepted,syntheticReceipt,syntheticId,syntheticOwner} from '../../../src/features/fishing-billing/fixtures.ts';
import {syntheticDateCashFixtures} from '../../../src/features/fishing-billing/fixtures-v2.ts';
function receipt(){return {id:syntheticId(601),operationId:syntheticId(602),quoteId:syntheticId(7),familyId:syntheticId(4),kind:'cash' as const,currency:'USD' as const,amountMinor:20000,allocations:[{lineId:syntheticId(10),amountMinor:20000}],actorId:syntheticOwner,provider:null,originalReceiptId:null,reason:null,receivedPrecision:'date' as const,receivedDate:'2035-01-05',timeZone:'America/New_York' as const,recordedAt:'2035-01-06T15:00:00Z'};}
it('records only the actual reported date plus zone and actual recorded-at, without a fabricated receipt time',()=>{
 const r=dateCashReceiptSchema.parse(receipt());expect(r).not.toHaveProperty('receivedAt');expect(r.receivedDate).toBe('2035-01-05');
 expect(()=>ledgerReceiptSchema.parse(r)).toThrow();expect(()=>dateCashReceiptSchema.parse({...r,receivedAt:'2035-01-05T00:00:00Z'})).toThrow();
});
it.each(['2035-02-29','2035-02-30','2035-13-01','0000-01-01','2035-1-5','2035-01-05T00:00Z'])('rejects invalid or invented calendar representation %s',d=>expect(calendarDateSchema.safeParse(d).success).toBe(false));
it('validates leap years and program-local winter/summer date boundaries',()=>{
 expect(calendarDateSchema.parse('2036-02-29')).toBe('2036-02-29');
 expect(newYorkDate('2035-01-07T00:30:00Z')).toBe('2035-01-06');expect(newYorkDate('2035-07-07T03:30:00Z')).toBe('2035-07-06');
 for(const [recordedAt,receivedDate] of [['2035-01-07T00:30:00Z','2035-01-07'],['2035-07-07T03:30:00Z','2035-07-07']])expect(()=>dateCashReceiptSchema.parse({...receipt(),recordedAt,receivedDate})).toThrow();
});
it('keeps v1 exact-instant commands strict and separates the explicit V2 date command',()=>{
 const r=receipt(),cmd={version:BILLING_DTO_V2,operationId:r.operationId,expectedVersion:3,quoteId:r.quoteId,currency:r.currency,amountMinor:r.amountMinor,allocations:r.allocations,receivedPrecision:r.receivedPrecision,receivedDate:r.receivedDate,timeZone:r.timeZone};
 expect(cashDateCommandSchema.parse(cmd)).not.toHaveProperty('receivedAt');expect(()=>cashCommandSchema.parse(cmd)).toThrow();
 expect(()=>cashDateCommandSchema.parse({...cmd,actorId:syntheticId(99)})).toThrow();
});
it('uses identical money math for mixed instant/date receipts and linked corrections, preserving original bytes',()=>{
 const q=syntheticAccepted(),instant=syntheticReceipt('cash',11,10000,603),date=receipt();
 const reversal={...syntheticReceipt('cash',10,5000,604),kind:'cash_reversal' as const,originalReceiptId:date.id,reason:'Synthetic correction'};
 const before=JSON.stringify(instant),b=projectBalanceV2(q,[instant,date,reversal]);
 expect(b).toMatchObject({version:BILLING_DTO_V2,paidMinor:25000,remainingMinor:105000,state:'partial'});
 expect(JSON.stringify(instant)).toBe(before);expect(b.receipts.find(r=>r.id===date.id)).not.toHaveProperty('receivedAt');
});
it('serializes complete V2 view/operation/history fixtures with the requested two-child arithmetic and distinct precisions',()=>{
 const f=JSON.parse(JSON.stringify(syntheticDateCashFixtures()));expect(f.syntheticOnly).toBe(true);
 expect(f.balance).toMatchObject({version:BILLING_DTO_V2,dueMinor:130000,paidMinor:85000,remainingMinor:45000});
 expect(f.history.items[0]).toHaveProperty('receivedAt');expect(f.history.items[1]).not.toHaveProperty('receivedAt');
 expect(f.operation.result.receiptId).toBe(f.history.items[1].id);expect(f.history.items[1].recordedAt).toBe('2035-01-06T15:00:00Z');
});
