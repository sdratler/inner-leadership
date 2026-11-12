import 'server-only';
import {AppError} from '../../lib/errors.ts';
import {bindServiceIssuedMaterialV4,verifyServiceFinancialDraftV4,verifyServiceOfferBindingV4,verifyServiceFinancialAcceptanceV4} from './guest-service-material-v4.ts';
import {canonical} from '../contact-ops/core/validation.ts';
import {BILLING_SERVICE_V4,serviceFamilyOfferV4Schema,type ServiceFamilyOfferV4} from './guest-service-contract-v4.ts';
import {calculateLedger} from './ledger-math.ts';
import {ledgerReceiptV2Schema,newYorkDate,type LedgerReceiptV2} from './contracts-v2.ts';
import {serviceBalanceV4Schema} from './guest-service-owner-financial-contract-v4.ts';

/** Actual native issuer supplies its freshly read pristine basis and own time.
 * No historical issued/accepted quote is converted; no signature, debt, hold,
 * send or legal authority is created by this pure state recipe. */
export function issueServiceFinancialOfferV4(raw:unknown,expectedVersion:number,issuedAt:string,locale:'en'|'he'):ServiceFamilyOfferV4{
 const draft=verifyServiceFinancialDraftV4(raw),q=draft.material.basis;
 if(q.revision!==expectedVersion||q.state!=='draft'||q.paused||q.acceptance!==null||q.issuedAt!==null)throw new AppError('CONFLICT');
 if(Object.values(q.definition.policies).some(ref=>ref===null)||q.lines.some(line=>line.dueAt===null))throw new AppError('UNAVAILABLE');
 if(draft.material.schedule.snapshot.children.some(child=>[...child.weeklyLessons,child.keys.fields,child.local.fields].some(activity=>Date.parse(activity.startsAt)<=Date.parse(issuedAt))))throw new AppError('CONFLICT');
 const offer=bindServiceIssuedMaterialV4(draft,issuedAt);
 return serviceFamilyOfferV4Schema.parse({version:BILLING_SERVICE_V4,id:q.id,workspaceId:q.workspaceId,familyId:q.familyId,revision:expectedVersion+1,state:'issued',
  definition:q.definition,lines:q.lines,createdAt:q.createdAt,issuedAt:offer.material.financial.issuedAt,override:q.override,acceptance:null,paused:false,offer,messageLocaleAtIssue:locale});
}
export function verifyServiceFamilyOfferV4(raw:unknown){
 const q=serviceFamilyOfferV4Schema.parse(raw);verifyServiceOfferBindingV4(q.offer);return q;
}
/** Pure transition only. Genuine grant/current/display authority and atomic
 * encrypted evidence/obligation persistence belong to the native consumer. */
export function acceptServiceFinancialOfferV4(raw:unknown,expectedRevision:number,evidence:unknown,presentation:unknown,recurringPresentation:unknown|null):ServiceFamilyOfferV4{
 const q=verifyServiceFamilyOfferV4(raw),a=verifyServiceFinancialAcceptanceV4(evidence,presentation,recurringPresentation);
 if(q.state!=='issued'||q.paused||q.acceptance!==null||q.revision!==expectedRevision||q.revision<q.offer.material.financial.issuedRevision||canonical(a.offer)!==canonical(q.offer))throw new AppError('CONFLICT');
 if(q.offer.material.schedule.snapshot.children.some(child=>[...child.weeklyLessons,child.keys.fields,child.local.fields].some(activity=>Date.parse(activity.startsAt)<=Date.parse(a.acceptedAt))))throw new AppError('CONFLICT');
 return serviceFamilyOfferV4Schema.parse({...q,state:'accepted',revision:q.revision+1,acceptance:a});
}
/** ONE existing money calculator; this only validates the explicit V4 source
 * and existing receipt precision. Native callers authenticate original consent
 * and actual stored financial rows before asking for a current projection. */
export function projectServiceBalanceV4(raw:unknown,rawReceipts:readonly LedgerReceiptV2[],pendingAttemptIds:string[]=[]){
 const q=verifyServiceFamilyOfferV4(raw),receipts=rawReceipts.map(r=>ledgerReceiptV2Schema.parse(r)),byId=new Map(receipts.map(r=>[r.id,r]));
 for(const r of receipts){
  if(!q.acceptance||Date.parse(r.recordedAt)<Date.parse(q.acceptance.acceptedAt))throw new AppError('UNAVAILABLE');
  const at=q.acceptance.acceptedAt;
  if('receivedAt' in r){const from=Date.parse(r.receivedAt),accepted=Date.parse(at);
   if(['card','refund','dispute'].includes(r.kind)?Math.floor(from/1000)<Math.floor(accepted/1000):from<accepted)throw new AppError('UNAVAILABLE');
  }else if(r.receivedDate<newYorkDate(at))throw new AppError('UNAVAILABLE');
  if(r.originalReceiptId){const original=byId.get(r.originalReceiptId);if(original){
   if(Date.parse(r.recordedAt)<Date.parse(original.recordedAt))throw new AppError('UNAVAILABLE');
   if('receivedAt' in r&&('receivedAt' in original?Date.parse(r.receivedAt)<Date.parse(original.receivedAt):newYorkDate(r.receivedAt)<original.receivedDate))throw new AppError('UNAVAILABLE');
  }}
 }
 return serviceBalanceV4Schema.parse({...calculateLedger(q,receipts,pendingAttemptIds),version:BILLING_SERVICE_V4});
}
