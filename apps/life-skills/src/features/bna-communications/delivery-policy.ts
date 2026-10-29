import {createHash} from "node:crypto";
import {z} from "zod";
import {bnaEmailCandidates,previewBnaEmailCandidate} from "./email-candidates.ts";
import type {BnaCoopFields} from "../bna-inquiry/coop-contract.ts";
import type {BnaSupportFields} from "../bna-inquiry/support-contract.ts";

export const BNA_EMAIL_SOURCE="f45b7e2f49f1a27adc1a93bc4460fbdba5fa0f6e1425dbef1c5e5b414d732b03";
export const BNA_EMAIL_SENDER="office@bneineviimacademy.org";
export const bnaEmailProgram=z.enum(["bna_learning_coop","bna_support_interest"]);
export type BnaEmailProgram=z.infer<typeof bnaEmailProgram>;
export const bnaAcknowledgmentId=z.enum(["EMAIL-B0","EMAIL-S0"]);
export const frozenBnaAcknowledgmentSchema=z.object({
 version:z.literal(1),program:bnaEmailProgram,reference:z.string().uuid(),
 templateId:bnaAcknowledgmentId,locale:z.enum(["en","he"]),recipient:z.email().max(254),
 subject:z.string().min(1).max(150),text:z.string().min(1).max(5000),
 sourceSha256:z.literal(BNA_EMAIL_SOURCE),copySha256:z.string().regex(/^[a-f0-9]{64}$/),
}).strict().superRefine((value,ctx)=>{
 if(value.templateId!==(value.program==="bna_learning_coop"?"EMAIL-B0":"EMAIL-S0"))ctx.addIssue({code:"custom",path:["templateId"],message:"program-specific acknowledgment required"});
 if(/[\r\n]/.test(value.subject)||value.recipient!==value.recipient.toLowerCase())ctx.addIssue({code:"custom",message:"canonical mail fields required"});
});
export type FrozenBnaAcknowledgment=z.infer<typeof frozenBnaAcknowledgmentSchema>;

/** Capture only the parent's chosen reply channel, never a secondary email,
 * guessed address, child details, medical note or optional marketing permission. */
export function freezeBnaAcknowledgment(program:BnaEmailProgram,reference:string,fields:BnaCoopFields|BnaSupportFields):FrozenBnaAcknowledgment|null{
 if(fields.contactChannel!=="email")return null;
 const id=program==="bna_learning_coop"?"EMAIL-B0":"EMAIL-S0";
 const source=bnaEmailCandidates.messages.find(message=>message.id===id);
 if(bnaEmailCandidates.sourceSha256!==BNA_EMAIL_SOURCE||!source||createHash("sha256").update(JSON.stringify(source.content)).digest("hex")!==source.copySha256)throw Error("BNA_EMAIL_SOURCE_MISMATCH");
 // Existing intake accepts arbitrary adult names. An unusable personalization
 // falls back to the reviewed natural greeting without losing the inquiry.
 const name=/[\r\n]|\{\{|\}\}/.test(fields.name)?"":fields.name;
 const preview=previewBnaEmailCandidate(id,fields.language,{FIRST_NAME:name,REFERENCE:reference});
 return frozenBnaAcknowledgmentSchema.parse({version:1,program,reference,templateId:id,locale:fields.language,
  recipient:fields.contact,subject:preview.subject,text:preview.body,sourceSha256:BNA_EMAIL_SOURCE,copySha256:source.copySha256});
}

const DAY=86_400_000;
export const BNA_EDUCATIONAL_SCHEDULE=Object.freeze({
 "EMAIL-B1":3,"EMAIL-B2":7,"EMAIL-B3":12,"EMAIL-B4":18,"EMAIL-B5":25,
 "EMAIL-S1":3,"EMAIL-S2":10,"EMAIL-S3":21,
 "EMAIL-D1":4,"EMAIL-D2":11,"EMAIL-D3":21,"EMAIL-D4":35,
} as const);
export type BnaEducationalTemplate=keyof typeof BNA_EDUCATIONAL_SCHEDULE;
export type EducationalSuppression="no_permission"|"withdrawn"|"paused"|"reply_pending"|"closed"|"invalid_recipient"|"complaint"|"unknown_delivery"|"already_sent"|"not_due"|"spacing"|"weekly_cap";
/** Sender/compliance admission is separate. These are facts loaded by the
 * server from the shared email calendar, not claims accepted from a browser. */
export function decideBnaEducationalDelivery(input:{
 templateId:BnaEducationalTemplate;now:Date;permissionGrantedAt:Date|null;withdrawn:boolean;
 paused:boolean;replyPending:boolean;closed:boolean;invalidRecipient:boolean;complaint:boolean;
 unknownDelivery:boolean;identicalContentSent:boolean;educationalSentAt:readonly Date[];
}):{eligible:true;dueAt:string}|{eligible:false;reason:EducationalSuppression;nextEligibleAt?:string}{
 const finite=(value:Date)=>Number.isFinite(value.getTime());
 if(!finite(input.now)||input.permissionGrantedAt&&!finite(input.permissionGrantedAt)||input.educationalSentAt.some(value=>!finite(value)))throw Error("BNA_EMAIL_CALENDAR_INVALID");
 if(!input.permissionGrantedAt)return {eligible:false,reason:"no_permission"};
 if(input.withdrawn)return {eligible:false,reason:"withdrawn"};
 if(input.paused)return {eligible:false,reason:"paused"};
 if(input.replyPending)return {eligible:false,reason:"reply_pending"};
 if(input.closed)return {eligible:false,reason:"closed"};
 if(input.invalidRecipient)return {eligible:false,reason:"invalid_recipient"};
 if(input.complaint)return {eligible:false,reason:"complaint"};
 if(input.unknownDelivery)return {eligible:false,reason:"unknown_delivery"};
 if(input.identicalContentSent)return {eligible:false,reason:"already_sent"};
 const days=BNA_EDUCATIONAL_SCHEDULE[input.templateId];if(days===undefined)throw Error("BNA_EMAIL_TEMPLATE_INVALID");
 const due=new Date(input.permissionGrantedAt.getTime()+days*DAY),now=input.now.getTime();
 if(now<due.getTime())return {eligible:false,reason:"not_due",nextEligibleAt:due.toISOString()};
 const sent=[...input.educationalSentAt].sort((a,b)=>a.getTime()-b.getTime());
 if(sent.some(value=>value.getTime()>now))throw Error("BNA_EMAIL_CALENDAR_INVALID");
 const recent=sent.filter(value=>value.getTime()>now-7*DAY),last=sent.at(-1);
 const spacing=last?last.getTime()+2*DAY:0,cap=recent.length>=2?recent[recent.length-2]!.getTime()+7*DAY:0;
 if(cap>now)return {eligible:false,reason:"weekly_cap",nextEligibleAt:new Date(Math.max(cap,spacing)).toISOString()};
 if(spacing>now)return {eligible:false,reason:"spacing",nextEligibleAt:new Date(spacing).toISOString()};
 return {eligible:true,dueAt:due.toISOString()};
}
