import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it} from 'vitest';
import {academySessionCreditPublicVersion,academySessionCreditPublicSummarySchema,type AcademySessionCreditPublicSummary} from '../../../src/features/fishing/academy-session-credit-public-contract.ts';
import {AcademySessionCreditSummary} from '../../../src/features/fishing-stage/academy-session-credit-summary.tsx';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const summary=(state:AcademySessionCreditPublicSummary['credits'][number]['state']='outstanding'):AcademySessionCreditPublicSummary=>({version:academySessionCreditPublicVersion,enrollmentId:id(1),learnerId:id(2),credits:[{id:id(3),originalOccurrenceId:id(4),originalOrdinal:2,state}]});
function render(value:unknown,locale:'en'|'he'='en',role:'parent'|'practitioner'|'child'='parent',learnerId=id(2),enrollmentId=id(1)){return renderToStaticMarkup(createElement(AcademySessionCreditSummary,{summary:value as AcademySessionCreditPublicSummary,locale,role,selectedLearnerId:learnerId,selectedEnrollmentId:enrollmentId}));}
describe('strict parent credit wire contract and summary',()=>{
 it('rejects every private top-level and nested native field rather than silently accepting it',()=>{
  for(const key of ['purchaseId','purchaseLineId','householdId','workspaceId','guardianBindingId','inquiry','sourceEvidenceId','replacementReservationId','anchor','activityId']){const base=summary();for(const value of [{...base,[key]:'PRIVATE_CANARY'}, {...base,credits:[{...base.credits[0],[key]:'PRIVATE_CANARY'}]}]){expect(academySessionCreditPublicSummarySchema.safeParse(value).success,key).toBe(false);expect(render(value)).toBe('');}}
 });
 it('rejects historical internal-version summaries and browser-supplied permission flags',()=>{
  for(const value of [{...summary(),version:'JLFA-SESSION-POLICY-NATIVE-20261018-03-v1'},{...summary(),mayBook:true},{...summary(),mayMarkDelivered:true}])expect(academySessionCreditPublicSummarySchema.safeParse(value).success).toBe(false);
 });
 it('rejects duplicate original obligations and duplicate credit IDs',()=>{
  for(const second of [{...summary().credits[0]!,id:id(5)},{...summary().credits[0]!,originalOccurrenceId:id(5)}])expect(academySessionCreditPublicSummarySchema.safeParse({...summary(),credits:[summary().credits[0],second]}).success).toBe(false);
 });
 it('rejects malformed ordinal, unknown state and malformed identity without coercion',()=>{
  for(const change of [{originalOrdinal:0},{originalOrdinal:13},{originalOrdinal:'2'},{state:'paid'},{id:'not-a-uuid'},{originalOccurrenceId:null}])expect(academySessionCreditPublicSummarySchema.safeParse({...summary(),credits:[{...summary().credits[0],...change}]}).success).toBe(false);
 });
 it('does not render for other roles or a stale child/enrollment selection',()=>{
  for(const role of ['practitioner','child'] as const)expect(render(summary(),'en',role)).toBe('');expect(render(summary(),'en','parent',id(9))).toBe('');expect(render(summary(),'en','parent',id(2),id(9))).toBe('');
 });
 for(const locale of ['en','he'] as const){
  it(`renders ${locale} outstanding rights with no guaranteed seat or private identifiers`,()=>{const html=render(summary(),locale);expect(html).toContain(`lang="${locale}"`);expect(html).toContain(`dir="${locale==='he'?'rtl':'ltr'}"`);expect(html).toContain('data-academy-credit-state="outstanding"');expect(html).toContain(locale==='he'?'אין הבטחה לתאריך מסוים או למקום במפגש.':'A particular date or seat is not guaranteed.');expect(html).not.toMatch(/purchase|sourceEvidence|reservationId|guardian|activityId/);});
  it(`renders ${locale} reserved replacement as still undelivered`,()=>{const html=render(summary('replacement_reserved'),locale);expect(html).toContain(locale==='he'?'המפגש טרם סופק.':'The session remains undelivered.');expect(html).toContain('data-academy-credit-state="replacement_reserved"');});
  it(`renders ${locale} separately verified delivery without a pending-seat promise`,()=>{const html=render(summary('delivered'),locale);expect(html).toContain(locale==='he'?'המפגש המקורי הזה סופק.':'This original session has been fulfilled.');expect(html).not.toContain(locale==='he'?'אין הבטחה לתאריך מסוים':'A particular date or seat is not guaranteed');});
  it(`renders ${locale} empty rights without inventing a credit`,()=>{const html=render({...summary(),credits:[]},locale);expect(html).not.toContain('data-academy-credit-id');expect(html).toContain(locale==='he'?'לא נרשמה לילד זה זכאות להשלמה.':'No replacement credit is recorded for this child.');});
 }
});
