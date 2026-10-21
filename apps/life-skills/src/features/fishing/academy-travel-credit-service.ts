import 'server-only';
import {randomUUID} from 'node:crypto';
import {AppError} from '../../lib/errors.ts';
import {lockWorkspace} from '../identity/data.ts';
import type {IdentityConfig} from '../identity/config.ts';
import {systemClock,type Actor,type IdentityClock} from '../identity/types.ts';
import {one,type IdentityStore,type SqlSession} from '../identity/store.ts';
import type {MerchantBinding} from '../fishing-payments/domain.ts';
import {PublicGroupApplicationStore} from '../group-application/store.ts';
import {NativeFishingStageStore} from '../fishing-stage/native-store.ts';
import {AcademySessionPolicyNativeService} from '../fishing-stage/academy-session-policy-native.ts';
import {AcademySessionCreditStore,sameAcademyAnchor} from '../fishing-stage/academy-session-credit-store.ts';
import type {StageState} from '../fishing-stage/contract.ts';
import {NativeFishingProgram} from './native-program.ts';
import {FishingProgramError} from './native-program-contract.ts';
import {academyPolicyPreflightVersion} from './academy-policy-preflight-contract.ts';
import {academyTravelCompatibilityVersion,type AcademySessionCreditNativeFactsV3,type AcademySessionCreditRecord} from './academy-session-policy-native-contract.ts';
import type {AcademyOriginalObligation} from './academy-original-obligation-contract.ts';
import {AcademyTravelCreditStore} from './academy-travel-credit-store.ts';
import {readTravelActivity,readTravelEquivalence,travelDigest} from './academy-travel-credit-source.ts';
import {academyTravelCreditVersion,travelSelectionSchema,travelChangeCommandSchema,travelDeclarationCommandSchema,travelChangeRecordSchema,travelDeclarationRecordSchema,travelCreditFrameSchema,travelLogisticsSchema,
 type TravelActivityBinding,type TravelChangeRecord,type TravelDeclarationRecord,type TravelCommandReceipt,type TravelCreditFrame,type TravelNoticeProvenance} from './academy-travel-credit-contract.ts';

type Selection=ReturnType<typeof travelSelectionSchema.parse>;
function requireFact(value:unknown,code:'CONFLICT'|'FORBIDDEN'|'NOT_FOUND'|'UNAVAILABLE'='CONFLICT'):asserts value{if(!value)throw new AppError(code);}
const clean=(error:unknown):never=>{if(error instanceof AppError)throw error;if(error instanceof FishingProgramError)throw new AppError(error.code==='POLICY_REQUIRED'||error.code==='APPROVAL_REQUIRED'||error.code==='CAPACITY'?'CONFLICT':error.code);if(error&&typeof error==='object'&&'code'in error&&['23505','40001','40P01'].includes(String(error.code)))throw new AppError('CONFLICT');throw new AppError('UNAVAILABLE');};
/** One native composition. The default actual merchant remains null; it is not
 * discovered from env, a request, source text or a synthetic binding marker. */
export class AcademyTravelCreditService{
 private program:NativeFishingProgram;
 constructor(private db:IdentityStore,private config:IdentityConfig,private merchant:MerchantBinding|null=null,private clock:IdentityClock=systemClock){
  this.program=new NativeFishingProgram(db,config.keyring,{childAccountsEnabled:config.childAccountsEnabled===true,merchant},clock);
 }
 private async transaction<T>(actor:Actor,work:(tx:SqlSession)=>Promise<T>):Promise<T>{try{return await this.db.transaction(async tx=>{requireFact(actor.workspaceId===this.config.workspaceId,'FORBIDDEN');await lockWorkspace(tx,actor.workspaceId);return work(tx);});}catch(error){return clean(error);}}
 private selected(tx:SqlSession,actor:Actor,selection:Selection){return this.program.readSessionCreditSelectionInTransaction(tx,actor,selection);}
 private inquiry(tx:SqlSession,actor:Actor,learnerId:string){return new PublicGroupApplicationStore(this.db,this.config.workspaceId,this.config.keyring,this.config.lookupKey.toString('hex'),this.clock).readAcademyParentDriveInTransaction(tx,actor,learnerId);}
 private activity(tx:SqlSession,selected:Awaited<ReturnType<AcademyTravelCreditService['selected']>>){return readTravelActivity(tx,this.config.keyring,{workspaceId:selected.plan.workspaceId,templateApprovalId:selected.templateApprovalId,templateSourceSha256:selected.plan.template.sourceSha256,moduleId:selected.original.moduleId,moduleVersion:selected.original.moduleVersion},this.clock.now());}
 private async lifecycle(tx:SqlSession,obligation:AcademyOriginalObligation,activity:TravelActivityBinding|null){
  const d=obligation.delivery,tail=d.chain.at(-1)!;
  let state:'outstanding'|'replacement_reserved'|'delivered'|'review_required'=!activity?'review_required':d.state==='delivered'?'delivered':d.state==='review_required'?'review_required':d.chain.length>1?'replacement_reserved':'outstanding';
  if(d.reason==='replacement_activity_binding_required'&&activity){
   const cohort=await one<{templateApprovalId:string}>(tx,'SELECT template_approval_id AS "templateApprovalId" FROM ls_fishing_stage.cohorts WHERE workspace_id=$1 AND stage_id=$2 AND active FOR SHARE',[obligation.workspaceId,tail.stageId]);requireFact(cohort,'UNAVAILABLE');
   const replacement=await readTravelActivity(tx,this.config.keyring,{workspaceId:obligation.workspaceId,templateApprovalId:cohort.templateApprovalId,templateSourceSha256:tail.templateSourceSha256,moduleId:tail.moduleId,moduleVersion:tail.moduleVersion},this.clock.now());
   if(replacement&&await readTravelEquivalence(tx,this.config.keyring,activity,replacement,this.clock.now()))state='delivered';
  }
  const reservation=[...d.chain].reverse().find(s=>s.notice?.replacementReservationId)?.notice?.replacementReservationId??null;
  return {state,rootEntitlementId:d.rootEntitlementId,replacementReservationId:reservation,evidenceSha256:travelDigest({delivery:d,activityId:activity?.id??null,state})};
 }
 private async validatedChange(tx:SqlSession,actor:Actor,selection:Selection,change:TravelChangeRecord,current:boolean){
  const selected=await this.program.readSessionCreditChangeInTransaction(tx,actor,selection,{beforeStageRevision:change.before.stageRevision,changedStageRevision:change.changed.stageRevision,requireCurrent:current});
  requireFact(change.workspaceId===actor.workspaceId&&change.enrollmentId===selected.enrollment.id&&change.learnerId===selected.enrollment.learnerId&&change.stageId===selected.plan.stageId&&change.originalOccurrenceId===selected.original.id&&change.operatorId===selected.operatorId&&travelDigest(selected.change?.before)===travelDigest(change.before)&&travelDigest(selected.change?.changed)===travelDigest(change.changed));return selected;
 }
 private async frame(tx:SqlSession,actor:Actor,selection:Selection):Promise<TravelCreditFrame>{
  const selected=await this.program.readSessionCreditChangeInTransaction(tx,actor,selection),{plan,original,enrollment}=selected,store=new AcademyTravelCreditStore(tx,this.config.keyring),activity=await this.activity(tx,selected),archive=(await new AcademySessionCreditStore(tx,this.config.keyring).selected(actor.workspaceId,enrollment.id,enrollment.learnerId)).find(c=>c.anchor.occurrenceId===original.id)??null;
  const changes=await store.changes(actor.workspaceId,enrollment.id,original.id),change=changes.find(c=>selected.change&&travelDigest(c.before)===travelDigest(selected.change.before)&&travelDigest(c.changed)===travelDigest(selected.change.changed))??null;
  if(change)await this.validatedChange(tx,actor,selection,change,true);
  let maximum:number|null=null,declaration:TravelDeclarationRecord|null=null,responseOutcome:TravelCreditFrame['responseOutcome']=null,replacement:TravelCreditFrame['replacement']=null;
  if(actor.role==='parent'){
   const drive=await this.inquiry(tx,actor,enrollment.learnerId);requireFact(drive.householdId===enrollment.householdId&&drive.parentAccountId===actor.id,'FORBIDDEN');maximum=drive.maximumOneWayMinutes;
   if(change)declaration=(await store.declarations(actor.workspaceId,change.id)).find(d=>d.enrollmentId===enrollment.id&&d.learnerId===enrollment.learnerId&&d.parentAccountId===actor.id&&d.guardianSha256===selected.guardianSha256&&d.drivePreferenceSha256===drive.drivePreferenceDigest&&d.changeSha256===change.sha256)??null;
   if(declaration){const saved=await store.replay(actor.workspaceId,actor.id,declaration.command.operationId,declaration.command);requireFact(saved&&saved.declarationId===declaration.id&&saved.changeId===change?.id&&saved.outcome!=='change_recorded','UNAVAILABLE');responseOutcome=saved.outcome;}
  }
  let availability:TravelCreditFrame['availability']=!activity?'source_review_required':!change?'change_required':actor.role==='parent'&&!declaration?'guardian_response_required':'ready';
  let currentState:NonNullable<TravelCreditFrame['credit']>['state']='review_required';
  if(this.merchant){
   const obligation=await this.program.readSessionCreditObligationInTransaction(tx,actor,selection),notice=plan.makeups.find(m=>m.notice.enrollmentId===enrollment.id&&m.notice.occurrenceId===original.id)?.notice;
   const sourceMatches=activity!==null&&(!archive||notice?.travelCredit?.creditId===archive.id&&notice.travelCredit.activityBindingId===activity.id&&sameAcademyAnchor(archive.anchor,{workspaceId:actor.workspaceId,learnerId:enrollment.learnerId,cohortId:plan.cohortId,stageId:plan.stageId,occurrenceId:original.id,ordinal:original.ordinal,moduleId:original.moduleId,moduleVersion:original.moduleVersion,activityId:activity.activityId}));
   const life=await this.lifecycle(tx,obligation,sourceMatches?activity:null);currentState=life.state;
   if(obligation.payment.state!=='verified_fully_paid')availability='payment_review_required';else if(life.state==='review_required')availability='delivery_review_required';
   if(archive){requireFact(archive.enrollmentId===enrollment.id&&archive.purchaseId===obligation.purchaseId&&archive.purchaseLineId===obligation.purchaseLineId&&life.rootEntitlementId===archive.id,'UNAVAILABLE');if(life.state==='replacement_reserved'||life.state==='delivered')replacement=await this.program.readSessionCreditReplacementInTransaction(tx,actor,selection,archive.id);}
  }else availability='payment_review_required';
  const value=travelCreditFrameSchema.parse({version:academyTravelCreditVersion,selection,stageRevision:plan.revision,availability,originalOrdinal:original.ordinal,
   current:travelLogisticsSchema.parse({stageRevision:plan.revision,occurrenceRevision:original.revision,state:original.state,time:original.time,location:original.location,sha256:travelDigest({time:original.time,location:original.location,revision:original.revision})}),
   candidateChange:selected.change?{before:selected.change.before,changed:selected.change.changed}:null,
   change:change?{id:change.id,sha256:change.sha256,before:change.before,changed:change.changed,revisedOneWayMinutes:change.revisedOneWayMinutes}:null,recordedMaximumOneWayMinutes:maximum,
   declaration:declaration?{id:declaration.id,familyCannotAttend:declaration.familyCannotAttend}:null,responseOutcome,credit:archive?{id:archive.id,state:currentState}:null,replacement,
   mayRecordChange:actor.role==='practitioner'&&selected.change!==null,mayRespond:actor.role==='parent'&&change!==null&&activity!==null&&this.merchant!==null&&maximum!==null,specificDateOrSeatGuaranteed:false});
  await this.selected(tx,actor,selection);return value;
 }
 context(actor:Actor,raw:unknown){const selection=travelSelectionSchema.parse(raw);return this.transaction(actor,tx=>this.frame(tx,actor,selection));}
 async recordChange(actor:Actor,raw:unknown){
  const command=travelChangeCommandSchema.parse(raw);return this.transaction(actor,async tx=>{
   requireFact(actor.role==='practitioner','FORBIDDEN');const selected=await this.selected(tx,actor,command.selection),store=new AcademyTravelCreditStore(tx,this.config.keyring);
   const replay=await store.replay(actor.workspaceId,actor.id,command.operationId,command);
   if(replay){const old=await store.readChange(actor.workspaceId,replay.changeId);requireFact(old,'UNAVAILABLE');await this.validatedChange(tx,actor,command.selection,old,false);return {receipt:{...replay,replayed:true},current:await this.frame(tx,actor,command.selection)};}
   requireFact(selected.plan.revision===command.expectedStageRevision);const facts=await this.program.readSessionCreditChangeInTransaction(tx,actor,command.selection,command),change=facts.change;requireFact(change);
   const body={version:academyTravelCreditVersion,id:randomUUID(),workspaceId:actor.workspaceId,enrollmentId:selected.enrollment.id,learnerId:selected.enrollment.learnerId,stageId:selected.plan.stageId,originalOccurrenceId:selected.original.id,
    before:change.before,changed:change.changed,kind:change.kind,revisedOneWayMinutes:command.revisedOneWayMinutes,estimateReference:command.estimateReference,operatorId:actor.id,recordedAt:this.clock.now().toISOString(),command};
   const value=travelChangeRecordSchema.parse({...body,sha256:travelDigest(body)});await store.insertChange(value);
   const receipt:TravelCommandReceipt={version:academyTravelCreditVersion,operationId:command.operationId,changeId:value.id,declarationId:null,creditId:null,outcome:'change_recorded',stageRevision:selected.plan.revision,replayed:false};
   await store.record(actor.workspaceId,actor.id,command,receipt,this.clock.now());await this.validatedChange(tx,actor,command.selection,value,true);return {receipt,current:await this.frame(tx,actor,command.selection)};
  });
 }
 private async facts(tx:SqlSession,actor:Actor,selection:Selection,change:TravelChangeRecord,declaration:TravelDeclarationRecord):Promise<AcademySessionCreditNativeFactsV3>{
  const selected=await this.validatedChange(tx,actor,selection,change,true),drive=await this.inquiry(tx,actor,selected.enrollment.learnerId),activity=await this.activity(tx,selected);requireFact(activity,'UNAVAILABLE');
  requireFact(declaration.workspaceId===actor.workspaceId&&declaration.enrollmentId===selected.enrollment.id&&declaration.learnerId===selected.enrollment.learnerId&&declaration.parentAccountId===actor.id&&declaration.changeId===change.id&&declaration.changeSha256===change.sha256&&declaration.guardianSha256===selected.guardianSha256&&declaration.drivePreferenceSha256===drive.drivePreferenceDigest,'FORBIDDEN');
  const obligation=await this.program.readSessionCreditObligationInTransaction(tx,actor,selection),life=await this.lifecycle(tx,obligation,activity),o=obligation.original;
  const anchor={workspaceId:obligation.workspaceId,learnerId:obligation.learnerId,cohortId:o.cohortId,stageId:o.stageId,occurrenceId:o.occurrenceId,ordinal:o.ordinal,moduleId:o.moduleId,moduleVersion:o.moduleVersion,activityId:activity.activityId};
  requireFact(drive.householdId===obligation.householdId&&drive.parentAccountId===actor.id,'FORBIDDEN');
  let legacyCredit:AcademySessionCreditRecord|null=null;if(life.rootEntitlementId&&life.state!=='review_required'){legacyCredit={id:life.rootEntitlementId,anchor,enrollmentId:obligation.enrollmentId,purchaseId:obligation.purchaseId,purchaseLineId:obligation.purchaseLineId,state:life.state,replacementReservationId:life.replacementReservationId};}
  const delivery=obligation.payment.state!=='verified_fully_paid'||life.state==='review_required'?'unknown':life.state==='delivered'?'delivered':'purchased_undelivered';
  return {anchor,enrollmentId:obligation.enrollmentId,purchaseId:obligation.purchaseId,purchaseLineId:obligation.purchaseLineId,householdId:obligation.householdId,guardianBindingId:obligation.guardianDigest,acceptedTermsVersion:obligation.acceptedTermsVersion,
   inquiry:{workspaceId:drive.workspaceId,applicationId:drive.applicationId,fieldsDigest:drive.fieldsDigest,learnerIndex:drive.learnerIndex,drivePreferenceDigest:drive.drivePreferenceDigest},stageRevision:selected.plan.revision,sourceEvidenceId:declaration.id,evidenceRevision:1,evidenceDigest:travelDigest({obligation,drive,activity,change,declaration,life}),
   compatibility:{version:academyTravelCompatibilityVersion,originalStage:o.stage},nativeLifecycle:life,
   duration:{version:academyPolicyPreflightVersion,sessionKind:activity.sessionKind,time:selected.original.time},
   travel:{version:academyPolicyPreflightVersion,original:anchor,sessionKind:activity.sessionKind,obligation:{anchor,evidenceId:obligation.evidenceSha256,state:delivery},
    change:{anchor,kind:change.kind,evidenceId:declaration.id,weatherQualification:'unknown',recordedDriveLimit:drive.recordedDriveLimit,revisedOneWayMinutes:change.revisedOneWayMinutes,familyCannotAttend:declaration.familyCannotAttend}},legacyCredit};
 }
 private async bridge(tx:SqlSession,actor:Actor,selection:Selection,credit:AcademySessionCreditRecord,provenance:TravelNoticeProvenance,operationId:string){
  const selected=await this.selected(tx,actor,selection),bound:IdentityStore={transaction:work=>work(tx)},stage=new NativeFishingStageStore(bound,this.config.keyring,{actor,selection:{selectedEnrollmentId:selection.selectedEnrollmentId}},this.program.stageHooks(null),this.clock);
  await stage.transaction(async native=>{
   const c=await native.resolveFreshContext(actor,{cohortId:selected.plan.cohortId,stageId:selected.plan.stageId,stage:selected.plan.stage});requireFact(c,'FORBIDDEN');const state=await native.load(c);requireFact(state,'UNAVAILABLE');const before=structuredClone(state),next:StageState=structuredClone(state);
   const rows=next.makeups.filter(m=>m.notice.enrollmentId===selection.selectedEnrollmentId&&m.notice.occurrenceId===selection.originalOccurrenceId);requireFact(rows.length<=1);let m=rows[0];
   if(m){requireFact(m.notice.entitlementId===null||m.notice.entitlementId===credit.id);if(m.notice.travelCredit){requireFact(m.notice.travelCredit.creditId===credit.id&&m.notice.travelCredit.activityBindingId===provenance.activityBindingId);return;}
    m.notice={...m.notice,entitlementId:credit.id,travelCredit:provenance};
   }else{
    requireFact(selected.original.time.kind==='scheduled');m={notice:{id:randomUUID(),workspaceId:state.workspaceId,enrollmentId:selection.selectedEnrollmentId,occurrenceId:selection.originalOccurrenceId,originalOccurrenceRevision:selected.original.revision,originalStartsAt:selected.original.time.startsAt,receivedAt:this.clock.now().toISOString(),reason:'unavoidable',state:'protected',entitlementId:credit.id,replacementOccurrenceId:null,replacementReservationId:null,specificTripGuaranteed:false,policyVersion:state.policyVersion,sourceVersion:state.sourceVersion,travelCredit:provenance},requestedAt:null,decisionAt:null,decisionBy:null,decisionReason:null};next.makeups.push(m);
   }
   // Exact selected-notice delta. Generic native commit is not a parent-action
   // policy: compare every unrelated field and preserve operator decisions.
   const strip=(s:StageState)=>({...s,makeups:s.makeups.filter(v=>v.notice.enrollmentId!==selection.selectedEnrollmentId||v.notice.occurrenceId!==selection.originalOccurrenceId)});
   requireFact(travelDigest(strip(before))===travelDigest(strip(next)));
   const old=before.makeups.find(v=>v.notice.id===m!.notice.id);if(old){const restoredNotice={...m.notice,entitlementId:old.notice.entitlementId};delete restoredNotice.travelCredit;const restore={...m,notice:restoredNotice};requireFact(travelDigest(restore)===travelDigest(old));}
   next.revision=before.revision+1;await native.commit(c,next,before.revision,{digest:travelDigest({selection,provenance}),receipt:{operationId,stageRevision:next.revision,replayed:false}});
  });
 }
 async declare(actor:Actor,raw:unknown){
  const command=travelDeclarationCommandSchema.parse(raw);return this.transaction(actor,async tx=>{
   requireFact(actor.role==='parent','FORBIDDEN');const selected=await this.selected(tx,actor,command.selection),drive=await this.inquiry(tx,actor,selected.enrollment.learnerId),store=new AcademyTravelCreditStore(tx,this.config.keyring),change=await store.readChange(actor.workspaceId,command.changeId);requireFact(change,'NOT_FOUND');requireFact(change.sha256===command.changeSha256);
   const replay=await store.replay(actor.workspaceId,actor.id,command.operationId,command);
   if(replay){await this.validatedChange(tx,actor,command.selection,change,false);requireFact(await this.activity(tx,selected),'UNAVAILABLE');return {receipt:{...replay,replayed:true},current:await this.frame(tx,actor,command.selection)};}
   requireFact(this.merchant!==null,'UNAVAILABLE');await this.validatedChange(tx,actor,command.selection,change,true);
   const declaration=travelDeclarationRecordSchema.parse({version:academyTravelCreditVersion,id:randomUUID(),workspaceId:actor.workspaceId,enrollmentId:selected.enrollment.id,learnerId:selected.enrollment.learnerId,changeId:change.id,changeSha256:change.sha256,parentAccountId:actor.id,guardianSha256:selected.guardianSha256,drivePreferenceSha256:drive.drivePreferenceDigest,familyCannotAttend:command.familyCannotAttend,recordedAt:this.clock.now().toISOString(),command});
   await store.insertDeclaration(declaration);const initial=await this.facts(tx,actor,command.selection,change,declaration),bound:IdentityStore={transaction:work=>work(tx)};
   const core=new AcademySessionPolicyNativeService({database:bound,keyring:this.config.keyring,principal:actor,selection:{selectedEnrollmentId:selected.enrollment.id},clock:this.clock,authority:{
    resolveSelectedEnrollment:async sql=>{const current=await this.selected(sql,actor,command.selection);return {enrollmentId:current.enrollment.id,workspaceId:actor.workspaceId,learnerId:current.enrollment.learnerId};},
    resolveCreditFacts:sql=>this.facts(sql,actor,command.selection,change,declaration),
   }});
   const result=await core.execute({operationId:command.operationId,enrollmentId:selected.enrollment.id,originalOccurrenceId:selected.original.id,expectedStageRevision:initial.stageRevision,sourceEvidenceId:declaration.id,expectedEvidenceRevision:1});
   if(result.credit&&(result.outcome==='issued'||result.outcome==='retained')){
    requireFact(sameAcademyAnchor(result.credit.anchor,initial.anchor));const activity=await this.activity(tx,selected);requireFact(activity,'UNAVAILABLE');
    await this.bridge(tx,actor,command.selection,result.credit,{version:academyTravelCreditVersion,creditId:result.credit.id,changeId:change.id,declarationId:declaration.id,activityBindingId:activity.id,evidenceSha256:initial.evidenceDigest},command.operationId);
   }
   const after=await this.selected(tx,actor,command.selection),receipt:TravelCommandReceipt={version:academyTravelCreditVersion,operationId:command.operationId,changeId:change.id,declarationId:declaration.id,creditId:result.credit?.id??null,outcome:result.outcome,stageRevision:after.plan.revision,replayed:false};
   await store.record(actor.workspaceId,actor.id,command,receipt,this.clock.now());const current=await this.frame(tx,actor,command.selection);await this.selected(tx,actor,command.selection);return {receipt,current};
  });
 }
}
