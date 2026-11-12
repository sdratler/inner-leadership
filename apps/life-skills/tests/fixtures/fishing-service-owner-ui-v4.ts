/** Pure SYNTHETIC V4 DTOs only. No native/guardian/legal/resource/provider
 * admission, database, network, historic V3 record conversion or live proof. */
import {BILLING_SERVICE_V4,SERVICE_FINANCIAL_ACTION_V4,serviceFamilyOfferV4Schema} from '../../src/features/fishing-billing/guest-service-contract-v4.ts';
import {SERVICE_PLAN_V1} from '../../src/features/fishing-billing/service-plan-contract-v1.ts';
import {calculateLedger} from '../../src/features/fishing-billing/ledger-math.ts';
import {syntheticDefinition,syntheticId,syntheticWorkspace,syntheticFamily,syntheticOwner} from '../../src/features/fishing-billing/fixtures.ts';
import {serviceOwnerSnapshotV4Schema,type ServiceOwnerSnapshotV4} from '../../src/features/fishing-billing/guest-service-owner-financial-contract-v4.ts';
import {serviceMoneySnapshotV4} from '../../src/features/fishing-billing/guest-service-owner-money-contract-v4.ts';
import {ledgerReceiptV2Schema} from '../../src/features/fishing-billing/contracts-v2.ts';
import {ownerServiceReadV4Schema,type OwnerServiceOperationV4} from '../../src/lib/fishing-billing-owner-contract-v4.ts';

export const serviceUiIdV4=syntheticId;
export function serviceOwnerUiFixtureV4(){
 const ref={id:'SYNTHETIC-UNAPPROVED-UI-ONLY',sha256:'a'.repeat(64)},quoteId=syntheticId(7),groupId=syntheticId(91),definition=syntheticDefinition();
 const lines=[0,1].map(i=>({id:syntheticId(10+i),childId:syntheticId(20+i),groupId,amountMinor:65000,dueAt:'2035-01-05T22:00:00Z',
  period:{id:syntheticId(30+i),startsAt:`2035-02-0${5+i}T15:00:00Z`,endsAt:`2035-03-0${5+i}T15:00:00Z`,timeZone:'America/New_York'}}));
 const departure=(kind:'keys'|'local')=>({id:syntheticId(kind==='keys'?80:81),groupId,revision:1,digest:'b'.repeat(64),fields:{state:'scheduled',tripKind:kind,
  startsAt:`2035-02-${kind==='keys'?'18':'25'}T12:00:00Z`,endsAt:`2035-02-${kind==='keys'?'18':'25'}T23:00:00Z`,timeZone:'America/New_York',fullDay:true,
  childCapacity:10,venueSource:ref,capacitySource:ref,planningContext:{location:'SYNTHETIC site',details:'SYNTHETIC only, not operating permission'}}});
 const children=lines.map((line,i)=>({lineId:line.id,childId:line.childId,groupId,period:line.period,
  firstEligibleLesson:{workspaceId:syntheticWorkspace,familyId:syntheticFamily,childId:line.childId,groupId,id:syntheticId(100+i*10),revision:1,startsAt:line.period.startsAt,source:ref},
  keys:departure('keys'),local:departure('local'),groupSource:{revision:1,digest:'c'.repeat(64),location:'SYNTHETIC site',venueSource:ref},
  progression:{revision:1,digest:'d'.repeat(64),eligibleFrom:line.period.startsAt,readiness:'needs_foundation',evidence:null},
  weeklyLessons:[0,1,2,3].map(n=>{const start=new Date(Date.parse(line.period.startsAt)+n*7*86400000).toISOString();return {id:syntheticId(100+i*10+n),revision:1,digest:'e'.repeat(64),sequence:n+1,
   startsAt:start,endsAt:new Date(Date.parse(start)+7200000).toISOString(),weekIndex:n,weekStartsAt:start,weekEndsAt:new Date(Date.parse(start)+7*86400000).toISOString()};}),
  foundation:{basis:'planned_first_two',lessonIds:[syntheticId(100+i*10),syntheticId(101+i*10)],evidence:null}}));
 const financial={workspaceId:syntheticWorkspace,familyId:syntheticFamily,quoteId,issuedRevision:2,definition,lines,createdAt:'2035-01-02T15:00:00Z',issuedAt:'2035-01-02T15:01:00Z',override:null};
 const offer={sha256:'f'.repeat(64),material:{version:BILLING_SERVICE_V4,kind:'issued_service_financial_material',financial,
  schedule:{sourceDigest:'1'.repeat(64),snapshot:{version:SERVICE_PLAN_V1,classification:'prospective_schedule_not_reserved_paid_or_operating_approval',workspaceId:syntheticWorkspace,quoteId,quoteRevision:1,
   familyId:syntheticFamily,quoteBasisDigest:'2'.repeat(64),tripPlan:{revision:1,digest:'3'.repeat(64)},children}},
  policy:{kind:'custom_terms_document',cancellation:ref,weather:ref,renewal:ref,servicePeriod:ref,refundDisposition:'owner_review_under_exact_released_terms'}}};
 const acceptanceId=syntheticId(90),displayed={version:BILLING_SERVICE_V4,action:SERVICE_FINANCIAL_ACTION_V4,id:syntheticId(92),sha256:'4'.repeat(64),locale:'en',
  offerSnapshotSha256:offer.sha256,serviceSnapshotSha256:'5'.repeat(64),financialTerms:{source:definition.terms,displayedTextSha256:'6'.repeat(64),releaseEvidenceId:syntheticId(93)}};
 const quote=serviceFamilyOfferV4Schema.parse({version:BILLING_SERVICE_V4,id:quoteId,workspaceId:syntheticWorkspace,familyId:syntheticFamily,revision:3,state:'accepted',definition,lines,
  createdAt:financial.createdAt,issuedAt:financial.issuedAt,override:null,paused:false,offer,messageLocaleAtIssue:'en',
  acceptance:{version:BILLING_SERVICE_V4,kind:'service_guest_grant',action:SERVICE_FINANCIAL_ACTION_V4,id:acceptanceId,grantId:syntheticId(94),offer,displayed,
   parent:{submittedName:'SYNTHETIC parent',guardianAuthorityAttested:true,financialTermsAffirmed:true,serviceScheduleAffirmed:true,statementSha256:'7'.repeat(64),privateEvidenceId:acceptanceId},
   assuranceEvidenceId:syntheticId(95),operationId:syntheticId(96),acceptedAt:'2035-01-02T15:02:00Z',recurring:{kind:'one_time_only'},recurringPrivateEvidenceId:null}});
 const current=serviceOwnerSnapshotV4Schema.parse({version:BILLING_SERVICE_V4,quote,balance:{...calculateLedger(quote,[],[]),version:BILLING_SERVICE_V4},receiptId:null});
 const scope={workspaceId:syntheticWorkspace,actorId:syntheticOwner,quoteId,familyId:syntheticFamily,offerSha256:quote.offer.sha256};
 const cash:OwnerServiceOperationV4={action:'cash_date',command:{version:BILLING_SERVICE_V4,operationId:syntheticId(200),quoteId,expectedVersion:3,currency:'USD',amountMinor:20000,
  receivedPrecision:'date',receivedDate:'2035-01-05',timeZone:'America/New_York',allocations:[{lineId:quote.lines[0]!.id,amountMinor:20000}]}};
 return {current,scope,cash};
}
export function serviceOwnerConfirmedFixtureV4(operation:OwnerServiceOperationV4,before:ServiceOwnerSnapshotV4){
 const f=serviceOwnerUiFixtureV4(),q=before.quote,recordedAt='2035-01-06T15:00:00Z';
 const after=serviceFamilyOfferV4Schema.parse({...q,revision:q.revision+1,...(operation.action==='state'?{paused:operation.command.paused??q.paused,state:operation.command.cancel?'cancelled':q.state}:{})});
 const base={version:BILLING_SERVICE_V4,workspaceId:q.workspaceId,actorId:f.scope.actorId,operationId:operation.command.operationId,quoteId:q.id,familyId:q.familyId,
  offerSha256:q.offer.sha256,acceptanceId:q.acceptance?.id??null,recordedAt,replayed:false};
 if(operation.action==='state'){
  const current=serviceOwnerSnapshotV4Schema.parse({...before,quote:after,balance:{...calculateLedger(after,before.balance.receipts,[]),version:BILLING_SERVICE_V4}});
  return ownerServiceReadV4Schema.parse({version:BILLING_SERVICE_V4,state:'confirmed',operation,current,receipt:{...base,action:operation.command.action,
   before:{revision:q.revision,state:q.state,paused:q.paused},after:{revision:after.revision,state:after.state,paused:after.paused}}});
 }
 const cmd=operation.command,receipt=ledgerReceiptV2Schema.parse({id:syntheticId(500+after.revision),operationId:cmd.operationId,quoteId:q.id,familyId:q.familyId,kind:operation.action==='cash_date'?'cash':'cash_reversal',currency:'USD',
  amountMinor:cmd.amountMinor,allocations:cmd.allocations,actorId:f.scope.actorId,provider:null,recordedAt,
  ...(operation.action==='cash_date'?{originalReceiptId:null,reason:null,receivedPrecision:'date',receivedDate:operation.command.receivedDate,timeZone:operation.command.timeZone}:
   {originalReceiptId:operation.command.originalReceiptId,reason:operation.command.reason,receivedAt:recordedAt})});
 const current=serviceOwnerSnapshotV4Schema.parse({...before,quote:after,balance:{...calculateLedger(after,[...before.balance.receipts,receipt],[]),version:BILLING_SERVICE_V4},receiptId:receipt.id});
 return ownerServiceReadV4Schema.parse({version:BILLING_SERVICE_V4,state:'confirmed',operation,current,receipt:{...base,action:operation.action,entityVersion:after.revision,result:serviceMoneySnapshotV4(current,receipt.id)}});
}
