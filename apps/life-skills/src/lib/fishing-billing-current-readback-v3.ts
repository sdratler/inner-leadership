import 'server-only';
import {AppError} from './errors.ts';
import {unseal,type Keyring} from '../features/identity/crypto.ts';
import {familyOfferSchema,acceptanceCommandSchema,operationReceiptSchema,billingId,type FamilyOffer} from '../features/fishing-billing/contracts.ts';
import {commandRecordSchema,type BillingLedgerContext} from '../features/fishing-billing/native.ts';
import {verifyGuestFamilyOffer} from './fishing-billing-guest-material-v3.ts';
import {currentLedgerSourceV3Schema,type CurrentLedgerSourceV3} from './fishing-billing-current-contract-v3.ts';
import {requireHistoricalAcceptedOriginalV3} from './fishing-billing-current-ledger-v3.ts';

function fact(v:unknown):asserts v{if(!v)throw new AppError('UNAVAILABLE');}
const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
function instant(v:unknown){const n=v instanceof Date?v.valueOf():typeof v==='string'?Date.parse(v):NaN;fact(Number.isFinite(n));return n;}
export type CurrentBillingQuoteRowV3=Readonly<{id:string;familyId:string;definitionId:string;revision:number;createdAt:unknown;ciphertext:string}>;

/** Fixed, exhaustive authentication of BOTH registered AADs; exactly one may
 * authenticate. No caller format flag, parse-after-failure fallback or stored
 * conversion. A valid AAD with a wrong schema fails, not a retry as the other
 * source. The caller reads the row in its real current-authorized transaction. */
export function decodeBillingCurrentQuoteV3(workspaceId:string,quoteId:string,row:CurrentBillingQuoteRowV3,ring:Keyring):CurrentLedgerSourceV3{
 try{
  billingId.parse(workspaceId);billingId.parse(quoteId);fact(row.id===quoteId);
  const matches:{kind:CurrentLedgerSourceV3['kind'];plain:string}[]=[];
  for(const [kind,aad] of [['historical_account','ls_fishing_billing/v1/quote/'],['guest_successor','ls_fishing_billing/guest/v3/quote/']] as const){
   try{matches.push({kind,plain:unseal(row.ciphertext,aad+workspaceId+'/'+quoteId,ring)});}catch{/* Complete both authentication attempts, never infer a default source. */}
  }
  fact(matches.length===1);const match=matches[0]!,raw:unknown=JSON.parse(match.plain);
  const source:CurrentLedgerSourceV3=match.kind==='historical_account'?{kind:match.kind,quote:familyOfferSchema.parse(raw)}:{kind:match.kind,quote:verifyGuestFamilyOffer(raw)},q=source.quote;
  fact(q.id===row.id&&q.workspaceId===workspaceId&&q.familyId===row.familyId&&q.definition.id===row.definitionId&&q.revision===row.revision&&instant(q.createdAt)===instant(row.createdAt));
  return currentLedgerSourceV3Schema.parse(source);
 }catch{throw new AppError('UNAVAILABLE');}
}

/** Read-only original historical financial witness, NOT an owner operation
 * lookup or a parent session. Caller authenticates current owner/service and
 * current family/children/source before AND after this same-TX read. The actual
 * original parent actor is retained; no parent impersonation or guest grant.
 * digest must be the existing Native store's constructor-owned digest closure.
 * Actual envelope schema is accessed at call time to keep the Native import
 * cycle safe; there is no competing journal schema/hash recipe here. */
export async function readHistoricalFinancialOriginalV3(context:BillingLedgerContext,rawQuote:unknown,ring:Keyring,digest:(command:ReturnType<typeof acceptanceCommandSchema.parse>)=>string):Promise<FamilyOffer|null>{
 const {tx,workspaceId}=context;
 try{
  const q=familyOfferSchema.parse(rawQuote);fact(q.workspaceId===workspaceId);
  const obligations=await tx.query<{lineId:string;familyId:string;childId:string;periodId:string;startsAt:unknown;endsAt:unknown}>('SELECT line_id AS "lineId",family_id AS "familyId",child_id AS "childId",period_id AS "periodId",starts_at AS "startsAt",ends_at AS "endsAt" FROM ls_fishing_billing.obligations WHERE workspace_id=$1 AND quote_id=$2 LIMIT 11',[workspaceId,q.id]);
  const rows=await tx.query<{operationId:string;actorId:string;action:string;quoteId:string;digest:string;ciphertext:string;createdAt:unknown}>('SELECT operation_id AS "operationId",actor_id AS "actorId",action,quote_id AS "quoteId",request_digest AS digest,result_ciphertext AS ciphertext,created_at AS "createdAt" FROM ls_fishing_billing.commands WHERE workspace_id=$1 AND quote_id=$2 AND action=\'accept\' ORDER BY operation_id LIMIT 2',[workspaceId,q.id]);
  if(!q.acceptance){fact(rows.length===0&&obligations.length===0);return null;}
  fact(obligations.length===q.lines.length&&new Set(obligations.map(o=>o.lineId)).size===obligations.length&&q.lines.every(l=>obligations.some(o=>o.lineId===l.id&&o.familyId===q.familyId&&o.childId===l.childId&&o.periodId===l.period.id&&instant(o.startsAt)===instant(l.period.startsAt)&&instant(o.endsAt)===instant(l.period.endsAt))));
  fact(rows.length===1);const row=rows[0]!,record=commandRecordSchema.parse(JSON.parse(unseal(row.ciphertext,'ls_fishing_billing/v1/command/'+workspaceId+'/'+row.operationId,ring))),r=operationReceiptSchema.parse(record.result),original=requireHistoricalAcceptedOriginalV3(q,r.result.quote),a=q.acceptance;
  const command=acceptanceCommandSchema.parse({operationId:row.operationId,expectedVersion:a.quoteRevision,quoteId:q.id,terms:a.terms,acknowledged:true}),expectedDigest=digest(command);
  fact(/^[a-f0-9]{64}$/.test(expectedDigest)&&record.workspaceId===workspaceId&&record.operationId===row.operationId&&record.actorId===row.actorId&&row.actorId===a.actorId&&record.action==='accept'&&row.action==='accept'&&record.quoteId===q.id&&row.quoteId===q.id&&record.digest===row.digest&&record.digest===expectedDigest&&instant(row.createdAt)===instant(a.acceptedAt));
  fact(r.operationId===row.operationId&&r.entityId===q.id&&r.entityVersion===original.revision&&!r.replayed&&r.result.receiptId===null&&r.result.balance.quoteId===q.id&&r.result.balance.familyId===q.familyId&&r.result.balance.revision===original.revision);
  fact(r.result.balance.lines.length===original.lines.length&&original.lines.every(l=>r.result.balance.lines.some(b=>b.lineId===l.id&&b.childId===l.childId&&equal(b.period,l.period)&&b.groupId===l.groupId&&b.quotedMinor===l.amountMinor&&b.dueAt===l.dueAt)));
  return original;
 }catch{throw new AppError('UNAVAILABLE');}
}
