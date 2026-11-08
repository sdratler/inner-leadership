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
import {isCurrentTrip390Interest,type Trip390CurrentInterest} from '../features/group-application/academy-trip390-contract.ts';

export const FISHING_INQUIRY_FAMILY_PROPOSAL_VERSION='JLFA-FISHING-INQUIRY-FAMILY-PROPOSAL-v1' as const;
const uuid=z.uuid(),digest=z.string().regex(/^[a-f0-9]{64}$/);
const mapping=z.object({applicationChildId:uuid,nativeChildId:uuid}).strict();
const selection=z.object({reference:uuid,familyId:uuid,children:z.array(mapping).min(1).max(10)}).strict()
 .refine(v=>new Set(v.children.map(c=>c.applicationChildId.toLowerCase())).size===v.children.length&&new Set(v.children.map(c=>c.nativeChildId.toLowerCase())).size===v.children.length,'DUPLICATE_CHILD_MAPPING');
const epoch=z.number().int().min(0).max(Number.MAX_SAFE_INTEGER-1);
export const fishingFamilyProposalCommandSchema=z.object({operationId:uuid,expectedEpoch:epoch,
 selection,expectedSourceDigest:digest,expectedNativeDigest:digest}).strict();
export type FishingFamilyProposalCommand=z.infer<typeof fishingFamilyProposalCommandSchema>;
const snapshot=z.object({version:z.string().min(1).max(200),language:z.enum(['en','he']),textDigest:digest}).strict();
const recordSchema=z.object({version:z.literal(FISHING_INQUIRY_FAMILY_PROPOSAL_VERSION),id:uuid,workspaceId:uuid,
 command:fishingFamilyProposalCommandSchema,recordedBy:uuid,recordedAt:z.iso.datetime(),guardianPersonId:uuid,
 messageLanguage:z.enum(['en','he']),sourceVersion:z.string().min(1).max(200),offerVersion:z.string().min(1).max(200),
 acknowledgment:z.object({version:z.string().min(1).max(200),language:z.enum(['en','he']),
  reservationNotice:snapshot,studentConduct:snapshot,whatsapp:z.boolean()}).strict(),
 state:z.literal('proposed'),guardianVerified:z.literal(false),recipientVerified:z.literal(false),
 financialAcceptance:z.literal(false),outboundEligible:z.literal(false),
}).strict();
export type FishingInquiryFamilyProposal=z.infer<typeof recordSchema>;
export type FishingInquiryFamilyProposalRow=Readonly<{id:string;reference:string;familyId:string;guardianId:string;operationId:string;recordedBy:string;
 sourceDigest:string;nativeDigest:string;requestDigest:string;ciphertext:string;createdAt:Date}>;
type Row=FishingInquiryFamilyProposalRow;
const select='SELECT id,application_id AS reference,family_id AS "familyId",guardian_person_id AS "guardianId",operation_id AS "operationId",recorded_by AS "recordedBy",source_digest AS "sourceDigest",native_digest AS "nativeDigest",request_digest AS "requestDigest",payload_ciphertext AS ciphertext,created_at AS "createdAt" FROM ls_fishing_billing.inquiry_family_proposals';
type Selection=z.infer<typeof selection>;
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

/** Internal preparation only. This associates an authentic current inquiry and
 * its already admitted Academy adult contact with explicitly selected EXISTING
 * native membership records. It does not verify identity/guardianship/recipient,
 * accept terms, create a family/account/case, or supply billing/send authority.
 * No route/runtime/schema runner, environment lookup or fallback is installed.
 * The additive proposal DDL must be separately admitted before any real use. */
export class FishingBillingInquiryFamilyProposals{
 private readonly crm:AcademyCrmStore;
 constructor(db:IdentityStore,private readonly workspace:WorkspaceId,private readonly ring:Keyring,
  private readonly integrityKey:string,private readonly clock:IdentityClock=systemClock){
  this.crm=new AcademyCrmStore(db,ring,integrityKey,clock);
 }
 private owner(actor:Actor):Readonly<Actor>{
  const owner=Object.freeze({...actor});
  if(owner.workspaceId!==this.workspace)throw new AppError('FORBIDDEN');return owner;
 }
 private hash(domain:string,value:unknown){return privateDigest({domain,workspace:this.workspace,value},this.integrityKey);}
 private request(actorId:string,command:FishingFamilyProposalCommand){return proposalRequestDigest(this.workspace,this.integrityKey,actorId,command);}
 private fields(record:GroupApplicationRecord):Trip390CurrentInterest{
  if(!isTrip390Interest(record.fields)||!isCurrentTrip390Interest(record.fields))throw new AppError('NOT_FOUND');
  return record.fields;
 }
 private async native(tx:SqlSession,input:Selection,guardianId:string,fields:Trip390CurrentInterest,lock:boolean){
  if(input.children.length!==fields.children.length||!fields.children.every(c=>input.children.some(m=>m.applicationChildId===c.id)))fail('CONFLICT');
  // The guardian ID comes only from the exact current inquiry-origin Academy
  // contact. A caller cannot substitute a person or match private names.
  const family=await one<{id:string;label:string;createdAt:Date;guardianId:string;guardianProfile:string;guardianRole:string}>(tx,
   'SELECT f.id,f.label_ciphertext AS label,f.created_at AS "createdAt",p.id AS "guardianId",p.profile_ciphertext AS "guardianProfile",m.role AS "guardianRole" FROM ls_cases.families f JOIN ls_cases.family_members m ON m.workspace_id=f.workspace_id AND m.family_id=f.id AND m.person_id=$3 AND m.role IN (\'parent\',\'guardian\') JOIN ls_identity.people p ON p.workspace_id=m.workspace_id AND p.id=m.person_id AND p.kind=\'adult\' WHERE f.workspace_id=$1 AND f.id=$2'+(lock?' FOR SHARE OF f,m,p':''),
   [this.workspace,input.familyId,guardianId]);
  if(!family)fail();
  const children=await tx.query<{applicationChildId:string;nativeChildId:string;profile:string}>(
   'SELECT d.application_child_id AS "applicationChildId",p.id AS "nativeChildId",p.profile_ciphertext AS profile FROM jsonb_to_recordset($3::jsonb) AS d(application_child_id uuid,native_child_id uuid) JOIN ls_cases.family_members m ON m.workspace_id=$1 AND m.family_id=$2 AND m.person_id=d.native_child_id AND m.role=\'child\' JOIN ls_identity.people p ON p.workspace_id=m.workspace_id AND p.id=m.person_id AND p.kind=\'minor\' ORDER BY d.application_child_id'+(lock?' FOR SHARE OF m,p':''),
   [this.workspace,input.familyId,JSON.stringify(input.children.map(c=>({application_child_id:c.applicationChildId,native_child_id:c.nativeChildId})))]);
  if(children.length!==input.children.length||new Set(children.map(c=>c.nativeChildId)).size!==children.length)fail();
  // Ciphertext fingerprints detect native drift without decrypting or copying
  // unrelated family profiles into a second customer-data store.
  return this.hash('fishing-inquiry-family-proposal-native/v1',{family:{...family,createdAt:family.createdAt.toISOString()},children});
 }
 private decode(row:Row):FishingInquiryFamilyProposal{
  return decodeFishingInquiryFamilyProposalRecord(row,{workspaceId:this.workspace,keyring:this.ring,integrityKey:this.integrityKey});
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
   const {acknowledgment:a}=fields;
   const document=({version,language,textDigest}:{version:string;language:'en'|'he';textDigest:string})=>({version,language,textDigest});
   const record=recordSchema.parse({version:FISHING_INQUIRY_FAMILY_PROPOSAL_VERSION,id:randomUUID(),workspaceId:this.workspace,
    command,recordedBy:owner.id,recordedAt:this.clock.now().toISOString(),guardianPersonId:context.contact.personId,
    messageLanguage:fields.messageLanguage,sourceVersion:fields.version,offerVersion:fields.offerVersion,
    acknowledgment:{version:a.version,language:a.language,reservationNotice:document(a.reservationNotice),studentConduct:document(a.studentConduct),whatsapp:a.whatsapp},
    state:'proposed',guardianVerified:false,recipientVerified:false,financialAcceptance:false,outboundEligible:false});
   await context.tx.query('INSERT INTO ls_fishing_billing.inquiry_family_proposals(workspace_id,id,application_id,family_id,guardian_person_id,operation_id,recorded_by,source_digest,native_digest,request_digest,payload_ciphertext,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
    [this.workspace,record.id,command.selection.reference,command.selection.familyId,record.guardianPersonId,command.operationId,owner.id,
     command.expectedSourceDigest,command.expectedNativeDigest,requestDigest,seal(JSON.stringify(record),aad(this.workspace,record.id),this.ring),record.recordedAt]);
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
