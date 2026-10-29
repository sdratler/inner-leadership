import type {BnaInquiryStore} from "../bna-inquiry/store.ts";
import {previewBnaEmailCandidate} from "./email-candidates.ts";

export function bnaAcknowledgmentPreview(record:Awaited<ReturnType<BnaInquiryStore['read']>>){
 if(record.program!=='bna_learning_coop'&&record.program!=='bna_support_interest')return {available:false as const,reason:'different_program' as const};
 if(record.fields.contactChannel!=='email')return {available:false as const,reason:'phone_reply_selected' as const};
 return {available:true as const,recipient:record.fields.contact,deliveryState:'not_queued' as const,
  candidate:previewBnaEmailCandidate(record.program==='bna_support_interest'?'EMAIL-S0':'EMAIL-B0',record.fields.language,{FIRST_NAME:record.fields.name,REFERENCE:record.id})};
}
