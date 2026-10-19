import "server-only";
import {randomUUID,createHash} from "node:crypto";
import {z} from "zod";
import {AppError} from "../../lib/errors.ts";
import {asId} from "../../lib/ids.ts";
import {freshActor,lockWorkspace} from "../identity/data.ts";
import {seal,unseal,type Keyring} from "../identity/crypto.ts";
import {one,type IdentityStore,type SqlSession} from "../identity/store.ts";
import {systemClock,type Actor,type AccountFacts,type IdentityClock} from "../identity/types.ts";
import {approvedOffer,digest,settled,familyPayment,POLICY_VERSION,type SettlementFact,type MerchantBinding,type FamilyPaymentView} from "../fishing-payments/domain.ts";
import type {FishingAuthority} from "../fishing-payments/ports.ts";
import type {EnrollmentProjection,FishingStageRef,PaymentState} from "./contract.ts";
import type {FishingStageNativeHooks,NativeStageHookContext} from "./native-stage-ports.ts";
import type {ApprovedStageTemplate,CanonicalOccurrence} from "../fishing-stage/contract.ts";
import {FishingStageError,validateStageState} from "../fishing-stage/service.ts";
import {assertPlanBinding,decodeNative,digest as stageDigest,parseSnapshot,parseTemplate,planHeaderSchema,revisionHeaderSchema,linkSchema,nativeLimits} from "../fishing-stage/native-storage.ts";
import {assertAvailable} from "../calendar/policy.ts";
import {demoAccountBatch,demoRecordBatch} from "../demo/provenance.ts";
import {FishingProgramError,cohortCommandSchema,venueCommandSchema,fitCommandSchema,termsCommandSchema,holdCommandSchema,offerCommandSchema,enrollmentCommandSchema,enrollmentStateCommandSchema,nativeProgramIntentSchema,programPolicySchema,programTermsSchema,programLimits,type NativeProgramCommandIntent} from "./native-program-contract.ts";
import {readEducationalChildContexts} from "./native-child-context.ts";
import {fishingCalendarChoicesSchema,fishingCalendarOperatorSchema,fishingCalendarLimit,type FishingCalendarChoices,type FishingCalendarOperator} from "./program-calendar-contract.ts";
import type {AcademyEnrollmentStage} from './academy-enrollment-contract.ts';

const uuid=z.uuid(),label=z.string().min(1).max(160).refine(value=>value.trim().length>0);
const receiptSchema=z.strictObject({id:uuid,revision:z.number().int().positive(),state:z.enum(["cohort","venue","fit","terms","hold","offer","confirmed","suspended","revoked"])});
type Receipt=z.infer<typeof receiptSchema>;
type Context={tx:SqlSession;actor:AccountFacts;now:Date};
type Cohort={stageId:string;cohortId:string;stage:1|2|3|4;operatorId:string;instructorId:string;templateApprovalId:string;termsApprovalId:string;policyApprovalId:string;capacity:number;revision:number;active:boolean;labelCiphertext:string};
type EnrollmentRow={id:string;stageId:string;purchaseId:string;purchaseLineId:string;learnerId:string;householdId:string;fitDecisionId:string;termsAcceptanceId:string;policyApprovalId:string;holdId:string;guardianDigest:string;state:"confirmed"|"suspended"|"revoked";revision:number;actorId:string;commandId:string;recordedAt:Date};
type Acceptance={id:string;stageId:string;learnerId:string;householdId:string;parentId:string;sourceApprovalId:string;sourceHash:string;acceptedAt:Date};
const cohortColumns=`stage_id AS "stageId",cohort_id AS "cohortId",stage,operator_id AS "operatorId",instructor_id AS "instructorId",template_approval_id AS "templateApprovalId",terms_approval_id AS "termsApprovalId",policy_approval_id AS "policyApprovalId",child_capacity AS capacity,revision,active,label_ciphertext AS "labelCiphertext"`;
const enrollmentColumns=`id,stage_id AS "stageId",purchase_id AS "purchaseId",purchase_line_id AS "purchaseLineId",learner_id AS "learnerId",household_id AS "householdId",fit_decision_id AS "fitDecisionId",terms_acceptance_id AS "termsAcceptanceId",policy_approval_id AS "policyApprovalId",hold_id AS "holdId",guardian_digest AS "guardianDigest",state,revision,actor_id AS "actorId",command_id AS "commandId",recorded_at AS "recordedAt"`;
function fail(code:ConstructorParameters<typeof FishingProgramError>[0]):never{throw new FishingProgramError(code);}
function requireFact(value:unknown,code:ConstructorParameters<typeof FishingProgramError>[0]="APPROVAL_REQUIRED"):asserts value{if(!value)fail(code);}
function clean(error:unknown):never{if(error instanceof AppError||error instanceof FishingProgramError)throw error;if(error&&typeof error==="object"&&"code"in error&&["23505","40001","40P01"].includes(String(error.code)))fail("CONFLICT");fail("UNAVAILABLE");}

/** Native implementation only. No source-approval importer, env/provider lookup,
 * source rewrite, automatic enrollment, child enablement or clinical grant.
 * Actual source population and runtime mounting retain their separate gates.
 * The non-secret merchant option pins expected account/mode/API only. Supplying
 * it is NOT independent merchant/client/signature verification or activation.
 */
export class NativeFishingProgram {
 constructor(private readonly db:IdentityStore,private readonly ring:Keyring,private readonly options:Readonly<{childAccountsEnabled:boolean;merchant:MerchantBinding|null}>,private readonly clock:IdentityClock=systemClock){
  requireFact(typeof options.childAccountsEnabled==="boolean","UNAVAILABLE");try{const merchant=options.merchant===null?null:z.strictObject({accountId:z.string().regex(/^acct_[A-Za-z0-9_]{1,150}$/),livemode:z.boolean(),apiVersion:z.string().min(1).max(80),verifiedBindingId:z.string().min(1).max(160)}).parse(options.merchant);this.options=Object.freeze({childAccountsEnabled:options.childAccountsEnabled,merchant:merchant===null?null:Object.freeze(merchant)});}catch{fail("POLICY_REQUIRED");}
 }
 private aad(kind:string,workspace:string,id:string){return `fishing-program:v1:${kind}:${workspace}:${id}`;}
 private encode(kind:string,workspace:string,id:string,value:unknown){const text=JSON.stringify(value);requireFact(Buffer.byteLength(text)<=programLimits.sourceBytes,"INVALID_REQUEST");return seal(text,this.aad(kind,workspace,id),this.ring);}
 private decode(kind:string,workspace:string,id:string,value:string):unknown{return JSON.parse(unseal(value,this.aad(kind,workspace,id),this.ring));}
 private async actor(tx:SqlSession,input:Actor):Promise<Context>{
  const now=this.clock.now();requireFact(Number.isFinite(now.valueOf()),"UNAVAILABLE");await lockWorkspace(tx,input.workspaceId);
  const locked=await one(tx,`SELECT s.account_id FROM ls_identity.sessions s JOIN ls_identity.accounts a ON a.workspace_id=s.workspace_id AND a.id=s.account_id JOIN ls_identity.account_subjects p ON p.workspace_id=a.workspace_id AND p.account_id=a.id
   WHERE s.workspace_id=$1 AND s.account_id=$2 AND s.token_digest=$3 AND s.revoked_at IS NULL AND s.expires_at>GREATEST($4::timestamptz,clock_timestamp()) AND a.state='active' FOR SHARE OF s,a,p`,[input.workspaceId,input.id,input.sessionDigest,now]);
  if(!locked)throw new AppError("UNAUTHENTICATED");const actor=await freshActor(tx,input,now);if(!actor.emailVerifiedAt||actor.emailVerifiedAt>now)throw new AppError("UNAUTHENTICATED");return {tx,actor,now};
 }
 private operator(c:Context,cohort?:Cohort){if(c.actor.role!=="practitioner"||cohort&&cohort.operatorId!==c.actor.id)fail("FORBIDDEN");}
 private async command(actor:Actor,commandId:string,action:string,body:unknown,authorize:(c:Context)=>Promise<void>,work:(c:Context)=>Promise<Receipt>):Promise<Receipt&{replayed:boolean}>{
  try{return await this.db.transaction(async tx=>{const c=await this.actor(tx,actor);requireFact(await demoAccountBatch(tx,c.actor.workspaceId,c.actor.id)===null,"FORBIDDEN");await authorize(c);const hash=digest(body),key=`${c.actor.id}:${commandId}:${action}:${hash}`;
   const old=await one<{action:string;hash:string;ciphertext:string}>(tx,`SELECT action,request_sha256 AS hash,result_ciphertext AS ciphertext FROM ls_fishing_stage.command_receipts WHERE workspace_id=$1 AND actor_id=$2 AND command_id=$3`,[actor.workspaceId,c.actor.id,commandId]);
   if(old){requireFact(old.action===action&&old.hash===hash,"CONFLICT");const result=receiptSchema.parse(this.decode("receipt",actor.workspaceId,key,old.ciphertext));await authorize(await this.actor(tx,actor));return {...result,replayed:true};}
   const result=receiptSchema.parse(await work(c)),final=await this.actor(tx,actor);await authorize(final);await tx.query(`INSERT INTO ls_fishing_stage.command_receipts(workspace_id,actor_id,command_id,action,request_sha256,result_ciphertext,recorded_at) VALUES($1,$2,$3,$4,$5,$6,$7)`,[actor.workspaceId,c.actor.id,commandId,action,hash,this.encode("receipt",actor.workspaceId,key,result),final.now]);return {...result,replayed:false};
  });}catch(error){clean(error);}
 }
 private async cohort(tx:SqlSession,workspace:string,stageId:string):Promise<Cohort>{const row=await one<Cohort>(tx,`SELECT ${cohortColumns} FROM ls_fishing_stage.cohorts WHERE workspace_id=$1 AND stage_id=$2 FOR SHARE`,[workspace,uuid.parse(stageId)]);requireFact(row&&row.active,"NOT_FOUND");return row;}
 private async source(tx:SqlSession,workspace:string,id:string,kind:"terms"|"template"|"payment_condition",now:Date){
  const row=await one<{kind:string;version:string;hash:string;approvedAt:Date;ciphertext:string}>(tx,`SELECT kind,version,source_sha256 AS hash,approved_at AS "approvedAt",payload_ciphertext AS ciphertext FROM ls_fishing_stage.source_approvals WHERE workspace_id=$1 AND id=$2 FOR SHARE`,[workspace,id]);
  requireFact(row&&row.kind===kind&&row.approvedAt instanceof Date&&row.approvedAt<=now);return {...row,payload:this.decode("source",workspace,id,row.ciphertext)};
 }
 private async template(tx:SqlSession,workspace:string,cohort:Cohort,version:string,now:Date):Promise<ApprovedStageTemplate>{
  const source=await this.source(tx,workspace,cohort.templateApprovalId,"template",now),template=parseTemplate(source.payload);requireFact(template.stage===cohort.stage&&template.version===version&&template.sourceSha256===source.hash);
  requireFact(template.modules.every((value,index)=>value.moduleId===`RM-${cohort.stage}${String(index+1).padStart(2,"0")}`));
  for(const lessonModule of template.modules){if(lessonModule.learnerContent==="unavailable")continue;
   const record=await one(tx,`SELECT c.module_id FROM ls_education.catalog_versions c JOIN ls_education.artifact_versions l ON l.workspace_id=c.workspace_id AND l.id=c.learner_artifact_id JOIN ls_education.artifact_versions t ON t.workspace_id=c.workspace_id AND t.id=c.teacher_artifact_id
    WHERE c.workspace_id=$1 AND c.module_id=$2 AND c.version=$3 AND c.approval_state='approved' AND l.storage_class='resource_learner' AND t.storage_class='protected_teacher' FOR SHARE OF c,l,t`,[workspace,lessonModule.moduleId,lessonModule.moduleVersion]);requireFact(record);
  }return template;
 }
 private async guardian(tx:SqlSession,workspace:string,parentId:string,learnerId:string,householdId:string){
  requireFact(await demoAccountBatch(tx,workspace,parentId)===null&&await demoRecordBatch(tx,workspace,"person",learnerId)===null&&await demoRecordBatch(tx,workspace,"family",householdId)===null,"FORBIDDEN");
  const row=await one<{verifiedAt:Date;source:string;verifier:string}>(tx,`SELECT g.verified_at AS "verifiedAt",g.source_reference AS source,g.verified_by AS verifier FROM ls_education.guardian_authorities g
   JOIN ls_identity.accounts a ON a.workspace_id=g.workspace_id AND a.id=g.account_id JOIN ls_identity.account_subjects s ON s.workspace_id=a.workspace_id AND s.account_id=a.id
   JOIN ls_identity.people p ON p.workspace_id=g.workspace_id AND p.id=g.learner_id
   JOIN ls_cases.family_members child ON child.workspace_id=g.workspace_id AND child.family_id=$4 AND child.person_id=g.learner_id AND child.role='child'
   JOIN ls_cases.family_members adult ON adult.workspace_id=g.workspace_id AND adult.family_id=$4 AND adult.person_id=s.person_id AND adult.role IN('parent','guardian')
   WHERE g.workspace_id=$1 AND g.account_id=$2 AND g.learner_id=$3 AND g.active AND g.verified_at<=clock_timestamp() AND p.kind='minor' AND a.state='active' AND a.role='parent' AND a.email_verified_at<=clock_timestamp()
   AND NOT EXISTS(SELECT 1 FROM ls_education.access_revocations r WHERE r.workspace_id=g.workspace_id AND(r.account_id IS NULL OR r.account_id=g.account_id)AND(r.learner_id IS NULL OR r.learner_id=g.learner_id)AND r.module_id IS NULL AND r.version IS NULL) FOR SHARE OF g,a,s,p,child,adult`,[workspace,parentId,learnerId,householdId]);
  requireFact(row,"FORBIDDEN");return digest({workspace,parentId,learnerId,householdId,verifiedAt:row.verifiedAt.toISOString(),source:row.source,verifier:row.verifier});
 }
 private async fit(tx:SqlSession,workspace:string,id:string,stageId:string,learnerId:string,purpose:"enrollment"|"makeup",target?:CanonicalOccurrence){
  const row=await one<{decision:string;purpose:string;stageId:string;learnerId:string;targetId:string|null;targetRevision:number|null}>(tx,`SELECT decision,purpose,stage_id AS "stageId",learner_id AS "learnerId",target_occurrence_id AS "targetId",target_revision AS "targetRevision" FROM ls_fishing_stage.fit_decisions WHERE workspace_id=$1 AND id=$2 FOR SHARE`,[workspace,id]);
  requireFact(row&&row.decision==="approved"&&row.purpose===purpose&&row.stageId===stageId&&row.learnerId===learnerId&&(!target||row.targetId===target.id&&row.targetRevision===target.revision));return row;
 }
 private async acceptance(tx:SqlSession,workspace:string,id:string,cohort:Cohort,learner:string,payer:string,household:string,now:Date):Promise<Acceptance>{
  const a=await one<Acceptance>(tx,`SELECT id,stage_id AS "stageId",learner_id AS "learnerId",household_id AS "householdId",parent_id AS "parentId",source_approval_id AS "sourceApprovalId",source_sha256 AS "sourceHash",accepted_at AS "acceptedAt" FROM ls_fishing_stage.terms_acceptances WHERE workspace_id=$1 AND id=$2 FOR SHARE`,[workspace,id]);
  requireFact(a&&a.stageId===cohort.stageId&&a.learnerId===learner&&a.parentId===payer&&a.householdId===household&&a.sourceApprovalId===cohort.termsApprovalId&&a.acceptedAt<=now);
  const source=await this.source(tx,workspace,a.sourceApprovalId,"terms",now),terms=programTermsSchema.parse(source.payload);requireFact(a.sourceHash===source.hash&&terms.contentSha256===source.hash&&terms.termsVersion===source.version);return a;
 }
 createCohort(actor:Actor,raw:unknown){const input=cohortCommandSchema.parse(raw);return this.command(actor,input.commandId,"cohort.create",input,async c=>this.operator(c),async c=>{
  requireFact(input.instructorAccountId===c.actor.id,"FORBIDDEN");const terms=await this.source(c.tx,c.actor.workspaceId,input.termsApprovalId,"terms",c.now),policy=await this.source(c.tx,c.actor.workspaceId,input.policyApprovalId,"payment_condition",c.now);
  programTermsSchema.parse(terms.payload);programPolicySchema.parse(policy.payload);
  const header:Cohort={...input,operatorId:c.actor.id,instructorId:input.instructorAccountId,capacity:input.approvedChildCapacity,revision:1,active:true,labelCiphertext:""};await this.template(c.tx,c.actor.workspaceId,header,(await this.source(c.tx,c.actor.workspaceId,input.templateApprovalId,"template",c.now)).version,c.now);
  await c.tx.query(`INSERT INTO ls_fishing_stage.cohorts(workspace_id,stage_id,cohort_id,stage,operator_id,instructor_id,template_approval_id,terms_approval_id,policy_approval_id,child_capacity,revision,active,label_ciphertext,decision_actor_id,decision_command_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,true,$11,$5,$12)`,[c.actor.workspaceId,input.stageId,input.cohortId,input.stage,c.actor.id,input.instructorAccountId,input.templateApprovalId,input.termsApprovalId,input.policyApprovalId,input.approvedChildCapacity,this.encode("cohort",c.actor.workspaceId,input.stageId,{label:input.label,reason:input.reason}),input.commandId]);return {id:input.stageId,revision:1,state:"cohort"};
 });}
 approveVenue(actor:Actor,raw:unknown){const input=venueCommandSchema.parse(raw);return this.command(actor,input.commandId,"venue.approve",input,async c=>this.operator(c),async c=>{
  await c.tx.query(`INSERT INTO ls_fishing_stage.venues(workspace_id,id,operator_id,capacity,revision,active,approval_reference,details_ciphertext,decision_actor_id,decision_command_id) VALUES($1,$2,$3,$4,1,true,$5,$6,$3,$7)`,[c.actor.workspaceId,input.id,c.actor.id,input.capacity,input.approvalReference,this.encode("venue",c.actor.workspaceId,input.id,{label:input.label,address:input.address,reason:input.reason}),input.commandId]);return {id:input.id,revision:1,state:"venue"};
 });}
 recordFit(actor:Actor,raw:unknown){const input=fitCommandSchema.parse(raw);return this.command(actor,input.commandId,"fit.record",input,async c=>this.operator(c,await this.cohort(c.tx,c.actor.workspaceId,input.stageId)),async c=>{
  requireFact(await demoRecordBatch(c.tx,c.actor.workspaceId,"person",input.learnerId)===null,"FORBIDDEN");requireFact(await one(c.tx,"SELECT id FROM ls_identity.people WHERE workspace_id=$1 AND id=$2 AND kind='minor' FOR SHARE",[c.actor.workspaceId,input.learnerId]),"NOT_FOUND");
  if(input.purpose==="makeup"){
   const physical=await one<{stageId:string}>(c.tx,"SELECT stage_id AS \"stageId\" FROM ls_fishing_stage.occurrences WHERE workspace_id=$1 AND id=$2",[c.actor.workspaceId,input.targetOccurrenceId]);requireFact(physical,"NOT_FOUND");this.operator(c,await this.cohort(c.tx,c.actor.workspaceId,physical.stageId));
   const target=(await this.plan(c.tx,c.actor.workspaceId,physical.stageId)).occurrences.find(value=>value.id===input.targetOccurrenceId);requireFact(target&&target.revision===input.targetRevision,"CONFLICT");requireFact(target.state==="published"&&target.time.kind==="scheduled"&&Date.parse(target.time.startsAt)>c.now.valueOf());
  }
  await c.tx.query(`INSERT INTO ls_fishing_stage.fit_decisions(workspace_id,id,stage_id,learner_id,purpose,decision,target_occurrence_id,target_revision,actor_id,command_id,recorded_at,note_ciphertext) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[c.actor.workspaceId,input.id,input.stageId,input.learnerId,input.purpose,input.decision,input.targetOccurrenceId,input.targetRevision,c.actor.id,input.commandId,c.now,this.encode("fit",c.actor.workspaceId,input.id,{note:input.note})]);return {id:input.id,revision:1,state:"fit"};
 });}
 acceptTerms(actor:Actor,raw:unknown){const input=termsCommandSchema.parse(raw);return this.command(actor,input.commandId,"terms.accept",input,async c=>{
  if(c.actor.role!=="parent")fail("FORBIDDEN");const cohort=await this.cohort(c.tx,c.actor.workspaceId,input.stageId);requireFact(cohort.termsApprovalId===input.sourceApprovalId);await this.guardian(c.tx,c.actor.workspaceId,c.actor.id,input.learnerId,input.householdId);
  const source=await this.source(c.tx,c.actor.workspaceId,input.sourceApprovalId,"terms",c.now);requireFact(source.hash===input.sourceSha256&&programTermsSchema.parse(source.payload).contentSha256===source.hash,"CONFLICT");
  const accepted=await one<{id:string;commandId:string;householdId:string}>(c.tx,'SELECT id,command_id AS "commandId",household_id AS "householdId" FROM ls_fishing_stage.terms_acceptances WHERE workspace_id=$1 AND stage_id=$2 AND learner_id=$3 AND parent_id=$4 AND source_approval_id=$5 FOR SHARE',[c.actor.workspaceId,input.stageId,input.learnerId,c.actor.id,input.sourceApprovalId]);requireFact(!accepted||accepted.id===input.id&&accepted.commandId===input.commandId&&accepted.householdId===input.householdId,'CONFLICT');
 },async c=>{await c.tx.query(`INSERT INTO ls_fishing_stage.terms_acceptances(workspace_id,id,stage_id,learner_id,household_id,parent_id,source_approval_id,source_sha256,accepted_at,command_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[c.actor.workspaceId,input.id,input.stageId,input.learnerId,input.householdId,c.actor.id,input.sourceApprovalId,input.sourceSha256,c.now,input.commandId]);return {id:input.id,revision:1,state:"terms"};});}
 private async plan(tx:SqlSession,workspace:string,stageId:string){
  const row=await one<Record<string,unknown>&{ciphertext:string}>(tx,`SELECT workspace_id AS "workspaceId",stage_id AS "stageId",cohort_id AS "cohortId",stage,template_version AS "templateVersion",revision,state_sha256 AS "stateHash",payload_ciphertext AS ciphertext FROM ls_fishing_stage.plans WHERE workspace_id=$1 AND stage_id=$2 FOR SHARE`,[workspace,stageId]);requireFact(row,"NOT_FOUND");
  const {ciphertext,...physical}=row,header=planHeaderSchema.parse(physical),snapshot=parseSnapshot(decodeNative("plan",header,ciphertext,this.ring));assertPlanBinding(header,snapshot);
  const cohort=await this.cohort(tx,workspace,stageId);requireFact(header.cohortId===cohort.cohortId&&header.stage===cohort.stage,"UNAVAILABLE");
  validateStageState(snapshot.state,{scope:{workspaceId:workspace,program:"sunday_fishing_academy",cohortId:cohort.cohortId,stageId,stage:cohort.stage}});
  requireFact(digest(await this.template(tx,workspace,cohort,header.templateVersion,this.clock.now()))===digest(snapshot.state.template),"UNAVAILABLE");
  const ordinals=await tx.query<{workspaceId:string;id:string;stageId:string;cohortId:string;stage:number;templateVersion:string;ordinal:number}>(`SELECT workspace_id AS "workspaceId",id,stage_id AS "stageId",cohort_id AS "cohortId",stage,template_version AS "templateVersion",ordinal FROM ls_fishing_stage.occurrences WHERE workspace_id=$1 AND stage_id=$2 ORDER BY ordinal LIMIT 13`,[workspace,stageId]);
  requireFact(ordinals.length===12,"UNAVAILABLE");for(const [index,value]of ordinals.entries()){const expected=snapshot.state.occurrences[index]!;requireFact(value.workspaceId===workspace&&value.id===expected.id&&value.stageId===stageId&&value.cohortId===cohort.cohortId&&value.stage===cohort.stage&&value.templateVersion===header.templateVersion&&value.ordinal===index+1,"UNAVAILABLE");}
  const revisions=await tx.query<{workspaceId:string;stageId:string;revision:number;actorId:string;operationId:string;recordedAt:Date;previousHash:string|null;stateHash:string}>(`SELECT workspace_id AS "workspaceId",stage_id AS "stageId",revision,actor_account_id AS "actorId",operation_id AS "operationId",recorded_at AS "recordedAt",previous_state_sha256 AS "previousHash",state_sha256 AS "stateHash" FROM ls_fishing_stage.revisions WHERE workspace_id=$1 AND stage_id=$2 ORDER BY revision LIMIT 1001`,[workspace,stageId]);
  requireFact(revisions.length===header.revision&&revisions.length<=nativeLimits.revisions,"UNAVAILABLE");let previous:string|null=null;
  const headers=revisions.map((value,index)=>{const parsed=revisionHeaderSchema.parse({...value,recordedAt:value.recordedAt.toISOString()});requireFact(parsed.workspaceId===workspace&&parsed.stageId===stageId&&parsed.revision===index+1&&parsed.previousHash===previous,"UNAVAILABLE");previous=parsed.stateHash;return parsed;});requireFact(previous===header.stateHash,"UNAVAILABLE");
  const last=headers.at(-1)!,head=await one<{ciphertext:string}>(tx,"SELECT payload_ciphertext AS ciphertext FROM ls_fishing_stage.revisions WHERE workspace_id=$1 AND stage_id=$2 AND revision=$3",[workspace,stageId,header.revision]);requireFact(head,"UNAVAILABLE");requireFact(stageDigest(parseSnapshot(decodeNative("revision",last,head.ciphertext,this.ring)))===header.stateHash,"UNAVAILABLE");
  const links=await tx.query(`SELECT workspace_id AS "workspaceId",source_stage_id AS "sourceStageId",entitlement_id AS "entitlementId",enrollment_id AS "enrollmentId",learner_id AS "learnerId",occurrence_id AS "occurrenceId",reservation_id AS "reservationId" FROM ls_fishing_stage.makeup_links WHERE workspace_id=$1 AND source_stage_id=$2 ORDER BY entitlement_id LIMIT 12001`,[workspace,stageId]);requireFact(links.length<=nativeLimits.notices&&digest(links.map(value=>linkSchema.parse(value)))===digest(snapshot.links),"UNAVAILABLE");return snapshot.state;
 }
 private async countSeats(tx:SqlSession,workspace:string,id:string){const row=await one<{count:number}>(tx,"SELECT count(*)::integer AS count FROM ls_fishing_stage.seat_reservations WHERE workspace_id=$1 AND occurrence_id=$2 AND state<>'released'",[workspace,id]);requireFact(row&&Number.isInteger(row.count)&&row.count>=0,"UNAVAILABLE");return row.count;}
 reserveOfferHold(actor:Actor,raw:unknown){const input=holdCommandSchema.parse(raw);return this.command(actor,input.commandId,"hold.reserve",input,async c=>{const cohort=await this.cohort(c.tx,c.actor.workspaceId,input.stageId);this.operator(c,cohort);requireFact(cohort.revision===input.expectedCohortRevision,"CONFLICT");await this.guardian(c.tx,c.actor.workspaceId,input.payerAccountId,input.learnerId,input.householdId);},async c=>{
  const cohort=await this.cohort(c.tx,c.actor.workspaceId,input.stageId),plan=await this.plan(c.tx,c.actor.workspaceId,input.stageId);requireFact(plan.occurrences.length===12,"UNAVAILABLE");
  for(const occurrence of plan.occurrences){requireFact(await this.countSeats(c.tx,c.actor.workspaceId,occurrence.id)<Math.min(cohort.capacity,occurrence.childCapacity),"CAPACITY");
   await c.tx.query(`INSERT INTO ls_fishing_stage.seat_reservations(workspace_id,id,hold_id,stage_id,occurrence_id,learner_id,origin,state,revision,hold_revision,actor_id,command_id) VALUES($1,$2,$3,$4,$5,$6,'offer_hold','reserved',1,1,$7,$8)`,[c.actor.workspaceId,randomUUID(),input.holdId,input.stageId,occurrence.id,input.learnerId,c.actor.id,input.commandId]);
  }return {id:input.holdId,revision:1,state:"hold"};
 });}
 private async hold(tx:SqlSession,workspace:string,id:string,stageId:string,learner:string){
  const rows=await tx.query<{id:string;occurrenceId:string;state:string;origin:string;learnerId:string;stageId:string;offerId:string|null;enrollmentId:string|null;holdRevision:number}>(`SELECT id,occurrence_id AS "occurrenceId",state,origin,learner_id AS "learnerId",stage_id AS "stageId",offer_id AS "offerId",enrollment_id AS "enrollmentId",hold_revision AS "holdRevision" FROM ls_fishing_stage.seat_reservations WHERE workspace_id=$1 AND hold_id=$2 ORDER BY occurrence_id LIMIT 13 FOR UPDATE`,[workspace,id]);
  requireFact(rows.length===12&&rows.every(row=>row.stageId===stageId&&row.learnerId===learner&&row.state!=="released"&&row.holdRevision===rows[0]!.holdRevision)&&new Set(rows.map(row=>row.occurrenceId)).size===12);const plan=await this.plan(tx,workspace,stageId);requireFact(plan.occurrences.every(item=>rows.some(row=>row.occurrenceId===item.id)));return rows;
 }
 approveOffer(actor:Actor,raw:unknown){const input=offerCommandSchema.parse(raw);return this.command(actor,input.commandId,"offer.approve",input,async c=>{this.operator(c,await this.cohort(c.tx,c.actor.workspaceId,input.stageId));},async c=>{
  const cohort=await this.cohort(c.tx,c.actor.workspaceId,input.stageId);requireFact(input.policyApprovalId===cohort.policyApprovalId);const policy=programPolicySchema.parse((await this.source(c.tx,c.actor.workspaceId,input.policyApprovalId,"payment_condition",c.now)).payload);requireFact(policy.policyVersion===POLICY_VERSION,"POLICY_REQUIRED");
  // Qualifying prepay/late-sibling decisions are not yet selected. The owner
  // separately settled full-rate installments for EVERY child: three650 dues.
  // Never substitute ordinary prepay for an unresolved sibling/founder offer.
  requireFact(input.lines.length===1,"POLICY_REQUIRED");
  const related=await one(c.tx,`SELECT s.id FROM ls_fishing_stage.seat_reservations s JOIN ls_cases.family_members f ON f.workspace_id=s.workspace_id AND f.person_id=s.learner_id AND f.family_id=$3 AND f.role='child'
   WHERE s.workspace_id=$1 AND s.stage_id=$2 AND s.learner_id<>$4 AND s.state<>'released' LIMIT 1`,[c.actor.workspaceId,input.stageId,input.householdId,input.lines[0]!.learnerId]);requireFact(!related||input.lines[0]!.mode==='installments',"POLICY_REQUIRED");
  if(cohort.stage===1&&input.lines[0]!.mode==='prepay')requireFact(!await one(c.tx,"SELECT household_id FROM ls_fishing_payments.founder_households WHERE workspace_id=$1 AND household_id=$2 LIMIT 1",[c.actor.workspaceId,input.householdId]),"POLICY_REQUIRED");
  const termsSource=await this.source(c.tx,c.actor.workspaceId,cohort.termsApprovalId,"terms",c.now),terms=programTermsSchema.parse(termsSource.payload);requireFact(terms.policyVersion===policy.policyVersion&&Date.parse(input.expiresAt)>c.now.valueOf());
  const lines=[];let acceptedAt:string|null=null;
  for(const line of input.lines){await this.guardian(c.tx,c.actor.workspaceId,input.payerAccountId,line.learnerId,input.householdId);await this.fit(c.tx,c.actor.workspaceId,line.fitDecisionId,input.stageId,line.learnerId,"enrollment");const accepted=await this.acceptance(c.tx,c.actor.workspaceId,line.termsAcceptanceId,cohort,line.learnerId,input.payerAccountId,input.householdId,c.now);acceptedAt=acceptedAt===null?accepted.acceptedAt.toISOString():new Date(Math.max(Date.parse(acceptedAt),accepted.acceptedAt.valueOf())).toISOString();
   const held=await this.hold(c.tx,c.actor.workspaceId,line.holdId,input.stageId,line.learnerId);requireFact(held.every(row=>row.origin==="offer_hold"&&row.offerId===null));requireFact(line.dueAt.length===(line.mode==="prepay"?1:3),"INVALID_REQUEST");
   lines.push({id:line.id,learnerId:asId(line.learnerId,"person"),cohortId:cohort.cohortId,stageId:cohort.stageId,stage:cohort.stage,sessions:12 as const,mode:line.mode,totalCents:line.mode==="prepay"?175000:195000,discountBasis:line.mode==="prepay"?"ordinary_primary_prepay":"three_full_rate_dues",eligibility:{kind:"ordinary" as const,evidenceId:line.fitDecisionId,policyVersion:policy.policyVersion},dues:line.dueAt.map((dueAt,i)=>({id:randomUUID(),index:(i+1) as 1|2|3,dueAt,currency:"USD" as const,amountCents:line.mode==="prepay"?175000:65000,state:"pending" as const,paidCents:0})),capacity:{reservationId:line.holdId,revision:1,expiresAt:input.expiresAt}});
  }
  const offer=approvedOffer({id:input.id,revision:1,workspaceId:c.actor.workspaceId,program:"sunday_fishing_academy",operatorAccountId:c.actor.id,householdId:input.householdId,payerAccountId:input.payerAccountId,currency:"USD",lines,expiresAt:input.expiresAt,policyVersion:policy.policyVersion,sourceVersion:policy.sourceVersion,terms:{version:terms.termsVersion,acceptedBy:input.payerAccountId,acceptedAt}});
  await c.tx.query(`INSERT INTO ls_fishing_stage.offer_approvals(workspace_id,id,revision,digest,payload_ciphertext,policy_approval_id,actor_id,command_id,recorded_at) VALUES($1,$2,1,$3,$4,$5,$6,$7,$8)`,[c.actor.workspaceId,offer.id,digest(offer),this.encode("offer",c.actor.workspaceId,offer.id,offer),input.policyApprovalId,c.actor.id,input.commandId,c.now]);
  for(const line of input.lines)await c.tx.query("UPDATE ls_fishing_stage.seat_reservations SET offer_id=$3,revision=revision+1 WHERE workspace_id=$1 AND hold_id=$2",[c.actor.workspaceId,line.holdId,offer.id]);return {id:input.id,revision:1,state:"offer"};
 });}
 private async approved(tx:SqlSession,workspace:string,id:string){
  const row=await one<{hash:string;ciphertext:string;policyId:string}>(tx,"SELECT digest AS hash,payload_ciphertext AS ciphertext,policy_approval_id AS \"policyId\" FROM ls_fishing_stage.offer_approvals WHERE workspace_id=$1 AND id=$2 FOR SHARE",[workspace,id]);requireFact(row,"NOT_FOUND");const offer=approvedOffer(this.decode("offer",workspace,id,row.ciphertext));requireFact(offer.workspaceId===workspace&&offer.id===id&&digest(offer)===row.hash,"UNAVAILABLE");return {offer,policyId:row.policyId};
 }
 private async purchase(tx:SqlSession,workspace:string,id:string){
  const row=await one<{state:PaymentState;offerId:string;lineId:string;revision:number}>(tx,"SELECT state_json AS state,offer_id AS \"offerId\",line_id AS \"lineId\",revision FROM ls_fishing_payments.purchases WHERE workspace_id=$1 AND id=$2 AND octet_length(state_json::text)<=131072 FOR SHARE",[workspace,id]);requireFact(row,"NOT_FOUND");const {offer,policyId}=await this.approved(tx,workspace,row.offerId),line=offer.lines.find(item=>item.id===row.lineId);
  const issued=await one<{hash:string;offer:unknown}>(tx,"SELECT digest AS hash,offer_json AS offer FROM ls_fishing_payments.offers WHERE workspace_id=$1 AND id=$2 AND octet_length(offer_json::text)<=131072 FOR SHARE",[workspace,row.offerId]);
  requireFact(issued&&digest(approvedOffer(issued.offer))===issued.hash&&issued.hash===digest(offer)&&line&&row.revision===row.state.revision&&row.state.workspaceId===workspace&&row.state.purchaseId===id&&row.state.offerId===offer.id&&row.state.currency==="USD"&&row.state.originalTotalCents===line.totalCents,"UNAVAILABLE");
  requireFact(row.state.dues.length===line.dues.length&&row.state.dues.every((due,i)=>due.id===line.dues[i]?.id&&due.index===line.dues[i]?.index&&due.amountCents===line.dues[i]?.amountCents),"UNAVAILABLE");return {offer,line,state:row.state,policyId};
 }
 confirmEnrollment(actor:Actor,raw:unknown){const input=enrollmentCommandSchema.parse(raw);return this.command(actor,input.commandId,"enrollment.confirm",input,async c=>this.operator(c,await this.cohort(c.tx,c.actor.workspaceId,input.stageId)),async c=>{
  const cohort=await this.cohort(c.tx,c.actor.workspaceId,input.stageId),p=await this.purchase(c.tx,c.actor.workspaceId,input.purchaseId);requireFact(p.line.stageId===cohort.stageId&&p.line.cohortId===cohort.cohortId&&p.line.stage===cohort.stage&&p.offer.operatorAccountId===c.actor.id&&p.state.revision===input.expectedPaymentRevision,"CONFLICT");
  const merchant=this.options.merchant;requireFact(merchant,"POLICY_REQUIRED");requireFact(p.state.providerAccountId===merchant.accountId&&p.state.livemode===merchant.livemode);
  requireFact(input.policyApprovalId===cohort.policyApprovalId&&input.policyApprovalId===p.policyId);const policy=programPolicySchema.parse((await this.source(c.tx,c.actor.workspaceId,input.policyApprovalId,"payment_condition",c.now)).payload);
  if(policy.confirmation.kind==="unselected")fail("POLICY_REQUIRED");requireFact(policy.policyVersion===p.offer.policyVersion&&policy.sourceVersion===p.offer.sourceVersion,"POLICY_REQUIRED");
  await this.paymentFacts(c.tx,c.actor.workspaceId,p);
  const indices=policy.confirmation.kind==="all_native_dues_paid"?p.state.dues.map(due=>due.index):policy.confirmation.indices;
  requireFact(indices.every(index=>p.state.dues.some(due=>due.index===index&&due.paidCents===due.amountCents&&due.state==="paid"))&&p.state.refundedCents===0&&p.state.state!=="reconciliation_required"&&!p.state.settlements.some(fact=>fact.kind!=="payment"));
  const unknown=await c.tx.query<{operation:unknown}>("SELECT CASE WHEN octet_length(operation_json::text)<=131072 THEN operation_json ELSE NULL END AS operation FROM ls_fishing_payments.operations WHERE workspace_id=$1 AND purchase_id=$2 LIMIT 101",[c.actor.workspaceId,input.purchaseId]);requireFact(unknown.length<=100&&unknown.every(row=>z.object({state:z.enum(["confirmed","reserved"])}).safeParse(row.operation).success));
  const guardianDigest=await this.guardian(c.tx,c.actor.workspaceId,p.offer.payerAccountId,p.line.learnerId,p.offer.householdId);await this.fit(c.tx,c.actor.workspaceId,input.fitDecisionId,input.stageId,p.line.learnerId,"enrollment");
  const acceptance=await this.acceptance(c.tx,c.actor.workspaceId,input.termsAcceptanceId,cohort,p.line.learnerId,p.offer.payerAccountId,p.offer.householdId,c.now);requireFact(p.offer.terms.acceptedBy===acceptance.parentId&&p.offer.terms.acceptedAt===acceptance.acceptedAt.toISOString());
  const held=await this.hold(c.tx,c.actor.workspaceId,p.line.capacity.reservationId,cohort.stageId,p.line.learnerId);requireFact(held.every(row=>row.origin==="offer_hold"&&row.offerId===p.offer.id&&row.enrollmentId===null&&row.holdRevision===p.line.capacity.revision));
  await c.tx.query(`INSERT INTO ls_fishing_stage.enrollments(workspace_id,id,stage_id,purchase_id,purchase_line_id,learner_id,household_id,fit_decision_id,terms_acceptance_id,policy_approval_id,hold_id,guardian_digest,state,revision,actor_id,command_id,recorded_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'confirmed',1,$13,$14,$15)`,[c.actor.workspaceId,input.id,input.stageId,input.purchaseId,p.line.id,p.line.learnerId,p.offer.householdId,input.fitDecisionId,input.termsAcceptanceId,input.policyApprovalId,p.line.capacity.reservationId,guardianDigest,c.actor.id,input.commandId,c.now]);
  await c.tx.query("UPDATE ls_fishing_stage.seat_reservations SET origin='enrollment',enrollment_id=$3,state='confirmed',revision=revision+1 WHERE workspace_id=$1 AND hold_id=$2",[c.actor.workspaceId,p.line.capacity.reservationId,input.id]);return {id:input.id,revision:1,state:"confirmed"};
 });}
 private async paymentFacts(tx:SqlSession,workspace:string,p:Awaited<ReturnType<NativeFishingProgram["purchase"]>>){
  const size=await one<{count:number;bytes:number}>(tx,"SELECT LEAST(count(*),1001)::integer AS count,LEAST(COALESCE(sum(octet_length(fact_json::text)),0),131073)::integer AS bytes FROM ls_fishing_payments.settlements WHERE workspace_id=$1 AND purchase_id=$2",[workspace,p.state.purchaseId]);requireFact(size&&size.count<=1000&&size.bytes<=131072,"UNAVAILABLE");
  const rows=await tx.query<{fact:SettlementFact|null;hash:string;kind:string;transaction:string}>(`SELECT CASE WHEN octet_length(fact_json::text)<=131072 THEN fact_json ELSE NULL END AS fact,digest AS hash,kind,transaction_id AS "transaction" FROM ls_fishing_payments.settlements WHERE workspace_id=$1 AND purchase_id=$2 ORDER BY kind,transaction_id LIMIT 1001 FOR SHARE`,[workspace,p.state.purchaseId]);requireFact(rows.length===size.count&&rows.length<=1000&&rows.reduce((bytes,row)=>bytes+Buffer.byteLength(JSON.stringify(row)),0)<=131072,"UNAVAILABLE");
  const facts=[];
  for(const row of rows){const f=row.fact;requireFact(f&&f.kind===row.kind&&f.canonicalTransactionId===row.transaction&&f.purchaseId===p.state.purchaseId&&f.purchaseLineId===p.line.id&&f.providerAccountId===p.state.providerAccountId&&f.livemode===p.state.livemode);
   requireFact(row.hash===digest({transaction:f.canonicalTransactionId,purchase:f.purchaseId,line:f.purchaseLineId,due:f.dueId,merchant:f.providerAccountId,mode:f.livemode,kind:f.kind,currency:f.currency,cents:f.cents,originalPayment:f.originalPaymentId}),"UNAVAILABLE");
   const merchant=this.options.merchant;requireFact(merchant,"POLICY_REQUIRED");const receipt=await one(tx,"SELECT event_id FROM ls_fishing_payments.inbox WHERE provider_account_id=$1 AND livemode=$2 AND event_id=$3 AND processed_at IS NOT NULL AND receipt_json->>'apiVersion'=$4 FOR SHARE",[f.providerAccountId,f.livemode,f.providerReceiptId,merchant.apiVersion]);requireFact(receipt);
   const op=await one<{value:unknown}>(tx,"SELECT CASE WHEN octet_length(operation_json::text)<=131072 THEN operation_json ELSE NULL END AS value FROM ls_fishing_payments.operations WHERE workspace_id=$1 AND id=$2 AND purchase_id=$3 FOR SHARE",[workspace,f.operationId,p.state.purchaseId]);
   const operation=z.object({state:z.literal("confirmed"),providerAccountId:z.literal(p.state.providerAccountId),livemode:z.literal(p.state.livemode),dueId:z.literal(f.dueId),result:z.object({providerObjectId:z.literal(f.relatedProviderObjectId)})}).safeParse(op?.value);requireFact(operation.success);facts.push(f);
  }
  const blank:PaymentState={...p.state,revision:1,paidCents:0,refundedCents:0,feesCents:0,state:"unpaid",dues:p.line.dues,settlements:[],revisedDebt:null};
  const computed=settled(blank,facts.sort((a,b)=>(a.kind==="payment"?0:1)-(b.kind==="payment"?0:1)),this.clock.now().toISOString());
  requireFact(computed.paidCents===p.state.paidCents&&computed.refundedCents===p.state.refundedCents&&computed.feesCents===p.state.feesCents&&computed.dues.every((due,i)=>due.paidCents===p.state.dues[i]?.paidCents)&&digest(computed.settlements.map(value=>[value.kind,value.canonicalTransactionId,value.cents,value.purchaseLineId]).sort())===digest(p.state.settlements.map(value=>[value.kind,value.canonicalTransactionId,value.cents,value.purchaseLineId]).sort()),"UNAVAILABLE");
 }
 setEnrollmentState(actor:Actor,raw:unknown){const input=enrollmentStateCommandSchema.parse(raw);return this.command(actor,input.commandId,"enrollment.state",input,async c=>{
  const e=await this.enrollmentRow(c.tx,c.actor.workspaceId,input.id);this.operator(c,await this.cohort(c.tx,c.actor.workspaceId,e.stageId));
 },async c=>{const rows=await c.tx.query("UPDATE ls_fishing_stage.enrollments SET state=$4,revision=revision+1 WHERE workspace_id=$1 AND id=$2 AND revision=$3 RETURNING revision",[c.actor.workspaceId,input.id,input.expectedRevision,input.state]);requireFact(rows.length===1,"CONFLICT");return {id:input.id,revision:input.expectedRevision+1,state:input.state};});}
 private async enrollmentRow(tx:SqlSession,workspace:string,id:string){const row=await one<EnrollmentRow>(tx,`SELECT ${enrollmentColumns} FROM ls_fishing_stage.enrollments WHERE workspace_id=$1 AND id=$2 FOR SHARE`,[workspace,uuid.parse(id)]);requireFact(row,"NOT_FOUND");return row;}
 /** Root-only native read for an explicit inquiry correlation command. No new
  * transaction, grant, enrollment or payment. The supplied ordinary session is
  * reloaded even on replay; payer guardianship is CURRENT, not a stored flag. */
 async readEnrollmentForInquiryLinkInTransaction(tx:SqlSession,actor:Actor,id:string){
  const c=await this.actor(tx,actor);requireFact(await demoAccountBatch(tx,c.actor.workspaceId,c.actor.id)===null,"FORBIDDEN");
  const row=await this.enrollmentRow(tx,c.actor.workspaceId,uuid.parse(id)),cohort=await this.cohort(tx,c.actor.workspaceId,row.stageId);this.operator(c,cohort);
  const enrollment=await this.enrollment(tx,c.actor.workspaceId,row.id,c.now),p=await this.purchase(tx,c.actor.workspaceId,row.purchaseId);
  requireFact(enrollment.state==="confirmed"&&p.offer.operatorAccountId===c.actor.id,"FORBIDDEN");
  const guardianDigest=await this.guardian(tx,c.actor.workspaceId,p.offer.payerAccountId,enrollment.learnerId,enrollment.householdId);
  return {enrollment,payerAccountId:p.offer.payerAccountId,offerId:p.offer.id,operatorAccountId:c.actor.id,guardianDigest};
 }
 private async enrollment(tx:SqlSession,workspace:string,id:string,now:Date):Promise<EnrollmentProjection>{
  const e=await this.enrollmentRow(tx,workspace,id),cohort=await this.cohort(tx,workspace,e.stageId),p=await this.purchase(tx,workspace,e.purchaseId);
  requireFact(p.line.id===e.purchaseLineId&&p.line.learnerId===e.learnerId&&p.offer.householdId===e.householdId&&p.line.stageId===e.stageId,"UNAVAILABLE");await this.fit(tx,workspace,e.fitDecisionId,e.stageId,e.learnerId,"enrollment");const a=await this.acceptance(tx,workspace,e.termsAcceptanceId,cohort,e.learnerId,p.offer.payerAccountId,e.householdId,now);
  // Historical confirmation is not recomputed from today's paid flag. Current
  // guardians and explicit native enrollment state govern access independently.
  const candidates=await tx.query<{id:string}>(`SELECT account_id AS id FROM ls_education.guardian_authorities WHERE workspace_id=$1 AND learner_id=$2 ORDER BY account_id LIMIT 101`,[workspace,e.learnerId]);requireFact(candidates.length<=100,"UNAVAILABLE");const accounts:EnrollmentProjection["authorizedAccountIds"][number][]=[];
  for(const candidate of candidates){try{await this.guardian(tx,workspace,candidate.id,e.learnerId,e.householdId);accounts.push(asId(candidate.id,"account"));}catch(error){if(!(error instanceof FishingProgramError&&error.code==="FORBIDDEN"))throw error;}}
  if(this.options.childAccountsEnabled){const child=await one<{id:string}>(tx,`SELECT a.id FROM ls_identity.accounts a JOIN ls_identity.account_subjects s ON s.workspace_id=a.workspace_id AND s.account_id=a.id WHERE a.workspace_id=$1 AND s.person_id=$2 AND a.role='child' AND a.state='active' AND a.email_verified_at<=clock_timestamp()
   AND NOT EXISTS(SELECT 1 FROM ls_education.access_revocations r WHERE r.workspace_id=a.workspace_id AND(r.account_id IS NULL OR r.account_id=a.id)AND(r.learner_id IS NULL OR r.learner_id=s.person_id)AND r.module_id IS NULL AND r.version IS NULL) FOR SHARE OF a,s`,[workspace,e.learnerId]);if(child&&accounts.length)accounts.push(asId(child.id,"account"));}
  return {id:e.id,revision:e.revision,workspaceId:asId(workspace,"workspace"),program:"sunday_fishing_academy",cohortId:cohort.cohortId,stageId:cohort.stageId,stage:cohort.stage,purchaseId:e.purchaseId,purchaseLineId:e.purchaseLineId,learnerId:asId(e.learnerId,"person"),householdId:e.householdId,state:e.state,authorizedAccountIds:accounts,evidence:{verifiedGuardianBindingId:e.guardianDigest,capacityReservationId:e.holdId,fitDecisionId:e.fitDecisionId,acceptedTermsVersion:(programTermsSchema.parse((await this.source(tx,workspace,a.sourceApprovalId,"terms",now)).payload)).termsVersion,ownerActionId:e.commandId}};
 }
 async readEnrollment(actor:Actor,id:string):Promise<EnrollmentProjection|null>{try{return await this.db.transaction(async tx=>{
  const c=await this.actor(tx,actor),e=await this.enrollment(tx,c.actor.workspaceId,id,c.now),cohort=await this.cohort(tx,c.actor.workspaceId,e.stageId);if(c.actor.role==="practitioner"&&cohort.operatorId===c.actor.id){await this.actor(tx,actor);return e;}
  if(e.state!=="confirmed"||!e.authorizedAccountIds.includes(c.actor.id)||c.actor.role==="child"&&(!this.options.childAccountsEnabled||c.actor.personId!==e.learnerId)||!["parent","child"].includes(c.actor.role))return null;await this.actor(tx,actor);return e;
 });}catch(error){if(error instanceof FishingProgramError&&["NOT_FOUND","FORBIDDEN"].includes(error.code))return null;clean(error);}}
 /** Read-only current selected-enrollment payment projection. No merchant,
  * provider action, invitation, settlement write or implicit enrollment. */
 async familyPayment(actor:Actor,enrollmentId:string):Promise<FamilyPaymentView|null>{
  try{return await this.db.transaction(async tx=>{
   const c=await this.actor(tx,actor);requireFact(c.actor.role==='parent'&&await demoAccountBatch(tx,c.actor.workspaceId,c.actor.id)===null,'FORBIDDEN');
   const e=await this.enrollment(tx,c.actor.workspaceId,uuid.parse(enrollmentId),c.now);
   requireFact(e.state==='confirmed'&&e.authorizedAccountIds.includes(c.actor.id),'NOT_FOUND');
   const p=await this.purchase(tx,c.actor.workspaceId,e.purchaseId);
   if(p.offer.payerAccountId!==c.actor.id){await this.actor(tx,actor);return null;}
   // Read the existing native ledger; this read neither verifies a processor
   // transport nor grants enrollment from a paid flag. Confirmation remains
   // governed separately by paymentFacts and an admitted merchant binding.
   await this.guardian(tx,c.actor.workspaceId,c.actor.id,e.learnerId,e.householdId);
   const operations=await tx.query<{operation:unknown}>("SELECT CASE WHEN octet_length(operation_json::text)<=131072 THEN operation_json ELSE NULL END AS operation FROM ls_fishing_payments.operations WHERE workspace_id=$1 AND purchase_id=$2 LIMIT 101",[c.actor.workspaceId,e.purchaseId]);
   const operation=z.object({state:z.enum(['reserved','unknown','confirmed'])});requireFact(operations.length<=100&&operations.every(row=>operation.safeParse(row.operation).success),'UNAVAILABLE');
   const unknown=operations.some(row=>operation.parse(row.operation).state==='unknown');await this.actor(tx,actor);
   return familyPayment(unknown?{...p.state,state:'reconciliation_required'}:p.state);
  });}catch(error){clean(error);}
 }
 /** Metadata only. Never supplies an enrollment, grant, merchant or first-child
  * default. Catalog absence is distinct from a broken/partially installed schema. */
 /** Same-transaction consumer of current native cohorts, fit and actual approved
  * terms text. No source importer/approval control, roster or private fit note. */
 async enrollmentReviewInTransaction(tx:SqlSession,actor:Actor,family:{learnerId:string;householdId:string;parentAccountId:string}):Promise<AcademyEnrollmentStage[]>{
  try{const c=await this.actor(tx,actor);requireFact(c.actor.role==='practitioner'||c.actor.role==='parent'&&c.actor.id===family.parentAccountId,'FORBIDDEN');requireFact(await demoAccountBatch(tx,c.actor.workspaceId,c.actor.id)===null,'FORBIDDEN');
   if(c.actor.role==='parent')await this.guardian(tx,c.actor.workspaceId,c.actor.id,family.learnerId,family.householdId);
   if(!await this.calendarCatalog(tx))return [];
   const rows=await tx.query<{stageId:string}>(`SELECT stage_id AS "stageId" FROM ls_fishing_stage.cohorts WHERE workspace_id=$1 AND active AND ($2::uuid IS NULL OR operator_id=$2) ORDER BY stage_id LIMIT 1001 FOR SHARE`,[c.actor.workspaceId,c.actor.role==='practitioner'?c.actor.id:null]);requireFact(rows.length<=1000,'UNAVAILABLE');
   const result:AcademyEnrollmentStage[]=[];
   for(const row of rows){const cohort=await this.cohort(tx,c.actor.workspaceId,row.stageId),fits=await tx.query<{id:string;decision:'approved'|'rejected';recordedAt:Date}>(`SELECT id,decision,recorded_at AS "recordedAt" FROM ls_fishing_stage.fit_decisions WHERE workspace_id=$1 AND stage_id=$2 AND learner_id=$3 AND purpose='enrollment' ORDER BY recorded_at DESC,id DESC LIMIT 1001 FOR SHARE`,[c.actor.workspaceId,row.stageId,family.learnerId]);requireFact(fits.length<=1000,'UNAVAILABLE');
    const latest=fits[0],tied=latest?fits.filter(f=>f.recordedAt.valueOf()===latest.recordedAt.valueOf()):[],current=tied.find(f=>f.decision==='rejected')??latest;
    if(c.actor.role==='parent'&&current?.decision!=='approved')continue;
    const source=await this.source(tx,c.actor.workspaceId,cohort.termsApprovalId,'terms',c.now),terms=programTermsSchema.parse(source.payload);requireFact(terms.contentSha256===source.hash&&terms.termsVersion===source.version,'UNAVAILABLE');
    let presented:AcademyEnrollmentStage['terms']={state:'unavailable'};
    if(terms.document){requireFact(createHash('sha256').update(terms.document.body,'utf8').digest('hex')===source.hash,'UNAVAILABLE');const accepted=await one<{id:string;hash:string}>(tx,`SELECT id,source_sha256 AS hash FROM ls_fishing_stage.terms_acceptances WHERE workspace_id=$1 AND stage_id=$2 AND learner_id=$3 AND parent_id=$4 AND household_id=$5 AND source_approval_id=$6 FOR SHARE`,[c.actor.workspaceId,row.stageId,family.learnerId,family.parentAccountId,family.householdId,cohort.termsApprovalId]);if(accepted)requireFact(accepted.hash===source.hash,'UNAVAILABLE');presented={state:'available',sourceApprovalId:cohort.termsApprovalId,sourceSha256:source.hash,termsVersion:terms.termsVersion,body:terms.document.body,acceptanceId:accepted?.id??null};}
    const name=z.object({label}).parse(this.decode('cohort',c.actor.workspaceId,row.stageId,cohort.labelCiphertext)).label;
    result.push({stageId:row.stageId,cohortId:cohort.cohortId,stage:cohort.stage,label:name,fit:current?{id:current.id,decision:current.decision,recordedAt:current.recordedAt.toISOString()}:null,terms:presented});
   }await this.actor(tx,actor);return result;
  }catch(error){clean(error);}
 }
 async calendarChoices(actor:Actor,selectedLearnerId:string|null=null):Promise<FishingCalendarChoices>{
  try{return await this.db.transaction(async tx=>{
   const c=await this.actor(tx,actor);requireFact(["practitioner","parent","child"].includes(c.actor.role),"FORBIDDEN");
   requireFact(await demoAccountBatch(tx,c.actor.workspaceId,c.actor.id)===null,"FORBIDDEN");
   if(selectedLearnerId!==null)uuid.parse(selectedLearnerId);
   if(c.actor.role==="practitioner")requireFact(selectedLearnerId===null,"INVALID_REQUEST");
   if(c.actor.role==="child")requireFact(this.options.childAccountsEnabled&&(selectedLearnerId===null||selectedLearnerId===c.actor.personId),"FORBIDDEN");
   const ready=await this.calendarCatalog(tx);
   if(!ready){await this.actor(tx,actor);return fishingCalendarChoicesSchema.parse({availability:"not_configured",role:c.actor.role,children:[],selectedLearnerId:null,stages:[]});}
   let children:FishingCalendarChoices["children"]=[],selected:string|null=c.actor.role==="child"?c.actor.personId:selectedLearnerId;
   if(c.actor.role==="parent"){
    const context=await readEducationalChildContexts(tx,actor,this.ring,c.now,selectedLearnerId);children=[...context.children];selected=context.selectedLearnerId;
   }else if(c.actor.role==="child"){
    const row=await one<{ciphertext:string}>(tx,"SELECT profile_ciphertext AS ciphertext FROM ls_identity.people WHERE workspace_id=$1 AND id=$2 AND kind='minor' FOR SHARE",[c.actor.workspaceId,c.actor.personId]);requireFact(row,"FORBIDDEN");
    const displayName=z.object({displayName:label}).parse(JSON.parse(unseal(row.ciphertext,`person:${c.actor.workspaceId}:${c.actor.personId}`,this.ring))).displayName;children=[{learnerId:c.actor.personId,displayName}];
   }
   const stages:FishingCalendarChoices["stages"]=[];
   const add=async(stageId:string,enrollmentId:string|null,learnerId:string|null)=>{
    const cohort=await this.cohort(tx,c.actor.workspaceId,stageId),source=await this.source(tx,c.actor.workspaceId,cohort.templateApprovalId,"template",c.now);
    await this.template(tx,c.actor.workspaceId,cohort,source.version,c.now);
    const name=z.object({label}).parse(this.decode("cohort",c.actor.workspaceId,stageId,cohort.labelCiphertext)).label;
    stages.push({stageId,cohortId:cohort.cohortId,stage:cohort.stage,label:name,enrollmentId,learnerId,templateVersion:source.version,childCapacity:cohort.capacity});
   };
   if(c.actor.role==="practitioner"){
    const rows=await tx.query<{stageId:string}>("SELECT stage_id AS \"stageId\" FROM ls_fishing_stage.cohorts WHERE workspace_id=$1 AND operator_id=$2 AND active ORDER BY stage_id LIMIT 1001 FOR SHARE",[c.actor.workspaceId,c.actor.id]);requireFact(rows.length<=fishingCalendarLimit,"UNAVAILABLE");
    for(const row of rows)await add(row.stageId,null,null);
   }else if(selected!==null){
    const rows=await tx.query<{id:string}>("SELECT id FROM ls_fishing_stage.enrollments WHERE workspace_id=$1 AND learner_id=$2 AND state='confirmed' ORDER BY id LIMIT 1001 FOR SHARE",[c.actor.workspaceId,selected]);requireFact(rows.length<=fishingCalendarLimit,"UNAVAILABLE");
    for(const row of rows){const e=await this.enrollment(tx,c.actor.workspaceId,row.id,c.now);if(e.state==="confirmed"&&e.learnerId===selected&&e.authorizedAccountIds.includes(c.actor.id))await add(e.stageId,e.id,e.learnerId);}
   }
   await this.actor(tx,actor);
   return fishingCalendarChoicesSchema.parse({availability:"ready",role:c.actor.role,children,selectedLearnerId:selected,stages});
  });}catch(error){clean(error);}
 }
 private async calendarCatalog(tx:SqlSession):Promise<boolean>{
  const payment=["campaigns","commands","founder_households","inbox","offers","operations","outbox","purchases","reminders","settlements"],stage=["cohorts","command_receipts","enrollments","fit_decisions","makeup_links","occurrences","offer_approvals","operations","plans","resource_reservations","revisions","seat_reservations","source_approvals","terms_acceptances","venues"];
  const names=[...payment.map(name=>`ls_fishing_payments.${name}`),...stage.map(name=>`ls_fishing_stage.${name}`)];
  const rows=await tx.query<{name:string;relation:string|null;kind:string|null}>(`SELECT e.name,c.oid::regclass::text AS relation,c.relkind AS kind FROM unnest(ARRAY[${names.map((_,index)=>`$${index+1}`).join(',')}]::text[]) AS e(name) LEFT JOIN pg_class c ON c.oid=to_regclass(e.name) ORDER BY e.name`,names);requireFact(rows.length===25,"UNAVAILABLE");
  const namespaces=await tx.query<{name:string;present:boolean}>("SELECT name,to_regnamespace(name) IS NOT NULL AS present FROM unnest(ARRAY[$1,$2]::text[]) AS e(name) ORDER BY name",["ls_fishing_payments","ls_fishing_stage"]);requireFact(namespaces.length===2,"UNAVAILABLE");
  if(rows.every(row=>row.relation===null)&&namespaces.every(row=>row.present===false))return false;
  requireFact(namespaces.every(row=>row.present===true)&&rows.every(row=>row.relation===row.name&&row.kind==="r"),"UNAVAILABLE");
  // The reviewed Stripe bindings are an optional, indivisible catalog slice.
  // Their presence never activates a merchant or permits an incomplete slice.
  const stripeNames=["ls_fishing_payments.customer_bindings","ls_fishing_payments.object_bindings"];
  const stripe=await tx.query<{name:string;relation:string|null;kind:string|null}>("SELECT e.name,c.oid::regclass::text AS relation,c.relkind AS kind FROM unnest(ARRAY[$1,$2]::text[]) AS e(name) LEFT JOIN pg_class c ON c.oid=to_regclass(e.name) ORDER BY e.name",stripeNames);
  requireFact(stripe.length===2&&stripe.every((row,index)=>row.name===stripeNames[index]),"UNAVAILABLE");
  const stripeAbsent=stripe.every(row=>row.relation===null&&row.kind===null),stripeReady=stripe.every(row=>row.relation===row.name&&row.kind==="r");
  requireFact(stripeAbsent||stripeReady,"UNAVAILABLE");
  const functions=await tx.query<{name:string}>("SELECT n.nspname||'.'||p.proname AS name FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=ANY(ARRAY[$1,$2]::text[]) ORDER BY name",["ls_fishing_payments","ls_fishing_stage"]);
  const expectedFunctions=["ls_fishing_stage.reject_program_history_rewrite","ls_fishing_stage.verify_program_stage_receipt",...(stripeReady?["ls_fishing_payments.preserve_stripe_binding"]:[])].sort();
  requireFact(JSON.stringify(functions.map(row=>row.name))===JSON.stringify(expectedFunctions),"UNAVAILABLE");
  const triggers=await tx.query<{name:string}>("SELECT c.relname||':'||t.tgname AS name FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=ANY(ARRAY[$1,$2]::text[]) AND NOT t.tgisinternal ORDER BY name",["ls_fishing_payments","ls_fishing_stage"]);
  const expectedTriggers=["command_receipts:exact_program_stage_receipt","command_receipts:immutable_program_commands","fit_decisions:immutable_program_fit","offer_approvals:immutable_program_offers","source_approvals:immutable_program_sources","terms_acceptances:immutable_program_terms",...(stripeReady?["customer_bindings:preserve_customer_binding","object_bindings:preserve_object_binding"]:[])].sort();
  requireFact(JSON.stringify(triggers.map(row=>row.name))===JSON.stringify(expectedTriggers),"UNAVAILABLE");return true;
 }
 async calendarOperatorChoices(actor:Actor,reference:FishingStageRef){
  try{return await this.db.transaction(async tx=>{
   const c=await this.actor(tx,actor);this.operator(c);const cohort=await this.cohort(tx,c.actor.workspaceId,reference.stageId);this.operator(c,cohort);requireFact(cohort.cohortId===reference.cohortId&&cohort.stage===reference.stage,"NOT_FOUND");
   requireFact(await demoAccountBatch(tx,c.actor.workspaceId,c.actor.id)===null,"FORBIDDEN");
   const venues=await tx.query<{id:string;capacity:number;ciphertext:string}>("SELECT id,capacity,details_ciphertext AS ciphertext FROM ls_fishing_stage.venues WHERE workspace_id=$1 AND operator_id=$2 AND active ORDER BY id LIMIT 1001 FOR SHARE",[c.actor.workspaceId,c.actor.id]);requireFact(venues.length<=fishingCalendarLimit,"UNAVAILABLE");
   const entries=await tx.query<{id:string}>("SELECT id FROM ls_fishing_stage.enrollments WHERE workspace_id=$1 AND stage_id=$2 AND state='confirmed' ORDER BY id LIMIT 1001 FOR SHARE",[c.actor.workspaceId,cohort.stageId]);requireFact(entries.length<=fishingCalendarLimit,"UNAVAILABLE");
   const roster:FishingCalendarOperator["roster"]=[];
   for(const entry of entries){const e=await this.enrollment(tx,c.actor.workspaceId,entry.id,c.now),person=await one<{ciphertext:string}>(tx,"SELECT profile_ciphertext AS ciphertext FROM ls_identity.people WHERE workspace_id=$1 AND id=$2 AND kind='minor' FOR SHARE",[c.actor.workspaceId,e.learnerId]);requireFact(person,"UNAVAILABLE");
    const displayName=z.object({displayName:label}).parse(JSON.parse(unseal(person.ciphertext,`person:${c.actor.workspaceId}:${e.learnerId}`,this.ring))).displayName;roster.push({enrollmentId:e.id,learnerId:e.learnerId,displayName});}
   const present=await one(tx,"SELECT stage_id FROM ls_fishing_stage.plans WHERE workspace_id=$1 AND stage_id=$2",[c.actor.workspaceId,cohort.stageId]);
   const state=present?await this.plan(tx,c.actor.workspaceId,cohort.stageId):null;
   const makeupNotices=(state?.makeups??[]).filter(m=>!m.notice.replacementOccurrenceId&&roster.some(e=>e.enrollmentId===m.notice.enrollmentId)).map(m=>({id:m.notice.id,enrollmentId:m.notice.enrollmentId,learnerId:roster.find(e=>e.enrollmentId===m.notice.enrollmentId)!.learnerId}));
   const fits=await tx.query<{id:string;learnerId:string;targetId:string;targetRevision:number;targetStageId:string}>(`SELECT f.id,f.learner_id AS "learnerId",f.target_occurrence_id AS "targetId",f.target_revision AS "targetRevision",o.stage_id AS "targetStageId" FROM ls_fishing_stage.fit_decisions f JOIN ls_fishing_stage.occurrences o ON o.workspace_id=f.workspace_id AND o.id=f.target_occurrence_id
    WHERE f.workspace_id=$1 AND f.stage_id=$2 AND f.purpose='makeup' AND f.decision='approved' ORDER BY f.id LIMIT 1001 FOR SHARE OF f,o`,[c.actor.workspaceId,cohort.stageId]);requireFact(fits.length<=fishingCalendarLimit,"UNAVAILABLE");
   const makeupFits:FishingCalendarOperator["makeupFits"]=[];
   for(const fit of fits){
    if(!roster.some(e=>e.learnerId===fit.learnerId))continue;
    const targetCohort=await this.cohort(tx,c.actor.workspaceId,fit.targetStageId);this.operator(c,targetCohort);
    const target=(await this.plan(tx,c.actor.workspaceId,fit.targetStageId)).occurrences.find(o=>o.id===fit.targetId);requireFact(target,"UNAVAILABLE");
    if(target.stage!==cohort.stage||target.state!=="published"||target.time.kind!=="scheduled"||target.revision!==fit.targetRevision||Date.parse(target.time.startsAt)<=c.now.valueOf())continue;
    await this.targetResources(tx,{actor:c.actor,scope:{stageId:targetCohort.stageId,cohortId:targetCohort.cohortId,stage:targetCohort.stage,workspaceId:c.actor.workspaceId,program:"sunday_fishing_academy"},selectedEnrollmentId:null,now:c.now},target);
    makeupFits.push({id:fit.id,learnerId:fit.learnerId,occurrenceId:target.id,revision:target.revision,startsAt:target.time.startsAt,label:target.location});
   }
   await this.actor(tx,actor);
   return fishingCalendarOperatorSchema.parse({venues:venues.map(row=>({id:row.id,capacity:row.capacity,...z.object({label,address:z.string().max(1200)}).parse(this.decode("venue",c.actor.workspaceId,row.id,row.ciphertext))})),roster,makeupNotices,makeupFits});
  });}catch(error){clean(error);}
 }
 /** Partial existing payment port only; withdrawal/reminder/native provider
  * activation are NOT supplied or silently defaulted by this integration. */
 paymentApprovalAuthority():Pick<FishingAuthority,"loadApprovedOffer"|"authorize">{return {
  loadApprovedOffer:async(tx,actor,id)=>{await lockWorkspace(tx,actor.workspaceId);const {offer}=await this.approved(tx,actor.workspaceId,id),cohort=await this.cohort(tx,actor.workspaceId,offer.lines[0]!.stageId);const account=await one<{role:string}>(tx,"SELECT role FROM ls_identity.accounts WHERE workspace_id=$1 AND id=$2 AND state='active' AND email_verified_at<=clock_timestamp() FOR SHARE",[actor.workspaceId,actor.id]);if(account?.role==="practitioner"&&cohort.operatorId===actor.id)return offer;if(account?.role!=="parent"||offer.payerAccountId!==actor.id)return null;for(const line of offer.lines)await this.guardian(tx,actor.workspaceId,actor.id,line.learnerId,offer.householdId);return offer;},
  authorize:async(tx,actor,offer,action)=>{await lockWorkspace(tx,actor.workspaceId);const native=await this.approved(tx,actor.workspaceId,offer.id);requireFact(digest(native.offer)===digest(offer),"CONFLICT");
   const cohort=await this.cohort(tx,actor.workspaceId,offer.lines[0]!.stageId),account=await one<{role:string}>(tx,"SELECT role FROM ls_identity.accounts WHERE workspace_id=$1 AND id=$2 AND state='active' AND email_verified_at<=clock_timestamp() FOR SHARE",[actor.workspaceId,actor.id]),operator=account?.role==="practitioner"&&cohort.operatorId===actor.id;
   if(action==="reminder")return false;if(action==="refund")return operator;if(action==="read"&&operator)return true;
   if(action==="issue"||action==="hosted"){
    const merchant=this.options.merchant;requireFact(merchant,"POLICY_REQUIRED");if(action==="hosted"){
     const issued=await tx.query<{state:unknown}>("SELECT CASE WHEN octet_length(state_json::text)<=131072 THEN state_json ELSE NULL END AS state FROM ls_fishing_payments.purchases WHERE workspace_id=$1 AND offer_id=$2 LIMIT 21 FOR SHARE",[actor.workspaceId,offer.id]);
     requireFact(issued.length===offer.lines.length&&issued.length<=20&&issued.every(row=>z.object({offerId:z.literal(offer.id),providerAccountId:z.literal(merchant.accountId),livemode:z.literal(merchant.livemode),currency:z.literal("USD")}).safeParse(row.state).success));
    }
   }
   if(!operator&&(action==="issue"||account?.role!=="parent"||actor.id!==offer.payerAccountId))return false;
   for(const line of offer.lines){await this.guardian(tx,actor.workspaceId,offer.payerAccountId,line.learnerId,offer.householdId);if(action==="issue"||action==="hosted"){
    requireFact((action!=="issue"||Date.parse(offer.expiresAt)>this.clock.now().valueOf())&&line.stageId===cohort.stageId&&native.policyId===cohort.policyApprovalId);await this.fit(tx,actor.workspaceId,line.eligibility.evidenceId,line.stageId,line.learnerId,"enrollment");const held=await this.hold(tx,actor.workspaceId,line.capacity.reservationId,line.stageId,line.learnerId);requireFact(held.every(row=>row.offerId===offer.id&&row.holdRevision===line.capacity.revision&&row.state!=="released"));
   }}return true;}
 };}
 private async hookContext(tx:SqlSession,c:NativeStageHookContext,ref:FishingStageRef=c.scope){
  requireFact(await demoAccountBatch(tx,c.actor.workspaceId,c.actor.id)===null,"FORBIDDEN");
  const account=await one<{role:string;state:string}>(tx,"SELECT role,state FROM ls_identity.accounts WHERE workspace_id=$1 AND id=$2 AND state='active' AND email_verified_at<=clock_timestamp() FOR SHARE",[c.actor.workspaceId,c.actor.id]);requireFact(account&&account.role===c.actor.role,"FORBIDDEN");const cohort=await this.cohort(tx,c.actor.workspaceId,ref.stageId);requireFact(cohort.cohortId===ref.cohortId&&cohort.stage===ref.stage,"NOT_FOUND");return cohort;
 }
 stageHooks(rawIntent:NativeProgramCommandIntent|null):FishingStageNativeHooks{
  const intent=rawIntent===null?null:Object.freeze(nativeProgramIntentSchema.parse(structuredClone(rawIntent)));
  const hooks:FishingStageNativeHooks={
   resolveContext:async(tx,actor,ref,selection,now)=>{
    const hc:NativeStageHookContext={actor,scope:{...ref,workspaceId:actor.workspaceId,program:"sunday_fishing_academy"},selectedEnrollmentId:selection.selectedEnrollmentId,now},cohort=await this.hookContext(tx,hc);
    const profile=await one<{ciphertext:string;personId:string}>(tx,`SELECT p.profile_ciphertext AS ciphertext,s.person_id AS "personId" FROM ls_identity.account_subjects s JOIN ls_identity.people p ON p.workspace_id=s.workspace_id AND p.id=s.person_id JOIN ls_identity.accounts a ON a.workspace_id=s.workspace_id AND a.id=s.account_id
     WHERE s.workspace_id=$1 AND s.account_id=$2 AND a.role='practitioner' AND a.state='active' AND a.email_verified_at<=clock_timestamp() FOR SHARE OF s,p,a`,[actor.workspaceId,cohort.instructorId]);requireFact(profile);
    const displayName=z.object({displayName:label}).parse(JSON.parse(unseal(profile.ciphertext,`person:${actor.workspaceId}:${profile.personId}`,this.ring))).displayName;
    const e=selection.selectedEnrollmentId===null?null:await this.enrollment(tx,actor.workspaceId,selection.selectedEnrollmentId,now);if(e)requireFact(e.stageId===ref.stageId&&e.cohortId===ref.cohortId&&e.stage===ref.stage,"FORBIDDEN");
    const isOperator=actor.role==="practitioner"&&cohort.operatorId===actor.id;if(!isOperator&&(!e||e.state!=="confirmed"||!e.authorizedAccountIds.includes(actor.id)))return null;
    return {scope:hc.scope,instructor:{accountId:asId(cohort.instructorId,"account"),displayName},operatorAccountIds:[cohort.operatorId],approvedChildCapacity:cohort.capacity,enrollment:e,guardianRelationshipCurrent:actor.role==="parent"&&!!e&&e.authorizedAccountIds.includes(actor.id),childAccountEnabled:this.options.childAccountsEnabled};
   },
   resolveApprovedTemplate:async(tx,c,version)=>{const cohort=await this.hookContext(tx,c);return this.template(tx,c.actor.workspaceId,cohort,version,c.now);},
   readEnrollment:async(tx,c,id)=>{const cohort=await this.hookContext(tx,c);requireFact(c.actor.role==="practitioner"&&cohort.operatorId===c.actor.id,"FORBIDDEN");return this.enrollment(tx,c.actor.workspaceId,id,c.now);},
   occupiedSeats:async(tx,c,id)=>{const cohort=await this.hookContext(tx,c);requireFact(c.actor.role==="practitioner"&&cohort.operatorId===c.actor.id,"FORBIDDEN");const target=await one(tx,"SELECT id FROM ls_fishing_stage.occurrences WHERE workspace_id=$1 AND id=$2",[c.actor.workspaceId,id]);requireFact(target,"NOT_FOUND");return this.countSeats(tx,c.actor.workspaceId,id);},
   reconcileResources:async(tx,c,before,after)=>{await this.resources(tx,c,before,after,intent);},
   replacementSuitable:async(tx,c,e,target)=>{await this.hookContext(tx,c);requireFact(intent?.makeupFitDecisionId);await this.fit(tx,c.actor.workspaceId,intent.makeupFitDecisionId,e.stageId,e.learnerId,"makeup",target);return target.stage===e.stage&&target.program===e.program;},
   reserveMakeup:async(tx,c,input)=>{const cohort=await this.hookContext(tx,c);requireFact(intent&&intent.makeupFitDecisionId&&c.actor.role==="practitioner"&&cohort.operatorId===c.actor.id,"FORBIDDEN");const e=await this.enrollment(tx,c.actor.workspaceId,input.enrollment.id,c.now);requireFact(e.state==="confirmed"&&digest(e)===digest(input.enrollment),"CONFLICT");await this.fit(tx,c.actor.workspaceId,intent.makeupFitDecisionId,e.stageId,e.learnerId,"makeup",input.target);requireFact(input.target.revision===input.expectedRevision,"CONFLICT");await this.targetResources(tx,c,input.target);requireFact(await this.countSeats(tx,c.actor.workspaceId,input.target.id)<input.target.childCapacity,"CAPACITY");
    const id=randomUUID();await tx.query(`INSERT INTO ls_fishing_stage.seat_reservations(workspace_id,id,hold_id,stage_id,occurrence_id,learner_id,origin,enrollment_id,entitlement_id,state,revision,hold_revision,actor_id,command_id,stage_operation_id) VALUES($1,$2,$2,$3,$4,$5,'makeup',$6,$7,'reserved',1,1,$8,$9,$9)`,[c.actor.workspaceId,id,input.target.stageId,input.target.id,e.learnerId,e.id,input.entitlementId,c.actor.id,intent.operationId]);
    // A stage resource receipt is the shared atomic bridge for seat-only effects.
    await this.stageReceipt(tx,c,intent.operationId,{makeup:{id,enrollmentId:e.id,entitlementId:input.entitlementId,occurrenceId:input.target.id}});return id;
   }
  };
  const guard=<A extends unknown[],R>(work:(...args:A)=>Promise<R>)=>async(...args:A):Promise<R>=>{try{return await work(...args);}catch(error){if(!(error instanceof FishingProgramError))throw error;
   if(error.code==="UNAVAILABLE")throw new AppError("UNAVAILABLE");throw new FishingStageError(error.code==="POLICY_REQUIRED"?"APPROVAL_REQUIRED":error.code==="INVALID_REQUEST"?"INVALID_STATE":error.code);}};
  return {resolveContext:guard(hooks.resolveContext),resolveApprovedTemplate:guard(hooks.resolveApprovedTemplate),readEnrollment:guard(hooks.readEnrollment),occupiedSeats:guard(hooks.occupiedSeats),reconcileResources:guard(hooks.reconcileResources),replacementSuitable:guard(hooks.replacementSuitable),reserveMakeup:guard(hooks.reserveMakeup)};
 }
 private async targetResources(tx:SqlSession,c:NativeStageHookContext,target:CanonicalOccurrence){
  requireFact(target.time.kind==="scheduled"&&target.state==="published");const time=target.time,cohort=await this.hookContext(tx,c,target);requireFact(target.childCapacity<=cohort.capacity);
  const rows=await tx.query<{kind:string;resourceId:string;startsAt:Date;endsAt:Date;revision:number}>(`SELECT kind,resource_id AS "resourceId",starts_at AS "startsAt",ends_at AS "endsAt",occurrence_revision AS revision FROM ls_fishing_stage.resource_reservations WHERE workspace_id=$1 AND occurrence_id=$2 AND active ORDER BY kind LIMIT 3 FOR SHARE`,[c.actor.workspaceId,target.id]);
  requireFact(rows.length===2&&rows.every(row=>row.revision===target.revision&&row.startsAt.toISOString()===time.startsAt&&row.endsAt.toISOString()===time.endsAt));
  requireFact(rows.some(row=>row.kind==="instructor"&&row.resourceId===target.instructor.accountId));const venue=rows.find(row=>row.kind==="venue");requireFact(venue);
  requireFact(await one(tx,"SELECT id FROM ls_fishing_stage.venues WHERE workspace_id=$1 AND id=$2 AND operator_id=$3 AND active AND capacity>=$4 FOR SHARE",[c.actor.workspaceId,venue.resourceId,cohort.operatorId,target.childCapacity]));
 }
 private async stageReceipt(tx:SqlSession,c:NativeStageHookContext,operationId:string,body:unknown){
  const hash=digest(body),key=`${c.actor.id}:${operationId}:stage.resources:${hash}`;
  const current=await one<{revision:number}>(tx,"SELECT revision FROM ls_fishing_stage.plans WHERE workspace_id=$1 AND stage_id=$2 FOR SHARE",[c.actor.workspaceId,c.scope.stageId]);requireFact(current,"UNAVAILABLE");
  await tx.query(`INSERT INTO ls_fishing_stage.command_receipts(workspace_id,actor_id,command_id,action,request_sha256,result_ciphertext,recorded_at,stage_operation_id,source_stage_id,expected_stage_revision) VALUES($1,$2,$3,'stage.resources',$4,$5,$6,$3,$7,$8)`,[c.actor.workspaceId,c.actor.id,operationId,hash,this.encode("receipt",c.actor.workspaceId,key,body),c.now,c.scope.stageId,current.revision+1]);
 }
 private async resources(tx:SqlSession,c:NativeStageHookContext,before:readonly CanonicalOccurrence[],after:readonly CanonicalOccurrence[],intent:NativeProgramCommandIntent|null){
  const cohort=await this.hookContext(tx,c);requireFact(intent&&c.actor.role==="practitioner"&&cohort.operatorId===c.actor.id,"FORBIDDEN");requireFact(after.length===12&&new Set(after.map(o=>o.id)).size===12,"UNAVAILABLE");
  const prior=await tx.query<{occurrenceId:string;kind:string;resourceId:string;startsAt:Date;endsAt:Date;active:boolean}>(`SELECT r.occurrence_id AS "occurrenceId",r.kind,r.resource_id AS "resourceId",r.starts_at AS "startsAt",r.ends_at AS "endsAt",r.active FROM ls_fishing_stage.resource_reservations r JOIN ls_fishing_stage.occurrences o ON o.workspace_id=r.workspace_id AND o.id=r.occurrence_id WHERE r.workspace_id=$1 AND o.stage_id=$2 ORDER BY r.occurrence_id,r.kind LIMIT 25 FOR UPDATE OF r`,[c.actor.workspaceId,c.scope.stageId]);requireFact(prior.length<=24,"UNAVAILABLE");
  const effects=[];
  for(const occurrence of after){requireFact(occurrence.stageId===c.scope.stageId&&occurrence.cohortId===c.scope.cohortId&&occurrence.instructor.accountId===cohort.instructorId&&occurrence.childCapacity<=cohort.capacity);
   const choice=intent.resources.find(value=>value.occurrenceId===occurrence.id),old=before.find(value=>value.id===occurrence.id);if(choice)requireFact(old?.revision===choice.expectedRevision,"CONFLICT");
   if(occurrence.time.kind==="undated"||occurrence.state==="cancelled"||occurrence.state==="completed"){
    requireFact(!choice,"INVALID_REQUEST");
    await tx.query("UPDATE ls_fishing_stage.resource_reservations SET active=false,occurrence_revision=$3,actor_id=$4,command_id=$5 WHERE workspace_id=$1 AND occurrence_id=$2",[c.actor.workspaceId,occurrence.id,occurrence.revision,c.actor.id,intent.operationId]);effects.push({occurrenceId:occurrence.id,active:false});continue;
   }
   const venueId=choice?.venueId??prior.find(value=>value.occurrenceId===occurrence.id&&value.kind==="venue")?.resourceId;requireFact(venueId);
   const venue=await one<{capacity:number;operatorId:string;ciphertext:string}>(tx,"SELECT capacity,operator_id AS \"operatorId\",details_ciphertext AS ciphertext FROM ls_fishing_stage.venues WHERE workspace_id=$1 AND id=$2 AND active FOR SHARE",[c.actor.workspaceId,venueId]);requireFact(venue&&venue.operatorId===cohort.operatorId&&venue.capacity>=occurrence.childCapacity);
   const place=z.object({label,address:z.string().max(1200)}).parse(this.decode("venue",c.actor.workspaceId,venueId,venue.ciphertext));requireFact(occurrence.location===place.label||occurrence.location===`${place.label}\n${place.address}`);
   const windows=await tx.query<{startsAt:Date;endsAt:Date;kind:"open"|"blocked";id:string;version:number}>("SELECT id,starts_at AS \"startsAt\",ends_at AS \"endsAt\",kind,version FROM ls_calendar.availability WHERE workspace_id=$1 AND practitioner_id=$2 AND active AND starts_at<$4::timestamptz AND ends_at>$3::timestamptz ORDER BY starts_at,id LIMIT 501 FOR SHARE",[c.actor.workspaceId,cohort.instructorId,occurrence.time.startsAt,occurrence.time.endsAt]);requireFact(windows.length<=500,"UNAVAILABLE");
   const clinical=await tx.query<{startsAt:Date;endsAt:Date}>(`SELECT a.starts_at-a.buffer_before*interval '1 minute' AS "startsAt",a.ends_at+a.buffer_after*interval '1 minute' AS "endsAt" FROM ls_calendar.appointments a WHERE a.workspace_id=$1 AND a.practitioner_id=$2 AND a.status='scheduled' AND a.starts_at-a.buffer_before*interval '1 minute'<$4::timestamptz AND a.ends_at+a.buffer_after*interval '1 minute'>$3::timestamptz AND NOT EXISTS(SELECT 1 FROM ls_demo.cases d WHERE d.workspace_id=a.workspace_id AND d.case_id=a.case_id) LIMIT 1001 FOR SHARE OF a`,[c.actor.workspaceId,cohort.instructorId,occurrence.time.startsAt,occurrence.time.endsAt]);requireFact(clinical.length<=1000,"UNAVAILABLE");
   assertAvailable(occurrence.time,windows.map(value=>({...value,startsAt:value.startsAt.toISOString(),endsAt:value.endsAt.toISOString()})),clinical.map(value=>({startsAt:value.startsAt.toISOString(),endsAt:value.endsAt.toISOString()})));
   for(const [kind,resourceId]of [["instructor",cohort.instructorId],["venue",venueId]] as const){
    const clash=await one(tx,"SELECT occurrence_id FROM ls_fishing_stage.resource_reservations WHERE workspace_id=$1 AND kind=$2 AND resource_id=$3 AND occurrence_id<>$4 AND active AND starts_at<$6::timestamptz AND ends_at>$5::timestamptz LIMIT 1 FOR UPDATE",[c.actor.workspaceId,kind,resourceId,occurrence.id,occurrence.time.startsAt,occurrence.time.endsAt]);requireFact(!clash,"CONFLICT");
    await tx.query(`INSERT INTO ls_fishing_stage.resource_reservations(workspace_id,occurrence_id,kind,resource_id,instructor_id,venue_id,starts_at,ends_at,occurrence_revision,active,actor_id,command_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT(workspace_id,occurrence_id,kind) DO UPDATE SET resource_id=EXCLUDED.resource_id,instructor_id=EXCLUDED.instructor_id,venue_id=EXCLUDED.venue_id,starts_at=EXCLUDED.starts_at,ends_at=EXCLUDED.ends_at,occurrence_revision=EXCLUDED.occurrence_revision,active=EXCLUDED.active,actor_id=EXCLUDED.actor_id,command_id=EXCLUDED.command_id`,[c.actor.workspaceId,occurrence.id,kind,resourceId,kind==="instructor"?resourceId:null,kind==="venue"?resourceId:null,occurrence.time.startsAt,occurrence.time.endsAt,occurrence.revision,occurrence.state==="published",c.actor.id,intent.operationId]);
   }effects.push({occurrenceId:occurrence.id,revision:occurrence.revision,venueId,startsAt:occurrence.time.startsAt,endsAt:occurrence.time.endsAt,active:occurrence.state==="published"});
  }
  requireFact(intent.resources.every(value=>after.some(o=>o.id===value.occurrenceId)),"INVALID_REQUEST");await this.stageReceipt(tx,c,intent.operationId,{before:prior.map(value=>({...value,startsAt:value.startsAt.toISOString(),endsAt:value.endsAt.toISOString()})),after:effects});
 }
}
