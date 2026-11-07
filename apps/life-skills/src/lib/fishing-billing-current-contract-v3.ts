import {z} from 'zod';
import {familyOfferSchema} from '../features/fishing-billing/contracts.ts';
import {balanceV2Schema} from '../features/fishing-billing/contracts-v2.ts';
import {guestFamilyOfferSchema,guestBalanceV3Schema,guestPayableBasisSchema} from './fishing-billing-guest-contract-v3.ts';

/** Current read projection only, never a stored quote rewrite, payment grant or
 * complete historical operation result. Each source retains its real version. */
export const BILLING_CURRENT_LEDGER_V3='JLFA-FISHING-CURRENT-LEDGER-v3' as const;
export const currentLedgerSourceV3Schema=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('historical_account'),quote:familyOfferSchema}).strict(),
 z.object({kind:z.literal('guest_successor'),quote:guestFamilyOfferSchema}).strict(),
]);
export type CurrentLedgerSourceV3=z.infer<typeof currentLedgerSourceV3Schema>;
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
export const currentLedgerFrameV3Schema=z.object({
 version:z.literal(BILLING_CURRENT_LEDGER_V3),source:currentLedgerSourceV3Schema,
 payableBasis:guestPayableBasisSchema.nullable(),balance:z.union([balanceV2Schema,guestBalanceV3Schema]),
}).strict().superRefine((f,c)=>{
 const q=f.source.quote,b=f.balance,p=f.payableBasis,fail=()=>c.addIssue({code:'custom',message:'CURRENT_LEDGER_PROVENANCE'});
 if(b.version!==(f.source.kind==='historical_account'?balanceV2Schema.shape.version.value:guestBalanceV3Schema.shape.version.value)||q.id!==b.quoteId||q.familyId!==b.familyId||q.revision!==b.revision||q.paused!==b.paused||(q.state==='cancelled')!==b.cancelled||q.lines.length!==b.lines.length||new Set(b.lines.map(l=>l.lineId)).size!==b.lines.length)fail();
 for(const l of b.lines){const original=q.lines.find(m=>m.id===l.lineId);if(!original||original.childId!==l.childId||!same(original.period,l.period)||original.groupId!==l.groupId||original.amountMinor!==l.quotedMinor||original.dueAt!==l.dueAt)fail();}
 const ids=new Set(b.receipts.map(r=>r.id));
 if(b.receipts.length>1000||ids.size!==b.receipts.length||b.reminders.length>1000||new Set(b.reminders.map(r=>r.id)).size!==b.reminders.length||b.pendingAttemptIds.length>1000||new Set(b.pendingAttemptIds).size!==b.pendingAttemptIds.length)fail();
 for(const r of b.receipts)if(r.quoteId!==q.id||r.familyId!==q.familyId||r.allocations.some(a=>!q.lines.some(l=>l.id===a.lineId))||r.originalReceiptId!==null&&!ids.has(r.originalReceiptId))fail();
 if(!q.acceptance){if(p!==null)fail();}
 else if(!p)fail();
 else{
  const m=p.offer.material;
  if(p.workspaceId!==q.workspaceId||p.familyId!==q.familyId||p.quoteId!==q.id||p.acceptance.kind!==f.source.kind||m.createdAt!==q.createdAt||m.issuedAt!==q.issuedAt||!same(m.definition,q.definition)||!same(m.lines,q.lines)||!same(m.override,q.override))fail();
  if(f.source.kind==='guest_successor'){
   if(p.acceptance.kind!=='guest_successor'||!same(p.acceptance.evidence,f.source.quote.acceptance)||!same(p.offer,f.source.quote.acceptance?.offer))fail();
  }else if(p.acceptance.kind!=='historical_account'||p.acceptance.actorAccountId!==f.source.quote.acceptance?.actorId||p.acceptance.acceptedAt!==f.source.quote.acceptance?.acceptedAt||p.acceptance.quoteRevision!==f.source.quote.acceptance?.quoteRevision||!same(p.acceptance.terms,f.source.quote.acceptance?.terms))fail();
 }
 if(new TextEncoder().encode(JSON.stringify(f)).byteLength>4_100_000)fail();
});
export type CurrentLedgerFrameV3=z.infer<typeof currentLedgerFrameV3Schema>;
