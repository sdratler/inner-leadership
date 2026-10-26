"use client";
import type {Locale} from '../../lib/locale.ts';
import {academyRegistrationNotice,academyRegistrationNoticeHashes} from './academy-registration-notice.ts';
import {academyExactCopy} from './academy-exact-copy.ts';
import {useAcademyCampaign} from './academy-campaign-state.ts';

/** Only the two explicitly marked registration/privacy fragments compose the
 * accepted notice. The other sections are information, never participation,
 * child acknowledgment, a payment authorization or a released legal agreement. */
export function AcademyProgramTerms({locale}:{locale:Locale}){
 const copy=academyExactCopy[locale],pre=useAcademyCampaign()?.phase==='PRE_REGISTRATION';
 return <details data-academy-program-terms id="academy-program-terms">
  <summary>{copy.form.sections.terms}</summary>
  <div data-document-id={academyRegistrationNotice.id} data-document-version={academyRegistrationNotice.version} data-document-language={locale} data-document-sha256={academyRegistrationNoticeHashes[locale]} data-document-scope="registration-and-privacy-fragments-only" data-document-status="released_registration_only">
   {copy.terms.sections.map(section=><section key={section.id} aria-labelledby={'academy-information-'+section.id} data-academy-information={section.id}>
    <h3 id={'academy-information-'+section.id}>{section.heading}</h3>
    {section.paragraphs.map((paragraph,index)=><p key={index} data-document-fragment={section.id==='registration'||section.id==='privacy'?section.id:undefined}>{paragraph}</p>)}
    {section.id==='registration'&&pre&&<p data-academy-founder-information>{copy.terms.founderParagraph}</p>}
   </section>)}
  </div>
 </details>;
}
