import type {BnaInquiryStore} from "../bna-inquiry/store.ts";
import {previewBnaEmailCandidate} from "./email-candidates.ts";
import type {BnaAcknowledgmentStore} from "./acknowledgment-store.ts";

export function bnaAcknowledgmentPreview(record:Awaited<ReturnType<BnaInquiryStore['read']>>,delivery?:Awaited<ReturnType<BnaAcknowledgmentStore['readForInquiry']>>){
 if(record.program!=='bna_learning_coop'&&record.program!=='bna_support_interest')return {available:false as const,reason:'different_program' as const};
 if(record.fields.contactChannel!=='email')return {available:false as const,reason:'phone_reply_selected' as const};
 if(delivery&&'payload' in delivery){const message=delivery.payload;return {available:true as const,recipient:message.recipient,deliveryState:delivery.state,
  messageId:delivery.messageId,deliveryVersion:delivery.version,deliveryCode:delivery.lastCode,candidate:{id:message.templateId,status:'frozen_snapshot' as const,locale:message.locale,
   subject:message.subject,body:message.text,sourceSha256:message.sourceSha256,copySha256:message.copySha256}};}
 return {available:true as const,recipient:record.fields.contact,deliveryState:'not_queued' as const,
  candidate:previewBnaEmailCandidate(record.program==='bna_support_interest'?'EMAIL-S0':'EMAIL-B0',record.fields.language,{FIRST_NAME:record.fields.name,REFERENCE:record.id})};
}
