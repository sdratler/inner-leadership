import "server-only";
import {createHash} from "node:crypto";
import {z} from "zod";
import {AppError} from "../../lib/errors.ts";
import {seal,unseal,type Keyring} from "../identity/crypto.ts";
import {one,type SqlSession} from "../identity/store.ts";
import {classroomWithdrawalCommandSchema,classroomWithdrawalReceiptSchema} from "./classroom-withdrawal-contract.ts";
const uuid=z.uuid(),sha=z.string().regex(/^[a-f0-9]{64}$/),text=z.string().min(1).max(500);
const lesson=z.strictObject({learnerId:uuid,moduleId:z.string().regex(/^RM-[1-4](?:0[1-9]|1[0-2])$/),version:text,sourceId:text,sourceRevision:text,sourceSha256:sha,learnerArtifactId:uuid,teacherArtifactId:uuid});
const scope=z.strictObject({workspaceId:uuid,operatorAccountId:uuid,stageId:uuid,householdId:uuid,cohortRevision:z.number().int().positive(),template:z.strictObject({approvalId:uuid,revision:text,sha256:sha,version:text}),enrollments:z.array(z.strictObject({id:uuid,revision:z.number().int().positive(),learnerId:uuid,householdId:uuid,purchaseId:uuid,purchaseLineId:uuid,state:z.enum(["confirmed","suspended"])})).min(1).max(20),lessons:z.array(lesson).min(1).max(240)});
const beforeRevocation=z.strictObject({id:uuid,accountId:uuid.nullable(),learnerId:uuid.nullable(),moduleId:text.nullable(),version:text.nullable()});
const createdRevocation=z.strictObject({id:uuid,learnerId:uuid,moduleId:lesson.shape.moduleId,version:text});
const manifestSchema=z.strictObject({version:z.literal("CLASSROOM-WITHDRAWAL-MANIFEST-v1"),workspaceId:uuid,actorId:uuid,command:classroomWithdrawalCommandSchema,requestSha256:sha,snapshot:z.strictObject({scope,revocations:z.array(beforeRevocation).max(2000),scopeSha256:sha}),createdRevocations:z.array(createdRevocation).min(1).max(240),result:classroomWithdrawalReceiptSchema,resultSha256:sha});
export type WithdrawalManifest=z.infer<typeof manifestSchema>;
export const withdrawalManifestAction="classroom.family.withdraw.scope";
const digest=(v:unknown)=>createHash("sha256").update(JSON.stringify(v)).digest("hex");
export function withdrawalManifestId(workspaceId:string,actorId:string,operationId:string){const h=digest([withdrawalManifestAction,workspaceId,actorId,operationId]);return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;}
const aad=(w:string,a:string,id:string,hash:string)=>`classroom-withdrawal-manifest:v1:${w}:${a}:${id}:${hash}`;
function verified(raw:unknown){
 const m=manifestSchema.parse(raw),s=m.snapshot,c=m.command,r=m.result;
 if(m.workspaceId!==s.scope.workspaceId||m.actorId!==s.scope.operatorAccountId||c.stageId!==s.scope.stageId||c.householdId!==s.scope.householdId||r.stageId!==c.stageId||r.householdId!==c.householdId||r.operationId!==c.operationId||r.scopeSha256!==c.expectedScopeSha256||s.scopeSha256!==c.expectedScopeSha256||digest({scope:s.scope,revocations:s.revocations})!==s.scopeSha256||digest(c)!==m.requestSha256||digest(r)!==m.resultSha256||r.revokedLessonCount!==s.scope.lessons.length||m.createdRevocations.length!==s.scope.lessons.length||new Set(m.createdRevocations.map(v=>v.id)).size!==m.createdRevocations.length)throw new AppError("UNAVAILABLE");
 const ref=(v:{learnerId:string;moduleId:string;version:string})=>JSON.stringify([v.learnerId,v.moduleId,v.version]);
 if(new Set(s.scope.lessons.map(ref)).size!==s.scope.lessons.length||JSON.stringify(s.scope.lessons.map(ref).sort())!==JSON.stringify(m.createdRevocations.map(ref).sort()))throw new AppError("UNAVAILABLE");
 // Stay within the existing 100000-byte encrypted-receipt storage cap. Do not
 // silently discard proof, expand schema or partially withdraw a large scope.
 if(Buffer.byteLength(JSON.stringify(m))>65536)throw new AppError("UNAVAILABLE");return m;
}
export async function writeWithdrawalManifest(tx:SqlSession,ring:Keyring,input:unknown){
 const m=verified(input),id=withdrawalManifestId(m.workspaceId,m.actorId,m.command.operationId),hash=digest(m),ciphertext=seal(JSON.stringify(m),aad(m.workspaceId,m.actorId,id,hash),ring);
 if(Buffer.byteLength(ciphertext)>100000)throw new AppError("UNAVAILABLE");
 await tx.query("INSERT INTO ls_fishing_stage.command_receipts(workspace_id,actor_id,command_id,action,request_sha256,result_ciphertext,recorded_at) VALUES($1,$2,$3,$4,$5,$6,$7)",[m.workspaceId,m.actorId,id,withdrawalManifestAction,hash,ciphertext,m.result.recordedAt]);
}
export async function readWithdrawalManifest(tx:SqlSession,ring:Keyring,workspaceId:string,actorId:string,operationId:string):Promise<WithdrawalManifest>{
 const row=await one<{action:string;hash:string;ciphertext:string}>(tx,"SELECT action,request_sha256 AS hash,result_ciphertext AS ciphertext FROM ls_fishing_stage.command_receipts WHERE workspace_id=$1 AND actor_id=$2 AND command_id=$3 FOR SHARE",[workspaceId,actorId,operationId]);
 if(!row||row.action!=="classroom.family.withdraw")throw new AppError("NOT_FOUND");
 const original=classroomWithdrawalReceiptSchema.parse(JSON.parse(unseal(row.ciphertext,`classroom-withdrawal:v1:${workspaceId}:${actorId}:${operationId}:${row.hash}`,ring)));
 const id=withdrawalManifestId(workspaceId,actorId,operationId),proof=await one<{action:string;hash:string;ciphertext:string}>(tx,"SELECT action,request_sha256 AS hash,result_ciphertext AS ciphertext FROM ls_fishing_stage.command_receipts WHERE workspace_id=$1 AND actor_id=$2 AND command_id=$3 FOR SHARE",[workspaceId,actorId,id]);
 if(!proof||proof.action!==withdrawalManifestAction)throw new AppError("UNAVAILABLE");
 const m=verified(JSON.parse(unseal(proof.ciphertext,aad(workspaceId,actorId,id,proof.hash),ring)));
 if(m.workspaceId!==workspaceId||m.actorId!==actorId||m.command.operationId!==operationId||m.requestSha256!==row.hash||digest(m)!==proof.hash||digest(original)!==m.resultSha256)throw new AppError("UNAVAILABLE");
 const rows=await tx.query<{id:string;accountId:string|null;learnerId:string;moduleId:string;version:string;recordedBy:string}>(`SELECT id,account_id AS "accountId",learner_id AS "learnerId",module_id AS "moduleId",version,recorded_by AS "recordedBy" FROM ls_education.access_revocations WHERE workspace_id=$1 AND id=ANY($2::uuid[]) FOR SHARE`,[workspaceId,m.createdRevocations.map(r=>r.id)]);
 if(rows.length!==m.createdRevocations.length||m.createdRevocations.some(r=>!rows.some(v=>v.id===r.id&&v.accountId===null&&v.recordedBy===actorId&&v.learnerId===r.learnerId&&v.moduleId===r.moduleId&&v.version===r.version)))throw new AppError("UNAVAILABLE");return m;
}
