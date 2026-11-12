import 'server-only';
import {AppError} from '../../lib/errors.ts';
import {billingId} from './contracts.ts';
import {PROGRAM_SOURCE_V3,programSourceCommandV3Schema,programSourceRecordV3Schema,type ProgramSourceCommandV3,type ProgramSourceRecordV3} from './program-source-contract-v3.ts';
import type {ChildPeriodNativeAuthorityV3,NativeEligibleLessonV3} from './child-period-provenance-v3.ts';
import type {BillingContext} from './native.ts';
import {FishingBillingInquiryFamilyProposals} from '../../lib/fishing-billing-inquiry-family-proposal.ts';
import {privateDigest} from '../contact-ops/server/digests.ts';
import {seal,type Keyring} from '../identity/crypto.ts';
import {decodeProgramSourceRowV3,programSourceAadV3,programSourceRequestDigestV3,programSourceSelectV3 as select,
 readProgramSourceInTransactionV3,readProgramLessonsInTransactionV3,type ProgramSourceKindV3 as Kind,type ProgramSourceStoredV3 as Stored,type ProgramSourceRowV3 as Row} from './program-source-readback-v3.ts';
import {freshActor,lockWorkspace} from '../identity/data.ts';
import {one,type IdentityStore,type SqlSession} from '../identity/store.ts';
import type {Actor,AccountId,WorkspaceId,IdentityClock} from '../identity/types.ts';

function fail(code:'UNAVAILABLE'|'CONFLICT'|'FORBIDDEN'|'NOT_FOUND'='UNAVAILABLE'):never{throw new AppError(code);}
type RejectedCode='CONFLICT'|'FORBIDDEN'|'NOT_FOUND'|'UNAUTHENTICATED'|'INVALID_REQUEST';
// Private provenance token: only the transaction's observed callback rejection
// path can mint this. A driver/post-commit AppError never passes this boundary.
class NativeRecordRejection extends Error{constructor(readonly code:RejectedCode){super(code);}}
export type ProgramSourceRecordOutcomeV3=Readonly<{version:typeof PROGRAM_SOURCE_V3;workspaceId:WorkspaceId;actorId:AccountId;command:ProgramSourceCommandV3}&(
 {state:'recorded';receipt:Stored&{replayed:boolean}}|{state:'rejected';code:RejectedCode})>;

/** Actual native Florida scheduling/progression source in the existing app DB.
 * The trusted configured owner is required; no first-practitioner, demo or
 * retired-schedule fallback. Forming/scheduled facts never activate a group,
 * reserve a paid seat, verify guardianship, or satisfy legal/transport gates. */
export class FishingProgramSourceNativeV3 implements ChildPeriodNativeAuthorityV3{
 private readonly families:FishingBillingInquiryFamilyProposals;
 constructor(private readonly db:IdentityStore,private readonly workspaceId:WorkspaceId,private readonly ring:Keyring,
  private readonly integrityKey:string,private readonly ownerId:AccountId,private readonly clock:IdentityClock){
  if(!billingId.safeParse(workspaceId).success||!billingId.safeParse(ownerId).success||integrityKey.length<32)fail();
  this.families=new FishingBillingInquiryFamilyProposals(db,workspaceId,ring,integrityKey,clock);
 }
 private now(){const at=this.clock.now();if(!(at instanceof Date)||!Number.isFinite(at.valueOf()))fail();return new Date(at);}
 private hash(value:unknown){return privateDigest(value,this.integrityKey);}
 private request(actorId:string,command:ProgramSourceCommandV3){return programSourceRequestDigestV3(this.workspaceId,actorId,command,this.integrityKey);}
 private aad(group:string,kind:Kind,id:string,revision:number){return programSourceAadV3(this.workspaceId,group,kind,id,revision);}
 private decode(row:Row):Stored{
  return decodeProgramSourceRowV3(row,this.workspaceId,this.ring,this.integrityKey);
 }
 private async owner(context:Readonly<BillingContext>){
  const a=context.actor;if(context.workspaceId!==this.workspaceId||a.workspaceId!==this.workspaceId||a.id!==this.ownerId||a.role!=='practitioner'||a.state!=='active')fail('FORBIDDEN');
  const row=await one(context.tx,`SELECT a.id FROM ls_identity.accounts a JOIN ls_identity.account_subjects s ON s.workspace_id=a.workspace_id AND s.account_id=a.id
   JOIN ls_identity.people p ON p.workspace_id=s.workspace_id AND p.id=s.person_id
   WHERE a.workspace_id=$1 AND a.id=$2 AND a.state='active' AND a.role='practitioner' AND s.person_id=$3 AND p.kind='adult'
   AND NOT EXISTS(SELECT 1 FROM ls_demo.accounts d WHERE d.workspace_id=a.workspace_id AND d.account_id=a.id) FOR UPDATE OF a FOR SHARE OF s,p`,[this.workspaceId,this.ownerId,a.personId]);
  if(!row)fail('FORBIDDEN');
 }
 private async get(tx:SqlSession,groupId:string,kind:Kind,id:string):Promise<Stored|null>{
  return readProgramSourceInTransactionV3({workspaceId:this.workspaceId,tx},this.workspaceId,groupId,kind,id,this.ring,this.integrityKey);
 }
 private async lessons(tx:SqlSession,groupId:string){
  return readProgramLessonsInTransactionV3({workspaceId:this.workspaceId,tx},this.workspaceId,groupId,this.ring,this.integrityKey);
 }
 private async family(tx:SqlSession,record:ProgramSourceRecordV3){
  const command=record.command;if(command.kind!=='progression')fail();
  const fields=command.fields,data=await this.families.readCurrentDataInTransaction(tx,{proposalId:fields.proposalId,reference:fields.reference,expectedEpoch:fields.expectedEpoch,lock:'shared'});
  if(data.proposal.command.selection.familyId!==fields.familyId||!data.proposal.command.selection.children.some(child=>child.nativeChildId===command.id))fail('FORBIDDEN');
  return data;
 }
 private async transaction<T>(actor:Actor,work:(c:BillingContext)=>Promise<T>,onRejected?:(error:AppError)=>never){
  const principal=Object.freeze({...actor});if(principal.workspaceId!==this.workspaceId)fail('FORBIDDEN');let callbackFailure:unknown;
  try{return await this.db.transaction(async session=>{
   callbackFailure=undefined;
   try{
    const tx:SqlSession=Object.freeze({query:session.query.bind(session)});await lockWorkspace(tx,this.workspaceId);
    const c:BillingContext={tx,workspaceId:this.workspaceId,actor:await freshActor(tx,principal,this.now()),now:this.now()};await this.owner(c);
    // Pin this actual session and native subject through commit, including
    // concurrent revocation. The supplied account config is never a session.
    const pinned=await one(tx,`SELECT s.token_digest FROM ls_identity.sessions s WHERE s.workspace_id=$1 AND s.account_id=$2 AND s.token_digest=$3
     AND s.revoked_at IS NULL AND s.expires_at>GREATEST($4::timestamptz,clock_timestamp()) FOR SHARE`,[this.workspaceId,principal.id,principal.sessionDigest,this.now()]);
    if(!pinned)throw new AppError('UNAUTHENTICATED');
    const result=await work(c);c.actor=await freshActor(tx,principal,this.now());await this.owner(c);return result;
   }catch(error){callbackFailure=error;throw error;}
  });}catch(error){if(error===callbackFailure&&error instanceof AppError){if(onRejected)onRejected(error);throw error;}fail();}
 }
 async read(actor:Actor,groupId:string,kind:Kind,id:string){
  billingId.parse(groupId);billingId.parse(id);
  return this.transaction(actor,async c=>{const result=await this.get(c.tx,groupId,kind,id);if(!result)fail('NOT_FOUND');if(result.record.command.kind==='progression')await this.family(c.tx,result.record);return result;});
 }
 /** Complete bounded native owner read for calendar/group reload. A partial
  * or unverifiable record set never becomes an apparently empty schedule. */
 async readGroup(actor:Actor,groupId:string){
  billingId.parse(groupId);
  return this.transaction(actor,c=>this.readGroupDataInTransaction(c,groupId));
 }
 /** Trusted server composition only. Reuses the existing owner transaction,
  * row locks and terminal session check; no nested DB or browser capability. */
 async withOwnerTransaction<T>(actor:Actor,work:(c:Readonly<BillingContext>)=>Promise<T>){
  return this.transaction(actor,c=>this.boundedOwnerWork(c,work));
 }
 private async boundedOwnerWork<T>(c:BillingContext,work:(c:Readonly<BillingContext>)=>Promise<T>){
   let open=true;const tx:SqlSession=Object.freeze({query:<R extends object>(sql:string,v:readonly unknown[]=[])=>{if(!open)fail();return c.tx.query<R>(sql,v);}});
   try{return await work(Object.freeze({...c,tx,actor:Object.freeze({...c.actor}),now:new Date(c.now)}));}finally{open=false;}
 }
 /** Native writer composition only. Correlate this outcome with the writer's
  * exact command. Rejection describes THIS attempt, not resolution of any
  * previously UNKNOWN invocation. Driver/post-COMMIT errors stay uncertain. */
 async withOwnerTransactionOutcome<T>(actor:Actor,work:(c:Readonly<BillingContext>)=>Promise<T>){
  try{return {state:'committed' as const,result:await this.transaction(actor,c=>this.boundedOwnerWork(c,work),error=>{
   if(error.code==='CONFLICT'||error.code==='FORBIDDEN'||error.code==='NOT_FOUND'||error.code==='UNAUTHENTICATED'||error.code==='INVALID_REQUEST')throw new NativeRecordRejection(error.code);throw error;
  })};}catch(error){if(error instanceof NativeRecordRejection)return {state:'rejected_current_attempt' as const,code:error.code};throw error;}
 }
 /** Scheduling data in an already authenticated caller's real transaction.
  * This does not supply financial/guardian/seat or operational authority. */
 async readGroupDataInTransaction(c:Readonly<BillingContext>,groupId:string){
   billingId.parse(groupId);if(c.workspaceId!==this.workspaceId)fail('FORBIDDEN');await lockWorkspace(c.tx,this.workspaceId);await this.owner(c);
   const group=await this.get(c.tx,groupId,'group',groupId);if(!group)fail('NOT_FOUND');
   const lessons=await this.lessons(c.tx,groupId);
   const rows=await c.tx.query<Row>(select+" WHERE h.workspace_id=$1 AND h.group_id=$2 AND h.kind='progression' ORDER BY h.source_id LIMIT 1001 FOR SHARE OF h",[this.workspaceId,groupId]);
   if(rows.length>1000)fail();const progressions=rows.map(row=>this.decode(row));
   for(const progress of progressions)await this.family(c.tx,progress.record);
   await this.owner(c);
   return {version:PROGRAM_SOURCE_V3,classification:'scheduling_facts_only' as const,group,lessons,progressions};
 }
 async record(actor:Actor,raw:unknown){
  const command=programSourceCommandV3Schema.parse(raw);
  return this.recordCommand(actor,command);
 }
 /** Trusted transport recovery result. Only a rejection observed from this
  * exact real SQL callback and returned unchanged by the transaction adapter
  * can be classified as rolled back. Same-coded driver/commit failures remain
  * uncertain and require replay of the original operation, never a new op. */
 async recordOutcome(actor:Actor,raw:unknown):Promise<ProgramSourceRecordOutcomeV3>{
  const command=programSourceCommandV3Schema.parse(raw),principal=Object.freeze({...actor});
  const correlation={version:PROGRAM_SOURCE_V3,workspaceId:this.workspaceId,actorId:principal.id,command};
  try{return {...correlation,state:'recorded',receipt:await this.recordCommand(principal,command,error=>{
   if(error.code==='CONFLICT'||error.code==='FORBIDDEN'||error.code==='NOT_FOUND'||error.code==='UNAUTHENTICATED'||error.code==='INVALID_REQUEST')throw new NativeRecordRejection(error.code);
   throw error;
  })};}catch(error){if(error instanceof NativeRecordRejection)return {...correlation,state:'rejected',code:error.code};throw error;}
 }
 private async recordCommand(actor:Actor,command:ProgramSourceCommandV3,onRejected?:(error:AppError)=>never){
  return this.transaction(actor,async c=>{
   const prior=await c.tx.query<{groupId:string;kind:Kind;id:string;revision:number}>('SELECT group_id AS "groupId",kind,source_id AS id,revision FROM ls_fishing_billing.program_source_versions WHERE workspace_id=$1 AND operation_id=$2',[this.workspaceId,command.operationId]);
   if(prior.length){
    // Fetch that exact immutable version, not a later head, on recovery.
    const p=prior[0]!,rows=await c.tx.query<Row>(`SELECT group_id AS "groupId",kind,source_id AS id,revision,record_digest AS "headDigest",
     workspace_id AS "recordWorkspace",group_id AS "recordGroup",kind AS "recordKind",source_id AS "recordId",revision AS "recordRevision",
     operation_id AS "operationId",recorded_by AS "recordedBy",recorded_at AS "recordedAt",request_digest AS "requestDigest",record_digest AS digest,
     previous_digest AS "previousDigest",payload_ciphertext AS ciphertext FROM ls_fishing_billing.program_source_versions
     WHERE workspace_id=$1 AND group_id=$2 AND kind=$3 AND source_id=$4 AND revision=$5`,[this.workspaceId,p.groupId,p.kind,p.id,p.revision]);
    if(prior.length!==1||rows.length!==1)fail();const original=this.decode(rows[0]!);
    if(this.request(c.actor.id,command)!==this.request(original.record.recordedBy,original.record.command))fail('CONFLICT');
    return {...original,replayed:true};
   }
   const before=await this.get(c.tx,command.groupId,command.kind,command.id);if((before?.record.revision??0)!==command.expectedRevision)fail('CONFLICT');
   if(command.kind!=='group'){
    const group=await this.get(c.tx,command.groupId,'group',command.groupId);
    if(!group||group.record.command.kind!=='group'||group.record.command.fields.state!=='forming')fail('CONFLICT');
   }
   const record=programSourceRecordV3Schema.parse({version:PROGRAM_SOURCE_V3,workspaceId:this.workspaceId,revision:command.expectedRevision+1,recordedBy:c.actor.id,
    recordedAt:this.now().toISOString(),previousDigest:before?.digest??null,command});
   if(command.kind==='progression')await this.family(c.tx,record);
   if(command.kind==='lesson'&&command.fields.state==='scheduled')for(const other of await this.lessons(c.tx,command.groupId)){
    const lesson=other.record.command;if(lesson.kind!=='lesson')fail();
    if(lesson.id!==command.id&&lesson.fields.state==='scheduled'&&Date.parse(command.fields.startsAt)<Date.parse(lesson.fields.endsAt)&&Date.parse(command.fields.endsAt)>Date.parse(lesson.fields.startsAt))fail('CONFLICT');
   }
   const digest=this.hash({domain:'program-source-record/v3',record});
   await c.tx.query('INSERT INTO ls_fishing_billing.program_source_versions(workspace_id,group_id,kind,source_id,revision,operation_id,recorded_by,recorded_at,request_digest,record_digest,previous_digest,payload_ciphertext) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
    [this.workspaceId,command.groupId,command.kind,command.id,record.revision,command.operationId,c.actor.id,record.recordedAt,this.request(c.actor.id,command),digest,record.previousDigest,seal(JSON.stringify(record),this.aad(command.groupId,command.kind,command.id,record.revision),this.ring)]);
   if(before){const changed=await one(c.tx,'UPDATE ls_fishing_billing.program_source_heads SET revision=$5,record_digest=$6 WHERE workspace_id=$1 AND group_id=$2 AND kind=$3 AND source_id=$4 AND revision=$7 AND record_digest=$8 RETURNING source_id',
    [this.workspaceId,command.groupId,command.kind,command.id,record.revision,digest,before.record.revision,before.digest]);if(!changed)fail('CONFLICT');}
   else await c.tx.query('INSERT INTO ls_fishing_billing.program_source_heads(workspace_id,group_id,kind,source_id,revision,record_digest) VALUES($1,$2,$3,$4,$5,$6)',[this.workspaceId,command.groupId,command.kind,command.id,record.revision,digest]);
   if(command.kind==='progression')await this.family(c.tx,record);
   return {record,digest,replayed:false};
  },onRejected);
 }
 /** Real SQL implementation of the prospective period resolver. The caller
  * owns its real authenticated billing transaction/session. This source locks
  * that workspace and validates current Academy native mapping; it supplies
  * scheduling facts, never guardian/financial/payment/activation authority. */
 async firstEligibleLessons(c:Readonly<BillingContext>,query:Parameters<ChildPeriodNativeAuthorityV3['firstEligibleLessons']>[1]):Promise<readonly NativeEligibleLessonV3[]|null>{
  if(c.workspaceId!==this.workspaceId||!query.children.length||query.children.length>10)fail('FORBIDDEN');
  await lockWorkspace(c.tx,this.workspaceId);await this.owner(c);
  const result:NativeEligibleLessonV3[]=[];
  for(const child of query.children){
   const group=await this.get(c.tx,child.groupId,'group',child.groupId),progress=await this.get(c.tx,child.groupId,'progression',child.childId);
   if(!group||!progress)return null;
   const g=group.record.command,p=progress.record.command;if(g.kind!=='group'||p.kind!=='progression')fail();
   const data=await this.family(c.tx,progress.record);
   if(p.fields.familyId!==query.familyId||data.proposal.command.selection.familyId!==query.familyId)fail('FORBIDDEN');
   // Authenticate every current lesson before filtering state/date/readiness.
   const sources=await this.lessons(c.tx,child.groupId);
   if(g.fields.state==='cancelled'||p.fields.state==='withdrawn')return null;
   const ready=p.fields.readiness,eligible=sources.filter(s=>{
    const lesson=s.record.command;if(lesson.kind!=='lesson')fail();
    return lesson.fields.state==='scheduled'&&Date.parse(lesson.fields.startsAt)>=Date.parse(p.fields.eligibleFrom)&&
     (ready==='needs_foundation'?lesson.fields.sequence===1:ready==='foundation_one_complete'?lesson.fields.sequence<=2:true);
   }).sort((a,b)=>{
    const x=a.record.command,y=b.record.command;if(x.kind!=='lesson'||y.kind!=='lesson')fail();return Date.parse(x.fields.startsAt)-Date.parse(y.fields.startsAt)||x.id.localeCompare(y.id);
   });
   const first=eligible[0];if(!first)return null;const lesson=first.record.command;if(lesson.kind!=='lesson')fail();
   result.push({workspaceId:this.workspaceId,familyId:query.familyId,childId:child.childId,groupId:child.groupId,id:lesson.id,revision:first.record.revision,startsAt:lesson.fields.startsAt,
    source:{id:`program-source-v3/${child.groupId}/${lesson.id}/${child.childId}`,sha256:this.hash({domain:'first-eligible-source/v3',group:group.digest,progression:progress.digest,lesson:first.digest,native:data.nativeDigest,source:data.inquiry.sourceDigest})}});
  }
  await this.owner(c);return result;
 }
}
