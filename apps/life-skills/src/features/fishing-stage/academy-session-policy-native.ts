import "server-only";
import {randomUUID} from "node:crypto";
import {z} from "zod";
import {AppError} from "../../lib/errors.ts";
import {freshActor,lockWorkspace} from "../identity/data.ts";
import type {AccountFacts} from "../identity/types.ts";
import type {SqlSession} from "../identity/store.ts";
import {academySessionPolicyNativeVersion,type AcademySessionPolicyNativeDependencies,type AcademySessionPolicyNativeDependenciesV2,type AcademySessionCreditCommand,
 type AcademySessionCreditNativeContext,type AcademySessionCreditResolvedFacts,type AcademySessionCreditRecord,
 type AcademySessionCreditCommandResult,type AcademySessionCreditFamilySummary} from "../fishing/academy-session-policy-native-contract.ts";
import {academyFoundationPreparationPolicyVersion} from "../fishing/academy-policy-preflight-contract.ts";
import {assessAcademySessionDuration,assessAcademyTravelChange,assessAcademyTravelChangeWithRecordedMaximum,
 assessAcademyFoundationPreparationDuration} from "./academy-session-policy-preflight.ts";
import {AcademySessionCreditStore,academyCreditCommandSchema,academyCreditSelectionSchema,academyCreditResolvedFactsSchema,
 academyCreditDigest,sameAcademyAnchor,sameAcademyCredit} from "./academy-session-credit-store.ts";

const selectedSchema=z.strictObject({enrollmentId:z.uuid(),workspaceId:z.uuid(),learnerId:z.uuid()});
type Selected=z.infer<typeof selectedSchema>;
function fail():never{throw new AppError("CONFLICT");}
function checked<T>(schema:z.ZodType<T>,value:unknown,code:"INVALID_REQUEST"|"UNAVAILABLE"):T{
 const parsed=schema.safeParse(value);if(!parsed.success)throw new AppError(code);return parsed.data;
}
function result(outcome:AcademySessionCreditCommandResult["outcome"],reason:AcademySessionCreditCommandResult["reason"],credit:AcademySessionCreditRecord|null):AcademySessionCreditCommandResult{
 return {version:academySessionPolicyNativeVersion,outcome,reason,credit,replayed:false,mayBook:false,mayMarkDelivered:false,specificDateOrSeatGuaranteed:false};
}
function bound(record:AcademySessionCreditRecord,facts:AcademySessionCreditResolvedFacts):void{
 if(!sameAcademyAnchor(record.anchor,facts.anchor)||record.enrollmentId!==facts.enrollmentId||record.purchaseId!==facts.purchaseId||record.purchaseLineId!==facts.purchaseLineId)fail();
}
/** Classifiers supply reasons, never authority. This is called only after Root's
 * required resolver has verified the native obligation and all source bindings. */
function classify(facts:AcademySessionCreditResolvedFacts,credit:AcademySessionCreditRecord|null):AcademySessionCreditCommandResult{
 const existingCredit=credit?{anchor:credit.anchor,creditId:credit.id,state:credit.state}:null;
 const travel="compatibility" in facts?
  assessAcademyTravelChangeWithRecordedMaximum({...facts.travel,existingCredit}):
  assessAcademyTravelChange({...facts.travel,existingCredit});
 // A later change cannot erase an undelivered entitlement or its reservation.
 // Retention makes no claim that the replacement is ready to book or deliver.
 if(travel.status==="retain_existing_credit")return result("retained",travel.reason,credit);
 if(travel.status==="no_new_credit")return result("no_credit",travel.reason,credit);
 if(travel.status==="facts_required")return result("facts_required",travel.reason,credit);
 // Retained credits and cached legacy receipts keep their original identity.
 // A new grant cannot guess the original stage from a legacy envelope.
 if(!("compatibility" in facts))return result("facts_required","invalid_input",credit);
 const ordinal=facts.anchor.ordinal;
 const duration=facts.duration.sessionKind==="ordinary"&&facts.compatibility.originalStage===1&&(ordinal===1||ordinal===2)?
  assessAcademyFoundationPreparationDuration({version:academyFoundationPreparationPolicyVersion,sessionKind:"foundation_preparation",
   stage:1,originalOrdinal:ordinal,time:facts.duration.time}):assessAcademySessionDuration(facts.duration);
 if((duration.status!=="ordinary_duration_matches"&&duration.status!=="foundation_preparation_duration_matches")||facts.duration.time.timeZone!=="America/New_York")
  return result("facts_required",duration.status==="exception_review_required"?"separate_exception_terms":"invalid_input",credit);
 // This bounded slice issues only for ordinary venue/schedule travel changes.
 // A weather classification remains review-only; no exception terms are chosen.
 if(travel.reason!=="academy_change_exceeds_limit")return result("facts_required","weather_requires_review",credit);
 return result("issued",travel.reason,null);
}

/** Candidate service only: no route, mount, credentials, booking or database
 * discovery. Required authority is supplied by Root; there is no permissive
 * default. Even replay and private read use fresh identity and selected child. */
export class AcademySessionPolicyNativeService{
 private readonly dependencies:AcademySessionPolicyNativeDependencies|AcademySessionPolicyNativeDependenciesV2;
 constructor(dependencies:AcademySessionPolicyNativeDependencies|AcademySessionPolicyNativeDependenciesV2){
  if(!dependencies?.database||typeof dependencies.database.transaction!=="function"||!dependencies.authority||
   typeof dependencies.authority.resolveCreditFacts!=="function"||typeof dependencies.authority.resolveSelectedEnrollment!=="function"||
   !dependencies.clock||typeof dependencies.clock.now!=="function"||!dependencies.keyring)throw new AppError("UNAVAILABLE");
  const selection=checked(academyCreditSelectionSchema,dependencies.selection,"INVALID_REQUEST");
  if(!dependencies.principal||!z.uuid().safeParse(dependencies.principal.id).success||!z.uuid().safeParse(dependencies.principal.workspaceId).success||
   !z.uuid().safeParse(dependencies.principal.personId).success||!/^[a-f0-9]{64}$/.test(dependencies.principal.sessionDigest))throw new AppError("UNAUTHENTICATED");
  this.dependencies=Object.freeze({...dependencies,principal:Object.freeze({...dependencies.principal}),selection:Object.freeze(selection)});
 }
 private async context(tx:SqlSession):Promise<AcademySessionCreditNativeContext>{
  const d=this.dependencies,now=d.clock.now();if(!(now instanceof Date)||!Number.isFinite(now.valueOf()))throw new AppError("UNAVAILABLE");
  const row=await freshActor(tx,d.principal,now);
  if(row.id!==d.principal.id||row.workspaceId!==d.principal.workspaceId||row.personId!==d.principal.personId||row.role!==d.principal.role||
   !row.emailVerifiedAt||row.emailVerifiedAt>now||!["parent","practitioner"].includes(row.role))throw new AppError("FORBIDDEN");
  const actor:AccountFacts={id:row.id,workspaceId:row.workspaceId,personId:row.personId,role:row.role,state:row.state,locale:row.locale};
  return {actor:Object.freeze(actor),now:new Date(now),selection:d.selection};
 }
 private async selected(tx:SqlSession,c:AcademySessionCreditNativeContext):Promise<Selected>{
  const value=await this.dependencies.authority.resolveSelectedEnrollment(tx,c);if(value===null)throw new AppError("FORBIDDEN");
  const selected=checked(selectedSchema,value,"UNAVAILABLE");
  if(selected.workspaceId!==c.actor.workspaceId||selected.enrollmentId!==c.selection.selectedEnrollmentId)throw new AppError("FORBIDDEN");return selected;
 }
 private async facts(tx:SqlSession,c:AcademySessionCreditNativeContext,command:AcademySessionCreditCommand,selected:Selected):Promise<AcademySessionCreditResolvedFacts>{
  const value=await this.dependencies.authority.resolveCreditFacts(tx,c,command);if(value===null)throw new AppError("FORBIDDEN");
  const f=checked(academyCreditResolvedFactsSchema,value,"UNAVAILABLE"),a=f.anchor;
  if(f.enrollmentId!==selected.enrollmentId||a.workspaceId!==selected.workspaceId||a.learnerId!==selected.learnerId||f.inquiry.workspaceId!==a.workspaceId||
   a.occurrenceId!==command.originalOccurrenceId||f.stageRevision!==command.expectedStageRevision||f.sourceEvidenceId!==command.sourceEvidenceId||
   f.evidenceRevision!==command.expectedEvidenceRevision||f.travel.change.evidenceId!==f.sourceEvidenceId||
   !sameAcademyAnchor(a,f.travel.original)||!sameAcademyAnchor(a,f.travel.change.anchor)||
   f.travel.obligation&&!sameAcademyAnchor(a,f.travel.obligation.anchor)||f.duration.sessionKind!==f.travel.sessionKind)fail();
  if(f.legacyCredit)bound(f.legacyCredit,f);return f;
 }
 private async finish(tx:SqlSession,initial:AcademySessionCreditNativeContext,selected:Selected,command?:AcademySessionCreditCommand,facts?:AcademySessionCreditResolvedFacts):Promise<void>{
  const c=await this.context(tx),current=await this.selected(tx,c);
  if(academyCreditDigest(c.actor)!==academyCreditDigest(initial.actor)||academyCreditDigest(current)!==academyCreditDigest(selected))throw new AppError("FORBIDDEN");
  if(command&&facts&&academyCreditDigest(await this.facts(tx,c,command,current))!==academyCreditDigest(facts))fail();
 }
 private async transaction<T>(work:(tx:SqlSession)=>Promise<T>):Promise<T>{
  try{return await this.dependencies.database.transaction(async tx=>{
   await lockWorkspace(tx,this.dependencies.principal.workspaceId);return work(tx);
  });}catch(error){
   if(error instanceof AppError)throw error;
   if(typeof error==="object"&&error!==null&&"code" in error&&error.code==="23505")throw new AppError("CONFLICT");
   throw new AppError("UNAVAILABLE");
  }
 }
 async execute(raw:unknown):Promise<AcademySessionCreditCommandResult>{
  const command=checked(academyCreditCommandSchema,raw,"INVALID_REQUEST");
  if(command.enrollmentId!==this.dependencies.selection.selectedEnrollmentId)throw new AppError("FORBIDDEN");
  return this.transaction(async tx=>{
   const c=await this.context(tx),selected=await this.selected(tx,c),facts=await this.facts(tx,c,command,selected);
   const store=new AcademySessionCreditStore(tx,this.dependencies.keyring),stored=await store.byOriginal(facts.anchor),legacy=facts.legacyCredit;
   if(stored)bound(stored,facts);
   if(legacy){const used=await store.byId(c.actor.workspaceId,legacy.id);if(used&&!sameAcademyCredit(used,legacy)||stored&&!sameAcademyCredit(stored,legacy))fail();}
   // Contradictory delivered/outstanding claims are never silently reconciled.
   const existing=stored??legacy;
   if(existing&&((existing.state==="delivered")!==(facts.travel.obligation?.state==="delivered"))) {
    if(existing.state==="delivered"||facts.travel.obligation?.state==="delivered")fail();
   }
   const digest=academyCreditDigest({version:academySessionPolicyNativeVersion,workspaceId:c.actor.workspaceId,actorId:c.actor.id,selection:c.selection,command});
   // Native authority and all current bindings above precede cached receipts.
   const replay=await store.replay(c.actor.workspaceId,c.actor.id,command.operationId,digest,facts);
   if(replay){if(replay.credit&&(!stored||!sameAcademyCredit(replay.credit,stored)))fail();await this.finish(tx,c,selected,command,facts);return replay;}
   let outcome=classify(facts,existing);
   const evidenceId=await store.recordEvidence(facts,c.now);
   if(outcome.outcome==="issued"){
    const credit:AcademySessionCreditRecord={id:randomUUID(),anchor:facts.anchor,enrollmentId:facts.enrollmentId,purchaseId:facts.purchaseId,purchaseLineId:facts.purchaseLineId,state:"outstanding",replacementReservationId:null};
    await store.insert(credit,evidenceId,c.now);outcome={...outcome,credit};
   }else if(outcome.outcome==="retained"&&!stored&&legacy){await store.insert(legacy,evidenceId,c.now);}
   else if(!stored&&outcome.credit){outcome={...outcome,credit:null};} // Do not import a delivered/unqualified legacy record.
   await store.recordEvent(c.actor.workspaceId,c.actor.id,command.operationId,digest,evidenceId,facts,outcome,c.now);
   await this.finish(tx,c,selected,command,facts);return outcome;
  });
 }
 async readFamilySummary():Promise<AcademySessionCreditFamilySummary>{
  return this.transaction(async tx=>{
   const c=await this.context(tx);if(c.actor.role!=="parent")throw new AppError("FORBIDDEN");
   const selected=await this.selected(tx,c),store=new AcademySessionCreditStore(tx,this.dependencies.keyring);
   const credits=await store.selected(c.actor.workspaceId,selected.enrollmentId,selected.learnerId);
   if(credits.some(credit=>credit.enrollmentId!==selected.enrollmentId||credit.anchor.workspaceId!==selected.workspaceId||credit.anchor.learnerId!==selected.learnerId))fail();
   await this.finish(tx,c,selected);return {version:academySessionPolicyNativeVersion,enrollmentId:selected.enrollmentId,learnerId:selected.learnerId,credits};
  });
 }
}
