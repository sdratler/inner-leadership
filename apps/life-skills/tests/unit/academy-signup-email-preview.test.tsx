import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {signupEmailReview,type SignupEmailReview} from '../../src/features/group-application/academy-signup-email-review.ts';
import {AcademySignupEmailPreview,isSignupEmailReview} from '../../src/features/group-application/academy-signup-email-preview.tsx';

describe('inert owner signup email preview',()=>{
 for(const locale of ['en','he'] as const)it(locale+' renders synthetic draft text with no clickable confirmation or send action',()=>{
  const review=signupEmailReview(),html=renderToStaticMarkup(<AcademySignupEmailPreview locale={locale} review={review}/>);
  expect(review.drafts).toHaveLength(6);expect(review.drafts.flatMap(d=>d.variants)).toHaveLength(14);expect(html).not.toContain('interest_deadline_receipt');
  expect(isSignupEmailReview(review)).toBe(true);expect(html).toContain('lang="'+locale+'"');expect(html).toContain('dir="'+(locale==='he'?'rtl':'ltr')+'"');
  expect(html).toContain(locale==='he'?'לא נשלחו.':'Not sent.');expect(html).toContain('PREVIEW_ONLY_NOT_A_CONFIRMATION_TOKEN');expect(html).toContain(review.drafts.find(d=>d.kind==='interest'&&d.language===locale)!.variants[0]!.textSha256);
  expect(html).not.toMatch(/<(?:a|button|form)\b/);expect(html).not.toContain('href=');expect(html).toContain('min-height:44px');
 });
 const invalid=[
  (r:SignupEmailReview)=>({...r,version:'unknown'}),(r:SignupEmailReview)=>({...r,state:'approved'}),(r:SignupEmailReview)=>({...r,delivery:'sent'}),
  (r:SignupEmailReview)=>({...r,syntheticExample:false}),(r:SignupEmailReview)=>({...r,recipient:'private@example.invalid'}),
  (r:SignupEmailReview)=>({...r,example:{...r.example,reference:'real-family'}}),
  (r:SignupEmailReview)=>({...r,drafts:r.drafts.slice(1)}),
  (r:SignupEmailReview)=>({...r,drafts:[r.drafts[0],...r.drafts.slice(0,5)]}),
  (r:SignupEmailReview)=>({...r,drafts:r.drafts.map((d,i)=>i===0?{...d,kind:'payment_reminder'}:d)}),
  (r:SignupEmailReview)=>({...r,drafts:r.drafts.map((d,i)=>i===0?{...d,kind:'interest_deadline_receipt',id:'interest_deadline_receipt-'+d.language}:d)}),
  (r:SignupEmailReview)=>({...r,drafts:[...r.drafts,{...r.drafts[0],kind:'interest_deadline_receipt',id:'interest_deadline_receipt-en'},{...r.drafts[3],kind:'interest_deadline_receipt',id:'interest_deadline_receipt-he'}]}),
  (r:SignupEmailReview)=>({...r,drafts:r.drafts.map((d,i)=>i===0?{...d,variants:[...d.variants].reverse()}:d)}),
  (r:SignupEmailReview)=>({...r,drafts:r.drafts.map((d,i)=>i===0?{...d,variants:d.variants.map(v=>({...v,textSha256:'unverified'}))}:d)}),
  (r:SignupEmailReview)=>({...r,drafts:r.drafts.map((d,i)=>i===0?{...d,variants:d.variants.map(v=>({...v,text:'private family body'}))}:d)})
 ];
 it.each(invalid)('hides invalid or unrecognized DTO %#',change=>{
  const bad=change(signupEmailReview());expect(isSignupEmailReview(bad)).toBe(false);
  const html=renderToStaticMarkup(<AcademySignupEmailPreview locale="en" review={bad as SignupEmailReview}/>);expect(html).toContain('review is unavailable');expect(html).not.toContain('<article');expect(html).not.toContain('private');expect(html).not.toContain('<select');
 });
 it.each([null,undefined,[],{},true])('rejects missing input %#',value=>expect(isSignupEmailReview(value)).toBe(false));
});
