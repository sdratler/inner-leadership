import {z} from 'zod';

const sha=z.string().regex(/^[a-f0-9]{64}$/),uuid=z.string().uuid(),instant=z.iso.datetime();
const changeId=z.literal('LS-FISHING-PRACTICE-MIGRATION-20261012-01'),scope=z.literal('private-app-fishing-practice-migration-0132');
export const fishingPracticeEvidenceKinds=['independent_review','baseline_preflight','backup_readback','isolated_restore','rollback_plan'] as const;
const file=z.strictObject({path:z.string().min(3).max(500),sha256:sha});
const jobSourceSha256={jobSourceSha256:sha};
export const fishingPracticeJobSourceSchema=z.strictObject({sourceKind:z.literal('transferred_exact_candidate'),jobId:uuid,projectId:uuid,environmentId:uuid,appServiceId:uuid,deploymentId:uuid,reviewedCommit:z.string().regex(/^[a-f0-9]{40}$/),sourceBundleSha256:sha,createdAt:instant});
export type FishingPracticeJobSource=z.infer<typeof fishingPracticeJobSourceSchema>;
export const fishingPracticeProofSchema=z.strictObject({changeId,scope,...jobSourceSha256,projectId:uuid,environmentId:uuid,appServiceId:uuid,databaseServiceId:uuid,deploymentId:uuid,mode:z.enum(['preflight','apply','verify-only']),reviewedCommit:z.string().regex(/^[a-f0-9]{40}$/),sourceBundleSha256:sha,manifestSha256:sha,databaseBindingSha256:sha,baselineStateSha256:sha,expectedStateSha256:sha,independentReview:z.literal('PASS'),isolatedRestore:z.literal('PASS'),backupId:z.string().min(1).max(200),controlFence:z.string().min(32).max(200),nonce:uuid,issuedAt:instant,expiresAt:instant,evidence:z.strictObject({independentReview:file,baselinePreflight:file,backupReadback:file,isolatedRestore:file,rollbackPlan:file})});
export type FishingPracticeProof=z.infer<typeof fishingPracticeProofSchema>;
export const fishingPracticeEvidenceSchema=z.strictObject({changeId,scope,...jobSourceSha256,kind:z.enum(fishingPracticeEvidenceKinds),status:z.enum(['PASS','AVAILABLE','READY']),projectId:uuid,environmentId:uuid,appServiceId:uuid,databaseServiceId:uuid,deploymentId:uuid,mode:z.enum(['preflight','apply','verify-only']),reviewedCommit:z.string().regex(/^[a-f0-9]{40}$/),sourceBundleSha256:sha,databaseBindingSha256:sha,baselineStateSha256:sha,expectedStateSha256:sha,backupId:z.string().min(1).max(200),controlFence:z.string().min(32).max(200),nonce:uuid,createdAt:instant});
export type FishingPracticeEvidence=z.infer<typeof fishingPracticeEvidenceSchema>;
export type FishingPracticeProofBinding={projectId:string;environmentId:string;appServiceId:string;databaseServiceId:string;deploymentId:string;mode:'preflight'|'apply'|'verify-only';reviewedCommit:string;sourceBundleSha256:string;databaseBindingSha256:string;jobSourceSha256:string};
export function validateFishingPracticeJobSource(input:unknown,expected:Pick<FishingPracticeProofBinding,'projectId'|'environmentId'|'appServiceId'|'deploymentId'|'sourceBundleSha256'>,nowMs:number):FishingPracticeJobSource{
 const job=fishingPracticeJobSourceSchema.parse(input),created=Date.parse(job.createdAt);
 for(const key of ['projectId','environmentId','appServiceId','deploymentId','sourceBundleSha256'] as const)if(job[key]!==expected[key])throw Error('FISHING_PRACTICE_JOB_SOURCE_BINDING_MISMATCH');
 if(!Number.isFinite(created)||created>nowMs+5*60_000||created<nowMs-24*60*60_000)throw Error('FISHING_PRACTICE_JOB_SOURCE_STALE');
 return job;
}
const expectedStatus:Record<FishingPracticeEvidence['kind'],FishingPracticeEvidence['status']>={independent_review:'PASS',baseline_preflight:'PASS',backup_readback:'AVAILABLE',isolated_restore:'PASS',rollback_plan:'READY'};

export function validateFishingPracticeProof(input:unknown,expected:FishingPracticeProofBinding,nowMs:number):FishingPracticeProof{
 const proof=fishingPracticeProofSchema.parse(input),issued=Date.parse(proof.issuedAt),expires=Date.parse(proof.expiresAt);
 if(proof.projectId!==expected.projectId||proof.environmentId!==expected.environmentId||proof.appServiceId!==expected.appServiceId||proof.databaseServiceId!==expected.databaseServiceId||proof.deploymentId!==expected.deploymentId||proof.mode!==expected.mode||proof.reviewedCommit!==expected.reviewedCommit||proof.sourceBundleSha256!==expected.sourceBundleSha256||proof.databaseBindingSha256!==expected.databaseBindingSha256||proof.jobSourceSha256!==expected.jobSourceSha256)throw Error('FISHING_PRACTICE_PROOF_BINDING_MISMATCH');
 if(!Number.isFinite(issued)||!Number.isFinite(expires)||issued>nowMs+5*60_000||expires<=nowMs||expires<=issued||expires-issued>2*60*60_000)throw Error('FISHING_PRACTICE_PROOF_EXPIRED');
 return proof;
}
export function validateFishingPracticeEvidence(input:unknown,proof:FishingPracticeProof,kind:FishingPracticeEvidence['kind'],nowMs:number):FishingPracticeEvidence{
 const evidence=fishingPracticeEvidenceSchema.parse(input),created=Date.parse(evidence.createdAt),issued=Date.parse(proof.issuedAt);
 if(evidence.kind!==kind||evidence.status!==expectedStatus[kind])throw Error('FISHING_PRACTICE_EVIDENCE_STATUS_MISMATCH');
 for(const key of ['changeId','scope','jobSourceSha256','projectId','environmentId','appServiceId','databaseServiceId','deploymentId','mode','reviewedCommit','sourceBundleSha256','databaseBindingSha256','baselineStateSha256','expectedStateSha256','backupId','controlFence','nonce'] as const)if(evidence[key]!==proof[key])throw Error('FISHING_PRACTICE_EVIDENCE_BINDING_MISMATCH');
 if(!Number.isFinite(created)||created>nowMs+5*60_000||created<issued-24*60*60_000||created>Date.parse(proof.expiresAt))throw Error('FISHING_PRACTICE_EVIDENCE_STALE');
 return evidence;
}

export async function runFishingPracticeMutationAdmission<T>(input:{proof:unknown;evidence:readonly {kind:FishingPracticeEvidence['kind'];value:unknown}[];expected:FishingPracticeProofBinding;nowMs:number;mutate:()=>Promise<T>}):Promise<T>{
 const proof=validateFishingPracticeProof(input.proof,input.expected,input.nowMs);
 for(const kind of fishingPracticeEvidenceKinds){const matches=input.evidence.filter(item=>item.kind===kind);if(matches.length!==1)throw Error('FISHING_PRACTICE_EVIDENCE_SET_MISMATCH');validateFishingPracticeEvidence(matches[0]!.value,proof,kind,input.nowMs);}
 return input.mutate();
}
