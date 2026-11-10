import 'server-only';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {AppError} from './errors.ts';
import {AcademyCrmStore} from '../features/contact-ops/server/academy-crm-store.ts';
import {privateDigest} from '../features/contact-ops/server/digests.ts';
import {lockWorkspace} from '../features/identity/data.ts';
import {seal,unseal,type Keyring} from '../features/identity/crypto.ts';
import {one,type IdentityStore,type SqlSession} from '../features/identity/store.ts';
import {systemClock,type Actor,type IdentityClock,type WorkspaceId} from '../features/identity/types.ts';
import {isTrip390Interest,type GroupApplicationRecord} from '../features/group-application/contract.ts';
import {isCurrentTrip390Interest,trip390CurrentInterestSchema,type Trip390CurrentInterest} from '../features/group-application/academy-trip390-contract.ts';
import {NATIVE_FAMILY_VERSION,nativeFamilyCreateCommandSchema} from '../features/fishing-billing/native-family-contract-v1.ts';
import type {NativeFamilyCreateCommand} from '../features/fishing-billing/native-family-contract-v1.ts';
import type {NativeFamilyCreationOutcome,NativeFamilyRejectedCode} from '../features/fishing-billing/native-family-outcome-contract-v1.ts';
import {FISHING_INQUIRY_FAMILY_PROPOSAL_VERSION,fishingInquiryFamilySelectionSchema as selection,fishingFamilyProposalCommandSchema,
 fishingInquiryFamilyProposalSchema as recordSchema,type FishingFamilyProposalCommand,type FishingInquiryFamilyProposal} from '../features/fishing-billing/inquiry-family-contract-v1.ts';
export {FISHING_INQUIRY_FAMILY_PROPOSAL_VERSION,fishingFamilyProposalCommandSchema,fishingInquiryFamilyProposalPreviewSchema,
 fishingInquiryFamilyProposalSchema,type FishingFamilyProposalCommand,type FishingInquiryFamilyProposal} from '../features/fishing-billing/inquiry-family-contract-v1.ts';

const uuid=z.uuid(),digest=z.string().regex(/^[a-f0-9]{64}$/);
const epoch=fishingFamilyProposalCommandSchema.shape.expectedEpoch;
const currentDataId=uuid.refine(value=>value===value.toLowerCase(),'CANONICAL_UUID_REQUIRED');
const currentFamilyDataInputSchema=z.object({proposalId:currentDataId,reference:currentDataId,expectedEpoch:epoch,lock:z.enum(['shared','snapshot'])}).strict();
export type FishingCurrentFamilyDataInput=z.infer<typeof currentFamilyDataInputSchema>;
const nativeCreationJournalSchema=z.object({
 version:z.literal(NATIVE_FAMILY_VERSION),workspaceId:uuid,operationId:uuid,actorId:uuid,
 requestDigest:digest,command:nativeFamilyCreateCommandSchema,proposal:recordSchema,
}).strict();
function proposalAcknowledgment(fields:Trip390CurrentInterest):FishingInquiryFamilyProposal['acknowledgment']{
 const a=fields.acknowledgment;
 const document=({version,language,textDigest}:{version:string;language:'en'|'he';textDigest:string})=>({version,language,textDigest});
 return {version:a.version,language:a.language,reservationNotice:document(a.reservationNotice),studentConduct:document(a.studentConduct),whatsapp:a.whatsapp};
}
type Frozen<T>=T extends object?{readonly[K in keyof T]:Frozen<T[K]>}:T;
function freezeData<T>(value:T):Frozen<T>{
 if(value!==null&&typeof value==='object'){for(const child of Object.values(value))freezeData(child);Object.freeze(value);}
 return value as Frozen<T>;
}
export type FishingInquiryFamilyProposalRow=Readonly<{id:string;reference:string;familyId:string;guardianId:string;operationId:string;recordedBy:string;
 sourceDigest:string;nativeDigest:string;requestDigest:string;ciphertext:string;createdAt:Date}>;
type Row=FishingInquiryFamilyProposalRow;
const select='SELECT id,application_id AS reference,family_id AS "familyId",guardian_person_id AS "guardianId",operation_id AS "operationId",recorded_by AS "recordedBy",source_digest AS "sourceDigest",native_digest AS "nativeDigest",request_digest AS "requestDigest",payload_ciphertext AS ciphertext,created_at AS "createdAt" FROM ls_fishing_billing.inquiry_family_proposals';
type Selection=z.infer<typeof selection>;
// Only the observed native transaction callback rejection below can mint this.
// A same-coded driver/post-COMMIT error is never a rejection receipt.
class NativeFamilyRejection extends Error{constructor(readonly code:NativeFamilyRejectedCode){super(code);}}
function fail(code:'CONFLICT'|'UNAVAILABLE'='UNAVAILABLE'):never{throw new AppError(code);}
const aad=(workspace:string,id:string)=>`ls_fishing_billing/inquiry_family_proposal/v1/${workspace}/${id}`;
const proposalRequestDigest=(workspace:WorkspaceId,integrityKey:string,actorId:string,command:FishingFamilyProposalCommand)=>
 privateDigest({domain:'fishing-inquiry-family-proposal-command/v1',workspace,value:{actorId,command}},integrityKey);

/** Stored-byte integrity ONLY. A decoded proposal remains proposed, with all
 * four approval flags false. This pure decoder checks no current session,
 * source, native membership, guardian, recipient or runtime authorization.
 * Callers must separately establish access and current authority in their TX. */
export function decodeFishingInquiryFamilyProposalRecord(row:FishingInquiryFamilyProposalRow,
 context:{workspaceId:WorkspaceId;keyring:Keyring;integrityKey:string}):FishingInquiryFamilyProposal{
 try{
  const value=recordSchema.parse(JSON.parse(unseal(row.ciphertext,aad(context.workspaceId,row.id),context.keyring))),c=value.command;
  if(value.id!==row.id||value.workspaceId!==context.workspaceId||c.selection.reference!==row.reference||c.selection.familyId!==row.familyId||
   value.guardianPersonId!==row.guardianId||c.operationId!==row.operationId||value.recordedBy!==row.recordedBy||
   c.expectedSourceDigest!==row.sourceDigest||c.expectedNativeDigest!==row.nativeDigest||
   proposalRequestDigest(context.workspaceId,context.integrityKey,value.recordedBy,c)!==row.requestDigest||value.recordedAt!==row.createdAt.toISOString())fail();
  return value;
 }catch{fail();}
}

const nativeFingerprintInputSchema=z.object({workspaceId:uuid,selection,guardianPersonId:uuid,
 currentFields:trip390CurrentInterestSchema,lock:z.enum(['shared','snapshot'])}).strict();
export type FishingInquiryNativeFingerprintInput=Omit<z.infer<typeof nativeFingerprintInputSchema>,'workspaceId'>&{workspaceId:WorkspaceId};

/** Same-TX native data fingerprint ONLY. The caller separately authenticates
 * access and obtains actual current source fields/admitted contact; passing
 * fields or membership IDs supplies no guardian, recipient or billing grant.
 * No transaction, clock, approval, family or identity is created here. */
export async function readFishingInquiryNativeFingerprint(tx:SqlSession,input:FishingInquiryNativeFingerprintInput,integrityKey:string):Promise<string>{
 const parsed=nativeFingerprintInputSchema.safeParse(input);
 if(!parsed.success||!tx||typeof tx.query!=='function')throw new AppError('INVALID_REQUEST');
 const c=parsed.data,workspace=c.workspaceId as WorkspaceId,choice=c.selection,fields=c.currentFields,lock=c.lock==='shared';
 const pinned:SqlSession=Object.freeze({query:tx.query.bind(tx)});
 if(choice.children.length!==fields.children.length||!fields.children.every(child=>choice.children.some(m=>m.applicationChildId===child.id)))fail('CONFLICT');
 const family=await one<{id:string;label:string;createdAt:Date;guardianId:string;guardianProfile:string;guardianRole:string}>(pinned,
  'SELECT f.id,f.label_ciphertext AS label,f.created_at AS "createdAt",p.id AS "guardianId",p.profile_ciphertext AS "guardianProfile",m.role AS "guardianRole" FROM ls_cases.families f JOIN ls_cases.family_members m ON m.workspace_id=f.workspace_id AND m.family_id=f.id AND m.person_id=$3 AND m.role IN (\'parent\',\'guardian\') JOIN ls_identity.people p ON p.workspace_id=m.workspace_id AND p.id=m.person_id AND p.kind=\'adult\' WHERE f.workspace_id=$1 AND f.id=$2'+(lock?' FOR SHARE OF f,m,p':''),
  [workspace,choice.familyId,c.guardianPersonId]);
 if(!family)fail();
 const children=await pinned.query<{applicationChildId:string;nativeChildId:string;profile:string}>(
  'SELECT d.application_child_id AS "applicationChildId",p.id AS "nativeChildId",p.profile_ciphertext AS profile FROM jsonb_to_recordset($3::jsonb) AS d(application_child_id uuid,native_child_id uuid) JOIN ls_cases.family_members m ON m.workspace_id=$1 AND m.family_id=$2 AND m.person_id=d.native_child_id AND m.role=\'child\' JOIN ls_identity.people p ON p.workspace_id=m.workspace_id AND p.id=m.person_id AND p.kind=\'minor\' ORDER BY d.application_child_id'+(lock?' FOR SHARE OF m,p':''),
  [workspace,choice.familyId,JSON.stringify(choice.children.map(child=>({application_child_id:child.applicationChildId,native_child_id:child.nativeChildId})))]);
 if(children.length!==choice.children.length||new Set(children.map(child=>child.nativeChildId)).size!==children.length)fail();
 // Preserve the original fingerprint envelope and SQL ordering exactly.
 // Ciphertext fingerprints detect drift without copying private profiles.
 return privateDigest({domain:'fishing-inquiry-family-proposal-native/v1',workspace,
  value:{family:{...family,createdAt:family.createdAt.toISOString()},children}},integrityKey);
}

/** Internal preparation only. This associates an authentic current inquiry and
 * its already admitted Academy adult contact with explicitly selected EXISTING
 * native membership records. It does not verify identity/guardianship/recipient,
 * accept terms, create a family/account/case, or supply billing/send authority.
 * No route/runtime/schema runner, environment lookup or fallback is installed.
 * The additive proposal DDL must be separately admitted before any real use. */
export class FishingBillingInquiryFamilyProposals{
 private readonly crm:AcademyCrmStore;
 constructor(private readonly db:IdentityStore,private readonly workspace:WorkspaceId,private readonly ring:Keyring,
  private readonly integrityKey:string,private readonly clock:IdentityClock=systemClock){
  this.crm=new AcademyCrmStore(db,ring,integrityKey,clock);
 }
 private owner(actor:Actor):Readonly<Actor>{
  const owner=Object.freeze({...actor});
  if(owner.workspaceId!==this.workspace)throw new AppError('FORBIDDEN');return owner;
 }
 private request(actorId:string,command:FishingFamilyProposalCommand){return proposalRequestDigest(this.workspace,this.integrityKey,actorId,command);}
 private fields(record:GroupApplicationRecord):Trip390CurrentInterest{
  if(!isTrip390Interest(record.fields)||!isCurrentTrip390Interest(record.fields))throw new AppError('NOT_FOUND');
  return record.fields;
 }
 private async native(tx:SqlSession,input:Selection,guardianId:string,fields:Trip390CurrentInterest,lock:boolean){
  return readFishingInquiryNativeFingerprint(tx,{workspaceId:this.workspace,selection:input,guardianPersonId:guardianId,currentFields:fields,lock:lock?'shared':'snapshot'},this.integrityKey);
 }
 private decode(row:Row):FishingInquiryFamilyProposal{
  return decodeFishingInquiryFamilyProposalRecord(row,{workspaceId:this.workspace,keyring:this.ring,integrityKey:this.integrityKey});
 }
 private async insertProposal(tx:SqlSession,actorId:string,command:FishingFamilyProposalCommand,guardianId:string,fields:Trip390CurrentInterest){
  const record=recordSchema.parse({version:FISHING_INQUIRY_FAMILY_PROPOSAL_VERSION,id:randomUUID(),workspaceId:this.workspace,
   command,recordedBy:actorId,recordedAt:this.clock.now().toISOString(),guardianPersonId:guardianId,
   messageLanguage:fields.messageLanguage,sourceVersion:fields.version,offerVersion:fields.offerVersion,
   acknowledgment:proposalAcknowledgment(fields),state:'proposed',guardianVerified:false,recipientVerified:false,financialAcceptance:false,outboundEligible:false});
  await tx.query('INSERT INTO ls_fishing_billing.inquiry_family_proposals(workspace_id,id,application_id,family_id,guardian_person_id,operation_id,recorded_by,source_digest,native_digest,request_digest,payload_ciphertext,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
   [this.workspace,record.id,command.selection.reference,command.selection.familyId,record.guardianPersonId,command.operationId,actorId,
    command.expectedSourceDigest,command.expectedNativeDigest,this.request(actorId,command),seal(JSON.stringify(record),aad(this.workspace,record.id),this.ring),record.recordedAt]);
  return record;
 }
 /** Explicit creation of fresh canonical primitives from a current admitted
  * inquiry. No names are matched, existing records adopted, accounts invited,
  * consent upgraded or cases created. Family, all minors, original proposed
  * association and replay journal commit or roll back together. */
 async createNativeFamily(actor:Actor,raw:unknown){
  const owner=this.owner(actor);return this.createNativeFamilyCommand(owner,nativeFamilyCreateCommandSchema.parse(raw));
 }
 async createNativeFamilyOutcome(actor:Actor,raw:unknown):Promise<NativeFamilyCreationOutcome>{
  const owner=this.owner(actor),command=nativeFamilyCreateCommandSchema.parse(raw),correlation={version:NATIVE_FAMILY_VERSION,workspaceId:this.workspace,actorId:owner.id,command};
  try{return {...correlation,state:'created',receipt:await this.createNativeFamilyCommand(owner,command,error=>{
   if(error.code==='CONFLICT'||error.code==='FORBIDDEN'||error.code==='NOT_FOUND'||error.code==='UNAUTHENTICATED'||error.code==='INVALID_REQUEST')throw new NativeFamilyRejection(error.code);
   throw error;
  })};}catch(error){if(error instanceof NativeFamilyRejection)return {...correlation,state:'rejected',code:error.code};throw error;}
 }
 private async createNativeFamilyCommand(actor:Actor,command:NativeFamilyCreateCommand,onRejected?:(error:AppError)=>never){
  const owner=this.owner(actor);
  const requestDigest=privateDigest({domain:NATIVE_FAMILY_VERSION,workspaceId:this.workspace,actorId:owner.id,command},this.integrityKey);
  const journalAad='ls_fishing_billing/native-family/v1/'+this.workspace+'/'+command.operationId;
  let callbackFailure:unknown;
  // Only errors raised inside the actual transaction can denote rejection.
  // A transport/driver error after commit must remain unknown and replayable.
  const tracked:IdentityStore={transaction:work=>this.db.transaction(async tx=>{
   callbackFailure=undefined;try{return await work(tx);}catch(error){callbackFailure=error;throw error;}
  })};
  const crm=new AcademyCrmStore(tracked,this.ring,this.integrityKey,this.clock);
  try{return await crm.withInquiryContact(owner,{reference:command.reference,expectedEpoch:command.expectedEpoch,intent:'write'},async context=>{
   await lockWorkspace(context.tx,this.workspace);
   const fields=this.fields(context.record);
   if(context.sourceDigest!==command.expectedSourceDigest)fail('CONFLICT');
   if(command.children.length!==fields.children.length||fields.children.some(child=>!command.children.some(m=>m.applicationChildId===child.id)))fail('CONFLICT');
   const prior=await one<{actorId:string;action:string;quoteId:string|null;requestDigest:string;ciphertext:string;createdAt:Date}>(context.tx,
    'SELECT actor_id AS "actorId",action,quote_id AS "quoteId",request_digest AS "requestDigest",result_ciphertext AS ciphertext,created_at AS "createdAt" FROM ls_fishing_billing.commands WHERE workspace_id=$1 AND operation_id=$2 FOR SHARE',[this.workspace,command.operationId]);
   if(prior){
    if(prior.action!=='native_family_create'||prior.quoteId!==null||prior.actorId!==owner.id||prior.requestDigest!==requestDigest)fail('CONFLICT');
    const journal=nativeCreationJournalSchema.parse(JSON.parse(unseal(prior.ciphertext,journalAad,this.ring))),record=journal.proposal;
    if(journal.workspaceId!==this.workspace||journal.operationId!==command.operationId||journal.actorId!==owner.id||journal.requestDigest!==requestDigest||
     privateDigest(journal.command,this.integrityKey)!==privateDigest(command,this.integrityKey)||record.workspaceId!==this.workspace||record.recordedBy!==owner.id||
     record.recordedAt!==prior.createdAt.toISOString()||record.guardianPersonId!==context.contact.personId||record.command.operationId!==command.operationId||
     record.command.expectedEpoch!==command.expectedEpoch||record.command.expectedSourceDigest!==context.sourceDigest||record.command.selection.reference!==command.reference||
     record.command.selection.familyId!==command.familyId||privateDigest(record.command.selection.children,this.integrityKey)!==privateDigest(command.children,this.integrityKey))fail();
    const saved=await one<Row>(context.tx,select+' WHERE workspace_id=$1 AND id=$2 FOR SHARE',[this.workspace,record.id]);
    if(!saved||privateDigest(this.decode(saved),this.integrityKey)!==privateDigest(record,this.integrityKey))fail();
    return {version:NATIVE_FAMILY_VERSION,resultKind:'original_creation_receipt' as const,record,replayed:true};
   }
   if(await one(context.tx,'SELECT id FROM ls_fishing_billing.inquiry_family_proposals WHERE workspace_id=$1 AND application_id=$2',[this.workspace,command.reference]))fail('CONFLICT');
   if(await one(context.tx,'SELECT id FROM ls_cases.families WHERE workspace_id=$1 AND id=$2',[this.workspace,command.familyId])||
    (await context.tx.query('SELECT id FROM ls_identity.people WHERE workspace_id=$1 AND id=ANY($2::uuid[])',[this.workspace,command.children.map(child=>child.nativeChildId)])).length)fail('CONFLICT');
   const now=this.clock.now();
   await context.tx.query('INSERT INTO ls_cases.families(id,workspace_id,label_ciphertext,created_at) VALUES($1,$2,$3,$4)',
    [command.familyId,this.workspace,seal(command.familyLabel,`family:${this.workspace}:${command.familyId}`,this.ring),now]);
   await context.tx.query("INSERT INTO ls_cases.family_members(workspace_id,family_id,person_id,role) VALUES($1,$2,$3,'guardian')",[this.workspace,command.familyId,context.contact.personId]);
   for(const child of command.children){
    const source=fields.children.find(value=>value.id===child.applicationChildId)!;
    await context.tx.query("INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,'minor',$3,$4)",
     [child.nativeChildId,this.workspace,seal(JSON.stringify({displayName:source.name}),`person:${this.workspace}:${child.nativeChildId}`,this.ring),now]);
    await context.tx.query("INSERT INTO ls_cases.family_members(workspace_id,family_id,person_id,role) VALUES($1,$2,$3,'child')",[this.workspace,command.familyId,child.nativeChildId]);
   }
   const choice={reference:command.reference,familyId:command.familyId,children:command.children};
   const nativeDigest=await this.native(context.tx,choice,context.contact.personId,fields,true);
   const proposalCommand={operationId:command.operationId,expectedEpoch:command.expectedEpoch,selection:choice,expectedSourceDigest:context.sourceDigest,expectedNativeDigest:nativeDigest};
   const record=await this.insertProposal(context.tx,owner.id,proposalCommand,context.contact.personId,fields);
   const journal=nativeCreationJournalSchema.parse({version:NATIVE_FAMILY_VERSION,workspaceId:this.workspace,operationId:command.operationId,actorId:owner.id,requestDigest,command,proposal:record});
   await context.tx.query('INSERT INTO ls_fishing_billing.commands(workspace_id,operation_id,actor_id,action,quote_id,request_digest,result_ciphertext,created_at) VALUES($1,$2,$3,$4,NULL,$5,$6,$7)',
    [this.workspace,command.operationId,owner.id,'native_family_create',requestDigest,seal(JSON.stringify(journal),journalAad,this.ring),record.recordedAt]);
   if(await this.native(context.tx,choice,context.contact.personId,fields,true)!==nativeDigest)fail('CONFLICT');
   return {version:NATIVE_FAMILY_VERSION,resultKind:'original_creation_receipt' as const,record,replayed:false};
  });}catch(error){if(error===callbackFailure&&error instanceof AppError){if(onRejected)onRejected(error);throw error;}throw new AppError('UNAVAILABLE');}
 }
 /** Actual current family DATA only, in the already authorized caller's TX.
  * A known proposal must still match current source/admitted contact/native
  * records. This is not caller authentication or independent guardian,
  * recipient, financial, source-release, policy or target admission.
  * Shared data locks use the existing nonblocking contact fence first; the
  * caller owns its real owner/service frame, clock, isolation and terminal
  * checks. Snapshot data never establishes stable action permission. */
 async readCurrentDataInTransaction(tx:SqlSession,input:FishingCurrentFamilyDataInput){
  const parsed=currentFamilyDataInputSchema.safeParse(input);
  if(!parsed.success||!tx||typeof tx.query!=='function')throw new AppError('INVALID_REQUEST');
  const c=parsed.data,workspace=this.workspace,ring=this.ring,key=this.integrityKey;
  const pinned:SqlSession=Object.freeze({query:tx.query.bind(tx)});
  const inquiry=await this.crm.readInquiryContactDataInTransaction(pinned,{workspaceId:workspace,reference:c.reference,expectedEpoch:c.expectedEpoch,lock:c.lock});
  const current=trip390CurrentInterestSchema.safeParse(inquiry.record.fields);
  if(!current.success)throw new AppError('NOT_FOUND');const fields=current.data;
  const row=await one<Row>(pinned,select+' WHERE workspace_id=$1 AND id=$2'+(c.lock==='shared'?' FOR SHARE':''),[workspace,c.proposalId]);
  if(!row)throw new AppError('NOT_FOUND');
  const proposal=decodeFishingInquiryFamilyProposalRecord(row,{workspaceId:workspace,keyring:ring,integrityKey:key});
  if(proposal.command.selection.reference!==c.reference||proposal.guardianPersonId!==inquiry.contact.personId||
   proposal.command.expectedSourceDigest!==inquiry.sourceDigest||proposal.sourceVersion!==fields.version||proposal.offerVersion!==fields.offerVersion||
   proposal.messageLanguage!==fields.messageLanguage||JSON.stringify(proposal.acknowledgment)!==JSON.stringify(proposalAcknowledgment(fields)))fail('CONFLICT');
  const nativeDigest=await readFishingInquiryNativeFingerprint(pinned,{workspaceId:workspace,selection:proposal.command.selection,
   guardianPersonId:inquiry.contact.personId,currentFields:trip390CurrentInterestSchema.parse(fields),lock:c.lock},key);
  if(nativeDigest!==proposal.command.expectedNativeDigest)fail('CONFLICT');
  return freezeData({classification:'current_family_data_only_not_authority' as const,consistency:c.lock,proposal,inquiry,nativeDigest});
 }
 async preview(actor:Actor,input:{expectedEpoch:number;selection:Selection}){
  const owner=this.owner(actor),c=z.object({expectedEpoch:epoch,selection}).strict().parse(input);
  return this.crm.withInquiryContact(owner,{reference:c.selection.reference,expectedEpoch:c.expectedEpoch,intent:'read'},async context=>{
   const fields=this.fields(context.record),nativeDigest=await this.native(context.tx,c.selection,context.contact.personId,fields,false);
   return {version:FISHING_INQUIRY_FAMILY_PROPOSAL_VERSION,selection:c.selection,sourceDigest:context.sourceDigest,nativeDigest,
    guardianPersonId:context.contact.personId,messageLanguage:fields.messageLanguage,state:'proposed' as const,
    guardianVerified:false as const,recipientVerified:false as const,financialAcceptance:false as const,outboundEligible:false as const};
  });
 }
 async propose(actor:Actor,input:FishingFamilyProposalCommand){
  const owner=this.owner(actor),command=fishingFamilyProposalCommandSchema.parse(input),requestDigest=this.request(owner.id,command);
  return this.crm.withInquiryContact(owner,{reference:command.selection.reference,expectedEpoch:command.expectedEpoch,intent:'write'},async context=>{
   await lockWorkspace(context.tx,this.workspace);
   const fields=this.fields(context.record),nativeDigest=await this.native(context.tx,command.selection,context.contact.personId,fields,true);
   if(context.sourceDigest!==command.expectedSourceDigest||nativeDigest!==command.expectedNativeDigest)fail('CONFLICT');
   const prior=await one<Row>(context.tx,select+' WHERE workspace_id=$1 AND operation_id=$2 FOR SHARE',[this.workspace,command.operationId]);
   if(prior){
    const record=this.decode(prior);
    if(prior.requestDigest!==requestDigest||record.guardianPersonId!==context.contact.personId)fail('CONFLICT');
    return {record,replayed:true};
   }
   if(await one(context.tx,'SELECT id FROM ls_fishing_billing.inquiry_family_proposals WHERE workspace_id=$1 AND application_id=$2',[this.workspace,command.selection.reference]))fail('CONFLICT');
   const record=await this.insertProposal(context.tx,owner.id,command,context.contact.personId,fields);
   return {record,replayed:false};
  });
 }
 async read(actor:Actor,input:{reference:string;expectedEpoch:number}){
  const owner=this.owner(actor),c=z.object({reference:uuid,expectedEpoch:epoch}).strict().parse(input);
  return this.crm.withInquiryContact(owner,{...c,intent:'read'},async context=>{
   const row=await one<Row>(context.tx,select+' WHERE workspace_id=$1 AND application_id=$2',[this.workspace,c.reference]);
   if(!row)throw new AppError('NOT_FOUND');const record=this.decode(row),fields=this.fields(context.record);
   const nativeDigest=await this.native(context.tx,record.command.selection,context.contact.personId,fields,false);
   if(record.guardianPersonId!==context.contact.personId||record.command.expectedSourceDigest!==context.sourceDigest||record.command.expectedNativeDigest!==nativeDigest)fail('CONFLICT');
   return record;
  });
 }
}
