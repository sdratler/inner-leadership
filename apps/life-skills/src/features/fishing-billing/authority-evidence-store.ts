import 'server-only';
import {z} from 'zod';
import {AppError} from '../../lib/errors.ts';
import {unseal,type Keyring} from '../identity/crypto.ts';
import type {SqlSession} from '../identity/store.ts';
import type {WorkspaceId} from '../identity/types.ts';
import {privateDigest} from '../contact-ops/server/digests.ts';
import {sourceReferenceSchema,reminderPolicySchema} from './contracts.ts';
import {reminderServiceBindingSchema} from './reminder-service.ts';
import {decodeFishingInquiryFamilyProposalRecord,type FishingInquiryFamilyProposalRow} from '../../lib/fishing-billing-inquiry-family-proposal.ts';

export const AUTHORITY_EVIDENCE_VERSION='JLFA-FISHING-BILLING-AUTHORITY-EVIDENCE-v1' as const;
export const AUTHORITY_REVOCATION_VERSION='JLFA-FISHING-BILLING-AUTHORITY-REVOCATION-v1' as const;
const uuid=z.uuid().refine(s=>s===s.toLowerCase(),'CANONICAL_UUID_REQUIRED');
const digest=z.string().regex(/^[a-f0-9]{64}$/),instant=z.iso.datetime({offset:true});
const purpose=z.enum(['guardian_assurance','email_recipient','financial_terms_release','completion_privacy_release','reminder_policy_release','service_admission']);
export type AuthorityEvidencePurpose=z.infer<typeof purpose>;
const familyPurpose=(p:AuthorityEvidencePurpose)=>p==='guardian_assurance'||p==='email_recipient';
export const authorityEvidenceFamilySchema=z.object({proposalId:uuid,reference:uuid,familyId:uuid,guardianPersonId:uuid,
 children:z.array(z.object({applicationChildId:z.uuid(),nativeChildId:uuid}).strict()).min(1).max(10),sourceDigest:digest,nativeDigest:digest,
}).strict().refine(v=>new Set(v.children.map(c=>c.applicationChildId.toLowerCase())).size===v.children.length&&
 new Set(v.children.map(c=>c.nativeChildId)).size===v.children.length,'DUPLICATE_CHILD_MAPPING');
export type AuthorityEvidenceFamily=z.infer<typeof authorityEvidenceFamilySchema>;
const document=z.object({source:sourceReferenceSchema,version:z.string().min(1).max(200),locale:z.enum(['en','he']),
 textSha256:digest,releaseEvidence:sourceReferenceSchema.nullable()}).strict();
const metadata={version:z.literal(AUTHORITY_EVIDENCE_VERSION),id:uuid,workspaceId:uuid,
 programKey:z.literal('fishing_monthly_club'),mode:z.literal('test'),state:z.enum(['prepared','released']),
 sourceReference:sourceReferenceSchema,releaseEvidence:sourceReferenceSchema.nullable(),
 recordedBy:uuid,recordedAt:instant,releasedAt:instant.nullable(),expiresAt:instant.nullable()};
export const authorityEvidenceRecordSchema=z.discriminatedUnion('purpose',[
 z.object({...metadata,purpose:z.literal('guardian_assurance'),family:authorityEvidenceFamilySchema,
  body:z.object({independentReviewEvidence:sourceReferenceSchema}).strict()}).strict(),
 z.object({...metadata,purpose:z.literal('email_recipient'),family:authorityEvidenceFamilySchema,
  body:z.object({email:z.email().max(254).refine(s=>s===s.trim().toLowerCase()),locale:z.enum(['en','he']),verificationEvidence:sourceReferenceSchema}).strict()}).strict(),
 z.object({...metadata,purpose:z.literal('financial_terms_release'),family:z.null(),body:document}).strict(),
 z.object({...metadata,purpose:z.literal('completion_privacy_release'),family:z.null(),body:document}).strict(),
 z.object({...metadata,purpose:z.literal('reminder_policy_release'),family:z.null(),body:reminderPolicySchema}).strict(),
 z.object({...metadata,purpose:z.literal('service_admission'),family:z.null(),
  body:z.object({binding:reminderServiceBindingSchema,reviewedTargetSchemaReceipt:sourceReferenceSchema}).strict()}).strict(),
]).superRefine((r,c)=>{
 if(r.state==='released'&&(!r.releaseEvidence||!r.releasedAt||!r.expiresAt))c.addIssue({code:'custom',message:'RELEASE_METADATA_REQUIRED'});
 if(r.releasedAt&&r.expiresAt&&Date.parse(r.expiresAt)<=Date.parse(r.releasedAt))c.addIssue({code:'custom',message:'EXPIRY_ORDER'});
 if(r.purpose==='financial_terms_release'||r.purpose==='completion_privacy_release'){
  if(!same(r.body.source,r.sourceReference)||!same(r.body.releaseEvidence,r.releaseEvidence))c.addIssue({code:'custom',message:'DOCUMENT_BINDING'});
 }
 if(r.purpose==='reminder_policy_release'&&!same(r.body.source,r.sourceReference))c.addIssue({code:'custom',message:'POLICY_SOURCE_BINDING'});
});
export type AuthorityEvidenceRecord=z.infer<typeof authorityEvidenceRecordSchema>;
type ReleasedEvidence=AuthorityEvidenceRecord&{state:'released';releaseEvidence:z.infer<typeof sourceReferenceSchema>;releasedAt:string;expiresAt:string};
export const authorityEvidenceRevocationSchema=z.object({version:z.literal(AUTHORITY_REVOCATION_VERSION),id:uuid,workspaceId:uuid,
 programKey:z.literal('fishing_monthly_club'),mode:z.literal('test'),evidenceId:uuid,evidenceDigest:digest,
 recordedBy:uuid,recordedAt:instant,evidenceReference:sourceReferenceSchema}).strict();
export type AuthorityEvidenceRevocation=z.infer<typeof authorityEvidenceRevocationSchema>;
export const authorityEvidenceLookupSchema=z.object({id:uuid,purpose,sourceReference:sourceReferenceSchema,
 releaseEvidence:sourceReferenceSchema.nullable(),family:authorityEvidenceFamilySchema.nullable()}).strict()
 .refine(v=>familyPurpose(v.purpose)===(v.family!==null),'PURPOSE_SCOPE_REQUIRED');
export const authorityEvidenceBatchSchema=z.object({lock:z.enum(['shared','snapshot']),lookups:z.array(authorityEvidenceLookupSchema).min(1).max(50)}).strict()
 .refine(v=>new Set(v.lookups.map(l=>l.id)).size===v.lookups.length,'DISTINCT_IDS_REQUIRED');
export type AuthorityEvidenceBatch=z.infer<typeof authorityEvidenceBatchSchema>;
export type AuthorityEvidenceContext={tx:SqlSession;workspaceId:WorkspaceId;now:Date};
type Frozen<T>=T extends object?{readonly[K in keyof T]:Frozen<T[K]>}:T;
export type ReleasedEvidenceRead={readonly classification:'integrity_only_not_authority';readonly consistency:'shared'|'snapshot';readonly record:Frozen<ReleasedEvidence>};
export type OriginalEvidenceRead={readonly classification:'historical_data_only';readonly consistency:'shared'|'snapshot';
 readonly record:Frozen<AuthorityEvidenceRecord>;readonly revocation:Frozen<AuthorityEvidenceRevocation>|null};
type EvidenceRow={id:string;workspaceId:string;programKey:string;mode:string;purpose:string;state:string;
 sourceId:string;sourceSha:string;releaseId:string|null;releaseSha:string|null;recordedBy:string;createdAt:Date;
 releasedAt:Date|null;expiresAt:Date|null;proposalId:string|null;reference:string|null;familyId:string|null;guardianId:string|null;
 sourceDigest:string|null;nativeDigest:string|null;payloadDigest:string;ciphertext:string};
type RevocationRow={id:string;workspaceId:string;programKey:string;mode:string;evidenceId:string;evidenceDigest:string;
 recordedBy:string;createdAt:Date;payloadDigest:string;ciphertext:string};
const evidenceSelect=`SELECT e.id,e.workspace_id AS "workspaceId",e.program_key AS "programKey",e.mode,e.purpose,e.state,
 e.source_reference_id AS "sourceId",e.source_reference_sha256 AS "sourceSha",e.release_evidence_id AS "releaseId",e.release_evidence_sha256 AS "releaseSha",
 e.recorded_by AS "recordedBy",e.created_at AS "createdAt",e.released_at AS "releasedAt",e.expires_at AS "expiresAt",
 e.proposal_id AS "proposalId",e.application_id AS reference,e.family_id AS "familyId",e.guardian_person_id AS "guardianId",
 e.source_digest AS "sourceDigest",e.native_digest AS "nativeDigest",e.payload_digest AS "payloadDigest",e.payload_ciphertext AS ciphertext
 FROM ls_fishing_billing.authority_evidence e WHERE e.workspace_id=$1 AND e.id=ANY($2::uuid[]) ORDER BY e.id LIMIT 51`;
const revocationSelect=`SELECT id,workspace_id AS "workspaceId",program_key AS "programKey",mode,evidence_id AS "evidenceId",evidence_digest AS "evidenceDigest",
 recorded_by AS "recordedBy",created_at AS "createdAt",payload_digest AS "payloadDigest",payload_ciphertext AS ciphertext
 FROM ls_fishing_billing.authority_evidence_revocations WHERE workspace_id=$1 AND evidence_id=ANY($2::uuid[]) ORDER BY evidence_id LIMIT 51`;
const proposalSelect=`SELECT id,application_id AS reference,family_id AS "familyId",guardian_person_id AS "guardianId",operation_id AS "operationId",recorded_by AS "recordedBy",
 source_digest AS "sourceDigest",native_digest AS "nativeDigest",request_digest AS "requestDigest",payload_ciphertext AS ciphertext,created_at AS "createdAt"
 FROM ls_fishing_billing.inquiry_family_proposals WHERE workspace_id=$1 AND id=ANY($2::uuid[]) ORDER BY id LIMIT 51`;
const evidenceAad=(w:string,id:string)=>`ls_fishing_billing/authority_evidence/v1/${w}/${id}`;
const revocationAad=(w:string,id:string)=>`ls_fishing_billing/authority_evidence_revocation/v1/${w}/${id}`;
function unavailable():never{throw new AppError('UNAVAILABLE');}
function same(a:unknown,b:unknown):boolean{return JSON.stringify(a)===JSON.stringify(b);}
function freeze<T>(v:T):Frozen<T>{
 if(v!==null&&typeof v==='object'){for(const child of Object.values(v))freeze(child);Object.freeze(v);}
 return v as Frozen<T>;
}
function time(value:Date|null,expected:string|null){
 return value===null?expected===null:expected!==null&&value instanceof Date&&Number.isFinite(value.getTime())&&value.getTime()===Date.parse(expected);
}

/** Internal recorded-byte/current-record-status reader ONLY. It authenticates
 * no caller, legal review, guardian, recipient, target or runtime admission.
 * The caller owns access, current source/native facts and permission factories.
 * No database/clock defaults, discovery, writers or transport exist here. */
export class FishingBillingAuthorityEvidenceStore{
 constructor(private readonly keyring:Keyring,private readonly integrityKey:string){}
 private hash(kind:'record'|'revocation',workspace:string,value:unknown){
  return privateDigest({domain:`fishing-billing-authority-evidence-${kind}/v1`,workspace,value},this.integrityKey);
 }
 private decode(row:EvidenceRow,workspace:WorkspaceId):AuthorityEvidenceRecord{
  try{
   const r=authorityEvidenceRecordSchema.parse(JSON.parse(unseal(row.ciphertext,evidenceAad(workspace,row.id),this.keyring))),f=r.family;
   if(row.id!==r.id||row.workspaceId!==workspace||r.workspaceId!==workspace||row.programKey!==r.programKey||row.mode!==r.mode||row.purpose!==r.purpose||row.state!==r.state||
    row.sourceId!==r.sourceReference.id||row.sourceSha!==r.sourceReference.sha256||row.releaseId!==(r.releaseEvidence?.id??null)||row.releaseSha!==(r.releaseEvidence?.sha256??null)||
    row.recordedBy!==r.recordedBy||!time(row.createdAt,r.recordedAt)||!time(row.releasedAt,r.releasedAt)||!time(row.expiresAt,r.expiresAt)||
    row.proposalId!==(f?.proposalId??null)||row.reference!==(f?.reference??null)||row.familyId!==(f?.familyId??null)||row.guardianId!==(f?.guardianPersonId??null)||
    row.sourceDigest!==(f?.sourceDigest??null)||row.nativeDigest!==(f?.nativeDigest??null)||row.payloadDigest!==this.hash('record',workspace,r))unavailable();
   return r;
  }catch{unavailable();}
 }
 private revocation(row:RevocationRow,parent:AuthorityEvidenceRecord,parentDigest:string,workspace:WorkspaceId):AuthorityEvidenceRevocation{
  try{
   const r=authorityEvidenceRevocationSchema.parse(JSON.parse(unseal(row.ciphertext,revocationAad(workspace,row.id),this.keyring)));
   if(row.id!==r.id||row.workspaceId!==workspace||r.workspaceId!==workspace||row.programKey!==r.programKey||row.mode!==r.mode||
    row.evidenceId!==parent.id||r.evidenceId!==parent.id||row.evidenceDigest!==parentDigest||r.evidenceDigest!==parentDigest||
    row.recordedBy!==r.recordedBy||!time(row.createdAt,r.recordedAt)||Date.parse(r.recordedAt)<Date.parse(parent.recordedAt)||
    row.payloadDigest!==this.hash('revocation',workspace,r))unavailable();
   return r;
  }catch{unavailable();}
 }
 private capture(context:AuthorityEvidenceContext,input:AuthorityEvidenceBatch){
  const parsed=authorityEvidenceBatchSchema.safeParse(input);
  const workspace=z.uuid().safeParse(context.workspaceId),now=context.now instanceof Date?context.now.getTime():NaN,originalTx=context.tx;
  if(!parsed.success||!workspace.success||!Number.isFinite(now)||!originalTx||typeof originalTx.query!=='function')throw new AppError('INVALID_REQUEST');
  return {input:freeze(parsed.data),workspace:workspace.data as WorkspaceId,now,tx:Object.freeze({query:originalTx.query.bind(originalTx)}) as SqlSession};
 }
 private async load(context:AuthorityEvidenceContext,input:AuthorityEvidenceBatch){
  const c=this.capture(context,input),ids=c.input.lookups.map(l=>l.id);
  try{
   // Lock parents FIRST. The additive revocation INSERT trigger takes the
   // conflicting parent UPDATE lock before appending, including absent-revoke
   // cases. snapshot deliberately takes no rowlocks and claims no stability.
   const rows=await c.tx.query<EvidenceRow>(evidenceSelect+(c.input.lock==='shared'?' FOR SHARE OF e':''),[c.workspace,ids]);
   if(rows.length>ids.length||new Set(rows.map(r=>r.id)).size!==rows.length)unavailable();
   const records=new Map(rows.map(row=>[row.id,this.decode(row,c.workspace)]));
   if(rows.some(r=>!ids.includes(r.id)))unavailable();
   const families=[...records.values()].flatMap(r=>r.family?[r.family]:[]),proposalIds=[...new Set(families.map(f=>f.proposalId))];
   if(proposalIds.length){
    const proposals=await c.tx.query<FishingInquiryFamilyProposalRow>(proposalSelect,[c.workspace,proposalIds]);
    if(proposals.length!==proposalIds.length||new Set(proposals.map(r=>r.id)).size!==proposals.length)unavailable();
    const decoded=new Map(proposals.map(row=>[row.id,decodeFishingInquiryFamilyProposalRecord(row,{workspaceId:c.workspace,keyring:this.keyring,integrityKey:this.integrityKey})]));
    for(const f of families){const p=decoded.get(f.proposalId);
     if(!p||p.command.selection.reference!==f.reference||p.command.selection.familyId!==f.familyId||p.guardianPersonId!==f.guardianPersonId||
      p.command.expectedSourceDigest!==f.sourceDigest||p.command.expectedNativeDigest!==f.nativeDigest||!same(p.command.selection.children,f.children))unavailable();
    }
   }
   const revoked=await c.tx.query<RevocationRow>(revocationSelect,[c.workspace,ids]);
   if(revoked.length>ids.length||new Set(revoked.map(r=>r.evidenceId)).size!==revoked.length)unavailable();
   const revocations=new Map(revoked.map(row=>{const parent=records.get(row.evidenceId);if(!parent)unavailable();
    return [row.evidenceId,this.revocation(row,parent,this.hash('record',c.workspace,parent),c.workspace)] as const;
   }));
   // Every selected stored row is authenticated before ANY caller expectation,
   // state, expiry or revocation can turn it into a benign null result.
   return {c,records,revocations};
  }catch(error){
   if(error&&typeof error==='object'&&'code' in error&&['42P01','42703','3F000'].includes(String(error.code)))unavailable();
   throw error;
  }
 }
 private matches(r:AuthorityEvidenceRecord,l:Frozen<AuthorityEvidenceBatch['lookups'][number]>){
  return r.purpose===l.purpose&&same(r.sourceReference,l.sourceReference)&&same(r.releaseEvidence,l.releaseEvidence)&&same(r.family,l.family);
 }
 async readReleasedBatch(context:AuthorityEvidenceContext,input:AuthorityEvidenceBatch):Promise<readonly(ReleasedEvidenceRead|null)[]>{
  const {c,records,revocations}=await this.load(context,input);
  return freeze(c.input.lookups.map(l=>{const r=records.get(l.id);
   if(!r||!this.matches(r,l)||r.state!=='released'||!r.releaseEvidence||!r.releasedAt||!r.expiresAt||
    Date.parse(r.releasedAt)>c.now||Date.parse(r.expiresAt)<=c.now||revocations.has(r.id))return null;
   return {classification:'integrity_only_not_authority' as const,consistency:c.input.lock,record:r as ReleasedEvidence};
  }));
 }
 async readOriginalBatch(context:AuthorityEvidenceContext,input:AuthorityEvidenceBatch):Promise<readonly(OriginalEvidenceRead|null)[]>{
  const {c,records,revocations}=await this.load(context,input);
  return freeze(c.input.lookups.map(l=>{const r=records.get(l.id);return !r||!this.matches(r,l)?null:
   {classification:'historical_data_only' as const,consistency:c.input.lock,record:r,revocation:revocations.get(r.id)??null};
  }));
 }
}
