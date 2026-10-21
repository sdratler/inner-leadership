import {z} from "zod";
import {IdentityClientError,sessionInfo} from "../identity/client.ts";
import {educationReferenceSchema} from "./education-query.ts";
import type {LessonReference,LessonLearnerRead,LessonTeacherRead,LessonParentRead,lessonJourneyCommandSchema} from "./fishing-lesson-journey.ts";
export type LessonCommand=z.infer<typeof lessonJourneyCommandSchema>;
export type EducationRole="parent"|"practitioner";
const uuid=z.uuid(),text=z.string().min(1).max(2000),sha=z.string().regex(/^[a-f0-9]{64}$/),date=z.iso.datetime();
const moduleId=educationReferenceSchema.shape.moduleId,version=educationReferenceSchema.shape.version;
const answers=z.array(z.strictObject({questionId:z.string().regex(/^Q\d{2}-[1-3]$/),value:text})).min(1).max(3);
const draft=z.strictObject({revisionId:uuid,answers:z.array(z.strictObject({questionId:z.string().regex(/^Q\d{2}-[1-3]$/),value:z.string().max(2000)})).max(3),savedAt:date});
const learner=z.strictObject({lesson:z.strictObject({moduleId,version,stage:z.number().int().min(1).max(4),locale:z.enum(["en","he"]),
 title:text,instruction:text,questions:z.array(z.strictObject({id:z.string().regex(/^Q\d{2}-[1-3]$/),prompt:text})).min(1).max(3),sourceSha256:sha}),
 revisionId:uuid.nullable(),submission:z.strictObject({revisionId:uuid,answers,submittedAt:date,submittedBy:uuid,assistedBy:uuid.nullable()}).nullable(),draft:draft.nullable().optional()});
const observationCommand=z.strictObject({action:z.literal("observe"),operationId:uuid,expectedRevisionId:uuid.nullable(),submissionId:uuid,task:text,
 assistance:z.enum(["not_observed","with_guidance","independent"]),privateNote:text.optional(),knowledgeAssessment:z.discriminatedUnion("state",[
  z.strictObject({state:z.literal("not_assessed")}),z.strictObject({state:z.literal("recorded"),assessment:text}),
 ]).optional()});
const teacher=learner.omit({draft:true}).extend({observations:z.array(z.strictObject({id:uuid,operationId:uuid,digest:sha,previousRevisionId:uuid.nullable(),workspaceId:uuid,
 learnerId:uuid,moduleId,version,sourceSha256:sha,actorId:uuid,actorRole:z.literal("practitioner"),at:date,command:observationCommand})).max(500),
 summaryRecipients:z.array(z.strictObject({accountId:uuid,label:z.string().email().max(254)})).max(10)});
const parent=z.strictObject({moduleId,version,portfolio:z.strictObject({revisionId:uuid,summary:text,publishedAt:date,sourceSha256:sha}).nullable()});
const saved=z.strictObject({revisionId:uuid,duplicate:z.boolean()});
const codes=["INVALID_REQUEST","UNAUTHENTICATED","FORBIDDEN","NOT_FOUND","CONFLICT","RATE_LIMITED","UNAVAILABLE","INTERNAL","PAYLOAD_TOO_LARGE"] as const;
export class LessonClientError extends Error{
 constructor(readonly code:typeof codes[number],readonly uncertain=false){super(code);this.name="LessonClientError";}
}
export type PendingLessonOperation=Readonly<{body:string;operationId:string}>;
/** Immutable request bytes are the retry identity; no local/session persistence. */
export function pendingLessonOperation(reference:LessonReference,command:LessonCommand):PendingLessonOperation{
 const ref=educationReferenceSchema.parse(reference);uuid.parse(command.operationId);uuid.nullable().parse(command.expectedRevisionId);
 const body=JSON.stringify({reference:ref,command});
 if(new TextEncoder().encode(body).byteLength>16384)throw new LessonClientError("PAYLOAD_TOO_LARGE");
 return Object.freeze({body,operationId:command.operationId});
}
// Up to 500 events: three 2000-code-unit text fields can each JSON-escape to
// 6 bytes/unit. With <4 KiB metadata/event and <128 KiB lesson/final context,
// 24 MiB covers the retained history without truncation. Requests stay 16 KiB.
const MAX_RESPONSE_BYTES=24*1024*1024;
async function responseData<T>(response:Response,schema:z.ZodType<T>,mayHaveCommitted:boolean):Promise<T>{
 const uncertain=mayHaveCommitted&&(response.status>=500||response.ok);
 let body:unknown;
 try{
  if(!response.body)throw Error();const reader=response.body.getReader(),decoder=new TextDecoder("utf-8",{fatal:true});
  let bytes=0,value="";
  try{for(;;){const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.byteLength;
    if(bytes>MAX_RESPONSE_BYTES){await reader.cancel();throw Error();}value+=decoder.decode(chunk.value,{stream:true});}
   value+=decoder.decode();body=JSON.parse(value);
  }finally{reader.releaseLock();}
 }catch{throw new LessonClientError("UNAVAILABLE",uncertain);}
 if(!response.ok){
  const error=z.object({ok:z.literal(false),error:z.object({code:z.enum(codes)})}).safeParse(body);
  throw new LessonClientError(error.success?error.data.error.code:"UNAVAILABLE",mayHaveCommitted&&response.status>=500);
 }
 const envelope=z.strictObject({ok:z.literal(true),data:schema,requestId:uuid}).safeParse(body);
 if(!envelope.success)throw new LessonClientError("UNAVAILABLE",mayHaveCommitted);
 return envelope.data.data;
}
async function ordinarySession(role:EducationRole){
 try{const session=await sessionInfo();if(session.role!==role)throw new LessonClientError("FORBIDDEN");return session;}
 catch(error){if(error instanceof LessonClientError)throw error;
  throw new LessonClientError(error instanceof IdentityClientError&&codes.some(code=>code===error.code)?error.code:"UNAVAILABLE");}
}
const path="/api/resources/education/lesson";
export function readEducationLesson(reference:LessonReference,view:"learner",role:EducationRole,signal?:AbortSignal):Promise<LessonLearnerRead>;
export function readEducationLesson(reference:LessonReference,view:"teacher",role:EducationRole,signal?:AbortSignal):Promise<LessonTeacherRead>;
export function readEducationLesson(reference:LessonReference,view:"parent",role:EducationRole,signal?:AbortSignal):Promise<LessonParentRead>;
export function readEducationLesson(reference:LessonReference,view:"learner"|"teacher"|"parent",role:EducationRole,signal?:AbortSignal):Promise<LessonLearnerRead|LessonTeacherRead|LessonParentRead>;
export async function readEducationLesson(reference:LessonReference,view:"learner"|"teacher"|"parent",role:EducationRole,signal?:AbortSignal):Promise<LessonLearnerRead|LessonTeacherRead|LessonParentRead>{
 const ref=educationReferenceSchema.parse(reference);await ordinarySession(role);
 let response:Response;try{response=await fetch(path+"?"+new URLSearchParams({...ref,view}),{credentials:"same-origin",cache:"no-store",redirect:"error",
  referrerPolicy:"no-referrer",...(signal?{signal}:{})});}catch{throw new LessonClientError("UNAVAILABLE");}
 const data=await responseData<LessonLearnerRead|LessonTeacherRead|LessonParentRead>(response,view==="teacher"?teacher:view==="parent"?parent:learner,false);
 const bound="lesson"in data?data.lesson:data;
 if(bound.moduleId!==ref.moduleId||bound.version!==ref.version)throw new LessonClientError("UNAVAILABLE");
 return data;
}
export async function saveEducationLesson(operation:PendingLessonOperation,role:EducationRole):Promise<{revisionId:string;duplicate:boolean}>{
 const session=await ordinarySession(role);
 let response:Response;try{response=await fetch(path,{method:"POST",credentials:"same-origin",cache:"no-store",redirect:"error",referrerPolicy:"no-referrer",
  headers:{"content-type":"application/json","x-csrf-token":session.csrfToken},body:operation.body});
 }catch{throw new LessonClientError("UNAVAILABLE",true);}
 return responseData(response,saved,true);
}
