import 'server-only';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {AppError} from '../../lib/errors.ts';
import {asId} from '../../lib/ids.ts';
import {digest} from '../fishing-payments/domain.ts';
import {lockWorkspace} from '../identity/data.ts';
import type {IdentityStore,SqlSession} from '../identity/store.ts';
import {systemClock,type Actor,type IdentityClock} from '../identity/types.ts';
import type {AcademyRefundExecutionAuthority} from './academy-refund-execution-authority.ts';
import {AcademyRefundExecutionJournal} from './academy-refund-execution-store.ts';
import {AcademyRefundExecutionLedger,refundExecutionRequest} from './academy-refund-execution-ledger.ts';
import {academyRefundExecutionVersion,refundExecutionBatchSchema,refundExecutionCommandSchema,refundExecutionClaimSchema,refundExecutionObservationSchema,validateRefundExecutionObservation,refundExecutionState,type RefundExecutionBatch,type RefundExecutionClaim,type RefundExecutionMember,type RefundExecutionObservation} from './academy-refund-execution-contract.ts';

const reservationSchema=z.strictObject({command:refundExecutionCommandSchema,batchId:z.uuid()});
/** No real provider implementation/capability. Disposable tests inject this
 * synthetic transport; production mounting and real financial effects remain
 * separately held. Read accepts ONLY a durably saved exact refund ID. */
export interface SyntheticRefundExecutionTransport{
 readonly execution:'synthetic';
 create(batch:RefundExecutionBatch,member:RefundExecutionMember):Promise<RefundExecutionObservation>;
 read(providerObjectId:string,batch:RefundExecutionBatch,member:RefundExecutionMember):Promise<RefundExecutionObservation>;
}
/** Workspace-serialized native recovery. UNKNOWN and its global one-dispatch
 * fence commit BEFORE external I/O. A lost create response without a saved ID
 * stops automatically: no search, recreate, new key, or second create. */
export class AcademyRefundExecutionCoordinator{
 private readonly ledger:AcademyRefundExecutionLedger;
 constructor(private readonly db:IdentityStore,private readonly journal:AcademyRefundExecutionJournal,private readonly authority:AcademyRefundExecutionAuthority,private readonly clock:IdentityClock=systemClock){this.ledger=new AcademyRefundExecutionLedger(journal);}
 private async transaction<T>(actor:Actor,work:(tx:SqlSession)=>Promise<T>){return this.db.transaction(async tx=>{await lockWorkspace(tx,actor.workspaceId);await this.authority.owner(tx,actor);return work(tx);});}
 private async batch(tx:SqlSession,workspace:string,id:string){const batch=await this.journal.read(tx,workspace,'owner03.refund.batch',z.uuid().parse(id),refundExecutionBatchSchema);if(!batch||batch.workspaceId!==workspace)throw new AppError('NOT_FOUND');return batch;}
 private member(batch:RefundExecutionBatch,id:string){const member=batch.members.find(m=>m.operationId===id);if(!member)throw new AppError('NOT_FOUND');return member;}
 async reserve(actor:Actor,raw:unknown){const command=refundExecutionCommandSchema.parse(raw);return this.transaction(actor,async tx=>{
  const old=await this.journal.read(tx,actor.workspaceId,'owner03.refund.preparation',command.preparationId,reservationSchema),cached=await this.journal.read(tx,actor.workspaceId,'owner03.refund.command',command.commandId,reservationSchema);
  if(old||cached){if(!old||!cached||digest(old)!==digest(cached)||digest(old.command)!==digest(command))throw new AppError('CONFLICT');const batch=await this.batch(tx,actor.workspaceId,old.batchId);await this.authority.dispatch(tx,actor,batch,this.clock.now());return batch;}
  if(await this.journal.read(tx,actor.workspaceId,'owner03.refund.batch',command.id,refundExecutionBatchSchema))throw new AppError('CONFLICT');
  const now=this.clock.now(),{saved,effectDecision}=await this.authority.initial(tx,actor,command.preparationId,command.expectedReviewSha256,now),members:RefundExecutionMember[]=[];
  for(const p of saved.facts.members)members.push({operationId:randomUUID(),purchaseId:p.input.purchase.purchaseId,childId:p.input.purchase.childId,purchaseLineId:p.input.purchase.purchaseLineId,dueId:await this.ledger.due(tx,actor.workspaceId,p),originalPaymentId:p.originalPayment.paymentId,amountCents:p.refundCents});
  const batch=refundExecutionBatchSchema.parse({version:academyRefundExecutionVersion,id:command.id,workspaceId:actor.workspaceId,ownerId:actor.id,preparationId:saved.preparationId,preparationReviewSha256:saved.reviewSha256,preparationRequestSha256:saved.requestSha256,preparationCiphertextSha256:saved.ciphertextSha256,preparedFacts:saved.facts,effectDecision,createdAt:now.toISOString(),members});
  await this.journal.append(tx,actor,now,'owner03.refund.batch',batch.id,batch,refundExecutionBatchSchema);for(const member of batch.members)await this.ledger.reserve(tx,batch,member);
  const reservation={command,batchId:batch.id};await this.journal.append(tx,actor,now,'owner03.refund.preparation',command.preparationId,reservation,reservationSchema);await this.journal.append(tx,actor,now,'owner03.refund.command',command.commandId,reservation,reservationSchema);await this.authority.dispatch(tx,actor,batch,now);return batch;
 });}
 async claim(actor:Actor,batchId:string,operationId:string){return this.transaction(actor,async tx=>{
  const batch=await this.batch(tx,actor.workspaceId,batchId);await this.authority.dispatch(tx,actor,batch,this.clock.now());const member=this.member(batch,operationId),state=await this.ledger.verify(tx,batch,member);if(state.consumed||state.observation)return null;if(state.claim)return state.claim;
  const claim=refundExecutionClaimSchema.parse({id:randomUUID(),batchId:batch.id,operationId:member.operationId,requestSha256:refundExecutionRequest(batch,member),decisionId:batch.effectDecision.id,decisionRevision:batch.effectDecision.revision,claimedAt:this.clock.now().toISOString()});await this.journal.append(tx,actor,this.clock.now(),'owner03.refund.claim',member.operationId,claim,refundExecutionClaimSchema);await this.ledger.unknown(tx,batch,member);return claim;
 });}
 async consume(actor:Actor,raw:RefundExecutionClaim){const claim=refundExecutionClaimSchema.parse(raw);return this.transaction(actor,async tx=>{
  const batch=await this.batch(tx,actor.workspaceId,claim.batchId);await this.authority.dispatch(tx,actor,batch,this.clock.now());const member=this.member(batch,claim.operationId),state=await this.ledger.verify(tx,batch,member);if(!state.claim||digest(state.claim)!==digest(claim))throw new AppError('CONFLICT');if(state.consumed||state.observation)return false;
  if(!await this.journal.consumeDispatch(tx,actor.workspaceId,member.operationId,this.clock.now()))throw new AppError('CONFLICT');await this.journal.append(tx,actor,this.clock.now(),'owner03.refund.consumed',member.operationId,claim,refundExecutionClaimSchema);return true;
 });}
 /** Persist a consumed response even after session/guardian revocation. The
  * opaque immutable claim is matched to the encrypted journal; it grants no
  * read, new effect, native settlement or browser capability. */
 async observe(workspaceId:string,rawClaim:RefundExecutionClaim,raw:unknown){const claim=refundExecutionClaimSchema.parse(rawClaim);return this.db.transaction(async tx=>{
  await lockWorkspace(tx,asId(z.uuid().parse(workspaceId),'workspace'));const batch=await this.batch(tx,workspaceId,claim.batchId),member=this.member(batch,claim.operationId),state=await this.ledger.verify(tx,batch,member);if(!state.consumed||digest(state.consumed)!==digest(claim))throw new AppError('CONFLICT');const now=this.clock.now(),observation=validateRefundExecutionObservation(raw,batch,member,now,state.observation?.providerObjectId??null);
  if(state.observation&&state.observation.status!=='pending'&&observation.status!==state.observation.status)throw new AppError('CONFLICT');const action=`owner03.refund.observed_${observation.status}`,old=await this.journal.read(tx,workspaceId,action,member.operationId,refundExecutionObservationSchema);
  if(old){if(digest({...old,observedAt:observation.observedAt})!==digest(observation))throw new AppError('CONFLICT');return old;}
  await this.journal.append(tx,{id:batch.ownerId,workspaceId},now,action,member.operationId,observation,refundExecutionObservationSchema);await this.ledger.confirm(tx,batch,member,observation);return observation;
 });}
 async inspect(actor:Actor,batchId:string){return this.transaction(actor,async tx=>{const batch=await this.batch(tx,actor.workspaceId,batchId),settled=await this.authority.settlement(tx,actor,batch);const members=[];
  for(const member of batch.members){const state=await this.ledger.verify(tx,batch,member);members.push({operationId:member.operationId,purchaseId:member.purchaseId,providerObjectId:state.observation?.providerObjectId??null,state:refundExecutionState(state.observation,!!state.claim,settled[member.operationId]===true)});}return {batch,members};
 });}
 async dispatchSynthetic(actor:Actor,batchId:string,operationId:string,transport:SyntheticRefundExecutionTransport){if(transport.execution!=='synthetic')throw new AppError('UNAVAILABLE');const claim=await this.claim(actor,batchId,operationId);if(!claim||!await this.consume(actor,claim))return this.inspect(actor,batchId);const {batch}=await this.inspect(actor,batchId),member=this.member(batch,operationId);const observation=await transport.create(batch,member);await this.observe(actor.workspaceId,claim,observation);return this.inspect(actor,batchId);}
 async reconcileSynthetic(actor:Actor,batchId:string,operationId:string,transport:SyntheticRefundExecutionTransport){if(transport.execution!=='synthetic')throw new AppError('UNAVAILABLE');const known=await this.transaction(actor,async tx=>{const batch=await this.batch(tx,actor.workspaceId,batchId);await this.authority.history(tx,actor,batch);const member=this.member(batch,operationId),state=await this.ledger.verify(tx,batch,member);return {batch,member,...state};});
  if(!known.observation||!known.consumed)return this.inspect(actor,batchId);const observation=await transport.read(known.observation.providerObjectId,known.batch,known.member);await this.observe(actor.workspaceId,known.consumed,observation);return this.inspect(actor,batchId);
 }
 /** Unmounted financial-owner reconciliation step. Existing verified native
  * customer/invoice/PI mappings are mandatory; no inferred bindings are added. */
 async mapKnownRefund(actor:Actor,batchId:string,operationId:string){return this.transaction(actor,async tx=>{const batch=await this.batch(tx,actor.workspaceId,batchId),member=this.member(batch,operationId),merchant=await this.authority.merchant(tx,actor,batch);await this.ledger.mapKnownRefund(tx,batch,member,merchant,this.clock.now());});}
}
