import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect,vi} from 'vitest';
import {AcademyTrip390Page} from '../../src/features/group-application/academy-trip390-page.tsx';
import {trip390ReservationNotice} from '../../src/features/group-application/academy-trip390-reservation-notice.ts';
import {trip390StudentConduct} from '../../src/features/group-application/academy-trip390-student-conduct.ts';
const escaped=(text:string)=>renderToStaticMarkup(createElement('span',null,text)).slice(6,-7);
function dialog(locale:'en'|'he',enabled?:boolean){
 const submit=vi.fn();const html=renderToStaticMarkup(createElement(AcademyTrip390Page,{initialLocale:locale,submitInterest:submit,...(enabled===undefined?{}:{reservationCollectionEnabled:enabled})}));
 expect(submit).not.toHaveBeenCalled();return html.match(/<dialog\b[\s\S]*?<\/dialog>/)?.[0]??'';
}
describe('nonbinding v3 reservation presentation',()=>{
 for(const locale of ['en','he'] as const){
  it(`defaults to no collection and requires its distinct reservation admission (${locale})`,()=>{
   const closed=dialog(locale),enabled=dialog(locale,true);
   expect(closed.match(/<fieldset\b[^>]*disabled=""/g)?.length).toBeGreaterThan(0);
   expect(closed).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/);
   expect(enabled).not.toMatch(/<fieldset\b[^>]*disabled=""/);
   expect(enabled).not.toMatch(/<button[^>]*type="submit"[^>]*disabled=""/);
  });
  it(`retains exactly three unchecked controls in required/required/optional order (${locale})`,()=>{
   const html=dialog(locale,true),controls=html.match(/<input\b[^>]*type="checkbox"[^>]*>/g)??[];
   expect(controls).toHaveLength(3);expect(controls.map(x=>x.match(/name="([^"]+)"/)?.[1])).toEqual(['interest','conduct','whatsapp']);
   expect(controls.map(x=>/\brequired=""/.test(x))).toEqual([true,true,false]);
   expect(controls.every(x=>!x.includes('checked=""'))).toBe(true);
  });
  it(`shows the full notice and child conduct, never an extra financial or signature acceptance (${locale})`,()=>{
   const html=dialog(locale,true),notice=trip390ReservationNotice(locale),conduct=trip390StudentConduct(locale);
   expect(html).toContain(escaped(notice.acknowledgment));expect(html).toContain(escaped(conduct.acknowledgment));
   for(const paragraph of notice.paragraphs)expect(html).toContain(escaped(paragraph));
   expect(html).toContain(escaped(conduct.intro));expect(conduct.sections).toHaveLength(4);
   for(const section of conduct.sections){expect(html).toContain(escaped(section.title));expect(html).toContain(escaped(section.body));}
   expect(html).toContain('data-reservation-notice-version="'+notice.version+'"');expect(html).toContain('data-reservation-notice-digest="'+notice.textDigest+'"');
   expect(html).toContain('data-student-conduct-version="'+conduct.version+'"');expect(html).toContain('data-student-conduct-digest="'+conduct.textDigest+'"');
   for(const retired of ['guardianTypedName','data-program-terms-version','data-student-agreement-version','name="notes"'])expect(html).not.toContain(retired);
   expect(html).not.toContain(locale==='en'?'I have read and agree to the Program Terms':'קראתי ואני מסכים/ה לתנאי התוכנית');
  });
  it(`keeps separate bounded accessible documents and mandatory contact/sibling/driving inputs (${locale})`,()=>{
   const html=dialog(locale,true);
   expect(html.match(/<details\b[^>]*name="trip390-notice"/g)).toHaveLength(2);
   expect(html.match(/<div\b[^>]*tabindex="0"[^>]*role="region"/g)).toHaveLength(2);
   expect(html).not.toMatch(/<details\b[^>]*open=""/);
   for(const name of ['guardianName','email','phoneE164','postalCode'])expect(html.match(new RegExp('<input\\b(?=[^>]*name="'+name+'")[^>]*>'))?.[0]).toContain('required=""');
   expect(html).toContain('name="lessonDayDriving"');expect(html).toContain('name="messageLanguage"');expect(html).toContain('name="instructionLanguage"');
   expect(html).toContain('trip390-child-first-name');expect(html).toContain('trip390-child-first-ageYears');
  });
 }
});
