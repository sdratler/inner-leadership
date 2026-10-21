import 'server-only';
import {readAcademyAgreementBundle,verifyAcademyAgreementAcceptance} from './academy-agreements.ts';
import {createHash} from 'node:crypto';
import {AppError} from '../../lib/errors.ts';
import type {IdentityStore} from '../identity/store.ts';
import {freshActor,lockWorkspace} from '../identity/data.ts';
import type {IdentityConfig} from '../identity/config.ts';
import {systemClock,type Actor,type IdentityClock} from '../identity/types.ts';
import {AcademyFamilyStore} from './academy-family-store.ts';
import {NativeFishingProgram} from './native-program.ts';
import {academyEnrollmentCommandSchema,type AcademyEnrollmentContext,type AcademyOwnerEnrollmentBinding} from './academy-enrollment-contract.ts';
const digest=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export class AcademyEnrollmentStore{
 constructor(private readonly db:IdentityStore,private readonly config:IdentityConfig,private readonly family:AcademyFamilyStore,private readonly clock:IdentityClock=systemClock){}
 private program(db:IdentityStore){return new NativeFishingProgram(db,this.config.keyring,{childAccountsEnabled:false,merchant:null},this.clock);}
 private async role(actor:Actor){if(actor.workspaceId!==this.config.workspaceId)throw new AppError('FORBIDDEN');return this.db.transaction(async tx=>{await lockWorkspace(tx,actor.workspaceId);const current=await freshActor(tx,actor,this.clock.now());if(!current.emailVerifiedAt)throw new AppError('UNAUTHENTICATED');if(!['practitioner','parent'].includes(current.role))throw new AppError('FORBIDDEN');return current.role;});}
 async ownerContext(actor:Actor,applicationId:string):Promise<AcademyEnrollmentContext>{
  if(await this.role(actor)!=='practitioner')throw new AppError('FORBIDDEN');const context=await this.family.context(actor,applicationId);if(context.state!=='ready'||!context.saved)return {state:'not_ready',reason:'family_setup_required'};
  const binding:AcademyOwnerEnrollmentBinding={applicationId,personId:context.personId,expectedEpoch:context.expectedEpoch,expectedAssociationVersion:context.expectedAssociationVersion,expectedFieldsDigest:context.fieldsDigest,expectedFamilyDigest:digest(context.saved)};
  return this.db.transaction(async tx=>{const saved=await this.family.readForEnrollmentInTransaction(tx,actor,binding),program=this.program(this.db),stages:Extract<AcademyEnrollmentContext,{role:'practitioner'}>['stages']={};
   for(const child of saved.children)stages[child.learnerId]=await program.enrollmentReviewInTransaction(tx,actor,{learnerId:child.learnerId,householdId:saved.householdId,parentAccountId:saved.parentAccountId});
   return {state:'ready',role:'practitioner',binding,children:saved.children,stages};
  });
 }
 async parentContext(actor:Actor,learnerId:string):Promise<AcademyEnrollmentContext>{
  if(await this.role(actor)!=='parent')throw new AppError('FORBIDDEN');return this.db.transaction(async tx=>{const family=await this.family.readParentForEnrollmentInTransaction(tx,actor,learnerId),stages=await this.program(this.db).enrollmentReviewInTransaction(tx,actor,family);return {state:'ready',role:'parent',learnerId,stages};});
 }
 async execute(actor:Actor,raw:unknown){
  const parsed=academyEnrollmentCommandSchema.safeParse(raw);if(!parsed.success)throw new AppError('INVALID_REQUEST');const command=parsed.data,role=await this.role(actor);if(command.action==='fit'?role!=='practitioner':role!=='parent')throw new AppError('FORBIDDEN');
  return this.db.transaction(async tx=>{
   // Reuse this exact transaction, adapter and real native authority. A nested
   // service transaction must not escape the family/source locks or mint facts.
   const bound:IdentityStore={transaction:work=>work(tx)},program=this.program(bound),sourceBindingSha256=digest(command);
   if(command.action==='fit'){
    const saved=await this.family.readForEnrollmentInTransaction(tx,actor,command.binding),child=saved.children.find(c=>c.learnerIndex===command.learnerIndex);if(!child)throw new AppError('INVALID_REQUEST');
    const current=(await program.enrollmentReviewInTransaction(tx,actor,{learnerId:child.learnerId,householdId:saved.householdId,parentAccountId:saved.parentAccountId})).find(s=>s.stageId===command.stageId);if(!current)throw new AppError('NOT_FOUND');
    return program.recordFit(actor,{commandId:command.operationId,id:command.operationId,stageId:command.stageId,learnerId:child.learnerId,purpose:'enrollment',decision:command.decision,targetOccurrenceId:null,targetRevision:null,note:command.note,sourceBindingSha256});
   }
   const family=await this.family.readParentForEnrollmentInTransaction(tx,actor,command.learnerId),current=(await program.enrollmentReviewInTransaction(tx,actor,family)).find(s=>s.stageId===command.stageId);
   if(!current||current.fit?.decision!=='approved')throw new AppError('NOT_FOUND');if(current.terms.state!=='available'||current.terms.sourceApprovalId!==command.sourceApprovalId||current.terms.sourceSha256!==command.sourceSha256||current.terms.termsVersion!==command.termsVersion)throw new AppError('CONFLICT');
   const bundle=readAcademyAgreementBundle(current.terms.owner03Bundle);if(!bundle)throw new AppError('UNAVAILABLE');
   try{verifyAcademyAgreementAcceptance(bundle,command.agreementAcceptance);}catch{throw new AppError('INVALID_REQUEST');}
   if(command.action==='block_terms'){
    if(current.monthly?.state!=='available')throw new AppError('UNAVAILABLE');
    return program.acceptMonthlyBlockTerms(actor,{commandId:command.operationId,id:command.operationId,blockId:command.blockId,stageId:command.stageId,learnerId:command.learnerId,householdId:family.householdId,sourceApprovalId:command.sourceApprovalId,sourceSha256:command.sourceSha256,expectedPlanRevision:command.expectedPlanRevision,occurrenceIds:command.occurrenceIds,currency:command.currency,priceCents:command.priceCents,purchasedLessons:command.purchasedLessons,automaticFutureCharges:command.automaticFutureCharges,agreementAcceptance:command.agreementAcceptance});
   }
   return program.acceptTerms(actor,{commandId:command.operationId,id:command.operationId,stageId:command.stageId,learnerId:command.learnerId,householdId:family.householdId,sourceApprovalId:command.sourceApprovalId,sourceSha256:command.sourceSha256,agreementAcceptance:command.agreementAcceptance,sourceBindingSha256});
  });
 }
}
