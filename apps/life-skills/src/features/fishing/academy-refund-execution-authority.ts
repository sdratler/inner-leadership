import 'server-only';
import {z} from 'zod';
import {AppError} from '../../lib/errors.ts';
import {digest} from '../fishing-payments/domain.ts';
import type {Actor} from '../identity/types.ts';
import type {SqlSession} from '../identity/store.ts';
import type {NativeFishingProgram} from './native-program.ts';
import type {AcademyRefundPreparationStore} from './academy-refund-preparation-store.ts';
import type {RefundExecutionBatch} from './academy-refund-execution-contract.ts';

const decision=z.strictObject({id:z.string().regex(/^[A-Za-z0-9_.:-]{1,160}$/),revision:z.string().regex(/^[a-f0-9]{64}$/),expiresAt:z.iso.datetime({offset:true})});
/** Server composition must supply a separately admitted financial-effect
 * decision loader. Preparation/checkbox/merchant labels cannot supply it.
 * There is deliberately no default implementation or environment fallback. */
export interface RefundExecutionEffectPolicy{
 load(tx:SqlSession,actor:Actor,preparationId:string,reviewSha256:string,now:Date):Promise<RefundExecutionBatch['effectDecision']|null>;
}
export class AcademyRefundExecutionAuthority{
 constructor(private readonly program:NativeFishingProgram,private readonly preparation:AcademyRefundPreparationStore,private readonly policy:RefundExecutionEffectPolicy|null=null){}
 async owner(tx:SqlSession,actor:Actor){await this.program.assertRefundPreparationOwnerInTransaction(tx,actor);}
 private async effect(tx:SqlSession,actor:Actor,preparationId:string,reviewSha256:string,now:Date){
  const raw=await this.policy?.load(tx,actor,preparationId,reviewSha256,now);if(!raw)throw new AppError('UNAVAILABLE');const parsed=decision.parse(raw);if(!Number.isFinite(now.valueOf())||Date.parse(parsed.expiresAt)<=now.valueOf())throw new AppError('FORBIDDEN');return parsed;
 }
 async initial(tx:SqlSession,actor:Actor,preparationId:string,reviewSha256:string,now:Date){
  await this.owner(tx,actor);const saved=await this.preparation.currentExecutionSnapshotInTransaction(tx,actor,preparationId);if(saved.reviewSha256!==reviewSha256)throw new AppError('CONFLICT');return {saved,effectDecision:await this.effect(tx,actor,preparationId,reviewSha256,now)};
 }
 /** Financial-owner historical readback is separate from permission to send.
  * It can retain/reconcile a known object after guardian/source revocation or
  * effect expiry. It never allows another create or changes native cash. */
 async history(tx:SqlSession,actor:Actor,batch:RefundExecutionBatch){
  await this.owner(tx,actor);if(batch.workspaceId!==actor.workspaceId||batch.ownerId!==actor.id)throw new AppError('FORBIDDEN');const saved=await this.preparation.historicalExecutionSnapshotInTransaction(tx,actor,batch.preparationId);
  if(saved.ownerId!==batch.ownerId||saved.requestSha256!==batch.preparationRequestSha256||saved.reviewSha256!==batch.preparationReviewSha256||saved.ciphertextSha256!==batch.preparationCiphertextSha256||digest(saved.facts)!==digest(batch.preparedFacts))throw new AppError('CONFLICT');
 }
 async dispatch(tx:SqlSession,actor:Actor,batch:RefundExecutionBatch,now:Date){
  await this.history(tx,actor,batch);const current=await this.program.owner03RefundExecutionContinuationInTransaction(tx,actor,batch.id);if(digest(current)!==digest(batch)||digest(await this.effect(tx,actor,batch.preparationId,batch.preparationReviewSha256,now))!==digest(batch.effectDecision))throw new AppError('CONFLICT');
 }
 async settlement(tx:SqlSession,actor:Actor,batch:RefundExecutionBatch){await this.history(tx,actor,batch);return this.program.owner03RefundExecutionSettlementInTransaction(tx,actor,batch.id);}
 async merchant(tx:SqlSession,actor:Actor,batch:RefundExecutionBatch){await this.history(tx,actor,batch);return this.program.owner03RefundExecutionMerchantInTransaction(tx,actor,batch.id);}
}
