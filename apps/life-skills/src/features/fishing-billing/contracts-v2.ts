import {z} from 'zod';
import {
 BILLING_DTO_VERSION,ledgerReceiptSchema,balanceSchema,operationReceiptSchema,cashCommandSchema,reversalCommandSchema,familyOfferSchema,
 type LedgerReceipt,type FamilyOffer,
} from './contracts.ts';
import {ledgerHistoryPageSchema} from './history-contracts.ts';
import {calculateLedger} from './ledger-math.ts';
import {requireBilling} from './billing-errors.ts';
export const BILLING_DTO_V2='JLFA-FISHING-BILLING-DTO-v2' as const;
export const calendarDateSchema=z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/).refine(value=>{
 const instant=Date.parse(value+'T00:00:00Z');
 return Number.isFinite(instant)&&new Date(instant).getUTCFullYear()>=1&&new Date(instant).toISOString().slice(0,10)===value;
},'INVALID_CALENDAR_DATE');
/** Calendar validation above uses UTC only to validate the Gregorian date. It
 * is never recorded/displayed as an actual receipt instant. */
export function newYorkDate(instant:string):string{
 const at=new Date(instant);requireBilling(Number.isFinite(at.valueOf()));
 const parts=new Intl.DateTimeFormat('en',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(at);
 const get=(type:string)=>parts.find(p=>p.type===type)!.value;
 return get('year').padStart(4,'0')+'-'+get('month')+'-'+get('day');
}
const dateShape=z.object({
 ...ledgerReceiptSchema.shape,kind:z.literal('cash'),actorId:ledgerReceiptSchema.shape.id,
 provider:z.null(),originalReceiptId:z.null(),reason:z.null(),
 receivedPrecision:z.literal('date'),receivedDate:calendarDateSchema,timeZone:z.literal('America/New_York'),
}).omit({receivedAt:true}).strict();
export const dateCashReceiptSchema=dateShape.superRefine((r,c)=>{
 const fail=(message:string)=>c.addIssue({code:'custom',message});
 if(new Set(r.allocations.map(a=>a.lineId)).size!==r.allocations.length)fail('DUPLICATE_ALLOCATION');
 if(r.allocations.length===0||r.allocations.reduce((s,a)=>s+a.amountMinor,0)>r.amountMinor)fail('ALLOCATION_TOTAL');
 if(r.receivedDate>newYorkDate(r.recordedAt))fail('RECEIVED_DATE_IN_FUTURE');
});
export type DateCashReceipt=z.infer<typeof dateCashReceiptSchema>;
/** Old instant receipts remain byte-for-byte/read-semantics compatible. */
export const ledgerReceiptV2Schema=z.union([ledgerReceiptSchema,dateCashReceiptSchema]);
export type LedgerReceiptV2=z.infer<typeof ledgerReceiptV2Schema>;
export const balanceV2Schema=balanceSchema.extend({version:z.literal(BILLING_DTO_V2),receipts:z.array(ledgerReceiptV2Schema)});
export type BillingBalanceV2=z.infer<typeof balanceV2Schema>;
export const cashDateCommandSchema=cashCommandSchema.omit({receivedAt:true}).extend({
 version:z.literal(BILLING_DTO_V2),receivedPrecision:z.literal('date'),receivedDate:calendarDateSchema,
 timeZone:z.literal('America/New_York'),
}).strict();
export const operationReceiptV2Schema=operationReceiptSchema.extend({
 version:z.literal(BILLING_DTO_V2),sourceVersion:z.enum([BILLING_DTO_VERSION,BILLING_DTO_V2]),result:operationReceiptSchema.shape.result.extend({balance:balanceV2Schema}),
});
export const reversalCommandV2Schema=reversalCommandSchema.extend({version:z.literal(BILLING_DTO_V2)});
export const ledgerHistoryV2Schema=ledgerHistoryPageSchema.extend({
 version:z.literal('JLFA-FISHING-LEDGER-HISTORY-v2'),items:z.array(ledgerReceiptV2Schema).max(100),
});
export function projectBalanceV2(input:FamilyOffer,raw:readonly LedgerReceiptV2[],pending:string[]=[]):BillingBalanceV2{
 const q=familyOfferSchema.parse(input),receipts=raw.map(r=>ledgerReceiptV2Schema.parse(r));
 for(const r of receipts){
  requireBilling(!!q.acceptance);
  if('receivedAt' in r)requireBilling(['card','refund','dispute'].includes(r.kind)?
   Math.floor(Date.parse(r.receivedAt)/1000)>=Math.floor(Date.parse(q.acceptance!.acceptedAt)/1000):
   Date.parse(r.receivedAt)>=Date.parse(q.acceptance!.acceptedAt));
  else requireBilling(r.receivedDate>=newYorkDate(q.acceptance!.acceptedAt));
 }
 return balanceV2Schema.parse({...calculateLedger(q,receipts,pending),version:BILLING_DTO_V2});
}
export function validateDateCash(q:FamilyOffer,old:readonly LedgerReceiptV2[],raw:DateCashReceipt):DateCashReceipt{
 const r=dateCashReceiptSchema.parse(raw),b=projectBalanceV2(q,old);
 requireBilling(q.state==='accepted'&&r.quoteId===q.id&&r.familyId===q.familyId);
 requireBilling(r.allocations.every(a=>a.amountMinor<=(b.lines.find(l=>l.lineId===a.lineId)?.remainingMinor??0)));
 projectBalanceV2(q,[...old,r]);return r;
}
export function upgradeOperationReceipt(raw:unknown){
 const v1=operationReceiptSchema.safeParse(raw);
 if(v1.success)return operationReceiptV2Schema.parse({...v1.data,version:BILLING_DTO_V2,sourceVersion:BILLING_DTO_VERSION,
  result:{...v1.data.result,balance:{...v1.data.result.balance,version:BILLING_DTO_V2}}});
 return operationReceiptV2Schema.parse(raw);
}
export type LegacyInstantReceipt=LedgerReceipt;
