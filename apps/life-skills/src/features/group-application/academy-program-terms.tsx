"use client";
import type {Locale} from '../../lib/locale.ts';
import {academyRegistrationNotice,academyRegistrationNoticeHashes} from './academy-registration-notice.ts';
import {academyExactCopy} from './academy-exact-copy.ts';
import {useAcademyCampaign} from './academy-campaign-state.ts';
import styles from './academy-registration.module.css';

/** Only the two explicitly marked registration/privacy fragments compose the
 * accepted notice. The other sections are information, never participation,
 * child acknowledgment, a payment authorization or a released legal agreement. */
export function AcademyProgramTerms({locale}:{locale:Locale}){
 const copy=academyExactCopy[locale],pre=useAcademyCampaign()?.phase==='PRE_REGISTRATION';
 return <section data-academy-program-terms id="academy-program-terms" aria-labelledby="academy-program-terms-heading">
  <h2 id="academy-program-terms-heading">{copy.form.sections.terms}</h2>
  <div data-document-id={academyRegistrationNotice.id} data-document-version={academyRegistrationNotice.version} data-document-language={locale} data-document-sha256={academyRegistrationNoticeHashes[locale]} data-document-scope="registration-and-privacy-fragments-only" data-document-status="released_registration_only">
   {copy.terms.sections.map(section=><details key={section.id} name="academy-program-information" className={styles.informationDisclosure} data-academy-information={section.id}>
    <summary id={'academy-information-'+section.id}>{section.heading}</summary>
    <div className={styles.informationPanel} role="region" tabIndex={0} aria-labelledby={'academy-information-'+section.id}>
    {section.paragraphs.map((paragraph,index)=><p key={index} data-document-fragment={section.id==='registration'||section.id==='privacy'?section.id:undefined}>{paragraph}</p>)}
    {section.id==='registration'&&pre&&<p data-academy-founder-information>{copy.terms.founderParagraph}</p>}
    </div>
   </details>)}
  </div>
 </section>;
}
