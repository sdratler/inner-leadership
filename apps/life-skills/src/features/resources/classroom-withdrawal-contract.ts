import {z} from "zod";
export const classroomWithdrawalVersion="JLFA-CLASSROOM-WITHDRAWAL-v1";
export const classroomWithdrawalScopeSchema=z.strictObject({stageId:z.uuid(),householdId:z.uuid()});
export const classroomWithdrawalCommandSchema=classroomWithdrawalScopeSchema.extend({version:z.literal(classroomWithdrawalVersion),operationId:z.uuid(),expectedScopeSha256:z.string().regex(/^[a-f0-9]{64}$/)});
export const classroomWithdrawalReceiptSchema=classroomWithdrawalScopeSchema.extend({version:z.literal(classroomWithdrawalVersion),operationId:z.uuid(),scopeSha256:z.string().regex(/^[a-f0-9]{64}$/),state:z.literal("withdrawn"),revokedLessonCount:z.number().int().min(1).max(240),recordedAt:z.iso.datetime()});
export type ClassroomWithdrawalScope={
 workspaceId:string;operatorAccountId:string;stageId:string;householdId:string;cohortRevision:number;
 template:{approvalId:string;revision:string;sha256:string;version:string};
 enrollments:readonly {id:string;revision:number;learnerId:string;householdId:string;purchaseId:string;purchaseLineId:string;state:string}[];
 lessons:readonly {learnerId:string;moduleId:string;version:string;sourceId:string;sourceRevision:string;sourceSha256:string;learnerArtifactId:string;teacherArtifactId:string}[];
};
