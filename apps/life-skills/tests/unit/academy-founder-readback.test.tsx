import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect,vi} from 'vitest';
import type {ComponentProps} from 'react';
import {AcademyFounderReadback,filterFounderFamilies} from '../../src/features/group-application/academy-founder-readback.tsx';
type Data=ComponentProps<typeof AcademyFounderReadback>['data'];
function fixture():Data{return {metrics:{completedRegistrations:2,uniqueFamilies:1,unresolvedIdentityRecords:0,children:2,activeFounderReservations:1,confirmedInterest:0,waitingForSuitableGroup:0,offersSent:0,paidFamilies:1,paidChildren:1,collectedCents:165099,confirmedEnrollment:0},families:[{id:'family-1',reference:'application-1',status:'provisional',allocated:true,revision:3,submittedAt:'2026-10-25T12:00:00Z',locale:'en',email:'synthetic@example.test',parentName:'Synthetic Parent',children:[{id:'child-1',name:'Synthetic Older',age:12},{id:'child-2',name:'Synthetic Younger',age:9}],identityApproved:true,interest:{generation:1,sentAt:null,deadline:null,exception:false,confirmedAt:null},payment:{generation:1,sentAt:null,deadline:null,exception:false,confirmedAt:null},tokenHash:'never-expose-token-hash',paused:false,offer:null,redeemedChildIds:['child-1'],collectedCents:165099,enrolledChildIds:[]}],messages:[{id:'message-1',familyId:'family-1',state:'queued',purpose:'academy_founder_interest',sentAt:null}]};}
const render=(data=fixture(),locale:'en'|'he'='en')=>renderToStaticMarkup(createElement(AcademyFounderReadback,{locale,data}));
describe('owner founder readback',()=>{
 it.each(['en','he'] as const)('keeps saved family, separate children, server counts and USD units in %s',locale=>{
  const html=render(fixture(),locale);expect(html).toContain('lang="'+locale+'"');expect(html).toContain('dir="'+(locale==='he'?'rtl':'ltr')+'"');expect(html.match(/data-founder-family/g)).toHaveLength(1);expect(html).toContain('Synthetic Older');expect(html).toContain('Synthetic Younger');expect(html).toContain('USD 1650.99');expect(html).not.toContain('USD 165099');expect(html).toMatch(/data-founder-metric="completedRegistrations"[^>]*>[\s\S]*?<dd[^>]*>2<\/dd>/);expect(html).toMatch(/data-founder-metric="uniqueFamilies"[^>]*>[\s\S]*?<dd[^>]*>1<\/dd>/);expect(html).toMatch(/data-founder-metric="confirmedEnrollment"[^>]*>[\s\S]*?<dd[^>]*>0<\/dd>/);expect(html).not.toContain('never-expose-token-hash');expect(html).toContain(locale==='en'?'No recorded successful send':'אין שליחה מוצלחת מתועדת');expect(html).toContain(locale==='en'?'Queued — not yet sent':'בתור — טרם נשלח');
 });
 it.each(['en','he'] as const)('never upgrades unknown family/message status or purpose in %s',locale=>{
  const data=fixture();data.families[0]!.status='future-status' as Data['families'][number]['status'];data.messages[0]!.state='delivered';data.messages[0]!.purpose='future-purpose';
  const html=render(data,locale);for(const value of ['future-status','future-purpose','delivered'])expect(html).not.toContain(value);expect(html).toContain(locale==='en'?'Status unverified':'המצב לא אומת');expect(html).toContain(locale==='en'?'Send status unverified':'מצב השליחה לא אומת');expect(html).toContain(locale==='en'?'Message purpose unverified':'מטרת ההודעה לא אומתה');
 });
 it('keeps unknown, sent and canceled email meanings separate without exposing completion time as send evidence',()=>{
  const data=fixture();data.messages=['unknown','sent','canceled'].map((state,i)=>({id:'message-'+i,familyId:'family-1',purpose:'academy_founder_interest',state,sentAt:new Date('2026-10-25T12:00:00Z')}));const html=render(data);expect(html).toContain('Send outcome unknown — review before retry');expect(html).toContain('Recorded as sent — delivery and reading are not verified');expect(html).toContain('Queue dispatch canceled — provider outcome is not established');expect(html).not.toContain('will not be sent');expect(html).not.toContain('2026-10-25T12:00:00');expect(html).toContain('No recorded successful send — no verified window');
 });
 it.each(['en','he'] as const)('does not imply founder allocation, full payment, guardian verification or no-send from bookkeeping in %s',locale=>{
  const data=fixture(),f=data.families[0]!;f.status='redeemed';f.allocated=false;f.everPaid=true;f.collectedCents=100;f.redeemedChildIds=[];data.metrics.collectedCents=100;data.metrics.activeFounderReservations=0;data.metrics.paidChildren=0;data.messages[0]!.state='canceled';const html=render(data,locale);
  expect(html).toContain(locale==='en'?'Payment recorded — enrollment is separate':'תשלום תועד — הקבלה להשתתפות נפרדת');expect(html).not.toContain(locale==='en'?'Founder offer redeemed':'הצעת המייסדים מומשה');expect(html).toContain(locale==='en'?'Unique families counted':'משפחות ייחודיות שנספרו');expect(html).not.toContain(locale==='en'?'Verified unique families':'משפחות ייחודיות שאומתו');expect(html).toContain(locale==='en'?'Queue dispatch canceled — provider outcome is not established':'השליחה מהתור בוטלה — תוצאת הספק לא הובררה');expect(html).not.toContain(locale==='en'?'will not be sent':'לא תישלח');expect(html).toContain('USD 1.00');expect(html).toMatch(/data-founder-metric="paidChildren"[^>]*>[\s\S]*?<dd[^>]*>0<\/dd>/);
 });
 it.each(['en','he'] as const)('labels acknowledgment as interest confirmation and rejects malformed send time in %s',locale=>{
  const data=fixture();data.messages[0]!.purpose='academy_founder_ack';data.families[0]!.interest.sentAt='not-a-send-time';data.families[0]!.interest.deadline='2026-11-01T12:00:00Z';const html=render(data,locale);
  expect(html).toContain(locale==='en'?'Interest confirmation acknowledgment':'אישור קבלת אישור ההתעניינות');expect(html).not.toContain(locale==='en'?'Registration acknowledgment':'אישור קבלת ההרשמה');expect(html).toContain(locale==='en'?'Send time not verified — historical record needs review':'מועד השליחה לא אומת — הרשומה ההיסטורית דורשת בדיקה');expect(html).not.toContain('America/New_York');
 });
 it('prioritizes delivery exceptions and does not start a window from an unbacked deadline',()=>{
  const data=fixture();data.families[0]!.interest={generation:2,sentAt:'2026-10-25T12:00:00Z',deadline:'2026-11-01T12:00:00Z',exception:true,confirmedAt:null};data.families[0]!.payment.deadline='2026-11-02T12:00:00Z';const html=render(data);expect(html).toContain('Delivery exception — owner review required');expect(html).toContain('No recorded successful send — no verified window');expect(html).not.toContain('America/New_York');
 });
 it('retains verified binding, dated offer, and Florida date readback without payment links',()=>{
  const data=fixture(),f=data.families[0]!;f.interest={generation:2,sentAt:'2026-10-25T12:00:00Z',deadline:'2026-11-01T12:00:00Z',exception:false,confirmedAt:'2026-10-26T12:00:00Z'};f.status='scheduling_hold';f.nativeBinding={verifiedAt:'2026-10-25T13:00:00Z',children:[{registrationChildId:'child-1',learnerId:'learner-1'},{registrationChildId:'child-2',learnerId:'learner-2'}]} as NonNullable<typeof f.nativeBinding>;f.offer={id:'offer-1',group:'Synthetic Group',groupId:'group-1',firstSession:'2026-12-01T15:00:00Z',paymentUrl:'https://private-payment.invalid',terms:'Private terms',priceVersion:'v1',children:[]};const html=render(data);expect(html).toContain('Internal hold for a suitable group');expect(html).toContain('2 mapped children');expect(html).toContain('Synthetic Group');expect(html).toContain('America/New_York');expect(html).not.toContain('private-payment.invalid');expect(html).not.toContain('Private terms');
 });
 it('ignores unknown metric fields and renders invalid numeric values conservatively',()=>{
  const data=fixture();Object.assign(data.metrics,{futureSecret:999,collectedCents:NaN,children:-1});const html=render(data);expect(html).not.toContain('futureSecret');expect(html).not.toContain('999');expect(html).not.toContain('NaN');expect(html).toContain('Needs review');
 });
 it('is inert and handles empty saved state without invented records',()=>{
  const fetch=vi.fn();vi.stubGlobal('fetch',fetch);try{const data=fixture();data.families=[];data.messages=[];const html=render(data);expect(html).toContain('No saved families are shown');expect(html).not.toMatch(/<(?:a|form|textarea)\b/);expect(html).toContain('Showing 0 of 0 loaded families.');expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Clear filters<\/button>/);expect(fetch).not.toHaveBeenCalled();}finally{vi.unstubAllGlobals();}
 });
 it.each(['en','he'] as const)('labels local-only filter scope and unchanged totals in %s',locale=>{
  const html=render(fixture(),locale);expect(html).toContain(locale==='en'?'Showing 1 of 1 loaded families.':'מוצגות 1 מתוך 1 משפחות שנטענו.');expect(html).toContain(locale==='en'?'do not search the complete database':'אינו מחפש בכל מסד הנתונים');expect(html).toContain(locale==='en'?'Overview totals and family email records are unchanged.':'הסיכומים למעלה ורשומות הדוא״ל המשפחתיות אינם משתנים.');expect(html).toMatch(/autocomplete="off"/i);expect(html).toContain('min-height:44px');
 });
 it.each(['synthetic parent','SYNTHETIC@EXAMPLE.TEST','application-1','younger','  Synthetic Older  '])('matches an existing name, email or reference and preserves every sibling: %s',search=>{
  const data=fixture(),families=filterFounderFamilies(data.families,{search,status:'all',age:''});expect(families).toHaveLength(1);expect(families[0]).toBe(data.families[0]);expect(families[0]!.children).toHaveLength(2);
 });
 it('combines saved status and same-child name/age without rounding or dropping siblings',()=>{
  const data=fixture(),family=data.families[0]!;data.families.push({...family,id:'family-2',status:'confirmed',children:[{id:'child-3',name:'Other',age:14}]});
  expect(filterFounderFamilies(data.families,{search:'',status:'provisional',age:'9'})).toEqual([family]);expect(filterFounderFamilies(data.families,{search:'younger',status:'provisional',age:'12'})).toEqual([]);expect(filterFounderFamilies(data.families,{search:'younger',status:'provisional',age:'9'})).toEqual([family]);expect(filterFounderFamilies(data.families,{search:'parent',status:'provisional',age:'12'})).toEqual([family]);
  expect(filterFounderFamilies(data.families,{search:'',status:'confirmed',age:'14'}).map(f=>f.id)).toEqual(['family-2']);
  for(const age of ['9.5','-1','18','09','NaN'])expect(filterFounderFamilies(data.families,{search:'',status:'all',age})).toEqual([]);
  expect(filterFounderFamilies(data.families,{search:'',status:'confirmed',age:'9'})).toEqual([]);
 });
 it('keeps unrecognized saved states conservative and never treats an arbitrary filter as authority',()=>{
  const data=fixture();data.families[0]!.status='future-status' as Data['families'][number]['status'];expect(filterFounderFamilies(data.families,{search:'',status:'unverified',age:''})).toEqual(data.families);
  for(const status of ['future-status','constructor','paid','enrolled'])expect(filterFounderFamilies(data.families,{search:'',status,age:''})).toEqual([]);
 });
 it('normalizes search only and never mutates loaded families, global metrics or messages',()=>{
  const data=fixture(),before=structuredClone(data);data.families[0]!.parentName='משפחה לדוגמה';before.families[0]!.parentName='משפחה לדוגמה';
  expect(filterFounderFamilies(data.families,{search:'משפחה',status:'all',age:''})).toHaveLength(1);expect(filterFounderFamilies(data.families,{search:'ＳＹＮＴＨＥＴＩＣ',status:'all',age:''})).toHaveLength(1);
  expect(filterFounderFamilies(data.families,{search:'no-match',status:'all',age:''})).toEqual([]);expect(data).toEqual(before);
 });
});

describe('owner initial-confirmation history after clock correction',()=>{
 it.each(['en','he'] as const)('shows %s old deadline as historical only and preserves payment-window readback',locale=>{
  const data=fixture(),f=data.families[0]!;f.interest={generation:1,sentAt:'2026-10-01T12:00:00Z',deadline:'2026-10-08T12:00:00Z',exception:false,confirmedAt:null};
  const before=structuredClone(data),html=render(data,locale);
  expect(html).toContain(locale==='en'?'No initial interest-confirmation expiry.':'אין תוקף מוגבל לאישור ההתעניינות הראשוני.');
  expect(html).toContain(locale==='en'?'Historical recorded deadline (not active):':'מועד אחרון שנרשם בעבר (אינו פעיל):');
  expect(html).not.toContain(locale==='en'?'Interest confirmation window':'חלון אישור ההתעניינות');
  expect(html).toContain(locale==='en'?'Payment offer window':'חלון הצעת התשלום');
  expect(data).toEqual(before);
 });
 it('does not call a newly sent initial request with no deadline an incomplete window',()=>{
  const data=fixture();data.families[0]!.interest.sentAt='2026-10-27T12:00:00Z';
  const html=render(data);expect(html).toContain('Initial request sent:');expect(html).not.toContain('Sent window deadline needs review');expect(html).not.toContain('Historical recorded deadline');
 });
});
