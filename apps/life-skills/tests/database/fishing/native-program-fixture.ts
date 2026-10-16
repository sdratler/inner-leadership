/** Disposable synthetic PROGRAM fixture, never imported by application code.
 * Canonical approvals, catalog/media facts and merchant here are artificial.
 * Native logins, commands, Stage transactions and payment allocation are real;
 * the payment transport/signature are explicitly the retained synthetic ports.
 */
import {createHmac,randomBytes,randomUUID} from "node:crypto";
import pg from "pg";
import {asId} from "../../../src/lib/ids.ts";
import {seal,blindEmail,hashPassword} from "../../../src/features/identity/crypto.ts";
import {IdentityAuthService} from "../../../src/features/identity/auth-service.ts";
import {IdentitySessions} from "../../../src/features/identity/session-adapter.ts";
import {systemClock,type AccountRole,type Actor} from "../../../src/features/identity/types.ts";
import type {IdentityConfig} from "../../../src/features/identity/config.ts";
import {CaseService} from "../../../src/features/cases/service.ts";
import {CalendarStore} from "../../../src/features/calendar/store.ts";
import {CalendarService} from "../../../src/features/calendar/service.ts";
import type {CreateBooking} from "../../../src/features/calendar/types.ts";
import {NativeFishingProgram} from "../../../src/features/fishing/native-program.ts";
import {FishingProgramError,type ProgramPolicy,type NativeProgramCommandIntent} from "../../../src/features/fishing/native-program-contract.ts";
import {NativeFishingStageStore} from "../../../src/features/fishing-stage/native-store.ts";
import {FishingStageService} from "../../../src/features/fishing-stage/service.ts";
import type {ApprovedStageTemplate,StageCommand} from "../../../src/features/fishing-stage/contract.ts";
import {digest,POLICY_VERSION,type SettlementFact} from "../../../src/features/fishing-payments/domain.ts";
import {FishingPaymentStore} from "../../../src/features/fishing-payments/store.ts";
import {FishingPaymentService} from "../../../src/features/fishing-payments/service.ts";
import {FishingReceiptInbox} from "../../../src/features/fishing-payments/receipts.ts";
import {FakeMerchant} from "../fishing-payments/fixture.ts";
import {merchant} from "../../unit/fishing-payments/fixture.ts";
import {poolStore,safeTestUrl} from "../calendar/fixture.ts";
import {createHash} from "node:crypto";
import {learnerLessonSchema} from "../../../src/features/resources/fishing-lesson-journey.ts";
import {educationCatalogAad} from "../../../src/features/resources/fishing-lesson-native-store.ts";
import {educationArtifactAad,type EducationStorageBinding} from "../../../src/features/resources/fishing-lesson-storage-contract.ts";

export async function programFixture(options:{capacity?:number;childAccountsEnabled?:boolean;confirmation?:ProgramPolicy["confirmation"];readableRm101?:"SYNTHETIC_ONLY"}={}){
 const raw=safeTestUrl(),url=new URL(raw);
 if(process.env.LS_RM_PROGRAM_NATIVE_ALLOW!=="MAIN_REGISTERED_ONLY"||url.hostname!=="127.0.0.1"||!/^\/ls_calendar_test_rm_guard_[a-f0-9]{32}_test$/.test(url.pathname)||!url.port||!url.username||!url.password||url.search||url.hash)throw Error("MAIN_REGISTERED_PROGRAM_TARGET_REQUIRED");
 if(options.readableRm101!==undefined&&(options.readableRm101!=="SYNTHETIC_ONLY"||process.env.LS_RM_FISHING_STAGE_UI_ONLY!=="true"))throw Error("READABLE_RM101_SYNTHETIC_BROWSER_OPT_IN_REQUIRED");
 const pool=new pg.Pool({connectionString:raw,ssl:false,max:8});
 try{
  const target=(await pool.query("SELECT current_database() AS database,host(inet_server_addr()) AS host,inet_server_port() AS port,to_regclass('ls_fishing_stage.cohorts') AS cohorts,to_regclass('ls_fishing_stage.seat_reservations') AS seats")).rows[0];
  if(target.database!==url.pathname.slice(1)||target.host!=="127.0.0.1"||target.port!==Number(url.port)||!target.cohorts||!target.seats)throw Error("PROGRAM_NATIVE_ACTUAL_TARGET_OR_SCHEMA_MISMATCH");
  const workspaceId=asId(randomUUID(),"workspace"),ago=new Date(Date.now()-86400000),now=Date.now(),db=poolStore(pool),ring={activeKeyId:"synthetic",keys:{synthetic:randomBytes(32)}};
  const config:IdentityConfig={enabled:true,origin:"https://synthetic.invalid",workspaceId,csrfKey:randomBytes(32),lookupKey:randomBytes(32),rateLimitKey:randomBytes(32).toString("hex"),keyring:ring,sessionSeconds:28800};
  await pool.query("INSERT INTO ls_identity.workspaces(id,created_at) VALUES($1,$2)",[workspaceId,ago]);
  const encoded=await hashPassword("Ab12cd"),auth=new IdentityAuthService(db,config,systemClock),sessions=new IdentitySessions(db,config,systemClock);
  async function person(kind:"minor"|"adult",name:string){const id=asId(randomUUID(),"person");await pool.query("INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,$3,$4,$5)",[id,workspaceId,kind,seal(JSON.stringify({displayName:name}),`person:${workspaceId}:${id}`,ring),ago]);return id;}
  async function account(role:AccountRole,personId=undefined as Actor["personId"]|undefined){
   const id=asId(randomUUID(),"account"),subject=personId??await person(role==="child"?"minor":"adult","Synthetic program account"),email=`${id}@example.invalid`;
   await pool.query("INSERT INTO ls_identity.accounts(id,workspace_id,role,state,locale,email_blind,email_ciphertext,email_verified_at,password_hash,created_at,updated_at) VALUES($1,$2,$3,'active','en',$4,$5,$6,$7,$6,$6)",[id,workspaceId,role,blindEmail(email,config.lookupKey),seal(email,`email:${workspaceId}:${id}`,ring),ago,encoded]);
   await pool.query("INSERT INTO ls_identity.account_subjects(workspace_id,account_id,person_id) VALUES($1,$2,$3)",[workspaceId,id,subject]);
   // Never seed a session. This is the actual native password/preauth service,
   // not HTTP/browser/CSRF or account-invitation verification evidence.
   const preauth=await auth.preauth(),login=await auth.login(email,"Ab12cd",preauth.token,randomUUID());return sessions.actor(login.token);
  }
  const owner=await account("practitioner"),program=new NativeFishingProgram(db,ring,{childAccountsEnabled:options.childAccountsEnabled===true,merchant});
  const ref={cohortId:randomUUID(),stageId:randomUUID(),stage:1 as const},templateId=randomUUID(),termsId=randomUUID(),policyId=randomUUID(),templateHash=digest("SYNTHETIC_TEMPLATE_NOT_REAL_APPROVAL"),termsHash=digest("SYNTHETIC_TERMS_NOT_REAL_ACCEPTANCE_SOURCE");
  const template:ApprovedStageTemplate={stage:1,version:"synthetic-stage-v1",status:"approved",policyVersion:POLICY_VERSION,sourceVersion:"synthetic-program-source-v1",sourceSha256:templateHash,modules:Array.from({length:12},(_,i)=>({moduleId:`RM-1${String(i+1).padStart(2,"0")}`,moduleVersion:"synthetic-lesson-v1",learnerContent:"approved"}))};
  async function source(id:string,kind:string,version:string,hash:string,payload:unknown){await pool.query("INSERT INTO ls_fishing_stage.source_approvals(workspace_id,id,kind,version,canonical_id,source_revision,source_sha256,approval_reference,approved_by,approved_at,payload_ciphertext) VALUES($1,$2,$3,$4,'synthetic.invalid/source','synthetic-revision',$5,'SYNTHETIC_NOT_REAL_CANONICAL_APPROVAL',$6,$7,$8)",[workspaceId,id,kind,version,hash,owner.id,ago,seal(JSON.stringify(payload),`fishing-program:v1:source:${workspaceId}:${id}`,ring)]);}
  await source(templateId,"template",template.version,templateHash,template);
  await source(termsId,"terms","synthetic-terms-v1",termsHash,{program:"sunday_fishing_academy",termsVersion:"synthetic-terms-v1",policyVersion:POLICY_VERSION,sourceVersion:"synthetic-program-source-v1",contentSha256:termsHash});
  await source(policyId,"payment_condition","synthetic-condition-v1",digest("SYNTHETIC_CONDITION"),{policyVersion:POLICY_VERSION,sourceVersion:"synthetic-program-source-v1",confirmation:options.confirmation??{kind:"unselected"}});
  for(const lesson of template.modules){const learnerId=randomUUID(),teacherId=randomUUID();
   // READABLE_RM101_INSERT_FIRST_BEGIN: default and other11 metadata stay unchanged.
   if(options.readableRm101==="SYNTHETIC_ONLY"&&lesson.moduleId==="RM-101"){
    const hash=(value:string)=>createHash("sha256").update(value).digest("hex"),sourceSha=hash("SYNTHETIC_BROWSER_SOURCE_NOT_REAL_APPROVAL");
    const readable=learnerLessonSchema.parse({moduleId:lesson.moduleId,version:lesson.moduleVersion,stage:1,locale:"en",title:"Synthetic fishing lesson",instruction:"Synthetic hookless instruction only. Not real curriculum or activity clearance.",questions:[{id:"Q01-1",prompt:"Describe your synthetic hookless practice."},{id:"Q01-2",prompt:"Describe your synthetic equipment check."},{id:"Q01-3",prompt:"Describe your final synthetic reflection."}],sourceSha256:sourceSha,status:"approved"}),learnerBytes=JSON.stringify(readable),teacherBytes="PRIVATE_SYNTHETIC_TEACHER_CANARY";
    const binding:EducationStorageBinding={workspaceId,moduleId:lesson.moduleId,version:lesson.moduleVersion,state:"approved",source:{sourceId:"synthetic-browser-source",revision:"synthetic-only",sha256:sourceSha},
     learner:{sourceId:"synthetic-learner-"+learnerId,version:"1",locale:"en",sha256:hash(learnerBytes),storageClass:"resource_learner",state:"approved"},
     teacher:{sourceId:"synthetic-teacher-"+teacherId,version:"1",locale:"en",sha256:hash(teacherBytes),storageClass:"protected_teacher",state:"approved"}};
    for(const[id,reference,bytes]of[[learnerId,binding.learner,learnerBytes],[teacherId,binding.teacher,teacherBytes]]as const)
     await pool.query("INSERT INTO ls_education.artifact_versions(workspace_id,id,source_id,version,locale,storage_class,sha256,reference,payload_ciphertext) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)",[workspaceId,id,reference.sourceId,reference.version,reference.locale,reference.storageClass,reference.sha256,JSON.stringify(reference),seal(bytes,educationArtifactAad(workspaceId,reference),ring)]);
    await pool.query("INSERT INTO ls_education.catalog_versions(workspace_id,module_id,version,source_id,source_revision,source_sha256,learner_artifact_id,teacher_artifact_id,payload_ciphertext,approval_state,approval_provenance,approved_by,approved_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'approved','SYNTHETIC_READABLE_NOT_REAL_APPROVAL',$10,$11)",[workspaceId,lesson.moduleId,lesson.moduleVersion,binding.source.sourceId,binding.source.revision,sourceSha,learnerId,teacherId,seal(JSON.stringify(binding),educationCatalogAad(workspaceId,lesson.moduleId,lesson.moduleVersion),ring),owner.id,ago]);
    continue;
   }
   // READABLE_RM101_INSERT_FIRST_END
   for(const [id,storage]of [[learnerId,"resource_learner"],[teacherId,"protected_teacher"]])await pool.query("INSERT INTO ls_education.artifact_versions(workspace_id,id,source_id,version,locale,storage_class,sha256,reference,payload_ciphertext) VALUES($1,$2,$3,$4,'en',$5,$6,$7::jsonb,$8)",[workspaceId,id,"synthetic-"+lesson.moduleId,lesson.moduleVersion,storage,digest({id}),JSON.stringify({synthetic:true}),seal(storage==="protected_teacher"?"PRIVATE_SYNTHETIC_TEACHER_CANARY":"SYNTHETIC_LEARNER_METADATA_ONLY",`synthetic-artifact:${id}`,ring)]);
   await pool.query("INSERT INTO ls_education.catalog_versions(workspace_id,module_id,version,source_id,source_revision,source_sha256,learner_artifact_id,teacher_artifact_id,payload_ciphertext,approval_state,approval_provenance,approved_by,approved_at) VALUES($1,$2,$3,'synthetic-source','synthetic-revision',$4,$5,$6,$7,'approved','SYNTHETIC_METADATA_NOT_CONTENT_PROOF',$8,$9)",[workspaceId,lesson.moduleId,lesson.moduleVersion,digest(lesson),learnerId,teacherId,seal("{}",`synthetic-catalog:${lesson.moduleId}`,ring),owner.id,ago]);
  }
  const cohortCommand={commandId:randomUUID(),...ref,label:"Synthetic cohort",instructorAccountId:owner.id,approvedChildCapacity:options.capacity??2,templateApprovalId:templateId,termsApprovalId:termsId,policyApprovalId:policyId,reason:"Synthetic operator planning approval, not venue/safety proof"};
  await program.createCohort(owner,cohortCommand);
  const venueCommand={commandId:randomUUID(),id:randomUUID(),label:"Synthetic approved pier",address:"Synthetic address",capacity:options.capacity??2,approvalReference:"SYNTHETIC_VENUE_NOT_REAL_PERMISSION",reason:"Disposable resource fixture"};await program.approveVenue(owner,venueCommand);
  const at=(hours:number)=>new Date(now+hours*3600000).toISOString();
  await pool.query("INSERT INTO ls_calendar.availability(id,workspace_id,practitioner_id,starts_at,ends_at,kind) VALUES($1,$2,$3,$4,$5,'open')",[randomUUID(),workspaceId,owner.id,new Date(now-3600000),new Date(now+20*86400000)]);
  const stage=(actor:Actor=owner,enrollmentId:string|null=null,intent:NativeProgramCommandIntent|null=null)=>new FishingStageService(new NativeFishingStageStore(db,ring,{actor,selection:{selectedEnrollmentId:enrollmentId}},program.stageHooks(intent)),systemClock);
  async function createPlan(){await stage().execute(owner,ref,{action:"create",operationId:randomUUID(),expectedRevision:0,templateVersion:template.version,childCapacity:options.capacity??2});return (await stage().read(owner,ref))!;}
  async function family(){const parent=await account("parent"),learnerId=await person("minor","Same name / אותו שם"),householdId=randomUUID();
   await pool.query("INSERT INTO ls_cases.families(id,workspace_id,label_ciphertext,created_at) VALUES($1,$2,$3,$4)",[householdId,workspaceId,seal("Synthetic family",`family:${workspaceId}:${householdId}`,ring),ago]);
   await pool.query("INSERT INTO ls_cases.family_members(workspace_id,family_id,person_id,role) VALUES($1,$2,$3,'parent'),($1,$2,$4,'child')",[workspaceId,householdId,parent.personId,learnerId]);
   await pool.query("INSERT INTO ls_education.guardian_authorities(workspace_id,learner_id,account_id,active,verified_at,source_reference,verified_by) VALUES($1,$2,$3,true,$4,'synthetic-parent-authority',$5)",[workspaceId,learnerId,parent.id,ago,owner.id]);return {parent,learnerId,householdId};
  }
  const authority={...program.paymentApprovalAuthority(),withdrawalFacts:async()=>{throw new FishingProgramError("POLICY_REQUIRED");},reminderPolicy:async()=>{throw new FishingProgramError("POLICY_REQUIRED");}},provider=new FakeMerchant(),paymentStore=new FishingPaymentStore({database:db,clock:systemClock,merchant,authority,provider}),payments=new FishingPaymentService(paymentStore),inbox=new FishingReceiptInbox(paymentStore);
  async function prepare(f:Awaited<ReturnType<typeof family>>,mode:"prepay"|"installments"="prepay",stageId=ref.stageId){
   const fit={commandId:randomUUID(),id:randomUUID(),stageId,learnerId:f.learnerId,purpose:"enrollment" as const,decision:"approved" as const,targetOccurrenceId:null,targetRevision:null,note:"PRIVATE_SYNTHETIC_FIT_CANARY"};await program.recordFit(owner,fit);
   const acceptance={commandId:randomUUID(),id:randomUUID(),stageId,learnerId:f.learnerId,householdId:f.householdId,sourceApprovalId:termsId,sourceSha256:termsHash};await program.acceptTerms(f.parent,acceptance);
   const hold={commandId:randomUUID(),holdId:randomUUID(),stageId,learnerId:f.learnerId,householdId:f.householdId,payerAccountId:f.parent.id,expectedCohortRevision:1,reason:"Synthetic offer preparation"};await program.reserveOfferHold(owner,hold);
   const offer={commandId:randomUUID(),id:randomUUID(),stageId,payerAccountId:f.parent.id,householdId:f.householdId,policyApprovalId:policyId,expiresAt:at(24),lines:[{id:randomUUID(),learnerId:f.learnerId,fitDecisionId:fit.id,termsAcceptanceId:acceptance.id,holdId:hold.holdId,mode,dueAt:mode==="prepay"?[at(0)]:[at(0),at(31*24),at(62*24)]}]};await program.approveOffer(owner,offer);
   const issued=await paymentStore.registerApprovedOffer(owner,randomUUID(),offer.id,1),purchaseId=issued.purchaseIds[0]!;return {family:f,fit,acceptance,hold,offer,purchaseId};
  }
  async function settle(p:Awaited<ReturnType<typeof prepare>>,index=1){
   const state=await paymentStore.readPayment(owner,p.purchaseId),due=state!.dues.find(value=>value.index===index)!;
   const reserved=await payments.beginHosted(p.family.parent,randomUUID(),p.purchaseId,due.id),operation=await payments.executeSynthetic(p.family.parent,randomUUID(),reserved.id),eventId="evt_"+randomUUID(),secret="whsec_synthetic_program_only",time=Math.floor(Date.now()/1000);
   const body=Buffer.from(JSON.stringify({id:eventId,object:"event",type:"invoice.paid",account:merchant.accountId,livemode:false,api_version:merchant.apiVersion,created:time,data:{object:{id:operation.result!.providerObjectId}}})),signature=`t=${time},v1=${createHmac("sha256",secret).update(`${time}.`).update(body).digest("hex")}`;
   await inbox.acceptSynthetic(body,signature,secret);
   const fact:SettlementFact={canonicalTransactionId:"pi_"+operation.id,providerReceiptId:eventId,relatedProviderObjectId:operation.result!.providerObjectId,operationId:operation.id,purchaseId:p.purchaseId,purchaseLineId:p.offer.lines[0]!.id,dueId:due.id,providerAccountId:merchant.accountId,livemode:false,currency:"USD",kind:"payment",cents:due.amountCents,feeCents:100,originalPaymentId:null,occurredAt:new Date().toISOString()};
   provider.readback={receiptId:eventId,resolvedObjectId:operation.result!.providerObjectId,providerAccountId:merchant.accountId,livemode:false,readAt:new Date().toISOString(),facts:[fact],dues:[]};await inbox.processSynthetic(owner,randomUUID(),eventId);return {operation,eventId};
  }
  async function enroll(p:Awaited<ReturnType<typeof prepare>>){const state=(await paymentStore.readPayment(owner,p.purchaseId))!;const command={commandId:randomUUID(),id:randomUUID(),stageId:p.offer.stageId,purchaseId:p.purchaseId,fitDecisionId:p.fit.id,termsAcceptanceId:p.acceptance.id,policyApprovalId:policyId,expectedPaymentRevision:state.revision};return {command,result:await program.confirmEnrollment(owner,command)};}
  async function revise(id:string,startsAt=at(48),endsAt=at(49),venueId=venueCommand.id){const current=(await stage().read(owner,ref))!,o=current.occurrences.find(value=>value.id===id)!,operationId=randomUUID();const command:StageCommand={action:"revise",operationId,expectedRevision:current.revision,occurrenceId:id,expectedOccurrenceRevision:o.revision,details:{time:{kind:"scheduled",startsAt,endsAt,timeZone:"America/New_York"},location:venueCommand.label,directions:"Synthetic directions",equipment:"Synthetic equipment",logisticalNote:"Synthetic enrolled-family information",childCapacity:options.capacity??2},reason:"Synthetic schedule choice"};return stage(owner,null,{operationId,resources:[{occurrenceId:id,expectedRevision:o.revision,venueId}],makeupFitDecisionId:null}).execute(owner,ref,command);}
  async function publish(){const current=(await stage().read(owner,ref))!,operationId=randomUUID();return stage(owner,null,{operationId,resources:[],makeupFitDecisionId:null}).execute(owner,ref,{action:"publish",operationId,expectedRevision:current.revision});}
  const calendar=new CalendarService(new CalendarStore(db,ring,systemClock));
  async function clinical(){const cases=new CaseService(db,config,systemClock),parent=await account("parent"),created=await cases.create(owner,{kind:"minor",displayName:"UNRELATED synthetic clinical child",familyLabel:"Unrelated clinical fixture"},randomUUID());
   await cases.changeState(owner,created.caseId,"intake",randomUUID());
   await pool.query("INSERT INTO ls_cases.case_guardians(workspace_id,case_id,account_id,granted_at) VALUES($1,$2,$3,$4)",[workspaceId,created.caseId,parent.id,ago]);
   const audience=await cases.createAudience(owner,created.caseId,{visibility:"family_full",published:true,accountIds:[parent.id]},randomUUID());await cases.createEngagement(owner,created.caseId,{rateMinor:55000,attendedReviewTarget:12},randomUUID());
   return (startsAt:string):CreateBooking=>({caseId:created.caseId,audienceId:audience.audienceId,kind:"individual",startsAt,parentForId:null,parentIds:[],bufferBefore:0,bufferAfter:0,location:"Synthetic clinical location",checkinExceptionReason:null});
  }
  return {pool,db,ring,config,workspaceId,owner,program,ref,template,templateId,termsId,termsHash,policyId,cohortCommand,venueCommand,account,person,family,stage,createPlan,prepare,settle,enroll,revise,publish,at,calendar,clinical,paymentStore,payments,inbox,provider,merchant,close:()=>pool.end()};
 }catch(error){await pool.end();throw error;}
}
export type ProgramFixture=Awaited<ReturnType<typeof programFixture>>;
