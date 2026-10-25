import {createHash} from 'node:crypto';
import {describe,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {signupEmailReview} from '../../src/features/group-application/academy-signup-email-review.ts';
import {founderEmailContent,type FounderMail} from '../../src/features/group-application/academy-founder-email.ts';

describe('synthetic signup email owner review',()=>{
 it('has eight bilingual base drafts and sixteen status examples, without payable templates',()=>{
  const review=signupEmailReview();expect(review).toMatchObject({syntheticExample:true,delivery:'not_sent',state:'draft_review_required',formatter:'founderEmailContent'});
  expect(review.drafts).toHaveLength(8);expect(new Set(review.drafts.map(d=>d.id)).size).toBe(8);expect(review.drafts.flatMap(d=>d.variants)).toHaveLength(16);
  for(const language of ['en','he'])expect(review.drafts.filter(d=>d.language===language).map(d=>d.kind)).toEqual(['interest','ack','interest_reminder','interest_deadline_receipt']);
 });
 for(const language of ['en','he'] as const)it(language+' exactly consumes the sending formatter and binds both hashes',()=>{
  const review=signupEmailReview();for(const d of review.drafts.filter(d=>d.language===language))for(const v of d.variants){
   const mail:FounderMail={familyId:'synthetic-preview-only',generation:1,kind:d.kind,locale:language,to:'synthetic-preview@example.invalid',reference:review.example.reference,status:v.status==='not_applicable'?'reserved':v.status,
    ...(d.kind==='interest'||d.kind==='interest_reminder'?{token:'PREVIEW_ONLY_NOT_A_CONFIRMATION_TOKEN'}:{}),...(d.kind==='interest_reminder'||d.kind==='interest_deadline_receipt'?{deadline:review.example.deadline}:{})};
   expect({subject:v.subject,text:v.text}).toEqual(founderEmailContent(mail,'https://bneineviimacademy.org'));
   expect(v.subjectSha256).toBe(createHash('sha256').update(v.subject,'utf8').digest('hex'));expect(v.textSha256).toBe(createHash('sha256').update(v.text,'utf8').digest('hex'));
   if(d.kind==='interest'||d.kind==='interest_reminder')expect(v.text).toContain('https://bneineviimacademy.org'+(language==='he'?'/he':'')+'/fishing-academy/confirm-interest#PREVIEW_ONLY_NOT_A_CONFIRMATION_TOKEN');
  }
 });
 it('preserves all three eligibility states and keeps examples separate from actual records',()=>{
  const review=signupEmailReview();for(const d of review.drafts.filter(d=>d.kind==='interest'||d.kind==='interest_reminder')){
   expect(d.variants.map(v=>v.status)).toEqual(['reserved','interest_list','pending_verification']);expect(new Set(d.variants.map(v=>v.textSha256)).size).toBe(3);
  }
  const json=JSON.stringify(review);expect(json).not.toMatch(/"(?:to|familyId|recipient|sendEnabled|approved|offer|paymentUrl|unpaidLines|token)":/);
  expect(json).not.toContain('@');expect(json).not.toMatch(/\$\d/);expect(json).not.toMatch(/confirm-interest#[A-Za-z0-9_-]{43}(?:"|\\n)/);
  for(const v of review.drafts.flatMap(d=>d.variants))expect(v.text).toContain(review.example.reference);
 });
 it('does not mutate a reusable shared review when one caller changes its copy',()=>{
  const first=signupEmailReview(),expected=signupEmailReview();first.drafts[0]!.variants[0]!.text='edited';expect(signupEmailReview()).toEqual(expected);
 });
});
