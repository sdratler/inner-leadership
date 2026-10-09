import {z} from 'zod';

const sha=z.string().regex(/^[a-f0-9]{64}$/),uuid=z.string().uuid(),instant=z.iso.datetime();
const changeId=z.literal('LS-SERVICE-INTEREST-MIGRATION-20261008-01'),scope=z.literal('private-app-service-interest-migration-0127');
export const serviceInterestEvidenceKinds=['independent_review','baseline_preflight','backup_readback','isolated_restore','rollback_plan'] as const;
const file=z.strictObject({path:z.string().min(3).max(500),sha256:sha});
export const serviceInterestProofSchema=z.strictObject({changeId,scope,projectId:uuid,environmentId:uuid,appServiceId:uuid,databaseServiceId:uuid,
 deploymentId:uuid,mode:z.enum(['preflight','apply','verify-only']),reviewedCommit:z.string().regex(/^[a-f0-9]{40}$/),sourceBundleSha256:sha,manifestSha256:sha,databaseBindingSha256:sha,
 baselineStateSha256:sha,expectedStateSha256:sha,independentReview:z.literal('PASS'),isolatedRestore:z.literal('PASS'),backupId:z.string().min(1).max(200),
 controlFence:z.string().min(32).max(200),nonce:uuid,issuedAt:instant,expiresAt:instant,evidence:z.strictObject({
  independentReview:file,baselinePreflight:file,backupReadback:file,isolatedRestore:file,rollbackPlan:file
 })});
export type ServiceInterestProof=z.infer<typeof serviceInterestProofSchema>;
export const serviceInterestEvidenceSchema=z.strictObject({changeId,scope,kind:z.enum(serviceInterestEvidenceKinds),status:z.enum(['PASS','AVAILABLE','READY']),
 projectId:uuid,environmentId:uuid,appServiceId:uuid,databaseServiceId:uuid,deploymentId:uuid,mode:z.enum(['preflight','apply','verify-only']),reviewedCommit:z.string().regex(/^[a-f0-9]{40}$/),
 sourceBundleSha256:sha,databaseBindingSha256:sha,baselineStateSha256:sha,expectedStateSha256:sha,backupId:z.string().min(1).max(200),controlFence:z.string().min(32).max(200),
 nonce:uuid,createdAt:instant});
export type ServiceInterestEvidence=z.infer<typeof serviceInterestEvidenceSchema>;
const expectedStatus:Record<ServiceInterestEvidence['kind'],ServiceInterestEvidence['status']>={independent_review:'PASS',baseline_preflight:'PASS',backup_readback:'AVAILABLE',isolated_restore:'PASS',rollback_plan:'READY'};
export function validateServiceInterestProof(input:unknown,expected:{projectId:string;environmentId:string;appServiceId:string;databaseServiceId:string;deploymentId:string;mode:'preflight'|'apply'|'verify-only';reviewedCommit:string;sourceBundleSha256:string;databaseBindingSha256:string},nowMs:number):ServiceInterestProof{
 const proof=serviceInterestProofSchema.parse(input),issued=Date.parse(proof.issuedAt),expires=Date.parse(proof.expiresAt);
 if(proof.projectId!==expected.projectId||proof.environmentId!==expected.environmentId||proof.appServiceId!==expected.appServiceId||proof.databaseServiceId!==expected.databaseServiceId||proof.deploymentId!==expected.deploymentId||proof.mode!==expected.mode||proof.reviewedCommit!==expected.reviewedCommit||proof.sourceBundleSha256!==expected.sourceBundleSha256||proof.databaseBindingSha256!==expected.databaseBindingSha256)throw Error('SERVICE_INTEREST_PROOF_BINDING_MISMATCH');
 if(!Number.isFinite(issued)||!Number.isFinite(expires)||issued>nowMs+5*60_000||expires<=nowMs||expires<=issued||expires-issued>2*60*60_000)throw Error('SERVICE_INTEREST_PROOF_EXPIRED');
 return proof;
}
export function validateServiceInterestEvidence(input:unknown,proof:ServiceInterestProof,kind:ServiceInterestEvidence['kind'],nowMs:number):ServiceInterestEvidence{
 const evidence=serviceInterestEvidenceSchema.parse(input),created=Date.parse(evidence.createdAt),issued=Date.parse(proof.issuedAt);
 if(evidence.kind!==kind||evidence.status!==expectedStatus[kind])throw Error('SERVICE_INTEREST_EVIDENCE_STATUS_MISMATCH');
 for(const key of ['changeId','scope','projectId','environmentId','appServiceId','databaseServiceId','deploymentId','mode','reviewedCommit','sourceBundleSha256','databaseBindingSha256','baselineStateSha256','expectedStateSha256','backupId','controlFence','nonce'] as const)if(evidence[key]!==proof[key])throw Error('SERVICE_INTEREST_EVIDENCE_BINDING_MISMATCH');
 if(!Number.isFinite(created)||created>nowMs+5*60_000||created<issued-24*60*60_000||created>Date.parse(proof.expiresAt))throw Error('SERVICE_INTEREST_EVIDENCE_STALE');
 return evidence;
}
