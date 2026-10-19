import 'server-only';
import {createHash,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {AppError} from '../../lib/errors.ts';
import {asId} from '../../lib/ids.ts';
import {one,type IdentityStore,type SqlSession} from '../identity/store.ts';
import {freshActor,accountById} from '../identity/data.ts';
import {seal,unseal} from '../identity/crypto.ts';
import type {IdentityConfig} from '../identity/config.ts';
import {IdentityAccountService} from '../identity/account-service.ts';
import {systemClock,type Actor,type IdentityClock} from '../identity/types.ts';
import {requirePractitioner} from '../cases/policy.ts';
import {demoRecordBatch} from '../demo/provenance.ts';
import type {PublicGroupApplicationStore} from '../group-application/store.ts';
import {floridaParentApplicationFieldsSchema} from '../group-application/contract.ts';
import {FishingLeadStore} from '../contact-ops/server/fishing-lead-store.ts';
import {academyFamilyCommandSchema,academyFamilySavedSchema,academyFamilyVersion,type AcademyFamilySaved,type AcademyFamilyContext} from './academy-family-contract.ts';
import type {AcademyOwnerEnrollmentBinding} from './academy-enrollment-contract.ts';
import {readEducationalChildContexts} from './native-child-context.ts';
const digest=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex'),action='academy.family.setup';
const receiptPayload=z.strictObject({saved:academyFamilySavedSchema,command:academyFamilyCommandSchema});
type ReceiptRow={actorId:string;operationId:string;hash:string;ciphertext:string};
export class AcademyFamilyStore{
 private readonly accounts:IdentityAccountService;
 constructor(private readonly db:IdentityStore,private readonly config:IdentityConfig,private readonly inquiries:PublicGroupApplicationStore,private readonly leads:FishingLeadStore,private readonly clock:IdentityClock=systemClock){this.accounts=new IdentityAccountService(db,config,clock);}
 private aad(actorId:string,operationId:string,hash:string){return `academy-family:v1:${this.config.workspaceId}:${actorId}:${operationId}:${hash}`;}
 private async owner(tx:SqlSession,actor:Actor){if(actor.workspaceId!==this.config.workspaceId)throw new AppError('FORBIDDEN');const current=await freshActor(tx,actor,this.clock.now());requirePractitioner(current);if(!current.emailVerifiedAt)throw new AppError('UNAUTHENTICATED');}
 private async configured(tx:SqlSession){return Boolean(await one(tx,"SELECT c.oid FROM pg_class c WHERE c.oid=to_regclass('ls_fishing_stage.command_receipts') AND c.relkind='r'"));}
 private async intake(tx:SqlSession,actor:Actor,id:string){
  const record=await this.inquiries.readForOwnerInTransaction(tx,actor,id),parsed=floridaParentApplicationFieldsSchema.safeParse(record.fields);
  if(!parsed.success||parsed.data.programId!=='sunday_fishing_academy'||!parsed.data.academyIntake||!parsed.data.academyFit||parsed.data.academyIntake.learners.some(c=>c.ageYears===undefined))throw new AppError('INVALID_REQUEST');
  return {fields:parsed.data,intake:parsed.data.academyIntake,hash:digest(parsed.data)};
 }
 private async receipts(tx:SqlSession,actor:Actor){
  const rows=await tx.query<ReceiptRow>('SELECT actor_id AS "actorId",command_id AS "operationId",request_sha256 AS hash,result_ciphertext AS ciphertext FROM ls_fishing_stage.command_receipts WHERE workspace_id=$1 AND action=$2 ORDER BY recorded_at,actor_id,command_id LIMIT 1001',[actor.workspaceId,action]);
  if(rows.length>1000)throw new AppError('UNAVAILABLE');
  return rows.map(row=>{try{const payload=receiptPayload.parse(JSON.parse(unseal(row.ciphertext,this.aad(row.actorId,row.operationId,row.hash),this.config.keyring)));if(payload.command.operationId!==row.operationId||digest(payload.command)!==row.hash||payload.saved.applicationId!==payload.command.applicationId||payload.saved.personId!==payload.command.personId)throw new Error();return {...row,saved:payload.saved};}catch{throw new AppError('UNAVAILABLE');}});
 }
 private async households(tx:SqlSession,personId:string){
  const rows=await tx.query<{id:string;ciphertext:string}>('SELECT f.id,f.label_ciphertext AS ciphertext FROM ls_cases.families f JOIN ls_cases.family_members m ON m.workspace_id=f.workspace_id AND m.family_id=f.id WHERE f.workspace_id=$1 AND m.person_id=$2 AND m.role IN (\'parent\',\'guardian\') ORDER BY f.id LIMIT 101 FOR SHARE OF f,m',[this.config.workspaceId,personId]);if(rows.length>100)throw new AppError('UNAVAILABLE');
  const result=[];for(const row of rows){
   // Only already verified educational children can be deliberately reused;
   // sharing an adult/name/household never imports a clinical case or grant.
   const children=await tx.query<{id:string;ciphertext:string}>(`SELECT p.id,p.profile_ciphertext AS ciphertext FROM ls_cases.family_members m JOIN ls_identity.people p ON p.workspace_id=m.workspace_id AND p.id=m.person_id AND p.kind='minor' JOIN ls_identity.account_subjects s ON s.workspace_id=m.workspace_id AND s.person_id=$3 JOIN ls_identity.accounts a ON a.workspace_id=s.workspace_id AND a.id=s.account_id AND a.role='parent' AND a.state<>'revoked' JOIN ls_education.guardian_authorities g ON g.workspace_id=p.workspace_id AND g.learner_id=p.id AND g.account_id=a.id AND g.active AND g.verified_at<=clock_timestamp() WHERE m.workspace_id=$1 AND m.family_id=$2 AND m.role='child' AND NOT EXISTS(SELECT 1 FROM ls_education.access_revocations r WHERE r.workspace_id=p.workspace_id AND(r.account_id IS NULL OR r.account_id=a.id)AND(r.learner_id IS NULL OR r.learner_id=p.id)AND r.module_id IS NULL AND r.version IS NULL) ORDER BY p.id LIMIT 101 FOR SHARE OF m,p,s,a,g`,[this.config.workspaceId,row.id,personId]);
   if(children.length>100)throw new AppError('UNAVAILABLE');result.push({id:row.id,label:unseal(row.ciphertext,`family:${this.config.workspaceId}:${row.id}`,this.config.keyring),children:children.map(child=>({id:child.id,displayName:z.object({displayName:z.string().min(1).max(160)}).parse(JSON.parse(unseal(child.ciphertext,`person:${this.config.workspaceId}:${child.id}`,this.config.keyring))).displayName}))});
  }return result;
 }
 private async currentSaved(tx:SqlSession,saved:AcademyFamilySaved){
  const account=await accountById(tx,this.config.workspaceId,asId(saved.parentAccountId,'account'));if(!account||account.personId!==saved.personId||account.role!=='parent'||account.state==='revoked')throw new AppError('CONFLICT');
  const rows=await tx.query<{id:string}>(`SELECT c.person_id AS id FROM ls_cases.family_members c JOIN ls_cases.family_members p ON p.workspace_id=c.workspace_id AND p.family_id=c.family_id AND p.person_id=$3 AND p.role IN('parent','guardian') JOIN ls_education.guardian_authorities g ON g.workspace_id=c.workspace_id AND g.learner_id=c.person_id AND g.account_id=$4 AND g.active AND g.verified_at<=clock_timestamp() WHERE c.workspace_id=$1 AND c.family_id=$2 AND c.role='child' AND NOT EXISTS(SELECT 1 FROM ls_education.access_revocations r WHERE r.workspace_id=c.workspace_id AND(r.account_id IS NULL OR r.account_id=$4)AND(r.learner_id IS NULL OR r.learner_id=c.person_id)AND r.module_id IS NULL AND r.version IS NULL) ORDER BY c.person_id`,[this.config.workspaceId,saved.householdId,saved.personId,saved.parentAccountId]);
  if(saved.children.some(child=>!rows.some(r=>r.id===child.learnerId)))throw new AppError('CONFLICT');
  return {...saved,parentState:account.state};
 }
 async context(actor:Actor,applicationId:string):Promise<AcademyFamilyContext>{
  if(actor.workspaceId!==this.config.workspaceId)throw new AppError('FORBIDDEN');
  const lead=await this.leads.context(actor,{kind:'inquiry',id:applicationId});if(lead.state!=='ready'||!lead.personId||lead.membership?.state!=='active'||lead.membership.relationship!=='guardian')return {state:'not_ready',reason:'native_lead_required'};
  return this.db.transaction(async tx=>{
   const person=await this.leads.readGuardianLeadForFamilyInTransaction(tx,actor,{applicationId,personId:lead.personId!,expectedEpoch:lead.epoch,expectedAssociationVersion:lead.membership!.version});await this.owner(tx,actor);
   if(!await this.configured(tx))return {state:'not_ready',reason:'not_configured'};
   let source:Awaited<ReturnType<AcademyFamilyStore['intake']>>;try{source=await this.intake(tx,actor,applicationId);}catch(e){if(e instanceof AppError&&e.code==='INVALID_REQUEST')return {state:'not_ready',reason:'complete_intake_required'};throw e;}
   const saved=(await this.receipts(tx,actor)).filter(r=>r.saved.applicationId===applicationId);if(saved.length>1)throw new AppError('UNAVAILABLE');if(saved[0]&&saved[0].saved.personId!==person.personId)throw new AppError('CONFLICT');
   return {state:'ready',applicationId,personId:person.personId,parentName:person.displayName,expectedEpoch:lead.epoch,expectedAssociationVersion:person.associationVersion,fieldsDigest:source.hash,learnerAges:source.intake.learners.map(c=>c.ageYears!),households:await this.households(tx,person.personId),saved:saved[0]?await this.currentSaved(tx,saved[0].saved):null};
  });
 }
 async readForEnrollmentInTransaction(tx:SqlSession,actor:Actor,binding:AcademyOwnerEnrollmentBinding){
  if(actor.workspaceId!==this.config.workspaceId)throw new AppError('FORBIDDEN');
  await this.leads.readGuardianLeadForFamilyInTransaction(tx,actor,binding);await this.owner(tx,actor);if(!await this.configured(tx))throw new AppError('UNAVAILABLE');
  const source=await this.intake(tx,actor,binding.applicationId);if(source.hash!==binding.expectedFieldsDigest)throw new AppError('CONFLICT');
  const matches=(await this.receipts(tx,actor)).filter(r=>r.saved.applicationId===binding.applicationId&&r.saved.personId===binding.personId);if(matches.length!==1)throw new AppError('CONFLICT');const saved=await this.currentSaved(tx,matches[0]!.saved);
  if(digest(saved)!==binding.expectedFamilyDigest)throw new AppError('CONFLICT');return saved;
 }
 async readParentForEnrollmentInTransaction(tx:SqlSession,actor:Actor,learnerId:string){
  if(actor.workspaceId!==this.config.workspaceId)throw new AppError('FORBIDDEN');
  await readEducationalChildContexts(tx,actor,this.config.keyring,this.clock.now(),learnerId);if(!await this.configured(tx))throw new AppError('UNAVAILABLE');
  const matches=(await this.receipts(tx,actor)).filter(r=>r.saved.parentAccountId===actor.id&&r.saved.children.some(c=>c.learnerId===learnerId));
  if(matches.length===0)throw new AppError('NOT_FOUND');if(new Set(matches.map(r=>r.saved.householdId)).size!==1)throw new AppError('CONFLICT');
  const saved=matches[0]!.saved,child=saved.children.find(c=>c.learnerId===learnerId)!;
  const current=await this.currentSaved(tx,{...saved,children:[child]});if(current.parentState!=='active')throw new AppError('FORBIDDEN');return {learnerId,householdId:current.householdId,parentAccountId:current.parentAccountId};
 }
 async setup(actor:Actor,raw:unknown,requestId:string){
  if(actor.workspaceId!==this.config.workspaceId)throw new AppError('FORBIDDEN');
  const parsed=academyFamilyCommandSchema.safeParse(raw);if(!parsed.success)throw new AppError('INVALID_REQUEST');const command=parsed.data;
  try{return await this.db.transaction(async tx=>{
   await this.leads.readGuardianLeadForFamilyInTransaction(tx,actor,command);await this.owner(tx,actor);if(!await this.configured(tx))throw new AppError('UNAVAILABLE');
   const source=await this.intake(tx,actor,command.applicationId);if(source.hash!==command.expectedFieldsDigest||source.intake.learners.length!==command.children.length)throw new AppError('CONFLICT');
   const hash=digest(command),prior=await one<{action:string;hash:string}>(tx,'SELECT action,request_sha256 AS hash FROM ls_fishing_stage.command_receipts WHERE workspace_id=$1 AND actor_id=$2 AND command_id=$3',[actor.workspaceId,actor.id,command.operationId]),receipts=await this.receipts(tx,actor);
   const existing=receipts.find(r=>r.actorId===actor.id&&r.operationId===command.operationId);
   if(prior){if(prior.action!==action||prior.hash!==hash||!existing)throw new AppError('CONFLICT');const saved=await this.currentSaved(tx,existing.saved);await this.owner(tx,actor);return {saved,replayed:true};}
   if(receipts.length>=1000||receipts.some(r=>r.saved.applicationId===command.applicationId))throw new AppError('CONFLICT');
   const households=await this.households(tx,command.personId);if(command.householdId===null?households.length!==0:!households.some(h=>h.id===command.householdId))throw new AppError('CONFLICT');
   if(command.householdId&&await demoRecordBatch(tx,actor.workspaceId,'family',command.householdId))throw new AppError('FORBIDDEN');
   for(const child of command.children)if(child.existingLearnerId&&!households.find(h=>h.id===command.householdId)?.children.some(c=>c.id===child.existingLearnerId&&c.displayName===child.displayName))throw new AppError('CONFLICT');
   for(const child of command.children)if(child.existingLearnerId&&await demoRecordBatch(tx,actor.workspaceId,'person',child.existingLearnerId))throw new AppError('FORBIDDEN');
   const parent=await this.accounts.prepareAcademyParentInTransaction(tx,actor,{personId:asId(command.personId,'person'),email:command.parentEmail,locale:command.locale},requestId),now=this.clock.now(),householdId=command.householdId??randomUUID();
   if(command.householdId===null){await tx.query('INSERT INTO ls_cases.families(id,workspace_id,label_ciphertext,created_at) VALUES($1,$2,$3,$4)',[householdId,actor.workspaceId,seal('Academy family — '+source.fields.parentName.slice(0,100),`family:${actor.workspaceId}:${householdId}`,this.config.keyring),now]);await tx.query("INSERT INTO ls_cases.family_members(workspace_id,family_id,person_id,role) VALUES($1,$2,$3,'parent')",[actor.workspaceId,householdId,command.personId]);}
   const children=[];for(const child of command.children){const learnerId=child.existingLearnerId??randomUUID();if(child.existingLearnerId===null){await tx.query("INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,'minor',$3,$4)",[learnerId,actor.workspaceId,seal(JSON.stringify({displayName:child.displayName,ageYears:source.intake.learners[child.learnerIndex]!.ageYears,academyInquiryId:command.applicationId,learnerIndex:child.learnerIndex}),`person:${actor.workspaceId}:${learnerId}`,this.config.keyring),now]);await tx.query("INSERT INTO ls_cases.family_members(workspace_id,family_id,person_id,role) VALUES($1,$2,$3,'child')",[actor.workspaceId,householdId,learnerId]);await tx.query('INSERT INTO ls_education.guardian_authorities(workspace_id,learner_id,account_id,active,verified_at,source_reference,verified_by) VALUES($1,$2,$3,true,$4,$5,$6)',[actor.workspaceId,learnerId,parent.accountId,now,`academy-owner:${command.applicationId}:${command.operationId}`,actor.id]);}children.push({learnerIndex:child.learnerIndex,displayName:child.displayName,learnerId});}
   const saved=academyFamilySavedSchema.parse({version:academyFamilyVersion,applicationId:command.applicationId,personId:command.personId,parentAccountId:parent.accountId,householdId,parentState:parent.state,invitation:parent.invitationQueued?'queued':'existing_account',children,enrollmentCreated:false});
   // Preserve the verified owner reference in the encrypted immutable receipt;
   // never return invitation tokens, parent email or this private reference.
   await tx.query('INSERT INTO ls_fishing_stage.command_receipts(workspace_id,actor_id,command_id,action,request_sha256,result_ciphertext,recorded_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[actor.workspaceId,actor.id,command.operationId,action,hash,seal(JSON.stringify({saved,command}),this.aad(actor.id,command.operationId,hash),this.config.keyring),now]);
   await this.owner(tx,actor);return {saved,replayed:false};
  });}catch(e){if(e instanceof AppError)throw e;if(e&&typeof e==='object'&&'code'in e&&['23505','40001','40P01'].includes(String(e.code)))throw new AppError('CONFLICT');throw new AppError('UNAVAILABLE');}
 }
}
