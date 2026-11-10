import {z} from 'zod';
import {billingId} from './contracts.ts';
import {balanceV2Schema} from './contracts-v2.ts';
import {BILLING_SERVICE_V4,serviceFamilyOfferV4Schema} from './guest-service-contract-v4.ts';
/** Client-safe explicit V4 view, never a converted V3 acceptance/account. */
export const serviceBalanceV4Schema=balanceV2Schema.extend({version:z.literal(BILLING_SERVICE_V4)});
export type ServiceBalanceV4=z.infer<typeof serviceBalanceV4Schema>;
export const serviceOwnerSnapshotV4Schema=z.object({version:z.literal(BILLING_SERVICE_V4),quote:serviceFamilyOfferV4Schema,balance:serviceBalanceV4Schema,receiptId:billingId.nullable()}).strict().superRefine((v,c)=>{
 const q=v.quote,b=v.balance;
 if(q.id!==b.quoteId||q.familyId!==b.familyId||q.revision!==b.revision||q.paused!==b.paused||(q.state==='cancelled')!==b.cancelled||q.lines.length!==b.lines.length||
  new Set(b.lines.map(l=>l.lineId)).size!==b.lines.length||q.lines.some(l=>!b.lines.some(x=>x.lineId===l.id&&x.childId===l.childId&&x.period.id===l.period.id&&x.period.startsAt===l.period.startsAt&&x.period.endsAt===l.period.endsAt&&x.groupId===l.groupId&&x.quotedMinor===l.amountMinor&&x.dueAt===l.dueAt)))c.addIssue({code:'custom',message:'SERVICE_OWNER_BALANCE_SCOPE'});
});
export type ServiceOwnerSnapshotV4=z.infer<typeof serviceOwnerSnapshotV4Schema>;
