import 'server-only';
import {createHash} from 'node:crypto';
import {AppError} from '../../lib/errors.ts';
import {freshActor,lockWorkspace} from '../identity/data.ts';
import type {IdentityStore,SqlSession} from '../identity/store.ts';
import type {IdentityConfig} from '../identity/config.ts';
import {systemClock,type Actor,type IdentityClock} from '../identity/types.ts';
import {AcademyFamilyStore} from './academy-family-store.ts';
import {NativeFishingProgram} from './native-program.ts';
import {FishingPaymentStore} from '../fishing-payments/store.ts';
import {FishingPaymentService} from '../fishing-payments/service.ts';
import type {MerchantBinding} from '../fishing-payments/domain.ts';
import {academyBillingCommandSchema,type AcademyBillingContext,type AcademyBillingQuery} from './academy-billing-contract.ts';
const digest=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
type Family={learnerId:string;householdId:string;parentAccountId:string};
/** Root supplies a separately verified server merchant, never request/env
 * claims. Null means native read-only. This class has no provider transport. */
export class AcademyBillingStore{
 constructor(private readonly db:IdentityStore,private readonly config:IdentityConfig,private readonly family:AcademyFamilyStore,private readonly merchant:MerchantBinding|null=null,private readonly clock:IdentityClock=systemClock){}
 private services(tx:SqlSession){const db:IdentityStore={transaction:work=>work(tx)},program=new NativeFishingProgram(db,this.config.keyring,{childAccountsEnabled:false,merchant:this.merchant},this.clock),authority=program.paymentApprovalAuthority(),store=new FishingPaymentStore({database:db,clock:this.clock,merchant:this.merchant,authority:{...authority,withdrawalFacts:async()=>{throw new AppError('UNAVAILABLE');},reminderPolicy:async()=>{throw new AppError('UNAVAILABLE');}}});return {program,store,service:new FishingPaymentService(store)};}
 private admitted(){return this.merchant!==null&&this.merchant.livemode===false&&this.merchant.apiVersion==='2026-09-30.endive'&&!!this.merchant.verifiedBindingId;}
 private async actor(tx:SqlSession,actor:Actor,role:'practitioner'|'parent'){if(actor.workspaceId!==this.config.workspaceId)throw new AppError('FORBIDDEN');await lockWorkspace(tx,actor.workspaceId);const current=await freshActor(tx,actor,this.clock.now());if(current.role!==role)throw new AppError('FORBIDDEN');}
 private async bills(tx:SqlSession,actor:Actor,family:Family,stageId:string){
  const {store,service}=this.services(tx),rows=await tx.query<{id:string}>(`SELECT DISTINCT p.id FROM ls_fishing_payments.purchases p JOIN ls_fishing_stage.seat_reservations s ON s.workspace_id=p.workspace_id AND s.offer_id=p.offer_id WHERE p.workspace_id=$1 AND s.learner_id=$2 AND s.stage_id=$3 AND s.state<>'released' ORDER BY p.id LIMIT 101`,[actor.workspaceId,family.learnerId,stageId]);if(rows.length>100)throw new AppError('UNAVAILABLE');
  const payments:Extract<AcademyBillingContext,{state:'ready'}>['payments']=[],actions:Extract<AcademyBillingContext,{state:'ready'}>['actions']=[];let links:Extract<AcademyBillingContext,{state:'ready'}>['links']=this.admitted()?'ready':'not_admitted';
  for(const row of rows){const p=await store.read(actor,c=>store.purchase(c,row.id)),line=p.line;if(line.learnerId!==family.learnerId||line.stageId!==stageId||p.offer.householdId!==family.householdId||p.offer.payerAccountId!==family.parentAccountId)continue;const payment=await store.familyView(actor,row.id);payments.push(payment);if(payment.state==='reconciliation_required'){links='review_required';continue;}
   if(actor.role!=='parent'||!this.admitted())continue;
   const operations=await tx.query<{id:string}>("SELECT id FROM ls_fishing_payments.operations WHERE workspace_id=$1 AND purchase_id=$2 AND kind='hosted_invoice' ORDER BY id LIMIT 4",[actor.workspaceId,row.id]);if(operations.length>3)throw new AppError('UNAVAILABLE');
   for(const op of operations){try{const action=await service.familyHostedAction(actor,op.id);if(action)actions.push(action);}catch{links='review_required';}}
  }
  return {payments,actions,links};
 }
 async context(actor:Actor,query:AcademyBillingQuery):Promise<AcademyBillingContext>{
  if(query.view==='parent')return this.db.transaction(async tx=>{await this.actor(tx,actor,'parent');const family=await this.family.readParentForEnrollmentInTransaction(tx,actor,query.learnerId),bills=await this.bills(tx,actor,family,query.stageId);await this.family.readParentForEnrollmentInTransaction(tx,actor,query.learnerId);return {state:'ready',role:'parent',learnerId:query.learnerId,stageId:query.stageId,...bills};});
  if(actor.role!=='practitioner')throw new AppError('FORBIDDEN');const source=await this.family.context(actor,query.applicationId);if(source.state!=='ready'||!source.saved)return {state:'not_ready'};
  const binding={applicationId:query.applicationId,personId:source.personId,expectedEpoch:source.expectedEpoch,expectedAssociationVersion:source.expectedAssociationVersion,expectedFieldsDigest:source.fieldsDigest,expectedFamilyDigest:digest(source.saved)};
  return this.db.transaction(async tx=>{await this.actor(tx,actor,'practitioner');const saved=await this.family.readForEnrollmentInTransaction(tx,actor,binding),child=saved.children.find(c=>c.learnerIndex===query.learnerIndex);if(!child)throw new AppError('NOT_FOUND');const family={learnerId:child.learnerId,householdId:saved.householdId,parentAccountId:saved.parentAccountId},native=await this.services(tx).program.academyOfferContextInTransaction(tx,actor,family,query.stageId),bills=await this.bills(tx,actor,family,query.stageId);return {state:'ready',role:'practitioner',binding,learnerIndex:query.learnerIndex,stageId:query.stageId,offer:native.offer,issuance:this.admitted()?'ready':'not_admitted',...bills};});
 }
 async execute(actor:Actor,raw:unknown){
  const parsed=academyBillingCommandSchema.safeParse(raw);if(!parsed.success)throw new AppError('INVALID_REQUEST');const command=parsed.data;
  return this.db.transaction(async tx=>{await this.actor(tx,actor,'practitioner');if(!this.admitted())throw new AppError('UNAVAILABLE');const {program,store}=this.services(tx);
   const authorize=async()=>{const saved=await this.family.readForEnrollmentInTransaction(tx,actor,command.binding),child=saved.children.find(c=>c.learnerIndex===command.learnerIndex);if(!child)throw new AppError('NOT_FOUND');const offer=await program.paymentApprovalAuthority().loadApprovedOffer(tx,actor,command.offerId);if(!offer||offer.revision!==command.expectedOfferRevision||offer.householdId!==saved.householdId||offer.payerAccountId!==saved.parentAccountId||offer.lines.length!==1||offer.lines[0]?.learnerId!==child.learnerId||offer.lines[0]?.stageId!==command.stageId)throw new AppError('CONFLICT');};
   return store.command(actor,command.operationId,'academy.offer.issue',command,authorize,async()=>store.registerApprovedOffer(actor,command.operationId,command.offerId,command.expectedOfferRevision));
  });
 }
}
