import "server-only";
import {z} from "zod";
import {AppError} from "../../lib/errors.ts";
import {freshActor,lockWorkspace} from "../identity/data.ts";
import type {Keyring} from "../identity/crypto.ts";
import {one,type IdentityStore,type SqlSession} from "../identity/store.ts";
import {systemClock,type AccountFacts} from "../identity/types.ts";
import type {FishingStageNativeHooks,NativeStageHookContext,NativeStagePrincipal} from "../fishing/native-stage-ports.ts";
import type {Actor,CanonicalOccurrence,EnrollmentProjection,FishingStageRef,FishingStageStore,FishingStageTransaction,FreshStageContext,IdentityClock} from "./contract.ts";
import {FishingStageError,validateStageState} from "./service.ts";
import {assertPlanBinding,authoritySchema,decodeNative,digest,encodeNative,linkSchema,nativeLimits,operationHeaderSchema,operationSchema,parseEnrollment,parseSnapshot,parseTemplate,planHeaderSchema,revisionHeaderSchema,unavailable,
 type NativeMakeupLink,type NativeSnapshot,type PlanHeader,type RevisionHeader} from "./native-storage.ts";

const uuid=z.uuid();
const planColumns=`workspace_id AS "workspaceId",stage_id AS "stageId",cohort_id AS "cohortId",stage,template_version AS "templateVersion",revision,state_sha256 AS "stateHash",payload_ciphertext AS ciphertext`;
const revisionColumns=`workspace_id AS "workspaceId",stage_id AS "stageId",revision,actor_account_id AS "actorId",operation_id AS "operationId",recorded_at AS "recordedAt",previous_state_sha256 AS "previousHash",state_sha256 AS "stateHash"`;
const linkColumns=`workspace_id AS "workspaceId",source_stage_id AS "sourceStageId",entitlement_id AS "entitlementId",enrollment_id AS "enrollmentId",learner_id AS "learnerId",occurrence_id AS "occurrenceId",reservation_id AS "reservationId"`;
type PlanRow=PlanHeader&{ciphertext:string};
type RevisionRow=Omit<RevisionHeader,"recordedAt">&{recordedAt:Date};
type Loaded={header:PlanHeader;snapshot:NativeSnapshot;ciphertext:string};
function forbidden():never{throw new AppError("FORBIDDEN");}
function conflict():never{throw new AppError("CONFLICT");}
function sameRef(a:FishingStageRef,b:FishingStageRef){return a.stageId===b.stageId&&a.cohortId===b.cohortId&&a.stage===b.stage;}
function accountFacts(actor:Actor):AccountFacts{return Object.freeze({id:actor.id,workspaceId:actor.workspaceId,personId:actor.personId,role:actor.role,state:actor.state,locale:actor.locale});}
function revisionHeader(row:RevisionRow):RevisionHeader{
 if(!(row.recordedAt instanceof Date)||!Number.isFinite(row.recordedAt.valueOf()))unavailable();
 return revisionHeaderSchema.parse({...row,recordedAt:row.recordedAt.toISOString()});
}
function isOperator(c:FreshStageContext){return c.actor.role==="practitioner"&&c.operatorAccountIds.includes(c.actor.id);}
function isEnrollment(e:EnrollmentProjection,c:FreshStageContext){return e.state==="confirmed"&&e.workspaceId===c.scope.workspaceId&&e.program===c.scope.program&&sameRef(e,c.scope);}
function cleanError(error:unknown):never{
 if(error instanceof AppError||error instanceof FishingStageError)throw error;
 if(error&&typeof error==="object"&&"code" in error&&["23505","40001","40P01"].includes(String(error.code)))conflict();
 unavailable();
}

/** Actual SQL adapter. It never discovers a database/key/authority from env and
 * has no fallback hooks. MAIN supplies the bound native store and shared ports.
 * All hook SQL, ledger SQL and receipts participate in this ONE transaction. */
export class NativeFishingStageStore implements FishingStageStore {
 private readonly principal:NativeStagePrincipal;
 constructor(private readonly db:IdentityStore,private readonly ring:Keyring,principal:NativeStagePrincipal,
  private readonly hooks:FishingStageNativeHooks,private readonly clock:IdentityClock=systemClock){
  this.principal=structuredClone(principal);
  uuid.parse(principal.actor.id);uuid.parse(principal.actor.workspaceId);
  z.strictObject({selectedEnrollmentId:uuid.nullable()}).parse(principal.selection);
  for(const method of ["resolveContext","resolveApprovedTemplate","readEnrollment","occupiedSeats","reconcileResources","replacementSuitable","reserveMakeup"] as const)
   if(typeof hooks?.[method]!=="function")unavailable();
 }
 async transaction<T>(work:(tx:FishingStageTransaction)=>Promise<T>):Promise<T>{
  try{return await this.db.transaction(async sql=>{
   await lockWorkspace(sql,this.principal.actor.workspaceId);
   let actor=await this.verifiedActor(sql);
   let bound:{context:FreshStageContext;authorityHash:string}|null=null;
   const loaded=new Map<string,Loaded|null>();
   const contextFor=(c:FreshStageContext):NativeStageHookContext=>{
    if(!bound||c!==bound.context)forbidden();
    return Object.freeze({actor:accountFacts(actor),scope:Object.freeze({...c.scope}),now:this.clock.now(),selectedEnrollmentId:this.principal.selection.selectedEnrollmentId});
   };
   const operatorContext=(c:FreshStageContext)=>{const hc=contextFor(c);if(!isOperator(c))forbidden();return hc;};
   const authority=async(ref:FishingStageRef)=>{
    const raw=await this.hooks.resolveContext(sql,accountFacts(actor),Object.freeze({...ref}),Object.freeze({...this.principal.selection}),this.clock.now());
    if(raw===null)return null;
    const facts=authoritySchema.parse(raw);
    if(facts.scope.workspaceId!==actor.workspaceId||!sameRef(facts.scope,ref))forbidden();
    const selected=this.principal.selection.selectedEnrollmentId;
    if(selected===null?facts.enrollment!==null:facts.enrollment?.id!==selected)forbidden();
    const c:FreshStageContext={...facts,actor,sessionRevoked:false};
    if(isOperator(c))return {context:c,authorityHash:digest(facts)};
    if(!selected||!c.enrollment||!isEnrollment(c.enrollment,c)||!c.enrollment.authorizedAccountIds.includes(actor.id))return null;
    if(actor.role==="parent"&&!c.guardianRelationshipCurrent||actor.role==="child"&&(!c.childAccountEnabled||actor.personId!==c.enrollment.learnerId)||!["parent","child"].includes(actor.role))return null;
    return {context:c,authorityHash:digest(facts)};
   };
   const readLinks=async(stageId:string):Promise<NativeMakeupLink[]>=>{
    const rows=await sql.query(`SELECT ${linkColumns} FROM ls_fishing_stage.makeup_links WHERE workspace_id=$1 AND source_stage_id=$2 ORDER BY entitlement_id LIMIT 12001`,[actor.workspaceId,stageId]);
    if(rows.length>nativeLimits.notices)unavailable();return rows.map(row=>linkSchema.parse(row));
   };
   const load=async(c:FreshStageContext,ref:FishingStageRef=c.scope):Promise<Loaded|null>=>{
    const hc=contextFor(c),row=await one<PlanRow>(sql,`SELECT ${planColumns} FROM ls_fishing_stage.plans WHERE workspace_id=$1 AND stage_id=$2 FOR UPDATE`,[actor.workspaceId,ref.stageId]);
    if(!row){loaded.set(ref.stageId,null);return null;}
    const {ciphertext,...physical}=row,header=planHeaderSchema.parse(physical);
    if(header.workspaceId!==actor.workspaceId||!sameRef(header,ref))forbidden();
    const snapshot=parseSnapshot(decodeNative("plan",header,ciphertext,this.ring));assertPlanBinding(header,snapshot);
    validateStageState(snapshot.state,{...c,scope:{...c.scope,...ref}});
    const approved=await this.hooks.resolveApprovedTemplate(sql,{...hc,scope:{...hc.scope,...ref}},header.templateVersion);
    if(!approved||digest(parseTemplate(approved))!==digest(snapshot.state.template))forbidden();
    const ordinals=await sql.query<{workspaceId:string;id:string;stageId:string;cohortId:string;stage:number;templateVersion:string;ordinal:number}>(`SELECT workspace_id AS "workspaceId",id,stage_id AS "stageId",cohort_id AS "cohortId",stage,template_version AS "templateVersion",ordinal
     FROM ls_fishing_stage.occurrences WHERE workspace_id=$1 AND stage_id=$2 ORDER BY ordinal LIMIT 13`,[actor.workspaceId,ref.stageId]);
    if(ordinals.length!==12)unavailable();
    for(const [index,o] of ordinals.entries()){const expected=snapshot.state.occurrences[index]!;
     if(o.workspaceId!==actor.workspaceId||o.id!==expected.id||o.stageId!==ref.stageId||o.cohortId!==ref.cohortId||o.stage!==ref.stage||o.templateVersion!==header.templateVersion||o.ordinal!==index+1)unavailable();}
    const revisions=await sql.query<RevisionRow>(`SELECT ${revisionColumns} FROM ls_fishing_stage.revisions WHERE workspace_id=$1 AND stage_id=$2 ORDER BY revision LIMIT 1001`,[actor.workspaceId,ref.stageId]);
    if(revisions.length!==header.revision||revisions.length>nativeLimits.revisions)unavailable();
    let previous:string|null=null;
    for(const [index,r] of revisions.entries()){const h=revisionHeader(r);if(h.workspaceId!==actor.workspaceId||h.stageId!==ref.stageId||h.revision!==index+1||h.previousHash!==previous)unavailable();previous=h.stateHash;}
    if(previous!==header.stateHash)unavailable();
    const last=revisionHeader(revisions.at(-1)!);
    const sealed=await one<{ciphertext:string}>(sql,`SELECT payload_ciphertext AS ciphertext FROM ls_fishing_stage.revisions WHERE workspace_id=$1 AND stage_id=$2 AND revision=$3`,[actor.workspaceId,ref.stageId,header.revision]);
    if(!sealed)unavailable();const revisionSnapshot=parseSnapshot(decodeNative("revision",last,sealed.ciphertext,this.ring));
    if(digest(revisionSnapshot)!==header.stateHash||digest(await readLinks(ref.stageId))!==digest(snapshot.links))unavailable();
    const result={header,snapshot,ciphertext};loaded.set(ref.stageId,result);return result;
   };
   const readEnrollment=async(c:FreshStageContext,id:string)=>{
    const raw=await this.hooks.readEnrollment(sql,operatorContext(c),uuid.parse(id));if(raw===null)return null;
    const e=parseEnrollment(raw);if(e.id!==id||!isEnrollment(e,c))forbidden();return e;
   };
   const target=async(c:FreshStageContext,id:string):Promise<CanonicalOccurrence|null>=>{
    operatorContext(c);
    const ref=await one<{cohortId:string;stageId:string;stage:1|2|3|4}>(sql,`SELECT cohort_id AS "cohortId",stage_id AS "stageId",stage FROM ls_fishing_stage.occurrences WHERE workspace_id=$1 AND id=$2`,[actor.workspaceId,uuid.parse(id)]);
    if(!ref)return null;const targetPlan=await load(c,ref);if(!targetPlan)return null;
    return structuredClone(targetPlan.snapshot.state.occurrences.find(o=>o.id===id)??null);
   };
   const tx:FishingStageTransaction={
    resolveFreshContext:async(input,ref)=>{
     if(input.id!==actor.id||input.workspaceId!==actor.workspaceId||input.sessionDigest!==actor.sessionDigest||bound&&!sameRef(bound.context.scope,ref))forbidden();
     bound=await authority(ref);return bound?.context??null;
    },
    resolveApprovedTemplate:async(c,version)=>{const raw=await this.hooks.resolveApprovedTemplate(sql,contextFor(c),version);return raw===null?null:parseTemplate(raw);},
    load:async c=>structuredClone((await load(c))?.snapshot.state??null),
    readOperation:async(c,id)=>{
     contextFor(c);
     const row=await one<{workspaceId:string;actorId:string;operationId:string;stageId:string;stageRevision:number;digest:string;stateHash:string;ciphertext:string}>(sql,`SELECT workspace_id AS "workspaceId",actor_account_id AS "actorId",operation_id AS "operationId",stage_id AS "stageId",stage_revision AS "stageRevision",request_digest AS digest,state_sha256 AS "stateHash",receipt_ciphertext AS ciphertext
      FROM ls_fishing_stage.operations WHERE workspace_id=$1 AND actor_account_id=$2 AND operation_id=$3`,[actor.workspaceId,actor.id,uuid.parse(id)]);
     if(!row)return null;if(row.stageId!==c.scope.stageId)conflict();
     const current=await load(c);if(!current||row.stageRevision>current.header.revision)unavailable();
     const {ciphertext,...physical}=row,header=operationHeaderSchema.parse(physical),value=operationSchema.parse(decodeNative("operation",header,ciphertext,this.ring));
     if(header.workspaceId!==actor.workspaceId||header.actorId!==actor.id||header.operationId!==id||value.digest!==header.digest||value.receipt.operationId!==id||value.receipt.stageRevision!==header.stageRevision)unavailable();
     const r=await one<{actorId:string;operationId:string;stateHash:string}>(sql,`SELECT actor_account_id AS "actorId",operation_id AS "operationId",state_sha256 AS "stateHash" FROM ls_fishing_stage.revisions WHERE workspace_id=$1 AND stage_id=$2 AND revision=$3`,[actor.workspaceId,c.scope.stageId,header.stageRevision]);
     if(!r||r.actorId!==actor.id||r.operationId!==id||r.stateHash!==header.stateHash)unavailable();return value;
    },
    readEnrollment,
    occupiedSeats:async(c,id)=>{
     const count=await this.hooks.occupiedSeats(sql,operatorContext(c),uuid.parse(id));
     if(!Number.isSafeInteger(count)||count<0)unavailable();return count;
    },
    reconcileResources:async(c,before,after)=>{await this.hooks.reconcileResources(sql,operatorContext(c),structuredClone(before),structuredClone(after));},
    resolveReplacement:async(c,enrollmentId,id)=>{
     const e=await readEnrollment(c,enrollmentId),o=await target(c,id);if(!e||!o)return null;
     const suitable=await this.hooks.replacementSuitable(sql,operatorContext(c),e,structuredClone(o));if(typeof suitable!=="boolean")unavailable();
     return {occurrence:o,suitableForEnrollment:suitable};
    },
    reserveMakeup:async(c,input)=>{
     const hc=operatorContext(c),e=await readEnrollment(c,input.enrollmentId),o=await target(c,input.occurrenceId);
     if(!e||!o)forbidden();
     if(o.revision!==input.expectedRevision)conflict();
     if(o.state!=="published"||o.optional||o.time.kind!=="scheduled"||Date.parse(o.time.startsAt)<=this.clock.now().valueOf()||await this.hooks.replacementSuitable(sql,hc,e,structuredClone(o))!==true)forbidden();
     const prior=await sql.query(`SELECT entitlement_id FROM ls_fishing_stage.makeup_links WHERE workspace_id=$1 AND (entitlement_id=$2 OR (learner_id=$3 AND occurrence_id=$4)) LIMIT 1 FOR UPDATE`,[actor.workspaceId,uuid.parse(input.entitlementId),e.learnerId,o.id]);
     if(prior.length)conflict();
     const reservationId=uuid.parse(await this.hooks.reserveMakeup(sql,hc,{enrollment:structuredClone(e),target:structuredClone(o),entitlementId:input.entitlementId,expectedRevision:input.expectedRevision}));
     await sql.query(`INSERT INTO ls_fishing_stage.makeup_links(workspace_id,source_stage_id,entitlement_id,enrollment_id,learner_id,occurrence_id,reservation_id) VALUES($1,$2,$3,$4,$5,$6,$7)`,[actor.workspaceId,c.scope.stageId,input.entitlementId,e.id,e.learnerId,o.id,reservationId]);
     return reservationId;
    },
    commit:async(c,state,expected,operation)=>{
     contextFor(c);if(!loaded.has(c.scope.stageId))unavailable();const before=loaded.get(c.scope.stageId);
     actor=await this.verifiedActor(sql);const currentAuthority=await authority(c.scope);
     if(!bound||!currentAuthority||currentAuthority.authorityHash!==bound.authorityHash||actor.id!==c.actor.id||actor.role!==c.actor.role||actor.personId!==c.actor.personId)forbidden();
     if((before?.header.revision??0)!==expected||state.revision!==expected+1)conflict();
     const snapshot=parseSnapshot({state,links:await readLinks(c.scope.stageId)});validateStageState(snapshot.state,c);
     const approved=await this.hooks.resolveApprovedTemplate(sql,contextFor(c),state.template.version);
     if(!approved||digest(parseTemplate(approved))!==digest(snapshot.state.template))forbidden();
     if(before&&(before.header.templateVersion!==state.template.version||before.header.cohortId!==state.cohortId||before.header.stage!==state.stage))conflict();
     const op=operationSchema.parse(operation);if(op.receipt.stageRevision!==state.revision)conflict();
     const head=planHeaderSchema.parse({workspaceId:c.scope.workspaceId,stageId:c.scope.stageId,cohortId:c.scope.cohortId,stage:c.scope.stage,templateVersion:state.template.version,revision:state.revision,stateHash:digest(snapshot)});
     const rev=revisionHeaderSchema.parse({workspaceId:actor.workspaceId,stageId:state.stageId,revision:state.revision,actorId:actor.id,operationId:op.receipt.operationId,recordedAt:this.clock.now().toISOString(),previousHash:before?.header.stateHash??null,stateHash:head.stateHash});
     const opHeader=operationHeaderSchema.parse({workspaceId:actor.workspaceId,actorId:actor.id,operationId:op.receipt.operationId,stageId:state.stageId,stageRevision:state.revision,digest:op.digest,stateHash:head.stateHash});
     const planCipher=encodeNative("plan",head,snapshot,this.ring),revisionCipher=encodeNative("revision",rev,snapshot,this.ring),receiptCipher=encodeNative("operation",opHeader,op,this.ring);
     if(expected===0){
      await sql.query(`INSERT INTO ls_fishing_stage.plans(workspace_id,stage_id,cohort_id,stage,template_version,revision,state_sha256,payload_ciphertext) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[head.workspaceId,head.stageId,head.cohortId,head.stage,head.templateVersion,head.revision,head.stateHash,planCipher]);
      for(const o of snapshot.state.occurrences)await sql.query(`INSERT INTO ls_fishing_stage.occurrences(workspace_id,id,stage_id,cohort_id,stage,template_version,ordinal) VALUES($1,$2,$3,$4,$5,$6,$7)`,[o.workspaceId,o.id,o.stageId,o.cohortId,o.stage,o.templateVersion,o.ordinal]);
     }else{
      const changed=await sql.query(`UPDATE ls_fishing_stage.plans SET revision=$3,state_sha256=$4,payload_ciphertext=$5 WHERE workspace_id=$1 AND stage_id=$2 AND revision=$6 AND state_sha256=$7 AND payload_ciphertext=$8 RETURNING stage_id`,[head.workspaceId,head.stageId,head.revision,head.stateHash,planCipher,expected,before!.header.stateHash,before!.ciphertext]);
      if(changed.length!==1)conflict();
     }
     await sql.query(`INSERT INTO ls_fishing_stage.revisions(workspace_id,stage_id,revision,recorded_at,actor_account_id,operation_id,previous_state_sha256,state_sha256,payload_ciphertext) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[rev.workspaceId,rev.stageId,rev.revision,new Date(rev.recordedAt),rev.actorId,rev.operationId,rev.previousHash,rev.stateHash,revisionCipher]);
     await sql.query(`INSERT INTO ls_fishing_stage.operations(workspace_id,actor_account_id,operation_id,stage_id,stage_revision,request_digest,state_sha256,receipt_ciphertext) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[opHeader.workspaceId,opHeader.actorId,opHeader.operationId,opHeader.stageId,opHeader.stageRevision,opHeader.digest,opHeader.stateHash,receiptCipher]);
    },
   };
   return await work(tx);
  });}catch(error){cleanError(error);}
 }
 private async verifiedActor(sql:SqlSession):Promise<Actor>{
  const captured=this.principal.actor,now=this.clock.now();
  const session=await one<{expiresAt:Date}>(sql,`SELECT s.expires_at AS "expiresAt" FROM ls_identity.sessions s
   JOIN ls_identity.accounts a ON a.workspace_id=s.workspace_id AND a.id=s.account_id
   JOIN ls_identity.account_subjects b ON b.workspace_id=a.workspace_id AND b.account_id=a.id
   WHERE s.workspace_id=$1 AND s.account_id=$2 AND s.token_digest=$3 AND s.revoked_at IS NULL AND s.expires_at>GREATEST($4::timestamptz,clock_timestamp()) AND a.state='active' FOR SHARE OF s,a,b`,[captured.workspaceId,captured.id,captured.sessionDigest,now]);
  if(!session||!(session.expiresAt instanceof Date)||!Number.isFinite(session.expiresAt.valueOf()))throw new AppError("UNAUTHENTICATED");
  const current=await freshActor(sql,captured,now);
  if(!(current.emailVerifiedAt instanceof Date)||!Number.isFinite(current.emailVerifiedAt.valueOf())||current.emailVerifiedAt.valueOf()>now.valueOf())throw new AppError("UNAUTHENTICATED");
  return {...accountFacts({...captured,...current}),sessionDigest:captured.sessionDigest,expiresAt:session.expiresAt.valueOf()};
 }
}
