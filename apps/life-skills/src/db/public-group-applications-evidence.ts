import {z} from 'zod';

const sha=z.string().regex(/^[a-f0-9]{64}$/),uuid=z.string().uuid(),instant=z.iso.datetime();
const changeId=z.literal('LS-PUBLIC-GROUP-APPLICATIONS-MIGRATION-20261009-01'),scope=z.literal('private-app-public-group-applications-migration-0131');
export const publicGroupApplicationsEvidenceKinds=['independent_review','baseline_preflight','backup_readback','isolated_restore','rollback_plan'] as const;
const file=z.strictObject({path:z.string().min(3).max(500),sha256:sha});
export const publicGroupApplicationsProofSchema=z.strictObject({changeId,scope,projectId:uuid,environmentId:uuid,appServiceId:uuid,databaseServiceId:uuid,deploymentId:uuid,mode:z.enum(['preflight','apply','verify-only']),reviewedCommit:z.string().regex(/^[a-f0-9]{40}$/),sourceBundleSha256:sha,manifestSha256:sha,databaseBindingSha256:sha,baselineStateSha256:sha,expectedStateSha256:sha,independentReview:z.literal('PASS'),isolatedRestore:z.literal('PASS'),backupId:z.string().min(1).max(200),controlFence:z.string().min(32).max(200),nonce:uuid,issuedAt:instant,expiresAt:instant,evidence:z.strictObject({independentReview:file,baselinePreflight:file,backupReadback:file,isolatedRestore:file,rollbackPlan:file})});
export type PublicGroupApplicationsProof=z.infer<typeof publicGroupApplicationsProofSchema>;
export const publicGroupApplicationsEvidenceSchema=z.strictObject({changeId,scope,kind:z.enum(publicGroupApplicationsEvidenceKinds),status:z.enum(['PASS','AVAILABLE','READY']),projectId:uuid,environmentId:uuid,appServiceId:uuid,databaseServiceId:uuid,deploymentId:uuid,mode:z.enum(['preflight','apply','verify-only']),reviewedCommit:z.string().regex(/^[a-f0-9]{40}$/),sourceBundleSha256:sha,databaseBindingSha256:sha,baselineStateSha256:sha,expectedStateSha256:sha,backupId:z.string().min(1).max(200),controlFence:z.string().min(32).max(200),nonce:uuid,createdAt:instant});
export type PublicGroupApplicationsEvidence=z.infer<typeof publicGroupApplicationsEvidenceSchema>;
const expectedStatus:Record<PublicGroupApplicationsEvidence['kind'],PublicGroupApplicationsEvidence['status']>={independent_review:'PASS',baseline_preflight:'PASS',backup_readback:'AVAILABLE',isolated_restore:'PASS',rollback_plan:'READY'};

export function validatePublicGroupApplicationsProof(input:unknown,expected:{projectId:string;environmentId:string;appServiceId:string;databaseServiceId:string;deploymentId:string;mode:'preflight'|'apply'|'verify-only';reviewedCommit:string;sourceBundleSha256:string;databaseBindingSha256:string},nowMs:number):PublicGroupApplicationsProof{
 const proof=publicGroupApplicationsProofSchema.parse(input),issued=Date.parse(proof.issuedAt),expires=Date.parse(proof.expiresAt);
 if(proof.projectId!==expected.projectId||proof.environmentId!==expected.environmentId||proof.appServiceId!==expected.appServiceId||proof.databaseServiceId!==expected.databaseServiceId||proof.deploymentId!==expected.deploymentId||proof.mode!==expected.mode||proof.reviewedCommit!==expected.reviewedCommit||proof.sourceBundleSha256!==expected.sourceBundleSha256||proof.databaseBindingSha256!==expected.databaseBindingSha256)throw Error('PUBLIC_GROUP_APPLICATIONS_PROOF_BINDING_MISMATCH');
 if(!Number.isFinite(issued)||!Number.isFinite(expires)||issued>nowMs+5*60_000||expires<=nowMs||expires<=issued||expires-issued>2*60*60_000)throw Error('PUBLIC_GROUP_APPLICATIONS_PROOF_EXPIRED');
 return proof;
}
export function validatePublicGroupApplicationsEvidence(input:unknown,proof:PublicGroupApplicationsProof,kind:PublicGroupApplicationsEvidence['kind'],nowMs:number):PublicGroupApplicationsEvidence{
 const evidence=publicGroupApplicationsEvidenceSchema.parse(input),created=Date.parse(evidence.createdAt),issued=Date.parse(proof.issuedAt);
 if(evidence.kind!==kind||evidence.status!==expectedStatus[kind])throw Error('PUBLIC_GROUP_APPLICATIONS_EVIDENCE_STATUS_MISMATCH');
 for(const key of ['changeId','scope','projectId','environmentId','appServiceId','databaseServiceId','deploymentId','mode','reviewedCommit','sourceBundleSha256','databaseBindingSha256','baselineStateSha256','expectedStateSha256','backupId','controlFence','nonce'] as const)if(evidence[key]!==proof[key])throw Error('PUBLIC_GROUP_APPLICATIONS_EVIDENCE_BINDING_MISMATCH');
 if(!Number.isFinite(created)||created>nowMs+5*60_000||created<issued-24*60*60_000||created>Date.parse(proof.expiresAt))throw Error('PUBLIC_GROUP_APPLICATIONS_EVIDENCE_STALE');
 return evidence;
}
