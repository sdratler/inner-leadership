import 'server-only';
import {createHash} from 'node:crypto';
import {founderEmailContent,type FounderMail} from './academy-founder-email.ts';

type SignupKind='interest'|'ack'|'interest_reminder';
type SignupStatus='reserved'|'interest_list'|'pending_verification';
export type SignupEmailReview={
 version:'academy-signup-email-review-v1';state:'draft_review_required';syntheticExample:true;delivery:'not_sent';formatter:'founderEmailContent';
 example:{reference:'SYNTHETIC-PREVIEW-NOT-A-FAMILY';deadline:'2030-01-15T15:00:00.000Z'};
 drafts:{id:string;language:'en'|'he';kind:SignupKind;variants:{status:SignupStatus|'not_applicable';subject:string;text:string;subjectSha256:string;textSha256:string}[]}[];
};

/** Owner readback only. Uses the sending formatter but creates no message, recipient or approval. */
export function signupEmailReview():SignupEmailReview{
 const example={reference:'SYNTHETIC-PREVIEW-NOT-A-FAMILY',deadline:'2030-01-15T15:00:00.000Z'} as const;
 const kinds:SignupKind[]=['interest','ack','interest_reminder'];
 const statuses:SignupStatus[]=['reserved','interest_list','pending_verification'];
 const hash=(value:string)=>createHash('sha256').update(value,'utf8').digest('hex');
 return {version:'academy-signup-email-review-v1',state:'draft_review_required',syntheticExample:true,delivery:'not_sent',formatter:'founderEmailContent',example,
  drafts:(['en','he'] as const).flatMap(language=>kinds.map(kind=>({id:kind+'-'+language,language,kind,variants:(kind==='interest'||kind==='interest_reminder'?statuses:['not_applicable'] as const).map(status=>{
   const mail:FounderMail={familyId:'synthetic-preview-only',generation:1,kind,locale:language,to:'synthetic-preview@example.invalid',reference:example.reference,status:status==='not_applicable'?'reserved':status,
    ...(kind==='interest'||kind==='interest_reminder'?{token:'PREVIEW_ONLY_NOT_A_CONFIRMATION_TOKEN'}:{}),
    ...(kind==='interest_reminder'?{deadline:example.deadline}:{})};
   const content=founderEmailContent(mail,'https://bneineviimacademy.org');
   return {status,...content,subjectSha256:hash(content.subject),textSha256:hash(content.text)};
  })})))
 };
}
