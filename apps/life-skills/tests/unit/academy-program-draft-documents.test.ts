import {createHash} from 'node:crypto';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect,vi} from 'vitest';
import {academyProgramDraftDocuments} from '../../src/features/group-application/academy-program-draft-documents.ts';
import {AcademyProgramTerms} from '../../src/features/group-application/academy-program-terms.tsx';
import {academyRegistrationNotice,academyRegistrationNoticeHashes} from '../../src/features/group-application/academy-registration-notice.ts';

const expected=[
  {
    "id": "jlfa-participation",
    "version": "JLFA-PARTICIPATION-PUBLIC-DRAFT-20261025-01",
    "hashes": {
      "en": "424a8be8ef0f255d5a95c463b98b8d896ec4e2cf92986619f55c64cd5b3fc522",
      "he": "51edbc241098533764436770d7060bbcff179f44c068494f12bef9a4225b68eb"
    }
  },
  {
    "id": "jlfa-safety",
    "version": "JLFA-SAFETY-PUBLIC-DRAFT-20261025-01",
    "hashes": {
      "en": "2402bc985317ba67e57978046d1b4091e9516f5e11869ddaa907e25fd867249b",
      "he": "a066c5a26f03299a3125abedb8a6d54346b22db6e2f5cb24c0fac0ad3b46f518"
    }
  },
  {
    "id": "jlfa-child-conduct",
    "version": "JLFA-CHILD-CONDUCT-PUBLIC-DRAFT-20261025-01",
    "hashes": {
      "en": "6ae23c9c74f8907d2dac714917a652a9dbf4e54fd727d89f5fa2fbafe190f564",
      "he": "84f181a0b7e8beb0aa060c61bba63b33d981f98d55596be52d5cd4ef24577ee5"
    }
  },
  {
    "id": "jlfa-program-policies",
    "version": "JLFA-PROGRAM-POLICIES-PUBLIC-DRAFT-20261025-01",
    "hashes": {
      "en": "af698bca86ca186d3655c2f0067dd345405f20e7320674a00f2ab607bc289594",
      "he": "38596e833ff663a85703c2368db9b3b434cfd8b876de07a93aabb7def7d84ce9"
    }
  },
  {
    "id": "jlfa-payment-cancellation",
    "version": "JLFA-PAYMENT-CANCELLATION-PUBLIC-DRAFT-20261025-01",
    "hashes": {
      "en": "2052b71fd0f5b94e60797a1e5ac163ab12a20ebad50e35184eb0c63c3000c04f",
      "he": "62a19288dc8bec796124a43fd86bce3ca194f7e955c8575a88399a52fcd4aff1"
    }
  }
] as const;
const digest=(text:string)=>createHash('sha256').update(text,'utf8').digest('hex');

describe('Academy read-only draft documents',()=>{
 it('pins all five reviewed documents and exact EN/HE bodies without release authority',()=>{
  expect(academyProgramDraftDocuments).toHaveLength(5);
  for(const [index,document] of academyProgramDraftDocuments.entries()){
   expect(document.id).toBe(expected[index]?.id);expect(document.version).toBe(expected[index]?.version);
   expect(document.status).toBe('DRAFT_NOT_RELEASED');expect(document.acceptanceEligible).toBe(false);expect(document.legalApproval).toBe(false);
   for(const locale of ['en','he'] as const){
    expect(digest(document.languages[locale].text)).toBe(expected[index]?.hashes[locale]);
    expect(document.languages[locale].contentSha256).toBe(expected[index]?.hashes[locale]);
    expect(document.languages[locale].translationApproved).toBe(false);
   }
  }
 });
 it.each(['en','he'] as const)('renders complete %s draft texts, review labels and hash metadata',locale=>{
  const html=renderToStaticMarkup(createElement(AcademyProgramTerms,{locale}));
  expect(html).toContain('data-academy-draft-review="true"');
  expect(html.match(/data-document-status="DRAFT_NOT_RELEASED"/g)).toHaveLength(5);
  for(const document of academyProgramDraftDocuments){
   expect(html).toContain('data-document-id="'+document.id+'"');
   expect(html).toContain('data-document-version="'+document.version+'"');
   expect(html).toContain('data-document-sha256="'+document.languages[locale].contentSha256+'"');
   expect(html).toContain(renderToStaticMarkup(createElement('div',{'data-academy-draft-body':true,style:{whiteSpace:'pre-wrap'}},document.languages[locale].text)));
  }
  expect(html).toContain(locale==='he'?'dir="rtl"':'dir="ltr"');
  if(locale==='he')expect(html.match(/data-translation-status="review_not_approved"/g)).toHaveLength(5);
  else expect(html).not.toContain('data-translation-status=');
  expect(html).toContain(locale==='he'?'קריאת הטיוטות אינה מתעדת הסכמה':'Reading these drafts does not record agreement');
 });
 it.each(['en','he'] as const)('preserves the exact released %s registration notice and existing policy',locale=>{
  const hashes={en:'b4ff8bb4a6860d719f20b3af14c4bfcd2680f13e4627db69cf63674c22e8a068',he:'83ac47d1387a523737716c9bf8d4bc0f63438bf4247a163ef7ab20ea1515359c'};
  const html=renderToStaticMarkup(createElement(AcademyProgramTerms,{locale}));
  expect(digest(academyRegistrationNotice[locale])).toBe(hashes[locale]);expect(academyRegistrationNoticeHashes[locale]).toBe(hashes[locale]);
  expect(academyRegistrationNotice.version).toBe('JLFA-FREE-REGISTRATION-TERMS-20261023-03-v1');
  expect(html.match(/data-document-status="released_registration_only"/g)).toHaveLength(1);
  expect(html).toContain(renderToStaticMarkup(createElement('p',null,academyRegistrationNotice[locale])));
  expect(html).toContain('data-academy-program-policies="true"');
  expect(html.indexOf('released_registration_only')).toBeLessThan(html.indexOf('DRAFT_NOT_RELEASED'));
 });
 it.each(['en','he'] as const)('adds no %s acceptance, navigation, submission or network controls',locale=>{
  const fetch=vi.fn(()=>{throw new Error('unexpected network request');});vi.stubGlobal('fetch',fetch);
  try{
   const html=renderToStaticMarkup(createElement(AcademyProgramTerms,{locale}));
   expect(html).not.toMatch(/<(?:input|button|form|select|textarea|a|script)\b/);
   expect(html).not.toMatch(/(?:action|formaction|href|checked|onClick)=/);
   expect(html.match(/data-acceptance-eligible="false"/g)).toHaveLength(5);
   expect(html).not.toContain('final_owner_approved');expect(fetch).not.toHaveBeenCalled();
  }finally{vi.unstubAllGlobals();}
 });
});
