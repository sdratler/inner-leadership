import "server-only";
import {createHash} from "node:crypto";
import {z} from "zod";
import {AppError} from "../../lib/errors.ts";
import {BNA_EMAIL_SOURCE,BNA_EMAIL_SENDER,bnaAcknowledgmentId,type FrozenBnaAcknowledgment} from "./delivery-policy.ts";

const digest=z.string().regex(/^[a-f0-9]{64}$/),instant=z.iso.datetime({offset:true});
const common={version:z.literal(1),workspaceId:z.string().uuid(),ownerAccountId:z.string().uuid(),sender:z.literal(BNA_EMAIL_SENDER),
 sourceSha256:z.literal(BNA_EMAIL_SOURCE),activatedAt:instant,
 messageCopies:z.object({"EMAIL-B0":digest,"EMAIL-S0":digest}).strict(),
 target:z.object({projectId:z.string().uuid(),environmentId:z.string().uuid(),serviceId:z.string().uuid(),databaseSystemId:z.string().regex(/^[0-9]{10,25}$/)}).strict()};
const reference=z.object({inquiryId:z.string().uuid(),templateId:bnaAcknowledgmentId,locale:z.enum(["en","he"]),recipientSha256:digest}).strict();
export const bnaDispatchAdmissionSchema=z.discriminatedUnion("mode",[
 z.object({...common,mode:z.literal("controlled_test"),releaseCommit:z.string().regex(/^[a-f0-9]{40}$/),expiresAt:instant,references:z.array(reference).min(1).max(4)}).strict(),
 z.object({...common,mode:z.literal("future_requests"),controlledProofs:z.object({b0:z.string().uuid(),s0:z.string().uuid(),inboxReadbackSha256:digest}).strict()}).strict(),
]);
export type BnaDispatchAdmission=z.infer<typeof bnaDispatchAdmissionSchema>;
export type BnaDispatchMessage={id:string;inquiryId:string;createdAt:string;recipientKey:string;payload:FrozenBnaAcknowledgment};
export const bnaRecipientSha256=(email:string)=>createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
export function readBnaDispatchAdmission(env:Record<string,string|undefined>,now:Date):BnaDispatchAdmission{
 let parsed:unknown;try{parsed=JSON.parse(env.LS_BNA_EMAIL_DISPATCH_ADMISSION_JSON??"null");}catch{throw new AppError("UNAVAILABLE");}
 const result=bnaDispatchAdmissionSchema.safeParse(parsed);if(!result.success)throw new AppError("UNAVAILABLE");
 const policy=result.data;
 if(env.LS_BNA_EMAIL_WORKER_ENABLED!=="true"||env.LS_BNA_EMAIL_QUEUE_ENABLED!=="true"||env.LS_BNA_EMAIL_SOURCE_SHA256!==BNA_EMAIL_SOURCE||
  env.LS_IDENTITY_WORKSPACE_ID!==policy.workspaceId||env.LS_BNA_OWNER_ACCOUNT_ID!==policy.ownerAccountId||env.LS_AUTH_EMAIL_PROVIDER!=="gmail"||env.LS_AUTH_EMAIL_FROM!==policy.sender||
  env.RAILWAY_PROJECT_ID!==policy.target.projectId||env.RAILWAY_ENVIRONMENT_ID!==policy.target.environmentId||env.RAILWAY_SERVICE_ID!==policy.target.serviceId||env.LS_DATABASE_TLS==="disable"||env.NODE_TLS_REJECT_UNAUTHORIZED==="0"||
  !Number.isFinite(now.getTime())||Date.parse(policy.activatedAt)>now.getTime()||!env.LS_BNA_EMAIL_QUEUE_SINCE||Date.parse(env.LS_BNA_EMAIL_QUEUE_SINCE)!==Date.parse(policy.activatedAt))throw new AppError("UNAVAILABLE");
 if(policy.mode==="controlled_test"){
  const recipient=env.LS_ACADEMY_OWNER_NOTIFICATION_TO??"";
  if(env.LS_BNA_EMAIL_CONTROLLED_SEND_ENABLED!=="true"||env.LS_BNA_EMAIL_SEND_ENABLED==="true"||env.RAILWAY_GIT_COMMIT_SHA!==policy.releaseCommit||
   Date.parse(policy.expiresAt)<=now.getTime()||Date.parse(policy.expiresAt)-Date.parse(policy.activatedAt)>4*60*60*1000||
   !z.email().safeParse(recipient).success||policy.references.some(item=>item.recipientSha256!==bnaRecipientSha256(recipient))||
   new Set(policy.references.map(item=>item.inquiryId)).size!==policy.references.length)throw new AppError("UNAVAILABLE");
 }else if(env.LS_BNA_EMAIL_SEND_ENABLED!=="true"||env.LS_BNA_EMAIL_CONTROLLED_SEND_ENABLED==="true"||policy.controlledProofs.b0===policy.controlledProofs.s0)throw new AppError("UNAVAILABLE");
 return policy;
}
export function bnaAdmissionAllows(policy:BnaDispatchAdmission,message:BnaDispatchMessage,now:Date){
 if(message.payload.sourceSha256!==policy.sourceSha256||message.payload.copySha256!==policy.messageCopies[message.payload.templateId]||message.inquiryId!==message.payload.reference||!Number.isFinite(Date.parse(message.createdAt))||
  Date.parse(message.createdAt)<Date.parse(policy.activatedAt)||Date.parse(message.createdAt)>now.getTime())return false;
 if(policy.mode==="controlled_test")return Date.parse(policy.expiresAt)>now.getTime()&&policy.references.some(item=>item.inquiryId===message.inquiryId&&item.templateId===message.payload.templateId&&item.locale===message.payload.locale&&item.recipientSha256===bnaRecipientSha256(message.payload.recipient));
 return true;
}
